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
  /** moment = the hero number of a screen. */
  size?: "md" | "moment";
}

const TONE = { ink: "text-ink", prize: "text-prize", brand: "text-brand" } as const;

export function Stat({ label, value, unit, tone = "ink", size = "md" }: StatProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">{label}</span>
      <span
        className={
          `tnum font-display ${TONE[tone]} ` +
          (size === "moment"
            ? "text-[56px] leading-[58px] font-extrabold"
            : "text-[24px] leading-[30px] font-bold")
        }
      >
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
