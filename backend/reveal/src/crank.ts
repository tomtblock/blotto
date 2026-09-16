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
 *     `scored_as_all_losses`. The remedy is spelled out below;
 *   - custody export failure on a still-Open pool past its deadline → the
 *     full-refund path runs instead.
 *
 * # The lost-ciphertext remedy, in full (audit 2026-09-11, D-45)
 *
 * The published rule says that player's entry fee is refunded. NOTHING IN
 * THIS CODEBASE PAYS IT. A human has to, and this is what they have and what
 * they must do — previously the code recorded the debt and said nothing about
 * discharging it, which is how a published promise quietly goes unkept.
 *
 * What the operator has, without asking anyone:
 *   - the alert `reveal entry refund owed after lost ciphertext`
 *     (`ALERT.reveal.entryRefundOwed`), raised once per affected pool below,
 *     carrying `poolId`, `players` (base58) and `entryLamports`;
 *   - the published bundle for that pool: `scored_as_all_losses` is the same
 *     player list, `entry_lamports` the amount owed to EACH of them, and the
 *     matching `entries[]` row carries the `status` that explains why
 *     (`missing_ciphertext` | `decrypt_failed` | `hash_mismatch`);
 *   - the chain: each player's `Entry` PDA for that pool, which proves the
 *     entry was paid for.
 *
 * What they must do, and why no code does it for them: there is no
 * instruction that refunds ONE entry of a sealed pool. `refund` only runs on
 * a pool in `Refunding`, and a pool that reached settlement can never enter
 * that state; the prize vault holds the pot for the winner and has no exit
 * that could pay a non-winner. The money owed is the ENTRY, which lives in
 * the platform treasury, and the treasury has exactly one exit —
 * `withdraw_platform`, admin-signed (Squads) and floor-gated. So the payment
 * is one admin transaction per owed player, destination = that player's
 * wallet, amount = `entry_lamports`:
 *
 *   npx ts-node --transpile-only scripts/admin.ts withdraw-platform \
 *     --amount <entry_lamports> --destination <player> --emit-proposal
 *
 * then approve it in Squads and record the signature against the pool in the
 * runbook. Do NOT wait for a code path to appear: until the indexer carries
 * the obligation as a table and the admin CLI grows a command for it (plan
 * batch I1), the alert plus the bundle IS the ledger, and an unpaid entry is
 * a broken published promise rather than a deferred feature.
 * `docs/OPERATING-MANUAL.md` §7 ("An entry was scored as all losses") is the
 * operator-facing copy of this.
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
import type { SettlementChain, ChainEntryView, ChainPoolView } from './chain';
import type { BundlePublisher } from './publisher';
import type { PublishedBundleStore } from './published-store';
import type { RevealBundle, RevealBundleEntry } from './bundle';
import { ALERT } from '../../_shared/src/metrics';
import type { Monitor } from '../../_shared/src/monitor';
import { short } from '../../_shared/src/short';
import type { RevealedEntryForDetection } from './ranking';

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
  /**
   * The daemon's memory of published bundles (published-store.ts, audit
   * 2026-09-11 C-09 / B-32 / D-27). With it, a bundle already on record is
   * never uploaded again and every upload is recorded; without it (tests
   * that are not about publication) the crank publishes as it always did.
   */
  published?: PublishedBundleStore;
  /** Alerts (audit 2026-09-11, C-12 / E-04). Optional; silent without. */
  monitor?: Monitor;
  /** Unix seconds for the publish record (tests inject). */
  nowUnix?: () => bigint;
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

  // ---- 1-4. Reveal, decrypt, score, assemble ----------------------------
  // Shared with `publishBundle`, the publish-only path a Paid pool that still
  // owes its bundle goes through (2026-09-12) — see `assembleBundle`.
  const assembled = await assembleBundle(deps, poolId, pool, step);
  if (assembled === 'export-refused') {
    return { poolId, finalState: pool.state, stepsTaken: steps };
  }
  const { chainEntries, forDetection, allLosses, results, payouts, root, bundle, playerAt } =
    assembled;

  // The published lost-ciphertext rule leaves an obligation behind: the entry
  // fee of every all-losses seat is OWED from the platform treasury, off
  // chain. The bundle records who; until 2026-09-12 nothing else said so
  // (audit 2026-09-11, C-12) — the alert is the operator's cue, and the
  // manual's §7 says what to do with it.
  if (allLosses.length > 0) {
    // Truncated, never the whole wallets (2026-09-16, data minimisation): an
    // alert can be forwarded off-box. The bundle's `scored_as_all_losses` is
    // the full list the manual's §7 pays from, so shortening here loses nothing.
    deps.monitor?.alert(ALERT.reveal.entryRefundOwed, {
      poolId: poolId.toString(),
      count: allLosses.length,
      players: allLosses.map((p) => short(p)),
      entryLamports: pool.entryLamports.toString(),
    });
  }

  // ---- 4b. Detection → flags BEFORE payment (R11) ------------------------
  if (deps.detect) {
    // From the sealed payload's detection channel (ranking.ts), never from
    // the bundle: the published bundle carries neither the timings nor the
    // device hash (version 2, audit B-31), and the battles arrive decoded.
    const detectionInput: RevealedForDetection[] = forDetection.map((e) => ({
      player: e.player,
      index: e.index,
      battles: e.battles === null ? null : e.battles.map((b) => [...b]),
      timingsMs: e.timingsMs,
      deviceHash: e.deviceHash,
      scoreHalf: results[e.index].scoreHalf,
    }));
    const toFlag = await deps.detect(poolId, detectionInput);
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
  //
  // Since 2026-09-12 the upload is guarded by the daemon's record of
  // published bundles (C-09 / B-32 / D-27): a bundle already on record is
  // not uploaded again, and a successful upload is recorded so the daemon's
  // "bundle owed" pass can tell a paid-and-published pool from a
  // paid-and-unpublished one — the case that used to be forgotten.
  let bundleUri: string | undefined;
  try {
    bundleUri = await publishWithRecord(deps, poolId, bundle, step);
  } catch (e) {
    // Recorded, not thrown. The players have their money; the published
    // record is owed and is not worth freezing a tier over.
    step('publish-failed', { error: e instanceof Error ? e.message : String(e) });
  }

  pool = await deps.chain.getPool(poolId);
  step('done', { state: pool.state, paidMask: pool.paidMask.toString() });
  return { poolId, finalState: pool.state, stepsTaken: steps, bundleUri };
}

/** What steps 1-4 of the crank produce, shared with the publish-only path. */
interface AssembledBundle {
  chainEntries: ChainEntryView[];
  forDetection: RevealedEntryForDetection[];
  allLosses: string[];
  results: PlayerResult[];
  payouts: { entryIndex: number; amountLamports: bigint }[];
  root: Uint8Array;
  bundle: RevealBundle;
  playerAt: (index: number) => string;
}

/**
 * Steps 1-4 of the crank — reveal the secret, decrypt and verify every
 * entry, score, and assemble the bundle — as one function, because the
 * publish-only path needs exactly these and nothing after them: no
 * detection, no winner screening, no commit, no payment. Returns
 * 'export-refused' when custody and the chain disagree about whether the
 * pool may be revealed (the crank then does nothing and re-reads next run).
 */
async function assembleBundle(
  deps: CrankDeps,
  poolId: bigint,
  pool: ChainPoolView,
  step: (name: string, detail?: Record<string, unknown>) => void
): Promise<AssembledBundle | 'export-refused'> {
  // ---- 1. Reveal ---------------------------------------------------------
  let secret: Uint8Array;
  try {
    secret = await deps.custody.exportSecret(poolId);
  } catch (e) {
    if (e instanceof ExportRefusedError) {
      step('export-refused');
      return 'export-refused';
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

  const { bundleEntries, forDetection, scoringInput, allLosses } = await revealEntries(
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
    version: 2,
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

  return { chainEntries, forDetection, allLosses, results, payouts, root, bundle, playerAt };
}

/**
 * Upload the bundle unless the record already has one for this pool, and
 * record a successful upload. Throws on an upload failure; the callers decide
 * what a failure means (the crank: recorded, not fatal; the daemon's owed
 * pass: a retry later, an alert after several).
 */
async function publishWithRecord(
  deps: CrankDeps,
  poolId: bigint,
  bundle: RevealBundle,
  step: (name: string, detail?: Record<string, unknown>) => void
): Promise<string> {
  const known = await deps.published?.find(poolId);
  if (known) {
    step('publish:already', { uri: known });
    return known;
  }
  const uri = await deps.publisher.publish(bundle);
  const nowUnix = deps.nowUnix ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  await deps.published?.record(poolId, uri, nowUnix());
  step('published', { uri });
  return uri;
}

/**
 * The publish-only path (2026-09-12, audit C-09 / B-32 / D-27): a Paid pool
 * whose bundle is not on record gets it published without re-running
 * detection, winner screening, commit or payment — the daemon's "bundle
 * owed" pass calls this on a backoff. Refuses any pool that is not Paid: an
 * unsettled pool's bundle is the crank's to publish, after the money.
 */
export async function publishBundle(deps: CrankDeps, poolId: bigint): Promise<string> {
  const log = deps.log ?? (() => {});
  const step = (name: string, detail?: Record<string, unknown>) => {
    log(name, { poolId: poolId.toString(), ...detail });
  };
  const pool = await deps.chain.getPool(poolId);
  if (pool.state !== 'Paid') {
    throw new Error(`pool ${poolId} is ${pool.state}, not Paid — nothing is owed yet`);
  }
  const assembled = await assembleBundle(deps, poolId, pool, step);
  if (assembled === 'export-refused') {
    throw new Error(`pool ${poolId}: custody refused the export of a Paid pool's secret`);
  }
  return publishWithRecord(deps, poolId, assembled.bundle, step);
}
