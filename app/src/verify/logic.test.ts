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
  encodeBattleSet,
  potForTier,
  scorePool,
  leafBytes,
  merkleRoot,
  type BattleSet,
} from '../../../backend/scoring/src';
import { base58Encode, base58Decode } from '../../../backend/_shared/src/blotto-events';

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
    expect(report.checks.map((c) => `${c.name}:${c.ok}`)).toEqual([
      'secret-commitment:true',
      'bundle-secret:true',
      'entry-commitments:true',
      'rescore:true',
      'results-root:true',
      'committed-payouts:true',
      'payouts:true',
    ]);
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
    chain.payouts[0].player = chain.payouts[1].player;
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
});
