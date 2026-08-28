/*
 * Card. Neutral surfaces get DEPTH (elevation), never glow — glow belongs
 * to the two accents. `live` marks the one card on a screen that represents
 * a running tournament: a brand hairline on its top edge, static. The old
 * perpetual light sweep was idle motion — the grammar forbids it (nothing
 * loops at rest); liveness is now expressed by the seat ring's WARMTH,
 * which scales with real occupancy. At most one live card per screen.
 */
import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** The screen's live fixture — signature treatment, use once per screen. */
  live?: boolean;
  children: ReactNode;
}

export function Card({ live = false, className = "", children, ...rest }: CardProps) {
  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl bg-raised " +
        (live ? "border border-brand/40 " : "border border-line ") +
        className
      }
      style={{ boxShadow: "var(--elevation-card)" }}
      {...rest}
    >
      {live ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-hot/70 to-transparent"
        />
      ) : null}
      {children}
    </div>
  );
}
