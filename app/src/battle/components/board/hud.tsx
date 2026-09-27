'use client';

/*
 * The board's HUD pieces in the mockup's chrome: the clock plaque, the
 * progress readout, the mode badge, the hint line and the ready banner.
 *
 * THE TIMER IS CALM. The clock plaque is never red, never pulses and takes
 * no colour props: the absence of an urgency cue is part of the §8.7
 * posture, not a styling gap (the rule the dial run's <Timer /> stated,
 * carried over when that component was removed on 2026-09-24). The
 * mockup's red "warn" state is NOT carried over. The last ten seconds are
 * marked by the hint line's sentence, not by colour.
 */

import { useState } from 'react';
import { formatClock } from '@/battle/run-clock';
import { type BoardPlayState, boardRemaining, fieldFull } from '@/battle/board/machine';
import { type BoardMode, BOARD_CLOCK_BUDGET_MS, FIELDS, HARD_TOTAL } from '@/battle/board/mode';
import { COPY } from '@/copy';

export function TimerCard({ remainingMs, started }: { remainingMs: number; started: boolean }) {
  return (
    <div className="bb-card" role="timer" aria-label={started ? COPY.board.timerAria(formatClock(remainingMs)) : COPY.board.timerHeldAria}>
      <span className="bb-card-label">{started ? COPY.board.timeLeft : COPY.board.timerHeld}</span>
      <span className={'bb-timer' + (started ? '' : ' bb-timer--held')}>{formatClock(remainingMs)}</span>
    </div>
  );
}

export function ModeBadge({ mode }: { mode: BoardMode }) {
  return <span className={'bb-pill bb-pill--' + mode}>{mode === 'easy' ? COPY.board.modeEasy : COPY.board.modeHard}</span>;
}

export function ProgressReadout({ state }: { state: Pick<BoardPlayState, 'grid' | 'mode' | 'locked'> }) {
  const lockedN = state.locked.filter(Boolean).length;
  if (state.mode === 'easy') {
    let full = 0;
    for (let f = 0; f < FIELDS; f++) if (fieldFull(state, f)) full++;
    return <p className="bb-readout">{COPY.board.readoutEasy(full, lockedN)}</p>;
  }
  const left = boardRemaining(state);
  return (
    <div className="bb-card" style={{ padding: '8px 14px', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 800 }}>{COPY.board.readoutHard(left, lockedN)}</span>
      <div className="bb-bar" role="progressbar" aria-valuemin={0} aria-valuemax={HARD_TOTAL} aria-valuenow={HARD_TOTAL - left}>
        <i style={{ width: `${((HARD_TOTAL - left) / HARD_TOTAL) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * The hand key (founder 2026-09-24, second pass). Pressed, the board is in
 * grab mode: a drag moves the view and a tap on a field opens its stepper
 * for the troop in hand. Picking a troop card turns it off again.
 */
export function GrabKey({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={'bb-btn bb-grab' + (on ? ' bb-grab--on' : '')}
      aria-pressed={on}
      aria-label={COPY.board.grabAria}
      title={COPY.board.grabAria}
      onClick={onToggle}
      data-testid="board-grab"
    >
      <HandIcon />
      <span>{COPY.board.grab}</span>
    </button>
  );
}

/** An open hand, drawn inline so it matches the wood-outline chrome on every platform. */
function HandIcon() {
  return (
    <svg className="bb-grab-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M8.5 11.5V5.2a1.6 1.6 0 0 1 3.2 0v5.3M11.7 10.5V3.8a1.6 1.6 0 0 1 3.2 0v6.7M14.9 10.5V5.4a1.6 1.6 0 0 1 3.2 0v8.1c0 4-2.6 7-6.7 7-3.1 0-4.6-1.5-6.3-4.4L3 12.8a1.5 1.5 0 0 1 2.5-1.6l3 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Undo (V2, founder 2026-09-27; the co-founder's undo stack): one key that
 * takes back the last change — a whole hold, a stepper press, a clear.
 */
export function UndoKey({ depth, onUndo }: { depth: number; onUndo: () => void }) {
  return (
    <button
      type="button"
      className="bb-btn bb-undo"
      disabled={depth === 0}
      aria-label={COPY.board.undoAria}
      title={COPY.board.undoAria}
      onClick={onUndo}
      data-testid="board-undo"
    >
      <span aria-hidden="true">↶</span>
      <span>{COPY.board.undo}</span>
    </button>
  );
}

/**
 * The bin (V2, bulk clearing): sends every troop on every unlocked field
 * back. Asks once, inline, and never acts on a single tap.
 */
export function ClearBoardKey({ disabled, onClear }: { disabled: boolean; onClear: () => void }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="bb-confirm" role="alertdialog" aria-label={COPY.board.clearBoardConfirm} data-testid="board-clear-confirm">
        <span>{COPY.board.clearBoardConfirm}</span>
        <button
          type="button"
          className="bb-btn bb-btn--danger"
          onClick={() => {
            setAsking(false);
            onClear();
          }}
          data-testid="board-clear-yes"
        >
          {COPY.board.yes}
        </button>
        <button type="button" className="bb-btn" onClick={() => setAsking(false)} data-testid="board-clear-no">
          {COPY.board.no}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="bb-btn bb-bin"
      disabled={disabled}
      aria-label={COPY.board.clearBoardAria}
      title={COPY.board.clearBoardAria}
      onClick={() => setAsking(true)}
      data-testid="board-clear"
    >
      <BinIcon />
    </button>
  );
}

function BinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HintLine({ text }: { text: string }) {
  return (
    <p className="bb-hint" aria-live="polite">
      {text}
    </p>
  );
}

export function ReadyBanner({ mode, onDismiss, onGuide }: { mode: BoardMode; onDismiss: () => void; onGuide: () => void }) {
  return (
    <div className="bb-banner-scrim">
      <div className="bb-banner" role="dialog" aria-labelledby="bb-banner-title">
        <span className="bb-card-label" id="bb-banner-title">
          {COPY.board.bannerTitle}
        </span>
        <span className="bb-timer">3:00</span>
        <p>{mode === 'easy' ? COPY.board.bannerEasy : COPY.board.bannerHard}</p>
        <p>{COPY.board.bannerLooking}</p>
        <button type="button" className="bb-btn bb-btn--primary" onClick={onDismiss} data-testid="board-begin">
          {COPY.board.bannerGo}
        </button>
        {/* V2 (founder 2026-09-27): the nine-step walkthrough, with the clock held. */}
        <button type="button" className="bb-btn" onClick={onGuide} data-testid="board-guide">
          {COPY.board.guideKey}
        </button>
      </div>
    </div>
  );
}

/**
 * THE WALKTHROUGH (V2, founder 2026-09-27; the co-founder's nine steps).
 * Nine cards over the live board with the clock held. Four of them wait
 * for the player's own move — arm a troop, hold on Field 1, open a crowd's
 * controls, send some back — and the flow advances them from its handlers;
 * the rest have Next. The last has Back and "Start building", which
 * empties the practice board and hands over.
 */
export function BoardGuide({
  mode,
  step,
  onNext,
  onBack,
  onSkip,
  onStart,
}: {
  mode: BoardMode;
  /** 1-based. */
  step: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onStart: () => void;
}) {
  const steps = COPY.board.guide(mode, BOARD_CLOCK_BUDGET_MS / 60_000);
  const total = steps.length;
  const card = steps[step - 1] ?? steps[0]!;
  const last = step === total;
  // At the foot of the stage while the card talks about Field 1 (top of
  // the map); at the head once the stepper is open at the foot (step 7 on).
  const top = step >= 7;
  return (
    <div className={'bb-guide' + (top ? ' bb-guide--top' : '')} role="dialog" aria-labelledby="bb-guide-title" data-testid="board-guide-card" data-step={step}>
      <span className="bb-card-label">{COPY.board.guideStep(step, total)}</span>
      <h3 id="bb-guide-title">{card.title}</h3>
      <p>{card.body}</p>
      <div className="bb-guide-keys">
        {step > 1 ? (
          <button type="button" className="bb-btn bb-btn--ghost" onClick={onBack} data-testid="guide-back">
            {COPY.board.guideBack}
          </button>
        ) : null}
        {!last ? (
          <button type="button" className="bb-btn bb-btn--ghost" onClick={onSkip} data-testid="guide-skip">
            {COPY.board.guideSkip}
          </button>
        ) : null}
        {card.waits ? (
          <span className="bb-guide-wait" aria-live="polite">
            {COPY.board.guideWaiting}
          </span>
        ) : last ? (
          <button type="button" className="bb-btn bb-btn--primary" onClick={onStart} data-testid="guide-start">
            {COPY.board.guideStart}
          </button>
        ) : (
          <button type="button" className="bb-btn bb-btn--primary" onClick={onNext} data-testid="guide-next">
            {COPY.board.guideNext}
          </button>
        )}
      </div>
    </div>
  );
}
