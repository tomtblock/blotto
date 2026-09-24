'use client';

/*
 * The BOARD run (founder brief 2026-09-24) — the host that the play page
 * mounts in place of <BattleFlow /> when NEXT_PUBLIC_BATTLE_BOARD=1. Same
 * contract as BattleFlow: it never sees a wallet, sealing happens outside
 * via `onConfirm`, and when the page hosts the seal stage the review is
 * drawn into the stage's widget slot and the seal keys are the page's.
 *
 * Ready → board (the machine, src/battle/board/machine.ts) → review →
 * confirmed. The reducer owns every rule; this component feeds ticks and
 * the arena's gestures and renders state. The arena itself (arena/) is the
 * founder's mockup — painted map, sprite crowds, camera, deploy curve —
 * carried over and wired to the reducer.
 *
 * The run clock is sampled against performance.now() exactly as the dial
 * run's is (audit 2026-09-11 F-04): elapsed time, not timer firings, integer
 * milliseconds with the remainder carried.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { STAT_NAMES, type Allocation } from '@/battle/allocation';
import {
  type BoardEvent,
  type BoardPlayState,
  boardComplete,
  boardRemaining,
  fieldRemaining,
  initialBoardState,
  reduceBoard,
} from '@/battle/board/machine';
import { type BoardMode, EASY_PER_FIELD } from '@/battle/board/mode';
import { sampleTick } from '@/battle/run-clock';
import type { ReviewSealApi } from '../battle-flow';
import { Arena } from './arena/Arena';
import { GrabKey, HintLine, ModeBadge, ProgressReadout, ReadyBanner, TimerCard } from './hud';
import { ReviewPanel } from './ReviewPanel';
import { Stepper } from './Stepper';
import { TroopTray } from './TroopTray';
import './board.css';

const TICK_MS = 100;
const LAST_SECONDS_MS = 10_000;

export interface BoardFlowProps {
  mode: BoardMode;
  onConfirm: (battles: readonly Allocation[], timingsMs: readonly number[]) => void;
  onReviewApi?: (api: ReviewSealApi | null) => void;
  reviewHost?: HTMLElement | null;
  onRunStarted?: () => void;
  /** Demo mode (the landing page): no seal, no leave guard; the review offers "Try again". */
  demo?: boolean;
}

/** Easy-mode rows are Allocations by construction; say so to the type system, checked. */
function toAllocations(battles: readonly (readonly number[])[]): Allocation[] {
  return battles.map((row) => {
    if (row.length !== 5 || row.reduce((a, b) => a + b, 0) !== EASY_PER_FIELD) {
      throw new Error('board produced a battle that is not an easy-mode allocation');
    }
    return [row[0] as number, row[1] as number, row[2] as number, row[3] as number, row[4] as number] as const;
  });
}

export function BoardFlow({ mode, onConfirm, onReviewApi, reviewHost = null, onRunStarted, demo = false }: BoardFlowProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduceBoard, mode, (m) => initialBoardState(m));
  const [openField, setOpenField] = useState<number | null>(null);
  const [holdField, setHoldField] = useState<number | null>(null);
  /* Grab mode (the hand key): the troop stays in hand, the gesture is
   * disarmed, a tap on a field opens its stepper. Picking a card ends it. */
  const [grab, setGrab] = useState(false);
  const [leaveSheet, setLeaveSheet] = useState(false);
  const [sealArmed, setSealArmed] = useState(false);
  const confirmed = useRef(false);

  const play = state.phase === 'play' ? state : null;
  const review = state.phase === 'review' ? state : null;

  // The arena's listeners are attached once and read the latest play state here.
  const playRef = useRef<BoardPlayState | null>(play);
  useEffect(() => {
    playRef.current = play;
  }, [play]);

  /* The seal stage's handle on the confirm, exactly as BattleFlow. */
  useEffect(() => {
    if (!review || !onReviewApi || demo) return;
    onReviewApi({ confirm: () => dispatch({ type: 'confirm' }) });
    return () => onReviewApi(null);
  }, [review, onReviewApi, demo]);

  /* The run clock — elapsed time against performance.now(). */
  const ticking = play !== null && play.clockStarted;
  const baseline = useRef<number | null>(null);
  useEffect(() => {
    if (!ticking) {
      baseline.current = null;
      return;
    }
    if (baseline.current === null) baseline.current = performance.now();
    const id = setInterval(() => {
      const base = baseline.current;
      if (base === null) return;
      const sample = sampleTick(base, performance.now());
      if (sample.ms <= 0) return;
      baseline.current = sample.baseline;
      dispatch({ type: 'tick', ms: sample.ms });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ticking]);

  /* Confirmed: hand the entry out once (easy mode only in Phase A). */
  useEffect(() => {
    if (state.phase !== 'confirmed' || confirmed.current || demo) return;
    confirmed.current = true;
    onConfirm(toAllocations(state.battles), state.timingsMs);
  }, [state, onConfirm, demo]);

  /* The stepper exists only while the board is live. */
  const stepperField = play !== null ? openField : null;

  /* Back navigation during the run — the same sheet as the dial run. */
  const inPlay = play !== null && !demo;
  useEffect(() => {
    if (!inPlay) return;
    history.pushState({ blottoRun: true }, '');
    const onPop = () => setLeaveSheet(true);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [inPlay]);

  const send = useCallback((e: BoardEvent) => dispatch(e), []);

  /* The deploy curve asks for `n`; the reducer takes what fits. We report
   * that number back so the gesture can say "full" — the reducer clips
   * again regardless. */
  const onDeposit = useCallback((field: number, stat: number, n: number): number => {
    const s = playRef.current;
    if (!s || s.locked[field]) return 0;
    const placed = Math.min(n, fieldRemaining(s, field));
    if (placed > 0) dispatch({ type: 'place', field, stat, delta: placed });
    return placed;
  }, []);
  const onOpenStepper = useCallback((field: number, stat: number | null) => {
    if (stat !== null) dispatch({ type: 'select', stat });
    setOpenField(field);
  }, []);
  const onTapEmpty = useCallback(() => setOpenField(null), []);
  const selectTroop = useCallback((stat: number | null) => {
    if (stat !== null) setGrab(false);
    dispatch({ type: 'select', stat });
  }, []);

  /* ——— Ready: the banner over an idle arena. ——— */
  if (state.phase === 'ready') {
    const idle = reduceBoard(state, { type: 'begin' });
    if (idle.phase !== 'play') return null;
    return (
      <section className="bb animate-settle">
        <div style={{ position: 'relative' }}>
          <Arena state={idle} interactive={false} onDeposit={() => 0} onOpenStepper={() => {}} onTapEmpty={() => {}} onHold={() => {}} demo={demo} />
          <ReadyBanner
            mode={mode}
            onDismiss={() => {
              dispatch({ type: 'begin' });
              onRunStarted?.();
            }}
          />
        </div>
        <TroopTray state={idle} onSelect={() => {}} disabled />
      </section>
    );
  }

  /* ——— The board. ——— */
  if (play) {
    const selectedName = play.selected === null ? null : (STAT_NAMES[play.selected] as string);
    const left = boardRemaining(play);
    const lastSeconds = play.clockStarted && play.remainingMs <= LAST_SECONDS_MS;
    const complete = boardComplete(play);
    const hint = lastSeconds
      ? COPY.board.hintLastSeconds
      : grab
        ? COPY.board.hintGrab(selectedName)
        : holdField !== null && selectedName !== null
          ? COPY.board.hintDeploying(selectedName, holdField + 1)
          : selectedName === null
            ? COPY.board.hintPick
            : play.mode === 'hard'
              ? COPY.board.hintHoldHard(selectedName, left)
              : COPY.board.hintHold(selectedName);
    return (
      <section className="bb">
        <div style={{ position: 'relative' }}>
          <Arena
            state={play}
            interactive={stepperField === null}
            grab={grab}
            onDeposit={onDeposit}
            onOpenStepper={onOpenStepper}
            onTapEmpty={onTapEmpty}
            onHold={setHoldField}
            demo={demo}
          />
          <div className="bb-hud">
            <div className="bb-hud-top">
              <TimerCard remainingMs={play.remainingMs} started={play.clockStarted} />
              <ProgressReadout state={play} />
            </div>
            <div className="bb-hud-left">
              <ModeBadge mode={play.mode} />
              <GrabKey on={grab} onToggle={() => setGrab((g) => !g)} />
              {!demo && (
                <button type="button" className="bb-btn" onClick={() => setLeaveSheet(true)}>
                  {COPY.board.leave}
                </button>
              )}
            </div>
          </div>
          {stepperField !== null && (
            <Stepper
              state={play}
              field={stepperField}
              onPlace={(field, stat, delta) => send({ type: 'place', field, stat, delta })}
              onFill={(field, stat) => send({ type: 'fill_field', field, stat })}
              onSendBack={(field, stat) => send({ type: 'send_back', field, stat })}
              onLock={(field) => send({ type: 'lock', field })}
              onUnlock={(field) => send({ type: 'unlock', field })}
              onSelect={(stat) => send({ type: 'select', stat })}
              onClose={() => setOpenField(null)}
            />
          )}
        </div>
        <HintLine text={hint} />
        <TroopTray state={play} onSelect={selectTroop} />
        {play.clockStarted && (
          <button
            type="button"
            className={'bb-btn self-center ' + (complete ? 'bb-btn--commit' : '')}
            onClick={() => {
              setOpenField(null);
              send({ type: 'submit' });
            }}
            data-testid="board-submit"
          >
            {complete ? COPY.board.submitComplete : COPY.board.submitEarly}
          </button>
        )}

        {!demo && (
          <Sheet open={leaveSheet} onClose={() => setLeaveSheet(false)} title={COPY.battle.backStay}>
            <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.battle.backSheetLine}</p>
            <div className="mt-4 flex gap-3">
              <Button
                onClick={() => {
                  setLeaveSheet(false);
                  history.pushState({ blottoRun: true }, '');
                }}
              >
                {COPY.battle.backStay}
              </Button>
              <Button intent="quiet" onClick={() => router.push('/')}>
                {COPY.battle.backLeave}
              </Button>
            </div>
          </Sheet>
        )}
      </section>
    );
  }

  /* ——— Review. ——— */
  if (review) {
    const hosted = Boolean(onReviewApi) && !demo;
    const panel = (
      <ReviewPanel
        review={review}
        onResume={() => {
          setOpenField(null);
          send({ type: 'resume' });
        }}
        compact={hosted}
      />
    );
    if (hosted) {
      return reviewHost ? createPortal(<div className="bb flex flex-col gap-4">{panel}</div>, reviewHost) : null;
    }
    if (demo) {
      return (
        <section className="bb flex flex-col gap-4">
          {panel}
          <Button size="lg" onClick={() => window.location.reload()}>
            {COPY.board.demoAgain}
          </Button>
        </section>
      );
    }
    return (
      <section className="bb flex flex-col gap-5">
        {panel}
        {sealArmed ? (
          <div className="flex flex-col gap-3">
            {/* PID §8.6 — above the confirm, always. */}
            <p className="text-[15px] font-semibold leading-6 text-ink">{COPY.pool.decisionsFinal}</p>
            <Button size="lg" onClick={() => send({ type: 'confirm' })}>
              {COPY.battle.sealConfirm}
            </Button>
            <Button intent="quiet" onClick={() => setSealArmed(false)}>
              {COPY.battle.sealCancel}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-5 text-ink-muted">{COPY.pool.decisionsFinal}</p>
            <Button size="lg" onClick={() => setSealArmed(true)}>
              {COPY.battle.seal}
            </Button>
          </div>
        )}
      </section>
    );
  }

  /* ——— Confirmed: the parent owns the seal; this holds the screen. ——— */
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-6 py-14">
      <p className="animate-rise text-[15px] text-ink-muted">{COPY.battle.sealing}</p>
    </section>
  );
}
