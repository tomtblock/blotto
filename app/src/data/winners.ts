/*
 * The winners drift's data (UI constitution PART 5.7 / 6.1 Act II).
 * Everything social is real: cards are assembled from indexed on-chain
 * state only — pools whose state is 'Paid', newest first, with the actual
 * committed payouts. No seeding, no rounding, no synthesis. An empty list
 * renders an honest empty state, never a placeholder winner.
 *
 * "Paid to players to date" is Σ pot_lamports over Paid pools: the prize
 * bands are exact 1024ths summing to 1024 (backend/scoring/src/prizes.ts),
 * so a Paid pool has, by construction, paid out its entire fixed pot. The
 * number is recomputable by anyone from the same published data — the
 * counter links to the Verify page for exactly that reason.
 *
 * A card carries no date: the indexer does not yet serve a settled-at
 * timestamp, and the Adjudicator does not invent one. When the read API
 * grows one, add it here — never client-side.
 */

import type { IndexerApi, PayoutRow, PoolSummary } from './types';

export interface WinnerCard {
  pool: string;
  poolId: string;
  tier: number;
  entryLamports: string;
  potLamports: string;
  /** The top committed amount (decimal lamports string). */
  firstAmountLamports: string;
  /** Wallets sharing the top amount — usually one; >1 is a real tie. */
  firstPlayers: string[];
  /** How many seats were paid (ties can push this past 16). */
  paidCount: number;
}

export interface ProofBand {
  cards: WinnerCard[];
  paidToDateLamports: string;
}

/** Assemble the proof band. Callers that already hold the pool list pass
 * it in; `limit` bounds the payout fetches (one per card) and the
 * paid-to-date sum needs no extra requests. */
export async function proofBand(
  api: IndexerApi,
  pools?: PoolSummary[],
  limit = 8
): Promise<ProofBand> {
  const allPools = pools ?? (await api.listPools());
  const paidPools = allPools.filter((p) => p.state === 'Paid');

  const paidToDate = paidPools.reduce((sum, p) => sum + BigInt(p.pot_lamports), 0n);

  const newest = paidPools.slice(0, limit); // /pools is served newest-first
  const cards = await Promise.all(newest.map((p) => cardFor(api, p)));

  return {
    cards: cards.filter((c): c is WinnerCard => c !== null),
    paidToDateLamports: paidToDate.toString(),
  };
}

async function cardFor(api: IndexerApi, pool: PoolSummary): Promise<WinnerCard | null> {
  let payouts: PayoutRow[];
  try {
    payouts = await api.getPayouts(pool.pool);
  } catch {
    return null; // an unreadable pool is omitted, never approximated
  }
  if (payouts.length === 0) return null;

  let top = 0n;
  for (const row of payouts) {
    const amount = BigInt(row.amount);
    if (amount > top) top = amount;
  }
  const firstPlayers = payouts
    .filter((row) => BigInt(row.amount) === top)
    .map((row) => row.player);

  return {
    pool: pool.pool,
    poolId: pool.id,
    tier: pool.tier,
    entryLamports: pool.entry_lamports,
    potLamports: pool.pot_lamports,
    firstAmountLamports: top.toString(),
    firstPlayers,
    paidCount: payouts.length,
  };
}
