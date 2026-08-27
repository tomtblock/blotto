/**
 * The class digest + bag draw, in TypeScript (roadmap 2.2) — the verify
 * page's replay of the cosmetic class draw.
 *
 * Byte-identical to `crates/blotto-randomness` and pinned to the SAME Python
 * vectors (`crates/blotto-randomness/fixtures/vectors.json`), so the Rust
 * crate, this module and the oracle can never drift apart silently.
 *
 * The class is COSMETIC: read by nothing in the scoring path (PID §8.4).
 * This module exists so a player can verify the draw, not so anything here
 * can influence anything in `engine.ts` — and nothing does: neither module
 * imports the other.
 */

import { sha256 } from '@noble/hashes/sha256';

export const CLASS_NAMES = ['Goblin', 'Knight', 'Wizard', 'Dragon', 'Titan'] as const;
export const LAUNCH_CLASS_COUNTERS: readonly number[] = [38, 15, 7, 3, 1];

/**
 * The five-input digest:
 * `sha256(vrf_seed ‖ slot_hash ‖ entry_index(u16 LE) ‖ pool ‖ player)` —
 * 130 bytes hashed, byte-for-byte the Rust crate's construction.
 */
export function deriveClassRandomness(
  vrfSeed: Uint8Array,
  slotHash: Uint8Array,
  entryIndex: number,
  poolPubkey: Uint8Array,
  playerPubkey: Uint8Array
): Uint8Array {
  for (const [name, b] of [
    ['vrf_seed', vrfSeed],
    ['slot_hash', slotHash],
    ['pool_pubkey', poolPubkey],
    ['player_pubkey', playerPubkey],
  ] as const) {
    if (b.length !== 32) throw new Error(`${name} must be 32 bytes, got ${b.length}`);
  }
  if (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex > 0xffff) {
    throw new Error(`entry_index must fit a u16, got ${entryIndex}`);
  }
  const input = new Uint8Array(130);
  input.set(vrfSeed, 0);
  input.set(slotHash, 32);
  input[64] = entryIndex & 0xff;
  input[65] = entryIndex >> 8;
  input.set(poolPubkey, 66);
  input.set(playerPubkey, 98);
  return sha256(input);
}

/**
 * Bag-without-replacement draw: first 8 digest bytes as a u64 LE, modulo the
 * counter sum, walked as a cumulative distribution. The CALLER decrements
 * the drawn counter (the Rust crate's contract, kept identical).
 */
export function weightedClassDraw(rngBytes: Uint8Array, classCounters: readonly number[]): number {
  if (rngBytes.length !== 32) throw new Error(`rng bytes must be 32 bytes, got ${rngBytes.length}`);
  if (classCounters.length !== 5) throw new Error('class_counters must have 5 entries');
  let total = 0n;
  for (const c of classCounters) {
    if (!Number.isInteger(c) || c < 0 || c > 0xffff) {
      throw new Error(`class counter must fit a u16, got ${c}`);
    }
    total += BigInt(c);
  }
  if (total === 0n) throw new Error('weighted_class_draw called with an empty bag');
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(rngBytes[i]);
  const r = n % total;
  let cumulative = 0n;
  for (let i = 0; i < classCounters.length; i++) {
    cumulative += BigInt(classCounters[i]);
    if (r < cumulative) return i;
  }
  throw new Error('unreachable: cumulative walk fell through');
}
