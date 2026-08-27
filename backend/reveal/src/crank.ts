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
  amountForRank,
  base58Decode,
  battlesHash,
  decodeBattleSet,
  decodePayload,
  ExportRefusedError,
  leafBytes,
  merkleRoot,
  potLamports,
  publicKeyOf,
  sealOpen,
  type BattleSet,
  type CiphertextStore,
  type PlayerResult,
  type PoolKeyCustody,
} from './deps';
import { scoreWithMissing, type PoolEntryInput } from './missing';
import type { SettlementChain } from './chain';
import type { BundlePublisher } from './publisher';
import type { RevealBundle, RevealBundleEntry } from './bundle';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

export interface CrankDeps {
  chain: SettlementChain;
  custody: PoolKeyCustody;
  ciphertexts: CiphertextStore;
  publisher: BundlePublisher;
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
  const chainEntries = await deps.chain.getEntries(poolId);
  chainEntries.sort((a, b) => a.index - b.index);
  const keypair = { secretKey: secret, publicKey: publicKeyOf(secret) };
  const bundleEntries: RevealBundleEntry[] = [];
  const scoringInput: PoolEntryInput[] = [];
  const allLosses: string[] = [];

  for (const e of chainEntries) {
    const stored = await deps.ciphertexts.get(poolId, e.player);
    let status = 'ok';
    let battles: BattleSet | null = null;
    let payloadFields: { salt: Uint8Array; timingsMs: readonly number[]; deviceHash: Uint8Array } | null = null;

    if (!stored) {
      status = 'missing_ciphertext';
    } else {
      const opened = sealOpen(stored.ciphertext, keypair);
      if (!opened) {
        status = 'decrypt_failed';
      } else {
        try {
          const payload = decodePayload(opened);
          const h = hex(battlesHash(payload.battles, payload.salt));
          if (h !== e.battlesHash) {
            status = 'hash_mismatch';
          } else {
            battles = payload.battles;
            payloadFields = payload;
          }
        } catch {
          status = 'decrypt_failed';
        }
      }
    }

    if (battles === null) {
      allLosses.push(e.player);
      step('entry:scored-all-losses', { player: e.player, status });
    }
    scoringInput.push({ index: e.index, battles });
    bundleEntries.push({
      player: e.player,
      index: e.index,
      battles: battles ? hex(encode35(battles)) : null,
      salt: payloadFields ? hex(payloadFields.salt) : null,
      timings_ms: payloadFields ? [...payloadFields.timingsMs] : null,
      device_hash: payloadFields ? hex(payloadFields.deviceHash) : null,
      battles_hash: e.battlesHash,
      status,
    });
  }

  // ---- 3. Score + tree ---------------------------------------------------
  const results = scoreWithMissing(scoringInput);
  const byRank = [...results].sort((a, b) => a.rank - b.rank);
  const pot = potLamports(pool.entryLamports);
  const playerAt = (index: number) => chainEntries[index].player;
  const leaves = byRank.map((r) =>
    leafBytes({
      player: base58Decode(playerAt(r.index)),
      rank: r.rank,
      amountLamports: amountForRank(pot, r.rank),
    })
  );
  const root = merkleRoot(leaves);
  const winners = byRank.slice(0, 16).map((r) => playerAt(r.index));
  step('scored', { root: hex(root) });

  // ---- 4. Publish the bundle --------------------------------------------
  const bundle: RevealBundle = {
    version: 1,
    pool_id: poolId.toString(),
    secret: hex(secret),
    entry_lamports: pool.entryLamports.toString(),
    entries: bundleEntries,
    results: byRank.map((r) => ({
      index: r.index,
      player: playerAt(r.index),
      score_half: r.scoreHalf,
      zones: r.zones,
      rank: r.rank,
      amount_lamports: amountForRank(pot, r.rank).toString(),
    })),
    winners,
    results_root: hex(root),
    scored_as_all_losses: allLosses,
  };
  const bundleUri = await deps.publisher.publish(bundle);
  step('published', { uri: bundleUri });

  // ---- 5. Commit ---------------------------------------------------------
  pool = await deps.chain.getPool(poolId);
  if (!pool.resultsCommitted) {
    await deps.chain.commitResults(poolId, root, winners);
    step('commit_results');
  } else {
    step('commit:already');
    // Resume safety: what the chain committed must equal what we recomputed
    // — a divergence means the inputs changed between runs, and paying
    // against it would pay the wrong ranking.
    if (pool.winners.length && JSON.stringify(pool.winners) !== JSON.stringify(winners)) {
      throw new Error(
        `recomputed winners diverge from the committed set for pool ${poolId} — refusing to pay`
      );
    }
  }

  // ---- 6. Pay ------------------------------------------------------------
  pool = await deps.chain.getPool(poolId);
  const batchSize = deps.payBatchSize ?? 4;
  const unpaid: number[] = [];
  for (let rank = 1; rank <= 16; rank++) {
    if ((pool.paidMask & (1 << (rank - 1))) === 0) unpaid.push(rank);
  }
  for (let i = 0; i < unpaid.length; i += batchSize) {
    const batch = unpaid.slice(i, i + batchSize);
    await deps.chain.payPrizes(poolId, batch);
    step('pay_prizes', { ranks: batch });
  }

  pool = await deps.chain.getPool(poolId);
  step('done', { state: pool.state, paidMask: pool.paidMask });
  return { poolId, finalState: pool.state, stepsTaken: steps, bundleUri };
}

/** Encode a battle set back to its canonical 35 bytes (local, tiny). */
function encode35(battles: BattleSet): Uint8Array {
  const out = new Uint8Array(35);
  let o = 0;
  for (const b of battles) for (const v of b) out[o++] = v;
  return out;
}
