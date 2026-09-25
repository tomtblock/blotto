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
import {
  FakeChain,
  planNextPlace,
  payNextPlacePortions,
  type ChainEntryView,
  type SettlementChain,
} from '../src';
import { buildRanking, proofForRow } from '../src/ranking';
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
    nextPlaceLamports: 0n,
    // The split frame: zero until the first portion of this entry's
    // forfeited share is paid (`Entry.split_*`).
    splitTotal: 0n,
    splitPaidMask: 0n,
    splitGroupSize: 0,
    splitRemainderPaid: false,
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

describe('planNextPlace — resuming from the split frame (audit D-11)', () => {
  // A three-way tie for first; seat 1's third is the forfeited share, divided
  // between seats 0 and 2. The pot's third is odd, so there IS an indivisible
  // lamport and the remainder rule is exercised, not skipped.
  const SEATS = [0, 1, 2, 3, 4];
  const share = POT / 3n;
  const per = share / 2n;
  const rem = share % 2n;
  const shape = (plan: ReturnType<typeof planNextPlace>) =>
    plan.portions.map((p) => [p.to, p.groupSize, p.takesRemainder, p.portionLamports]);

  it('the fixture carries an indivisible lamport', () => {
    expect(rem).to.equal(1n);
  });

  it('plans only the seats not yet in the paid mask, with the frame`s group size', () => {
    const ranking = rankingOf(SEATS, [0, 1, 2]);
    const entries = SEATS.map((s) => entry(s, s <= 2 ? { settled: true } : {}));
    // Seat 0's portion landed (the remainder with it): the frame is fixed at
    // two members and the escrow has counted down by that portion.
    entries[0].nextPlaceLamports = per + rem;
    entries[1] = entry(1, {
      settled: true,
      flagged: true,
      forfeited: true,
      escrowLamports: per,
      splitTotal: share,
      splitGroupSize: 2,
      splitPaidMask: 1n << 0n,
      splitRemainderPaid: true,
    });
    const plan = planNextPlace(ranking, entries, [0, 1, 2], entries[1]);
    expect(plan.blocker).to.equal(null);
    expect(shape(plan)).to.deep.equal([[player(2), 2, false, per]]);
    // Peers still exclude the forfeiter and the recipient — the paid member
    // is a peer like any other; the program classifies it as eligible.
    expect(plan.portions[0].peers).to.deep.equal([player(0)]);
  });

  it('the remainder stays with the lowest seat of the WHOLE group until the frame says it went out', () => {
    const ranking = rankingOf(SEATS, [0, 1, 2]);
    const entries = SEATS.map((s) => entry(s, s <= 2 ? { settled: true } : {}));
    // Seat 2's portion landed first: the remainder is still owed and only
    // seat 0 may take it (`takes_remainder == (to.index == lowest_eligible)`).
    entries[1] = entry(1, {
      settled: true,
      flagged: true,
      forfeited: true,
      escrowLamports: per + rem,
      splitTotal: share,
      splitGroupSize: 2,
      splitPaidMask: 1n << 2n,
      splitRemainderPaid: false,
    });
    const plan = planNextPlace(ranking, entries, [0, 1, 2], entries[1]);
    expect(shape(plan)).to.deep.equal([[player(0), 2, true, per + rem]]);
  });

  it('without a frame, the plan is the live group over the whole escrow — as before', () => {
    const ranking = rankingOf(SEATS, [0, 1, 2]);
    const entries = SEATS.map((s) =>
      entry(s, s <= 2 ? { settled: true, flagged: s === 1, escrowLamports: s === 1 ? share : 0n } : {})
    );
    entries[1].forfeited = true;
    const plan = planNextPlace(ranking, entries, [0, 1, 2], entries[1]);
    expect(shape(plan)).to.deep.equal([
      [player(0), 2, true, per + rem],
      [player(2), 2, false, per],
    ]);
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
    await chain.openPool(1n, 0, sha('pk'), sha('hash'), 0);
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

  /**
   * A seam whose `payNextPlace` throws on call number `failOn` — a dropped
   * transaction between two portions — and forwards every other call to the
   * fake, counting them. `failOn: 0` never fails and only counts.
   */
  function flaky(chain: FakeChain, failOn: number) {
    const calls = { n: 0 };
    const seam: Pick<SettlementChain, 'payNextPlace'> = {
      payNextPlace: async (...args: Parameters<SettlementChain['payNextPlace']>) => {
        calls.n += 1;
        if (calls.n === failOn) throw new Error('simulated: transaction was not confirmed');
        return chain.payNextPlace(...args);
      },
    };
    return { seam, calls };
  }

  /** The total every exit has paid to every player. */
  function movedTotal(chain: FakeChain): bigint {
    let moved = 0n;
    for (const v of chain.paid.values()) moved += v;
    return moved;
  }

  /** A three-way tie for first with seat 1's flag upheld: the forfeited
   * third divides between seats 0 and 2, with an indivisible lamport. */
  async function threeWayForfeit() {
    const { chain, ranking, entries } = await settledPool([0, 1, 2]);
    entries[1].flagged = true;
    await chain.payPrizes(1n, [0, 1, 2]);
    await chain.forfeitEscrow(1n, player(1));
    const share = chain.escrowed.get(player(1))!;
    const per = share / 2n;
    const rem = share % 2n;
    expect(rem, 'the fixture must exercise the remainder rule').to.equal(1n);
    return { chain, ranking, share, per, rem };
  }

  it('D-11 REGRESSION: a split that stopped part-way resumes with the unpaid portions only', async () => {
    const { chain, ranking, share, per, rem } = await threeWayForfeit();
    const live = await chain.getEntries(1n);
    const first = planNextPlace(ranking, live, [0, 1, 2], live[1]);
    expect(first.portions.map((p) => p.to)).to.deep.equal([player(0), player(2)]);

    // The first portion lands; the second transaction is dropped.
    const dropped = flaky(chain, 2);
    let failed = '';
    try {
      await payNextPlacePortions(dropped.seam, 1n, first.portions);
    } catch (e) {
      failed = String(e);
    }
    expect(failed).to.contain('simulated');
    expect(dropped.calls.n).to.equal(2);
    // The chain now carries the frame the first portion fixed.
    const mid = (await chain.getEntries(1n))[1];
    expect(mid.splitGroupSize).to.equal(2);
    expect(mid.splitTotal).to.equal(share);
    expect(mid.splitPaidMask).to.equal(1n << 0n);
    expect(mid.splitRemainderPaid).to.equal(true);
    expect(mid.escrowLamports).to.equal(per);

    // THE OLD BEHAVIOUR: replaying the original plan re-issues seat 0 first,
    // the program refuses it, and nothing behind it moves — the stuck state
    // the audit describes.
    let refused = '';
    try {
      await payNextPlacePortions(chain, 1n, first.portions);
    } catch (e) {
      refused = String(e);
    }
    expect(refused).to.contain('RankAlreadySettled');
    expect(chain.escrowed.get(player(1))).to.equal(per, 'nothing moved');

    // THE FIX: the next tick re-plans from the frame — the unpaid seat only,
    // the frame's group size — and the program accepts it.
    const again = await chain.getEntries(1n);
    const resume = planNextPlace(ranking, again, [0, 1, 2], again[1]);
    expect(resume.blocker).to.equal(null);
    expect(resume.portions.map((p) => [p.to, p.groupSize, p.takesRemainder])).to.deep.equal([
      [player(2), 2, false],
    ]);
    const counted = flaky(chain, 0);
    const paid = await payNextPlacePortions(counted.seam, 1n, resume.portions);
    expect(counted.calls.n).to.equal(1, 'exactly one call: the unpaid portion');
    expect(paid).to.deep.equal([{ poolId: 1n, from: player(1), to: player(2) }]);
    // The program's verdict: the share is empty, each member holds its
    // portion once, and the pot is conserved to the lamport.
    expect(chain.escrowed.get(player(1)) ?? 0n).to.equal(0n);
    expect(chain.nextPlacePaid.get(player(0))).to.equal(per + rem);
    expect(chain.nextPlacePaid.get(player(2))).to.equal(per);
    expect(movedTotal(chain)).to.equal(POT);
    expect(chain.paid.get(player(1)) ?? 0n).to.equal(0n, 'nothing to the forfeiter');
  });

  it('the remainder is paid exactly once across a resume, whichever portion landed first', async () => {
    const { chain, ranking, per, rem } = await threeWayForfeit();
    const live = await chain.getEntries(1n);
    const plan = planNextPlace(ranking, live, [0, 1, 2], live[1]);
    // Land the NON-remainder portion first, by hand: the frame is then fixed
    // with the remainder still owed.
    const second = plan.portions.find((p) => p.to === player(2))!;
    expect(second.takesRemainder).to.equal(false);
    await chain.payNextPlace(
      1n,
      second.from,
      second.to,
      second.rank,
      second.amountLamports,
      second.proof,
      second.groupSize,
      second.takesRemainder,
      second.peers
    );
    const mid = (await chain.getEntries(1n))[1];
    expect(mid.splitGroupSize).to.equal(2);
    expect(mid.splitPaidMask).to.equal(1n << 2n);
    expect(mid.splitRemainderPaid).to.equal(false);
    expect(mid.escrowLamports).to.equal(per + rem);

    // The resume: one portion, to the lowest seat, carrying the remainder —
    // the program's last-payment rule accepts exactly that and nothing else.
    const resume = planNextPlace(ranking, await chain.getEntries(1n), [0, 1, 2], mid);
    expect(resume.portions.map((p) => [p.to, p.takesRemainder, p.portionLamports])).to.deep.equal([
      [player(0), true, per + rem],
    ]);
    await payNextPlacePortions(chain, 1n, resume.portions);
    expect(chain.splits.get(player(1))!.remainderPaid).to.equal(true);
    expect(chain.escrowed.get(player(1)) ?? 0n).to.equal(0n);
    expect(chain.nextPlacePaid.get(player(0))).to.equal(per + rem);
    expect(chain.nextPlacePaid.get(player(2))).to.equal(per);
    expect(movedTotal(chain)).to.equal(POT);
  });

  it('a portion that never landed leaves the frame unfixed: the re-plan is the original plan', async () => {
    const { chain, ranking } = await threeWayForfeit();
    const live = await chain.getEntries(1n);
    const plan = planNextPlace(ranking, live, [0, 1, 2], live[1]);
    const dropped = flaky(chain, 1); // the very first call is dropped
    let failed = '';
    try {
      await payNextPlacePortions(dropped.seam, 1n, plan.portions);
    } catch (e) {
      failed = String(e);
    }
    expect(failed).to.contain('simulated');
    const after = await chain.getEntries(1n);
    expect(after[1].splitGroupSize).to.equal(0, 'no frame yet');
    expect(planNextPlace(ranking, after, [0, 1, 2], after[1])).to.deep.equal(plan);
    await payNextPlacePortions(chain, 1n, plan.portions);
    expect(chain.escrowed.get(player(1)) ?? 0n).to.equal(0n);
    expect(movedTotal(chain)).to.equal(POT);
  });

  it('a fully settled split re-plans to zero portions — no call, no refusal', async () => {
    const { chain, ranking } = await threeWayForfeit();
    const live = await chain.getEntries(1n);
    await payNextPlacePortions(chain, 1n, planNextPlace(ranking, live, [0, 1, 2], live[1]).portions);
    const done = await chain.getEntries(1n);
    expect(done[1].escrowLamports).to.equal(0n);
    expect(done[1].splitPaidMask).to.equal((1n << 0n) | (1n << 2n));
    const plan = planNextPlace(ranking, done, [0, 1, 2], done[1]);
    expect(plan).to.deep.equal({ portions: [], blocker: 'no_forfeited_share' });
    const counted = flaky(chain, 0);
    expect(await payNextPlacePortions(counted.seam, 1n, plan.portions)).to.deep.equal([]);
    expect(counted.calls.n).to.equal(0);
  });

  it('resumes at the NEXT RANK too, where the program cannot recompute the group', async () => {
    const { chain, ranking, entries } = await settledPool([0, 1]);
    entries[0].flagged = true;
    entries[1].flagged = true;
    await chain.payPrizes(1n, [0, 1]);
    await chain.forfeitEscrow(1n, player(0));
    await chain.forfeitEscrow(1n, player(1));
    const half = POT / 2n;
    const share = half / 3n;
    const rem = half - share * 3n;

    // Forfeiter 0's half, three ways among seats 2, 3 and 4: the second
    // portion's transaction is dropped.
    const live = await chain.getEntries(1n);
    const plan = planNextPlace(ranking, live, [0, 1], live[0]);
    expect(plan.portions.map((p) => p.to)).to.deep.equal([player(2), player(3), player(4)]);
    const dropped = flaky(chain, 2);
    let failed = '';
    try {
      await payNextPlacePortions(dropped.seam, 1n, plan.portions);
    } catch (e) {
      failed = String(e);
    }
    expect(failed).to.contain('simulated');
    const mid = (await chain.getEntries(1n))[0];
    expect(mid.splitGroupSize).to.equal(3);
    expect(mid.splitPaidMask).to.equal(1n << 2n);
    expect(mid.splitRemainderPaid).to.equal(true);

    // The resume presents the frame's group size — the assertion the first
    // portion fixed on-chain — for the two unpaid members only.
    const resume = planNextPlace(ranking, await chain.getEntries(1n), [0, 1], mid);
    expect(resume.portions.map((p) => [p.to, p.groupSize, p.takesRemainder])).to.deep.equal([
      [player(3), 3, false],
      [player(4), 3, false],
    ]);
    await payNextPlacePortions(chain, 1n, resume.portions);
    expect(chain.escrowed.get(player(0)) ?? 0n).to.equal(0n, 'the last portion emptied the share exactly');

    // Then forfeiter 1's half in full, and the pot is conserved.
    const rest = await chain.getEntries(1n);
    await payNextPlacePortions(chain, 1n, planNextPlace(ranking, rest, [0, 1], rest[1]).portions);
    expect(movedTotal(chain)).to.equal(POT, 'the pot is conserved to the lamport');
    for (const s of [0, 1]) expect(chain.paid.get(player(s)) ?? 0n).to.equal(0n);
    expect(chain.paid.get(player(2))).to.equal((share + rem) * 2n);
    expect(chain.paid.get(player(3))).to.equal(share * 2n);
    expect(chain.paid.get(player(4))).to.equal(share * 2n);
  });

  it('REGRESSION: the program refuses a held wallet AS THE RECIPIENT, not just as a peer', async () => {
    // The recipient is checked inline in `handle_pay_next_place`, NOT by
    // `eligible()` — which only classifies the peers. Stage F added the
    // sanctions clause to `eligible()` alone, so a held wallet was excluded
    // from the group and paid as `to` regardless. The driver never chooses
    // such a recipient (it plans with `eligibleFor`), so this drives the
    // refusal directly: the program is the last line, and it has to hold.
    const { chain, ranking, entries } = await settledPool([0, 1]);
    entries[1].flagged = true;
    await chain.payPrizes(1n, [0, 1]);
    await chain.forfeitEscrow(1n, player(1));
    await chain.placeSanctionsHold(1n, player(0));

    const live = await chain.getEntries(1n);
    const plan = planNextPlace(ranking, live, [0, 1], live[1]);
    // The driver skips the held seat and passes the share ONWARD, which is
    // the right answer: a hold on one winner must not strand the forfeited
    // half. Seat 0 is the only other first-place seat and it is held, so
    // there is no eligible committed recipient and the share goes to the
    // next competition rank (1 + 2 committed seats = 3).
    expect(plan.blocker).to.equal(null);
    expect(plan.portions).to.not.be.empty;
    expect(plan.portions.every((x) => x.rank === 3)).to.equal(true);
    expect(plan.portions.some((x) => x.to === player(0))).to.equal(
      false,
      'the held wallet is never a recipient'
    );

    // And if something did argue it anyway, the chain refuses.
    let refused = '';
    try {
      await chain.payNextPlace(
        1n,
        player(1),
        player(0),
        1,
        POT / 2n,
        proofForRow(
          ranking,
          ranking.rows.findIndex((r) => r.player === player(0))
        ),
        1,
        true,
        []
      );
    } catch (e) {
      refused = String(e);
    }
    expect(refused).to.contain('SanctionsHoldActive');
    expect(chain.paid.get(player(0)) ?? 0n).to.equal(POT / 2n, 'only its own prize, never the forfeited half');
  });
});
