/*
 * Button (D1). Three intents, one size scale. The ACTION accent belongs to
 * `primary` alone; `prize` exists only for celebration-adjacent actions
 * (viewing results, opening the share card) and must never sit on a payment
 * step — money-moving actions are always `primary`, so the colour a player
 * learns for "this spends" never varies.
 */
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Intent = "primary" | "quiet" | "prize";
type Size = "md" | "lg";

const INTENT: Record<Intent, string> = {
  // text-(--color-base): `text-base` is Tailwind's font-size utility, so the
  // surface colour must go through the var shorthand.
  primary:
    "bg-brand text-(--color-base) font-semibold hover:bg-brand-hot active:bg-brand-deep " +
    "disabled:bg-overlay disabled:text-ink-muted",
  quiet:
    "bg-transparent text-ink border border-line hover:border-brand hover:text-brand " +
    "disabled:text-ink-muted disabled:hover:border-line",
  prize:
    "bg-prize text-(--color-base) font-semibold hover:bg-prize-hot " +
    "disabled:bg-overlay disabled:text-ink-muted",
};

const SIZE: Record<Size, string> = {
  md: "h-11 px-5 text-[15px] rounded-lg",
  lg: "h-14 px-8 text-[17px] rounded-xl",
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
          "focus-visible:ring-2 focus-visible:ring-brand-hot focus-visible:ring-offset-2 " +
          "focus-visible:ring-offset-base disabled:cursor-not-allowed " +
          `${INTENT[intent]} ${SIZE[size]} ${className}`
        }
        {...rest}
      />
    );
  }
);
