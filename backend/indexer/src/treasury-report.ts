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
 *   EscrowForfeited                     → +amount (forfeits land here)
 *
 * so the balance is a pure replay, and the anchors pin it exactly whenever
 * a deposit or withdrawal has occurred.
 *
 * PHASE-A1-REVIEW: tier ENABLEMENT (`set_open_tiers`) does not emit an
 * event, so the ledger cannot distinguish an enabled-idle tier from a
 * disabled one. The report treats every configured tier as enabled, which
 * can only OVERSTATE the policy floor (a disabled tier's reserve pot drops
 * out on-chain). The keeper is unaffected — `nextOpenable` reads live
 * Config. Recorded in the A1 step report; an enablement event is a
 * program change for the founder to price.
 *
 * All lamport arithmetic is bigint; every amount serializes as a decimal
 * string.
 */

import { TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '../../scoring/src/prizes';
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

export interface TierStatus {
  tier: number;
  price_lamports: string;
  pot_lamports: string;
  /** 'open' (live pool taking entries) | 'settling' (live, past entries) |
   * 'openable' | 'short'. Enablement is not on the ledger (module doc). */
  status: 'open' | 'settling' | 'openable' | 'short';
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
  /** Full tier-0 pools needed to cover the first shortfall at the launch
   * margin (price×64 − pot per pool); null when nothing is short or the
   * margin is not positive. */
  tier0_pools_to_next_unlock: string | null;
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
      case 'EscrowForfeited':
        balance += BigInt(e.amount as string);
        break;
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

  const idleReserve = (excludeTier: number | null): bigint => {
    let r = 0n;
    for (let t = 0; t < tierPot.length; t++) {
      if (t === excludeTier) continue;
      if (!liveByTier[t]) r += tierPot[t] * reservePots;
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

  // The launch margin of one full tier-0 pool: pass sales in, pot out.
  const margin = tierPrice[0] * 64n - tierPot[0];
  const poolsToUnlock =
    firstShort !== null && margin > 0n ? (firstShort + margin - 1n) / margin : null;

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
    tier0_pools_to_next_unlock: poolsToUnlock === null ? null : poolsToUnlock.toString(),
  };
}
