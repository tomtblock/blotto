/*
 * Frost (UI constitution PART 5.5) — the FROST grammar word as a component:
 * a commitment sealed. Encrypted, final, unreadable — by anyone, operator
 * included. The frosted object is visibly PRESENT but unreadable.
 *
 * Mechanics: the child renders twice. The sharp copy is the readable
 * object; the veil copy sits above it, pre-blurred (a STATIC filter — the
 * blur itself never animates) under a crystalline gradient texture. The
 * seal condenses by crossfading the two layers' opacity over 400ms
 * ease-in-out (.frost-sharp / .frost-veil in tokens.css). De-frost is FROST
 * reversed — and the CALLER's duty is simultaneity: every object in a pool
 * de-frosts at the same instant, driven by one state change, never
 * staggered. Simultaneity is the fairness made visible.
 *
 * Accessibility: a frosted object really is unreadable — the sharp copy is
 * aria-hidden and inert while sealed, and a visually-hidden line says what
 * a sighted player sees. Reduced motion: the global collapse makes the
 * crossfade an instant toggle; the sealed/unsealed STATES are always
 * legible without motion.
 *
 * FROST is the only blur on the site. Do not use this component (or any
 * blur) decoratively — the metaphor dies.
 */
import type { ReactNode } from 'react';
import { COPY } from '@/copy';

export interface FrostProps {
  frosted: boolean;
  children: ReactNode;
  className?: string;
  /** Override the sealed screen-reader line (defaults to COPY.sealedObject). */
  sealedLabel?: string;
}

export function Frost({ frosted, children, className = '', sealedLabel }: FrostProps) {
  return (
    <div data-frosted={frosted ? 'true' : 'false'} className={`relative ${className}`}>
      <div className="frost-sharp" aria-hidden={frosted} inert={frosted}>
        {children}
      </div>
      <div className="frost-veil pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden="true">
        <div className="frost-blur h-full w-full">{children}</div>
        <div className="frost-crystal" />
      </div>
      {frosted ? <span className="sr-only">{sealedLabel ?? COPY.sealedObject}</span> : null}
    </div>
  );
}
