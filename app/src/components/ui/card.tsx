/*
 * Card (D1). Neutral surfaces get DEPTH (elevation), never glow — glow
 * belongs to the two accents. `live` marks the one card on a screen that
 * represents a running tournament: it carries the signature light sweep on
 * its top edge and a brand hairline. At most one live card per screen.
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
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
          <div
            className="h-full w-1/3 bg-gradient-to-r from-transparent via-brand-hot to-transparent"
            style={{ animation: "light-sweep 3.2s var(--ease-glide) infinite" }}
          />
        </div>
      ) : null}
      {children}
    </div>
  );
}
