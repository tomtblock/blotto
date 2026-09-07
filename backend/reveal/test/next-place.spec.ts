/**
 * The next-place driver's ARGUMENT COMPUTATION (audit O23).
 *
 * `daemon.spec.ts` proves the whole path end to end on a naturally settled
 * pool. This suite covers the branches a natural settlement cannot reach on
 * demand — a tie for first, a peer still under review, a forfeiter with
 * nobody eligible behind them — by building a published ranking directly and
 * committing its root, so `FakeChain.payNextPlace` (which mirrors every check
 * in `escrow.rs::handle_pay_next_place`) is the thing judging the arguments.
 *
 * That is the point of the suite: nothing here asserts that my arithmetic
 * looks right. It hands the arguments to the program's own rules and lets
 * them refuse.
 */

import { expect } from 'chai';
import { createHash } from 'crypto';
import { FakeChain, planNextPlace, payNextPlacePortions, type ChainEntryView } from '../src';
import { buildRanking } from '../src/ranking';
import { TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS, type PlayerResult } from '../../scoring/src';
import { base58Encode } from '../../_shared/src/blotto-events';

const sha = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());
const player = (i: number) => base58Encode(sha(`np:${i}`));
const POT = TIER_POT_LAMPORTS[0];

/** An entry as the chain reports it, with escrow joined in. */
function entry(index: number, over: Partial<ChainEntryView> = {}): ChainEntryView {
  return {
    player: player(index),
    index,
    battlesHash: '00'.repeat(32),
    flagged: false,
    refunded: false,
    settled: false,
    forfeited: false,
    escrowLamports: 0n,
    escrowedAt: 0n,
    sanctionsHold: false,
    ...over,
  };
}

/**
 * A published ranking with `winners` sharing rank 1 and the rest ranked
 * behind them — the shape `assignPrizes` produces for a tie.
 */
function rankingOf(seats: number[], winners: number[], pot = POT) {
  const share = pot / BigInt(winners.length);
  const remainder = pot - share * BigInt(winners.length);
  const lowestWinner = Math.min(...winners);
  const scored: PlayerResult[] = seats.map((s) => {
    const isWinner = winners.includes(s);
    return {
      index: s,
      scoreHalf: isWinner ? 14 : 2,
      zones: isWinner ? 35 : 5,
      rank: isWinner ? 1 : 1 + winners.length,
      amountLamports: isWinner ? share + (s === lowestWinner ? remainder : 0n) : 0n,
    } as PlayerResult;
  });
  return buildRanking(scored, (i) => player(i));
}

describe('planNextPlace — who receives an upheld share', () => {
  const SEATS = [0, 1, 2, 3, 4];

  it('a tie for first: the share goes to the other eligible winners, remainder to the lowest seat', () => {
    const ranking = rankingOf(SEATS, [0, 1, 2]);
    const entries = SEATS.map((s) =>
      entry(s, s <= 2 ? { settled: true, flagged: s === 1, escrowLamports: s === 1 ? POT / 3n : 0n } : {})
    );
    entries[1].forfeited = true;
    const plan = planNextPlace(ranking, entries, [0, 1, 2], entries[1]);
    expect(plan.blocker).to.equal(null);
    expect(plan.portions.map((p) => p.to)).to.deep.equal([player(0), player(2)]);
    expect(plan.portions.every((p) => p.rank === 1)).to.equal(true);
    expect(plan.portions.map((p) => p.groupSize)).to.deep.equal([2, 2]);
    // The remainder follows the lowest ELIGIBLE entry number, not the lowest
    // committed one — seat 1 forfeited, so seat 0 takes it.
    expect(plan.portions.map((p) => p.takesRemainder)).to.deep.equal([true, false]);
    // Peers exclude BOTH the forfeiter and the recipient (escrow.rs).
    expect(plan.portions[0].peers).to.deep.equal([player(2)]);
    expect(plan.portions[1].peers).to.deep.equal([player(0)]);
  });

  it('every winner forfeited: the share passes to the next rank, at a zero-amount leaf', () => {
    const ranking = rankingOf(SEATS, [0, 1]);
    const entries = SEATS.map((s) =>
      entry(s, s <= 1 ? { settled: true, flagged: true, forfeited: true, escrowLamports: POT / 2n } : {})
    );
    const plan = planNextPlace(ranking, entries, [0, 1], entries[0]);
    expect(plan.blocker).to.equal(null);
    expect(plan.portions.map((p) => p.to)).to.deep.equal([player(2), player(3), player(4)]);
    expect(plan.portions.every((p) => p.rank === 3)).to.equal(true);
    expect(plan.portions.every((p) => p.amountLamports === 0n)).to.equal(true);
    expect(plan.portions.every((p) => p.groupSize === 3)).to.equal(true);
    expect(plan.portions.map((p) => p.takesRemainder)).to.deep.equal([true, false, false]);
  });

  it('holds while any committed seat is still under review', () => {
    const ranking = rankingOf(SEATS, [0, 1, 2]);
    const entries = SEATS.map((s) =>
      entry(s, s <= 2 ? { settled: true, flagged: s !== 0, escrowLamports: s !== 0 ? POT / 3n : 0n } : {})
    );
    entries[1].forfeited = true; // upheld
    // Seat 2 is flagged with its share still held: review has not decided.
    const plan = planNextPlace(ranking, entries, [0, 1, 2], entries[1]);
    expect(plan.blocker).to.equal('review_still_pending');
    expect(plan.portions).to.deep.equal([]);
  });

  it('refuses to plan for an entry with nothing forfeited', () => {
    const ranking = rankingOf(SEATS, [0]);
    const entries = SEATS.map((s) => entry(s, s === 0 ? { settled: true } : {}));
    expect(planNextPlace(ranking, entries, [0], entries[0]).blocker).to.equal('no_forfeited_share');
    entries[0].forfeited = true; // forfeited, but the escrow is already gone
    expect(planNextPlace(ranking, entries, [0], entries[0]).blocker).to.equal('no_forfeited_share');
  });

  it('a sanctions-held winner is not an eligible recipient (Stage F)', () => {
    // The held entry is NOT forfeited, so without the sanctions clause in
    // `eligibleFor` it would count as a member of the first-place group and
    // the split would pay a listed wallet. Mirrors `escrow.rs::eligible`.
    const ranking = rankingOf(SEATS, [0, 1, 2]);
    const entries = SEATS.map((s) =>
      entry(s, s <= 2 ? { settled: true, flagged: s === 1, escrowLamports: s === 1 ? POT / 3n : 0n } : {})
    );
    entries[1].forfeited = true; // upheld flag, the share to divide
    entries[0].sanctionsHold = true; // matched a list at resolving
    const plan = planNextPlace(ranking, entries, [0, 1, 2], entries[1]);
    expect(plan.blocker).to.equal(null);
    expect(plan.portions.map((p) => p.to)).to.deep.equal([player(2)]);
    expect(plan.portions[0].groupSize).to.equal(1);
    expect(plan.portions[0].takesRemainder).to.equal(true);

    // And with every other winner held, there is nobody at rank 1 to pay:
    // the share stays put rather than reaching a listed wallet.
    entries[2].sanctionsHold = true;
    const blocked = planNextPlace(ranking, entries, [0, 1, 2], entries[1]);
    expect(blocked.portions.map((p) => p.to)).to.not.include(player(0));
    expect(blocked.portions.map((p) => p.to)).to.not.include(player(2));
  });

  it('never names the forfeiter as a recipient', () => {
    const ranking = rankingOf(SEATS, [0, 1]);
    const entries = SEATS.map((s) =>
      entry(s, s <= 1 ? { settled: true, flagged: s === 0, escrowLamports: s === 0 ? POT / 2n : 0n } : {})
    );
    entries[0].forfeited = true;
    const plan = planNextPlace(ranking, entries, [0, 1], entries[0]);
    expect(plan.portions.map((p) => p.to)).to.not.include(player(0));
  });
});

describe('payNextPlacePortions — the program judges the arguments', () => {
  /** A settled pool on the fake chain, with a real committed root. */
  async function settledPool(winners: number[], seatCount = 5) {
    const chain = new FakeChain(() => 1_000n);
    await chain.initConfig({
      entrySigner: 'entry',
      settlementSigner: 'settle',
      keeper: 'settle',
      vaultCeilingLamports: TIER_ENTRY_LAMPORTS.map((e) => e * 64n),
      treasuryMinPlatformLamports: 0n,
    });
    chain.fundPlatform(POT * 4n);
    await chain.openPool(1n, 0, sha('pk'), sha('hash'));
    const seats = Array.from({ length: seatCount }, (_, i) => i);
    const entries = seats.map((s) => ({
      player: player(s),
      index: s,
      battlesHash: '00'.repeat(32),
      flagged: false,
      refunded: false,
      settled: false,
      forfeited: false,
    }));
    chain.entries.set('1', entries);
    const pool = chain.pools.get('1')!;
    pool.entrants = seats.length;
    pool.state = 'Sealed';
    const ranking = rankingOf(seats, winners);
    await chain.revealPoolSecret(1n, sha('secret'));
    await chain.commitResults(
      1n,
      ranking.root,
      ranking.rows
        .filter((r) => r.amountLamports > 0n)
        .sort((a, b) => a.index - b.index)
        .map((r) => ({ entryIndex: r.index, amountLamports: r.amountLamports }))
    );
    return { chain, ranking, seats, entries };
  }

  it('a tie for first: the forfeited half reaches the other winner and the pot is conserved', async () => {
    const { chain, ranking, entries } = await settledPool([0, 1]);
    entries[1].flagged = true;
    await chain.payPrizes(1n, [0, 1]);
    await chain.forfeitEscrow(1n, player(1));

    const plan = planNextPlace(ranking, await chain.getEntries(1n), [0, 1], (await chain.getEntries(1n))[1]);
    expect(plan.blocker).to.equal(null);
    const paid = await payNextPlacePortions(chain, 1n, plan.portions);
    expect(paid).to.deep.equal([{ poolId: 1n, from: player(1), to: player(0) }]);
    expect(chain.paid.get(player(0))).to.equal(POT, 'the eligible winner takes the whole pot');
    expect(chain.escrowed.get(player(1)) ?? 0n).to.equal(0n);
    expect(chain.paid.get(player(1)) ?? 0n).to.equal(0n, 'nothing to the forfeiter');
  });

  it('every winner forfeited: the whole pot is divided at the next rank, remainder to the lowest seat', async () => {
    const { chain, ranking, entries } = await settledPool([0, 1]);
    entries[0].flagged = true;
    entries[1].flagged = true;
    await chain.payPrizes(1n, [0, 1]);
    await chain.forfeitEscrow(1n, player(0));
    await chain.forfeitEscrow(1n, player(1));

    let moved = 0n;
    for (const seat of [0, 1]) {
      const live = await chain.getEntries(1n);
      const plan = planNextPlace(ranking, live, [0, 1], live[seat]);
      expect(plan.blocker, `seat ${seat}`).to.equal(null);
      await payNextPlacePortions(chain, 1n, plan.portions);
    }
    for (const v of chain.paid.values()) moved += v;
    expect(moved).to.equal(POT, 'the pot is conserved to the lamport');
    for (const s of [0, 1]) expect(chain.paid.get(player(s)) ?? 0n).to.equal(0n);
    // Each half split three ways: the lowest eligible seat carries both
    // remainders.
    const half = POT / 2n;
    const share = half / 3n;
    const rem = half - share * 3n;
    expect(chain.paid.get(player(2))).to.equal((share + rem) * 2n);
    expect(chain.paid.get(player(3))).to.equal(share * 2n);
    expect(chain.paid.get(player(4))).to.equal(share * 2n);
  });

  it('a portion already settled is refused rather than paid twice', async () => {
    const { chain, ranking, entries } = await settledPool([0, 1]);
    entries[1].flagged = true;
    await chain.payPrizes(1n, [0, 1]);
    await chain.forfeitEscrow(1n, player(1));
    const live = await chain.getEntries(1n);
    const plan = planNextPlace(ranking, live, [0, 1], live[1]);
    await payNextPlacePortions(chain, 1n, plan.portions);
    // Replaying the same plan: the program refuses, so the money cannot move
    // twice even if the daemon retried a tick it had already completed.
    let refused = '';
    try {
      await payNextPlacePortions(chain, 1n, plan.portions);
    } catch (e) {
      refused = String(e);
    }
    expect(refused).to.match(/NoEscrow|RankAlreadySettled/);
    expect(chain.paid.get(player(0))).to.equal(POT);
  });
});
