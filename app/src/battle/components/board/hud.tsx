'use client';

/*
 * The board's HUD pieces in the mockup's chrome: the clock plaque, the
 * progress readout, the mode badge, the hint line and the ready banner.
 *
 * THE TIMER IS CALM. The dial run's <Timer /> (components/blot/Timer.tsx)
 * is never red and never pulses, and states why: the absence of an urgency
 * cue is part of the §8.7 posture, not a styling gap. The board's plaque
 * keeps that rule — the mockup's red "warn" state is NOT carried over. The
 * last ten seconds are marked by the hint line's sentence, not by colour.
 */

import { formatClock } from '@/battle/run-clock';
import { type BoardPlayState, boardRemaining, fieldFull } from '@/battle/board/machine';
import { type BoardMode, FIELDS, HARD_TOTAL } from '@/battle/board/mode';
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

export function HintLine({ text }: { text: string }) {
  return (
    <p className="bb-hint" aria-live="polite">
      {text}
    </p>
  );
}

export function ReadyBanner({ mode, onDismiss }: { mode: BoardMode; onDismiss: () => void }) {
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
      </div>
    </div>
  );
}
