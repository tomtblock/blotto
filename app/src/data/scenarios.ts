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

import { MIN_SEATS, TIER_POT_LAMPORTS } from '@blotto/scoring';
import type {
  CareerRow,
  EntryRow,
  LeaderboardRow,
  PayoutRow,
  PoolLeaderboard,
  PoolSummary,
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
/** A second wallet, so "someone else won" renders differently from "you won". */

const HOUR = 3600;
/** Deadlines are relative to render time so countdowns animate rather than sit dead. */
const soon = (seconds: number): string => String(Math.floor(Date.now() / 1000) + seconds);
const past = (seconds: number): string => String(Math.floor(Date.now() / 1000) - seconds);
/** The fixture's `server_time` — the fixture IS the server here. */
const serverNow = (): string => String(Math.floor(Date.now() / 1000));

const TIER0_ENTRY = '100000000'; // 0.1 SOL
const TIER0_POT = '4000000000'; // 4 SOL (D-E1: entry / 8 * 5 * 64)
const SEALING_PUBKEY = '11'.repeat(32);

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

function poolSummary(over: Partial<PoolSummary> & { pool: string; id: string }): PoolSummary {
  return {
    tier: 0,
    entry_lamports: TIER0_ENTRY,
    pot_lamports: TIER0_POT,
    fill_deadline: soon(12 * HOUR),
    timer_seconds: 15,
    state: 'Open',
    sealing_pubkey: SEALING_PUBKEY,
    entrants: 0,
    // R7-b: derived by the read API from the seat count and the floor.
    min_seats: Number(MIN_SEATS),
    results_root: null,
    secret: null,
    // Stage C: derived by the read API; closed by default, opened by the
    // escrow scenario below.
    held_shares: 0,
    resolving: false,
    resolving_until: null,
    server_time: serverNow(),
    ...over,
    // Recomputed AFTER the overrides, from whatever seat count they set.
    // A fixture that says 50 seated and "would refund" is a contradiction
    // the preview pages would render as fact.
    outcome_if_deadline_now:
      over.outcome_if_deadline_now ??
      ((over.entrants ?? 0) >= Number(MIN_SEATS) ? 'seal' : 'refund'),
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
    player: idx === 3 ? FIXTURE_PLAYER : fixtureId(`Seat${seatLabel(idx)}`),
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

/** The paid seats, descending — ONE under D-E2 (winner takes all): the
 * viewer's seat 3. Amounts are decimal strings — never floats. */
const PAID_SEATS = [3];
// The REAL tier-0 amount at the D-E1 pot: the whole 4 SOL to rank 1 — the
// fixture pays exactly what the program would, so preview screens carry
// truthful figures.
const PAID_AMOUNTS = [TIER0_POT];

function results(): ResultRow[] {
  return PAID_SEATS.map((seat, i) => ({ seat, amount: PAID_AMOUNTS[i] }));
}

function payouts(pool: string, escrowSeat: number | null = null): PayoutRow[] {
  const byIdx = entries(pool, 64);
  return PAID_SEATS.map((seat, i) => ({
    seat,
    player: byIdx[seat].player,
    amount: PAID_AMOUNTS[i],
    escrowed: seat === escrowSeat,
  }));
}

/**
 * The full archive ranking (E3) for a settled scenario, over the pool's real
 * field size. The paid seat carries the same amount as `results()`; everyone
 * else ranks below it at zero (D-E2).
 *
 * D-E8: the on-chain root commits to `player`, `rank` and `amount_lamports`
 * only, and the response says so in `committed_fields`. `seat` therefore
 * comes from indexed chain records and is nullable, and the scores live
 * under `recomputed`. `score_half` is in HALF-POINT integer units across the
 * seven battles (max 14) and descends with rank so the table reads plausibly
 * — a display fixture, not a scored pool.
 */
function leaderboard(pool: string, field = 64): PoolLeaderboard {
  const byIdx = entries(pool, field);
  const paidRank = new Map(PAID_SEATS.map((seat, i) => [seat, i + 1]));
  const unpaid = Array.from({ length: field }, (_, s) => s).filter((s) => !paidRank.has(s));
  // D-E8: one row whose entry number our records do not hold — the shape the
  // read API serves when an entry event was missed. Taken from the unpaid
  // seats so the paid row still names the seat `payouts()` names, and from
  // the top of them so the null path is on screen rather than buried at the
  // foot of a 64-row table.
  const seatless = unpaid[1];
  const rows: LeaderboardRow[] = [
    ...PAID_SEATS.map((seat, i) => ({
      player: byIdx[seat].player,
      rank: i + 1,
      amount_lamports: PAID_AMOUNTS[i],
      seat,
      recomputed: { score_half: 14 - Math.floor(i / 2), zones: 20 - i },
    })),
    ...unpaid.map((seat, i) => ({
      player: byIdx[seat].player,
      rank: PAID_SEATS.length + 1 + i,
      amount_lamports: '0',
      seat: seat === seatless ? null : seat,
      recomputed: {
        score_half: Math.max(1, 12 - Math.floor(i / 6)),
        zones: Math.max(1, 18 - Math.floor(i / 4)),
      },
    })),
  ];
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
const HARD_OPEN = fixtureId('hard');

export const SCENARIOS: readonly Scenario[] = [
  {
    key: 'open',
    what: 'A fresh pool, nearly empty. The enter path and the seat ring at rest.',
    summary: poolSummary({ pool: OPEN, id: 'FIXTURE', entrants: 3 }),
    entries: entries(OPEN, 3),
    results: [],
    payouts: [],
  },
  {
    key: 'hard-open',
    what: 'Phase B: an open HARD pool in the same tier — the second card on the landing, and the 700-anywhere board behind it.',
    summary: poolSummary({
      pool: HARD_OPEN,
      id: 'FIXTURE-HARD',
      mode: 'hard',
      entrants: 5,
      // Its own clock (founder: the pools run on separate timers).
      fill_deadline: soon(9 * HOUR),
    }),
    entries: entries(HARD_OPEN, 5),
    results: [],
    payouts: [],
  },
  {
    key: 'filling',
    what: 'Almost full (61/64), four hours left — the pool will run either way.',
    summary: poolSummary({
      pool: FILLING,
      id: 'FIXTURE-FILLING',
      entrants: 61,
      fill_deadline: soon(4 * HOUR),
    }),
    entries: entries(FILLING, 61),
    results: [],
    payouts: [],
  },
  {
    key: 'field',
    what: 'The minimum field (55/64): seated past 52 with the clock still running.',
    summary: poolSummary({
      pool: FIELD,
      id: 'FIXTURE-FIELD',
      entrants: 55,
      fill_deadline: soon(6 * HOUR - 5 * 60),
    }),
    entries: entries(FIELD, 55),
    results: [],
    payouts: [],
  },
  {
    key: 'field-paid',
    what: 'A 55-player pool that ran at its deadline and paid — the archive over a short field.',
    summary: poolSummary({
      pool: FIELD_PAID,
      id: 'FIXTURE-FIELD-PAID',
      state: 'Paid',
      entrants: 55,
      fill_deadline: past(20 * HOUR),
      results_root: 'ef'.repeat(32),
      secret: 'ab'.repeat(32),
    }),
    entries: entries(FIELD_PAID, 55),
    results: results(),
    payouts: payouts(FIELD_PAID),
    leaderboard: leaderboard(FIELD_PAID, 55),
  },
  {
    key: 'deadline',
    what: 'Open, under-filled, minutes from the deadline — the refund fork is next.',
    summary: poolSummary({
      pool: DEADLINE,
      id: 'FIXTURE-DEADLINE',
      entrants: 12,
      fill_deadline: soon(9 * 60),
    }),
    entries: entries(DEADLINE, 12),
    results: [],
    payouts: [],
  },
  {
    key: 'sealed',
    what: 'Full and sealed, awaiting settlement. No results yet; the secret is not out.',
    summary: poolSummary({
      pool: SEALED,
      id: 'FIXTURE-SEALED',
      state: 'Sealed',
      entrants: 64,
      fill_deadline: past(2 * HOUR),
    }),
    entries: entries(SEALED, 64),
    results: [],
    payouts: [],
  },
  {
    key: 'scored',
    what: 'Results committed, prizes not yet pushed. The reveal, mid-flight.',
    summary: poolSummary({
      pool: SCORED,
      id: 'FIXTURE-SCORED',
      state: 'Scored',
      entrants: 64,
      fill_deadline: past(6 * HOUR),
      results_root: 'ef'.repeat(32),
      secret: 'ab'.repeat(32),
    }),
    entries: entries(SCORED, 64),
    results: results(),
    payouts: [],
  },
  {
    key: 'paid',
    what: 'Settled and paid. The viewer holds seat 3 — first place — so "you won" renders.',
    summary: poolSummary({
      pool: PAID,
      id: 'FIXTURE-PAID',
      state: 'Paid',
      entrants: 64,
      fill_deadline: past(30 * HOUR),
      results_root: 'ef'.repeat(32),
      secret: 'ab'.repeat(32),
    }),
    entries: entries(PAID, 64),
    results: results(),
    payouts: payouts(PAID),
    leaderboard: leaderboard(PAID),
  },
  {
    key: 'escrow',
    what: "Paid, but the viewer's own share is held in escrow — the KYC/review copy, and the RESOLVING badge with its countdown.",
    summary: poolSummary({
      pool: ESCROW,
      id: 'FIXTURE-ESCROW',
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
    entries: entries(ESCROW, 64, {}).map((e) =>
      e.idx === 3 ? { ...e, flagged: true } : e
    ),
    results: results(),
    payouts: payouts(ESCROW, 3),
    leaderboard: leaderboard(ESCROW),
  },
  {
    key: 'refunding',
    what: 'The deadline passed below the 52-seat minimum — the refund fork (R7/D-E4), entries returned.',
    summary: poolSummary({
      pool: REFUNDING,
      id: 'FIXTURE-REFUNDING',
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
      state: 'Closed',
      entrants: 12,
      fill_deadline: past(50 * HOUR),
    }),
    entries: entries(CLOSED, 12, { refunded: true }),
    results: [],
    payouts: [],
  },
];

export const SCENARIO_BY_POOL: ReadonlyMap<string, Scenario> = new Map(
  SCENARIOS.map((s) => [s.summary.pool, s])
);

/** The viewer's profile — a career with something in it, so the page is not empty. */
export const FIXTURE_PROFILE: ProfileRow = {
  player: FIXTURE_PLAYER,
  pools_entered: '9',
  // Two prize finishes on record below (the escrowed one is credited only
  // on release, so it is not in total_won).
  seats_paid: '2',
  total_won_lamports: TIER0_POT,
  // Cosmetic collection counts, fixed class order (Goblin..Titan).
  class_counts: [3, 2, 2, 1, 1],
};

export const FIXTURE_CAREER: CareerRow[] = [
  {
    pool: PAID,
    pool_id: 'FIXTURE-PAID',
    tier: 0,
    seat: 3,
    entries_to_date: '9',
    paid: true,
    // D-E2: the winner's amount IS the pot.
    amount_lamports: TIER0_POT,
    pot_lamports: TIER0_POT,
    state: 'Paid',
    // E3: seat 3 is PAID_SEATS' one entry, so the verified archive ranks it first.
    rank: 1,
  },
  {
    pool: ESCROW,
    pool_id: 'FIXTURE-ESCROW',
    tier: 0,
    seat: 3,
    entries_to_date: '8',
    paid: true,
    amount_lamports: TIER0_POT,
    pot_lamports: TIER0_POT,
    state: 'Paid',
  },
  {
    pool: REFUNDING,
    pool_id: 'FIXTURE-REFUNDING',
    tier: 0,
    seat: 5,
    entries_to_date: '7',
    paid: false,
    amount_lamports: '0',
    pot_lamports: TIER0_POT,
    state: 'Refunding',
  },
  {
    pool: SEALED,
    pool_id: 'FIXTURE-SEALED',
    tier: 0,
    seat: 3,
    entries_to_date: '6',
    paid: false,
    amount_lamports: '0',
    pot_lamports: TIER0_POT,
    state: 'Sealed',
  },
];

/*
 * One tier of each treasury status, so the admin view shows every branch.
 *
 * Pots are read from the published table, never typed here: this fixture is
 * the answer to `getTreasury()` about the CURRENT tier economics, so a
 * hand-typed pot goes stale in silence — tiers 1-3 carried the pre-D-E1
 * 25.6 / 38.4 / 51.2 SOL pots long after D-E1 set them to 20 / 30 / 40.
 */
export const FIXTURE_TREASURY: TreasuryTiers = {
  tiers: [
    {
      tier: 0,
      price_lamports: TIER0_ENTRY,
      pot_lamports: TIER0_POT,
      status: 'open',
      live_pool_state: 'Open',
      short_by_lamports: '0',
    },
    {
      tier: 1,
      price_lamports: '500000000',
      pot_lamports: TIER_POT_LAMPORTS[1].toString(), // 20 SOL
      status: 'settling',
      live_pool_state: 'Sealed',
      short_by_lamports: '0',
    },
    {
      tier: 2,
      price_lamports: '750000000',
      pot_lamports: TIER_POT_LAMPORTS[2].toString(), // 30 SOL
      status: 'openable',
      live_pool_state: null,
      short_by_lamports: '0',
    },
    {
      tier: 3,
      price_lamports: '1000000000',
      pot_lamports: TIER_POT_LAMPORTS[3].toString(), // 40 SOL
      status: 'short',
      live_pool_state: null,
      // A shortfall only means anything against the pot it is short of, and
      // the landing page paints this number, so derive it: a quarter of the
      // tier-3 pot (10 SOL of 40).
      short_by_lamports: (TIER_POT_LAMPORTS[3] / 4n).toString(),
    },
  ],
};
