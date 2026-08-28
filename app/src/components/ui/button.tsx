/*
 * Button (UI constitution PART 5.2). Three tiers:
 *
 *   primary   — the consequential actions (Enter this tournament, Lock in,
 *               Claim). On hover, a soft interior brightness lift plus a
 *               faint edge glow that breathes in over 150ms and out over
 *               250ms — light arriving, not a spotlight snapping on. Never
 *               pulses at rest. Money-moving actions are ALWAYS primary,
 *               so the colour a player learns for "this spends" never
 *               varies.
 *   secondary — supporting actions (Even split, Full prize tables,
 *               Verify). Border and text brighten, background whispers in,
 *               no glow.
 *   tertiary  — link-shaped actions: the underline draws in left-to-right
 *               over 150ms (instantly on keyboard focus).
 *
 * Every tier presses to scale 0.98 (160ms ease-out) — feedback that the
 * interface heard the user. The motion lives in styles/components.css;
 * this file owns layout and colour only. Focus is the global LIGHT
 * outline from tokens.css — static, because keyboard actions never
 * animate.
 */
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Intent = "primary" | "secondary" | "tertiary";
type Size = "md" | "lg";

const INTENT: Record<Intent, string> = {
  // text-(--color-base): `text-base` is Tailwind's font-size utility, so the
  // surface colour must go through the var shorthand.
  primary:
    "btn btn-primary bg-brand text-(--color-base) font-semibold " +
    "active:bg-brand-deep disabled:bg-overlay disabled:text-ink-muted",
  secondary:
    "btn btn-secondary bg-transparent text-ink border border-line " +
    "hover:border-brand hover:text-brand hover:bg-overlay/40 " +
    "disabled:text-ink-muted disabled:hover:border-line disabled:hover:bg-transparent",
  tertiary: "btn link-draw text-brand disabled:text-ink-muted",
};

const SIZE: Record<Size, string> = {
  md: "h-11 px-5 text-[15px] rounded-lg",
  lg: "h-14 px-8 text-[17px] rounded-xl",
};

/* Tertiary is link-shaped: no box, no height. */
const TERTIARY_SIZE: Record<Size, string> = {
  md: "text-[15px]",
  lg: "text-[17px]",
};

/** The class string for a given tier — for anchor-shaped CTAs (`<a>`,
 * `<Link>`) that must look identical to the button. */
export function buttonClasses(intent: Intent = "primary", size: Size = "md"): string {
  const sizing = intent === "tertiary" ? TERTIARY_SIZE[size] : SIZE[size];
  return (
    "inline-flex items-center justify-center gap-2 select-none " +
    "disabled:cursor-not-allowed " +
    `${INTENT[intent]} ${sizing}`
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: Intent;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ intent = "primary", size = "md", className = "", ...rest }, ref) {
    return <button ref={ref} className={`${buttonClasses(intent, size)} ${className}`} {...rest} />;
  }
);
