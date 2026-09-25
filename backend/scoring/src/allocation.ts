/**
 * Allocations and the canonical battle-set encodings (roadmap 2.1; PID
 * §4.6, TECH-ARCH §5; Phase B — the two board modes, founder rulings
 * 2026-09-24).
 *
 * TWO MODES, ONE RULE SHAPE. A battle set is always seven battles of five
 * stats in the FIXED order Strength, Speed, Heart, Wit, Durability, and
 * every stat is a non-negative integer. What differs is where the total is
 * pinned:
 *
 *   - EASY: each battle's five stats sum to exactly 100 (the original
 *     invariant — the client invariant that makes the 7% draw rate real).
 *     One byte per stat: 35 bytes.
 *   - HARD: the whole board's thirty-five stats sum to exactly 700 (seven
 *     battles' worth of points, placed anywhere — a battle may hold all of
 *     it or none). A stat can therefore reach 700, so two bytes per stat,
 *     little-endian: 70 bytes.
 *
 * The comparison rule is the same in both (a stat is won by the larger
 * number, a battle by three or more stats); only the placing rule and the
 * encoding differ, and both are decided by the pool's recorded `mode`
 * (`Pool.mode`, `PoolOpened.mode`), never inferred from the bytes.
 *
 * WHERE THE INVARIANT IS ENFORCED, precisely, because the answer is not
 * "on-chain". The program never sees an allocation: `register` takes only
 * `battles_hash`, and the plaintext exists nowhere it can read until the
 * pool secret is revealed. That is the sealing property, and it costs
 * exactly this — the two real enforcement points are
 *
 *   1. the CLIENT, at submission — which is THIS MODULE TOO, not a second
 *      copy of the rule. `app/src/entry/submit.ts` encodes through
 *      `encodePayload` (`backend/sealing/src/payload.ts`), which calls
 *      `encodeBattleSet` below, which calls `assertBattleSet`; a violating
 *      set throws before any ciphertext or `battles_hash` exists, so
 *      nothing can reach the chain around it. The board upstream cannot
 *      express a violating shape either, but it is defence in depth, not
 *      the boundary.
 *   2. THIS MODULE, at reveal — `decodeBattleSet` refuses a malformed set
 *      (and a set of the wrong mode's length), so an entry whose sealed
 *      bytes break the rule cannot be scored as if it had played. The crank
 *      treats that refusal exactly like a lost ciphertext: the entry is
 *      scored all-losses (`backend/reveal/src/crank.ts` catches the throw,
 *      `missing.ts` defines the rule) and the bundle publishes its status,
 *      so one malformed entry can never halt a pool's settlement.
 *
 * (1) and (2) cannot disagree, because they are the same three functions
 * called at two moments. That is the point of keeping the rule here rather
 * than restating it client-side.
 *
 * Every function that reads or writes bytes takes the mode and DEFAULTS TO
 * EASY, so every caller written before Phase B keeps its meaning.
 *
 * Pure module: no I/O, no Date, no randomness.
 */

import { sha256 } from '@noble/hashes/sha256';

export const STATS = 5;
export const BATTLES = 7;
export const ALLOCATION_SUM = 100;
/** 7 battles × 5 stats, one byte per stat — the EASY encoding. */
export const BATTLE_SET_BYTES = BATTLES * STATS;
export const SALT_BYTES = 32;

/** The fixed stat order. Index into an allocation with these. */
export const STAT_NAMES = ['Strength', 'Speed', 'Heart', 'Wit', 'Durability'] as const;

/**
 * The placing rule a pool plays by (Phase B). The wire value is
 * `Pool.mode` / `PoolOpened.mode`: 0 easy, 1 hard (`constants.rs::MODE_*`).
 */
export type BoardMode = 'easy' | 'hard';
export const MODE_EASY = 0;
export const MODE_HARD = 1;

/** The wire byte → the mode. Anything else is refused, never guessed. */
export function boardModeOf(byte: number | null | undefined): BoardMode {
  // `null`/`undefined` is the pre-Phase-B shape of an event or account:
  // hard did not exist, so it played easy.
  if (byte === null || byte === undefined || byte === MODE_EASY) return 'easy';
  if (byte === MODE_HARD) return 'hard';
  throw new Error(`unknown board mode ${byte}`);
}

/** The mode → its wire byte. */
export function boardModeByte(mode: BoardMode): number {
  return mode === 'hard' ? MODE_HARD : MODE_EASY;
}

/** HARD: the whole board's total — seven battles' worth of easy points. */
export const HARD_TOTAL = BATTLES * ALLOCATION_SUM;
/** HARD: 7 × 5 stats, two bytes each (a stat may hold up to 700). */
export const HARD_BATTLE_SET_BYTES = BATTLES * STATS * 2;

/** The canonical battle-set length for a mode. */
export function battleSetBytes(mode: BoardMode = 'easy'): number {
  return mode === 'hard' ? HARD_BATTLE_SET_BYTES : BATTLE_SET_BYTES;
}

/** One battle's allocation: exactly five non-negative integers (easy: summing to exactly 100). */
export type Allocation = readonly [number, number, number, number, number];

/** One entry's seven battles. */
export type BattleSet = readonly Allocation[];

/**
 * Validate one allocation. Throws with the reason on any violation.
 *
 * EASY: five integers in [0, 100] summing to exactly 100. HARD: five
 * integers in [0, 700]; the sum rule is the board's, checked by
 * `assertBattleSet`, so a single hard battle is not a unit that can be
 * validated alone beyond its shape and range.
 */
export function assertAllocation(a: readonly number[], mode: BoardMode = 'easy'): asserts a is Allocation {
  if (a.length !== STATS) {
    throw new Error(`allocation must have exactly ${STATS} stats, got ${a.length}`);
  }
  const max = mode === 'hard' ? HARD_TOTAL : ALLOCATION_SUM;
  let sum = 0;
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0 || v > max) {
      throw new Error(`allocation values must be integers in [0, ${max}], got ${v}`);
    }
    sum += v;
  }
  if (mode === 'easy' && sum !== ALLOCATION_SUM) {
    throw new Error(`allocation must sum to exactly ${ALLOCATION_SUM}, got ${sum}`);
  }
}

/** Validate a full battle set under `mode`'s placing rule. */
export function assertBattleSet(
  battles: readonly (readonly number[])[],
  mode: BoardMode = 'easy'
): asserts battles is BattleSet {
  if (battles.length !== BATTLES) {
    throw new Error(`battle set must have exactly ${BATTLES} battles, got ${battles.length}`);
  }
  for (const b of battles) assertAllocation(b, mode);
  if (mode === 'hard') {
    let total = 0;
    for (const b of battles) for (const v of b) total += v;
    if (total !== HARD_TOTAL) {
      throw new Error(`hard battle set must sum to exactly ${HARD_TOTAL} across the board, got ${total}`);
    }
  }
}

/**
 * Encode a battle set to its canonical bytes: battles in order, each
 * battle's five stats in the fixed order — one byte per stat (easy) or two
 * bytes little-endian per stat (hard).
 */
export function encodeBattleSet(battles: BattleSet, mode: BoardMode = 'easy'): Uint8Array {
  assertBattleSet(battles, mode);
  const out = new Uint8Array(battleSetBytes(mode));
  let o = 0;
  for (const b of battles) {
    for (const v of b) {
      if (mode === 'hard') {
        out[o++] = v & 0xff;
        out[o++] = (v >>> 8) & 0xff;
      } else {
        out[o++] = v;
      }
    }
  }
  return out;
}

/** Decode canonical bytes back to a battle set. Validates the invariant and the length. */
export function decodeBattleSet(bytes: Uint8Array, mode: BoardMode = 'easy'): BattleSet {
  const expected = battleSetBytes(mode);
  if (bytes.length !== expected) {
    throw new Error(`${mode} battle set must be exactly ${expected} bytes, got ${bytes.length}`);
  }
  const battles: number[][] = [];
  if (mode === 'hard') {
    let o = 0;
    for (let k = 0; k < BATTLES; k++) {
      const b: number[] = [];
      for (let z = 0; z < STATS; z++) {
        b.push(bytes[o] | (bytes[o + 1] << 8));
        o += 2;
      }
      battles.push(b);
    }
  } else {
    for (let k = 0; k < BATTLES; k++) {
      battles.push([...bytes.subarray(k * STATS, (k + 1) * STATS)]);
    }
  }
  assertBattleSet(battles, mode);
  return battles;
}

/**
 * The on-chain commitment: `sha256(canonical battle set ‖ 32-byte salt)` —
 * the exact bytes `Entry.battles_hash` records at `register` (TECH-ARCH
 * §5). The canonical set is 35 bytes in easy and 70 in hard, so the two
 * modes commit differently to the same numbers — which is right: the mode
 * is part of what was committed to.
 */
export function battlesHash(battles: BattleSet, salt: Uint8Array, mode: BoardMode = 'easy'): Uint8Array {
  if (salt.length !== SALT_BYTES) {
    throw new Error(`salt must be exactly ${SALT_BYTES} bytes, got ${salt.length}`);
  }
  const bytes = encodeBattleSet(battles, mode);
  const input = new Uint8Array(bytes.length + SALT_BYTES);
  input.set(bytes, 0);
  input.set(salt, bytes.length);
  return sha256(input);
}
