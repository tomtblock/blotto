/*
 * PrizeTable (D1): the published payout structure as a scoreboard. Amounts
 * are decimal SOL strings computed upstream from the fixed pot (never here
 * — no arithmetic in a display component); the caller may light one row
 * (`highlightRank`) for "your row" on the reveal and results screens.
 */
export interface PrizeRow {
  /** Position label ("1st", "5th–8th"). */
  position: string;
  /** SOL amount, preformatted decimal string. */
  amountSol: string;
  /** The rank this row starts at (for highlight matching). */
  rank: number;
}

export interface PrizeTableProps {
  rows: PrizeRow[];
  highlightRank?: number;
  caption: string;
}

export function PrizeTable({ rows, highlightRank, caption }: PrizeTableProps) {
  return (
    <table className="w-full border-separate border-spacing-0">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((row) => {
          const mine = highlightRank !== undefined && row.rank === highlightRank;
          return (
            <tr key={row.position}>
              <td
                className={
                  "border-b border-line py-2.5 pr-3 text-[15px] " +
                  (mine ? "text-prize font-semibold" : "text-ink-muted")
                }
              >
                {mine ? "▸ " : ""}
                {row.position}
              </td>
              <td
                className={
                  "tnum border-b border-line py-2.5 text-right font-display text-[18px] font-bold " +
                  (mine ? "text-prize" : "text-ink")
                }
              >
                {row.amountSol}
                <span className="ml-1 font-body text-[11px] font-medium text-ink-muted">SOL</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
