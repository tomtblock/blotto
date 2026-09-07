/*
 * The ONE place a pool's state becomes a label (Phase 2 Stage C). Before
 * this, the pill was inline JSX in two pages rendering `pool.state` raw;
 * a third copy for "resolving" would have been the wrong fix. Resolving is
 * not a `PoolState` — it is derived by the read API from held shares and
 * the published window — so the label reads the flag first and the
 * on-chain state otherwise. Pure, so it is unit-tested without a render.
 */

import { COPY } from '@/copy';
import type { PoolSummary } from '@/data/types';

export type PoolStateLabelInput = Pick<PoolSummary, 'state'> & Partial<Pick<PoolSummary, 'resolving'>>;

/** The pill text: the derived RESOLVING badge when the read API says so,
 * else the on-chain state name as the projection wrote it. */
export function poolStateLabel(pool: PoolStateLabelInput): string {
  return pool.resolving === true ? COPY.pool.resolving : pool.state;
}
