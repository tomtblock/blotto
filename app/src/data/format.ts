/* Lamports → SOL display, without ever passing through a float. */
import type { BoardMode } from '@/battle/board/mode';
import type { PoolSummary } from './types';

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

/**
 * The placing rule a pool plays by (Phase B, founder rulings 2026-09-24).
 * ONE place reads `PoolSummary.mode`, because the field is optional on the
 * wire — a read API from before the backend change serves none — and the
 * default has to be the same everywhere: easy, the rule every pool before
 * Phase B played. Never inferred from the tier, the pot or the id.
 */
/**
 * A unix-seconds decimal string as a calendar day, in UTC — the same text on
 * the server and on every device (no local time zone, no locale surprise).
 * Empty for a value that is not a time.
 */
export function formatDay(unixSeconds: string | null | undefined): string {
  if (!unixSeconds || !/^\d+$/.test(unixSeconds)) return '';
  const ms = Number(unixSeconds) * 1000;
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms));
}

export function poolMode(pool: Pick<PoolSummary, 'mode'>): BoardMode {
  return pool.mode === 'hard' ? 'hard' : 'easy';
}
