'use client';

/*
 * The battle stage — Pokémon grammar over canonical data. Renders ONE
 * matchup's compiled beats; every number and outcome on this stage came out
 * of `compareBattle` via the script (script.ts), never out of this file.
 *
 * Machine-and-dumb-clock: the pure playback reducer advances the cursor;
 * this component owns ONE timer keyed on the cursor. Tap advances (the
 * text-box idiom), skip-to-result is always visible (63 possible matchups —
 * load-bearing, not nice-to-have).
 *
 * Discipline (pinned by src/arena/stage-discipline.test.ts):
 *  - every magnitude is a named constant (playback/constants.ts);
 *  - no randomness, no clock reads;
 *  - class colour enters ONLY through the shared Creature, which walks the
 *    classColorToken door;
 *  - pips and the tally use the price-up/price-down tokens — their RESERVED
 *    functional meaning (win/loss), which is exactly what pips are;
 *  - reduced motion: no lunges/shakes/sinks — poses, text and pip changes
 *    only, tap-to-advance unchanged.
 */

import { useEffect, useMemo, useReducer } from 'react';
import { LazyMotion, MotionConfig, domAnimation, m, useAnimate } from 'motion/react';
import { COPY } from '@/copy';
import { STAT_NAMES } from '@/battle/allocation';
import type { BattleSet } from '@/arena/engine';
import { characterFor } from '@/arena/characters';
import { Creature } from '@/arena/creature/creature';
import type { RevealClass } from '@/reveal/types';
import { usePrefersReducedMotion } from '@/reveal/stages/use-reduced-motion';
import {
  CLASH_SCALE_MAX,
  EASE_JUICE,
  EASE_SNAP,
  ENTER_SCALE_FROM,
  ENTER_SETTLE_MS,
  HIT_SHAKE_DURATION_MS,
  HIT_SHAKE_PX,
  KO_FADE_DURATION_MS,
  KO_SINK_PX,
  LUNGE_DURATION_MS,
  LUNGE_PX,
  MATCHUP_INTRO_MS,
  MOVE_CALL_MS,
  MOVE_LAND_MS,
  ROUND_INTRO_MS,
  ROUND_RESULT_MS,
} from './constants';
import {
  INITIAL_PLAYBACK_STATE,
  atResult,
  playbackReducer,
  type PlaybackState,
  type PlaybackEvent,
} from './machine';
import { compileBeats, type BattleScript, type PlaybackBeat } from './script';

const sec = (ms: number) => ms / 1000;

const BEAT_MS: Record<PlaybackBeat['kind'], number> = {
  'matchup-intro': MATCHUP_INTRO_MS,
  'round-intro': ROUND_INTRO_MS,
  'move-call': MOVE_CALL_MS,
  'move-land': MOVE_LAND_MS,
  'round-result': ROUND_RESULT_MS,
  // The result HOLDS — leaving is an explicit control, never a timer.
  'matchup-result': 0,
};

export interface BattleStageProps {
  script: BattleScript;
  mine: BattleSet;
  theirs: BattleSet;
  myClass: RevealClass | null;
  oppClass: RevealClass | null;
  onExit: () => void;
}

function messageFor(beat: PlaybackBeat, script: BattleScript): string {
  const b = COPY.arena.battle;
  switch (beat.kind) {
    case 'matchup-intro':
      return b.matchupTitle(script.oppSeat);
    case 'round-intro': {
      const round = script.rounds[beat.round];
      return b.roundIntro(beat.round + 1, characterFor(round.battleIndex).name);
    }
    case 'move-call': {
      const round = script.rounds[beat.round];
      const move = round.moves[beat.move];
      return b.moveCall(characterFor(round.battleIndex).name, STAT_NAMES[move.stat]);
    }
    case 'move-land': {
      const round = script.rounds[beat.round];
      const move = round.moves[beat.move];
      const name = characterFor(round.battleIndex).name;
      if (move.winner === 'none') return b.statTied(STAT_NAMES[move.stat], move.myValue);
      return move.winner === 'me'
        ? b.statTaken(STAT_NAMES[move.stat], b.mySide(name), move.myValue, move.oppValue)
        : b.statTaken(STAT_NAMES[move.stat], b.oppSide(name), move.oppValue, move.myValue);
    }
    case 'round-result': {
      const round = script.rounds[beat.round];
      const name = characterFor(round.battleIndex).name;
      if (round.outcome === 'win') return b.roundWon(b.mySide(name));
      if (round.outcome === 'loss') return b.roundLost(b.mySide(name));
      return b.roundDraw;
    }
    case 'matchup-result':
      return b.matchupResult(script.tally.wins, script.tally.draws, script.tally.losses);
  }
}

/** Pips (stats won so far this round) visible at this beat. */
function pipsAt(beat: PlaybackBeat, script: BattleScript): { me: number; opp: number } {
  if (beat.kind === 'move-land') return script.rounds[beat.round].moves[beat.move].running;
  if (beat.kind === 'move-call' && beat.move > 0) {
    return script.rounds[beat.round].moves[beat.move - 1].running;
  }
  if (beat.kind === 'round-result') {
    const moves = script.rounds[beat.round].moves;
    return moves[moves.length - 1].running;
  }
  return { me: 0, opp: 0 };
}

export function BattleStage({ script, mine, theirs, myClass, oppClass, onExit }: BattleStageProps) {
  const beats = useMemo(() => compileBeats(script), [script]);
  const [state, dispatch] = useReducer(
    (s: PlaybackState, e: PlaybackEvent) => playbackReducer(s, e, beats.length),
    INITIAL_PLAYBACK_STATE
  );
  const reduced = usePrefersReducedMotion();
  const [myScope, animateMine] = useAnimate();
  const [oppScope, animateOpp] = useAnimate();

  const beat = beats[state.cursor];
  const done = atResult(state, beats.length);
  const roundIndex =
    'round' in beat ? beat.round : beat.kind === 'matchup-result' ? script.rounds.length - 1 : 0;
  const round = script.rounds[roundIndex];
  const identity = characterFor(round.battleIndex);
  const pips = pipsAt(beat, script);

  // The one clock: per-beat duration, keyed on the cursor.
  useEffect(() => {
    if (state.paused || done) return;
    const ms = BEAT_MS[beats[state.cursor].kind];
    if (ms <= 0) return;
    const id = setTimeout(() => dispatch({ kind: 'beat_elapsed' }), ms);
    return () => clearTimeout(id);
  }, [state.cursor, state.paused, done, beats]);

  // Impulse choreography on the beat's rising edge (the reveal-stage jolt
  // pattern). Decoration on a state change, never a gate — and never under
  // reduced motion (the KO keeps an opacity-only fade there).
  useEffect(() => {
    const current = beats[state.cursor];
    if (!myScope.current || !oppScope.current) return;
    if (current.kind === 'round-intro') {
      void animateMine(myScope.current, { x: 0, y: 0, opacity: 1, scale: 1 }, { duration: 0 });
      void animateOpp(oppScope.current, { x: 0, y: 0, opacity: 1, scale: 1 }, { duration: 0 });
      return;
    }
    if (current.kind === 'move-land') {
      const move = script.rounds[current.round].moves[current.move];
      if (reduced) return;
      if (move.winner === 'none') {
        const clash = { scale: [1, CLASH_SCALE_MAX, 1] };
        const opts = { duration: sec(LUNGE_DURATION_MS), ease: EASE_JUICE } as const;
        void animateMine(myScope.current, clash, opts);
        void animateOpp(oppScope.current, clash, opts);
        return;
      }
      const [attacker, attackerScope, defender, defenderScope] =
        move.winner === 'me'
          ? ([animateMine, myScope, animateOpp, oppScope] as const)
          : ([animateOpp, oppScope, animateMine, myScope] as const);
      const toward = move.winner === 'me' ? 1 : -1;
      void attacker(
        attackerScope.current,
        { x: [0, LUNGE_PX * toward, 0], y: [0, -LUNGE_PX * toward, 0] },
        { duration: sec(LUNGE_DURATION_MS), ease: EASE_SNAP }
      );
      void defender(
        defenderScope.current,
        { x: [0, -HIT_SHAKE_PX, HIT_SHAKE_PX, 0] },
        { duration: sec(HIT_SHAKE_DURATION_MS), ease: EASE_SNAP }
      );
      return;
    }
    if (current.kind === 'round-result') {
      const outcome = script.rounds[current.round].outcome;
      if (outcome === 'draw') return;
      const [faller, fallerScope] =
        outcome === 'win' ? ([animateOpp, oppScope] as const) : ([animateMine, myScope] as const);
      void faller(
        fallerScope.current,
        reduced ? { opacity: 0 } : { opacity: 0, y: KO_SINK_PX },
        { duration: sec(KO_FADE_DURATION_MS), ease: EASE_SNAP }
      );
    }
  }, [state.cursor, beats, script, reduced, animateMine, animateOpp, myScope, oppScope]);

  const tallyVisible = script.rounds.map((r, i) => {
    const passed =
      beat.kind === 'matchup-result' ||
      i < roundIndex ||
      (i === roundIndex && beat.kind === 'round-result');
    return passed ? r.outcome : null;
  });

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <section className="flex flex-col gap-4">
          {/* The stage. Tapping it advances — the text-box idiom. */}
          <button
            type="button"
            className="relative h-80 w-full cursor-pointer overflow-hidden rounded-lg border bg-[var(--color-raised)] text-left"
            onClick={() => dispatch({ kind: 'tap' })}
            aria-label={COPY.arena.battle.tapNote}
          >
            {/* Opponent: top-right, on a platform. */}
            <div className="absolute right-6 top-4 flex flex-col items-center">
              <m.div ref={oppScope}>
                <m.div
                  key={`opp-${roundIndex}`}
                  initial={{ scale: ENTER_SCALE_FROM, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: sec(ENTER_SETTLE_MS), ease: EASE_JUICE }}
                >
                  <Creature
                    allocation={theirs[round.battleIndex]}
                    uid={`stage-opp-${roundIndex}`}
                    classIndex={oppClass}
                    facing="left"
                    className="h-28 w-28"
                    label={COPY.arena.battle.oppSide(identity.name)}
                  />
                </m.div>
              </m.div>
              <div className="h-2 w-24 rounded-full bg-[var(--color-overlay)]" aria-hidden />
              <Pips count={pips.opp} side="opp" />
            </div>
            {/* Mine: bottom-left, closer. */}
            <div className="absolute bottom-10 left-6 flex flex-col items-center">
              <m.div ref={myScope}>
                <m.div
                  key={`mine-${roundIndex}`}
                  initial={{ scale: ENTER_SCALE_FROM, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: sec(ENTER_SETTLE_MS), ease: EASE_JUICE }}
                >
                  <Creature
                    allocation={mine[round.battleIndex]}
                    uid={`stage-mine-${roundIndex}`}
                    classIndex={myClass}
                    facing="right"
                    className="h-36 w-36"
                    label={COPY.arena.battle.mySide(identity.name)}
                  />
                </m.div>
              </m.div>
              <div className="h-2 w-32 rounded-full bg-[var(--color-overlay)]" aria-hidden />
              <Pips count={pips.me} side="me" />
            </div>
            {/* Round tally — seven battles, outcomes as they land. */}
            <ol className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1.5" aria-hidden>
              {tallyVisible.map((o, i) => (
                <li
                  key={i}
                  className={`h-2.5 w-2.5 rounded-full border ${
                    o === 'win'
                      ? 'border-transparent bg-price-up'
                      : o === 'loss'
                        ? 'border-transparent bg-price-down'
                        : o === 'draw'
                          ? 'border-transparent bg-[var(--color-ink-muted)]'
                          : 'border-[var(--color-overlay)]'
                  }`}
                />
              ))}
            </ol>
          </button>

          {/* The message box. */}
          <div
            className="min-h-16 rounded-lg border bg-[var(--color-raised)] px-4 py-3 text-sm"
            aria-live="polite"
          >
            <p>{messageFor(beat, script)}</p>
            {!done && <p className="mt-1 text-xs opacity-50">{COPY.arena.battle.tapNote}</p>}
          </div>

          <div className="flex gap-3 text-sm">
            {!done && (
              <>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5"
                  onClick={() => dispatch({ kind: 'toggle_pause' })}
                >
                  {state.paused ? COPY.arena.battle.resume : COPY.arena.battle.pause}
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5"
                  onClick={() => dispatch({ kind: 'skip_to_result' })}
                >
                  {COPY.arena.battle.skip}
                </button>
              </>
            )}
            {done && (
              <button
                type="button"
                className="rounded border px-3 py-1.5"
                onClick={() => dispatch({ kind: 'replay' })}
              >
                {COPY.arena.battle.replay}
              </button>
            )}
            <button type="button" className="ml-auto rounded border px-3 py-1.5" onClick={onExit}>
              ← {COPY.arena.results.allMatchups}
            </button>
          </div>
        </section>
      </MotionConfig>
    </LazyMotion>
  );
}

/** The race to three stats won — a true statement of the rule (never
 * hit-point subtraction). price tokens = their reserved win/loss meaning. */
function Pips({ count, side }: { count: number; side: 'me' | 'opp' }) {
  return (
    <div className="mt-1 flex gap-1" aria-label={`${count} of 3 stats won`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${
            i < count ? (side === 'me' ? 'bg-price-up' : 'bg-price-down') : 'bg-[var(--color-overlay)]'
          }`}
        />
      ))}
    </div>
  );
}
