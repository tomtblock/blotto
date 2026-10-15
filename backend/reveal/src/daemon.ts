/**
 * The settlement-and-keeper daemon (C8, decision D-C 2026-08-27) — the one
 * long-running process the product loop needs:
 *
 *   - SETTLE: every Sealed pool goes through the crank (2.4) to Paid; an
 *     Open pool past its deadline is sealed and cranked when it holds the
 *     minimum field (52..63 entrants, D-E4) and refund-triggered and
 *     drained when it does not.
 *   - THE REVIEW CLOCK (Phase 2 Stage D): the rules page's "if no decision
 *     is made within 12 hours, the flag is cleared and the prize is paid".
 *     A settled pool's flagged, still-escrowed, not-forfeited share is
 *     released to its player once `REVIEW_WINDOW_SECS` has passed since
 *     the on-chain `escrowed_at` — the settlement signer's reviewed path
 *     of `release_escrow`. A pool with such a share outstanding is NOT
 *     terminal for the sweep, so the floor holds and every tick re-checks
 *     it until the last hold is decided or released. Mechanically the flag
 *     bit stays set (`clear_flag` refuses a settled entry by design); the
 *     escrow falling to zero is the record that review ended without an
 *     upheld flag. A share escrowed for KYC alone (not flagged) is left
 *     to its packet. A FORFEITED share is never released here — it is the
 *     next-place step's, below. Two more holds the clock leaves in place
 *     (2026-09-12, audit 2026-09-11): a share under a SANCTIONS hold, which
 *     the program refuses to release on either path (B-30), and a share
 *     whose reviewer has already logged a FORFEIT that has not yet landed
 *     on chain (D-03) — with a decision reader wired, the clock asks the
 *     log before it pays, and alerts once the window passes with the
 *     forfeit still unlanded.
 *   - THE BUNDLE OWED (2026-09-12, audit C-09 / B-32 / D-27): a Paid pool
 *     with no published bundle on record is retried, on a backoff, through
 *     the crank's publish-only path, and announced when it lands. Until
 *     then a failed publish was never retried, because Paid was terminal.
 *   - THE NEXT-PLACE STEP (audit O23): a share whose flag review UPHELD is
 *     divided among the eligible players at the rank it passes to, with
 *     `pay_next_place`. Until this existed the program could do it and
 *     nothing asked, so an upheld share sat in the vault indefinitely.
 *   - KEEP: every open tier always has exactly one Open pool. Once a
 *     tier's slot frees (the pool reaches Paid or Closed — sequential
 *     pools, D-A1 revised — which clears `Config.active_pool_by_tier`) AND
 *     its cooldown has elapsed (`Config.tier_next_open_at`, prompt v2
 *     §B.6 — five minutes at launch), the next tick opens the successor:
 *     sealing key from custody → `open_pool` (keeper-signed, prompt v2 §A)
 *     → `commit_vrf_seed` → `create_pass_collection`.
 *
 * POLL-BASED AND IDEMPOTENT. There is no local database: every tick reads
 * the chain's CURRENT state and does only what is missing, so a crashed
 * daemon resumes by simply starting again, and two daemons running at once
 * cannot corrupt anything — the program's own guards (gapless pool ids, one
 * Open pool per tier, write-once VRF seed, write-once collection PDA, the
 * paid-mask) reject the loser's transaction, the daemon logs the rejection
 * and the next tick observes the winner's result. Every per-pool and
 * per-tier failure is caught and reported; one broken pool never stops the
 * sweep or the keeper.
 *
 * Crash windows the keeper closes on resume:
 *   - after `createPoolKey`, before `open_pool` landed → custody's
 *     `getPublishedKey` republishes the SAME key (the hash committed
 *     on-chain must match the secret custody holds);
 *   - after `open_pool`, before VRF or the collection → the tier's active
 *     pool is Open but incomplete; the tick commits the seed and creates
 *     the collection before anything else. `register` requires the VRF
 *     seed, so an incomplete pool cannot take entries — completion is the
 *     keeper's job, not the player's problem.
 *
 * The production PROCESS entry (env wiring, Turnkey custody, the Irys
 * publisher, the Switchboard coordinator) lands with the C11/C12 adapters;
 * this module is the whole behavior, driven by seams — the same posture the
 * crank itself took in Phase 2.
 */

import { MIN_SEATS, REVIEW_WINDOW_SECS } from '../../scoring/src';
import { ALERT, METRIC } from '../../_shared/src/metrics';
import type { Monitor } from '../../_shared/src/monitor';
import type { KeeperChain, PoolStateName } from './chain';
import type { PublishedBundleStore } from './published-store';
import { planNextPlace, payNextPlacePortions, type NextPlacePaid } from './next-place';
import { recomputeRanking } from './ranking';
import { boardModeOf } from './deps';
import { nextOpenable, type TierPoolStates } from './treasury';
import type { CrankOutcome } from './crank';
import type { CiphertextStore, PoolKeyCustody } from './deps';

/**
 * Owns landing `commit_vrf_seed` for one pool — the whole Switchboard
 * On-Demand flow (create the Randomness account, commit, reveal, and bundle
 * the reveal with the program's commit in one transaction). The production
 * adapter is C11 vendor work; `StubVrfCoordinator` covers tests and the
 * e2e bench's injected fixtures.
 */
export interface VrfCoordinator {
  commitSeed(poolId: bigint): Promise<void>;
}

/** Drives `commitVrfSeed` with a fixed Randomness account — for FakeChain
 * tests and benches where the reveal is arranged out of band. */
export class StubVrfCoordinator implements VrfCoordinator {
  constructor(
    private readonly chain: KeeperChain,
    private readonly randomnessAccount: string
  ) {}
  async commitSeed(poolId: bigint): Promise<void> {
    await this.chain.commitVrfSeed(poolId, this.randomnessAccount);
  }
}

export interface DaemonDeps {
  chain: KeeperChain;
  custody: PoolKeyCustody;
  /** The sealed entries — the next-place step recomputes a settled pool's
   * published ranking from these plus the pool secret, rather than fetching
   * a bundle back (see ranking.ts). The crank already receives its own
   * handle to the same store. */
  ciphertexts: CiphertextStore;
  /**
   * Who commits a pool's VRF seed, or `null` for none (R22, 2026-10-15).
   * Production passes `null`: Switchboard, the only oracle wired, shut down,
   * and `register` no longer waits for a seed — the class draw runs on its
   * other four inputs. A coordinator is still accepted (tests, bench, a
   * future provider); `commit_vrf_seed` only lands before the first entry.
   */
  vrf: VrfCoordinator | null;
  /** Run the settlement crank for one pool (crank.ts composed with its own
   * deps; injectable so daemon tests can observe or fail it). */
  crank: (poolId: bigint) => Promise<CrankOutcome>;
  /**
   * E3 §4.4 (live path): tell the indexer where a settled pool's bundle
   * was published, so the archive verifies it without waiting for the
   * backfill. OPTIONAL AND FIRE-SAFE: the crank's outcome is already on
   * chain and on Irys before this runs; a failed or absent announce costs
   * only archive freshness (the backfill discovers by tag), so a throw
   * here is logged as a tick error and never blocks the sweep.
   */
  announceBundle?: (poolId: bigint, bundleUri: string) => Promise<void>;
  /**
   * A read-only view of the review decision log (audit 2026-09-11, D-03).
   * OPTIONAL: without it the review clock trusts the chain alone, exactly as
   * before. With it, a share whose reviewer has logged a forfeit is never
   * released by the clock, however late the on-chain forfeit is.
   */
  decisions?: DecisionReader;
  /**
   * The daemon's memory of published bundles (published-store.ts). OPTIONAL:
   * without it the "bundle owed" pass is off and a Paid pool is terminal
   * the moment it pays, as before 2026-09-12.
   */
  published?: PublishedBundleStore;
  /**
   * The crank's publish-only path for a Paid pool that owes its bundle —
   * reveal, decrypt, score, assemble, upload — with no detection, no winner
   * screening and no payment. Required whenever `published` is set.
   */
  publishOwed?: (poolId: bigint) => Promise<string>;
  /** Wall-clock milliseconds for the publish backoff (tests inject). */
  nowMs?: () => number;
  /** Backoff between publish attempts for one pool (default ten minutes). */
  publishRetryMs?: number;
  /** Metrics and alerts (audit 2026-09-11, E-04). Optional; silent without. */
  monitor?: Monitor;
  /** Unix seconds — compared against `Pool.fill_deadline` (R7). */
  now: () => bigint;
  log?: (step: string, detail?: Record<string, unknown>) => void;
  /** Lowest pool id the sweep ever considers (default 1n — ids are gapless
   * from 1). A redeploy against a long history can start higher. */
  startPoolId?: bigint;
}

/** What the review clock asks the decision log (D-03). */
export interface DecisionReader {
  /** True when a reviewer's `forfeit` decision is on record for this entry. */
  forfeitLogged(poolId: bigint, player: string): Promise<boolean>;
}

/**
 * Backoff between publish attempts for a Paid pool that owes its bundle, and
 * how many failures raise the alert. Ten minutes is the audit's own
 * complaint turned into a number: the fault it names was an upload every
 * fifteen seconds while a pool sat stuck.
 */
export const PUBLISH_RETRY_MS = 10 * 60_000;
export const PUBLISH_ALERT_AFTER = 3;

export interface DaemonError {
  action: string;
  poolId?: string;
  tier?: number;
  message: string;
}

export interface TickReport {
  /** Pools opened this tick, with their tier and ladder (0 easy, 1 hard). */
  opened: { poolId: bigint; tier: number; mode: number }[];
  /** Pools the crank ran for, with the state each rested at. */
  cranked: { poolId: bigint; finalState: string }[];
  /** Open pools past deadline whose refund fork this tick triggered (fewer
   * than 52 entrants, D-E4). */
  refundsTriggered: bigint[];
  /** Open pools past deadline this tick sealed at 52..63 entrants (D-E4);
   * each is cranked in the same tick. */
  sealedAtDeadline: bigint[];
  /** Launch-completion steps performed (VRF commits, collections). */
  completed: { poolId: bigint; step: 'vrf' | 'pass_collection' }[];
  /** Held shares released to their players by the review clock this tick
   * (Phase 2 Stage D): the twelve-hour window passed with no decision. */
  released: { poolId: bigint; player: string }[];
  /** Portions of upheld-flag shares paid on to the next eligible place this
   * tick (audit O23). One entry per recipient, not per forfeiter. */
  nextPlacePaid: NextPlacePaid[];
  /** Held shares the review clock deliberately left in place this tick and
   * why: a sanctions hold the program would refuse to release, or a forfeit
   * already in the decision log (2026-09-12). */
  held: { poolId: bigint; player: string; reason: 'sanctions_hold' | 'forfeit_logged' }[];
  /** Bundles the "bundle owed" pass published this tick (2026-09-12). */
  published: { poolId: bigint; uri: string }[];
  /** Every caught failure — the tick continues past each. */
  errors: DaemonError[];
}

const TERMINAL = new Set(['Paid', 'Closed']);

/**
 * Per-iteration hooks for `run` — what the deployment entry needs to do
 * around each tick, without owning a loop of its own.
 *
 * THE DEFECT THESE CLOSE (audit 2026-09-11, A-23). `run` is the loop the
 * daemon suite drives; production ran a SECOND, hand-written `for (;;)` in
 * `main.ts` because it had per-tick work `run` could not express — refresh
 * the chain-clock cache, record the tick into `/health`, re-read the
 * settlement balance, log each tick error, raise the stale-tick alert. So
 * the tested loop was dead code and the live loop was untested, which is the
 * wrong way round for the process that moves every prize.
 *
 * Every hook is optional and every one is failure-isolated in the sense that
 * matters: a throw from `beforeTick` or `afterTick` is caught by the same
 * handler a throwing tick is (it IS a failed tick — the daemon retries next
 * interval), and a throw from `onTickError` or `afterIteration` is logged and
 * swallowed, because a loop that dies on its own book-keeping strands pools.
 */
export interface LoopHooks {
  /** Before the tick, inside the try: preparation the tick depends on. */
  beforeTick?: () => Promise<void> | void;
  /** After a tick that returned, with its report. */
  afterTick?: (report: TickReport) => Promise<void> | void;
  /** The tick, or either hook above, threw. The loop continues regardless. */
  onTickError?: (err: unknown) => void;
  /** After every iteration, succeeded or failed, before the sleep. */
  afterIteration?: () => void;
}

export interface Daemon {
  /** One pass: settle everything settleable, then top up every open tier. */
  tick(): Promise<TickReport>;
  /** Poll loop: tick, sleep, repeat until the signal aborts. A throwing
   * tick (e.g. RPC down) is logged and retried next interval. THE ONLY
   * LOOP — the production entry drives this one through `hooks` rather than
   * writing its own (audit 2026-09-11, A-23). */
  run(intervalMs: number, signal?: AbortSignal, hooks?: LoopHooks): Promise<void>;
}

export function makeDaemon(deps: DaemonDeps): Daemon {
  const log = deps.log ?? (() => {});
  // Sweep floor: every pool below it was seen terminal (Paid/Closed).
  // In-memory only — a restart rescans from startPoolId, which is correct
  // (terminal is terminal) just slower for one tick.
  let floor = deps.startPoolId ?? 1n;
  // The publish backoff, per pool. In-memory like the floor: a restart
  // retries at once, which is the right thing after a fix.
  const publishRetry = new Map<string, { failures: number; nextAttemptMs: number }>();

  /** Tell the indexer where a bundle is. Fire-safe by contract (see DaemonDeps.announceBundle). */
  async function announce(poolId: bigint, uri: string, report: TickReport): Promise<void> {
    if (!deps.announceBundle) return;
    try {
      await deps.announceBundle(poolId, uri);
      log('bundle_announced', { poolId: poolId.toString(), uri });
    } catch (e) {
      report.errors.push({ action: 'announce_bundle', poolId: poolId.toString(), message: String(e) });
      log('announce_bundle:failed', { poolId: poolId.toString(), error: String(e) });
    }
  }

  async function settleOne(poolId: bigint, report: TickReport): Promise<boolean> {
    let pool = await deps.chain.getPool(poolId);

    // The deadline is STRICTLY past, exactly as both instructions compare
    // `Clock` on-chain — at `now == fill_deadline` neither would land.
    // (A full pool can never be Open: the 64th `register` seals it.)
    if (pool.state === 'Open' && deps.now() > pool.fillDeadline) {
      if (BigInt(pool.entrants) >= MIN_SEATS) {
        // D-E4 (option A): the minimum field is met — seal and play. One
        // clock: the deadline set at open (12 h at launch), never moved.
        await deps.chain.sealAtDeadline(poolId);
        report.sealedAtDeadline.push(poolId);
        log('seal_at_deadline', { poolId: poolId.toString(), entrants: pool.entrants });
      } else {
        // R7: the deadline passed below the minimum field — the refund fork.
        await deps.chain.triggerRefund(poolId);
        report.refundsTriggered.push(poolId);
        log('trigger_refund', { poolId: poolId.toString() });
      }
      pool = await deps.chain.getPool(poolId);
    }

    if (pool.state === 'Sealed' || pool.state === 'Scored' || pool.state === 'Refunding') {
      const outcome = await deps.crank(poolId);
      report.cranked.push({ poolId, finalState: outcome.finalState });
      log('cranked', { poolId: poolId.toString(), finalState: outcome.finalState });
      if (outcome.bundleUri) await announce(poolId, outcome.bundleUri, report);
      pool = await deps.chain.getPool(poolId);
    }

    // ---- THE REVIEW CLOCK (Phase 2 Stage D) -----------------------------
    // Held-for-review = settled into escrow under a flag and not forfeited.
    // Released once the published window has passed since the on-chain
    // escrow instant; otherwise it keeps the pool non-terminal so the
    // sweep returns next tick. A throw from `releaseEscrow` propagates to
    // the sweep's per-pool catch and is retried the same way.
    //
    // Two holds the clock must NOT release (2026-09-12, audit 2026-09-11):
    //   - a SANCTIONS hold (B-30 / C-10 / C-23 / D-26): `release_escrow`
    //     refuses on both of its paths while `sanctions_hold` is set, so
    //     calling it threw on every tick for ever — and the throw skipped
    //     this pool's next-place step below. The share waits for the
    //     admin's `lift_sanctions_hold`; the pool stays non-terminal.
    //   - a FORFEIT already in the decision log (D-03): a reviewer's upheld
    //     flag is logged first and lands on chain later, by a transaction a
    //     human signs. In that gap the clock used to pay the flagged
    //     player. With `deps.decisions` wired it asks the log first, and
    //     once the window has passed with the on-chain forfeit still
    //     missing it raises an alert: the multisig is late.
    let holdOutstanding = false;
    if (pool.state === 'Scored' || pool.state === 'Paid') {
      const now = deps.now();
      for (const e of await deps.chain.getEntries(poolId)) {
        const underReview = e.settled && e.flagged && !e.forfeited && e.escrowLamports > 0n;
        if (!underReview) continue;
        const windowPassed = now >= e.escrowedAt + REVIEW_WINDOW_SECS;
        // The two holds are reported every tick they are seen; the metric
        // counts only the ticks on which the clock WOULD have released.
        if (e.sanctionsHold) {
          holdOutstanding = true;
          report.held.push({ poolId, player: e.player, reason: 'sanctions_hold' });
          if (windowPassed) {
            deps.monitor?.recordEvent(METRIC.reveal.releaseHeld, { reason: 'sanctions_hold' });
            log('release:held-for-sanctions', { poolId: poolId.toString(), player: e.player });
          }
          continue;
        }
        if (deps.decisions && (await deps.decisions.forfeitLogged(poolId, e.player))) {
          holdOutstanding = true;
          report.held.push({ poolId, player: e.player, reason: 'forfeit_logged' });
          if (windowPassed) {
            deps.monitor?.recordEvent(METRIC.reveal.releaseHeld, { reason: 'forfeit_logged' });
            log('release:held-for-forfeit', { poolId: poolId.toString(), player: e.player });
            deps.monitor?.alert(ALERT.reveal.forfeitUnlanded, {
              poolId: poolId.toString(),
              player: e.player,
              escrowedAt: e.escrowedAt.toString(),
            });
          }
          continue;
        }
        if (windowPassed) {
          await deps.chain.releaseEscrow(poolId, e.player);
          report.released.push({ poolId, player: e.player });
          log('release_escrow', {
            poolId: poolId.toString(),
            player: e.player,
            escrowedAt: e.escrowedAt.toString(),
            reason: 'review window passed with no decision',
          });
        } else {
          holdOutstanding = true;
        }
      }
    }

    // ---- THE NEXT-PLACE STEP (audit O23) --------------------------------
    // A forfeited share has exactly one way out of the vault, and this is
    // it. Only a Paid pool qualifies (the program refuses before that), and
    // the ranking is recomputed rather than fetched — see ranking.ts.
    let sharesOutstanding = false;
    if (pool.state === 'Paid') {
      const entries = await deps.chain.getEntries(poolId);
      const forfeited = entries.filter((e) => e.forfeited && e.escrowLamports > 0n);
      if (forfeited.length > 0) {
        sharesOutstanding = true;
        const secret = await deps.custody.exportSecret(poolId);
        const ranking = await recomputeRanking(
          deps.ciphertexts,
          poolId,
          secret,
          entries,
          pool.entrants,
          pool.potLamports,
          pool.resultsRootHex ?? null,
          boardModeOf(pool.mode)
        );
        const committedSeats = pool.payouts.map((p) => p.entryIndex);
        for (const f of forfeited) {
          const plan = planNextPlace(ranking, entries, committedSeats, f);
          if (plan.blocker !== null) {
            log('pay_next_place:holding', {
              poolId: poolId.toString(),
              from: f.player,
              reason: plan.blocker,
            });
            continue;
          }
          const paid = await payNextPlacePortions(deps.chain, poolId, plan.portions, log);
          report.nextPlacePaid.push(...paid);
        }
      }
    }

    // ---- THE BUNDLE OWED (2026-09-12, audit C-09 / B-32 / D-27) -----------
    // A Paid pool whose bundle is not on record still owes its
    // verifiability. The crank records every upload (published-store.ts);
    // a Paid pool with no record is retried here, on a backoff, through the
    // crank's publish-only path — never the full settlement, whose winner
    // screening would call the sanctions vendor again for a pool already
    // paid. Until the bundle is on record the pool is not terminal, so the
    // sweep keeps coming back to it.
    let publishOutstanding = false;
    if (pool.state === 'Paid' && deps.published && deps.publishOwed) {
      const known = await deps.published.find(poolId);
      if (known === null) {
        publishOutstanding = true;
        const key = poolId.toString();
        const nowMs = (deps.nowMs ?? Date.now)();
        const retry = publishRetry.get(key);
        if (!retry || nowMs >= retry.nextAttemptMs) {
          try {
            const uri = await deps.publishOwed(poolId);
            publishRetry.delete(key);
            publishOutstanding = false;
            report.published.push({ poolId, uri });
            deps.monitor?.recordEvent(METRIC.reveal.bundlePublished);
            log('publish_owed', { poolId: key, uri });
            await announce(poolId, uri, report);
          } catch (e) {
            const failures = (retry?.failures ?? 0) + 1;
            publishRetry.set(key, {
              failures,
              nextAttemptMs: nowMs + (deps.publishRetryMs ?? PUBLISH_RETRY_MS),
            });
            report.errors.push({ action: 'publish_owed', poolId: key, message: String(e) });
            deps.monitor?.recordEvent(METRIC.reveal.bundlePublishFailed);
            log('publish_owed:failed', { poolId: key, failures, error: String(e) });
            if (failures >= PUBLISH_ALERT_AFTER) {
              deps.monitor?.alert(ALERT.reveal.bundleUnpublished, { poolId: key, failures });
            }
          }
        }
      }
    }

    return (
      TERMINAL.has(pool.state) && !holdOutstanding && !sharesOutstanding && !publishOutstanding
    );
  }

  /**
   * Land whatever launch steps the tier's Open pool still misses.
   *
   * The pass collection comes FIRST because `register` cannot mint without
   * it, while the seed is optional (R22). Until 2026-10-15 the seed came
   * first, so when Switchboard's oracles stopped (2026-10-10) every launch
   * threw at the seed and no pool from 90 on ever got a collection either.
   * The seed is attempted only before the first entry, matching the
   * program's `VrfSeedAfterEntries` guard.
   */
  async function completeLaunch(poolId: bigint, report: TickReport): Promise<void> {
    const pool = await deps.chain.getPool(poolId);
    if (pool.state !== 'Open') return;
    if (!(await deps.chain.hasPassCollection(poolId))) {
      await deps.chain.createPassCollection(poolId);
      report.completed.push({ poolId, step: 'pass_collection' });
      log('create_pass_collection', { poolId: poolId.toString() });
    }
    if (!pool.vrfCommitted && deps.vrf !== null && pool.entrants === 0) {
      await deps.vrf.commitSeed(poolId);
      report.completed.push({ poolId, step: 'vrf' });
      log('commit_vrf_seed', { poolId: poolId.toString() });
    }
  }

  async function tick(): Promise<TickReport> {
    const report: TickReport = {
      opened: [],
      cranked: [],
      refundsTriggered: [],
      sealedAtDeadline: [],
      completed: [],
      released: [],
      nextPlacePaid: [],
      held: [],
      published: [],
      errors: [],
    };

    // ---- SETTLE: sweep every non-terminal pool ---------------------------
    const cfg = await deps.chain.getConfig();
    let advancing = true;
    for (let id = floor; id < cfg.nextPoolId; id++) {
      let terminal = false;
      try {
        terminal = await settleOne(id, report);
      } catch (e) {
        report.errors.push({ action: 'settle', poolId: id.toString(), message: String(e) });
        log('settle:failed', { poolId: id.toString(), error: String(e) });
      }
      // The floor only advances over a terminal PREFIX — a stuck pool holds
      // it so the sweep keeps retrying that pool every tick.
      if (advancing && terminal) floor = id + 1n;
      else advancing = false;
    }

    // ---- KEEP: complete launch steps on every live Open pool -------------
    // Both ladders (Phase B): a hard pool needs its VRF seed and collection
    // exactly as an easy one does.
    for (const active of [...cfg.activePoolByTier, ...cfg.hardActivePoolByTier]) {
      if (active === 0n) continue;
      try {
        await completeLaunch(active, report);
      } catch (e) {
        const tier = (await deps.chain.getPool(active)).tier;
        report.errors.push({ action: 'keeper', tier, message: String(e) });
        log('keeper:failed', { tier, error: String(e) });
      }
    }

    // ---- OPEN: the treasury policy decides (D-A1 revised) ----------------
    // `nextOpenable` mirrors `open_pool`'s gates exactly (sequential rule +
    // cooldown + policy floor), lowest tier first; loop until it says none,
    // so one tick opens every tier the treasury can carry.
    if (!cfg.paused) {
      for (let guard = 0; guard < cfg.openTiers.length; guard++) {
        try {
          // Fresh config each pass: each open advances next_pool_id and
          // fills a slot, and a concurrent daemon may have moved both.
          const cur = await deps.chain.getConfig();
          const balance = await deps.chain.getPlatformBalance();
          const stateOf = async (id: bigint): Promise<PoolStateName | 'none'> => {
            if (id === 0n) return 'none';
            return (await deps.chain.getPool(id)).state;
          };
          const states: TierPoolStates = await Promise.all(cur.activePoolByTier.map(stateOf));
          const hardStates: TierPoolStates = await Promise.all(
            cur.hardActivePoolByTier.map(stateOf)
          );
          // The cushion is the program's own rent figure, read from the
          // cluster: `open_pool` funds pot + cushion and counts both in
          // `needed`, so a mirror without it sends an open the program
          // refuses (2026-09-12).
          const cushion = await deps.chain.vaultCushion();
          const verdict = nextOpenable(cur, balance, states, deps.now(), cushion, hardStates);
          if (verdict.tier === null || verdict.mode === null) {
            log('keeper:hold', { reason: verdict.reason });
            // §2.2: a tier skipped because it is not open is the launch
            // posture working; the same silence from a shortfall or a stuck
            // pool is an incident. The label is what tells them apart.
            deps.monitor?.recordEvent(METRIC.reveal.keeperHold, { reason: verdict.reason });
            break;
          }
          const tier = verdict.tier;
          const mode = verdict.mode;
          const poolId = cur.nextPoolId;
          const key =
            (await deps.custody.getPublishedKey(poolId)) ??
            (await deps.custody.createPoolKey(poolId));
          await deps.chain.openPool(poolId, tier, key.publicKey, key.secretHash, mode);
          report.opened.push({ poolId, tier, mode });
          log('open_pool', { poolId: poolId.toString(), tier, mode, reason: verdict.reason });
          await completeLaunch(poolId, report);
        } catch (e) {
          report.errors.push({ action: 'keeper', tier: -1, message: String(e) });
          log('keeper:failed', { error: String(e) });
          break;
        }
      }
    } else {
      // PHASE-C-REVIEW: paused holds the KEEPER only — `set_paused` blocks
      // `register`, so opening pools nobody can enter is pointless churn;
      // settlement above keeps running because pausing must never strand
      // funds.
      log('keeper:paused', {});
    }

    deps.monitor?.recordEvent(METRIC.reveal.tick, {
      outcome: report.errors.length === 0 ? 'ok' : 'failed',
    });
    return report;
  }

  async function run(
    intervalMs: number,
    signal?: AbortSignal,
    hooks: LoopHooks = {}
  ): Promise<void> {
    while (!signal?.aborted) {
      try {
        // Inside the try on purpose: preparation the tick depends on (the
        // chain-clock read, in production) fails the tick rather than the
        // process, and is retried at the next interval like any other
        // transient RPC failure.
        await hooks.beforeTick?.();
        const report = await tick();
        await hooks.afterTick?.(report);
      } catch (e) {
        // Config unreadable / RPC down — nothing to do but say so and retry.
        log('tick:failed', { error: String(e) });
        try {
          hooks.onTickError?.(e);
        } catch (hookErr) {
          log('tick:error_hook_failed', { error: String(hookErr) });
        }
      }
      try {
        // Runs on both paths: this is where liveness judgements belong (the
        // stale-tick alert), and they must not be skipped by the failure
        // they exist to report.
        hooks.afterIteration?.();
      } catch (e) {
        log('after_iteration:failed', { error: String(e) });
      }
      await sleep(intervalMs, signal);
    }
  }

  return { tick, run };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}
