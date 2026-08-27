/* Lamports → SOL display, without ever passing through a float. */
export function lamportsToSol(lamports: string): string {
  const v = BigInt(lamports);
  const whole = v / 1_000_000_000n;
  const frac = v % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, '0').replace(/0+$/, '')}`;
}

/** The published prize table (exact 1024ths — matches the on-chain table). */
export const PRIZE_BANDS_1024 = [
  270n, 158n, 102n, 78n, 50n, 50n, 50n, 50n, 27n, 27n, 27n, 27n, 27n, 27n, 27n, 27n,
];

/** Band prize from the pool's FIXED pot (D-A1 revised) — the pot is chain
 * state (`PoolOpened.pot_lamports`), never derived from the entry price. */
export function prizeForRank(potLamports: string, rank: number): string {
  return ((BigInt(potLamports) * PRIZE_BANDS_1024[rank - 1]) / 1024n).toString();
}
