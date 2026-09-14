/*
 * Pill (2026-09-13): a state chip in the candy idiom — an inflated capsule
 * with a lit rim. Tones name a STATE, never a colour: `open` is the one
 * pink object a plum card may carry (the two-layer rule), `resolving`
 * wears the coral accent, `muted` and `ink` are quiet. There is no prize
 * tone on purpose — prize yellow is for amounts a player is paid, and a
 * chip is never that.
 */
import type { ReactNode } from "react";

type Tone = "open" | "resolving" | "muted" | "ink";

const TONE: Record<Tone, string> = {
  open: "border-brand/60 bg-brand/12 text-brand",
  resolving: "border-brand-coral/60 bg-brand-coral/10 text-brand-coral",
  muted: "border-white/15 text-ink-muted",
  ink: "border-white/25 text-ink",
};

export function Pill({
  tone = "muted",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] " +
        "uppercase tracking-[0.1em] shadow-[inset_0_1px_0_rgba(255,246,236,0.14)] " +
        `${TONE[tone]} ${className}`
      }
    >
      {children}
    </span>
  );
}
