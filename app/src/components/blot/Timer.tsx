'use client';

/*
 * <Timer /> — the 90-second run clock's face (architect brief §5): a CALM
 * SLATE RING with cream text. Never red, never pulsing, no ticking sound,
 * no colour change as time runs out — the absence of any urgency cue is a
 * legal-position feature (§8.7 posture), not a styling gap, so it is
 * enforced here by construction: this component has no error colour, no
 * animation, and takes no colour props.
 *
 * Before the first dial touch it shows the full budget with the label
 * "starts on first drag" — the clock is a property of the RUN
 * (src/battle/run-clock.ts), started by the first interaction, never by
 * payment confirmation.
 *
 * The seven thin ticks are the advisory per-battle guide (~13 s each);
 * they are marks on the ring, not deadlines.
 */

import { palette } from '@/design/tokens';
import { formatClock } from '@/battle/run-clock';

export interface TimerProps {
  remainingMs: number;
  budgetMs: number;
  /** False until the first dial interaction of the run. */
  started: boolean;
  /** Ring diameter in CSS px. */
  size?: number;
}

export function Timer({ remainingMs, budgetMs, started, size = 96 }: TimerProps) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const frac = budgetMs > 0 ? Math.max(0, Math.min(1, remainingMs / budgetMs)) : 0;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={started ? `${formatClock(remainingMs)} remaining` : 'Clock starts on first drag'}
    >
      <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
        {/* Track. */}
        <circle cx="48" cy="48" r={r} fill="none" stroke={palette.gameSlate} strokeOpacity="0.3" strokeWidth="6" />
        {/* Advisory per-battle ticks (7 segments). */}
        {Array.from({ length: 7 }, (_, i) => {
          const a = (i / 7) * 2 * Math.PI - Math.PI / 2;
          const x1 = 48 + Math.cos(a) * (r - 4);
          const y1 = 48 + Math.sin(a) * (r - 4);
          const x2 = 48 + Math.cos(a) * (r + 4);
          const y2 = 48 + Math.sin(a) * (r + 4);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={palette.gameSlate}
              strokeOpacity="0.5"
              strokeWidth="1.5"
            />
          );
        })}
        {/* Remaining time — always slate, by construction. */}
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={palette.gameSlate}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 48 48)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum font-display text-[22px] font-bold leading-none text-game-ink">
          {formatClock(started ? remainingMs : budgetMs)}
        </span>
        {!started && (
          <span className="mt-0.5 max-w-[72px] text-center font-mono text-[8px] uppercase leading-tight tracking-wide text-game-ink-muted">
            starts on first drag
          </span>
        )}
      </div>
    </div>
  );
}
