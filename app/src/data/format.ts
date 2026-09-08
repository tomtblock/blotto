/* Lamports → SOL display, without ever passing through a float. */
export function lamportsToSol(lamports: string): string {
  const v = BigInt(lamports);
  const whole = v / 1_000_000_000n;
  const frac = v % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, '0').replace(/0+$/, '')}`;
}

/**
 * SOL text → lamports, or null when the text is not a plain SOL amount.
 * Accepts digits with up to nine decimals ("0.1", "2", "1.500000000");
 * nothing else — no signs, no exponents, no separators — and never a float
 * on the way through.
 */
export function solToLamports(input: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(input.trim());
  if (!m) return null;
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? '').padEnd(9, '0'));
  return whole * 1_000_000_000n + frac;
}

/**
 * Lamports → a SHORT SOL figure for tight surfaces (the header pill):
 * truncated — never rounded up — to `decimals` places, trailing zeros kept
 * so the width is stable. "1.234", "0.000". Display only.
 */
export function formatSolShort(lamports: bigint, decimals = 3): string {
  const whole = lamports / 1_000_000_000n;
  const frac = lamports % 1_000_000_000n;
  const digits = frac.toString().padStart(9, '0').slice(0, decimals);
  return decimals === 0 ? whole.toString() : `${whole}.${digits}`;
}
