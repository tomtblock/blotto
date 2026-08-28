/*
 * RankBadge (D1). Competition rank labels come from the PUBLISHED BUNDLE
 * (D3-B: ranks are not on-chain — the verify page recomputes them), so this
 * component renders only what a caller read from a bundle; it never invents
 * a rank. `paid` marks a rank inside the paid set and is the ONLY state
 * that may wear the prize accent.
 */
export interface RankBadgeProps {
  /** Competition rank from the published bundle (1-based; ties share). */
  rank: number;
  /** Whether this seat is in the committed paid set. */
  paid?: boolean;
  size?: "md" | "moment";
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function RankBadge({ rank, paid = false, size = "md" }: RankBadgeProps) {
  const moment = size === "moment";
  return (
    <span
      className={
        "tnum inline-flex items-center justify-center rounded-full font-display font-bold " +
        (moment ? "px-6 py-2 text-[34px] leading-[38px] " : "px-3 py-0.5 text-[15px] ") +
        (paid
          ? "bg-prize/15 text-prize border border-prize/40"
          : "bg-overlay text-ink-muted border border-line")
      }
      style={paid && moment ? { boxShadow: "var(--glow-prize)" } : undefined}
    >
      {ordinal(rank)}
    </span>
  );
}
