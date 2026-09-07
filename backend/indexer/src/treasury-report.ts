/**
 * GET /treasury (D-A1 revised, master prompt v2 2026-08-27) — the treasury
 * report, assembled at READ TIME from the raw event ledger, the same rows a
 * player could rebuild from transaction logs. Numbers only: balances, pots,
 * the policy floor, per-tier status, and the shortfall to the next unlock.
 *
 * Why a ledger sweep and not a derived table: every treasury movement is an
 * event —
 *
 *   PlatformFunded / PlatformWithdrawn  → carry the EXACT post-move balance
 *                                         (self-correcting anchors)
 *   PoolOpened                          → −pot (funded into the prize vault)
 *   EntryRegistered                     → +price (100% of a pass sale)
 *   RefundTriggered                     → +pot (the untouched pot returns)
 *   Refunded                            → −price (the full refund)
 *   TiersOpened                         → which tiers count toward the
 *                                         idle-tier reserve (E1 PR3a)
 *
 * NOT in the list since 2026-09-07 (founder ruling 4): `EscrowForfeited`.
 * A forfeit moves nothing — the share stays in the pool's vault until
 * `NextPlacePaid` pays it to the next eligible place. No event credits the
 * treasury with a player's prize, and the report must never learn one.
 *
 * so the balance is a pure replay, and the anchors pin it exactly whenever
 * a deposit or withdrawal has occurred.
 *
 * Tier ENABLEMENT: `set_open_tiers` emits `TiersOpened` since E1 PR3a, so
 * the report distinguishes an enabled-idle tier (its reserve pot is part of
 * the floor) from a disabled one (it is not) exactly as `open_pool` and
 * `withdraw_platform` do on-chain. Before the first `TiersOpened` on a
 * ledger the report assumes `init_config`'s launch posture — tier 0 only —
 * and says so in `enablement_source`; a `set_open_tiers` that landed before
 * the event existed is invisible until the next one. (This replaces the
 * PHASE-A1-REVIEW all-tiers-enabled assumption, which could only overstate
 * the floor.)
 *
 * All lamport arithmetic is bigint; every amount serializes as a decimal
 * string.
 */

import { MIN_SEATS, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '../../scoring/src/prizes';
import type { Queryable } from './shared';

interface PoolTrack {
  tier: number;
  price: bigint;
  pot: bigint;
  state: 'Open' | 'Sealed' | 'Scored' | 'Paid' | 'Refunding' | 'Closed';
  entrants: number;
  refunded: number;
  committedSeats: number[];
  paidMask: bigint;
}

/** `init_config`'s posture: tier 0 enabled, the rest waiting on the ladder. */
const LAUNCH_OPEN_TIERS: readonly boolean[] = [true, false, false, false, false, false, false];

export interface TierStatus {
  tier: number;
  price_lamports: string;
  pot_lamports: string;
  /** 'open' (live pool taking entries) | 'settling' (live, past entries) |
   * 'openable' | 'short' | 'disabled' (not enabled by `set_open_tiers`;
   * contributes nothing to the floor and is never "short"). */
  status: 'open' | 'settling' | 'openable' | 'short' | 'disabled';
  live_pool_state: string | null;
  short_by_lamports: string;
}

export interface TreasuryReport {
  platform_balance_lamports: string;
  reserved_pot_lamports: string;
  refundable_entry_lamports: string;
  policy: { reserve_pots: number; min_platform_lamports: string };
  withdraw_floor_lamports: string;
  withdrawable_lamports: string;
  tiers: TierStatus[];
  /** Where the tier enablement came from: the ledger's latest `TiersOpened`,
   * or the launch default when none has been emitted yet (module doc). */
  enablement_source: 'ledger' | 'launch_default';
  /** One tier-0 pool's margin — pass sales in, pot out — at the two ends of
   * the field a pool can run with (D-E4): the 52-seat minimum and a full 64.
   * A pool sealed at its deadline lands somewhere in between. */
  tier0_margin_lamports: { minimum_field: string; full: string };
  /** Tier-0 pools needed to cover the first shortfall if every one of them
   * FILLS (the best case); null when nothing is short or the margin is not
   * positive. */
  tier0_pools_to_next_unlock: string | null;
  /** The same count if every pool runs at the 52-seat minimum (the worst
   * case that still plays). */
  tier0_pools_to_next_unlock_at_minimum_field: string | null;
}

export async function treasuryReport(db: Queryable): Promise<TreasuryReport> {
  const res = await db.query(
    'SELECT name, raw FROM events ORDER BY slot, signature, event_index'
  );

  let balance = 0n;
  let reservePots = 1n;
  let minPlatform = 0n;
  const tierPrice = TIER_ENTRY_LAMPORTS.map((v) => v);
  const tierPot = TIER_POT_LAMPORTS.map((v) => v);
  const pools = new Map<string, PoolTrack>();
  let enabledFromLedger: boolean[] | null = null;

  for (const row of res.rows) {
    const e = row.raw as Record<string, unknown>;
    const pool = () => pools.get(e.pool as string);
    switch (row.name) {
      case 'PlatformFunded':
      case 'PlatformWithdrawn':
        balance = BigInt(e.platform_balance as string);
        break;
      case 'TierEconomicsSet': {
        const t = e.tier as number;
        tierPrice[t] = BigInt(e.price_lamports as string);
        tierPot[t] = BigInt(e.pot_lamports as string);
        break;
      }
      case 'TreasuryPolicySet':
        reservePots = BigInt(e.reserve_pots as number);
        minPlatform = BigInt(e.min_platform_lamports as string);
        break;
      case 'TiersOpened':
        enabledFromLedger = (e.open_tiers as boolean[]).map((v) => v === true);
        break;
      case 'PoolOpened': {
        const pot = BigInt(e.pot_lamports as string);
        balance -= pot;
        pools.set(e.pool as string, {
          tier: e.tier as number,
          price: BigInt(e.entry_lamports as string),
          pot,
          state: 'Open',
          entrants: 0,
          refunded: 0,
          committedSeats: [],
          paidMask: 0n,
        });
        break;
      }
      case 'EntryRegistered': {
        const p = pool();
        if (p) {
          balance += p.price;
          p.entrants += 1;
        }
        break;
      }
      case 'PoolSealed': {
        const p = pool();
        if (p) p.state = 'Sealed';
        break;
      }
      case 'ResultsCommitted': {
        const p = pool();
        if (p) {
          p.state = 'Scored';
          p.committedSeats = (
            e.payouts as Array<{ entry_index: number }>
          ).map((x) => x.entry_index);
        }
        break;
      }
      case 'PrizesPaid': {
        const p = pool();
        if (p) {
          p.paidMask = BigInt(e.paid_mask as string);
          if (
            p.committedSeats.length > 0 &&
            p.committedSeats.every((s) => (p.paidMask >> BigInt(s)) & 1n)
          ) {
            p.state = 'Paid';
          }
        }
        break;
      }
      case 'RefundTriggered': {
        const p = pool();
        if (p) {
          balance += p.pot;
          p.state = p.entrants === 0 ? 'Closed' : 'Refunding';
        }
        break;
      }
      case 'Refunded': {
        const p = pool();
        if (p) {
          balance -= p.price;
          p.refunded += 1;
          if (p.refunded >= p.entrants) p.state = 'Closed';
        }
        break;
      }
    }
  }

  const enabled: readonly boolean[] = enabledFromLedger ?? LAUNCH_OPEN_TIERS;

  // Aggregate live state.
  const liveByTier: (PoolTrack | null)[] = tierPot.map(() => null);
  let reserved = 0n;
  let refundable = 0n;
  for (const p of pools.values()) {
    if (p.state === 'Open' || p.state === 'Sealed' || p.state === 'Scored') {
      liveByTier[p.tier] = p;
      reserved += p.pot;
    }
    if (p.state === 'Refunding') liveByTier[p.tier] = p;
    if (p.state === 'Open') refundable += p.price * BigInt(p.entrants);
    if (p.state === 'Refunding') {
      refundable += p.price * BigInt(p.entrants - p.refunded);
    }
  }

  // One reserve pot per ENABLED idle tier — the program's own rule
  // (`open_pool` and `withdraw_platform` both walk `open_tiers`).
  const idleReserve = (excludeTier: number | null): bigint => {
    let r = 0n;
    for (let t = 0; t < tierPot.length; t++) {
      if (t === excludeTier) continue;
      if (enabled[t] && !liveByTier[t]) r += tierPot[t] * reservePots;
    }
    return r;
  };

  const floor = minPlatform + idleReserve(null) + refundable;
  const withdrawable = balance > floor ? balance - floor : 0n;
  const available = balance - refundable;

  let firstShort: bigint | null = null;
  const tiers: TierStatus[] = tierPot.map((pot, t) => {
    const live = liveByTier[t];
    if (live) {
      return {
        tier: t,
        price_lamports: tierPrice[t].toString(),
        pot_lamports: pot.toString(),
        status: live.state === 'Open' ? 'open' : 'settling',
        live_pool_state: live.state,
        short_by_lamports: '0',
      };
    }
    if (!enabled[t]) {
      return {
        tier: t,
        price_lamports: tierPrice[t].toString(),
        pot_lamports: pot.toString(),
        status: 'disabled',
        live_pool_state: null,
        short_by_lamports: '0',
      };
    }
    const needed = pot + minPlatform + idleReserve(t);
    const short = available >= needed ? 0n : needed - available;
    if (short > 0n && firstShort === null) firstShort = short;
    return {
      tier: t,
      price_lamports: tierPrice[t].toString(),
      pot_lamports: pot.toString(),
      status: short === 0n ? 'openable' : 'short',
      live_pool_state: null,
      short_by_lamports: short.toString(),
    };
  });

  // One tier-0 pool's margin: pass sales in, pot out — at a full field and
  // at the 52-seat minimum (D-E4). Shown as a range because the field a
  // pool actually runs with is decided by the players, not the operator.
  const marginFull = tierPrice[0] * 64n - tierPot[0];
  const marginMin = tierPrice[0] * MIN_SEATS - tierPot[0];
  const poolsToUnlock = (margin: bigint): string | null =>
    firstShort !== null && margin > 0n ? ((firstShort + margin - 1n) / margin).toString() : null;

  return {
    platform_balance_lamports: balance.toString(),
    reserved_pot_lamports: reserved.toString(),
    refundable_entry_lamports: refundable.toString(),
    policy: {
      reserve_pots: Number(reservePots),
      min_platform_lamports: minPlatform.toString(),
    },
    withdraw_floor_lamports: floor.toString(),
    withdrawable_lamports: withdrawable.toString(),
    tiers,
    enablement_source: enabledFromLedger ? 'ledger' : 'launch_default',
    tier0_margin_lamports: { minimum_field: marginMin.toString(), full: marginFull.toString() },
    tier0_pools_to_next_unlock: poolsToUnlock(marginFull),
    tier0_pools_to_next_unlock_at_minimum_field: poolsToUnlock(marginMin),
  };
}
