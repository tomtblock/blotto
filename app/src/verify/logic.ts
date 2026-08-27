/*
 * The verify page's core (R13, roadmap 3.6) — pure logic, wallet-free,
 * browser-ready: given the published reveal bundle and the pool's on-chain
 * record (events), recompute EVERYTHING and compare. This module imports the
 * very same scoring engine the settlement crank runs (R20: one module, two
 * runtimes) — the point of the page is that the player's machine reaches the
 * same numbers or the page turns red.
 *
 * On "decrypt in-browser" (the roadmap's phrasing): the published bundle
 * carries plaintext battles + salts, and each entry's `battles_hash`
 * committed ON-CHAIN AT ENTRY pins them — `sha256(battles ‖ salt)` either
 * reproduces the commitment or it does not. The hash check is the binding
 * proof that the published plaintext is what was sealed before close;
 * re-running the sealed-box decryption would add no integrity beyond it
 * (recorded in the Phase 3 report). The revealed secret is still checked
 * against the `sha256(secret)` committed at open.
 */

import { sha256 } from '@noble/hashes/sha256';
import {
  amountForRank,
  battlesHash,
  decodeBattleSet,
  leafBytes,
  merkleRoot,
  potLamports,
} from '../../../backend/scoring/src';
import { base58Decode } from '../../../backend/_shared/src/blotto-events';
import { scoreWithMissing } from '../../../backend/reveal/src/missing';

/** One named check with its outcome — the page renders these as rows. */
export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  checks: VerifyCheck[];
}

/** The on-chain record, assembled from events by the page's fetch layer. */
export interface OnChainRecord {
  /** From PoolOpened. */
  sealingSecretHashHex: string;
  entryLamports: string;
  /** From PoolSecretRevealed. */
  revealedSecretHex: string;
  /** From ResultsCommitted. */
  resultsRootHex: string;
  winners: string[];
  /** From each EntryRegistered: player (base58) → battles_hash hex. */
  battlesHashByPlayer: Record<string, string>;
  /** From PrizesPaid batches: rank → { player, amount }. */
  payouts: Array<{ player: string; rank: number; amount: string }>;
}

/** The published bundle (the crank's RevealBundle shape, already parsed). */
export interface PublishedBundle {
  pool_id: string;
  secret: string;
  entry_lamports: string;
  entries: Array<{
    player: string;
    index: number;
    battles: string | null;
    salt: string | null;
    battles_hash: string;
    status: string;
  }>;
  results: Array<{
    index: number;
    player: string;
    score_half: number;
    zones: number;
    rank: number;
    amount_lamports: string;
  }>;
  winners: string[];
  results_root: string;
}

const unhex = (s: string) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function verifyPool(bundle: PublishedBundle, chain: OnChainRecord): VerifyReport {
  const checks: VerifyCheck[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // 1. The revealed secret is the one committed at open, and the bundle
  //    carries that same secret.
  const secretHashOk =
    hex(sha256(unhex(chain.revealedSecretHex))) === chain.sealingSecretHashHex;
  push(
    'secret-commitment',
    secretHashOk,
    'sha256(revealed secret) equals the hash committed at open_pool'
  );
  push('bundle-secret', bundle.secret === chain.revealedSecretHex, 'bundle carries the on-chain secret');

  // 2. Every published battle set reproduces the hash committed at entry.
  let hashesOk = true;
  let hashCount = 0;
  for (const e of bundle.entries) {
    const committed = chain.battlesHashByPlayer[e.player];
    if (committed === undefined) {
      hashesOk = false;
      continue;
    }
    if (e.battles !== null && e.salt !== null) {
      hashCount++;
      const battles = decodeBattleSet(unhex(e.battles));
      const h = hex(battlesHash(battles, unhex(e.salt)));
      if (h !== committed || h !== e.battles_hash) hashesOk = false;
    }
  }
  push(
    'entry-commitments',
    hashesOk,
    `sha256(battles ‖ salt) reproduces the on-chain battles_hash for ${hashCount} published entries`
  );

  // 3. Rescore from the published plaintext (the identical-field engine,
  //    with the published all-losses rule for unpublished entries).
  const byIndex = [...bundle.entries].sort((a, b) => a.index - b.index);
  const results = scoreWithMissing(
    byIndex.map((e) => ({
      index: e.index,
      battles: e.battles !== null ? decodeBattleSet(unhex(e.battles)) : null,
    }))
  );
  let resultsOk = true;
  for (const r of bundle.results) {
    const mine = results[r.index];
    if (mine.scoreHalf !== r.score_half || mine.zones !== r.zones || mine.rank !== r.rank) {
      resultsOk = false;
    }
  }
  push('rescore', resultsOk, 'recomputed scores, zones and ranks equal the published results');

  // 4. Rebuild the tree; compare to the ON-CHAIN root (the bundle's copy is
  //    informational).
  const pot = potLamports(BigInt(chain.entryLamports));
  const byRank = [...results].sort((a, b) => a.rank - b.rank);
  const playerAt = (index: number) => byIndex[index].player;
  const leaves = byRank.map((r) =>
    leafBytes({
      player: base58Decode(playerAt(r.index)),
      rank: r.rank,
      amountLamports: amountForRank(pot, r.rank),
    })
  );
  const root = hex(merkleRoot(leaves));
  push('results-root', root === chain.resultsRootHex, 'recomputed Merkle root equals the on-chain commitment');

  // 5. Winners and paid amounts: the on-chain payouts are exactly the top 16
  //    recomputed players at exactly the band amounts.
  const myWinners = byRank.slice(0, 16).map((r) => playerAt(r.index));
  push(
    'winners',
    JSON.stringify(myWinners) === JSON.stringify(chain.winners),
    'the committed winners are the recomputed top 16, in rank order'
  );
  let payoutsOk = chain.payouts.length > 0;
  for (const p of chain.payouts) {
    const expectedAmount = amountForRank(pot, p.rank).toString();
    if (p.amount !== expectedAmount || myWinners[p.rank - 1] !== p.player) payoutsOk = false;
  }
  push('payouts', payoutsOk, 'every on-chain payout is the band amount to the recomputed winner');

  return { ok: checks.every((c) => c.ok), checks };
}
