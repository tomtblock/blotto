/*
 * The prize table (D-E19, the Ladder; founder brief 2026-11-05): a pool's
 * fixed prizes by place, in SOL. One row per band — 1st, 2nd, 3rd, 4th,
 * 5th–8th, 9th–16th — and only the bands the pool pays (data/prizes.ts
 * decides the rows, and splits a band whose places differ rather than
 * printing an "each" that would be false).
 *
 * The AMOUNTS are the caller's: a pool's own table (`poolLadder`, the
 * on-chain copy taken at open) on the landing and the pool page, or
 * LADDER_TABLES × the entry price on the rules page. This component does
 * no arithmetic on money; it formats bigint lamports at the edge.
 *
 * Two shapes. `full` is a real <table> (the pool page and the rules page).
 * `compact` is the landing card's strip above the Enter key — a list of
 * small cells that sits two to a row at 375 px and in one line on a wide
 * card. Never multiples of the entry, never a percentage (copy rules).
 */
import { COPY } from '@/copy';
import { lamportsToSol } from '@/data/format';
import { prizeBands, prizeRuns } from '@/data/prizes';

const p = COPY.prizes;

/** The founder's prize sentence for a table: "The prizes are fixed … 1st 0.3 SOL, 2nd 0.2 SOL." */
export function prizeSentence(amounts: readonly bigint[]): string {
  return p.sentence(prizeRuns(amounts).map((r) => ({ from: r.from, to: r.to, sol: lamportsToSol(r.each.toString()) })));
}

/** "16 players · 4 prizes · 1st 0.5 SOL" — how a pool is described. */
export function prizeSummary(capacity: number, amounts: readonly bigint[]): string {
  const first = amounts[0];
  return first === undefined ? p.players(capacity) : p.summary(capacity, amounts.length, lamportsToSol(first.toString()));
}

export interface PrizeTableProps {
  /** Lamports per paid place, rank 1 first. */
  amounts: readonly bigint[];
  /** The pool's size — names the table for assistive tech. */
  capacity: number;
  variant?: 'full' | 'compact';
  /** compact only: the card it sits on. */
  tone?: 'light' | 'dark';
  className?: string;
}

/** "0.1 SOL" / "0.1 SOL each" for a band. */
function bandAmount(from: number, to: number, each: bigint): string {
  const sol = p.amount(lamportsToSol(each.toString()));
  return from === to ? sol : `${sol} ${p.each}`;
}

const COMPACT = {
  light: {
    cell: 'border-brand-berry/15 bg-[#f8e8dc]',
    place: 'text-[#8c5474]',
    amount: 'text-brand-berry',
  },
  dark: {
    cell: 'border-white/15 bg-[#2e1134]',
    place: 'text-brand-pale-pink',
    amount: 'text-brand-yellow',
  },
} as const;

export function PrizeTable({ amounts, capacity, variant = 'full', tone = 'light', className = '' }: PrizeTableProps) {
  const bands = prizeBands(amounts);
  if (variant === 'compact') {
    const c = COMPACT[tone];
    return (
      <ul
        aria-label={p.tableLabel(capacity)}
        data-testid="prize-table"
        className={`grid grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(112px,1fr))] ${className}`}
      >
        {bands.map((b) => (
          <li
            key={b.from}
            data-testid="prize-band"
            className={`flex flex-col gap-0.5 rounded-[14px] border px-3 py-2 ${c.cell}`}
          >
            <span className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${c.place}`}>
              {p.band(b.from, b.to)}
            </span>
            <span className={`tnum font-display text-[16px] leading-5 font-extrabold ${c.amount}`}>
              {bandAmount(b.from, b.to, b.each)}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-left text-[14px]" data-testid="prize-table">
        <caption className="sr-only">{p.tableLabel(capacity)}</caption>
        <thead>
          <tr className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">
            <th scope="col" className="py-2 pr-4 font-medium">
              {p.colPlace}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              {p.colPrize}
            </th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.from} className="border-t border-line" data-testid="prize-band">
              <th scope="row" className="tnum py-2 pr-4 font-mono text-[13px] font-normal text-ink-muted">
                {p.band(b.from, b.to)}
              </th>
              <td className="tnum py-2 text-right font-display text-[16px] font-bold text-prize">
                {bandAmount(b.from, b.to, b.each)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
