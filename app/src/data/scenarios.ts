/*
 * Preview scenarios — the pool states and viewer relationships the design
 * work needs to see, as ordinary fixture data.
 *
 * WHY THIS EXISTS. Every page in this app gates on real state: no wallet, no
 * entry, no settled pool, no results. Before this file the fixture set was a
 * single Open pool with empty everything, so most screens could not be
 * reached at all without a live indexer, a funded wallet, and a pool that
 * happened to be in the right state at the right moment. Design work should
 * not have to wait on a tournament.
 *
 * THE DESIGN DECISION. A scenario is not a mode, a flag, or a global — it is
 * just ANOTHER POOL in the fixture set, addressed by its own id. That falls
 * out of the seam that already exists (`indexerApi()` returns FIXTURE_API
 * when no indexer is configured), and it means:
 *
 *   - no page changes at all, and no risk of a preview branch reaching users;
 *   - server components work, because there is no request-scoped state to
 *     thread through them;
 *   - two scenarios can be open in two tabs without fighting each other.
 *
 * The alternative — a mutable "current scenario" the preview page sets — was
 * rejected: it is global state read during server rendering, which is the
 * shape of bug that shows one person's preview to another.
 *
 * IDS ARE BASE58. Solana addresses exclude `0`, `O`, `I` and `l`, so the
 * readable labels below substitute digits (`sea1ed`, `c1osed`). An id that is
 * not base58-shaped would render fine here and then fail the moment anything
 * tried to treat it as an address.
 *
 * NOT REACHABLE IN PRODUCTION, and since the audit of 2026-09-11 (A-07 /
 * C-26 / D-15 / E-01) that is enforced rather than asserted. This file used
 * to say the only page linking here is `/dev/preview`, which hard-404s
 * outside development — true, and beside the point: the ORDINARY pages read
 * through `indexerApi()`, which served this catalogue to anyone whenever
 * NEXT_PUBLIC_INDEXER_URL was unset or empty, in a deployed build. It now
 * returns a read API that throws in a production build, so these rows can
 * only be served by a development or test build (`data/api.ts`).
 */

import {
  LADDER_TABLES,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
  TIER_ENTRY_LAMPORTS,
  amountForRank,
  prizePoolFor,
  type PoolCapacity,
} from '@blotto/scoring';
import type {
  CareerRow,
  EntryRow,
  LeaderboardRow,
  PayoutRow,
  PoolLeaderboard,
  PoolSummary,
  PoolTypeRow,
  ProfileRow,
  ResultRow,
  TreasuryTiers,
} from './types';

/** Base58 alphabet — no 0, O, I or l. Used to keep fixture ids address-shaped. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** A 44-character, base58-valid id carrying a readable label. */
function fixtureId(label: string): string {
  const id = `F1XTURE${label}`.padEnd(44, '1');
  if (id.length !== 44 || !BASE58.test(id)) {
    throw new Error(`fixture id for "${label}" is not a 44-char base58 string: ${id}`);
  }
  return id;
}

/** The viewer these scenarios are written from — a stable, obviously-fake wallet. */
export const FIXTURE_PLAYER = fixtureId('P1ayer');

const HOUR = 3600;
/** Deadlines are relative to render time so countdowns animate rather than sit dead. */
const soon = (seconds: number): string => String(Math.floor(Date.now() / 1000) + seconds);
const past = (seconds: number): string => String(Math.floor(Date.now() / 1000) - seconds);
/** The fixture's `server_time` — the fixture IS the server here. */
const serverNow = (): string => String(Math.floor(Date.now() / 1000));

/** Tier 0 — the one tier open at launch (0.1 SOL), from the shared table. */
const TIER0_ENTRY_LAMPORTS = TIER_ENTRY_LAMPORTS[0]!;
const TIER0_ENTRY = TIER0_ENTRY_LAMPORTS.toString();
const SEALING_PUBKEY = '11'.repeat(32);
/** The viewer's seat in every scenario that has one. */
const VIEWER_SEAT = 3;

/**
 * A pool type's launch economics at tier 0 (D-E19) — the size, the floor,
 * the table and every amount, read from the published tables and computed
 * by @blotto/scoring. NOTHING here is typed: a fixture amount that drifted
 * from what the program pays would render on every preview as fact.
 */
export function tier0Ladder(capacity: PoolCapacity) {
  const table = LADDER_TABLES[capacity];
  return {
    capacity,
    min_seats: MIN_FIELD_BY_CAPACITY[capacity],
    paid_places: table.length,
    prize_table: [...table],
    prize_amounts: table.map((_, i) => amountForRank(table, TIER0_ENTRY_LAMPORTS, i + 1).toString()),
    pot_lamports: prizePoolFor(table, TIER0_ENTRY_LAMPORTS).toString(),
  };
}

/** What `rank` is paid in a full tier-0 pool of `capacity` (zero past the table). */
const prizeAt = (capacity: PoolCapacity, rank: number): string =>
  amountForRank(LADDER_TABLES[capacity], TIER0_ENTRY_LAMPORTS, rank).toString();

export interface Scenario {
  /** URL-safe key, and the label shown on the preview index. */
  readonly key: string;
  /** One line on the index saying what this scenario is FOR. */
  readonly what: string;
  readonly summary: PoolSummary;
  readonly entries: EntryRow[];
  readonly results: ResultRow[];
  readonly payouts: PayoutRow[];
  /** E3: the verified-archive ranking; null where no bundle verified. */
  readonly leaderboard?: PoolLeaderboard | null;
}

function poolSummary(
  over: Partial<PoolSummary> & { pool: string; id: string; capacity: PoolCapacity }
): PoolSummary {
  const ladder = tier0Ladder(over.capacity);
  return {
    tier: 0,
    entry_lamports: TIER0_ENTRY,
    ...ladder,
    fill_deadline: soon(12 * HOUR),
    timer_seconds: 15,
    state: 'Open',
    sealing_pubkey: SEALING_PUBKEY,
    entrants: 0,
    results_root: null,
    secret: null,
    // Stage C: derived by the read API; closed by default, opened by the
    // escrow scenario below.
    held_shares: 0,
    resolving: false,
    resolving_until: null,
    server_time: serverNow(),
    ...over,
    // Recomputed AFTER the overrides, from whatever entrant count they set
    // and the POOL's own floor (R7-b; D-E19). A fixture that says 50 entered
    // and "would refund" is a contradiction the preview would render as fact.
    outcome_if_deadline_now:
      over.outcome_if_deadline_now ?? ((over.entrants ?? 0) >= ladder.min_seats ? 'seal' : 'refund'),
  };
}

/**
 * A seat's wallet label, in base58 digits. Seat numbers cannot be written as
 * decimals here: `0` is not in the alphabet, so `Seat0` and `Seat10` are not
 * addresses. This is the kind of thing that renders perfectly and then fails
 * the moment something treats the string as a real key.
 */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function seatLabel(idx: number): string {
  return idx < B58.length ? B58[idx] : `${B58[0]}${B58[idx - B58.length]}`;
}

/** Seats 0..n-1, placing the viewer at seat 3 so "my row" is visible. */
function entries(pool: string, count: number, over: Partial<EntryRow> = {}): EntryRow[] {
  return Array.from({ length: count }, (_, idx) => ({
    pool,
    player: idx === VIEWER_SEAT ? FIXTURE_PLAYER : fixtureId(`Seat${seatLabel(idx)}`),
    idx,
    // Class is COSMETIC and read by nothing in the scoring path (PID §8.4);
    // varied here only so the collection art has something to show.
    class: idx % 5,
    battles_hash: 'ab'.repeat(32),
    flagged: false,
    refunded: false,
    escrow_settled: null,
    ...over,
  }));
}

/**
 * A settled pool's finishing order: seats in rank order, the viewer's seat
 * at `viewerRank`, everyone else by seat number. No ties — the tie rule is
 * the scoring engine's, pinned by its own vectors, and a fixture that
 * invented a tie would only be a picture of one.
 */
function finishingOrder(field: number, viewerRank: number): number[] {
  const others = Array.from({ length: field }, (_, s) => s).filter((s) => s !== VIEWER_SEAT);
  others.splice(viewerRank - 1, 0, VIEWER_SEAT);
  return others;
}

/** One settled pool's shape: its size, the field that played, where the viewer finished. */
interface Settled {
  capacity: PoolCapacity;
  field: number;
  viewerRank: number;
}

/** The committed payout list (D3-B): every seat with a non-zero prize, seat-sorted. */
function results(s: Settled): ResultRow[] {
  return finishingOrder(s.field, s.viewerRank)
    .map((seat, i) => ({ seat, amount: prizeAt(s.capacity, i + 1) }))
    .filter((r) => r.amount !== '0')
    .sort((a, b) => a.seat - b.seat);
}

function payouts(pool: string, s: Settled, escrowSeat: number | null = null): PayoutRow[] {
  const byIdx = entries(pool, s.field);
  return results(s).map((r) => ({
    seat: r.seat,
    player: byIdx[r.seat].player,
    amount: r.amount,
    escrowed: r.seat === escrowSeat,
  }));
}

/**
 * The full archive ranking (E3) for a settled scenario, over the field that
 * played. Every paid place carries the amount `results()` commits; every
 * rank past the table is zero (D-E19).
 *
 * D-E8: the on-chain root commits to `player`, `rank` and `amount_lamports`
 * only, and the response says so in `committed_fields`. `seat` therefore
 * comes from indexed chain records and is nullable, and the scores live
 * under `recomputed`. `score_half` is in HALF-POINT integer units across the
 * seven battles (max 14) and descends with rank so the table reads plausibly
 * — a display fixture, not a scored pool.
 */
function leaderboard(pool: string, s: Settled): PoolLeaderboard {
  const byIdx = entries(pool, s.field);
  const order = finishingOrder(s.field, s.viewerRank);
  const paidPlaces = LADDER_TABLES[s.capacity].length;
  // D-E8: one row whose entry number our records do not hold — the shape the
  // read API serves when an entry event was missed. The first UNPAID row that
  // is not the viewer's, so every paid row still names the seat `payouts()`
  // names and the viewer's own result can still find its battles.
  const seatless = order.find((seat, i) => i + 1 > paidPlaces && seat !== VIEWER_SEAT);
  const rows: LeaderboardRow[] = order.map((seat, i) => ({
    player: byIdx[seat].player,
    rank: i + 1,
    amount_lamports: prizeAt(s.capacity, i + 1),
    seat: seat === seatless ? null : seat,
    recomputed: {
      score_half: Math.max(1, 14 - Math.floor(i / 4)),
      zones: Math.max(1, 20 - Math.floor(i / 3)),
    },
  }));
  return {
    pool,
    uri: `https://gateway.irys.xyz/F1XTUREbund1e${pool.slice(7, 15)}`,
    results_root: 'ef'.repeat(32),
    verified_at: '2026-09-01T12:00:00Z',
    committed_fields: ['player', 'rank', 'amount_lamports'],
    rows,
  };
}

const OPEN = fixtureId('Poo'); // the original fixture id — kept so it never moves
const HARD_OPEN = fixtureId('hard'); // the journey suite's hard pool — kept too
const HARD_16 = fixtureId('hard16');
const HARD_32 = fixtureId('hard32');
const HARD_64 = fixtureId('hard64');
const FILLING = fixtureId('fi11ing');
const SEALED = fixtureId('sea1ed');
const SCORED = fixtureId('scored');
const PAID = fixtureId('paid');
const ESCROW = fixtureId('escrow');
const REFUNDING = fixtureId('refunding');
const CLOSED = fixtureId('c1osed');
const DEADLINE = fixtureId('dead1ine');
const FIELD = fixtureId('fie1d');
const FIELD_PAID = fixtureId('fie1dpaid');

/* The settled pools' shapes. */
const PAID_SHAPE: Settled = { capacity: 64, field: 64, viewerRank: 1 };
const ESCROW_SHAPE: Settled = { capacity: 64, field: 64, viewerRank: 3 };
const SCORED_SHAPE: Settled = { capacity: 64, field: 64, viewerRank: 1 };
const FIELD_PAID_SHAPE: Settled = { capacity: 32, field: 26, viewerRank: 11 };

/*
 * THE OPEN POOLS: exactly one per pool type at tier 0 — both boards × the
 * four sizes (D-E19, the devnet launch) — because production never holds
 * two open pools of one type, and the landing's size toggle shows each
 * type's live fill. The original `open` pool is the easy 8 (the landing's
 * default size), so the journey suite's ids keep working.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    key: 'open',
    what: 'A fresh easy pool of 8, nearly empty — the landing’s default size. The enter path and the ring at rest.',
    summary: poolSummary({ pool: OPEN, id: 'FIXTURE', capacity: 8, entrants: 3 }),
    entries: entries(OPEN, 3),
    results: [],
    payouts: [],
  },
  {
    key: 'hard-open',
    what: 'Phase B: an open HARD pool of 8 in the same tier — the hard side of the landing, and the 700-anywhere board behind it.',
    summary: poolSummary({
      pool: HARD_OPEN,
      id: 'FIXTURE-HARD',
      mode: 'hard',
      capacity: 8,
      entrants: 5,
      // Its own clock (founder: the pools run on separate timers).
      fill_deadline: soon(9 * HOUR),
    }),
    entries: entries(HARD_OPEN, 5),
    results: [],
    payouts: [],
  },
  {
    key: 'deadline',
    what: 'An easy pool of 16, under its minimum field of 10 and minutes from the deadline — the refund fork is next.',
    summary: poolSummary({
      pool: DEADLINE,
      id: 'FIXTURE-DEADLINE',
      capacity: 16,
      entrants: 7,
      fill_deadline: soon(9 * 60),
    }),
    entries: entries(DEADLINE, 7),
    results: [],
    payouts: [],
  },
  {
    key: 'field',
    what: 'An easy pool of 32 past its minimum field of 20, the clock still running — it will run either way.',
    summary: poolSummary({
      pool: FIELD,
      id: 'FIXTURE-FIELD',
      capacity: 32,
      entrants: 22,
      fill_deadline: soon(6 * HOUR - 5 * 60),
    }),
    entries: entries(FIELD, 22),
    results: [],
    payouts: [],
  },
  {
    key: 'filling',
    what: 'An easy pool of 64, almost full (61/64), four hours left.',
    summary: poolSummary({
      pool: FILLING,
      id: 'FIXTURE-FILLING',
      capacity: 64,
      entrants: 61,
      fill_deadline: soon(4 * HOUR),
    }),
    entries: entries(FILLING, 61),
    results: [],
    payouts: [],
  },
  {
    key: 'hard-16',
    what: 'An open hard pool of 16, nearly at its minimum field.',
    summary: poolSummary({
      pool: HARD_16,
      id: 'FIXTURE-HARD-16',
      mode: 'hard',
      capacity: 16,
      entrants: 9,
      fill_deadline: soon(7 * HOUR),
    }),
    entries: entries(HARD_16, 9),
    results: [],
    payouts: [],
  },
  {
    key: 'hard-32',
    what: 'An open hard pool of 32, short of its minimum field.',
    summary: poolSummary({
      pool: HARD_32,
      id: 'FIXTURE-HARD-32',
      mode: 'hard',
      capacity: 32,
      entrants: 14,
      fill_deadline: soon(10 * HOUR),
    }),
    entries: entries(HARD_32, 14),
    results: [],
    payouts: [],
  },
  {
    key: 'hard-64',
    what: 'An open hard pool of 64, a third full.',
    summary: poolSummary({
      pool: HARD_64,
      id: 'FIXTURE-HARD-64',
      mode: 'hard',
      capacity: 64,
      entrants: 26,
      fill_deadline: soon(11 * HOUR),
    }),
    entries: entries(HARD_64, 26),
    results: [],
    payouts: [],
  },
  {
    key: 'field-paid',
    what: 'A pool of 32 that ran at its deadline with 26 and paid its 8 places — the viewer finished 11th, unpaid: the factual one-line finish.',
    summary: poolSummary({
      pool: FIELD_PAID,
      id: 'FIXTURE-FIELD-PAID',
      capacity: 32,
      state: 'Paid',
      entrants: FIELD_PAID_SHAPE.field,
      fill_deadline: past(20 * HOUR),
      results_root: 'ef'.repeat(32),
      secret: 'ab'.repeat(32),
    }),
    entries: entries(FIELD_PAID, FIELD_PAID_SHAPE.field),
    results: results(FIELD_PAID_SHAPE),
    payouts: payouts(FIELD_PAID, FIELD_PAID_SHAPE),
    leaderboard: leaderboard(FIELD_PAID, FIELD_PAID_SHAPE),
  },
  {
    key: 'sealed',
    what: 'A pool of 16, full and sealed, awaiting settlement. No results yet; the secret is not out.',
    summary: poolSummary({
      pool: SEALED,
      id: 'FIXTURE-SEALED',
      capacity: 16,
      state: 'Sealed',
      entrants: 16,
      fill_deadline: past(2 * HOUR),
    }),
    entries: entries(SEALED, 16),
    results: [],
    payouts: [],
  },
  {
    key: 'scored',
    what: 'A pool of 64 with results committed, prizes not yet pushed. The reveal, mid-flight.',
    summary: poolSummary({
      pool: SCORED,
      id: 'FIXTURE-SCORED',
      capacity: 64,
      state: 'Scored',
      entrants: 64,
      fill_deadline: past(6 * HOUR),
      results_root: 'ef'.repeat(32),
      secret: 'ab'.repeat(32),
    }),
    entries: entries(SCORED, 64),
    results: results(SCORED_SHAPE),
    payouts: [],
  },
  {
    key: 'paid',
    what: 'A pool of 64, settled and paid to its 16 places. The viewer holds seat 3 and finished 1st.',
    summary: poolSummary({
      pool: PAID,
      id: 'FIXTURE-PAID',
      capacity: 64,
      state: 'Paid',
      entrants: 64,
      fill_deadline: past(30 * HOUR),
      results_root: 'ef'.repeat(32),
      secret: 'ab'.repeat(32),
    }),
    entries: entries(PAID, 64),
    results: results(PAID_SHAPE),
    payouts: payouts(PAID, PAID_SHAPE),
    leaderboard: leaderboard(PAID, PAID_SHAPE),
  },
  {
    key: 'escrow',
    what: "Paid, but the viewer's own 3rd-place share is held in escrow — the KYC/review copy, and the RESOLVING badge with its countdown.",
    summary: poolSummary({
      pool: ESCROW,
      id: 'FIXTURE-ESCROW',
      capacity: 64,
      state: 'Paid',
      entrants: 64,
      fill_deadline: past(30 * HOUR),
      results_root: 'ef'.repeat(32),
      secret: 'ab'.repeat(32),
      // Settled six hours ago with one share held: six hours of the
      // published twelve-hour window remain.
      held_shares: 1,
      resolving: true,
      resolving_until: soon(6 * HOUR),
    }),
    entries: entries(ESCROW, 64, {}).map((e) => (e.idx === VIEWER_SEAT ? { ...e, flagged: true } : e)),
    results: results(ESCROW_SHAPE),
    payouts: payouts(ESCROW, ESCROW_SHAPE, VIEWER_SEAT),
    leaderboard: leaderboard(ESCROW, ESCROW_SHAPE),
  },
  {
    key: 'refunding',
    what: 'A pool of 32 whose deadline passed below its minimum field of 20 — the refund fork (R7/D-E4), entries returned.',
    summary: poolSummary({
      pool: REFUNDING,
      id: 'FIXTURE-REFUNDING',
      capacity: 32,
      state: 'Refunding',
      entrants: 12,
      fill_deadline: past(HOUR),
    }),
    entries: entries(REFUNDING, 12, { refunded: true }),
    results: [],
    payouts: [],
  },
  {
    key: 'closed',
    what: 'Terminal after a refund. Nothing left to do — the empty end state.',
    summary: poolSummary({
      pool: CLOSED,
      id: 'FIXTURE-CLOSED',
      capacity: 16,
      state: 'Closed',
      entrants: 4,
      fill_deadline: past(50 * HOUR),
    }),
    entries: entries(CLOSED, 4, { refunded: true }),
    results: [],
    payouts: [],
  },
];

export const SCENARIO_BY_POOL: ReadonlyMap<string, Scenario> = new Map(
  SCENARIOS.map((s) => [s.summary.pool, s])
);

/**
 * GET /pool-types for the fixture (D-E19): the devnet launch — both boards ×
 * the four sizes at tier 0, every one live, each naming the open scenario
 * of its type. Sorted as the read API sorts: easy first, tier, capacity.
 */
export function fixturePoolTypes(): PoolTypeRow[] {
  return (['easy', 'hard'] as const).flatMap((mode) =>
    POOL_CAPACITIES.map((capacity) => {
      const ladder = tier0Ladder(capacity);
      const open = SCENARIOS.find(
        (s) =>
          s.summary.state === 'Open' &&
          (s.summary.mode ?? 'easy') === mode &&
          s.summary.capacity === capacity
      );
      return {
        mode,
        tier: 0,
        capacity,
        live: true,
        type_enabled: true,
        tier_open: true,
        min_seats: ladder.min_seats,
        paid_places: ladder.paid_places,
        prize_table: ladder.prize_table,
        entry_lamports: TIER0_ENTRY,
        prize_pool_lamports: ladder.pot_lamports,
        prize_amounts: ladder.prize_amounts,
        live_pool: open?.summary.pool ?? null,
        live_pool_id: null,
        next_open_at: null,
        last_pool_id: null,
      };
    })
  );
}

/** The viewer's profile — a career with something in it, so the page is not empty. */
export const FIXTURE_PROFILE: ProfileRow = {
  player: FIXTURE_PLAYER,
  pools_entered: '9',
  // Two prize finishes on record below (the escrowed one is credited only
  // on release, so it is not in total_won).
  seats_paid: '2',
  total_won_lamports: prizeAt(PAID_SHAPE.capacity, PAID_SHAPE.viewerRank),
  // Cosmetic collection counts, fixed class order (Goblin..Titan).
  class_counts: [3, 2, 2, 1, 1],
};

export const FIXTURE_CAREER: CareerRow[] = [
  {
    pool: PAID,
    pool_id: 'FIXTURE-PAID',
    tier: 0,
    seat: VIEWER_SEAT,
    entries_to_date: '9',
    paid: true,
    // D-E19: the amount of the place the viewer finished in, from the table.
    amount_lamports: prizeAt(PAID_SHAPE.capacity, PAID_SHAPE.viewerRank),
    pot_lamports: tier0Ladder(PAID_SHAPE.capacity).pot_lamports,
    state: 'Paid',
    // E3: the verified archive ranks the viewer's seat at PAID_SHAPE's rank.
    rank: PAID_SHAPE.viewerRank,
  },
  {
    pool: ESCROW,
    pool_id: 'FIXTURE-ESCROW',
    tier: 0,
    seat: VIEWER_SEAT,
    entries_to_date: '8',
    paid: true,
    amount_lamports: prizeAt(ESCROW_SHAPE.capacity, ESCROW_SHAPE.viewerRank),
    pot_lamports: tier0Ladder(ESCROW_SHAPE.capacity).pot_lamports,
    state: 'Paid',
  },
  {
    pool: FIELD_PAID,
    pool_id: 'FIXTURE-FIELD-PAID',
    tier: 0,
    seat: VIEWER_SEAT,
    entries_to_date: '7',
    paid: false,
    amount_lamports: '0',
    pot_lamports: tier0Ladder(FIELD_PAID_SHAPE.capacity).pot_lamports,
    state: 'Paid',
    rank: FIELD_PAID_SHAPE.viewerRank,
  },
  {
    pool: REFUNDING,
    pool_id: 'FIXTURE-REFUNDING',
    tier: 0,
    seat: 5,
    entries_to_date: '6',
    paid: false,
    amount_lamports: '0',
    pot_lamports: tier0Ladder(32).pot_lamports,
    state: 'Refunding',
  },
  {
    pool: SEALED,
    pool_id: 'FIXTURE-SEALED',
    tier: 0,
    seat: VIEWER_SEAT,
    entries_to_date: '5',
    paid: false,
    amount_lamports: '0',
    pot_lamports: tier0Ladder(16).pot_lamports,
    state: 'Sealed',
  },
];

/*
 * One tier of each treasury status, so the admin view shows every branch.
 *
 * Prize pools are read from the published tables, never typed here: this
 * fixture is the answer to `getTreasury()` about the CURRENT economics, so a
 * hand-typed figure goes stale in silence — tiers 1-3 carried the pre-D-E1
 * 25.6 / 38.4 / 51.2 SOL pots long after D-E1 set them to 20 / 30 / 40.
 * D-E19: a tier no longer has ONE prize pool; the row shows the largest
 * pool type's (64 players), the biggest reserve a tier asks of the treasury.
 */
const tierPool = (tier: number): bigint => prizePoolFor(LADDER_TABLES[64], TIER_ENTRY_LAMPORTS[tier]!);
export const FIXTURE_TREASURY: TreasuryTiers = {
  tiers: [
    {
      tier: 0,
      price_lamports: TIER0_ENTRY,
      pot_lamports: tierPool(0).toString(),
      status: 'open',
      live_pool_state: 'Open',
      short_by_lamports: '0',
    },
    {
      tier: 1,
      price_lamports: TIER_ENTRY_LAMPORTS[1]!.toString(),
      pot_lamports: tierPool(1).toString(),
      status: 'settling',
      live_pool_state: 'Sealed',
      short_by_lamports: '0',
    },
    {
      tier: 2,
      price_lamports: TIER_ENTRY_LAMPORTS[2]!.toString(),
      pot_lamports: tierPool(2).toString(),
      status: 'openable',
      live_pool_state: null,
      short_by_lamports: '0',
    },
    {
      tier: 3,
      price_lamports: TIER_ENTRY_LAMPORTS[3]!.toString(),
      pot_lamports: tierPool(3).toString(),
      status: 'short',
      live_pool_state: null,
      // A shortfall only means anything against the prize pool it is short
      // of, and the admin view paints this number, so derive it: a quarter.
      short_by_lamports: (tierPool(3) / 4n).toString(),
    },
  ],
};
