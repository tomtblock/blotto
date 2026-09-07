/**
 * Allocations and the 35-byte battle-set encoding (roadmap 2.1; PID §4.6,
 * TECH-ARCH §5).
 *
 * The allocation invariant — five non-negative integers in the FIXED stat
 * order Strength, Speed, Heart, Wit, Durability, summing to exactly 100 — is
 * the client invariant that makes the 7% draw rate real.
 *
 * WHERE IT IS ENFORCED, precisely, because the answer is not "on-chain". The
 * program never sees an allocation: `register` takes only `battles_hash`, and
 * the plaintext exists nowhere it can read until the pool secret is revealed.
 * That is the sealing property, and it costs exactly this — the two real
 * enforcement points are
 *
 *   1. the CLIENT, at submission (`app/src/battle/allocation.ts` holds the
 *      same rule, and the interaction cannot express a violating shape); and
 *   2. THIS MODULE, at reveal — `decodeBattleSet` refuses a malformed set, so
 *      an entry whose sealed bytes break the rule cannot be scored as if it
 *      had played. The crank treats that refusal exactly like a lost
 *      ciphertext: the entry is scored all-losses (`backend/reveal/src/crank.ts`
 *      catches the throw, `missing.ts` defines the rule) and the bundle
 *      publishes its status, so one malformed entry can never halt a pool's
 *      settlement.
 *
 * A mismatch between (1) and (2) is a defect in one of them.
 *
 * Pure module: no I/O, no Date, no randomness.
 */

import { sha256 } from '@noble/hashes/sha256';

export const STATS = 5;
export const BATTLES = 7;
export const ALLOCATION_SUM = 100;
/** 7 battles × 5 stats, one byte per stat. */
export const BATTLE_SET_BYTES = BATTLES * STATS;
export const SALT_BYTES = 32;

/** The fixed stat order. Index into an allocation with these. */
export const STAT_NAMES = ['Strength', 'Speed', 'Heart', 'Wit', 'Durability'] as const;

/** One battle's allocation: exactly five integers summing to exactly 100. */
export type Allocation = readonly [number, number, number, number, number];

/** One entry's seven battles. */
export type BattleSet = readonly Allocation[];

/** Validate one allocation. Throws with the reason on any violation. */
export function assertAllocation(a: readonly number[]): asserts a is Allocation {
  if (a.length !== STATS) {
    throw new Error(`allocation must have exactly ${STATS} stats, got ${a.length}`);
  }
  let sum = 0;
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0 || v > ALLOCATION_SUM) {
      throw new Error(`allocation values must be integers in [0, 100], got ${v}`);
    }
    sum += v;
  }
  if (sum !== ALLOCATION_SUM) {
    throw new Error(`allocation must sum to exactly ${ALLOCATION_SUM}, got ${sum}`);
  }
}

/** Validate a full battle set. */
export function assertBattleSet(battles: readonly (readonly number[])[]): asserts battles is BattleSet {
  if (battles.length !== BATTLES) {
    throw new Error(`battle set must have exactly ${BATTLES} battles, got ${battles.length}`);
  }
  for (const b of battles) assertAllocation(b);
}

/**
 * Encode a battle set to its canonical 35 bytes: battles in order, each
 * battle's five stats in the fixed order, one byte per stat.
 */
export function encodeBattleSet(battles: BattleSet): Uint8Array {
  assertBattleSet(battles);
  const out = new Uint8Array(BATTLE_SET_BYTES);
  let o = 0;
  for (const b of battles) for (const v of b) out[o++] = v;
  return out;
}

/** Decode 35 canonical bytes back to a battle set. Validates the invariant. */
export function decodeBattleSet(bytes: Uint8Array): BattleSet {
  if (bytes.length !== BATTLE_SET_BYTES) {
    throw new Error(`battle set must be exactly ${BATTLE_SET_BYTES} bytes, got ${bytes.length}`);
  }
  const battles: number[][] = [];
  for (let k = 0; k < BATTLES; k++) {
    battles.push([...bytes.subarray(k * STATS, (k + 1) * STATS)]);
  }
  assertBattleSet(battles);
  return battles;
}

/**
 * The on-chain commitment: `sha256(35-byte battle set ‖ 32-byte salt)` —
 * the exact bytes `Entry.battles_hash` records at `register` (TECH-ARCH §5).
 */
export function battlesHash(battles: BattleSet, salt: Uint8Array): Uint8Array {
  if (salt.length !== SALT_BYTES) {
    throw new Error(`salt must be exactly ${SALT_BYTES} bytes, got ${salt.length}`);
  }
  const bytes = encodeBattleSet(battles);
  const input = new Uint8Array(BATTLE_SET_BYTES + SALT_BYTES);
  input.set(bytes, 0);
  input.set(salt, BATTLE_SET_BYTES);
  return sha256(input);
}
