/*
 * ProgressRing (D1): the arena's recurring motif — seats filled as a ring
 * around the fixture. Pure SVG, no animation library; the arc animates via
 * CSS transition on stroke-dashoffset (collapsed by reduced-motion).
 */
export interface ProgressRingProps {
  /** 0..total. */
  value: number;
  total: number;
  /** Diameter in px. */
  size?: number;
  /** Centre content defaults to "value/total" in the display face. */
  children?: React.ReactNode;
  /** Accessible description ("23 of 64 seats filled"). */
  label: string;
}

export function ProgressRing({ value, total, size = 96, children, label }: ProgressRingProps) {
  const stroke = Math.max(4, Math.round(size / 16));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;

  return (
    <div
      role="img"
      aria-label={label}
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-overlay)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - filled)}
          style={{ transition: "stroke-dashoffset 450ms var(--ease-snap)" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        {children ?? (
          <span className="tnum font-display text-[0.9rem] font-bold text-ink">
            {value}
            <span className="text-ink-muted">/{total}</span>
          </span>
        )}
      </span>
    </div>
  );
}
