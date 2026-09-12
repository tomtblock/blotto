/*
 * Priority-fee strategy (10.B deliverable per frontend PRD §5, spec'd here
 * at execution time per the standing idiom-check flag).
 *
 * Chosen v1: `getRecentPrioritizationFees` over the transaction's writable
 * accounts, 75th percentile of the NON-ZERO fees in the ~150-slot window,
 * clamped to a floor and cap. Rationale and rejected alternatives:
 *
 *  (a) vanilla getRecentPrioritizationFees + percentile (CHOSEN) — works on
 *      every RPC provider including the public devnet endpoint the app
 *      falls back to; no vendor lock-in; one round-trip. The method returns
 *      each slot's MINIMUM landed fee, so percentiles under-estimate under
 *      congestion — acceptable for v1 where devnet fees are ~0 and the
 *      floor dominates; revisit against mainnet data in 10.F.
 *  (b) Helius getPriorityFeeEstimate — better estimates, but ties the seam
 *      to a Helius-keyed endpoint; the browser bundle must keep working on
 *      the public fallback. Rejected for v1, noted as the likely mainnet
 *      upgrade.
 *  (c) Triton percentile extension / bloXroute etc. — provider-specific
 *      RPC extensions; same lock-in objection.
 *  (d) static fee — simplest, but §5 explicitly asks for dynamic fees per
 *      network conditions.
 *
 * All constants are PROVISIONAL and founder-tunable (they are client-side
 * spend/latency knobs, not on-chain economics — same footing as Q-031's
 * buffer: never enters a config struct).
 */

import type { Address } from "@solana/kit";
import type { TxRpc } from "./tx-rpc";
import {
  PROVISIONAL_PRIORITY_FEE_CAP_MICROLAMPORTS,
  PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS,
  PROVISIONAL_PRIORITY_FEE_PERCENTILE,
  pickPriorityFee,
} from "@blotto/shared/priority-fee";

/*
 * The percentile, the floor, the cap and `pickPriorityFee` itself moved to
 * `backend/_shared/src/priority-fee.ts` on 2026-09-12 (audit 2026-09-11,
 * C-34) so the settlement daemon bids the same way the browser does. They
 * are re-exported here unchanged; everything below is the browser-only half.
 */
export {
  PROVISIONAL_PRIORITY_FEE_CAP_MICROLAMPORTS,
  PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS,
  PROVISIONAL_PRIORITY_FEE_PERCENTILE,
  pickPriorityFee,
};

/** PROVISIONAL: CU limit fallback when simulation yields no estimate. */
export const PROVISIONAL_CU_LIMIT_FALLBACK = 400_000;

/** PROVISIONAL: headroom over simulated CU (bps of the simulated value). */
export const PROVISIONAL_CU_MARGIN_BPS = 2_000n; // +20%

/** Solana's per-transaction compute ceiling — a protocol fact, not a knob. */
export const MAX_CU_LIMIT = 1_400_000;

/**
 * Live estimate for a transaction touching `writableAccounts` (the accounts
 * competing transactions must lock — pass account addresses, not program
 * IDs). RPC failure degrades to the floor: a fee estimate must never be the
 * reason a trade cannot be attempted.
 */
export async function estimatePriorityFeeMicroLamports(
  rpc: TxRpc,
  writableAccounts: Address[],
): Promise<bigint> {
  try {
    const fees = await rpc.getRecentPrioritizationFees(writableAccounts);
    return pickPriorityFee(fees);
  } catch {
    return PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS;
  }
}

/**
 * CU limit from a simulation's `unitsConsumed`, with margin, clamped to the
 * protocol max; the conservative fallback when simulation gave no number.
 */
export function cuLimitFromSimulation(unitsConsumed: bigint | null): number {
  if (unitsConsumed === null || unitsConsumed <= 0n) {
    return PROVISIONAL_CU_LIMIT_FALLBACK;
  }
  const withMargin =
    unitsConsumed + (unitsConsumed * PROVISIONAL_CU_MARGIN_BPS) / 10_000n;
  return withMargin > BigInt(MAX_CU_LIMIT)
    ? MAX_CU_LIMIT
    : Number(withMargin);
}
