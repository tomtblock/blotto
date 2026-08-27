/**
 * The player-history read endpoints (D-A2 as amended by master prompt v2,
 * 2026-08-27) — the Gate 3 exhibit: does considered play persist across
 * entries? Served off the `player_history` derived table (one row per
 * pool × player: tier, seat, paid, amount, pot, entries_to_date), which is
 * a pure function of the event ledger like every other derived table.
 *
 *   GET /history/summary       → first-time vs repeat paid-seat rate
 *   GET /history/persistence   → P(paid at entry n+1 | paid at entry n)
 *                                vs P(paid at entry n+1 | unpaid at entry n)
 *   GET /history/entries       → distribution of entries-to-date per wallet
 *
 * No PII beyond the wallet address exists anywhere in these rows. Rank
 * labels are deliberately absent (D3-B: ranks live in the published
 * bundle) — "persistence" is measured on PAID SEATS, the outcome that is
 * on-chain and player-verifiable.
 *
 * Rates are integer-ratio percent strings computed in bigint; nothing here
 * passes a lamport value or a rate through a float.
 */

import type { Queryable } from './shared';

interface HistoryRow {
  player: string;
  entries_to_date: string;
  paid: boolean;
}

function pct(numerator: bigint, denominator: bigint, decimals: number): string {
  if (denominator === 0n) return '0';
  const scale = 10n ** BigInt(decimals);
  const scaled = (numerator * 100n * scale) / denominator;
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(decimals, '0');
  return decimals > 0 ? `${whole}.${frac}` : `${whole}`;
}

async function rows(db: Queryable): Promise<HistoryRow[]> {
  const res = await db.query(
    'SELECT player, entries_to_date::text AS entries_to_date, paid FROM player_history'
  );
  return res.rows as HistoryRow[];
}

/** First-time (entries_to_date = 1) vs repeat entries: paid-seat rates. */
export async function historySummary(db: Queryable): Promise<unknown> {
  const all = await rows(db);
  let firstN = 0n;
  let firstPaid = 0n;
  let repeatN = 0n;
  let repeatPaid = 0n;
  for (const r of all) {
    if (r.entries_to_date === '1') {
      firstN += 1n;
      if (r.paid) firstPaid += 1n;
    } else {
      repeatN += 1n;
      if (r.paid) repeatPaid += 1n;
    }
  }
  return {
    first_time: {
      entries: firstN.toString(),
      paid_seats: firstPaid.toString(),
      paid_seat_rate_pct: pct(firstPaid, firstN, 2),
    },
    repeat: {
      entries: repeatN.toString(),
      paid_seats: repeatPaid.toString(),
      paid_seat_rate_pct: pct(repeatPaid, repeatN, 2),
    },
  };
}

/**
 * Paid persistence over CONSECUTIVE entries of the same wallet: among all
 * (entry n, entry n+1) pairs, the paid rate at n+1 conditioned on the
 * outcome at n. A skill competition expects the conditioned rates to
 * separate; a chance mechanism expects them to coincide.
 */
export async function historyPersistence(db: Queryable): Promise<unknown> {
  const all = await rows(db);
  const byPlayer = new Map<string, Map<bigint, boolean>>();
  for (const r of all) {
    let m = byPlayer.get(r.player);
    if (!m) {
      m = new Map();
      byPlayer.set(r.player, m);
    }
    m.set(BigInt(r.entries_to_date), r.paid);
  }
  let afterPaidN = 0n;
  let afterPaidPaid = 0n;
  let afterUnpaidN = 0n;
  let afterUnpaidPaid = 0n;
  for (const m of byPlayer.values()) {
    for (const [n, paid] of m) {
      const next = m.get(n + 1n);
      if (next === undefined) continue;
      if (paid) {
        afterPaidN += 1n;
        if (next) afterPaidPaid += 1n;
      } else {
        afterUnpaidN += 1n;
        if (next) afterUnpaidPaid += 1n;
      }
    }
  }
  return {
    pairs_after_paid: {
      pairs: afterPaidN.toString(),
      paid_next_rate_pct: pct(afterPaidPaid, afterPaidN, 2),
    },
    pairs_after_unpaid: {
      pairs: afterUnpaidN.toString(),
      paid_next_rate_pct: pct(afterUnpaidPaid, afterUnpaidN, 2),
    },
  };
}

/** Distribution of total entries per wallet: how many wallets entered
 * exactly once, twice, … (bucketed, capped at 10+). */
export async function historyEntriesDistribution(db: Queryable): Promise<unknown> {
  const all = await rows(db);
  const maxByPlayer = new Map<string, bigint>();
  for (const r of all) {
    const n = BigInt(r.entries_to_date);
    const cur = maxByPlayer.get(r.player) ?? 0n;
    if (n > cur) maxByPlayer.set(r.player, n);
  }
  const buckets = new Map<string, bigint>();
  for (const n of maxByPlayer.values()) {
    const label = n >= 10n ? '10+' : n.toString();
    buckets.set(label, (buckets.get(label) ?? 0n) + 1n);
  }
  const order = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];
  return {
    wallets: maxByPlayer.size.toString(),
    entries_to_date: order
      .filter((label) => buckets.has(label))
      .map((label) => ({ entries: label, wallets: buckets.get(label)!.toString() })),
  };
}
