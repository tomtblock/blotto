/* Lamports → SOL display, without ever passing through a float. */
export function lamportsToSol(lamports: string): string {
  const v = BigInt(lamports);
  const whole = v / 1_000_000_000n;
  const frac = v % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, '0').replace(/0+$/, '')}`;
}
