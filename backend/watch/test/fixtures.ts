/*
 * Shared builders for the watcher's specs. Account bytes are built from the
 * SHARED layouts' own offsets, so a layout change breaks these specs loudly
 * instead of leaving them testing a shape that no longer exists.
 */

import {
  CONFIG_OFFSETS,
  CONFIG_SPACE,
  CONFIG_SPACE_V3,
  decodeConfigAccount,
  type ConfigAccountView,
} from '../../_shared/src/config-account';
import {
  POOL_LADDER_OFFSETS,
  POOL_OFFSETS,
  POOL_SPACE,
  POOL_MODE_OFFSET,
  POOL_STATE_NAMES,
  type PoolStateName,
} from '../../_shared/src/pool-account';
import {
  POOL_TYPE_OFFSETS,
  POOL_TYPE_SPACE,
  decodePoolTypeAccount,
  type PoolTypeView,
} from '../../_shared/src/pool-type-account';
import { LADDER_TABLES, MIN_FIELD_BY_CAPACITY, TIER_ENTRY_LAMPORTS, prizePoolFor } from '../../scoring/src/prizes';
import { loadWatchConfig, type WatchConfig } from '../src/config';
import type { ChainPool, ChainSnapshot, CheckResult } from '../src/checks';
import { POOL_TYPE_DISCRIMINATOR, decodePool } from '../src/solana';

export const cfg: WatchConfig = loadWatchConfig();

/**
 * A Config account: tier 0 enabled on both ladders. `ladder: false` builds
 * the pre-Ladder (603-byte) account, whose per-tier slots are what open a
 * pool; the default is the current one, which also carries the legacy slots
 * (frozen since the Ladder) and the enabled pool-type count.
 */
export function configView(opts: {
  paused?: boolean;
  easyActive?: bigint;
  hardActive?: bigint;
  nextPoolId?: bigint;
  tierNextOpenAt?: bigint;
  hardOpen?: boolean;
  enabledPoolTypes?: number;
  ladder?: boolean;
} = {}): ConfigAccountView {
  const ladder = opts.ladder ?? true;
  const d = new Uint8Array(ladder ? CONFIG_SPACE : CONFIG_SPACE_V3);
  const dv = new DataView(d.buffer);
  d[CONFIG_OFFSETS.paused] = opts.paused ? 1 : 0;
  d[CONFIG_OFFSETS.openTiers] = 1;
  d[CONFIG_OFFSETS.hardOpenTiers] = opts.hardOpen === false ? 0 : 1;
  dv.setBigUint64(CONFIG_OFFSETS.nextPoolId, opts.nextPoolId ?? 102n, true);
  dv.setBigUint64(CONFIG_OFFSETS.activePoolByTier, opts.easyActive ?? (ladder ? 0n : 100n), true);
  dv.setBigUint64(CONFIG_OFFSETS.hardActivePoolByTier, opts.hardActive ?? (ladder ? 0n : 101n), true);
  dv.setBigInt64(CONFIG_OFFSETS.tierNextOpenAt, opts.tierNextOpenAt ?? 0n, true);
  dv.setBigInt64(CONFIG_OFFSETS.hardTierNextOpenAt, opts.tierNextOpenAt ?? 0n, true);
  if (ladder) dv.setUint16(CONFIG_OFFSETS.enabledPoolTypes, opts.enabledPoolTypes ?? 2, true);
  return decodeConfigAccount(d);
}

/** A PoolType account's bytes (D-E19), at the launch economics of its size. */
export function poolTypeBytes(t: {
  mode: 0 | 1;
  tier?: number;
  capacity: 8 | 16 | 32 | 64;
  enabled?: boolean;
  activePool?: bigint;
  nextOpenAt?: bigint;
}): Uint8Array {
  const d = new Uint8Array(POOL_TYPE_SPACE);
  const dv = new DataView(d.buffer);
  const O = POOL_TYPE_OFFSETS;
  const tier = t.tier ?? 0;
  const table = LADDER_TABLES[t.capacity];
  d.set(POOL_TYPE_DISCRIMINATOR, 0);
  d[O.mode] = t.mode;
  d[O.tier] = tier;
  dv.setUint16(O.capacity, t.capacity, true);
  dv.setUint16(O.minSeats, MIN_FIELD_BY_CAPACITY[t.capacity], true);
  d[O.paidPlaces] = table.length;
  d.set(table, O.prizeTable);
  dv.setBigUint64(O.potLamports, prizePoolFor(table, TIER_ENTRY_LAMPORTS[tier]), true);
  d[O.enabled] = t.enabled === false ? 0 : 1;
  dv.setBigUint64(O.activePool, t.activePool ?? 0n, true);
  dv.setBigInt64(O.nextOpenAt, t.nextOpenAt ?? 0n, true);
  d[O.bump] = 255;
  return d;
}

/** A PoolType as the watcher decodes it. */
export function poolType(t: Parameters<typeof poolTypeBytes>[0]): PoolTypeView {
  return decodePoolTypeAccount(poolTypeBytes(t));
}

/** The two types holding pools 100 (easy) and 101 (hard), both 64 players. */
export function liveTypes(): PoolTypeView[] {
  return [
    poolType({ mode: 0, capacity: 64, activePool: 100n }),
    poolType({ mode: 1, capacity: 64, activePool: 101n }),
  ];
}

/** A Pool account's bytes. */
export function poolBytes(p: {
  id: bigint;
  state?: PoolStateName;
  openedAt: bigint;
  fillDeadline: bigint;
  entrants?: number;
  pot?: bigint;
  mode?: 0 | 1;
  capacity?: 8 | 16 | 32 | 64;
}): Uint8Array {
  const d = new Uint8Array(POOL_SPACE);
  const dv = new DataView(d.buffer);
  const capacity = p.capacity ?? 64;
  const table = LADDER_TABLES[capacity];
  dv.setBigUint64(POOL_OFFSETS.id, p.id, true);
  dv.setBigUint64(POOL_OFFSETS.entryLamports, TIER_ENTRY_LAMPORTS[0], true);
  dv.setBigUint64(POOL_OFFSETS.potLamports, p.pot ?? prizePoolFor(table, TIER_ENTRY_LAMPORTS[0]), true);
  dv.setUint16(POOL_OFFSETS.entrants, p.entrants ?? 0, true);
  dv.setBigInt64(POOL_OFFSETS.openedAt, p.openedAt, true);
  dv.setBigInt64(POOL_OFFSETS.fillDeadline, p.fillDeadline, true);
  d[POOL_OFFSETS.state] = POOL_STATE_NAMES.indexOf(p.state ?? 'Open');
  d[POOL_MODE_OFFSET] = p.mode ?? 0;
  // The Ladder tail (D-E19): the pool's own size, floor and table.
  dv.setUint16(POOL_LADDER_OFFSETS.minSeats, MIN_FIELD_BY_CAPACITY[capacity], true);
  dv.setUint16(POOL_LADDER_OFFSETS.capacity, capacity, true);
  d[POOL_LADDER_OFFSETS.paidPlaces] = table.length;
  d.set(table, POOL_LADDER_OFFSETS.prizeTable);
  return d;
}

export const T0 = 1_792_030_000n; // chain seconds, 2026-10-15

export function chainPool(
  p: Parameters<typeof poolBytes>[0],
  extra: { hasPassCollection?: boolean; vaultLamports?: bigint | null } = {}
): ChainPool {
  return {
    address: `pool-${p.id}`,
    pool: decodePool(poolBytes(p)),
    hasPassCollection: extra.hasPassCollection ?? true,
    vaultLamports: extra.vaultLamports === undefined ? 4_000_890_880n : extra.vaultLamports,
  };
}

/** Pools 100 (easy) and 101 (hard), opened ten minutes before `nowUnix`, healthy. */
export function snapshot(
  nowUnix: bigint = T0 + 600n,
  pools?: ChainPool[],
  config?: ConfigAccountView,
  poolTypes?: PoolTypeView[]
): ChainSnapshot {
  return {
    nowUnix,
    config: config ?? configView(),
    poolTypes: poolTypes ?? liveTypes(),
    pools: pools ?? [
      chainPool({ id: 100n, openedAt: T0, fillDeadline: T0 + 24_000n }),
      chainPool({ id: 101n, openedAt: T0, fillDeadline: T0 + 24_000n, mode: 1 }),
    ],
  };
}

export const byKey = (rs: CheckResult[], key: string): CheckResult => {
  const r = rs.find((x) => x.key === key);
  if (!r) throw new Error(`no result for ${key}`);
  return r;
};

/** A fetch stand-in answering from a queue of [status, body] pairs and recording requests. */
export function fakeFetch(answers: [number, unknown][]): {
  fetchImpl: typeof fetch;
  calls: { url: string; body: unknown; headers: Record<string, string> }[];
} {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const next = answers.shift();
    if (!next) throw new Error('fakeFetch: no answer queued');
    const [status, body] = next;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
