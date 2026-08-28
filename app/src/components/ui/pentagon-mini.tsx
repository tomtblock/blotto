/*
 * PentagonMini (UI constitution PART 5.4) — the allocation shape at small
 * sizes: progress dots, review cards, the profile film room, the fair-play
 * explainer. Static by design: the full instrument (drag, charge feedback,
 * live normalisation) lives in battle/components/pentagon-radar.tsx; this
 * is only the shape.
 *
 * Pentagon neutrality (hard constraint 4): this component renders whatever
 * allocation it is GIVEN and never suggests one — no default shape, no
 * highlighted vertices, no snap grid. Callers own what is shown; the
 * demonstrated allocations in explainers must be unremarkable and varied.
 *
 * Frosting a mini pentagon (a sealed battle) is the caller's job via
 * <Frost> — one seal metaphor, one component.
 */
import { AXES, axisUnit, pointFor, polygonPoints } from '@/battle/geometry';
import type { Allocation } from '@/battle/allocation';

const VB = 100;
const C = VB / 2;
const R = 40;

const GRID = [0.5, 1].map((f) =>
  polygonPoints([100 * f, 100 * f, 100 * f, 100 * f, 100 * f], R, C, C)
);

const AXIS_ENDS = Array.from({ length: AXES }, (_, i) => {
  const u = axisUnit(i);
  return [C + u.x * R, C + u.y * R] as const;
});

export interface PentagonMiniProps {
  allocation: Allocation;
  /** Rendered size in px. */
  size?: number;
  /** Stroke/fill hue; defaults to the action accent. */
  tone?: 'brand' | 'ink';
  /** Winning stats to carry the LIGHT treatment (film room), by index. */
  litStats?: readonly number[];
  className?: string;
  /** Accessible description; defaults to the five values. */
  label?: string;
}

export function PentagonMini({
  allocation,
  size = 48,
  tone = 'brand',
  litStats,
  className = '',
  label,
}: PentagonMiniProps) {
  const stroke = tone === 'brand' ? 'var(--color-brand)' : 'var(--color-ink-muted)';
  const fill =
    tone === 'brand'
      ? 'color-mix(in srgb, var(--color-brand) 20%, transparent)'
      : 'color-mix(in srgb, var(--color-ink-muted) 14%, transparent)';

  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      role="img"
      aria-label={label ?? allocation.join('-')}
      className={className}
    >
      {GRID.map((points, i) => (
        <polygon key={i} points={points} fill="none" stroke="var(--color-line)" strokeWidth="1" />
      ))}
      {AXIS_ENDS.map(([x, y], i) => (
        <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="var(--color-line)" strokeWidth="1" />
      ))}
      <polygon
        points={polygonPoints(allocation, R, C, C)}
        fill={fill}
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {litStats?.map((i) => {
        const p = pointFor(allocation[i], i, R);
        return <circle key={i} cx={C + p.x} cy={C + p.y} r="4" fill="var(--color-brand-hot)" />;
      })}
    </svg>
  );
}
