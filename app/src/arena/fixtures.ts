/*
 * Deterministic arena fixtures — a full 64-seat pool, its entries, and a
 * published-bundle shape, so EVERY arena phase renders without a backend,
 * a wallet, or a chain (the reveal/fixtures.ts posture; the dev lever and
 * the tests both stand on this file).
 *
 * Deterministic on purpose: the "variety" in the battle sets is the fixed
 * integer hash from the fragment-geometry recipe — irregular to the eye,
 * identical on every run. The battle sets are made VALID by the real
 * normalizer (five non-negative integers summing to exactly 100), and the
 * bundle's results are computed by the REAL engine — the canonical-outcomes
 * rule applies to fixtures too, or the fixture playback would rehearse lies.
 *
 * The bundle's `results_root` is a placeholder (no base58 players here to
 * build real leaves from); the arena's rescore gate compares RESULTS, and
 * the Verify page owns root checking against the chain.
 */

import { normalize, type RawWeights } from '@/battle/allocation';
import type { EntryRow, PoolSummary } from '@/data/types';
import type { PublishedBundle } from '@/verify/logic';
import {
  BATTLES,
  STATS,
  assignPrizes,
  battlesHash,
  encodeBattleSet,
  potLamports,
  scoreWithMissing,
  type BattleSet,
} from './engine';

/** Matches src/data/fixture.ts's pool, so `indexerApi()`'s fixture fallback
 * and the arena fixtures describe the same pool. */
export const FIXTURE_ARENA_POOL = 'F1XTUREPoo1111111111111111111111111111111111';
export const FIXTURE_CAPACITY = 64;
export const FIXTURE_ENTRY_LAMPORTS = '100000000';
/** The dev lever's viewer seat. */
export const FIXTURE_MY_SEAT = 0;

const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Fixed integer hash → [0,1). The fragment-geometry recipe. */
function jitter(i: number, salt: number): number {
  return ((((i + 1) * 2654435761 + salt * 40503) >>> 0) % 1000) / 1000;
}

export function fixturePlayer(seat: number): string {
  return `ArenaF1xturePlayer${String(seat).padStart(2, '0')}xxxxxxxxxxxxxxxxxxxxxxxx`;
}

/** Seat `seat`'s seven battles — valid by the real normalizer. */
export function fixtureBattleSet(seat: number): BattleSet {
  const battles = [];
  for (let k = 0; k < BATTLES; k++) {
    const raw = Array.from(
      { length: STATS },
      (_, z) => 1 + jitter(seat * BATTLES + k, z + 1) * 99
    ) as unknown as RawWeights;
    battles.push(normalize(raw));
  }
  return battles;
}

export function fixturePoolSummary(state: PoolSummary['state'], entrants: number): PoolSummary {
  return {
    pool: FIXTURE_ARENA_POOL,
    id: 'FIXTURE',
    tier: 0,
    entry_lamports: FIXTURE_ENTRY_LAMPORTS,
    fill_deadline: '4102444800',
    timer_seconds: 15,
    state,
    sealing_pubkey: '11'.repeat(32),
    entrants,
    results_root: null,
    secret: state === 'Open' ? null : '22'.repeat(32),
  };
}

export function fixtureEntries(count: number): EntryRow[] {
  return Array.from({ length: count }, (_, idx) => ({
    pool: FIXTURE_ARENA_POOL,
    player: fixturePlayer(idx),
    idx,
    class: Math.floor(jitter(idx, 9) * 5),
    battles_hash: hexOf(battlesHash(fixtureBattleSet(idx), fixtureSalt(idx))),
    flagged: false,
    refunded: false,
    escrow_settled: null,
  }));
}

function fixtureSalt(seat: number): Uint8Array {
  return new Uint8Array(32).fill(seat + 1);
}

let bundleMemo: PublishedBundle | null = null;

/** The published bundle of the filled fixture pool — results by the REAL
 * engine, built once on first use. */
export function fixtureBundle(): PublishedBundle {
  if (bundleMemo) return bundleMemo;
  const sets = Array.from({ length: FIXTURE_CAPACITY }, (_, s) => fixtureBattleSet(s));
  const scored = scoreWithMissing(sets.map((battles, index) => ({ index, battles })));
  const withPrizes = assignPrizes(scored, potLamports(BigInt(FIXTURE_ENTRY_LAMPORTS)));
  bundleMemo = {
    pool_id: 'FIXTURE',
    secret: '22'.repeat(32),
    entry_lamports: FIXTURE_ENTRY_LAMPORTS,
    entries: sets.map((battles, index) => ({
      player: fixturePlayer(index),
      index,
      battles: hexOf(encodeBattleSet(battles)),
      salt: hexOf(fixtureSalt(index)),
      battles_hash: hexOf(battlesHash(battles, fixtureSalt(index))),
      status: 'published',
    })),
    results: withPrizes.map((r) => ({
      index: r.index,
      player: fixturePlayer(r.index),
      score_half: r.scoreHalf,
      zones: r.zones,
      rank: r.rank,
      amount_lamports: r.amountLamports.toString(),
    })),
    payouts: withPrizes
      .filter((r) => r.amountLamports > 0n)
      .sort((a, b) => a.index - b.index)
      .map((r) => ({
        entry_index: r.index,
        player: fixturePlayer(r.index),
        amount_lamports: r.amountLamports.toString(),
      })),
    results_root: '00'.repeat(32),
  };
  return bundleMemo;
}
