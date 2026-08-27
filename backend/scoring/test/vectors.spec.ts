/**
 * The Python oracle suite (roadmap 2.1's gate): every value in
 * fixtures/vectors.json was computed by Python; the TypeScript engine must
 * reproduce all of it — battle outcomes, pool rankings, tie-breaks, prize
 * amounts, leaf bytes and Merkle roots — exactly.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  compareBattle,
  scorePool,
  rankOrder,
  battlesHash,
  encodeBattleSet,
  amountForRank,
  potLamports,
  leafBytes,
  merkleRoot,
  merkleProof,
  verifyProof,
  PRIZE_BANDS_1024,
  type Allocation,
  type BattleSet,
} from '../src';

const vectors = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'vectors.json'), 'utf8')
);

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));

describe('battle outcomes (hand-checked cases)', () => {
  for (const c of vectors.battle_cases) {
    it(c.name, () => {
      const got = compareBattle(c.a as Allocation, c.b as Allocation);
      expect(got.outcome).to.equal(c.outcome);
      expect(got.statsA).to.equal(c.stats_a);
      expect(got.statsB).to.equal(c.stats_b);
    });
  }
});

describe('pool vectors (20 four-player + 5 full + edge cases)', () => {
  for (const pool of vectors.pools) {
    it(pool.name, () => {
      const players: BattleSet[] = pool.players.map((p: any) => p.battles);
      // The 35-byte encoding matches Python's.
      for (let i = 0; i < players.length; i++) {
        expect(hex(encodeBattleSet(players[i]))).to.equal(pool.players[i].battles_hex);
      }
      const results = scorePool(players);
      for (const expected of pool.results) {
        const got = results[expected.index];
        expect(got.scoreHalf, `score of seat ${expected.index}`).to.equal(expected.score_half);
        expect(got.zones, `zones of seat ${expected.index}`).to.equal(expected.zones);
        expect(got.rank, `rank of seat ${expected.index}`).to.equal(expected.rank);
      }
      expect(rankOrder(results).slice(0, pool.winners.length)).to.deep.equal(pool.winners);

      if (pool.root) {
        const pot = potLamports(BigInt(vectors.entry_lamports));
        expect(pot).to.equal(BigInt(vectors.pot_lamports));
        const byRank = [...results].sort((a, b) => a.rank - b.rank);
        const leaves = byRank.map((r) =>
          leafBytes({
            player: unhex(pool.players_pubkeys[r.index]),
            rank: r.rank,
            amountLamports: amountForRank(pot, r.rank),
          })
        );
        leaves.forEach((l, i) => expect(hex(l)).to.equal(pool.leaves_hex[i]));
        byRank.forEach((r, i) =>
          expect(amountForRank(pot, r.rank).toString()).to.equal(pool.amounts[i])
        );
        expect(hex(merkleRoot(leaves))).to.equal(pool.root);
        // Every leaf proves against the root.
        for (let i = 0; i < leaves.length; i++) {
          const proof = merkleProof(leaves, i);
          expect(verifyProof(leaves[i], proof, merkleRoot(leaves))).to.equal(true);
        }
        // A tampered leaf does not.
        const tampered = leaves[0].slice();
        tampered[33] ^= 1;
        expect(verifyProof(tampered, merkleProof(leaves, 0), merkleRoot(leaves))).to.equal(false);
      }
    });
  }
});

describe('draw-rate sanity (PID §4.3: free integers ≈ 7%)', () => {
  it('reproduces the oracle count exactly and lands near 7%', function () {
    this.timeout(30000);
    const { n, draws, stream_base } = vectors.draw_rate;
    const { sha256 } = require('@noble/hashes/sha256');
    const allocFromCounter = (i: number): Allocation => {
      const h: Uint8Array = sha256(new TextEncoder().encode(`alloc:${i}`));
      const d = [0, 1, 2, 3]
        .map((k) => (h[k * 2] | (h[k * 2 + 1] << 8)) % 101)
        .sort((a, b) => a - b);
      return [d[0], d[1] - d[0], d[2] - d[1], d[3] - d[2], 100 - d[3]] as unknown as Allocation;
    };
    let got = 0;
    for (let i = 0; i < n; i++) {
      const a = allocFromCounter(stream_base + 2 * i);
      const b = allocFromCounter(stream_base + 2 * i + 1);
      if (compareBattle(a, b).outcome === 'draw') got++;
    }
    expect(got).to.equal(draws);
    expect(got / n).to.be.within(0.04, 0.1);
  });
});

describe('battles hash', () => {
  for (const [i, c] of vectors.hash_cases.entries()) {
    it(`hash case ${i}`, () => {
      expect(hex(battlesHash(c.battles, unhex(c.salt)))).to.equal(c.expected);
    });
  }
});

describe('prize bands', () => {
  it('sum to exactly 1024', () => {
    expect(PRIZE_BANDS_1024.reduce((a, b) => a + b, 0n)).to.equal(1024n);
    expect(vectors.prize_bands_1024.map(BigInt)).to.deep.equal([...PRIZE_BANDS_1024]);
  });
  it('the 16 prizes sum to the pot exactly, ranks 17+ take zero', () => {
    const pot = potLamports(100_000_000n);
    let paid = 0n;
    for (let r = 1; r <= 16; r++) paid += amountForRank(pot, r);
    expect(paid).to.equal(pot);
    expect(amountForRank(pot, 17)).to.equal(0n);
    expect(amountForRank(pot, 64)).to.equal(0n);
  });
});
