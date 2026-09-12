/**
 * The daemon's priority-fee sampler (audit 2026-09-11, C-34).
 *
 * Every settlement transaction — `pay_prizes`, `commit_results`,
 * `release_escrow`, `pay_next_place`, the keeper's opens — went out with a
 * compute-unit LIMIT and no compute-unit PRICE, while the browser's entry
 * path has bid the 75th percentile of recent fees since 10.B. Under
 * congestion that is exactly backwards: the player's entry lands and the
 * payout that follows it does not. The choice itself is shared with the
 * browser (`_shared/src/priority-fee.ts`); this file is the daemon's way of
 * feeding it samples: one RPC read, cached for a short while so a tick that
 * sends several transactions asks once, and the floor when the RPC will not
 * answer — a fee estimate must never be the reason a payout is not attempted.
 */

import {
  PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS,
  pickPriorityFee,
} from '../../_shared/src/priority-fee';

/** The slice of a web3.js `Connection` the sampler uses. */
export interface PriorityFeeSource {
  getRecentPrioritizationFees(opts?: {
    lockedWritableAccounts?: unknown[];
  }): Promise<readonly { prioritizationFee: number }[]>;
}

export interface PriorityFeeSamplerOptions {
  /** How long one sample serves (default 30 s — a tick's worth of sends). */
  cacheMs?: number;
  nowMs?: () => number;
  /** The accounts competing transactions must lock; the program id is a fair proxy. */
  lockedWritableAccounts?: unknown[];
}

/**
 * Returns a function the chain client calls before each send. Micro-lamports
 * per compute unit, integer, never a float.
 */
export function makePriorityFeeSampler(
  source: PriorityFeeSource,
  opts: PriorityFeeSamplerOptions = {}
): () => Promise<bigint> {
  const cacheMs = opts.cacheMs ?? 30_000;
  const nowMs = opts.nowMs ?? Date.now;
  let cached: { at: number; fee: bigint } | null = null;
  return async () => {
    const t = nowMs();
    if (cached && t - cached.at < cacheMs) return cached.fee;
    let fee: bigint;
    try {
      const samples = await source.getRecentPrioritizationFees(
        opts.lockedWritableAccounts ? { lockedWritableAccounts: opts.lockedWritableAccounts } : undefined
      );
      fee = pickPriorityFee(samples.map((s) => BigInt(s.prioritizationFee)));
    } catch {
      fee = PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS;
    }
    cached = { at: t, fee };
    return fee;
  };
}
