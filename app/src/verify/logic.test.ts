/*
 * Verify-page logic specs: a consistent pool verifies green; every category
 * of tampering — a swapped battle set, a doctored rank, a wrong payout, a
 * forged secret — turns exactly the right check red.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { verifyPool, type OnChainRecord, type PublishedBundle } from './logic';
import {
  assignPrizes,
  battlesHash,
  decodeBattleSet,
  encodeBattleSet,
  potForTier,
  rankOrder,
  scorePool,
  leafBytes,
  merkleRoot,
  type BattleSet,
} from '@blotto/scoring';
import { base58Encode, base58Decode } from '@blotto/shared/blotto-events';
import { scoreWithMissing } from '@blotto/scoring';

const sha = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

function alloc(i: number): number[] {
  const h = sha(`alloc:${i}`);
  const d = [0, 1, 2, 3].map((k) => (h[k * 2] | (h[k * 2 + 1] << 8)) % 101).sort((a, b) => a - b);
  return [d[0], d[1] - d[0], d[2] - d[1], d[3] - d[2], 100 - d[3]];
}

function fixture(): { bundle: PublishedBundle; chain: OnChainRecord } {
  const n = 64;
  const players = Array.from({ length: n }, (_, i) => base58Encode(sha(`p:${i}`)));
  const battles: BattleSet[] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: 7 }, (_, k) => alloc(i * 100 + k))
  ) as never;
  const salts = Array.from({ length: n }, (_, i) => sha(`salt:${i}`));
  const entry = 100_000_000n;
  const pot = potForTier(0);
  const results = assignPrizes(scorePool(battles), pot);
  // Leaf order (D3-B): rank asc, entry index asc.
  const byRank = [...results].sort((a, b) => a.rank - b.rank || a.index - b.index);
  const leaves = byRank.map((r) =>
    leafBytes({
      player: base58Decode(players[r.index]),
      rank: r.rank,
      amountLamports: r.amountLamports,
    })
  );
  const root = hex(merkleRoot(leaves));
  const committed = results
    .filter((r) => r.amountLamports > 0n)
    .sort((a, b) => a.index - b.index);
  const secret = sha('the-pool-secret');

  const bundle: PublishedBundle = {
    pool_id: '1',
    secret: hex(secret),
    entry_lamports: entry.toString(),
    entries: players.map((p, i) => ({
      player: p,
      index: i,
      battles: hex(encodeBattleSet(battles[i])),
      salt: hex(salts[i]),
      battles_hash: hex(battlesHash(battles[i], salts[i])),
      status: 'ok',
    })),
    results: byRank.map((r) => ({
      index: r.index,
      player: players[r.index],
      score_half: r.scoreHalf,
      zones: r.zones,
      rank: r.rank,
      amount_lamports: r.amountLamports.toString(),
    })),
    payouts: committed.map((r) => ({
      entry_index: r.index,
      player: players[r.index],
      amount_lamports: r.amountLamports.toString(),
    })),
    results_root: root,
  };
  const chain: OnChainRecord = {
    sealingSecretHashHex: hex(new Uint8Array(createHash('sha256').update(secret).digest())),
    entryLamports: entry.toString(),
    potLamports: pot.toString(),
    revealedSecretHex: hex(secret),
    resultsRootHex: root,
    committedPayouts: committed.map((r) => ({
      entryIndex: r.index,
      amount: r.amountLamports.toString(),
    })),
    battlesHashByPlayer: Object.fromEntries(
      players.map((p, i) => [p, hex(battlesHash(battles[i], salts[i]))])
    ),
    payouts: committed.map((r) => ({
      player: players[r.index],
      entryIndex: r.index,
      amount: r.amountLamports.toString(),
    })),
  };
  return { bundle, chain };
}

describe('verifyPool', () => {
  it('a consistent pool verifies green on every check', () => {
    const { bundle, chain } = fixture();
    const report = verifyPool(bundle, chain);
    expect(report.checks.map((c) => `${c.name}:${c.status}`)).toEqual([
      'roster:pass',
      'secret-commitment:pass',
      'bundle-secret:pass',
      'entry-commitments:pass',
      'rescore:pass',
      'results-root:pass',
      'committed-payouts:pass',
      'payouts:pass',
    ]);
    expect(report.verdict).toBe('match');
    expect(report.ok).toBe(true);
  });

  it('a swapped battle set turns entry-commitments red', () => {
    const { bundle, chain } = fixture();
    bundle.entries[5].battles = bundle.entries[6].battles;
    const report = verifyPool(bundle, chain);
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'entry-commitments')!.ok).toBe(false);
  });

  it('a doctored published rank turns rescore red', () => {
    const { bundle, chain } = fixture();
    const a = bundle.results[0].rank;
    bundle.results[0].rank = bundle.results[1].rank;
    bundle.results[1].rank = a;
    const report = verifyPool(bundle, chain);
    expect(report.checks.find((c) => c.name === 'rescore')!.ok).toBe(false);
  });

  it('a wrong on-chain payout amount turns payouts red', () => {
    const { bundle, chain } = fixture();
    chain.payouts[0].amount = (BigInt(chain.payouts[0].amount) + 1n).toString();
    const report = verifyPool(bundle, chain);
    expect(report.checks.find((c) => c.name === 'payouts')!.ok).toBe(false);
  });

  it('a doctored committed payout list turns committed-payouts red', () => {
    const { bundle, chain } = fixture();
    chain.committedPayouts[0].amount = (
      BigInt(chain.committedPayouts[0].amount) - 1n
    ).toString();
    const report = verifyPool(bundle, chain);
    expect(report.checks.find((c) => c.name === 'committed-payouts')!.ok).toBe(false);
  });

  it('a payout routed to a different wallet turns payouts red', () => {
    const { bundle, chain } = fixture();
    // Under D-E2 the paid set is usually one seat, so the wrong wallet is
    // any OTHER entrant's — not a second payout row.
    const winner = chain.payouts[0];
    const other = bundle.entries.find((e) => e.index !== winner.entryIndex)!;
    winner.player = other.player;
    const report = verifyPool(bundle, chain);
    expect(report.checks.find((c) => c.name === 'payouts')!.ok).toBe(false);
  });

  it('a forged secret turns the commitment check red', () => {
    const { bundle, chain } = fixture();
    chain.revealedSecretHex = hex(sha('not-the-secret'));
    bundle.secret = chain.revealedSecretHex;
    const report = verifyPool(bundle, chain);
    expect(report.checks.find((c) => c.name === 'secret-commitment')!.ok).toBe(false);
  });

  it('a tampered committed root turns results-root red while rescore stays green', () => {
    const { bundle, chain } = fixture();
    chain.resultsRootHex = '00' + chain.resultsRootHex.slice(2);
    const report = verifyPool(bundle, chain);
    expect(report.checks.find((c) => c.name === 'results-root')!.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'rescore')!.ok).toBe(true);
  });

  /*
   * D-10 (audit 2026-09-11). An entry published WITHOUT its battles has no
   * plaintext to hash, so it was skipped — and a bundle that published no
   * plaintext at all verified green having checked nothing at all. The
   * published lost-ciphertext rule (TECH-ARCH §5) makes a missing entry
   * legitimate, so it is not a mismatch; it is not a verification either.
   */
  /*
   * The canonical leaf order, across the language boundary (audit
   * 2026-09-11, G-15).
   *
   * `verifyPool` rebuilds the Merkle root from its own hand-written sort —
   * `rank asc, index asc` — rather than from `rankOrder()`, the function in
   * `@blotto/scoring` that owns the order and that the Python oracle's
   * vectors pin. Two more copies of the same comparator live in
   * `backend/reveal/src/ranking.ts` and `backend/indexer/src/archive.ts`
   * (held against the owner by `backend/reveal/test/ranking-field.spec.ts`).
   *
   * A comparator that drifted HERE would not throw. The page would simply
   * tell every player that the root does not match, on a pool that is
   * perfectly sound — the verify page's entire purpose, inverted. So the
   * order this page uses is asserted against the owner directly, on a field
   * whose ties make the index tie-break decide.
   */
  describe('the leaf order it rebuilds the root from (G-15)', () => {
    /**
     * A field with REPEATED RANKS, so the `index` tie-break is what decides
     * the leaf positions. Three entries are unpublished, which scores them
     * as all losses under the published rule — they tie with each other at
     * the bottom, exactly as a real settled pool with lost ciphertexts does.
     */
    function tiedFixture() {
      const { bundle, chain } = fixture();
      for (const i of [40, 12, 55]) {
        bundle.entries[i].battles = null;
        bundle.entries[i].salt = null;
        bundle.entries[i].status = 'missing_ciphertext';
      }
      const rest = fixtureMissing(bundle);
      chain.resultsRootHex = rest.root;
      chain.committedPayouts = rest.committed;
      chain.payouts = rest.payouts;
      return { bundle, chain };
    }

    it('is rankOrder`s order, on a field where the tie-break decides', () => {
      const { bundle, chain } = tiedFixture();
      const results = bundle.results.map((r) => ({
        index: r.index,
        rank: r.rank,
        scoreHalf: r.score_half,
        zones: r.zones,
        amountLamports: BigInt(r.amount_lamports),
      }));
      // The field really does contain repeated ranks, or the tie-break is
      // untested and everything below is about nothing.
      const ranks = results.map((r) => r.rank);
      expect(new Set(ranks).size, 'the fixture must contain a tie').toBeLessThan(ranks.length);
      // The published sequence IS the owner's answer for the same rows.
      expect(results.map((r) => r.index)).toEqual(rankOrder(results));
      // And the page agrees with the chain on the root built from it.
      const report = verifyPool(bundle, chain);
      expect(report.checks.find((c) => c.name === 'results-root')!.ok).toBe(true);
    });

    it('turns results-root red against a root built in any other order', () => {
      // The page re-derives the order itself; it does not take the bundle's
      // published sequence on trust (swapping two rows of `bundle.results`
      // changes nothing here, and that is the right behaviour). So the order
      // it uses is pinned from the other side: a root committed over the
      // SAME rows in a different leaf order must not verify.
      const { bundle, chain } = tiedFixture();
      const tied = bundle.results.filter((r) => r.rank === bundle.results[63].rank);
      expect(tied.length, 'the bottom of this field is a tie group').toBeGreaterThan(1);
      const swappedOrder = [...bundle.results];
      const last = swappedOrder.length - 1;
      [swappedOrder[last], swappedOrder[last - 1]] = [swappedOrder[last - 1], swappedOrder[last]];
      chain.resultsRootHex = hex(
        merkleRoot(
          swappedOrder.map((r) =>
            leafBytes({
              player: base58Decode(r.player),
              rank: r.rank,
              amountLamports: BigInt(r.amount_lamports),
            })
          )
        )
      );
      const report = verifyPool(bundle, chain);
      expect(report.checks.find((c) => c.name === 'results-root')!.ok).toBe(false);
    });
  });

  describe('entries that cannot be checked (D-10)', () => {
    const unpublish = (bundle: PublishedBundle, index: number, status: string) => {
      bundle.entries[index].battles = null;
      bundle.entries[index].salt = null;
      bundle.entries[index].status = status;
    };

    it('a pool where NOTHING was scored is not green', () => {
      const { bundle, chain } = fixture();
      for (let i = 0; i < bundle.entries.length; i++) unpublish(bundle, i, 'missing_ciphertext');
      // Rescore the way an operator publishing this would: everyone all
      // losses, everyone tied, so the rest of the bundle agrees with itself.
      const rest = fixtureMissing(bundle);
      chain.resultsRootHex = rest.root;
      chain.committedPayouts = rest.committed;
      chain.payouts = rest.payouts;
      const report = verifyPool(bundle, chain);
      // The finding, in one line: this used to be `true`.
      expect(report.ok).toBe(false);
      expect(report.verdict).toBe('incomplete');
      const row = report.checks.find((c) => c.name === 'entry-commitments')!;
      expect(row.status).toBe('incomplete');
      expect(row.detail).toContain('0 of 64');
      expect(row.detail).toContain('CANNOT be checked');
    });

    it('one lost entry is reported, named and counted — not silently passed', () => {
      const { bundle, chain } = fixture();
      const lost = bundle.entries[9].player;
      unpublish(bundle, 9, 'decrypt_failed');
      const rest = fixtureMissing(bundle);
      chain.resultsRootHex = rest.root;
      chain.committedPayouts = rest.committed;
      chain.payouts = rest.payouts;
      const report = verifyPool(bundle, chain);
      expect(report.verdict).toBe('incomplete');
      const row = report.checks.find((c) => c.name === 'entry-commitments')!;
      expect(row.status).toBe('incomplete');
      expect(row.detail).toContain('63 of 64');
      expect(row.detail).toContain(`${lost.slice(0, 4)}…${lost.slice(-4)}`);
      // Everything that COULD be checked still was, and still agrees.
      for (const c of report.checks) {
        if (c.name !== 'entry-commitments') expect(c.status, c.name).toBe('pass');
      }
    });

    it('an entry that claims status ok while carrying no battles is a MISMATCH', () => {
      const { bundle, chain } = fixture();
      // Self-contradictory: the bundle says this entry was decrypted and
      // verified, and then publishes nothing to check that against.
      unpublish(bundle, 3, 'ok');
      const report = verifyPool(bundle, chain);
      expect(report.verdict).toBe('mismatch');
      expect(report.checks.find((c) => c.name === 'entry-commitments')!.status).toBe('fail');
    });
  });

  /*
   * D-29 (audit 2026-09-11): a pool between `commit_results` and
   * `pay_prizes` has committed everything and paid nothing, which is an
   * ordinary stage of settlement. The page rendered the full red "the
   * published data does not reproduce the on-chain result" for it.
   */
  describe('a committed-but-unpaid pool (D-29)', () => {
    it('is incomplete, not a mismatch', () => {
      const { bundle, chain } = fixture();
      chain.payouts = [];
      const report = verifyPool(bundle, chain);
      expect(report.verdict).toBe('incomplete');
      expect(report.ok).toBe(false);
      const row = report.checks.find((c) => c.name === 'payouts')!;
      expect(row.status).toBe('incomplete');
      expect(row.ok).toBe(true); // not red — nothing disagreed
      expect(row.detail).toContain('no prize has been paid yet');
      // Every check that CAN be made at this stage still was.
      for (const c of report.checks) {
        if (c.name !== 'payouts') expect(c.status, c.name).toBe('pass');
      }
    });

    it('a partly settled split is incomplete and says how far it got', () => {
      const { bundle, chain } = fixture();
      if (chain.payouts.length > 1) {
        chain.payouts = chain.payouts.slice(0, 1);
        const row = verifyPool(bundle, chain).checks.find((c) => c.name === 'payouts')!;
        expect(row.status).toBe('incomplete');
        expect(row.detail).toContain('are settled');
      }
    });

    it('a WRONG payout is still red, however few have settled', () => {
      const { bundle, chain } = fixture();
      chain.payouts[0].amount = (BigInt(chain.payouts[0].amount) + 1n).toString();
      const report = verifyPool(bundle, chain);
      expect(report.verdict).toBe('mismatch');
      expect(report.checks.find((c) => c.name === 'payouts')!.status).toBe('fail');
    });
  });

  /*
   * The roster (audit 2026-09-11, F-03). A bundle that drops the
   * highest-seated entrant keeps contiguous indices and is consistent with
   * itself on every other row — the field is simply one player short, and
   * that player is scored out of existence. The chain's roster is the set
   * that catches it.
   */
  describe('the roster', () => {
    it('a bundle missing the last entrant is red on roster and — the point — green elsewhere', () => {
      const { bundle, chain } = fixture();
      const dropped = bundle.entries[bundle.entries.length - 1].player;
      bundle.entries.pop();
      // Recomputed over the short field, the way a dishonest operator would
      // publish it: the results, payouts and root all agree with each other.
      const rest = fixture63(bundle);
      chain.resultsRootHex = rest.root;
      chain.committedPayouts = rest.committed;
      chain.payouts = rest.payouts;
      const report = verifyPool(bundle, chain);
      expect(report.ok).toBe(false);
      const roster = report.checks.find((c) => c.name === 'roster')!;
      expect(roster.ok).toBe(false);
      expect(roster.detail).toContain('63 entrants');
      expect(roster.detail).toContain('64');
      expect(roster.detail).toContain(`${dropped.slice(0, 4)}…${dropped.slice(-4)}`);
      // Every other row would have passed. That is the finding.
      for (const c of report.checks) {
        if (c.name !== 'roster') expect(c.ok, c.name).toBe(true);
      }
    });

    it('a wallet in the bundle that never registered is red on roster', () => {
      const { bundle, chain } = fixture();
      bundle.entries[10].player = base58Encode(sha('an-impostor'));
      const report = verifyPool(bundle, chain);
      const roster = report.checks.find((c) => c.name === 'roster')!;
      expect(roster.ok).toBe(false);
      expect(roster.detail).toContain('never registered');
      expect(roster.detail).toContain('missing from the bundle');
    });

    it('a wallet listed twice is red on roster', () => {
      const { bundle, chain } = fixture();
      bundle.entries[3].player = bundle.entries[4].player;
      const report = verifyPool(bundle, chain);
      const roster = report.checks.find((c) => c.name === 'roster')!;
      expect(roster.ok).toBe(false);
      expect(roster.detail).toContain('listed twice');
    });

    it('indices that are not a permutation stop the report at the roster row instead of throwing', () => {
      const { bundle, chain } = fixture();
      bundle.entries[7].index = 7_000;
      const report = verifyPool(bundle, chain);
      expect(report.ok).toBe(false);
      expect(report.checks).toHaveLength(1);
      expect(report.checks[0].name).toBe('roster');
      expect(report.checks[0].detail).toContain('indices');
    });
  });
});

/**
 * The operator's arithmetic for a bundle with UNPUBLISHED entries: rescore
 * with the published lost-ciphertext rule, rebuild the root and the payout
 * list, and write them back — so the bundle is internally consistent and
 * only the entry-commitments row can say that nothing was checked (D-10).
 */
function fixtureMissing(bundle: PublishedBundle): {
  root: string;
  committed: OnChainRecord['committedPayouts'];
  payouts: OnChainRecord['payouts'];
} {
  const byIndex = [...bundle.entries].sort((a, b) => a.index - b.index);
  const results = assignPrizes(
    scoreWithMissing(
      byIndex.map((e) => ({
        index: e.index,
        battles: e.battles !== null ? decodeBattleSet(Buffer.from(e.battles, 'hex')) : null,
      }))
    ),
    potForTier(0)
  );
  const byRank = [...results].sort((a, b) => a.rank - b.rank || a.index - b.index);
  const root = hex(
    merkleRoot(
      byRank.map((r) =>
        leafBytes({
          player: base58Decode(byIndex[r.index].player),
          rank: r.rank,
          amountLamports: r.amountLamports,
        })
      )
    )
  );
  const paid = results.filter((r) => r.amountLamports > 0n).sort((a, b) => a.index - b.index);
  bundle.results = byRank.map((r) => ({
    index: r.index,
    player: byIndex[r.index].player,
    score_half: r.scoreHalf,
    zones: r.zones,
    rank: r.rank,
    amount_lamports: r.amountLamports.toString(),
  }));
  bundle.payouts = paid.map((r) => ({
    entry_index: r.index,
    player: byIndex[r.index].player,
    amount_lamports: r.amountLamports.toString(),
  }));
  bundle.results_root = root;
  return {
    root,
    committed: paid.map((r) => ({ entryIndex: r.index, amount: r.amountLamports.toString() })),
    payouts: paid.map((r) => ({
      player: byIndex[r.index].player,
      entryIndex: r.index,
      amount: r.amountLamports.toString(),
    })),
  };
}

/** The dishonest operator's arithmetic: results, payouts and root recomputed
 * over whatever field the bundle now carries, so that only the roster can
 * tell. */
function fixture63(bundle: PublishedBundle): {
  root: string;
  committed: OnChainRecord['committedPayouts'];
  payouts: OnChainRecord['payouts'];
} {
  const byIndex = [...bundle.entries].sort((a, b) => a.index - b.index);
  const battles = byIndex.map((e) => decodeBattleSet(Buffer.from(e.battles!, 'hex')));
  const results = assignPrizes(scorePool(battles), potForTier(0));
  const byRank = [...results].sort((a, b) => a.rank - b.rank || a.index - b.index);
  const root = hex(
    merkleRoot(
      byRank.map((r) =>
        leafBytes({
          player: base58Decode(byIndex[r.index].player),
          rank: r.rank,
          amountLamports: r.amountLamports,
        })
      )
    )
  );
  const paid = results.filter((r) => r.amountLamports > 0n).sort((a, b) => a.index - b.index);
  bundle.results = byRank.map((r) => ({
    index: r.index,
    player: byIndex[r.index].player,
    score_half: r.scoreHalf,
    zones: r.zones,
    rank: r.rank,
    amount_lamports: r.amountLamports.toString(),
  }));
  bundle.payouts = paid.map((r) => ({
    entry_index: r.index,
    player: byIndex[r.index].player,
    amount_lamports: r.amountLamports.toString(),
  }));
  bundle.results_root = root;
  return {
    root,
    committed: paid.map((r) => ({ entryIndex: r.index, amount: r.amountLamports.toString() })),
    payouts: paid.map((r) => ({
      player: byIndex[r.index].player,
      entryIndex: r.index,
      amount: r.amountLamports.toString(),
    })),
  };
}
