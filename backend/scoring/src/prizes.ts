/**
 * Prize amounts — the Ladder (decision D-E19, founder ruling 2026-11-04,
 * superseding D-E2's winner-takes-all; mirrored in
 * programs/blotto_cup/src/constants.rs).
 *
 * A pool holds 8, 16, 32 or 64 players and pays the top quarter of its
 * capacity on a FIXED table of whole multiples of the entry price. The table
 * depends on the pool's capacity and nothing else — never on how many
 * players entered, never on any balance. That independence is what the
 * product's characterisation rests on, so this module carries no function
 * that reads an entrant count into an amount.
 *
 *   capacity  paid  table (multiples of the entry, 1st first)      prize pool
 *        8      2   3, 2                                            5 × entry
 *       16      4   5, 3, 1, 1                                     10 × entry
 *       32      8   8, 4, 2, 2, 1, 1, 1, 1                         20 × entry
 *       64     16   12, 6, 3, 3, 2, 2, 2, 2, 1 × 8                 40 × entry
 *
 * Multiples are an INTERNAL design unit: players are shown SOL per place,
 * never "× entry" (counsel's standing rule). Every untied prize is
 * `multiple × entry_lamports`, exact at every tier — no rounding anywhere.
 * Ties follow D3-B unchanged (see `assignPrizes`).
 *
 * The authoritative table for a LIVE pool is the one copied onto its Pool
 * account at open (`Pool.prize_table`), read through `prizeTableFromChain`.
 * `LADDER_TABLES` is the published launch table: what new pool types are
 * configured with, and what the rules page shows.
 *
 * All lamport arithmetic is BIGINT. A prize amount must never pass through a
 * JavaScript number: lamport values exceed 2^53 at the upper tiers and a
 * float-rounded prize is a payment bug.
 */

/**
 * The largest pool — and the size every fixed on-chain array is
 * dimensioned by (`Pool.payouts`, the `paid_mask` bit field). A pool's own
 * capacity is `Pool.capacity`; this is only the ceiling.
 * Mirrors `constants.rs::CAPACITY`.
 */
export const MAX_CAPACITY = 64n;

/** The four pool sizes (D-E19), smallest first. Mirrors `constants.rs::POOL_CAPACITIES`. */
export const POOL_CAPACITIES = [8, 16, 32, 64] as const;
export type PoolCapacity = (typeof POOL_CAPACITIES)[number];

/** The widest table (a 64-player pool pays 16 places). The on-chain table is `[u8; 16]`. */
export const MAX_PAID_PLACES = 16;

/**
 * The published prize tables (D-E19), in multiples of the entry, rank 1
 * first, one entry per paid place. A pool pays `capacity / 4` places.
 * Mirrors `constants.rs::LADDER_TABLES` (zero-padded to 16 there) and the
 * Python oracle's table in fixtures/gen_vectors.py.
 */
export const LADDER_TABLES: Readonly<Record<PoolCapacity, readonly number[]>> = {
  8: [3, 2],
  16: [5, 3, 1, 1],
  32: [8, 4, 2, 2, 1, 1, 1, 1],
  64: [12, 6, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
};

/**
 * The minimum field per capacity (D-E19; generalises R7-b's 40 at 64): the
 * break-even field, where entries equal the prize pool. At its deadline a
 * pool holding at least this many seals and plays; below it, every entry
 * refunds in full. A seat count, never a percentage. Mirrors
 * `constants.rs::LADDER_MIN_SEATS`.
 *
 * The value a given pool plays at is `Pool.min_seats`, copied at open —
 * this table is what new pool types are configured with.
 */
export const MIN_FIELD_BY_CAPACITY: Readonly<Record<PoolCapacity, number>> = {
  8: 5,
  16: 10,
  32: 20,
  64: 40,
};

/** Is `n` one of the four pool sizes? */
export function isPoolCapacity(n: number): n is PoolCapacity {
  return (POOL_CAPACITIES as readonly number[]).includes(n);
}

/** The launch table for a capacity; throws on anything that is not a pool size. */
export function ladderTable(capacity: number): readonly number[] {
  if (!isPoolCapacity(capacity)) throw new Error(`no pool of ${capacity} players exists`);
  return LADDER_TABLES[capacity];
}

/** The launch minimum field for a capacity; throws on anything that is not a pool size. */
export function minFieldFor(capacity: number): number {
  if (!isPoolCapacity(capacity)) throw new Error(`no pool of ${capacity} players exists`);
  return MIN_FIELD_BY_CAPACITY[capacity];
}

/**
 * Validate a prize table's SHAPE — the same rules `set_pool_type_economics`
 * enforces on chain: one positive whole multiple per paid place, at most
 * `MAX_PAID_PLACES` of them, never increasing down the table. Returns the
 * table; throws with the reason otherwise.
 */
export function assertPrizeTable(table: readonly number[]): readonly number[] {
  if (table.length < 1 || table.length > MAX_PAID_PLACES) {
    throw new Error(`a prize table pays 1..${MAX_PAID_PLACES} places, got ${table.length}`);
  }
  for (let i = 0; i < table.length; i++) {
    const m = table[i];
    if (!Number.isInteger(m) || m < 1 || m > 255) {
      throw new Error(`place ${i + 1}: a multiple is a whole number in 1..255, got ${m}`);
    }
    if (i > 0 && m > table[i - 1]) {
      throw new Error(`place ${i + 1} (${m}) pays more than place ${i} (${table[i - 1]})`);
    }
  }
  return table;
}

/**
 * Read a pool's table from its on-chain form: `prize_table: [u8; 16]`,
 * zero-padded, with `paid_places` non-zero entries first. Refuses a
 * malformed table (a zero inside the paid places, a non-zero after them,
 * an increasing table) rather than guessing: an amount computed from a
 * misread table is a payment bug.
 */
export function prizeTableFromChain(raw: ArrayLike<number>, paidPlaces: number): number[] {
  if (raw.length !== MAX_PAID_PLACES) {
    throw new Error(`an on-chain prize table is ${MAX_PAID_PLACES} bytes, got ${raw.length}`);
  }
  if (!Number.isInteger(paidPlaces) || paidPlaces < 1 || paidPlaces > MAX_PAID_PLACES) {
    throw new Error(`paid places must be 1..${MAX_PAID_PLACES}, got ${paidPlaces}`);
  }
  for (let i = paidPlaces; i < MAX_PAID_PLACES; i++) {
    if (raw[i] !== 0) throw new Error(`prize table has a non-zero entry past its ${paidPlaces} paid places`);
  }
  return [...assertPrizeTable(Array.from(raw).slice(0, paidPlaces))];
}

/**
 * The prize pool a table pays at an entry price: the sum of its multiples
 * times the price — exact, in lamports. This is the number `open_pool` moves
 * from the treasury into the vault (stored on chain as a FIXED value and
 * compared, never computed there). Display and fixtures use it; settlement
 * uses the pool's own `pot_lamports`.
 */
export function prizePoolFor(table: readonly number[], entryLamports: bigint): bigint {
  assertPrizeTable(table);
  if (entryLamports <= 0n) throw new Error(`entry price must be positive, got ${entryLamports}`);
  let total = 0n;
  for (const m of table) total += BigInt(m) * entryLamports;
  return total;
}

/**
 * The fill deadline `open_pool` seeds into every new pool, in seconds — a
 * TS mirror of `constants.rs::DEFAULT_FILL_DEADLINE_SECS` (12 hours,
 * founder ruling 2026-09-07, superseding R7's 72 h). Since the same ruling
 * it lives in `Config.fill_deadline_seconds` (changeable by the admin's
 * `set_pool_timing`, never touching an open pool); this constant is the
 * launch value and what the rules page states. Option A: a pool seals when
 * its capacity is reached, or at this deadline with at least its minimum
 * field (`Pool.min_seats`), and refunds below — there is no second clock
 * (the go-timer of the first cut is gone).
 */
export const DEFAULT_FILL_DEADLINE_SECS = 12n * 3600n;

/**
 * The cooldown after a pool settles (Paid or Closed) before its pool type's
 * next pool may open — `constants.rs::DEFAULT_COOLDOWN_SECS`, seeded into
 * `Config.cooldown_seconds` (prompt v2 §B.6). The app's "next pool in"
 * countdown reads the on-chain `PoolType.next_open_at` (D-E19), not this.
 */
export const DEFAULT_COOLDOWN_SECS = 5n * 60n;

// The keeper liveness fallback mirrored here was removed from the program on
// 2026-09-07 (founder ruling; audit O9b). `open_pool` is keeper-only, with no
// time-based exception, so there is no constant left to mirror.

/**
 * The published resolving window — "Resolving lasts up to 12 hours … If no
 * decision is made within 12 hours, the flag is cleared and the prize is
 * paid" (rules page, founder addendum 2026-09-07). Not an on-chain
 * quantity: the program's only clock on a held share is the seven-day
 * safeguard below. Two things read this and must agree: the read API, which
 * derives a pool's "resolving" from its held shares and this window (Phase 2
 * Stage C), and the settlement daemon, which releases a still-held share to
 * its player once the window has passed (Stage D). The rules copy states
 * the number in words; `app/src/copy/published-claims.test.ts` pins the two
 * together.
 */
export const REVIEW_WINDOW_SECS = 12n * 3600n;

/**
 * How long after a share is escrowed anyone may release it to its player —
 * `constants.rs::ESCROW_AUTO_RELEASE_SECS` (prompt v2 §E.3): inaction pays
 * the player. An upheld flag (`forfeit_escrow`, admin-signed) closes this
 * door; the share then stays in the pool's vault until it is paid onward to
 * other players of the same pool (never to the operator). Under D-E19 that
 * onward payment is "the field moves up"; until its instructions ship, a
 * forfeited share in a multi-place pool is held, not paid.
 */
export const ESCROW_AUTO_RELEASE_SECS = 7n * 24n * 3600n;

/**
 * The seven configured entry prices (D1, ratified 2026-08-27), tier 0..6 —
 * a TS mirror of `programs/blotto_cup/src/constants.rs::TIER_ENTRY_LAMPORTS`.
 * The Rust table is authoritative; this mirror is pinned to the Python
 * oracle's per-tier tables (vectors.json `tier_tables`) by the vector suite,
 * so drift fails tests rather than shipping. Rules-page and prize-table UI
 * derive every displayed number from THIS table and `LADDER_TABLES` — never
 * hand-typed.
 */
export const TIER_ENTRY_LAMPORTS: readonly bigint[] = [
  100_000_000n,
  500_000_000n,
  750_000_000n,
  1_000_000_000n,
  2_500_000_000n,
  5_000_000_000n,
  7_500_000_000n,
];

/**
 * The prize for `rank` (1-based) in a pool paying `table` at
 * `entryLamports`: `table[rank-1] × entry`. Every rank past the table is a
 * real rank with zero prize — it appears in the results tree with amount 0.
 * Ties are not this function's business; `assignPrizes` combines positions.
 */
export function amountForRank(table: readonly number[], entryLamports: bigint, rank: number): bigint {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new Error(`rank must be a positive integer, got ${rank}`);
  }
  assertPrizeTable(table);
  if (entryLamports <= 0n) throw new Error(`entry price must be positive, got ${entryLamports}`);
  if (rank > table.length) return 0n;
  return BigInt(table[rank - 1]) * entryLamports;
}
