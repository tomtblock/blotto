/*
 * The stills sweep (2026-09-16, the founder's data-minimisation ruling of
 * 2026-09-15): forget a pool's stills on this device once its allocation
 * will never be published.
 *
 * The rule, and why it needs no number: a still depicts the allocation. For
 * an OPEN pool the run needs it and the allocation is still sealed; for a
 * REVEALED pool the allocation is published and the still is a picture of
 * public data (the montage share and the gallery read it after close). Only
 * a pool that refunded, or closed without ever revealing, leaves a still
 * that depicts something nobody will ever publish — and that is the one
 * kind the device should not keep.
 *
 * Runs where stills are read or made: the profile gallery, the results
 * montage, the play page. It never deletes on a failed or absent read — a
 * pool the indexer cannot describe right now is left exactly as it is.
 */

import type { IndexerApi, PoolSummary } from '@/data/types';
import { allStills, forgetStills } from './stills';

/** The rule, pure: true for a pool whose allocation will never be published. */
export function shouldForgetStills(pool: Pick<PoolSummary, 'state' | 'secret'>): boolean {
  if (pool.state === 'Refunding') return true;
  return pool.state === 'Closed' && !pool.secret;
}

/** Forget what the rule says to forget; answer the pools that were forgotten. */
export async function sweepStills(api: IndexerApi): Promise<string[]> {
  const forgotten: string[] = [];
  const pools = [...new Set((await allStills()).map((s) => s.pool))];
  for (const pool of pools) {
    try {
      const summary = await api.getPool(pool);
      if (summary === null) continue; // not known to the indexer: leave it
      if (shouldForgetStills(summary)) {
        await forgetStills(pool);
        forgotten.push(pool);
      }
    } catch {
      // Unreachable or failed read: leave it.
    }
  }
  return forgotten;
}
