/*
 * Stat (D1): a labelled number. The value ALWAYS renders in the display
 * face with tabular figures — a stat is a scoreboard cell, not body text.
 * `tone="prize"` is reserved for amounts a player is or would be paid.
 */
import type { ReactNode } from "react";

export interface StatProps {
  label: string;
  value: ReactNode;
  /** Trailing unit, rendered smaller ("SOL", "seats"). */
  unit?: string;
  tone?: "ink" | "prize" | "brand";
  /**
   * moment = the hero number of a screen; lg (founder 2026-09-16, round
   * two) = the fixture's numbers on the pool page, larger than a list cell
   * but not the one number a screen is about.
   */
  size?: "md" | "lg" | "moment";
}

const TONE = { ink: "text-ink", prize: "text-prize", brand: "text-brand" } as const;
const SIZE = {
  md: { value: "text-[24px] leading-[30px] font-bold", label: "text-[12px]" },
  lg: { value: "text-[40px] leading-[44px] font-extrabold", label: "text-[13px]" },
  moment: { value: "text-[56px] leading-[58px] font-extrabold", label: "text-[12px]" },
} as const;

export function Stat({ label, value, unit, tone = "ink", size = "md" }: StatProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`${SIZE[size].label} uppercase tracking-[0.14em] text-ink-muted`}>{label}</span>
      <span className={`tnum font-display ${TONE[tone]} ${SIZE[size].value}`}>
        {value}
        {unit ? (
          <span className="ml-1 align-baseline font-body text-[0.45em] font-medium text-ink-muted">
            {unit}
          </span>
        ) : null}
      </span>
    </div>
  );
}
