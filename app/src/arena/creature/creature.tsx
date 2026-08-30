/*
 * The radar-creature — ONE component for every surface that draws a
 * character (builder preview, team review, matchup thumbnails, the battle
 * stage), the pass-shell posture: a single implementation so the art
 * language cannot drift.
 *
 * Colour: brand-family via the pass shell's color-mix recipe by default;
 * where the OWNER's cosmetic class is known the tint walks through the one
 * door (src/reveal/class-colour.ts `classColorToken`) — cosmetic only, the
 * exact thing the class exists for (PID §8.4). Gradients are
 * id-parameterized (`uid`) because SVG ids are document-global.
 *
 * Static on purpose: no animation lives here. Surfaces that move a creature
 * animate a WRAPPER (the battle stage's lunge, the builder's settle) so this
 * stays reusable in fully static contexts (lists, review cards).
 */

import type { Allocation } from '@/battle/allocation';
import { classColorToken } from '@/reveal/class-colour';
import type { RevealClass } from '@/reveal/types';
import { CREATURE_VIEWBOX, creatureSpec } from './creature-geometry';

export interface CreatureProps {
  allocation: Allocation;
  /** De-collides gradient ids across instances. */
  uid: string;
  /** Owner's cosmetic class when known (post-entry); brand violet otherwise. */
  classIndex?: RevealClass | null;
  /** Mirror to face an opponent. */
  facing?: 'left' | 'right';
  className?: string;
  /** Accessible name; aria-hidden when omitted. */
  label?: string;
}

export function Creature({
  allocation,
  uid,
  classIndex = null,
  facing = 'right',
  className,
  label,
}: CreatureProps) {
  const spec = creatureSpec(allocation);
  const bodyId = `creature-body-${uid}`;
  const tint = classIndex !== null ? classColorToken(classIndex) : 'var(--color-brand)';
  return (
    <svg
      viewBox={`0 0 ${CREATURE_VIEWBOX} ${CREATURE_VIEWBOX}`}
      className={className}
      aria-hidden={label === undefined || undefined}
      aria-label={label}
      role={label !== undefined ? 'img' : undefined}
      style={{ ['--creature-tint' as string]: tint }}
    >
      <defs>
        <radialGradient id={bodyId} cx="38%" cy="30%" r="80%">
          <stop
            offset="0%"
            style={{ stopColor: 'color-mix(in srgb, var(--creature-tint) 52%, var(--color-base))' }}
          />
          <stop
            offset="55%"
            style={{ stopColor: 'color-mix(in srgb, var(--creature-tint) 30%, var(--color-base))' }}
          />
          <stop
            offset="100%"
            style={{ stopColor: 'color-mix(in srgb, var(--creature-tint) 16%, var(--color-base))' }}
          />
        </radialGradient>
      </defs>
      <g transform={facing === 'left' ? `scale(-1 1) translate(-${CREATURE_VIEWBOX} 0)` : undefined}>
        {/* Heart: the soft core glow — a wide low-opacity fill, no filters
            (the reveal's WebKit frame-cost lesson). */}
        <circle
          cx={spec.glow.cx}
          cy={spec.glow.cy}
          r={spec.glow.r}
          fill="var(--creature-tint)"
          opacity={0.18}
        />
        {/* Strength: crown horns. */}
        {spec.horns.map((h, i) => (
          <polygon key={`h${i}`} points={h.points} fill="var(--creature-tint)" opacity={0.85} />
        ))}
        {/* Speed: swept fins. */}
        {spec.fins.map((s, i) => (
          <polygon key={`f${i}`} points={s.points} fill="var(--creature-tint)" opacity={0.6} />
        ))}
        {/* Wit: antennae. */}
        {spec.antennae.map((a, i) => (
          <g key={`a${i}`}>
            <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="var(--creature-tint)" strokeWidth={1.5} />
            <circle cx={a.x2} cy={a.y2} r={a.tipR} fill="var(--creature-tint)" />
          </g>
        ))}
        {/* The body — the allocation itself. Durability is the rim. */}
        <path
          d={spec.bodyPath}
          fill={`url(#${bodyId})`}
          stroke="var(--creature-tint)"
          strokeWidth={spec.rimWidth}
          strokeLinejoin="round"
        />
        {/* Heart: the eyes. */}
        {spec.eyes.map((e, i) => (
          <g key={`e${i}`}>
            <circle cx={e.cx} cy={e.cy} r={e.r} fill="var(--color-ink)" />
            <circle cx={e.cx} cy={e.cy} r={Math.max(0.8, e.r * 0.45)} fill="var(--color-base)" />
          </g>
        ))}
      </g>
    </svg>
  );
}
