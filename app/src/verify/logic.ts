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
  assignPrizes,
  battlesHash,
  decodeBattleSet,
  leafBytes,
  merkleRoot,
} from '@blotto/scoring';
import { base58Decode } from '@blotto/shared/blotto-events';
import { scoreWithMissing } from '@blotto/reveal/missing';

/**
 * What one check can say. THREE answers, not two (audit 2026-09-11, D-10
 * and D-29) — because "this does not reproduce" and "this could not be
 * checked yet" are different statements about the operator, and a page that
 * has only green and red has to pick one of them and be wrong:
 *
 *  - `pass`       — recomputed, and it matches.
 *  - `incomplete` — nothing contradicts the chain, and this check did not
 *    verify everything it is named for. A pool whose results are committed
 *    but not yet paid (there is nothing to check against yet), and entries
 *    published without their battles (which cannot be checked against their
 *    on-chain commitment at all). NEVER a way to hide a mismatch: anything
 *    that actually disagrees is `fail`.
 *  - `fail`       — recomputed, and it does not match.
 */
export type CheckStatus = 'pass' | 'incomplete' | 'fail';

/** One named check with its outcome — the page renders these as rows. */
export interface VerifyCheck {
  name: string;
  status: CheckStatus;
  /** `false` only for a genuine mismatch — what turns a row red. */
  ok: boolean;
  detail: string;
}

/**
 * The report's own verdict, from the checks: any `fail` is a mismatch; any
 * `incomplete` without a fail is incomplete; everything else matches.
 * `ok` is reserved for a FULL match, so nothing can call a partially
 * verified pool verified.
 */
export type VerifyVerdict = 'match' | 'incomplete' | 'mismatch';

export interface VerifyReport {
  /** True only when every check passed — see `verdict` for the three-way. */
  ok: boolean;
  verdict: VerifyVerdict;
  checks: VerifyCheck[];
}

/** The on-chain record, assembled from events by the page's fetch layer. */
export interface OnChainRecord {
  /** From PoolOpened. */
  sealingSecretHashHex: string;
  entryLamports: string;
  /** From PoolOpened (D-A1 revised): the pool's FIXED pot — the amounts
   * recompute against THIS, never against arithmetic over the price. */
  potLamports: string;
  /** From PoolSecretRevealed. */
  revealedSecretHex: string;
  /** From ResultsCommitted. */
  resultsRootHex: string;
  /** From ResultsCommitted: the committed payout list, seat-sorted. */
  committedPayouts: Array<{ entryIndex: number; amount: string }>;
  /** From each EntryRegistered: player (base58) → battles_hash hex. */
  battlesHashByPlayer: Record<string, string>;
  /** From PrizesPaid batches: settled seats with the recipient wallet. */
  payouts: Array<{ player: string; entryIndex: number; amount: string }>;
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
  payouts: Array<{ entry_index: number; player: string; amount_lamports: string }>;
  results_root: string;
}

const unhex = (s: string) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** `Ab3k…9fQz` — enough of an address to find it, never the whole string
 * in a one-line detail. */
const short = (p: string) => (p.length <= 9 ? p : `${p.slice(0, 4)}…${p.slice(-4)}`);

/**
 * The roster: is the bundle's field the chain's field?
 *
 * Every other check derives its picture of the field from `bundle.entries`
 * and asks the chain about each of them; none asked the reverse question —
 * whether every wallet the chain registered appears in the bundle at all.
 * So a bundle that dropped the highest-seated entrant kept contiguous
 * indices, reproduced every commitment it did carry, rescored consistently
 * with itself, rebuilt a Merkle root over the short field and matched a
 * committed root computed the same way — green on every row, with an
 * entrant silently scored out of existence. The complete on-chain roster is
 * in hand the whole time (`battlesHashByPlayer` is built from every
 * EntryRegistered); this is the check that uses it as a set (audit
 * 2026-09-11, F-03).
 *
 * Two properties, reported as one named row so a mismatch is attributable:
 * the players are the same set (size and members, no duplicates), and the
 * indices are a permutation of 0..n-1. The second is what the later checks
 * index by; when it fails they cannot run without throwing, so the caller
 * stops there.
 */
function rosterCheck(
  bundle: PublishedBundle,
  chain: OnChainRecord
): { ok: boolean; indexable: boolean; detail: string } {
  const chainPlayers = new Set(Object.keys(chain.battlesHashByPlayer));
  const bundlePlayers = new Set<string>();
  const duplicates: string[] = [];
  for (const e of bundle.entries) {
    if (bundlePlayers.has(e.player)) duplicates.push(e.player);
    bundlePlayers.add(e.player);
  }
  const missingFromBundle = [...chainPlayers].filter((p) => !bundlePlayers.has(p));
  const unknownToChain = [...bundlePlayers].filter((p) => !chainPlayers.has(p));

  const n = chain.battlesHashByPlayer ? chainPlayers.size : 0;
  const indices = bundle.entries.map((e) => e.index).sort((a, b) => a - b);
  const indexable =
    bundle.entries.length === n && indices.every((idx, i) => idx === i);

  const problems: string[] = [];
  if (bundle.entries.length !== chainPlayers.size) {
    problems.push(`bundle lists ${bundle.entries.length} entrants, the chain registered ${chainPlayers.size}`);
  }
  if (missingFromBundle.length > 0) {
    problems.push(
      `missing from the bundle: ${missingFromBundle.slice(0, 3).map(short).join(', ')}` +
        (missingFromBundle.length > 3 ? ` and ${missingFromBundle.length - 3} more` : '')
    );
  }
  if (unknownToChain.length > 0) {
    problems.push(
      `in the bundle but never registered: ${unknownToChain.slice(0, 3).map(short).join(', ')}` +
        (unknownToChain.length > 3 ? ` and ${unknownToChain.length - 3} more` : '')
    );
  }
  if (duplicates.length > 0) {
    problems.push(`listed twice: ${duplicates.slice(0, 3).map(short).join(', ')}`);
  }
  if (!indexable && problems.length === 0) {
    problems.push(`entry indices are not a permutation of 0..${n - 1}`);
  } else if (!indexable) {
    problems.push('entry indices are not 0..n-1');
  }

  const ok = problems.length === 0;
  return {
    ok,
    indexable,
    detail: ok
      ? `the bundle's ${bundle.entries.length} entrants are exactly the wallets the chain registered, seats 0..${n - 1}`
      : problems.join('; '),
  };
}

/** Fold the rows into the report's own verdict (see `VerifyVerdict`). */
function verdictOf(checks: readonly VerifyCheck[]): VerifyVerdict {
  if (checks.some((c) => c.status === 'fail')) return 'mismatch';
  if (checks.some((c) => c.status === 'incomplete')) return 'incomplete';
  return 'match';
}

function report(checks: VerifyCheck[]): VerifyReport {
  const verdict = verdictOf(checks);
  return { ok: verdict === 'match', verdict, checks };
}

export function verifyPool(bundle: PublishedBundle, chain: OnChainRecord): VerifyReport {
  const checks: VerifyCheck[] = [];
  const push = (name: string, status: CheckStatus, detail: string) =>
    checks.push({ name, status, ok: status !== 'fail', detail });

  // 0. The field itself, before anything is computed over it.
  const roster = rosterCheck(bundle, chain);
  push('roster', roster.ok ? 'pass' : 'fail', roster.detail);
  if (!roster.indexable) {
    // Every check below indexes the bundle by seat; without a permutation
    // they would throw rather than report. The report is already red.
    return report(checks);
  }

  // 1. The revealed secret is the one committed at open, and the bundle
  //    carries that same secret.
  const secretHashOk =
    hex(sha256(unhex(chain.revealedSecretHex))) === chain.sealingSecretHashHex;
  push(
    'secret-commitment',
    secretHashOk ? 'pass' : 'fail',
    'sha256(revealed secret) equals the hash committed at open_pool'
  );
  push(
    'bundle-secret',
    bundle.secret === chain.revealedSecretHex ? 'pass' : 'fail',
    'bundle carries the on-chain secret'
  );

  /*
   * 2. Every published battle set reproduces the hash committed at entry.
   *
   * An entry published WITHOUT its battles cannot be checked against its
   * commitment at all — there is nothing to hash. Until 2026-09-11 (D-10)
   * such an entry was simply skipped and the row stayed green, so a bundle
   * that published no plaintext at all — every entry `battles: null`,
   * everyone scored as all losses, everyone tied, the pot split across the
   * whole field — verified green having checked NOTHING. An unchecked entry
   * is not a verified entry, so the unchecked ones are counted and the row
   * says so; the report's verdict follows (`incomplete`, never `match`).
   *
   * The published lost-ciphertext rule (TECH-ARCH §5) makes a missing entry
   * legitimate, which is why this is not a mismatch — but the bundle must
   * SAY so: an entry that declares `status: 'ok'` and then carries no
   * battles is self-contradictory, and that is a mismatch.
   */
  let hashesOk = true;
  let hashCount = 0;
  const unchecked: string[] = [];
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
      continue;
    }
    // Nothing to recompute. Legitimate only where the bundle declares it.
    unchecked.push(e.player);
    if (e.status === 'ok') hashesOk = false;
  }
  const checkedDetail =
    `sha256(battles ‖ salt) reproduces the on-chain battles_hash for ${hashCount} of ` +
    `${bundle.entries.length} entries`;
  push(
    'entry-commitments',
    hashesOk ? (unchecked.length === 0 ? 'pass' : 'incomplete') : 'fail',
    unchecked.length === 0
      ? checkedDetail
      : `${checkedDetail}; ${unchecked.length} published without battles and CANNOT be checked ` +
        `against the chain: ${unchecked.slice(0, 3).map(short).join(', ')}` +
        (unchecked.length > 3 ? ` and ${unchecked.length - 3} more` : '')
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
  // Amounts recomputed with the published split-pot rule (D3-B): tied
  // players share a competition rank and split the combined band prize.
  const pot = BigInt(chain.potLamports);
  const withPrizes = assignPrizes(results, pot);
  let resultsOk = true;
  for (const r of bundle.results) {
    const mine = withPrizes[r.index];
    if (
      mine.scoreHalf !== r.score_half ||
      mine.zones !== r.zones ||
      mine.rank !== r.rank ||
      mine.amountLamports.toString() !== r.amount_lamports
    ) {
      resultsOk = false;
    }
  }
  push(
    'rescore',
    resultsOk ? 'pass' : 'fail',
    'recomputed scores, zones, competition ranks and split-pot amounts equal the published results'
  );

  // 4. Rebuild the tree; compare to the ON-CHAIN root (the bundle's copy is
  //    informational). Leaf order: rank asc, entry index asc.
  const byRank = [...withPrizes].sort((a, b) => a.rank - b.rank || a.index - b.index);
  const playerAt = (index: number) => byIndex[index].player;
  const leaves = byRank.map((r) =>
    leafBytes({
      player: base58Decode(playerAt(r.index)),
      rank: r.rank,
      amountLamports: r.amountLamports,
    })
  );
  const root = hex(merkleRoot(leaves));
  push(
    'results-root',
    root === chain.resultsRootHex ? 'pass' : 'fail',
    'recomputed Merkle root equals the on-chain commitment'
  );

  // 5. The committed payout list is exactly the recomputed one: every seat
  //    with a nonzero split-pot share, seat-sorted, to the lamport. (The
  //    paid set can exceed 16 seats when a tie straddles position 16.)
  const myPayouts = withPrizes
    .filter((r) => r.amountLamports > 0n)
    .sort((a, b) => a.index - b.index)
    .map((r) => ({ entryIndex: r.index, amount: r.amountLamports.toString() }));
  push(
    'committed-payouts',
    JSON.stringify(myPayouts) === JSON.stringify(chain.committedPayouts) ? 'pass' : 'fail',
    'the committed payout list is the recomputed split-pot list, seat-sorted'
  );

  /*
   * 6. Every settled payout went to the wallet that entered that seat, at
   *    the committed amount.
   *
   * A pool that has COMMITTED its results but not yet PAID them has no
   * settled payouts to check, and that is an ordinary stage of settlement —
   * not a mismatch. Until 2026-09-11 (D-29) an empty list started this check
   * at false, so the page rendered the full red "the published data does not
   * reproduce the on-chain result" verdict at every pool between
   * `commit_results` and `pay_prizes`. It reports the real state instead.
   */
  const amountBySeat = new Map(myPayouts.map((p) => [p.entryIndex, p.amount]));
  let payoutsOk = true;
  for (const p of chain.payouts) {
    if (p.amount !== amountBySeat.get(p.entryIndex) || playerAt(p.entryIndex) !== p.player) {
      payoutsOk = false;
    }
  }
  const unpaid = myPayouts.length - chain.payouts.length;
  push(
    'payouts',
    !payoutsOk ? 'fail' : chain.payouts.length === 0 ? 'incomplete' : unpaid > 0 ? 'incomplete' : 'pass',
    !payoutsOk
      ? "a settled payout is not the committed amount to the seat's own wallet"
      : chain.payouts.length === 0
        ? `results are committed but no prize has been paid yet — ${myPayouts.length} committed ` +
          'seat(s) await settlement, and there is nothing to check against until they are paid'
        : unpaid > 0
          ? `${chain.payouts.length} of ${myPayouts.length} committed seats are settled, each the ` +
            "committed amount to the seat's own wallet; the rest are not paid yet"
          : "every settled payout is the committed amount to the seat's own wallet",
  );

  return report(checks);
}
