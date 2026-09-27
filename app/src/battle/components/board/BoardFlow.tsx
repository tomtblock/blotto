'use client';

/*
 * The BOARD run (founder brief 2026-09-24) — the entry session the play
 * page mounts, and the landing page's demo. It never sees a wallet: sealing
 * happens outside via `onConfirm`. ONE key seals (V2, founder 2026-09-27:
 * the two-step arm-then-confirm and the seal-stage scene that hosted it are
 * gone). V3 (founder, the same day): a FULL board seals straight from the
 * board — its key glows and says "Confirm, Sign & Seal", and there is no
 * review page in between; the review remains for an early submit and for
 * the buzzer, where the same key is already focused so the player's next
 * press is the seal. The seven-screen dial run this replaced was removed
 * on 2026-09-24.
 *
 * Ready → board (the machine, src/battle/board/machine.ts) → (review →)
 * confirmed. The reducer owns every rule; this component feeds ticks and
 * the arena's gestures and renders state. The arena itself (arena/) is the
 * founder's mockup — painted map, sprite crowds, camera, deploy curve —
 * carried over and wired to the reducer.
 *
 * The run clock is sampled against performance.now() (audit 2026-09-11
 * F-04): elapsed time, not timer firings, integer milliseconds with the
 * remainder carried.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { STAT_NAMES, type Allocation } from '@/battle/allocation';
import {
  type BoardEvent,
  type BoardPlayState,
  type BoardReviewState,
  boardComplete,
  boardRemaining,
  fieldRemaining,
  initialBoardState,
  reduceBoard,
} from '@/battle/board/machine';
import { type BoardMode, EASY_PER_FIELD, HARD_TOTAL } from '@/battle/board/mode';
import { sampleTick } from '@/battle/run-clock';
import type { Grid } from '@/battle/board/spread';
import { Arena } from './arena/Arena';
import { BoardGuide, ClearBoardKey, GrabKey, HintLine, ModeBadge, ProgressReadout, ReadyBanner, TimerCard, UndoKey } from './hud';
import { ReviewPanel } from './ReviewPanel';
import { Stepper } from './Stepper';
import { TroopTray } from './TroopTray';
import './board.css';

const TICK_MS = 100;
const LAST_SECONDS_MS = 10_000;

export interface BoardFlowProps {
  mode: BoardMode;
  onConfirm: (battles: readonly Allocation[], timingsMs: readonly number[]) => void;
  onRunStarted?: () => void;
  /** Demo mode (the landing page): no seal, no leave guard; the review offers "Try again". */
  demo?: boolean;
}

/**
 * The board's rows are Allocations by construction; say so to the type
 * system, checked against the MODE's rule (Phase B): every easy field sums to
 * 100; a hard board sums to 700 across its thirty-five cells. The sealing
 * package checks the same rule again at the encoder — this is the earlier,
 * louder failure.
 */
function toAllocations(battles: readonly (readonly number[])[], mode: BoardMode): Allocation[] {
  let total = 0;
  const rows = battles.map((row) => {
    if (row.length !== 5) throw new Error('board produced a battle without five stats');
    const sum = row.reduce((a, b) => a + b, 0);
    if (mode === 'easy' && sum !== EASY_PER_FIELD) {
      throw new Error('board produced a battle that is not an easy-mode allocation');
    }
    total += sum;
    return [row[0] as number, row[1] as number, row[2] as number, row[3] as number, row[4] as number] as const;
  });
  if (mode === 'hard' && total !== HARD_TOTAL) {
    throw new Error('board produced a hard board that does not place exactly 700');
  }
  return rows;
}

export function BoardFlow({ mode, onConfirm, onRunStarted, demo = false }: BoardFlowProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduceBoard, mode, (m) => initialBoardState(m));
  const [openField, setOpenField] = useState<number | null>(null);
  const [holdField, setHoldField] = useState<number | null>(null);
  /* Grab mode (the hand key): the troop stays in hand, the gesture is
   * disarmed, a tap on a field opens its stepper. Picking a card ends it. */
  const [grab, setGrab] = useState(false);
  const [leaveSheet, setLeaveSheet] = useState(false);
  const confirmed = useRef(false);
  /* UNDO (V2, founder 2026-09-27; the co-founder's undo stack): the grids
   * before each change. A whole hold is one step; a stepper press, a tap
   * and a clear are one each. `restore` in the reducer keeps locked fields. */
  const [undoStack, setUndoStack] = useState<Grid[]>([]);
  const holdSnap = useRef<Grid | null>(null);
  /* THE WALKTHROUGH (V2): the step on screen, or null. The clock is held
   * while it runs, and "Start building" restarts the board empty. */
  const [guideStep, setGuideStep] = useState<number | null>(null);
  /* The seal key, focused the moment the review appears — so the buzzer's
   * review needs one press (Enter, or the key itself) to seal. */
  const sealKey = useRef<HTMLButtonElement>(null);
  /* The review as sealed, kept so the confirmed phase can show the entry's
   * record under the signing hold rather than a bare sentence. Set by the
   * seal key's own handler, which has the review in hand. */
  const [record, setRecord] = useState<BoardReviewState | null>(null);

  const play = state.phase === 'play' ? state : null;
  const review = state.phase === 'review' ? state : null;

  // The arena's listeners are attached once and read the latest play state here.
  const playRef = useRef<BoardPlayState | null>(play);
  useEffect(() => {
    playRef.current = play;
  }, [play]);

  const inReview = review !== null && !demo;
  useEffect(() => {
    if (inReview) sealKey.current?.focus();
  }, [inReview]);

  /* The run clock — elapsed time against performance.now(). Held during
   * the walkthrough (its board is thrown away at the end). */
  const ticking = play !== null && play.clockStarted && guideStep === null;
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

  /* Confirmed: hand the entry out once, under the board's own mode. */
  useEffect(() => {
    if (state.phase !== 'confirmed' || confirmed.current || demo) return;
    confirmed.current = true;
    onConfirm(toAllocations(state.battles, mode), state.timingsMs);
  }, [state, onConfirm, demo, mode]);

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

  /* One undo step: the grid as it is before the change about to be made. */
  const snapshot = useCallback(() => {
    const s = playRef.current;
    if (s) setUndoStack((h) => [...h, s.grid]);
  }, []);
  /* A hold is one step: snapshot at the first field the finger reaches,
   * kept only if the grid changed by the time it lifts. */
  const onHoldChange = useCallback((field: number | null) => {
    setHoldField(field);
    const s = playRef.current;
    if (field !== null && holdSnap.current === null && s) holdSnap.current = s.grid;
    if (field === null && holdSnap.current !== null) {
      const before = holdSnap.current;
      holdSnap.current = null;
      if (s && s.grid !== before) setUndoStack((h) => [...h, before]);
    }
  }, []);
  const undo = useCallback(() => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    dispatch({ type: 'restore', grid: prev });
    setUndoStack((h) => h.slice(0, -1));
  }, [undoStack]);

  /* The deploy curve asks for `n`; the reducer takes what fits. We report
   * that number back so the gesture can say "full" — the reducer clips
   * again regardless. A tap (no hold open) is its own undo step. */
  const onDeposit = useCallback(
    (field: number, stat: number, n: number): number => {
      const s = playRef.current;
      if (!s || s.locked[field]) return 0;
      const placed = Math.min(n, fieldRemaining(s, field));
      if (placed > 0) {
        if (holdSnap.current === null) snapshot();
        dispatch({ type: 'place', field, stat, delta: placed });
        setGuideStep((g) => (g === 4 ? 5 : g));
      }
      return placed;
    },
    [snapshot]
  );
  const onOpenStepper = useCallback((field: number, stat: number | null) => {
    if (stat !== null) dispatch({ type: 'select', stat });
    setOpenField(field);
    setGuideStep((g) => (g === 6 ? 7 : g));
  }, []);
  const onTapEmpty = useCallback(() => setOpenField(null), []);
  const selectTroop = useCallback((stat: number | null) => {
    if (stat !== null) setGrab(false);
    dispatch({ type: 'select', stat });
    if (stat !== null) setGuideStep((g) => (g === 3 ? 4 : g));
  }, []);
  /* A step back of any kind satisfies the walkthrough's seventh step. */
  const tookBack = useCallback(() => setGuideStep((g) => (g === 7 ? 8 : g)), []);

  /* The walkthrough: begins the board with the clock held; ends on a fresh one. */
  const startGuide = useCallback(() => {
    dispatch({ type: 'begin' });
    setGuideStep(1);
    onRunStarted?.();
  }, [onRunStarted]);
  const endGuide = useCallback(() => {
    dispatch({ type: 'restart' });
    setUndoStack([]);
    holdSnap.current = null;
    setOpenField(null);
    setGrab(false);
    setGuideStep(null);
  }, []);

  /* ——— Ready: the banner over an idle arena. ——— */
  if (state.phase === 'ready') {
    const idle = reduceBoard(state, { type: 'begin' });
    if (idle.phase !== 'play') return null;
    return (
      <section className={`bb animate-settle${demo ? '' : ' bb--wide'}`}>
        <div style={{ position: 'relative' }}>
          <Arena state={idle} interactive={false} onDeposit={() => 0} onOpenStepper={() => {}} onTapEmpty={() => {}} onHold={() => {}} demo={demo} />
          <ReadyBanner
            mode={mode}
            onDismiss={() => {
              dispatch({ type: 'begin' });
              onRunStarted?.();
            }}
            onGuide={startGuide}
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
      <section className={`bb${demo ? '' : ' bb--wide'}`}>
        <div style={{ position: 'relative' }}>
          <Arena
            state={play}
            interactive={stepperField === null}
            grab={grab}
            onDeposit={onDeposit}
            onOpenStepper={onOpenStepper}
            onTapEmpty={onTapEmpty}
            onHold={onHoldChange}
            highlightField={guideStep === 2 || guideStep === 4 || guideStep === 6 ? 0 : null}
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
                <button type="button" className="bb-btn bb-leave" onClick={() => setLeaveSheet(true)}>
                  {COPY.board.leave}
                </button>
              )}
            </div>
            {/* V2: Undo and the bin on the right, clear of Field 1 under the HUD. */}
            <div className="bb-hud-right">
              <UndoKey depth={undoStack.length} onUndo={undo} />
              <ClearBoardKey
                disabled={boardRemaining(play) === (play.mode === 'easy' ? EASY_PER_FIELD * 7 : HARD_TOTAL)}
                onClear={() => {
                  snapshot();
                  setOpenField(null);
                  send({ type: 'clear_board' });
                  tookBack();
                }}
              />
            </div>
          </div>
          {guideStep !== null && (
            <BoardGuide
              mode={play.mode}
              step={guideStep}
              onNext={() => setGuideStep((g) => (g === null ? null : g + 1))}
              onBack={() => setGuideStep((g) => (g === null ? null : Math.max(1, g - 1)))}
              onSkip={endGuide}
              onStart={endGuide}
            />
          )}
          {stepperField !== null && (
            <Stepper
              state={play}
              field={stepperField}
              onPlace={(field, stat, delta) => {
                snapshot();
                send({ type: 'place', field, stat, delta });
                if (delta < 0) tookBack();
              }}
              onFill={(field, stat) => {
                snapshot();
                send({ type: 'fill_field', field, stat });
              }}
              onSendBack={(field, stat) => {
                snapshot();
                send({ type: 'send_back', field, stat });
                tookBack();
              }}
              onClearField={(field) => {
                snapshot();
                send({ type: 'clear_field', field });
                tookBack();
              }}
              onLock={(field) => send({ type: 'lock', field })}
              onUnlock={(field) => send({ type: 'unlock', field })}
              onSelect={(stat) => send({ type: 'select', stat })}
              onClose={() => setOpenField(null)}
            />
          )}
        </div>
        <HintLine text={hint} />
        <TroopTray state={play} onSelect={selectTroop} />
        {play.clockStarted && guideStep === null && (complete && !demo ? (
          /* V3: the full board's own seal key — §8.6 above it, always. The
             review state is taken from the reducer for the record under the
             signing hold, then submit and confirm go through as one press. */
          <div className="flex flex-col items-center gap-3">
            <p className="text-center text-[14px] font-semibold leading-5 text-ink">{COPY.pool.decisionsFinal}</p>
            <button
              type="button"
              className="bb-btn bb-btn--commit bb-btn--seal"
              onClick={() => {
                setOpenField(null);
                const reviewed = reduceBoard(play, { type: 'submit' });
                if (reviewed.phase === 'review') setRecord(reviewed);
                send({ type: 'submit' });
                send({ type: 'confirm' });
              }}
              data-testid="board-seal"
            >
              {COPY.battle.seal}
            </button>
          </div>
        ) : (
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
        ))}

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
    const panel = (
      <ReviewPanel
        review={review}
        onResume={() => {
          setOpenField(null);
          send({ type: 'resume' });
        }}
      />
    );
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
        <div className="flex flex-col gap-3">
          {/* PID §8.6 — above the confirm, always. Do not move it below. */}
          <p className="text-[15px] font-semibold leading-6 text-ink">{COPY.pool.decisionsFinal}</p>
          {/* One step (V2): confirm, seal and submit. The wallet's own
              prompts are the second look; the key is focused on arrival. */}
          <Button
            ref={sealKey}
            size="lg"
            // The one commit key on the pink field: a cream rim so it reads
            // on pink, taller than the tray's keys.
            className="h-16 border-[3px] border-brand-cream text-[20px] shadow-[var(--elevation-key-action)]"
            onClick={() => {
              setRecord(review);
              send({ type: 'confirm' });
            }}
            data-testid="seal-confirm"
          >
            {COPY.battle.seal}
          </Button>
        </div>
      </section>
    );
  }

  /* ——— Confirmed: the parent owns the seal and draws the signing hold over
     this — the entry's record, dimmed, and one line. ——— */
  return (
    <section aria-live="polite" className="bb flex flex-col gap-4" data-testid="board-sealing">
      {record ? (
        <div aria-hidden="true" className="pointer-events-none opacity-60">
          <ReviewPanel review={record} />
        </div>
      ) : null}
      <p className="animate-rise text-center text-[15px] text-ink-muted">{COPY.battle.sealing}</p>
    </section>
  );
}
