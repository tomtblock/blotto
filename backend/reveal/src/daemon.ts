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
 *     to its packet. A FORFEITED share is never touched here: it waits
 *     for `pay_next_place`, which no service drives yet (audit O14).
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
import type { KeeperChain, PoolStateName } from './chain';
import { nextOpenable, type TierPoolStates } from './treasury';
import type { CrankOutcome } from './crank';
import type { PoolKeyCustody } from './deps';

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
  vrf: VrfCoordinator;
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
  /** Unix seconds — compared against `Pool.fill_deadline` (R7). */
  now: () => bigint;
  log?: (step: string, detail?: Record<string, unknown>) => void;
  /** Lowest pool id the sweep ever considers (default 1n — ids are gapless
   * from 1). A redeploy against a long history can start higher. */
  startPoolId?: bigint;
}

export interface DaemonError {
  action: string;
  poolId?: string;
  tier?: number;
  message: string;
}

export interface TickReport {
  /** Pools opened this tick, with their tier. */
  opened: { poolId: bigint; tier: number }[];
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
  /** Every caught failure — the tick continues past each. */
  errors: DaemonError[];
}

const TERMINAL = new Set(['Paid', 'Closed']);

export interface Daemon {
  /** One pass: settle everything settleable, then top up every open tier. */
  tick(): Promise<TickReport>;
  /** Poll loop: tick, sleep, repeat until the signal aborts. A throwing
   * tick (e.g. RPC down) is logged and retried next interval. */
  run(intervalMs: number, signal?: AbortSignal): Promise<void>;
}

export function makeDaemon(deps: DaemonDeps): Daemon {
  const log = deps.log ?? (() => {});
  // Sweep floor: every pool below it was seen terminal (Paid/Closed).
  // In-memory only — a restart rescans from startPoolId, which is correct
  // (terminal is terminal) just slower for one tick.
  let floor = deps.startPoolId ?? 1n;

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
      if (outcome.bundleUri && deps.announceBundle) {
        try {
          await deps.announceBundle(poolId, outcome.bundleUri);
          log('bundle_announced', { poolId: poolId.toString(), uri: outcome.bundleUri });
        } catch (e) {
          // Fire-safe by contract (see DaemonDeps.announceBundle).
          report.errors.push({
            action: 'announce_bundle',
            poolId: poolId.toString(),
            message: String(e),
          });
          log('announce_bundle:failed', { poolId: poolId.toString(), error: String(e) });
        }
      }
      pool = await deps.chain.getPool(poolId);
    }

    // ---- THE REVIEW CLOCK (Phase 2 Stage D) -----------------------------
    // Held-for-review = settled into escrow under a flag and not forfeited.
    // Released once the published window has passed since the on-chain
    // escrow instant; otherwise it keeps the pool non-terminal so the
    // sweep returns next tick. A throw from `releaseEscrow` propagates to
    // the sweep's per-pool catch and is retried the same way.
    let holdOutstanding = false;
    if (pool.state === 'Scored' || pool.state === 'Paid') {
      const now = deps.now();
      for (const e of await deps.chain.getEntries(poolId)) {
        const underReview = e.settled && e.flagged && !e.forfeited && e.escrowLamports > 0n;
        if (!underReview) continue;
        if (now >= e.escrowedAt + REVIEW_WINDOW_SECS) {
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

    return TERMINAL.has(pool.state) && !holdOutstanding;
  }

  /** Land whatever launch steps the tier's Open pool still misses. */
  async function completeLaunch(poolId: bigint, report: TickReport): Promise<void> {
    const pool = await deps.chain.getPool(poolId);
    if (pool.state !== 'Open') return;
    if (!pool.vrfCommitted) {
      await deps.vrf.commitSeed(poolId);
      report.completed.push({ poolId, step: 'vrf' });
      log('commit_vrf_seed', { poolId: poolId.toString() });
    }
    if (!(await deps.chain.hasPassCollection(poolId))) {
      await deps.chain.createPassCollection(poolId);
      report.completed.push({ poolId, step: 'pass_collection' });
      log('create_pass_collection', { poolId: poolId.toString() });
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
    for (let tier = 0; tier < cfg.openTiers.length; tier++) {
      const active = cfg.activePoolByTier[tier];
      if (active === 0n) continue;
      try {
        await completeLaunch(active, report);
      } catch (e) {
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
          const states: TierPoolStates = await Promise.all(
            cur.activePoolByTier.map(async (id): Promise<PoolStateName | 'none'> => {
              if (id === 0n) return 'none';
              return (await deps.chain.getPool(id)).state;
            })
          );
          const verdict = nextOpenable(cur, balance, states, deps.now());
          if (verdict.tier === null) {
            log('keeper:hold', { reason: verdict.reason });
            break;
          }
          const tier = verdict.tier;
          const poolId = cur.nextPoolId;
          const key =
            (await deps.custody.getPublishedKey(poolId)) ??
            (await deps.custody.createPoolKey(poolId));
          await deps.chain.openPool(poolId, tier, key.publicKey, key.secretHash);
          report.opened.push({ poolId, tier });
          log('open_pool', { poolId: poolId.toString(), tier, reason: verdict.reason });
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

    return report;
  }

  async function run(intervalMs: number, signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      try {
        await tick();
      } catch (e) {
        // Config unreadable / RPC down — nothing to do but say so and retry.
        log('tick:failed', { error: String(e) });
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
