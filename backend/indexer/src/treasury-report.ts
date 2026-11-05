/**
 * GET /treasury (D-A1 revised, master prompt v2 2026-08-27) — the treasury
 * report. Numbers only: balances, prize pools, the policy floor, per-pool-
 * type status and margins, and the shortfall to the next unlock.
 *
 * WHERE EACH NUMBER COMES FROM, and why it moved (audit B-18, D-18, and
 * prior-audit O26's report half, all 2026-09-12; the Ladder, D-E19):
 *
 *   POLICY — the minimum balance, `reserve_pots`, the tier prices, the tier
 *   enablement and, since D-E19, every POOL TYPE's switch, prize pool,
 *   table, floor and slot — is read from the LIVE accounts when the chain
 *   read is available (`treasury-chain.ts`: `Config` and every `PoolType`),
 *   and from the ledger only as a fallback. It has to be: `init_config`
 *   writes the minimum and the tier tables and emits NO event
 *   (`instructions/admin.rs`), so a ledger-only report published a 0
 *   minimum against a program enforcing 0.6 SOL, and six of seven tier
 *   pots wrong (O26, `docs/security/SECURITY-REVIEW.md` §8 O26). The ledger
 *   fallback for pool types is the `pool_types` projection (migration
 *   0026), which the three pool-type events fill completely.
 *   `policy_source` says which was used on every response;
 *   `enablement_source` does the same for `open_tiers`.
 *
 *   THE LIVE-POOL AGGREGATE — locked prize pools, refundable entries, which
 *   pool type holds a live pool and in what state — is read from the
 *   derived `pools` table (`_shared/migrations/0003`, `0007`, `0026`). Only
 *   LIVE pools (Open, Sealed, Scored, Refunding) reach it at all.
 *
 *   THE REALISED MARGIN — entries sold minus the prize pool, per pool type,
 *   over the pools that have paid — is one GROUP BY over the same table.
 *
 *   THE BALANCE is ANCHORED, not accumulated: `PlatformFunded` and
 *   `PlatformWithdrawn` carry the exact post-move balance and assign it
 *   absolutely, so nothing before the LATEST anchor can affect the result.
 *   The fallback fold therefore starts at that anchor and reads only the
 *   treasury-moving events at or after it. The chain read supplies the
 *   platform PDA's lamports directly and skips the fold entirely.
 *
 * B-18 is why that matters: this route is public, rate-limited at 600
 * requests per minute per client, and the admin page fetches it with
 * `cache: 'no-store'`. It used to answer every one of those by selecting the
 * entire events table with no WHERE and no LIMIT and folding every row.
 * Every statement this module issues is now bounded — by the anchor's
 * position, by an event-name filter, by a pool key set, by LIMIT 1, or (the
 * derived tables) by their size: one row per pool, one per pool type.
 *
 * All lamport arithmetic is bigint; every amount serializes as a decimal
 * string. No float touches any number here.
 */

import {
  TIER_ENTRY_LAMPORTS,
  ladderTable,
  minFieldFor,
  prizePoolFor,
} from '../../scoring/src/prizes';
import type { Queryable } from './shared';
import type { TreasuryChainReader, TreasuryChainView } from './treasury-chain';

/** `init_config`'s posture: tier 0 enabled, the rest waiting on the ladder. */
const LAUNCH_OPEN_TIERS: readonly boolean[] = [true, false, false, false, false, false, false];

/** Pool states that still hold a pool type's slot and can still move money. */
const LIVE_STATES = ['Open', 'Sealed', 'Scored', 'Refunding'] as const;

/**
 * The only pool size before the Ladder (D-E19), and the size the
 * back-compatible `tiers[]` rows describe: before D-E19 "the tier's slot"
 * WAS its 64-player pool, so those rows keep meaning what they meant.
 */
const REFERENCE_CAPACITY = 64;

/** The events that move the platform balance. Nothing else is read for it —
 * notably not `EscrowForfeited`: a forfeit moves nothing (founder ruling 4,
 * 2026-09-07), the share stays in the pool's vault until it is paid onward
 * to other players of the same pool, and no event credits the treasury with
 * a player's prize. The report must never learn one. */
const BALANCE_EVENTS = [
  'PlatformFunded',
  'PlatformWithdrawn',
  'PoolOpened',
  'EntryRegistered',
  'RefundTriggered',
  'Refunded',
] as const;

/** One live pool, as the derived `pools` table holds it. */
export interface LivePool {
  pool: string;
  /** The on-chain id, decimal string. */
  id: string | null;
  tier: number;
  /** The ladder (Phase B): 0 easy, 1 hard. */
  mode: number;
  /** The pool's size (D-E19); 64 for a pre-Ladder pool. */
  capacity: number;
  price: bigint;
  pot: bigint;
  state: 'Open' | 'Sealed' | 'Scored' | 'Refunding';
  entrants: bigint;
  refunded: bigint;
}

export type SlotStatus = 'open' | 'settling' | 'openable' | 'short' | 'disabled';

/**
 * One tier, as the report has always published it — KEPT for readers that
 * predate the Ladder (the admin page). Since D-E19 a tier holds several pool
 * types; this row describes the tier's 64-player type on each ladder (the
 * only size there was), and `pool_types` describes every type.
 */
export interface TierStatus {
  tier: number;
  price_lamports: string;
  /** The 64-player type's prize pool when its economics are set; otherwise
   * Config's 64-player reference figure (`tier_pot_lamports`), which since
   * D-E19 funds no pool. */
  pot_lamports: string;
  /** 'open' (live pool taking entries) | 'settling' (live, past entries) |
   * 'openable' | 'short' | 'disabled' (not enabled; contributes nothing to
   * the floor and is never "short"). */
  status: SlotStatus;
  live_pool_state: string | null;
  short_by_lamports: string;
  /** The HARD ladder's 64-player type at this tier (Phase B). */
  hard: {
    status: SlotStatus;
    live_pool_state: string | null;
    short_by_lamports: string;
  };
}

/**
 * One pool type (D-E19: a (mode, tier, capacity)) — locked capital, idle
 * reserve and margin, judged as the program judges it.
 */
export interface PoolTypeTreasury {
  mode: 'easy' | 'hard';
  tier: number;
  capacity: number;
  /** The type's own switch (`set_pool_type_enabled`). */
  type_enabled: boolean;
  /** The tier's switch for this mode (R6). Both must be on for a pool to open. */
  tier_open: boolean;
  status: SlotStatus;
  live_pool_id: string | null;
  live_pool_state: string | null;
  /** The tier's entry price today. */
  entry_lamports: string;
  /** The FIXED prize pool the next pool of this type opens with. */
  prize_pool_lamports: string;
  min_seats: number;
  paid_places: number;
  /** The prize pool sitting in this type's live pool's vault (0 when there
   * is none, or when it is Refunding and the prize pool has gone back). */
  locked_lamports: string;
  /** What this type adds to the withdraw floor: `(prize pool + cushion) ×
   * reserve_pots` when it is enabled, its tier is open and its slot is
   * empty — `idle_pool_type_reserve`, term for term — else 0. */
  idle_reserve_lamports: string;
  short_by_lamports: string;
  /** One pool's margin — entries in, prize pool out — at the type's own
   * minimum field and full, at today's price. Null until economics are set. */
  margin_lamports: { minimum_field: string; full: string } | null;
  /** What pools of this type that have PAID actually returned:
   * Σ (entry × entrants − prize pool). */
  realised: { pools_paid: string; margin_lamports: string };
}

export interface TreasuryReport {
  platform_balance_lamports: string;
  /** Prize pools locked in live pools' vaults (every type). */
  reserved_pot_lamports: string;
  refundable_entry_lamports: string;
  policy: { reserve_pots: number; min_platform_lamports: string };
  /**
   * `vault::rent_floor()` — the rent-exempt minimum for a zero-data account,
   * which `open_pool` funds every prize vault with ON TOP of its prize pool
   * and which `idle_pool_type_reserve` counts once per reserved prize pool.
   * Published as its own field so the floor is checkable by hand:
   *
   *   floor = min_platform
   *         + Σ over ENABLED pool types, on an OPEN tier, with NO live pool,
   *             of (prize pool + cushion) × reserve_pots
   *         + refundable
   *
   * It is a CLUSTER parameter, not policy, and it is only knowable from the
   * chain: `'0'` here always means `policy_source` is `'ledger'`, and a
   * ledger-derived floor is therefore a LOWER BOUND on what the program will
   * enforce. It is 890,880 under the standard rent parameters and 650,240 on
   * devnet.
   */
  vault_cushion_lamports: string;
  /** The middle term of the floor above: Σ `pool_types[].idle_reserve_lamports`. */
  idle_reserve_lamports: string;
  withdraw_floor_lamports: string;
  withdrawable_lamports: string;
  /** Back-compatible per-tier rows: each tier's 64-player type. */
  tiers: TierStatus[];
  /** Every pool type, sorted mode (easy first), tier, capacity. */
  pool_types: PoolTypeTreasury[];
  /** Σ over every pool that has paid, of every type and from before the
   * Ladder too: entries sold minus the prize pool. */
  realised_margin_lamports: string;
  /**
   * Where the policy came from: `'chain'` = the live `Config`, every
   * `PoolType` and the platform PDA (the minimum, `reserve_pots`, the tier
   * tables, the pool types, `platform_refundable`, the balance and the
   * cushion); `'ledger'` = the bounded event ledger, the `pool_types`
   * projection, the launch tier prices from `backend/scoring/src/prizes.ts`,
   * and a cushion of zero. A reader must be able to tell a chain-anchored
   * number from a ledger-derived one, and O26 is what happens when they
   * cannot.
   */
  policy_source: 'chain' | 'ledger';
  /** Where the tier enablement came from: the live `Config`, the ledger's
   * latest `TiersOpened`, or `init_config`'s launch posture when neither is
   * available. */
  enablement_source: 'chain' | 'ledger' | 'launch_default';
  /** One tier-0 64-player pool's margin — entries in, prize pool out — at
   * the two ends of the field it can run with: its minimum field and a full
   * 64. A pool sealed at its deadline lands somewhere in between. Every
   * type's own pair is in `pool_types[].margin_lamports`. */
  tier0_margin_lamports: { minimum_field: string; full: string };
  /** Tier-0 64-player pools needed to cover the first shortfall (lowest
   * tier, easy before hard, smallest size first) if every one of them FILLS
   * (the best case); null when nothing is short or the margin is not
   * positive. */
  tier0_pools_to_next_unlock: string | null;
  /** The same count if every pool runs at its minimum field (the worst case
   * that still plays) — null at a break-even floor, where no number of such
   * pools covers anything. */
  tier0_pools_to_next_unlock_at_minimum_field: string | null;
}

/** One pool type as the policy knows it, however it was obtained. */
interface PolicyPoolType {
  mode: number;
  tier: number;
  capacity: number;
  enabled: boolean;
  minSeats: number;
  paidPlaces: number;
  potLamports: bigint;
  /**
   * The type's live pool id as `PoolType.active_pool` holds it — what
   * `idle_pool_type_reserve` reads — on the chain path; null on the ledger
   * path and for a type known only from a live pool, where the `pools`
   * table says whether the slot is held.
   */
  activePool: bigint | null;
}

/**
 * The policy half of the report, however it was obtained.
 */
interface Policy {
  minPlatform: bigint;
  reservePots: bigint;
  tierPrice: bigint[];
  /** Config's 64-player reference figure per tier (since D-E19 it funds no
   * pool; kept for the back-compatible `tiers[]` rows). */
  tierPot: bigint[];
  enabled: readonly boolean[];
  /** The hard ladder's enablement (Phase B): `hard_open_tiers`, or the
   * ledger's latest `HardTiersOpened`, or all-closed — a hard tier the
   * founder never enabled reserves nothing and opens nothing. */
  hardEnabled: readonly boolean[];
  poolTypes: PolicyPoolType[];
  cushion: bigint;
  source: 'chain' | 'ledger';
  enablementSource: 'chain' | 'ledger' | 'launch_default';
  /** Set only on the chain path, where the account is authoritative for
   * both; null means "compute them from the derived tables and the ledger". */
  balance: bigint | null;
  refundable: bigint | null;
}

/** `${mode}:${tier}:${capacity}` — one pool type. */
export function poolTypeKey(mode: number, tier: number, capacity: number): string {
  return `${mode}:${tier}:${capacity}`;
}

/**
 * Build the report.
 *
 * `chain` is optional and may fail: it is called inside a try, and a
 * rejected read falls back to the bounded ledger with `policy_source:
 * 'ledger'`. `GET /treasury` is public and unauthenticated — an RPC outage
 * must degrade this response, never 500 it.
 */
export async function treasuryReport(
  db: Queryable,
  chain?: TreasuryChainReader | null
): Promise<TreasuryReport> {
  const chainView = await tryChainRead(chain);
  const live = await livePools(db);
  const realised = await realisedByType(db);
  const policy = chainView ? policyFromChain(chainView) : await policyFromLedger(db);

  // The live pools, from the derived table: which pool type holds a slot
  // and in what state, the prize pools they lock, and the entries they
  // could still refund. `reserved_pot_lamports` is always this sum — a sum
  // over exactly the pools whose per-type status the same response
  // publishes, so those two halves can never disagree. The REFUNDABLE total
  // is this sum only on the ledger path; on the chain path
  // `Config.platform_refundable` wins, because that is the number the
  // program's own floor is computed from.
  const liveByType = new Map<string, LivePool>();
  let reserved = 0n;
  let ledgerRefundable = 0n;
  for (const p of live) {
    if (p.tier < 0 || p.tier >= policy.tierPrice.length) continue;
    const k = poolTypeKey(p.mode, p.tier, p.capacity);
    // One live pool per type on chain (SEQUENTIAL slots); should the table
    // ever hold two, the one taking entries is the one to show.
    if (!liveByType.has(k) || p.state === 'Open') liveByType.set(k, p);
    if (p.state !== 'Refunding') reserved += p.pot;
    if (p.state === 'Open') ledgerRefundable += p.price * p.entrants;
    if (p.state === 'Refunding') ledgerRefundable += p.price * (p.entrants - p.refunded);
  }

  const refundable = policy.refundable ?? ledgerRefundable;
  const balance = policy.balance ?? (await ledgerBalance(db));

  // Every pool type the policy knows, plus any (mode, tier, capacity) that
  // holds a live pool the policy has no type for — a pool opened before the
  // Ladder, whose slot lived on Config. It is shown (its locked prize pool
  // is real) and reserves nothing (it is no enabled type).
  const types = new Map<string, PolicyPoolType>();
  for (const t of policy.poolTypes) types.set(poolTypeKey(t.mode, t.tier, t.capacity), t);
  for (const [k, p] of liveByType) {
    if (!types.has(k)) {
      types.set(k, {
        mode: p.mode,
        tier: p.tier,
        capacity: p.capacity,
        enabled: false,
        minSeats: 0,
        paidPlaces: 0,
        potLamports: p.pot,
        activePool: null,
      });
    }
  }

  const tierOpen = (mode: number, tier: number): boolean =>
    (mode === 1 ? policy.hardEnabled : policy.enabled)[tier] === true;

  // ---- The floor. THIS IS THE THIRD COPY OF ONE SUM, and the sum has now
  // been wrong twice.
  //
  // `idle_pool_type_reserve` lives in the program (`instructions/
  // treasury.rs`), in the keeper's mirror (`backend/reveal/src/
  // treasury.ts`), and here. On 2026-09-12 the program started counting a
  // per-reserved-pot RENT CUSHION and neither TypeScript mirror was changed
  // with it (audit D-18). Nothing compares a Rust figure with its
  // TypeScript mirror, which is how one change left three copies
  // disagreeing.
  //
  // THE PROGRAM IS THE SPEC. Since D-E19, over every ENABLED pool type:
  //   reserve += (pot + cushion) × reserve_pots
  //     when open_tiers_for(mode)[tier] && active_pool == 0
  // `handle_withdraw_platform`:
  //   floor = min_platform + idle_pool_type_reserve(None) + platform_refundable
  // and `open_pool`, for the type being opened:
  //   needed = pot + cushion + min_platform + idle_pool_type_reserve(Some(type))
  // Change one of the three and change all three.
  //
  // "No live pool" is the type's own `active_pool` on the chain path — the
  // field the program reads — and the `pools` table on the ledger path.
  const slotEmpty = (t: PolicyPoolType): boolean =>
    t.activePool !== null
      ? t.activePool === 0n
      : !liveByType.has(poolTypeKey(t.mode, t.tier, t.capacity));
  const reservesIdle = (t: PolicyPoolType): boolean => t.enabled && tierOpen(t.mode, t.tier) && slotEmpty(t);
  const reserveOf = (t: PolicyPoolType): bigint =>
    reservesIdle(t) ? (t.potLamports + policy.cushion) * policy.reservePots : 0n;
  const idleReserve = (excludeKey: string | null): bigint => {
    let r = 0n;
    for (const [k, t] of types) if (k !== excludeKey) r += reserveOf(t);
    return r;
  };

  const totalIdle = idleReserve(null);
  const floor = policy.minPlatform + totalIdle + refundable;
  const withdrawable = balance > floor ? balance - floor : 0n;
  const available = balance - refundable;

  /** One pool type's slot, judged as `open_pool` would judge it. */
  const slotStatus = (
    t: PolicyPoolType
  ): { status: SlotStatus; live_pool_state: string | null; live_pool_id: string | null; short: bigint } => {
    const k = poolTypeKey(t.mode, t.tier, t.capacity);
    const livePool = liveByType.get(k);
    if (livePool) {
      return {
        status: livePool.state === 'Open' ? 'open' : 'settling',
        live_pool_state: livePool.state,
        live_pool_id: livePool.id,
        short: 0n,
      };
    }
    if (t.activePool !== null && t.activePool !== 0n) {
      // The chain holds a live pool this indexer has not (or no longer)
      // projected as live: the slot is taken, its state is not known here.
      return { status: 'settling', live_pool_state: null, live_pool_id: t.activePool.toString(), short: 0n };
    }
    if (!t.enabled || !tierOpen(t.mode, t.tier)) {
      return { status: 'disabled', live_pool_state: null, live_pool_id: null, short: 0n };
    }
    const needed = t.potLamports + policy.cushion + policy.minPlatform + idleReserve(k);
    const short = available >= needed ? 0n : needed - available;
    return { status: short === 0n ? 'openable' : 'short', live_pool_state: null, live_pool_id: null, short };
  };

  const sorted = [...types.values()].sort(
    (a, b) => a.mode - b.mode || a.tier - b.tier || a.capacity - b.capacity
  );
  const statusByKey = new Map<string, ReturnType<typeof slotStatus>>();
  for (const t of sorted) statusByKey.set(poolTypeKey(t.mode, t.tier, t.capacity), slotStatus(t));

  // The first shortfall: the lowest tier, easy before hard, smallest size
  // first — the cheapest pool type the treasury cannot yet open.
  let firstShort: bigint | null = null;
  for (const t of [...sorted].sort((a, b) => a.tier - b.tier || a.mode - b.mode || a.capacity - b.capacity)) {
    const s = statusByKey.get(poolTypeKey(t.mode, t.tier, t.capacity))!;
    if (s.status === 'short') {
      firstShort = s.short;
      break;
    }
  }

  const economicsSet = (t: PolicyPoolType): boolean => t.paidPlaces > 0 && t.potLamports > 0n;
  const pool_types: PoolTypeTreasury[] = sorted.map((t) => {
    const k = poolTypeKey(t.mode, t.tier, t.capacity);
    const s = statusByKey.get(k)!;
    const livePool = liveByType.get(k);
    const price = policy.tierPrice[t.tier] ?? 0n;
    const r = realised.get(k);
    return {
      mode: t.mode === 1 ? 'hard' : 'easy',
      tier: t.tier,
      capacity: t.capacity,
      type_enabled: t.enabled,
      tier_open: tierOpen(t.mode, t.tier),
      status: s.status,
      live_pool_id: s.live_pool_id,
      live_pool_state: s.live_pool_state,
      entry_lamports: price.toString(),
      prize_pool_lamports: t.potLamports.toString(),
      min_seats: t.minSeats,
      paid_places: t.paidPlaces,
      locked_lamports: livePool && livePool.state !== 'Refunding' ? livePool.pot.toString() : '0',
      idle_reserve_lamports: reserveOf(t).toString(),
      short_by_lamports: s.short.toString(),
      margin_lamports: economicsSet(t)
        ? {
            minimum_field: (price * BigInt(t.minSeats) - t.potLamports).toString(),
            full: (price * BigInt(t.capacity) - t.potLamports).toString(),
          }
        : null,
      realised: { pools_paid: r?.pools ?? '0', margin_lamports: r?.margin ?? '0' },
    };
  });

  // The back-compatible tier rows: each tier's 64-player type, per ladder.
  const referenceSlot = (mode: number, tier: number): TierStatus['hard'] => {
    const k = poolTypeKey(mode, tier, REFERENCE_CAPACITY);
    const s = statusByKey.get(k);
    if (!s) return { status: 'disabled', live_pool_state: null, short_by_lamports: '0' };
    return { status: s.status, live_pool_state: s.live_pool_state, short_by_lamports: s.short.toString() };
  };
  const tiers: TierStatus[] = policy.tierPrice.map((price, t) => {
    const easy64 = types.get(poolTypeKey(0, t, REFERENCE_CAPACITY));
    const pot = easy64 && economicsSet(easy64) ? easy64.potLamports : policy.tierPot[t];
    return {
      tier: t,
      price_lamports: price.toString(),
      pot_lamports: pot.toString(),
      ...referenceSlot(0, t),
      hard: referenceSlot(1, t),
    };
  });

  // One tier-0 64-player pool's margin: entries in, prize pool out — at a
  // full field and at its minimum field. Shown as a range because the field
  // a pool actually runs with is decided by the players, not the operator.
  // From the type's own economics when set; otherwise Config's reference
  // prize pool at the launch minimum field (`MIN_FIELD_BY_CAPACITY`).
  const ref = types.get(poolTypeKey(0, 0, REFERENCE_CAPACITY));
  const price0 = policy.tierPrice[0];
  const pot0 = ref && economicsSet(ref) ? ref.potLamports : policy.tierPot[0];
  const minField0 = ref && economicsSet(ref) ? BigInt(ref.minSeats) : BigInt(minFieldFor(REFERENCE_CAPACITY));
  const marginFull = price0 * BigInt(REFERENCE_CAPACITY) - pot0;
  const marginMin = price0 * minField0 - pot0;
  const poolsToUnlock = (margin: bigint): string | null =>
    firstShort !== null && margin > 0n ? ((firstShort + margin - 1n) / margin).toString() : null;

  let realisedTotal = 0n;
  for (const r of realised.values()) realisedTotal += BigInt(r.margin);

  return {
    platform_balance_lamports: balance.toString(),
    reserved_pot_lamports: reserved.toString(),
    refundable_entry_lamports: refundable.toString(),
    policy: {
      reserve_pots: Number(policy.reservePots),
      min_platform_lamports: policy.minPlatform.toString(),
    },
    vault_cushion_lamports: policy.cushion.toString(),
    idle_reserve_lamports: totalIdle.toString(),
    withdraw_floor_lamports: floor.toString(),
    withdrawable_lamports: withdrawable.toString(),
    tiers,
    pool_types,
    realised_margin_lamports: realisedTotal.toString(),
    policy_source: policy.source,
    enablement_source: policy.enablementSource,
    tier0_margin_lamports: { minimum_field: marginMin.toString(), full: marginFull.toString() },
    tier0_pools_to_next_unlock: poolsToUnlock(marginFull),
    tier0_pools_to_next_unlock_at_minimum_field: poolsToUnlock(marginMin),
  };
}

/** Enablement as the EVENT LEDGER alone can state it: the newest
 * `TiersOpened`, or — when the founder has never sent one —
 * `init_config`'s seeded posture, which is what the account then holds.
 * Separated from the rest of the ledger policy so `GET /tiers` can reach it
 * without the economics queries it does not need. */
async function enablementFromLedger(
  db: Queryable
): Promise<{ enabled: readonly boolean[]; source: 'ledger' | 'launch_default' }> {
  const tiersOpened = await latestEvent(db, 'TiersOpened');
  const enabled = tiersOpened
    ? (tiersOpened.open_tiers as boolean[]).map((v) => v === true)
    : null;
  return enabled ? { enabled, source: 'ledger' } : { enabled: LAUNCH_OPEN_TIERS, source: 'launch_default' };
}

/** The hard ladder's enablement as the ledger can state it: the newest
 * `HardTiersOpened`, else all closed — the posture `init_config` and the
 * Phase B `migrate_config` both write, so the default is exact. */
async function hardEnablementFromLedger(
  db: Queryable
): Promise<{ enabled: readonly boolean[]; source: 'ledger' | 'launch_default' }> {
  const opened = await latestEvent(db, 'HardTiersOpened');
  const enabled = opened ? (opened.open_tiers as boolean[]).map((v) => v === true) : null;
  return enabled
    ? { enabled, source: 'ledger' }
    : { enabled: LAUNCH_OPEN_TIERS.map(() => false), source: 'launch_default' };
}

/**
 * Which tiers may open a HARD pool (Phase B) — `tierEnablement`'s twin, by
 * the same three-way resolution, for `GET /tiers` and `GET /pool-types`.
 */
export async function hardTierEnablement(
  db: Queryable,
  chain?: TreasuryChainReader | null
): Promise<{ enabled: readonly boolean[]; source: 'chain' | 'ledger' | 'launch_default' }> {
  const view = await tryChainRead(chain);
  if (view) return { enabled: [...view.hardOpenTiers], source: 'chain' };
  return hardEnablementFromLedger(db);
}

/**
 * Which tiers may open a pool, and how we know — the answer `GET /tiers`
 * publishes and the one `GET /treasury` already embeds.
 *
 * ONE function for both, on purpose (founder instruction 2026-09-12 §2.3).
 * Two endpoints of the same API that each computed this for themselves could
 * disagree about which tier is open, and the pre-flight of 2026-09-13 found
 * a third answer hard-coded in the app on top of those. Resolution order is
 * the live `Config` account, then the `TiersOpened` ledger, then the seeded
 * posture; `source` publishes which one answered, so a stale reply is
 * visible rather than silent.
 *
 * This is a DISPLAY signal. The gate itself is `open_pool`'s
 * `require!(config.open_tiers_for(mode)[tier], TierNotOpen)` — a tier shown
 * open here that is closed on chain costs a refused transaction, not an
 * entry, and no player can enter a pool that was never opened.
 */
export async function tierEnablement(
  db: Queryable,
  chain?: TreasuryChainReader | null
): Promise<{ enabled: readonly boolean[]; source: 'chain' | 'ledger' | 'launch_default' }> {
  const view = await tryChainRead(chain);
  if (view) return { enabled: [...view.openTiers], source: 'chain' };
  return enablementFromLedger(db);
}

/** One chain read, or null. Never throws: the routes that call it are public. */
export async function tryChainRead(
  chain: TreasuryChainReader | null | undefined
): Promise<TreasuryChainView | null> {
  if (!chain) return null;
  try {
    return await chain();
  } catch {
    // The reader reports the failure where an operator sees it
    // (`treasury-chain.ts`); the response says `policy_source: "ledger"`.
    return null;
  }
}

function policyFromChain(view: TreasuryChainView): Policy {
  return {
    minPlatform: view.minPlatformLamports,
    reservePots: view.reservePots,
    tierPrice: [...view.tierPriceLamports],
    tierPot: [...view.tierPotLamports],
    enabled: [...view.openTiers],
    hardEnabled: [...view.hardOpenTiers],
    poolTypes: (view.poolTypes ?? []).map((t) => ({
      mode: t.mode,
      tier: t.tier,
      capacity: t.capacity,
      enabled: t.enabled,
      minSeats: t.minSeats,
      paidPlaces: t.paidPlaces,
      potLamports: t.potLamports,
      activePool: t.activePool,
    })),
    cushion: view.vaultCushionLamports,
    source: 'chain',
    enablementSource: 'chain',
    balance: view.platformBalanceLamports,
    refundable: view.platformRefundableLamports,
  };
}

/**
 * The tier prices and Config's 64-player reference prize pools as the
 * LEDGER can state them: `set_tier_economics` emits `TierEconomicsSet`, so
 * a tier the founder has moved is current; every other tier is at its
 * launch value — `init_config` seeds `Config` from the same constants and
 * emits nothing. The launch reference prize pool is the 64-player table at
 * the launch price (`prizePoolFor(ladderTable(64), price)` — 40 entries,
 * what `constants.rs::TIER_POT_LAMPORTS` holds). One DISTINCT ON, bounded
 * by the seven tiers.
 */
export async function tierEconomicsFromLedger(
  db: Queryable
): Promise<{ tierPrice: bigint[]; tierPot: bigint[] }> {
  const tierPrice = TIER_ENTRY_LAMPORTS.map((v) => v);
  const tierPot = TIER_ENTRY_LAMPORTS.map((price) => prizePoolFor(ladderTable(REFERENCE_CAPACITY), price));

  const economics = await db.query(
    "SELECT DISTINCT ON (raw->>'tier') raw FROM events WHERE name = 'TierEconomicsSet' " +
      "ORDER BY raw->>'tier', slot DESC, signature DESC, event_index DESC"
  );
  for (const row of economics.rows) {
    const e = row.raw as Record<string, unknown>;
    const t = Number(e.tier);
    if (Number.isInteger(t) && t >= 0 && t < tierPot.length) {
      tierPrice[t] = BigInt(e.price_lamports as string);
      tierPot[t] = BigInt(e.pot_lamports as string);
    }
  }
  return { tierPrice, tierPot };
}

/** One row of the `pool_types` projection (migration 0026). */
export interface LedgerPoolTypeRow {
  mode: number;
  tier: number;
  capacity: number;
  poolType: string | null;
  minSeats: number;
  paidPlaces: number;
  /** `paid_places` entries, rank 1 first. */
  prizeTable: number[];
  potLamports: bigint;
  enabled: boolean;
  nextOpenAt: bigint;
  lastPoolId: bigint | null;
}

/**
 * The `pool_types` projection, every row — one per (mode, tier, capacity),
 * at most 56. Rows a `PoolType` event created carry its address; a row
 * created only by a pre-Ladder `TierSlotFreed` (a slot stamp, not an
 * account) has none, and `realOnly` drops it.
 */
export async function ledgerPoolTypeRows(db: Queryable, realOnly = true): Promise<LedgerPoolTypeRow[]> {
  const res = await db.query(
    `SELECT mode, tier, capacity, pool_type, min_seats, paid_places, prize_table,
            pot_lamports::text AS pot_lamports, enabled,
            next_open_at::text AS next_open_at, last_pool_id::text AS last_pool_id
       FROM pool_types`
  );
  const rows = (res.rows as Array<Record<string, unknown>>).map((r) => {
    const table = Array.isArray(r.prize_table) ? (r.prize_table as unknown[]).map(Number) : [];
    return {
      mode: Number(r.mode) === 1 ? 1 : 0,
      tier: Number(r.tier),
      capacity: Number(r.capacity),
      poolType: typeof r.pool_type === 'string' ? r.pool_type : null,
      minSeats: r.min_seats === null || r.min_seats === undefined ? 0 : Number(r.min_seats),
      paidPlaces: r.paid_places === null || r.paid_places === undefined ? table.length : Number(r.paid_places),
      prizeTable: table,
      potLamports: BigInt((r.pot_lamports as string | null) ?? '0'),
      enabled: r.enabled === true,
      nextOpenAt: BigInt((r.next_open_at as string | null) ?? '0'),
      lastPoolId:
        r.last_pool_id === null || r.last_pool_id === undefined ? null : BigInt(r.last_pool_id as string),
    };
  });
  return realOnly ? rows.filter((r) => r.poolType !== null) : rows;
}

/**
 * The fallback policy: bounded lookups, each a single row (LIMIT 1), a
 * DISTINCT ON over the seven tiers, or the pool-type projection. Seeded from
 * the launch tables, which is the honest thing a ledger alone can say —
 * `init_config` seeds `Config` from the same constants and emits nothing,
 * and `set_tier_economics` / `set_treasury_policy` / `set_open_tiers` and
 * the three pool-type instructions DO emit, so a ledger that has seen those
 * events is current for whatever they changed and stale for the rest. The
 * cushion is not knowable off-chain at all: it is zero here, and
 * `vault_cushion_lamports` publishes that so the floor reads as the lower
 * bound it is.
 */
async function policyFromLedger(db: Queryable): Promise<Policy> {
  const { tierPrice, tierPot } = await tierEconomicsFromLedger(db);
  const policySet = await latestEvent(db, 'TreasuryPolicySet');
  const fromLedger = await enablementFromLedger(db);
  const hardFromLedger = await hardEnablementFromLedger(db);
  const poolTypes = (await ledgerPoolTypeRows(db)).map((r) => ({
    mode: r.mode,
    tier: r.tier,
    capacity: r.capacity,
    enabled: r.enabled,
    minSeats: r.minSeats,
    paidPlaces: r.paidPlaces,
    potLamports: r.potLamports,
    activePool: null,
  }));

  return {
    minPlatform: policySet ? BigInt(policySet.min_platform_lamports as string) : 0n,
    reservePots: policySet ? BigInt(policySet.reserve_pots as number) : 1n,
    tierPrice,
    tierPot,
    enabled: fromLedger.enabled,
    hardEnabled: hardFromLedger.enabled,
    poolTypes,
    cushion: 0n,
    source: 'ledger',
    enablementSource: fromLedger.source,
    balance: null,
    refundable: null,
  };
}

/** The newest row of one event name, in replay order. LIMIT 1. */
async function latestEvent(
  db: Queryable,
  name: string
): Promise<Record<string, unknown> | null> {
  const res = await db.query(
    'SELECT raw FROM events WHERE name = $1 ORDER BY slot DESC, signature DESC, event_index DESC LIMIT 1',
    [name]
  );
  return res.rows.length > 0 ? (res.rows[0].raw as Record<string, unknown>) : null;
}

/** The live pools, straight off the derived table. At most one per pool type. */
export async function livePools(db: Queryable): Promise<LivePool[]> {
  const res = await db.query(
    `SELECT pool, id::text AS id, tier, mode, capacity,
            entry_lamports::text AS entry_lamports, pot_lamports::text AS pot_lamports,
            state, entrants::text AS entrants, refunded_count::text AS refunded_count
       FROM pools
      WHERE state = ANY($1)`,
    [[...LIVE_STATES]]
  );
  return res.rows.map((r: Record<string, unknown>) => ({
    pool: String(r.pool),
    id: r.id === null || r.id === undefined ? null : String(r.id),
    tier: Number(r.tier),
    price: BigInt((r.entry_lamports as string | null) ?? '0'),
    pot: BigInt((r.pot_lamports as string | null) ?? '0'),
    state: r.state as LivePool['state'],
    entrants: BigInt((r.entrants as string | null) ?? '0'),
    refunded: BigInt((r.refunded_count as string | null) ?? '0'),
    // A row from before 0025 carries no mode: easy. One from before 0026
    // carries no capacity: 64, the only size there was.
    mode: Number(r.mode) === 1 ? 1 : 0,
    capacity: r.capacity === null || r.capacity === undefined ? REFERENCE_CAPACITY : Number(r.capacity),
  }));
}

/**
 * What pools that PAID returned, per pool type: how many, and Σ (entry ×
 * entrants − prize pool) — computed in SQL over NUMERIC, so exact, and
 * returned as decimal strings. A Closed pool refunded every entry and got
 * its prize pool back, so it returned nothing and is not counted.
 */
async function realisedByType(db: Queryable): Promise<Map<string, { pools: string; margin: string }>> {
  const res = await db.query(
    `SELECT mode, tier, capacity, count(*)::text AS pools,
            COALESCE(sum(entry_lamports * entrants - pot_lamports), 0)::text AS margin
       FROM pools
      WHERE state = 'Paid'
      GROUP BY mode, tier, capacity`
  );
  const out = new Map<string, { pools: string; margin: string }>();
  for (const r of res.rows as Array<Record<string, unknown>>) {
    const mode = Number(r.mode) === 1 ? 1 : 0;
    const capacity = r.capacity === null || r.capacity === undefined ? REFERENCE_CAPACITY : Number(r.capacity);
    out.set(poolTypeKey(mode, Number(r.tier), capacity), {
      pools: String(r.pools),
      margin: String(r.margin),
    });
  }
  return out;
}

/**
 * The platform balance, replayed from the LATEST anchor forward.
 *
 * `PlatformFunded` and `PlatformWithdrawn` carry the balance AFTER the move
 * and assign it absolutely, so the replay needs no row before the newest of
 * them — which is what makes this bounded instead of a full-ledger fold
 * (B-18). Every statement carries the anchor's position as a lower bound;
 * with no anchor on the ledger the bound is the ledger's start, and the
 * event-name filter is what keeps that case small.
 *
 * KNOWN UNDERSTATEMENT, and the reason the chain read exists: since
 * 2026-09-12 `open_pool` debits pot PLUS the rent cushion from the treasury
 * while `PoolOpened` carries only the pot, so this fold reads one cushion
 * high per pool opened after the last anchor. The next deposit or withdrawal
 * corrects it exactly. `policy_source: 'chain'` never runs this path — it
 * reads the platform PDA's lamports.
 */
async function ledgerBalance(db: Queryable): Promise<bigint> {
  const anchorRes = await db.query(
    `SELECT slot::text AS slot, signature, event_index, raw
       FROM events
      WHERE name = ANY($1)
      ORDER BY slot DESC, signature DESC, event_index DESC
      LIMIT 1`,
    [['PlatformFunded', 'PlatformWithdrawn']]
  );
  const anchor = anchorRes.rows[0] as
    | { slot: string; signature: string; event_index: number; raw: Record<string, unknown> }
    | undefined;

  const windowRes = await db.query(
    `SELECT name, raw
       FROM events
      WHERE (slot, signature, event_index) >= ($1::numeric, $2::text, $3::int)
        AND name = ANY($4)
      ORDER BY slot, signature, event_index`,
    [anchor?.slot ?? '0', anchor?.signature ?? '', anchor?.event_index ?? 0, [...BALANCE_EVENTS]]
  );
  const rows = windowRes.rows as Array<{ name: string; raw: Record<string, unknown> }>;

  // `EntryRegistered` and `RefundTriggered` name a pool without carrying its
  // price or pot, so the amounts come from the derived table — for the pools
  // in this window only, which is why it is a key-set lookup and not a scan.
  const priceByPool = new Map<string, { price: bigint; pot: bigint }>();
  const wanted = new Set<string>();
  for (const row of rows) {
    const pool = row.raw.pool as string | undefined;
    if (pool && (row.name === 'EntryRegistered' || row.name === 'RefundTriggered')) {
      wanted.add(pool);
    }
  }
  if (wanted.size > 0) {
    const poolsRes = await db.query(
      `SELECT pool, entry_lamports::text AS entry_lamports, pot_lamports::text AS pot_lamports
         FROM pools
        WHERE pool = ANY($1)`,
      [[...wanted]]
    );
    for (const r of poolsRes.rows as Array<Record<string, unknown>>) {
      priceByPool.set(r.pool as string, {
        price: BigInt((r.entry_lamports as string | null) ?? '0'),
        pot: BigInt((r.pot_lamports as string | null) ?? '0'),
      });
    }
  }

  let balance = 0n;
  for (const row of rows) {
    const e = row.raw;
    const pool = () => priceByPool.get(e.pool as string);
    switch (row.name) {
      case 'PlatformFunded':
      case 'PlatformWithdrawn':
        balance = BigInt(e.platform_balance as string);
        break;
      case 'PoolOpened':
        // The pot leaves the treasury for the prize vault before any entry.
        balance -= BigInt(e.pot_lamports as string);
        break;
      case 'EntryRegistered': {
        const p = pool();
        if (p) balance += p.price;
        break;
      }
      case 'RefundTriggered': {
        // The untouched pot returns from the vault.
        const p = pool();
        if (p) balance += p.pot;
        break;
      }
      case 'Refunded':
        // The FULL entry, as the event states it (R7).
        balance -= BigInt(e.amount as string);
        break;
    }
  }
  return balance;
}
