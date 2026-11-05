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
  scoreWithMissing,
  rankOrder,
  battlesHash,
  encodeBattleSet,
  amountForRank,
  prizePoolFor,
  ladderTable,
  leafBytes,
  merkleRoot,
  merkleProof,
  verifyProof,
  LADDER_TABLES,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
  MAX_CAPACITY,
  MAX_PAID_PLACES,
  TIER_ENTRY_LAMPORTS,
  type PoolCapacity,
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

describe('pool vectors (four-player, full at every capacity, minimum fields, edge cases)', () => {
  for (const pool of vectors.pools) {
    it(pool.name, () => {
      const players: BattleSet[] = pool.players.map((p: any) => p.battles);
      // The 35-byte encoding matches Python's.
      for (let i = 0; i < players.length; i++) {
        expect(hex(encodeBattleSet(players[i]))).to.equal(pool.players[i].battles_hex);
      }
      // The pool's table is the launch table for its capacity; the oracle
      // records both so a mismatch names itself.
      const table = ladderTable(pool.capacity);
      expect([...table]).to.deep.equal(pool.prize_table);
      const entry = BigInt(pool.entry_lamports);
      expect(prizePoolFor(table, entry).toString()).to.equal(pool.prize_pool_lamports);
      const results = assignPrizes(scorePool(players), table, entry);
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

describe('lost-ciphertext pools (TECH-ARCH §5, scoreWithMissing)', () => {
  // These are the vectors that were missing until 2026-09-21. scoreWithMissing
  // decides every real settlement — crank.ts and ranking.ts both score through
  // it, never through scorePool — and nothing independent proved it.
  //
  // The oracle walks the full n x n comparison; the implementation scores the
  // present players among themselves and shifts every one of them by a
  // constant. Those are different computations, so agreement here is evidence
  // that the shortcut is sound rather than a restatement of it.
  for (const pool of vectors.missing_pools) {
    it(pool.name, () => {
      const entries = pool.players.map((p: any, i: number) => ({
        index: i,
        battles: p === null ? null : (p.battles as BattleSet),
      }));
      const results = scoreWithMissing(entries);
      expect(results.length).to.equal(pool.players.length);
      for (const expected of pool.results) {
        const got = results[expected.index];
        expect(got.index, 'results come back in seat order').to.equal(expected.index);
        expect(got.scoreHalf, `score of seat ${expected.index}`).to.equal(expected.score_half);
        expect(got.zones, `zones of seat ${expected.index}`).to.equal(expected.zones);
        expect(got.rank, `rank of seat ${expected.index}`).to.equal(expected.rank);
      }
    });
  }

  it('a missing entry never scores a zone, and present players gain none from it', () => {
    for (const pool of vectors.missing_pools) {
      for (const seat of pool.missing_indices) {
        expect(pool.results[seat].zones, `${pool.name} seat ${seat}`).to.equal(0);
      }
    }
  });

  it('with nothing missing it agrees with scorePool exactly', () => {
    const pool = vectors.missing_pools.find((p: any) => p.name === 'none_missing_4');
    expect(pool, 'the none_missing_4 vector').to.not.equal(undefined);
    const players: BattleSet[] = pool.players.map((p: any) => p.battles);
    const plain = scorePool(players);
    const viaMissing = scoreWithMissing(players.map((b, i) => ({ index: i, battles: b })));
    expect(viaMissing.map((r) => [r.index, r.scoreHalf, r.zones, r.rank])).to.deep.equal(
      plain.map((r) => [r.index, r.scoreHalf, r.zones, r.rank])
    );
  });

  it('refuses a seat list with a gap rather than scoring a pool it cannot place', () => {
    expect(() => scoreWithMissing([{ index: 1, battles: null }])).to.throw('without gaps');
  });
});

describe('split-pot cases (D3-B over the Ladder tables, through the same assignPrizes)', () => {
  const build = (groupSizes: number[]): PlayerResult[] => {
    const results: PlayerResult[] = [];
    let rank = 1;
    let seat = 0;
    for (const size of groupSizes) {
      for (let k = 0; k < size; k++) {
        results.push({ index: seat++, scoreHalf: 0, zones: 0, rank, amountLamports: 0n });
      }
      rank += size;
    }
    return results;
  };
  const caseNamed = (name: string) => {
    const c = vectors.split_cases.find((x: any) => x.name === name);
    expect(c, name).to.exist;
    return c;
  };

  for (const c of vectors.split_cases) {
    it(c.name, () => {
      // Rebuild the constructed ranking the oracle described: consecutive
      // tie groups over a field between the minimum field and the capacity.
      const field = (c.group_sizes as number[]).reduce((a, b) => a + b, 0);
      expect(field).to.be.within(MIN_FIELD_BY_CAPACITY[c.capacity as PoolCapacity], c.capacity);
      const table = ladderTable(c.capacity);
      const entry = BigInt(c.entry_lamports);
      const assigned = assignPrizes(build(c.group_sizes), table, entry);
      const myPayouts = assigned
        .filter((r) => r.amountLamports > 0n)
        .map((r) => ({ entry_index: r.index, amount: r.amountLamports.toString() }));
      expect(myPayouts).to.deep.equal(c.payouts);
      // Conservation: the paid set carries the whole prize pool, because
      // every case's field is at least its minimum field, which exceeds the
      // number of places paid.
      let total = 0n;
      for (const r of assigned) total += r.amountLamports;
      expect(total).to.equal(prizePoolFor(table, entry));
    });
  }

  it("the spec's example: four tied across 15th–18th of 64 share 15th and 16th", () => {
    const c = caseNamed('four_way_15th_to_18th_cap64');
    const entry = BigInt(c.entry_lamports);
    // 15th and 16th are worth one entry each: two entries over four players.
    const tied = c.payouts.filter((p: any) => p.entry_index >= 14).map((p: any) => BigInt(p.amount));
    expect(tied).to.deep.equal([entry / 2n, entry / 2n, entry / 2n, entry / 2n]);
    // 17th and 18th, otherwise unpaid, are paid by sharing; 19th onward is not.
    expect(c.payouts.map((p: any) => p.entry_index)).to.not.include(18);
  });

  it('a pair tied on the last paid place halves it, at every capacity', () => {
    for (const cap of POOL_CAPACITIES) {
      const c = caseNamed(`pair_on_paid_line_cap${cap}`);
      const table = LADDER_TABLES[cap];
      const last = BigInt(table[table.length - 1]) * BigInt(c.entry_lamports);
      const pair = c.payouts.slice(-2).map((p: any) => BigInt(p.amount));
      expect(pair, `cap ${cap}`).to.deep.equal([last / 2n + (last % 2n), last / 2n]);
      expect(c.payouts.length, `cap ${cap}: one more seat than the table`).to.equal(table.length + 1);
    }
  });

  it('a three-way tie for first of 8 leaves the indivisible lamports on the lowest seat', () => {
    // 1st + 2nd + 3rd of an 8-pool at 0.1 SOL = (3 + 2 + 0) × 0.1 = 0.5 SOL;
    // 500_000_000 / 3 = 166_666_666 remainder 2.
    const c = caseNamed('three_way_first_cap8');
    expect(c.payouts.map((p: any) => BigInt(p.amount))).to.deep.equal([
      166_666_668n,
      166_666_666n,
      166_666_666n,
    ]);
  });

  it('a tie for second of 64 pays both tied seats the mean of 2nd and 3rd', () => {
    const c = caseNamed('tie_for_second_cap64');
    const entry = BigInt(c.entry_lamports);
    expect(BigInt(c.payouts[0].amount)).to.equal(12n * entry);
    expect(BigInt(c.payouts[1].amount)).to.equal(((6n + 3n) * entry) / 2n);
    expect(BigInt(c.payouts[2].amount)).to.equal(((6n + 3n) * entry) / 2n);
  });

  it('a two-way tie for first splits 1st + 2nd exactly at every tier (8 and 64)', () => {
    for (const cap of [8, 64] as const) {
      const cases = vectors.split_cases.filter(
        (x: any) => String(x.name).startsWith('two_way_first_tier_') && x.capacity === cap
      );
      expect(cases.length).to.equal(TIER_ENTRY_LAMPORTS.length);
      const [a, b] = LADDER_TABLES[cap];
      for (const c of cases) {
        const combined = BigInt(a + b) * BigInt(c.entry_lamports);
        expect(BigInt(c.payouts[0].amount)).to.equal(combined / 2n + (combined % 2n));
        expect(BigInt(c.payouts[1].amount)).to.equal(combined / 2n);
      }
    }
  });
});

describe('the prize property (D-E19): untied amounts are whole multiples; every pool conserves', () => {
  // A deterministic sweep over random tie structures at every capacity and
  // tier — not a vector from the oracle, a property of the rule itself.
  let x = 0x9e3779b9;
  const next = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x1_0000_0000;
  };
  it('holds over 4,000 random fields', () => {
    for (let trial = 0; trial < 4000; trial++) {
      const cap = POOL_CAPACITIES[trial % 4];
      const entry = TIER_ENTRY_LAMPORTS[Math.floor(next() * TIER_ENTRY_LAMPORTS.length)];
      const mn = MIN_FIELD_BY_CAPACITY[cap];
      const n = mn + Math.floor(next() * (cap - mn + 1));
      const sizes: number[] = [];
      let left = n;
      while (left > 0) {
        const size = Math.min(left, 1 + Math.floor(next() * next() * 6));
        sizes.push(size);
        left -= size;
      }
      const results: PlayerResult[] = [];
      let rank = 1;
      let seat = 0;
      for (const size of sizes) {
        for (let k = 0; k < size; k++) {
          results.push({ index: seat++, scoreHalf: 0, zones: 0, rank, amountLamports: 0n });
        }
        rank += size;
      }
      const table = LADDER_TABLES[cap];
      const out = assignPrizes(results, table, entry);
      let total = 0n;
      for (const r of out) total += r.amountLamports;
      expect(total, `trial ${trial}`).to.equal(prizePoolFor(table, entry));
      const groupSize = new Map<number, number>();
      for (const r of out) groupSize.set(r.rank, (groupSize.get(r.rank) ?? 0) + 1);
      for (const r of out) {
        if (groupSize.get(r.rank) === 1) {
          expect(r.amountLamports % entry, `trial ${trial} seat ${r.index}`).to.equal(0n);
          expect(r.amountLamports).to.equal(amountForRank(table, entry, r.rank));
        }
        // No amount ever exceeds first place — the on-chain commit bound.
        expect(r.amountLamports <= BigInt(table[0]) * entry).to.equal(true);
      }
    }
  });
});

describe('minimum-field pool vectors (every capacity)', () => {
  for (const cap of POOL_CAPACITIES) {
    const n = MIN_FIELD_BY_CAPACITY[cap];
    it(`field_min_${cap}: ${n} leaves, the full ${cap}-player table paid`, () => {
      const pool = vectors.pools.find((x: any) => x.name === `field_min_${cap}`);
      expect(pool, `field_min_${cap} present`).to.exist;
      expect(pool.capacity).to.equal(cap);
      expect(pool.players.length).to.equal(n);
      expect(pool.leaves_hex.length).to.equal(n);
      const total = pool.payouts.reduce((a: bigint, p: any) => a + BigInt(p.amount), 0n);
      expect(total).to.equal(prizePoolFor(LADDER_TABLES[cap], BigInt(pool.entry_lamports)));
      // A minimum field is larger than the paid places, so every place is paid.
      expect(pool.payouts.length).to.be.at.least(LADDER_TABLES[cap].length);
    });
  }
});

describe('the Ladder tables (D-E19)', () => {
  it('mirror the oracle exactly', () => {
    expect([...POOL_CAPACITIES]).to.deep.equal(vectors.ladder.capacities);
    for (const cap of POOL_CAPACITIES) {
      expect([...LADDER_TABLES[cap]], `table ${cap}`).to.deep.equal(vectors.ladder.tables[String(cap)]);
      expect(MIN_FIELD_BY_CAPACITY[cap], `min ${cap}`).to.equal(vectors.ladder.min_seats[String(cap)]);
    }
    expect(Number(MAX_CAPACITY)).to.equal(vectors.max_capacity);
    expect(MAX_PAID_PLACES).to.equal(vectors.max_paid_places);
  });
  it('TIER_ENTRY_LAMPORTS mirrors the oracle tier table exactly', () => {
    const tiers = [...new Set(vectors.tier_tables.map((t: any) => t.entry_lamports))];
    expect(TIER_ENTRY_LAMPORTS.map((v) => v.toString())).to.deep.equal(tiers);
  });
  for (const t of vectors.tier_tables) {
    it(`entry ${t.entry_lamports} × ${t.capacity} players`, () => {
      const table = LADDER_TABLES[t.capacity as PoolCapacity];
      const entry = BigInt(t.entry_lamports);
      expect(prizePoolFor(table, entry).toString()).to.equal(t.prize_pool_lamports);
      expect(t.places.length).to.equal(table.length);
      for (let r = 1; r <= table.length; r++) {
        expect(amountForRank(table, entry, r).toString()).to.equal(t.places[r - 1]);
      }
      expect(amountForRank(table, entry, table.length + 1)).to.equal(0n);
      expect(amountForRank(table, entry, 64)).to.equal(0n);
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

/**
 * HARD mode (Phase B, founder rulings 2026-09-24): the same engine over
 * boards placed under the hard rule — thirty-five stats summing to 700,
 * two bytes per stat on the wire. The oracle computes every number here
 * with its own hard stream and its own 70-byte encoder; the TypeScript
 * must reproduce all of it.
 */
describe('hard mode: hand-checked battle cases', () => {
  for (const c of vectors.hard_battle_cases) {
    it(c.name, () => {
      const got = compareBattle(c.a as Allocation, c.b as Allocation);
      expect(got.outcome).to.equal(c.outcome);
      expect(got.statsA).to.equal(c.stats_a);
      expect(got.statsB).to.equal(c.stats_b);
    });
  }
  it('the total is seven battles’ worth of easy points', () => {
    const { HARD_TOTAL } = require('../src');
    expect(vectors.hard_total).to.equal(700);
    expect(HARD_TOTAL).to.equal(vectors.hard_total);
  });
});

describe('hard mode: pool vectors (four-player, full field, minimum field, stacked edges)', () => {
  for (const pool of vectors.hard_pools) {
    it(pool.name, () => {
      const players: BattleSet[] = pool.players.map((p: any) => p.battles);
      // The 70-byte encoding matches Python's; the 35-byte one refuses it.
      for (let i = 0; i < players.length; i++) {
        expect(hex(encodeBattleSet(players[i], 'hard'))).to.equal(pool.players[i].battles_hex);
        expect(pool.players[i].battles_hex.length).to.equal(140);
      }
      expect(() => scorePool(players), 'a hard board is not an easy one').to.throw(
        /sum to exactly 100|integers in \[0, 100\]/
      );
      const table = ladderTable(pool.capacity);
      const results = assignPrizes(scorePool(players, 'hard'), table, BigInt(pool.entry_lamports));
      for (const expected of pool.results) {
        const got = results[expected.index];
        expect(got.scoreHalf, `score of seat ${expected.index}`).to.equal(expected.score_half);
        expect(got.zones, `zones of seat ${expected.index}`).to.equal(expected.zones);
        expect(got.rank, `rank of seat ${expected.index}`).to.equal(expected.rank);
        expect(got.amountLamports.toString(), `amount of seat ${expected.index}`).to.equal(
          expected.amount_lamports
        );
      }
      expect(rankOrder(results)).to.deep.equal(pool.leaf_order.split(',').map(Number));
      const myPayouts = results
        .filter((r) => r.amountLamports > 0n)
        .sort((a, b) => a.index - b.index)
        .map((r) => ({ entry_index: r.index, amount: r.amountLamports.toString() }));
      expect(myPayouts).to.deep.equal(pool.payouts);
      if (pool.root) {
        // The tree is mode-blind: player ‖ rank ‖ amount, nothing about the board.
        const byRank = rankOrder(results);
        const leaves = byRank.map((seat) =>
          leafBytes({
            player: unhex(pool.players_pubkeys[seat]),
            rank: results[seat].rank,
            amountLamports: results[seat].amountLamports,
          })
        );
        expect(leaves.map(hex)).to.deep.equal(pool.leaves_hex);
        expect(hex(merkleRoot(leaves))).to.equal(pool.root);
      }
    });
  }
});

describe('hard mode: a lost ciphertext scores all losses exactly as in easy', () => {
  for (const pool of vectors.hard_missing_pools) {
    it(pool.name, () => {
      const entries = pool.players.map((p: any, i: number) => ({
        index: i,
        battles: p === null ? null : (p.battles as BattleSet),
      }));
      const results = scoreWithMissing(entries, 'hard');
      for (const expected of pool.results) {
        const got = results[expected.index];
        expect(got.scoreHalf, `score of seat ${expected.index}`).to.equal(expected.score_half);
        expect(got.zones, `zones of seat ${expected.index}`).to.equal(expected.zones);
        expect(got.rank, `rank of seat ${expected.index}`).to.equal(expected.rank);
      }
    });
  }
});

describe('hard mode: battles hash over the 70-byte encoding', () => {
  for (const [i, c] of vectors.hard_hash_cases.entries()) {
    it(`hard hash case ${i}`, () => {
      expect(hex(battlesHash(c.battles, unhex(c.salt), 'hard'))).to.equal(c.expected);
      if (c.easy_expected) {
        // The same numbers commit differently under the two modes: the
        // mode is part of what was committed to.
        expect(hex(battlesHash(c.battles, unhex(c.salt)))).to.equal(c.easy_expected);
        expect(c.expected).to.not.equal(c.easy_expected);
      }
    });
  }
});
