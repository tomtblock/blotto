/**
 * The settlement crank (roadmap 2.4) — sealed pool in, paid pool out, with
 * no manual step:
 *
 *   export secret → reveal_pool_secret → decrypt every ciphertext → verify
 *   against Entry.battles_hash → score → build the results tree → screen the
 *   winning wallets → commit_results → pay_prizes in batches → publish the
 *   reveal bundle → done.
 *
 * PUBLICATION COMES LAST, and that ordering is load-bearing. It used to run
 * before the commit, so an upload that kept failing aborted the crank — and
 * a Sealed pool cannot be refunded, so the pot and the whole tier were stuck
 * behind a storage vendor. Verifiability is not a payment step; a bundle
 * still owed is recoverable, a frozen tier is not.
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
import type { ScreenWinners } from './winner-screening';

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
  /**
   * Winner screening (Phase 2 Stage F): given the wallets about to be paid,
   * return the ones to place a `sanctions_hold` on. Runs between the payout
   * list being known and `commit_results`, so a hold is always in place
   * before `pay_prizes` can send the share. Absent = no screening (tests
   * that are not about it); the daemon's `main.ts` always supplies it, and
   * refuses to boot with no source configured.
   */
  screenWinners?: ScreenWinners;
  /** Structured progress log — the crank narrates every step it takes. */
  log?: (step: string, detail?: Record<string, unknown>) => void;
  /** Ranks per pay_prizes transaction. 4 fits comfortably in one packet. */
  payBatchSize?: number;
  /**
   * How many entries may be unreadable before the crank refuses to settle
   * the pool at all. Absent means "all but one": a field in which every
   * single entry failed is a systems failure, not a set of player mistakes,
   * and committing against it is irreversible. A ratified figure between one
   * and all belongs here — see the guard in `crankPool`.
   */
  maxUnreadableEntries?: number;
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

  // The Pool account and the Entry accounts are two separate reads, and an
  // RPC backend can answer the second from a slot behind the first. A short
  // result is not an error to any of them: the entries are gapless from
  // seat 0, so the downstream index check passes, the missing seats are
  // simply the ones registered last, and the pot is committed against a
  // field that is short a paying player. `commit_results` cannot be re-run,
  // so there is no recovery. Wait instead — the sweep retries a throwing
  // pool on the next tick, and a stale read is exactly what waiting fixes.
  if (chainEntries.length !== pool.entrants) {
    throw new Error(
      `pool ${poolId} reports ${pool.entrants} entrants but only ` +
        `${chainEntries.length} Entry accounts were read — refusing to settle ` +
        `against an incomplete field`
    );
  }

  const { bundleEntries, scoringInput, allLosses } = await revealEntries(
    deps.ciphertexts,
    poolId,
    secret,
    chainEntries,
    step
  );

  // An entry that cannot be decrypted or does not match its on-chain hash is
  // scored all losses by a published rule, and one of those is a player
  // problem. ALL of them is ours: a wiped or restored ciphertext table, a
  // replica behind, a custody key that does not match the one entries were
  // sealed to. The arithmetic does not notice — every seat ties on zero, the
  // pot divides evenly, conservation holds — so without this the crank
  // commits and pays a result it has every reason to distrust, and paying is
  // final.
  //
  // PHASE-6-REVIEW: the ceiling is a founder-owned number and is NOT set
  // here. The default refuses only a field that is entirely unreadable,
  // which is a logical boundary rather than a tuning choice; anything
  // between one bad entry and all of them needs a ratified figure.
  const unreadable = allLosses.length;
  const ceiling = deps.maxUnreadableEntries ?? Math.max(chainEntries.length - 1, 0);
  if (chainEntries.length > 0 && unreadable > ceiling) {
    throw new Error(
      `pool ${poolId}: ${unreadable} of ${chainEntries.length} entries could not ` +
        `be read back (ceiling ${ceiling}) — refusing to commit a result the ` +
        `crank cannot stand behind`
    );
  }

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

  // ---- 4. Assemble the bundle (published at step 7, after the money) ----
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

  // ---- 4c. Screen the winners → holds BEFORE payment (Stage F) ----------
  // The published promise: "during resolving we check the winning wallet
  // against published sanctions lists". Every wallet in the committed payout
  // list is screened — a tie for first has several, and each is a winning
  // wallet. A hold makes `pay_prizes` escrow that share instead of sending
  // it, so it must be placed before the pool is paid, and it is placed
  // before `commit_results` so a crank that dies between the two resumes
  // with the hold already on-chain.
  //
  // A hold is NOT a flag. Nothing here calls `flagEntry`, nothing here is
  // published as an integrity finding, and no path here moves a lamport.
  if (deps.screenWinners) {
    const winners = payouts.map((p) => playerAt(p.entryIndex));
    const held = new Set(chainEntries.filter((e) => e.sanctionsHold).map((e) => e.player));
    const holds = await deps.screenWinners(poolId, winners);

    // A screener that merely FAILED TO ANSWER is not a match, and the
    // on-chain hold cannot tell the two apart — it is one boolean. Placing
    // it on a vendor outage withheld a legitimate winner's entire share
    // with no way back: `release_escrow` refuses on both paths while a hold
    // is set, the daemon's review clock only revisits FLAGGED entries, and
    // the pool counts as terminal so no later tick re-screens. The only
    // exit was an admin-signed lift that nobody was told was needed.
    //
    // So an unavailable screener is a retryable condition, not a verdict.
    // Leave the pool short of commit and let the sweep come back: nothing
    // has been paid, nothing is stranded, and the next tick screens again.
    const unavailable = holds.filter((h) => h.reason === 'screening_unavailable');
    if (unavailable.length > 0) {
      step('screening-unavailable', {
        players: unavailable.map((h) => h.player),
        errors: unavailable.map((h) => h.error ?? ''),
      });
      throw new Error(
        `pool ${poolId}: sanctions screening could not answer for ` +
          `${unavailable.length} winner(s) — refusing to commit, and refusing to ` +
          `record a vendor outage as a hold. The next tick screens again.`
      );
    }

    for (const h of holds) {
      // Idempotent: the program refuses a second placement, and a resumed
      // crank must not turn its own earlier hold into a crash.
      if (held.has(h.player)) {
        step('sanctions_hold:already', { player: h.player, reason: h.reason });
        continue;
      }
      await deps.chain.placeSanctionsHold(poolId, h.player);
      step('place_sanctions_hold', {
        player: h.player,
        reason: h.reason,
        lists: h.matches.map((m) => `${m.source}/${m.listName}`),
        ...(h.error ? { error: h.error } : {}),
      });
    }
    step('winners-screened', { screened: winners.length, held: holds.length });
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

  // ---- 7. Publish the bundle --------------------------------------------
  // AFTER the money, deliberately. Publishing is a verifiability step, not a
  // payment step, and it used to run before `commit_results`: an upload that
  // kept failing — an unfunded upload wallet, a gateway outage — aborted the
  // whole crank, and a Sealed pool cannot be refunded, so the pot and the
  // tier were stuck until the upload succeeded. Ordering it last cannot
  // strand anything; a failure here leaves a paid pool with its bundle still
  // to come, which the next tick or the archive backfill picks up.
  let bundleUri: string | undefined;
  try {
    bundleUri = await deps.publisher.publish(bundle);
    step('published', { uri: bundleUri });
  } catch (e) {
    // Recorded, not thrown. The players have their money; the published
    // record is owed and is not worth freezing a tier over.
    step('publish-failed', { error: e instanceof Error ? e.message : String(e) });
  }

  pool = await deps.chain.getPool(poolId);
  step('done', { state: pool.state, paidMask: pool.paidMask.toString() });
  return { poolId, finalState: pool.state, stepsTaken: steps, bundleUri };
}
