/*
 * Shared builders for the watcher's specs. Account bytes are built from the
 * SHARED layouts' own offsets, so a layout change breaks these specs loudly
 * instead of leaving them testing a shape that no longer exists.
 */

import { CONFIG_OFFSETS, CONFIG_SPACE, decodeConfigAccount, type ConfigAccountView } from '../../_shared/src/config-account';
import { POOL_OFFSETS, POOL_SPACE, POOL_MODE_OFFSET, POOL_STATE_NAMES, type PoolStateName } from '../../_shared/src/pool-account';
import { loadWatchConfig, type WatchConfig } from '../src/config';
import type { ChainPool, ChainSnapshot, CheckResult } from '../src/checks';
import { decodePool } from '../src/solana';

export const cfg: WatchConfig = loadWatchConfig();

/** A Config account: tier 0 enabled on both ladders, the given live pools. */
export function configView(opts: {
  paused?: boolean;
  easyActive?: bigint;
  hardActive?: bigint;
  nextPoolId?: bigint;
  tierNextOpenAt?: bigint;
} = {}): ConfigAccountView {
  const d = new Uint8Array(CONFIG_SPACE);
  const dv = new DataView(d.buffer);
  d[CONFIG_OFFSETS.paused] = opts.paused ? 1 : 0;
  d[CONFIG_OFFSETS.openTiers] = 1;
  d[CONFIG_OFFSETS.hardOpenTiers] = 1;
  dv.setBigUint64(CONFIG_OFFSETS.nextPoolId, opts.nextPoolId ?? 102n, true);
  dv.setBigUint64(CONFIG_OFFSETS.activePoolByTier, opts.easyActive ?? 100n, true);
  dv.setBigUint64(CONFIG_OFFSETS.hardActivePoolByTier, opts.hardActive ?? 101n, true);
  dv.setBigInt64(CONFIG_OFFSETS.tierNextOpenAt, opts.tierNextOpenAt ?? 0n, true);
  dv.setBigInt64(CONFIG_OFFSETS.hardTierNextOpenAt, opts.tierNextOpenAt ?? 0n, true);
  return decodeConfigAccount(d);
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
}): Uint8Array {
  const d = new Uint8Array(POOL_SPACE);
  const dv = new DataView(d.buffer);
  dv.setBigUint64(POOL_OFFSETS.id, p.id, true);
  dv.setBigUint64(POOL_OFFSETS.potLamports, p.pot ?? 4_000_000_000n, true);
  dv.setUint16(POOL_OFFSETS.entrants, p.entrants ?? 0, true);
  dv.setBigInt64(POOL_OFFSETS.openedAt, p.openedAt, true);
  dv.setBigInt64(POOL_OFFSETS.fillDeadline, p.fillDeadline, true);
  d[POOL_OFFSETS.state] = POOL_STATE_NAMES.indexOf(p.state ?? 'Open');
  d[POOL_MODE_OFFSET] = p.mode ?? 0;
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
export function snapshot(nowUnix: bigint = T0 + 600n, pools?: ChainPool[], config?: ConfigAccountView): ChainSnapshot {
  return {
    nowUnix,
    config: config ?? configView(),
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
