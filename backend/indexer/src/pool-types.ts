/**
 * GET /pool-types (D-E19, the Ladder) — every pool type, live or not: the
 * lobby's source. A pool type is a (mode, tier, capacity) with its own
 * switch, slot, cooldown, prize table, minimum field and prize pool; the
 * app lists these rather than tiers.
 *
 * CHAIN FIRST, like `GET /tiers`' `enablement_source`. The rows come from
 * every `PoolType` account (`getProgramAccounts`, 57 bytes) and the tier
 * switches and prices from `Config`, through the same cached, fail-soft
 * reader `GET /treasury` uses (`treasury-chain.ts`). When that read fails,
 * the `pool_types` projection (migration 0026), the ledger's tier switches
 * and prices, and the `pools` table's live rows answer instead, and
 * `source` says so. Only `last_pool_id` is always the ledger's: the account
 * does not carry it (`TierSlotFreed` does).
 *
 * Every lamport amount is a bigint until it is serialised as a decimal
 * string. `prize_amounts[i]` is `table[i] × entry_lamports` —
 * `amountForRank`, the scoring engine's own rule, so the lobby can never
 * show a figure the settlement would not pay. A table that rule refuses
 * (a malformed one, which the program cannot store) fails the request
 * rather than publishing an amount computed from a misread table.
 */

import { amountForRank, isPoolCapacity, minFieldFor } from '../../scoring/src/prizes';
import { preLadderTable } from '../../_shared/src/pool-account';
import type { Queryable } from './shared';
import type { TreasuryChainReader } from './treasury-chain';
import {
  hardTierEnablement,
  ledgerPoolTypeRows,
  livePools,
  poolTypeKey,
  tierEconomicsFromLedger,
  tierEnablement,
  tryChainRead,
} from './treasury-report';

/** One row of GET /pool-types — the wire contract the app reads. */
export interface PoolTypeRow {
  mode: 'easy' | 'hard';
  tier: number;
  capacity: number;
  /** Takes entries at all: the tier is open for the mode AND the type is enabled. */
  live: boolean;
  type_enabled: boolean;
  tier_open: boolean;
  min_seats: number;
  paid_places: number;
  /** Whole multiples of the entry, rank 1 first, one per paid place. */
  prize_table: number[];
  entry_lamports: string;
  prize_pool_lamports: string;
  /** Lamports per paid place, rank 1 first: `table[i] × entry_lamports`. */
  prize_amounts: string[];
  /** The type's live pool (its Pool PDA), or null. */
  live_pool: string | null;
  live_pool_id: number | null;
  /** The type's cooldown stamp (unix seconds) — the next pool may open from
   * here; null when the type has never settled a pool (no cooldown). */
  next_open_at: number | null;
  /** The pool that last freed the type's slot, or null. */
  last_pool_id: number | null;
}

export interface PoolTypesBody {
  server_time: number;
  source: 'chain' | 'ledger';
  pool_types: PoolTypeRow[];
}

/**
 * Lamports per paid place: `amountForRank(table, entry, rank)` for each
 * place. Empty when there is no table (economics unset, or a pre-Ladder
 * pool whose prize pool is not a whole number of entries) or no price.
 */
export function prizeAmounts(table: readonly number[], entryLamports: bigint | null): string[] {
  if (table.length === 0 || entryLamports === null || entryLamports <= 0n) return [];
  return table.map((_, i) => amountForRank(table, entryLamports, i + 1).toString());
}

/** A cooldown stamp as the wire carries it: 0 (never settled) is null. */
function stampOf(v: bigint): number | null {
  return v === 0n ? null : Number(v);
}

function sortRows(rows: PoolTypeRow[]): PoolTypeRow[] {
  const m = (r: PoolTypeRow): number => (r.mode === 'hard' ? 1 : 0);
  return rows.sort((a, b) => m(a) - m(b) || a.tier - b.tier || a.capacity - b.capacity);
}

/** Build the GET /pool-types body. Never throws for a failed chain read. */
export async function poolTypesBody(
  db: Queryable,
  nowUnix: number,
  chain: TreasuryChainReader | null
): Promise<PoolTypesBody> {
  const view = await tryChainRead(chain);
  // The projection answers `last_pool_id` on both paths, and every column
  // on the ledger path. Rows a pre-Ladder slot stamp created (no PoolType
  // event, so no account) are not pool types and are not listed.
  const ledgerRows = await ledgerPoolTypeRows(db);
  const lastPoolId = new Map(
    ledgerRows.map((r) => [poolTypeKey(r.mode, r.tier, r.capacity), r.lastPoolId])
  );

  if (view) {
    const rows = (view.poolTypes ?? []).map((t): PoolTypeRow => {
      const tierOpen = (t.mode === 1 ? view.hardOpenTiers : view.openTiers)[t.tier] === true;
      const price = view.tierPriceLamports[t.tier] ?? 0n;
      const paid = Math.min(t.paidPlaces, t.prizeTable.length);
      const table = t.prizeTable.slice(0, paid);
      const last = lastPoolId.get(poolTypeKey(t.mode, t.tier, t.capacity)) ?? null;
      return {
        mode: t.mode === 1 ? 'hard' : 'easy',
        tier: t.tier,
        capacity: t.capacity,
        live: tierOpen && t.enabled,
        type_enabled: t.enabled,
        tier_open: tierOpen,
        min_seats: t.minSeats,
        paid_places: t.paidPlaces,
        prize_table: table,
        entry_lamports: price.toString(),
        prize_pool_lamports: t.potLamports.toString(),
        prize_amounts: prizeAmounts(table, price),
        live_pool: t.activePoolAddress,
        live_pool_id: t.activePool === 0n ? null : Number(t.activePool),
        next_open_at: stampOf(t.nextOpenAt),
        last_pool_id: last === null ? null : Number(last),
      };
    });
    return { server_time: nowUnix, source: 'chain', pool_types: sortRows(rows) };
  }

  // The ledger: the projection, the ledger's switches and prices, and the
  // `pools` table's live rows for each type's slot.
  const easy = await tierEnablement(db, null);
  const hard = await hardTierEnablement(db, null);
  const { tierPrice } = await tierEconomicsFromLedger(db);
  const liveByType = new Map<string, { pool: string; id: string | null; open: boolean }>();
  for (const p of await livePools(db)) {
    const k = poolTypeKey(p.mode, p.tier, p.capacity);
    if (!liveByType.has(k) || p.state === 'Open') {
      liveByType.set(k, { pool: p.pool, id: p.id, open: p.state === 'Open' });
    }
  }
  const rows = ledgerRows.map((r): PoolTypeRow => {
    const tierOpen = (r.mode === 1 ? hard.enabled : easy.enabled)[r.tier] === true;
    const price = tierPrice[r.tier] ?? 0n;
    const livePool = liveByType.get(poolTypeKey(r.mode, r.tier, r.capacity));
    return {
      mode: r.mode === 1 ? 'hard' : 'easy',
      tier: r.tier,
      capacity: r.capacity,
      live: tierOpen && r.enabled,
      type_enabled: r.enabled,
      tier_open: tierOpen,
      min_seats: r.minSeats,
      paid_places: r.paidPlaces,
      prize_table: r.prizeTable,
      entry_lamports: price.toString(),
      prize_pool_lamports: r.potLamports.toString(),
      prize_amounts: prizeAmounts(r.prizeTable, price),
      live_pool: livePool ? livePool.pool : null,
      live_pool_id: livePool && livePool.id !== null ? Number(livePool.id) : null,
      next_open_at: stampOf(r.nextOpenAt),
      last_pool_id: r.lastPoolId === null ? null : Number(r.lastPoolId),
    };
  });
  return { server_time: nowUnix, source: 'ledger', pool_types: sortRows(rows) };
}

/** The Ladder fields of one `pools` row, as GET /pools serves them. */
export interface PoolLadderFields {
  capacity: number;
  paid_places: number;
  prize_table: number[];
  prize_amounts: string[];
  min_seats: number;
  outcome_if_deadline_now: 'seal' | 'refund';
}

/**
 * Read a `pools` row's size, table and floor (migration 0026), and what its
 * deadline would do right now.
 *
 * Every pool opened under the Ladder carries all four in `PoolOpened`, and
 * `migrate_pool` restates them for an older pool in `PoolMigrated`, so for
 * those this is the pool's OWN value — the number the program enforces,
 * copied at open so an upgrade cannot move it under seated players. Two
 * readings remain for a row that does not carry them:
 *
 *   - no table (a row projected before 0026 and not yet rederived): the
 *     pre-Ladder rule, `preLadderTable` — 64 seats, one place worth the
 *     whole prize pool in whole entries — the same rule the account
 *     decoder and the program's migration apply;
 *   - no floor (a pre-Ladder `PoolOpened`, which never stated one, and no
 *     `PoolMigrated` yet): the launch minimum field for the pool's size,
 *     40 for 64 (`MIN_FIELD_BY_CAPACITY`) — exactly what this route served
 *     for every pool before the floor was per pool.
 *
 * PHASE-N-REVIEW: the floor fallback serves a launch value as a pool's own
 * for a pre-Ladder pool not yet migrated; the runbook migrates every pool
 * at the upgrade, after which no live row takes this path.
 */
export function poolLadderFields(r: Record<string, unknown>): PoolLadderFields {
  const capacity = r.capacity === null || r.capacity === undefined ? 64 : Number(r.capacity);
  const entry =
    r.entry_lamports === null || r.entry_lamports === undefined ? null : BigInt(String(r.entry_lamports));
  const pot = r.pot_lamports === null || r.pot_lamports === undefined ? null : BigInt(String(r.pot_lamports));

  let prizeTable: number[];
  let paidPlaces: number;
  if (Array.isArray(r.prize_table)) {
    prizeTable = (r.prize_table as unknown[]).map(Number);
    paidPlaces = r.paid_places === null || r.paid_places === undefined ? prizeTable.length : Number(r.paid_places);
  } else if (entry !== null && pot !== null) {
    const t = preLadderTable(entry, pot);
    paidPlaces = t.paidPlaces;
    prizeTable = t.prizeTable.slice(0, t.paidPlaces);
  } else {
    paidPlaces = 0;
    prizeTable = [];
  }

  const minSeats =
    r.min_seats === null || r.min_seats === undefined
      ? isPoolCapacity(capacity)
        ? minFieldFor(capacity)
        : minFieldFor(64)
      : Number(r.min_seats);
  const entrants = Number(r.entrants);
  // A pool at capacity sealed when it filled; below that, its deadline seals
  // it at or above its own minimum field and refunds every entry below it.
  const outcome: 'seal' | 'refund' = entrants >= capacity || entrants >= minSeats ? 'seal' : 'refund';

  return {
    capacity,
    paid_places: paidPlaces,
    prize_table: prizeTable,
    prize_amounts: prizeAmounts(prizeTable, entry),
    min_seats: minSeats,
    outcome_if_deadline_now: outcome,
  };
}
