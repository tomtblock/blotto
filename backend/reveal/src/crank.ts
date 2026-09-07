/**
 * The settlement crank (roadmap 2.4) — sealed pool in, paid pool out, with
 * no manual step:
 *
 *   export secret → reveal_pool_secret → decrypt every ciphertext → verify
 *   against Entry.battles_hash → publish the reveal bundle → score → build
 *   the results tree → commit_results → pay_prizes in batches → done.
 *
 * IDEMPOTENT AND RESUMABLE: every step reads the pool's CURRENT on-chain
 * state and skips what already happened — a crashed crank rerun on the same
 * pool id continues where the chain says it stopped, and a completed pool is
 * a no-op. The refund fork is also driven here: an Open pool past its
 * deadline (including the export-failure case, TECH-ARCH §5) is triggered
 * and drained.
 *
 * Failure modes (TECH-ARCH §5), implemented and published in the bundle:
 *   - lost ciphertext / decrypt failure / hash mismatch → the entry is
 *     scored as ALL LOSSES (the precise rule in `missing.ts`) and listed in
 *     `scored_as_all_losses`, which is the auditable record of the
 *     fee-refund-from-platform-share obligation (an off-chain payment);
 *   - custody export failure on a still-Open pool past its deadline → the
 *     full-refund path runs instead.
 */

import { sha256 } from '@noble/hashes/sha256';
import {
  assignPrizes,
  base58Decode,
  battlesHash,
  decodeBattleSet,
  decodePayload,
  ExportRefusedError,
  leafBytes,
  merkleRoot,
  publicKeyOf,
  sealOpen,
  type BattleSet,
  type CiphertextStore,
  type PlayerResult,
  type PoolKeyCustody,
} from './deps';
import { scoreWithMissing } from './missing';
import { buildRanking, revealEntries } from './ranking';

/** What the detection pipeline sees per entry (backend/detection). */
export interface RevealedForDetection {
  player: string;
  index: number;
  battles: number[][] | null;
  timingsMs: number[] | null;
  deviceHash: string | null;
  scoreHalf: number;
}
import type { SettlementChain } from './chain';
import type { BundlePublisher } from './publisher';
import type { RevealBundle, RevealBundleEntry } from './bundle';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

export interface CrankDeps {
  chain: SettlementChain;
  custody: PoolKeyCustody;
  ciphertexts: CiphertextStore;
  publisher: BundlePublisher;
  /**
   * Detection hook (R11, roadmap 4.3): given the revealed entries, return
   * the players whose entries must be FLAGGED before any rank is paid.
   * Runs between scoring and payment; absent = no detection (tests that
   * are not about detection).
   */
  detect?: (poolId: bigint, entries: RevealedForDetection[]) => Promise<string[]>;
  /** Structured progress log — the crank narrates every step it takes. */
  log?: (step: string, detail?: Record<string, unknown>) => void;
  /** Ranks per pay_prizes transaction. 4 fits comfortably in one packet. */
  payBatchSize?: number;
}

export interface CrankOutcome {
  poolId: bigint;
  finalState: string;
  stepsTaken: string[];
  bundleUri?: string;
}

/** Run the crank for one pool until it reaches a resting state. */
export async function crankPool(deps: CrankDeps, poolId: bigint): Promise<CrankOutcome> {
  const log = deps.log ?? (() => {});
  const steps: string[] = [];
  const step = (name: string, detail?: Record<string, unknown>) => {
    steps.push(name);
    log(name, { poolId: poolId.toString(), ...detail });
  };

  let pool = await deps.chain.getPool(poolId);

  // ---- Refund fork -------------------------------------------------------
  if (pool.state === 'Open') {
    step('open:not-crankable');
    return { poolId, finalState: pool.state, stepsTaken: steps };
  }
  if (pool.state === 'Refunding') {
    for (const e of await deps.chain.getEntries(poolId)) {
      if (!e.refunded) {
        await deps.chain.refund(poolId, e.player);
        step('refund', { player: e.player });
      }
    }
    pool = await deps.chain.getPool(poolId);
    return { poolId, finalState: pool.state, stepsTaken: steps };
  }
  if (pool.state === 'Closed') {
    step('closed:no-op');
    return { poolId, finalState: pool.state, stepsTaken: steps };
  }

  // ---- 1. Reveal ---------------------------------------------------------
  let secret: Uint8Array;
  try {
    secret = await deps.custody.exportSecret(poolId);
  } catch (e) {
    if (e instanceof ExportRefusedError) {
      // Custody disagrees with what we read from the chain — do nothing
      // rather than fight it; the next run re-reads both.
      step('export-refused');
      return { poolId, finalState: pool.state, stepsTaken: steps };
    }
    throw e;
  }
  if (!pool.secretRevealed) {
    await deps.chain.revealPoolSecret(poolId, secret);
    step('reveal_pool_secret');
  } else {
    step('reveal:already');
  }

  // ---- 2. Decrypt + verify ----------------------------------------------
  // The loop itself lives in ranking.ts, because the next-place driver
  // recomputes the same ranking long after settlement and the two must
  // never disagree.
  const chainEntries = await deps.chain.getEntries(poolId);
  chainEntries.sort((a, b) => a.index - b.index);
  const { bundleEntries, scoringInput, allLosses } = await revealEntries(
    deps.ciphertexts,
    poolId,
    secret,
    chainEntries,
    step
  );

  // ---- 3. Score + prizes + tree ------------------------------------------
  // D3-B: competition ranks (tied players share one), split-pot amounts.
  // The pot is the POOL'S fixed pot (D-A1 revised) — read from chain state,
  // never derived from the entry price.
  const pot = pool.potLamports;
  const results = assignPrizes(scoreWithMissing(scoringInput), pot);
  const playerAt = (index: number) => chainEntries[index].player;
  // Published leaf order (rank asc, entry index asc) is built in one place —
  // see ranking.ts, which the next-place driver reuses to prove against the
  // root committed here.
  const { rows: byRank, root } = buildRanking(results, playerAt);
  // The on-chain payout list: every seat with a nonzero share, seat-sorted.
  const payouts = results
    .filter((r) => r.amountLamports > 0n)
    .sort((a, b) => a.index - b.index)
    .map((r) => ({ entryIndex: r.index, amountLamports: r.amountLamports }));
  step('scored', { root: hex(root), paidSeats: payouts.length });

  // ---- 4. Publish the bundle --------------------------------------------
  const bundle: RevealBundle = {
    version: 1,
    pool_id: poolId.toString(),
    secret: hex(secret),
    entry_lamports: pool.entryLamports.toString(),
    entries: bundleEntries,
    results: byRank.map((r) => ({
      index: r.index,
      player: r.player,
      score_half: r.scoreHalf,
      zones: r.zones,
      rank: r.rank,
      amount_lamports: r.amountLamports.toString(),
    })),
    payouts: payouts.map((p) => ({
      entry_index: p.entryIndex,
      player: playerAt(p.entryIndex),
      amount_lamports: p.amountLamports.toString(),
    })),
    results_root: hex(root),
    scored_as_all_losses: allLosses,
  };
  const bundleUri = await deps.publisher.publish(bundle);
  step('published', { uri: bundleUri });

  // ---- 4b. Detection → flags BEFORE payment (R11) ------------------------
  if (deps.detect) {
    const forDetection: RevealedForDetection[] = bundleEntries.map((e) => ({
      player: e.player,
      index: e.index,
      battles:
        e.battles === null
          ? null
          : Array.from({ length: 7 }, (_, k) =>
              Array.from({ length: 5 }, (_, z) =>
                parseInt((e.battles as string).slice((k * 5 + z) * 2, (k * 5 + z) * 2 + 2), 16)
              )
            ),
      timingsMs: e.timings_ms,
      deviceHash: e.device_hash,
      scoreHalf: results[e.index].scoreHalf,
    }));
    const toFlag = await deps.detect(poolId, forDetection);
    const already = new Set(chainEntries.filter((e) => e.flagged).map((e) => e.player));
    for (const player of toFlag) {
      if (!already.has(player)) {
        await deps.chain.flagEntry(poolId, player);
        step('flag_entry', { player });
      }
    }
  }

  // ---- 5. Commit ---------------------------------------------------------
  pool = await deps.chain.getPool(poolId);
  if (!pool.resultsCommitted) {
    await deps.chain.commitResults(poolId, root, payouts);
    step('commit_results');
  } else {
    step('commit:already');
    // Resume safety: what the chain committed must equal what we recomputed
    // — a divergence means the inputs changed between runs, and paying
    // against it would pay the wrong ranking.
    const committed = pool.payouts.map((p) => `${p.entryIndex}:${p.amountLamports}`).join(',');
    const recomputed = payouts.map((p) => `${p.entryIndex}:${p.amountLamports}`).join(',');
    if (pool.payouts.length && committed !== recomputed) {
      throw new Error(
        `recomputed payouts diverge from the committed list for pool ${poolId} — refusing to pay`
      );
    }
  }

  // ---- 6. Pay ------------------------------------------------------------
  pool = await deps.chain.getPool(poolId);
  const batchSize = deps.payBatchSize ?? 4;
  const unpaid: number[] = [];
  for (const p of pool.payouts) {
    if ((pool.paidMask & (1n << BigInt(p.entryIndex))) === 0n) unpaid.push(p.entryIndex);
  }
  for (let i = 0; i < unpaid.length; i += batchSize) {
    const batch = unpaid.slice(i, i + batchSize);
    await deps.chain.payPrizes(poolId, batch);
    step('pay_prizes', { seats: batch });
  }

  pool = await deps.chain.getPool(poolId);
  step('done', { state: pool.state, paidMask: pool.paidMask.toString() });
  return { poolId, finalState: pool.state, stepsTaken: steps, bundleUri };
}
