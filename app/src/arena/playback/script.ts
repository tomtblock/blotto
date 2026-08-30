/*
 * Battle-script derivation — scoring output → a playable script. PURE, and
 * canonical by construction: every fact in a script is re-derivable from
 * `compareBattle` (script.test.ts asserts script outcomes === engine
 * outcomes on the fixture pool), and the field is RESCORED from the
 * published plaintext before anything plays — the arena never trusts a
 * published number it can recompute (`loadField`, the verify page's
 * rescore-don't-trust rule).
 *
 * The dramatic grammar maps 1:1 onto the real rule (PID §4.4):
 *  - one ROUND per battle index — character k versus character k;
 *  - one MOVE per stat, in the FIXED stat order — the canonical move order,
 *    identical for everyone (NG-007: no randomness, no reordering);
 *  - a stat is taken by the strictly larger number; a tie takes nothing;
 *  - the round ENDS the moment a side reaches three stats (`koAtMove` — a
 *    deterministic truncation, not a flourish); five moves without a third
 *    stat is the draw, played to the end;
 *  - the round outcome IS `compareBattle().outcome`.
 *
 * Pips render as a RACE TO THREE STATS WON — a true statement of the rule —
 * never as hit-point subtraction, which would be a display lie.
 */

import {
  BATTLES,
  STATS,
  assignPrizes,
  compareBattle,
  decodeBattleSet,
  potLamports,
  scoreWithMissing,
  type BattleOutcome,
  type BattleSet,
  type PlayerResult,
} from '@/arena/engine';
import type { PublishedBundle } from '@/verify/logic';

export interface MoveScript {
  /** Stat index 0..4 (fixed order — STAT_NAMES). */
  stat: number;
  myValue: number;
  oppValue: number;
  winner: 'me' | 'opp' | 'none';
  /** Stats won so far after this move — the pips. */
  running: { me: number; opp: number };
}

export interface RoundScript {
  /** Battle index 0..6 — which character pair is on stage. */
  battleIndex: number;
  /** Truncated at the KO move; all five on a draw. */
  moves: readonly MoveScript[];
  /** === compareBattle(mine[k], theirs[k]).outcome — my perspective. */
  outcome: BattleOutcome;
  /** Move index at which a side reached three stats, or null on a draw. */
  koAtMove: number | null;
}

export interface BattleScript {
  mySeat: number;
  oppSeat: number;
  rounds: readonly RoundScript[];
  tally: { wins: number; losses: number; draws: number };
}

export function buildBattleScript(
  mine: BattleSet,
  theirs: BattleSet,
  mySeat: number,
  oppSeat: number
): BattleScript {
  const rounds: RoundScript[] = [];
  const tally = { wins: 0, losses: 0, draws: 0 };
  for (let k = 0; k < BATTLES; k++) {
    const comparison = compareBattle(mine[k], theirs[k]);
    const moves: MoveScript[] = [];
    let me = 0;
    let opp = 0;
    let koAtMove: number | null = null;
    for (let z = 0; z < STATS; z++) {
      const myValue = mine[k][z];
      const oppValue = theirs[k][z];
      const winner = myValue > oppValue ? 'me' : oppValue > myValue ? 'opp' : 'none';
      if (winner === 'me') me++;
      else if (winner === 'opp') opp++;
      moves.push({ stat: z, myValue, oppValue, winner, running: { me, opp } });
      if (me === 3 || opp === 3) {
        koAtMove = z;
        break;
      }
    }
    rounds.push({ battleIndex: k, moves, outcome: comparison.outcome, koAtMove });
    if (comparison.outcome === 'win') tally.wins++;
    else if (comparison.outcome === 'loss') tally.losses++;
    else tally.draws++;
  }
  return { mySeat, oppSeat, rounds, tally };
}

/* ---- The beat timeline (the REVEAL_STEPS idiom) ------------------------ */

export type PlaybackBeat =
  | { kind: 'matchup-intro' }
  | { kind: 'round-intro'; round: number }
  | { kind: 'move-call'; round: number; move: number }
  | { kind: 'move-land'; round: number; move: number }
  | { kind: 'round-result'; round: number }
  | { kind: 'matchup-result' };

export function compileBeats(script: BattleScript): PlaybackBeat[] {
  const beats: PlaybackBeat[] = [{ kind: 'matchup-intro' }];
  script.rounds.forEach((round, r) => {
    beats.push({ kind: 'round-intro', round: r });
    round.moves.forEach((_, m) => {
      beats.push({ kind: 'move-call', round: r, move: m });
      beats.push({ kind: 'move-land', round: r, move: m });
    });
    beats.push({ kind: 'round-result', round: r });
  });
  beats.push({ kind: 'matchup-result' });
  return beats;
}

/* ---- The field: rescore, don't trust ----------------------------------- */

/** Thrown when the published results do not reproduce from the published
 * plaintext — playback must refuse and point at /verify. */
export class ArenaRescoreMismatch extends Error {
  constructor() {
    super('published results do not match the recomputed field');
    this.name = 'ArenaRescoreMismatch';
  }
}

export interface ArenaField {
  /** Seat → decoded battle set (null = lost ciphertext, scored all-losses). */
  sets: readonly (BattleSet | null)[];
  /** Rescored results with split-pot prizes, seat order — engine output. */
  results: readonly PlayerResult[];
}

const unhex = (s: string) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export function loadField(bundle: PublishedBundle): ArenaField {
  const byIndex = [...bundle.entries].sort((a, b) => a.index - b.index);
  const sets = byIndex.map((e) => (e.battles !== null ? decodeBattleSet(unhex(e.battles)) : null));
  const scored = scoreWithMissing(sets.map((battles, index) => ({ index, battles })));
  const results = assignPrizes(scored, potLamports(BigInt(bundle.entry_lamports)));
  for (const published of bundle.results) {
    const mine = results[published.index];
    if (
      mine === undefined ||
      mine.scoreHalf !== published.score_half ||
      mine.zones !== published.zones ||
      mine.rank !== published.rank ||
      mine.amountLamports.toString() !== published.amount_lamports
    ) {
      throw new ArenaRescoreMismatch();
    }
  }
  return { sets, results };
}

/* ---- Featured matchups (the highlight reel) ----------------------------- */

/** Matchup outcome for the list chips: more rounds won than lost. */
export function matchupOutcome(script: BattleScript): BattleOutcome {
  if (script.tally.wins > script.tally.losses) return 'win';
  if (script.tally.losses > script.tally.wins) return 'loss';
  return 'draw';
}

/**
 * Up to three featured opponents, PURELY derived (fixed tie-breaks, never
 * randomness): the pool's top-ranked seat, the viewer's widest win, and the
 * viewer's narrowest result. Deduplicated, order fixed.
 */
export function featuredSeats(
  mySeat: number,
  scripts: readonly BattleScript[],
  results: readonly PlayerResult[]
): number[] {
  const bySeat = new Map(scripts.map((s) => [s.oppSeat, s]));
  const opponents = results.filter((r) => r.index !== mySeat);
  if (opponents.length === 0) return [];

  const winner = opponents.reduce((best, r) =>
    r.rank < best.rank || (r.rank === best.rank && r.index < best.index) ? r : best
  ).index;

  const margin = (s: BattleScript) => s.tally.wins - s.tally.losses;
  const all = [...bySeat.values()];
  const widestWin = all
    .filter((s) => margin(s) > 0)
    .reduce<BattleScript | null>(
      (best, s) =>
        best === null || margin(s) > margin(best) || (margin(s) === margin(best) && s.oppSeat < best.oppSeat)
          ? s
          : best,
      null
    );
  const narrowest = all.reduce<BattleScript | null>(
    (best, s) =>
      best === null ||
      Math.abs(margin(s)) < Math.abs(margin(best)) ||
      (Math.abs(margin(s)) === Math.abs(margin(best)) && s.oppSeat < best.oppSeat)
        ? s
        : best,
    null
  );

  const picks = [winner, widestWin?.oppSeat, narrowest?.oppSeat].filter(
    (s): s is number => s !== undefined && s !== null
  );
  return [...new Set(picks)];
}
