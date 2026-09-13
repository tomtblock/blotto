/*
 * Card (D1, candy revision 2026-09-13). The plum surface every number, rule
 * and control sits on — now an inflated vinyl object rather than a flat
 * rectangle: a top-lit gradient, a cream rim where light catches the edge,
 * a berry shade along the underside and a soft berry drop (tokens.css,
 * `--elevation-candy`). The colour reservations are untouched — this is
 * light on a surface, not a new colour.
 *
 * `live` marks the one card on a screen that represents a running
 * tournament: it carries the signature light sweep on its top edge and a
 * brand rim. At most one live card per screen. `tone="light"` is the cream
 * pass surface (the share card, the welcome message) — brand layer, so ink
 * is berry there. `interactive` lifts on hover for cards that are links.
 */
import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** The screen's live fixture — signature treatment, use once per screen. */
  live?: boolean;
  /** Plum (game layer, default) or cream (brand layer). */
  tone?: "plum" | "light";
  /** Lifts on hover — for a card that is wrapped in a link. */
  interactive?: boolean;
  children: ReactNode;
}

const PLUM =
  "candy bg-[linear-gradient(180deg,var(--color-overlay)_0%,var(--color-raised)_38%,var(--color-base)_100%)] text-ink";
const LIGHT = "candy-light bg-brand-cream text-brand-berry";

export function Card({
  live = false,
  tone = "plum",
  interactive = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  const rim =
    tone === "light"
      ? "border border-white/70"
      : live
        ? "border border-brand/50"
        : "border border-white/10";
  return (
    <div
      className={
        "candy-gloss relative overflow-hidden rounded-[24px] " +
        (tone === "light" ? LIGHT : PLUM) +
        " " +
        rim +
        (interactive ? " candy-interactive" : "") +
        " " +
        className
      }
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
