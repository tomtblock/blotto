/*
 * Button (D1, candy revision 2026-09-13). Three intents, one size scale.
 * The ACTION accent belongs to `primary` alone; `prize` exists only for
 * celebration-adjacent actions (viewing results, opening the share card)
 * and must never sit on a payment step — money-moving actions are always
 * `primary`, so the colour a player learns for "this spends" never varies.
 *
 * `cream` (round four A2, 2026-09-17) is the cream key (tokens.css
 * `.key-cream`): a key's thickness without the commit colour, for the
 * actions on a page that move no money — send, export, share, verify.
 *
 * Candy: every button is a pill, and the filled intents are KEYS — a
 * visible bottom edge is the object's thickness, and the button sinks onto
 * it when pressed (tokens.css `.key-action` / `.key-prize`). The large size
 * wears the display face, matching the landing page's Enter control, so a
 * commit looks the same everywhere it appears.
 */
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Intent = "primary" | "quiet" | "prize" | "cream";
type Size = "md" | "lg";

const INTENT: Record<Intent, string> = {
  // text-(--color-base): `text-base` is Tailwind's font-size utility, so the
  // surface colour must go through the var shorthand.
  primary:
    "key-action bg-brand text-(--color-base) font-semibold hover:bg-brand-hot " +
    "disabled:bg-overlay disabled:text-ink-muted",
  quiet:
    "bg-transparent text-ink border border-white/20 hover:border-brand hover:text-brand " +
    "disabled:text-ink-muted disabled:hover:border-white/20",
  prize:
    "key-prize bg-prize text-(--color-base) font-semibold hover:bg-prize-hot " +
    "disabled:bg-overlay disabled:text-ink-muted",
  cream: "key-cream font-semibold disabled:bg-overlay disabled:text-ink-muted",
};

const SIZE: Record<Size, string> = {
  md: "h-11 px-6 text-[15px] rounded-full",
  lg: "h-14 px-8 rounded-full font-display text-[18px] font-bold uppercase tracking-wide",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: Intent;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ intent = "primary", size = "md", className = "", ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={
          "inline-flex items-center justify-center gap-2 select-none " +
          "transition-colors duration-150 outline-none " +
          "focus-visible:ring-2 focus-visible:ring-brand-cream focus-visible:ring-offset-2 " +
          "focus-visible:ring-offset-base disabled:cursor-not-allowed " +
          `${INTENT[intent]} ${SIZE[size]} ${className}`
        }
        {...rest}
      />
    );
  }
);
