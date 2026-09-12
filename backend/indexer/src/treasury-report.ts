/**
 * GET /treasury (D-A1 revised, master prompt v2 2026-08-27) — the treasury
 * report. Numbers only: balances, pots, the policy floor, per-tier status,
 * and the shortfall to the next unlock.
 *
 * WHERE EACH NUMBER COMES FROM, and why it moved (audit B-18, D-18, and
 * prior-audit O26's report half, all 2026-09-12):
 *
 *   POLICY — the minimum balance, `reserve_pots`, the two tier tables and
 *   the tier enablement — is read from the LIVE `Config` account when the
 *   chain read is available (`treasury-chain.ts`), and from the ledger only
 *   as a fallback. It has to be: `init_config` writes all of them and emits
 *   NO event (`instructions/admin.rs`), so a ledger-only report published a
 *   0 minimum against a program enforcing 0.6 SOL, and six of seven tier
 *   pots wrong (O26, `docs/AUDIT-2026-09-07.md` §8 O26). `policy_source`
 *   says which was used on every response; `enablement_source` does the same
 *   for `open_tiers`, as it already did.
 *
 *   THE LIVE-POOL AGGREGATE — reserved pots, refundable entries, which tier
 *   holds a live pool and in what state — is read from the derived `pools`
 *   table (`_shared/migrations/0003`, `0007`). It carries `tier`,
 *   `entry_lamports`, `pot_lamports`, `state`, `entrants` and
 *   `refunded_count`, which is every field the old per-pool fold recomputed
 *   from the whole ledger. Only LIVE pools (Open, Sealed, Scored, Refunding)
 *   reach the output at all — a Paid or Closed pool contributes nothing to
 *   any field here.
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
 * position, by an event-name filter, by a pool key set, or by LIMIT 1.
 *
 * All lamport arithmetic is bigint; every amount serializes as a decimal
 * string.
 */

import { MIN_SEATS, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS } from '../../scoring/src/prizes';
import type { Queryable } from './shared';
import type { TreasuryChainReader, TreasuryChainView } from './treasury-chain';

/** `init_config`'s posture: tier 0 enabled, the rest waiting on the ladder. */
const LAUNCH_OPEN_TIERS: readonly boolean[] = [true, false, false, false, false, false, false];

/** Pool states that still hold a tier's slot and can still move money. */
const LIVE_STATES = ['Open', 'Sealed', 'Scored', 'Refunding'] as const;

/** The events that move the platform balance. Nothing else is read for it —
 * notably not `EscrowForfeited`: a forfeit moves nothing (founder ruling 4,
 * 2026-09-07), the share stays in the pool's vault until `NextPlacePaid`
 * pays it to the next eligible place, and no event credits the treasury with
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
interface LivePool {
  tier: number;
  price: bigint;
  pot: bigint;
  state: 'Open' | 'Sealed' | 'Scored' | 'Refunding';
  entrants: bigint;
  refunded: bigint;
}

export interface TierStatus {
  tier: number;
  price_lamports: string;
  pot_lamports: string;
  /** 'open' (live pool taking entries) | 'settling' (live, past entries) |
   * 'openable' | 'short' | 'disabled' (not enabled; contributes nothing to
   * the floor and is never "short"). */
  status: 'open' | 'settling' | 'openable' | 'short' | 'disabled';
  live_pool_state: string | null;
  short_by_lamports: string;
}

export interface TreasuryReport {
  platform_balance_lamports: string;
  reserved_pot_lamports: string;
  refundable_entry_lamports: string;
  policy: { reserve_pots: number; min_platform_lamports: string };
  /**
   * `vault::rent_floor()` — the rent-exempt minimum for a zero-data account,
   * which `open_pool` funds every prize vault with ON TOP of its pot and
   * which `idle_tier_reserve` counts once per reserved pot. Published as its
   * own field so the floor is checkable by hand:
   *
   *   floor = min_platform
   *         + Σ over ENABLED idle tiers of (pot + cushion) × reserve_pots
   *         + refundable
   *
   * It is a CLUSTER parameter, not policy, and it is only knowable from the
   * chain: `'0'` here always means `policy_source` is `'ledger'`, and a
   * ledger-derived floor is therefore a LOWER BOUND on what the program will
   * enforce. It is 890,880 under the standard rent parameters and 650,240 on
   * devnet.
   */
  vault_cushion_lamports: string;
  withdraw_floor_lamports: string;
  withdrawable_lamports: string;
  tiers: TierStatus[];
  /**
   * Where the policy came from: `'chain'` = the live `Config` account and
   * the platform PDA (the minimum, `reserve_pots`, both tier tables,
   * `platform_refundable`, the balance and the cushion); `'ledger'` = the
   * bounded event ledger, the launch tier tables from
   * `backend/scoring/src/prizes.ts`, and a cushion of zero. A reader must be
   * able to tell a chain-anchored number from a ledger-derived one, and
   * O26 is what happens when they cannot.
   */
  policy_source: 'chain' | 'ledger';
  /** Where the tier enablement came from: the live `Config`, the ledger's
   * latest `TiersOpened`, or `init_config`'s launch posture when neither is
   * available. */
  enablement_source: 'chain' | 'ledger' | 'launch_default';
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

/**
 * The policy half of the report, however it was obtained.
 */
interface Policy {
  minPlatform: bigint;
  reservePots: bigint;
  tierPrice: bigint[];
  tierPot: bigint[];
  enabled: readonly boolean[];
  cushion: bigint;
  source: 'chain' | 'ledger';
  enablementSource: 'chain' | 'ledger' | 'launch_default';
  /** Set only on the chain path, where the account is authoritative for
   * both; null means "compute them from the derived tables and the ledger". */
  balance: bigint | null;
  refundable: bigint | null;
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
  const policy = chainView ? policyFromChain(chainView) : await policyFromLedger(db);

  // The live pools, from the derived table: which tier holds a slot and in
  // what state, the pots they reserve, and the entries they could still
  // refund. `reserved_pot_lamports` is always this sum — a sum over exactly
  // the pools whose per-tier status the same response publishes, so those
  // two halves can never disagree. The REFUNDABLE total is this sum only on
  // the ledger path; on the chain path `Config.platform_refundable` wins,
  // because that is the number the program's own floor is computed from.
  const liveByTier: (LivePool | null)[] = policy.tierPot.map(() => null);
  let reserved = 0n;
  let ledgerRefundable = 0n;
  for (const p of live) {
    if (p.tier < 0 || p.tier >= liveByTier.length) continue;
    liveByTier[p.tier] = p;
    if (p.state !== 'Refunding') reserved += p.pot;
    if (p.state === 'Open') ledgerRefundable += p.price * p.entrants;
    if (p.state === 'Refunding') ledgerRefundable += p.price * (p.entrants - p.refunded);
  }

  const refundable = policy.refundable ?? ledgerRefundable;
  const balance = policy.balance ?? (await ledgerBalance(db));

  // ---- The floor. THIS IS THE THIRD COPY OF ONE SUM, and the sum has now
  // been wrong twice.
  //
  // `idle_tier_reserve` lives in the program (`instructions/treasury.rs`),
  // in the keeper's mirror (`backend/reveal/src/treasury.ts`), and here. On
  // 2026-09-12 the program started counting a per-reserved-pot RENT CUSHION
  // — `open_pool` funds a prize vault with pot PLUS `vault::rent_floor()`,
  // so a RESERVED pot costs `(pot + cushion) * reserve_pots` — and neither
  // TypeScript mirror was changed with it. The keeper's was fixed the same
  // day (commit "keeper: the open gate must count the rent cushion the
  // program counts"); this one is audit finding D-18. Nothing compares a
  // Rust figure with its TypeScript mirror, which is how one change left
  // three copies disagreeing.
  //
  // THE PROGRAM IS THE SPEC. `handle_withdraw_platform`:
  //   floor = min_platform + idle_tier_reserve(config, None, cushion)
  //         + platform_refundable
  // and `open_pool`, for the tier being opened:
  //   needed = pot + cushion + min_platform
  //          + idle_tier_reserve(config, Some(tier), cushion)
  // Change one of the three and change all three.
  const idleReserve = (excludeTier: number | null): bigint => {
    let r = 0n;
    for (let t = 0; t < policy.tierPot.length; t++) {
      if (t === excludeTier) continue;
      if (policy.enabled[t] && !liveByTier[t]) {
        r += (policy.tierPot[t] + policy.cushion) * policy.reservePots;
      }
    }
    return r;
  };

  const floor = policy.minPlatform + idleReserve(null) + refundable;
  const withdrawable = balance > floor ? balance - floor : 0n;
  const available = balance - refundable;

  let firstShort: bigint | null = null;
  const tiers: TierStatus[] = policy.tierPot.map((pot, t) => {
    const row = {
      tier: t,
      price_lamports: policy.tierPrice[t].toString(),
      pot_lamports: pot.toString(),
    };
    const livePool = liveByTier[t];
    if (livePool) {
      return {
        ...row,
        status: livePool.state === 'Open' ? 'open' : 'settling',
        live_pool_state: livePool.state,
        short_by_lamports: '0',
      };
    }
    if (!policy.enabled[t]) {
      return { ...row, status: 'disabled', live_pool_state: null, short_by_lamports: '0' };
    }
    const needed = pot + policy.cushion + policy.minPlatform + idleReserve(t);
    const short = available >= needed ? 0n : needed - available;
    if (short > 0n && firstShort === null) firstShort = short;
    return {
      ...row,
      status: short === 0n ? 'openable' : 'short',
      live_pool_state: null,
      short_by_lamports: short.toString(),
    };
  });

  // One tier-0 pool's margin: pass sales in, pot out — at a full field and
  // at the 52-seat minimum (D-E4). Shown as a range because the field a
  // pool actually runs with is decided by the players, not the operator.
  const marginFull = policy.tierPrice[0] * 64n - policy.tierPot[0];
  const marginMin = policy.tierPrice[0] * MIN_SEATS - policy.tierPot[0];
  const poolsToUnlock = (margin: bigint): string | null =>
    firstShort !== null && margin > 0n ? ((firstShort + margin - 1n) / margin).toString() : null;

  return {
    platform_balance_lamports: balance.toString(),
    reserved_pot_lamports: reserved.toString(),
    refundable_entry_lamports: refundable.toString(),
    policy: {
      reserve_pots: Number(policy.reservePots),
      min_platform_lamports: policy.minPlatform.toString(),
    },
    vault_cushion_lamports: policy.cushion.toString(),
    withdraw_floor_lamports: floor.toString(),
    withdrawable_lamports: withdrawable.toString(),
    tiers,
    policy_source: policy.source,
    enablement_source: policy.enablementSource,
    tier0_margin_lamports: { minimum_field: marginMin.toString(), full: marginFull.toString() },
    tier0_pools_to_next_unlock: poolsToUnlock(marginFull),
    tier0_pools_to_next_unlock_at_minimum_field: poolsToUnlock(marginMin),
  };
}

/** One chain read, or null. Never throws: the route is public. */
async function tryChainRead(
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
    cushion: view.vaultCushionLamports,
    source: 'chain',
    enablementSource: 'chain',
    balance: view.platformBalanceLamports,
    refundable: view.platformRefundableLamports,
  };
}

/**
 * The fallback policy: three single-row lookups, each bounded by LIMIT or by
 * the seven tiers. Seeded from the launch tables, which is the honest thing
 * a ledger alone can say — `init_config` seeds `Config` from the same
 * constants and emits nothing, and `set_tier_economics` /
 * `set_treasury_policy` / `set_open_tiers` DO emit, so a ledger that has
 * seen those events is current for whatever they changed and stale for the
 * rest. The cushion is not knowable off-chain at all: it is zero here, and
 * `vault_cushion_lamports` publishes that so the floor reads as the lower
 * bound it is.
 */
async function policyFromLedger(db: Queryable): Promise<Policy> {
  const tierPrice = TIER_ENTRY_LAMPORTS.map((v) => v);
  const tierPot = TIER_POT_LAMPORTS.map((v) => v);

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

  const policySet = await latestEvent(db, 'TreasuryPolicySet');
  const tiersOpened = await latestEvent(db, 'TiersOpened');
  const enabledFromLedger = tiersOpened
    ? (tiersOpened.open_tiers as boolean[]).map((v) => v === true)
    : null;

  return {
    minPlatform: policySet ? BigInt(policySet.min_platform_lamports as string) : 0n,
    reservePots: policySet ? BigInt(policySet.reserve_pots as number) : 1n,
    tierPrice,
    tierPot,
    enabled: enabledFromLedger ?? LAUNCH_OPEN_TIERS,
    cushion: 0n,
    source: 'ledger',
    enablementSource: enabledFromLedger ? 'ledger' : 'launch_default',
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

/** The live pools, straight off the derived table. At most one per tier. */
async function livePools(db: Queryable): Promise<LivePool[]> {
  const res = await db.query(
    `SELECT tier, entry_lamports::text AS entry_lamports, pot_lamports::text AS pot_lamports,
            state, entrants::text AS entrants, refunded_count::text AS refunded_count
       FROM pools
      WHERE state = ANY($1)`,
    [[...LIVE_STATES]]
  );
  return res.rows.map((r: Record<string, unknown>) => ({
    tier: Number(r.tier),
    price: BigInt((r.entry_lamports as string | null) ?? '0'),
    pot: BigInt((r.pot_lamports as string | null) ?? '0'),
    state: r.state as LivePool['state'],
    entrants: BigInt((r.entrants as string | null) ?? '0'),
    refunded: BigInt((r.refunded_count as string | null) ?? '0'),
  }));
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
