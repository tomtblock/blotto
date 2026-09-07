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
  assignPrizes,
  compareBattle,
  scorePool,
  rankOrder,
  battlesHash,
  encodeBattleSet,
  amountForRank,
  potForEntry,
  leafBytes,
  merkleRoot,
  merkleProof,
  verifyProof,
  PAID_RANKS,
  PRIZE_BANDS_1024,
  TIER_ENTRY_LAMPORTS,
  type Allocation,
  type BattleSet,
  type PlayerResult,
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

describe('pool vectors (20 four-player + 5 full + minimum-field + edge cases)', () => {
  for (const pool of vectors.pools) {
    it(pool.name, () => {
      const players: BattleSet[] = pool.players.map((p: any) => p.battles);
      // The 35-byte encoding matches Python's.
      for (let i = 0; i < players.length; i++) {
        expect(hex(encodeBattleSet(players[i]))).to.equal(pool.players[i].battles_hex);
      }
      const pot = potForEntry(BigInt(pool.entry_lamports));
      const results = assignPrizes(scorePool(players), pot);
      for (const expected of pool.results) {
        const got = results[expected.index];
        expect(got.scoreHalf, `score of seat ${expected.index}`).to.equal(expected.score_half);
        expect(got.zones, `zones of seat ${expected.index}`).to.equal(expected.zones);
        expect(got.rank, `rank of seat ${expected.index}`).to.equal(expected.rank);
        expect(
          got.amountLamports.toString(),
          `amount of seat ${expected.index}`
        ).to.equal(expected.amount_lamports);
      }
      // leaf_order is comma-joined in the fixture (a bare 64-integer JSON
      // array is exactly a Solana keypair's shape; the gitleaks rule stays
      // strict instead of gaining an allowlist).
      expect(rankOrder(results)).to.deep.equal(pool.leaf_order.split(',').map(Number));
      // The committed payout list: nonzero seats, seat-sorted.
      const myPayouts = results
        .filter((r) => r.amountLamports > 0n)
        .sort((a, b) => a.index - b.index)
        .map((r) => ({ entry_index: r.index, amount: r.amountLamports.toString() }));
      expect(myPayouts).to.deep.equal(pool.payouts);

      if (pool.root) {
        const byRank = [...results].sort((a, b) => a.rank - b.rank || a.index - b.index);
        const leaves = byRank.map((r) =>
          leafBytes({
            player: unhex(pool.players_pubkeys[r.index]),
            rank: r.rank,
            amountLamports: r.amountLamports,
          })
        );
        leaves.forEach((l, i) => expect(hex(l)).to.equal(pool.leaves_hex[i]));
        byRank.forEach((r, i) =>
          expect(r.amountLamports.toString()).to.equal(pool.amounts[i])
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

describe('split-pot cases (D3-B, through the same assignPrizes)', () => {
  for (const c of vectors.split_cases) {
    it(c.name, () => {
      // Rebuild the constructed ranking the oracle described: consecutive
      // tie groups over a 52..64-seat field.
      const results: PlayerResult[] = [];
      let rank = 1;
      let seat = 0;
      for (const size of c.group_sizes as number[]) {
        for (let k = 0; k < size; k++) {
          results.push({ index: seat++, scoreHalf: 0, zones: 0, rank, amountLamports: 0n });
        }
        rank += size;
      }
      const pot = potForEntry(BigInt(c.entry_lamports));
      const assigned = assignPrizes(results, pot);
      const myPayouts = assigned
        .filter((r) => r.amountLamports > 0n)
        .map((r) => ({ entry_index: r.index, amount: r.amountLamports.toString() }));
      expect(myPayouts).to.deep.equal(c.payouts);
      // Conservation: the paid set carries the whole pot.
      let total = 0n;
      for (const r of assigned) total += r.amountLamports;
      expect(total).to.equal(pot);
    });
  }
  it('a two-way tie for first halves the pot exactly at every tier (D-E2)', () => {
    const cases = vectors.split_cases.filter((x: any) =>
      String(x.name).startsWith('two_way_first_tier_')
    );
    expect(cases.length).to.equal(7);
    for (const c of cases) {
      const pot = potForEntry(BigInt(c.entry_lamports));
      expect(c.payouts.map((p: any) => p.entry_index)).to.deep.equal([0, 1]);
      for (const p of c.payouts) expect(BigInt(p.amount)).to.equal(pot / 2n);
    }
  });
  it('the three-way tie for first leaves one lamport on the lowest seat', () => {
    for (const name of ['three_way_first', 'three_way_first_field_52']) {
      const c = vectors.split_cases.find((x: any) => x.name === name);
      expect(c.payouts.length, name).to.equal(3);
      const tied = c.payouts.map((p: any) => BigInt(p.amount));
      // D-E1 pot 4 SOL: 4_000_000_000 / 3 = 1_333_333_333 remainder 1 — the
      // single indivisible lamport lands on the lowest seat.
      expect(tied).to.deep.equal([1_333_333_334n, 1_333_333_333n, 1_333_333_333n]);
    }
  });
  it('a tie for second pays exactly one seat — nothing below first is paid', () => {
    const c = vectors.split_cases.find((x: any) => x.name === 'tie_for_second');
    expect(c.payouts).to.deep.equal([{ entry_index: 0, amount: '4000000000' }]);
  });
  it('an everyone-tied 52-seat field splits the pot with a visible remainder', () => {
    const c = vectors.split_cases.find((x: any) => x.name === 'all_identical_52');
    expect(c.payouts.length).to.equal(52);
    // 4_000_000_000 / 52 = 76_923_076 remainder 48: the lowest seat takes
    // the 48 indivisible lamports; conservation is checked above.
    expect(BigInt(c.payouts[0].amount)).to.equal(76_923_076n + 48n);
    expect(BigInt(c.payouts[1].amount)).to.equal(76_923_076n);
  });
});

describe('minimum-field pool vectors (D-E4)', () => {
  for (const n of [52, 58]) {
    it(`field_${n}: ${n} leaves, one winner, the whole pot`, () => {
      const pool = vectors.pools.find((x: any) => x.name === `field_${n}`);
      expect(pool, `field_${n} present`).to.exist;
      expect(pool.players.length).to.equal(n);
      expect(pool.leaves_hex.length).to.equal(n);
      const pot = potForEntry(BigInt(pool.entry_lamports));
      const total = pool.payouts.reduce((a: bigint, p: any) => a + BigInt(p.amount), 0n);
      expect(total).to.equal(pot);
      const winners = pool.results.filter((r: any) => r.rank === 1);
      expect(pool.payouts.length).to.equal(winners.length);
    });
  }
});

describe('per-tier prize tables (D1)', () => {
  it('TIER_ENTRY_LAMPORTS mirrors the oracle tier table exactly', () => {
    const { TIER_ENTRY_LAMPORTS } = require('../src');
    expect(TIER_ENTRY_LAMPORTS.map((v: bigint) => v.toString())).to.deep.equal(
      vectors.tier_tables.map((t: { entry_lamports: string }) => t.entry_lamports)
    );
  });

  for (const t of vectors.tier_tables) {
    it(`entry ${t.entry_lamports}`, () => {
      const pot = potForEntry(BigInt(t.entry_lamports));
      expect(pot.toString()).to.equal(t.pot_lamports);
      expect(t.bands.length).to.equal(PAID_RANKS);
      for (let r = 1; r <= PAID_RANKS; r++) {
        expect(amountForRank(pot, r).toString()).to.equal(t.bands[r - 1]);
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
  it('one paid place: rank 1 is the pot, every lower rank takes zero (D-E2)', () => {
    expect(PAID_RANKS).to.equal(1);
    expect(vectors.paid_ranks).to.equal(PAID_RANKS);
    for (let tier = 0; tier < 7; tier++) {
      const pot = potForEntry(TIER_ENTRY_LAMPORTS[tier]);
      expect(amountForRank(pot, 1)).to.equal(pot);
      expect(amountForRank(pot, 2)).to.equal(0n);
      expect(amountForRank(pot, 64)).to.equal(0n);
    }
  });
});
