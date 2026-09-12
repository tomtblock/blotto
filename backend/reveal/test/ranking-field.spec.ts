/**
 * `recomputeRanking` refuses an incomplete field (audit 2026-09-11, B-09).
 *
 * The next-place driver recomputes the ranking from the entry accounts it
 * read; a program-account scan that came back short would otherwise be
 * ranked as if the missing seats never existed. The refusal happens before
 * the store or the secret is touched, so this needs neither.
 */

import { expect } from 'chai';
import { recomputeRanking } from '../src/ranking';
import type { CiphertextStore } from '../../sealing/src';

const untouched: CiphertextStore = {
  get: async () => {
    throw new Error('the store must not be read for an incomplete field');
  },
  put: async () => {
    throw new Error('never');
  },
  list: async () => {
    throw new Error('never');
  },
} as unknown as CiphertextStore;

describe('recomputeRanking against a short field', () => {
  it('refuses when fewer entry accounts were read than the pool reports', async () => {
    let threw: unknown = null;
    try {
      await recomputeRanking(untouched, 7n, new Uint8Array(32), [], 64, 4_000_000_000n, null);
    } catch (e) {
      threw = e;
    }
    expect(threw).to.be.instanceOf(Error);
    expect((threw as Error).message).to.match(/64 entrants/);
    expect((threw as Error).message).to.match(/incomplete field/);
  });
});

/**
 * ONE canonical leaf order, four implementations (audit 2026-09-11, G-15).
 *
 * The order — rank ascending, then entry index ascending — fixes the Merkle
 * leaf positions, so it decides whether a proof verifies and therefore
 * whether `pay_next_place` accepts a recipient. `backend/scoring/src/engine.ts`
 * owns it as `rankOrder()`, which is the function the Python oracle's vectors
 * pin. Three other places sort the same comparator by hand:
 *
 *   - `backend/reveal/src/ranking.ts::buildRanking` — what the crank commits;
 *   - `backend/indexer/src/archive.ts::recomputeRoot` — what the archive
 *     re-derives before it will serve a leaderboard;
 *   - `app/src/verify/logic.ts` — what the browser rebuilds on the verify
 *     page (pinned on that side by `app/src/verify/logic.test.ts`).
 *
 * None of them calls `rankOrder`, and nothing compared them. A comparator
 * that drifted in one place would not throw anywhere: the root would simply
 * stop matching, the archive would serve nothing, and every next-place proof
 * would be refused — on a pool with money in it. This holds the two Node-side
 * copies against the owner, on fields built to make the tie-break decide.
 */
describe('the canonical leaf order, across its implementations (G-15)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { rankOrder } = require('../../scoring/src') as typeof import('../../scoring/src');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildRanking } = require('../src/ranking') as typeof import('../src/ranking');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { recomputeRoot } = require('../../indexer/src/archive') as typeof import('../../indexer/src/archive');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { base58Encode } = require('../../_shared/src/blotto-events') as typeof import('../../_shared/src/blotto-events');

  /** A deterministic 32-byte base58 key per seat. */
  function playerAt(index: number): string {
    const b = new Uint8Array(32);
    b.fill(11);
    b[0] = index + 1;
    return base58Encode(b);
  }

  /**
   * Fields where the tie-break is load-bearing: ranks repeat, and the seats
   * are supplied OUT of index order so a sort that dropped the `index`
   * tie-break produces a different answer rather than the same one.
   */
  const FIELDS: ReadonlyArray<{ name: string; rows: Array<{ index: number; rank: number }> }> = [
    {
      name: 'a four-way tie for first, seats shuffled',
      rows: [
        { index: 5, rank: 1 },
        { index: 2, rank: 1 },
        { index: 9, rank: 1 },
        { index: 0, rank: 1 },
        { index: 7, rank: 5 },
      ],
    },
    {
      name: 'repeated ranks at several levels',
      rows: [
        { index: 3, rank: 4 },
        { index: 1, rank: 2 },
        { index: 8, rank: 2 },
        { index: 0, rank: 1 },
        { index: 6, rank: 4 },
        { index: 2, rank: 4 },
      ],
    },
    { name: 'a single seat', rows: [{ index: 0, rank: 1 }] },
  ];

  for (const field of FIELDS) {
    it(`agrees on ${field.name}`, () => {
      const scored = field.rows.map((r) => ({
        index: r.index,
        rank: r.rank,
        scoreHalf: 100 - r.rank,
        zones: 5 - r.rank,
        // Distinct per seat, so a wrong ORDER is also a wrong ROOT below.
        amountLamports: BigInt(r.index + 1) * 1_000_000n,
      }));

      const owner = rankOrder(scored);
      // The owner's own answer, restated so a change to `rankOrder` itself is
      // a reviewed act rather than something the other two silently follow.
      const expected = [...field.rows]
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map((r) => r.index);
      expect(owner, 'rankOrder').to.deep.equal(expected);

      // The crank's copy.
      const ranking = buildRanking(scored, playerAt);
      expect(ranking.rows.map((r) => r.index), 'buildRanking (the crank)').to.deep.equal(owner);

      // The archive's copy: it re-derives the root from the bundle's rows in
      // their PUBLISHED order, so feeding it the crank's rows must reproduce
      // the crank's root exactly — which is the property the leaderboard's
      // "verified" flag rests on.
      const republished = ranking.rows.map((r) => ({
        index: r.index,
        player: r.player,
        score_half: r.scoreHalf,
        zones: r.zones,
        rank: r.rank,
        amount_lamports: r.amountLamports.toString(),
      }));
      expect(recomputeRoot(republished), 'recomputeRoot (the archive)').to.equal(
        Buffer.from(ranking.root).toString('hex')
      );

      // …and a bundle published in ANY other order recomputes to a different
      // root, which is what makes the order load-bearing rather than
      // cosmetic. (Skipped for the one-row field, which has no other order.)
      if (republished.length > 1) {
        const swapped = [...republished];
        [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
        expect(recomputeRoot(swapped), 'a re-ordered bundle must NOT verify').to.not.equal(
          Buffer.from(ranking.root).toString('hex')
        );
      }
    });
  }
});
