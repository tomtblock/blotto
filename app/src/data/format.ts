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

export function prizeForRank(entryLamports: string, rank: number): string {
  const pot = (BigInt(entryLamports) / 10n) * 8n * 64n;
  return ((pot * PRIZE_BANDS_1024[rank - 1]) / 1024n).toString();
}
