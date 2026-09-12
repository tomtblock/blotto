/**
 * THE PUBLISHED RANKING — decrypt, score, and build the results tree.
 *
 * Extracted from `crank.ts` (Phase 2 Stage G) so there is exactly ONE
 * implementation of the ranking a pool published. Two callers need it and
 * they must never disagree:
 *
 *   - the CRANK, at settlement, which turns it into the reveal bundle, the
 *     committed payout list and the on-chain `results_root`;
 *   - the NEXT-PLACE DRIVER (`next-place.ts`), long after settlement, which
 *     needs the same leaves to prove a recipient's `(player, rank, amount)`
 *     against that same root.
 *
 * The driver could have read the published bundle back from Irys or from the
 * indexer's archive. It recomputes instead, from the pool secret and the
 * sealed ciphertexts, because that is the daemon's whole posture: read the
 * current state, recompute, do what is missing. It needs no network fetch, it
 * keeps working when the indexer is down, and it is the same path a player
 * takes on the verify page — if this ever disagreed with the published
 * bundle, the root check below would say so before a lamport moved.
 */

import {
  assignPrizes,
  base58Decode,
  battlesHash,
  decodePayload,
  leafBytes,
  merkleProof,
  merkleRoot,
  publicKeyOf,
  sealOpen,
  type BattleSet,
  type CiphertextStore,
  type PlayerResult,
  type ProofStep,
} from './deps';
import { scoreWithMissing, type PoolEntryInput } from './missing';
import type { ChainEntryView } from './chain';
import type { RevealBundleEntry } from './bundle';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Encode a battle set back to its canonical 35 bytes (local, tiny). */
export function encode35(battles: BattleSet): Uint8Array {
  const out = new Uint8Array(35);
  let o = 0;
  for (const b of battles) for (const v of b) out[o++] = v;
  return out;
}

/**
 * One entry as the DETECTION layer sees it (R11, TECH-ARCH §9): the sealed
 * payload's timings and device hash, with the battles as the real decoded
 * set. This is the channel those two fields travel on — and the only one.
 * They are NOT in `RevealBundleEntry` (bundle version 2, audit 2026-09-11
 * B-31): the bundle is permanent public storage, verification never reads
 * them, and the device hash is stable across pools. `null` when the entry
 * could not be read back (same cases as `RevealBundleEntry.status`).
 */
export interface RevealedEntryForDetection {
  player: string; // base58
  index: number;
  battles: BattleSet | null;
  timingsMs: number[] | null;
  deviceHash: string | null; // hex 32
}

/** What `revealEntries` produces: the bundle's entry rows, the detection
 * channel (never published), the scoring input, and the players whose
 * entries were scored as all losses. */
export interface RevealedEntries {
  bundleEntries: RevealBundleEntry[];
  forDetection: RevealedEntryForDetection[];
  scoringInput: PoolEntryInput[];
  allLosses: string[];
}

/**
 * Decrypt every stored ciphertext with the pool secret and verify it against
 * the on-chain `Entry.battles_hash`. The published lost-ciphertext rule
 * (TECH-ARCH §5) is applied here: a missing, undecryptable or mismatched
 * entry is scored as ALL LOSSES and named in `allLosses`, which is the
 * auditable record of the fee-refund obligation.
 *
 * `entries` must already be sorted by index — the caller reads them from
 * the chain and sorts once.
 */
export async function revealEntries(
  ciphertexts: CiphertextStore,
  poolId: bigint,
  secret: Uint8Array,
  entries: readonly ChainEntryView[],
  step: (name: string, detail?: Record<string, unknown>) => void = () => {}
): Promise<RevealedEntries> {
  const keypair = { secretKey: secret, publicKey: publicKeyOf(secret) };
  const bundleEntries: RevealBundleEntry[] = [];
  const forDetection: RevealedEntryForDetection[] = [];
  const scoringInput: PoolEntryInput[] = [];
  const allLosses: string[] = [];

  for (const e of entries) {
    const stored = await ciphertexts.get(poolId, e.player);
    let status = 'ok';
    let battles: BattleSet | null = null;
    let payloadFields: {
      salt: Uint8Array;
      timingsMs: readonly number[];
      deviceHash: Uint8Array;
    } | null = null;

    if (!stored) {
      status = 'missing_ciphertext';
    } else {
      const opened = sealOpen(stored.ciphertext, keypair);
      if (!opened) {
        status = 'decrypt_failed';
      } else {
        try {
          const payload = decodePayload(opened);
          const h = hex(battlesHash(payload.battles, payload.salt));
          if (h !== e.battlesHash) {
            status = 'hash_mismatch';
          } else {
            battles = payload.battles;
            payloadFields = payload;
          }
        } catch {
          status = 'decrypt_failed';
        }
      }
    }

    if (battles === null) {
      allLosses.push(e.player);
      step('entry:scored-all-losses', { player: e.player, status });
    }
    scoringInput.push({ index: e.index, battles });
    bundleEntries.push({
      player: e.player,
      index: e.index,
      battles: battles ? hex(encode35(battles)) : null,
      salt: payloadFields ? hex(payloadFields.salt) : null,
      battles_hash: e.battlesHash,
      status,
    });
    // The detection channel: what the payload carried FOR detection, kept
    // off the published record (B-31). Same decoded battles, no re-parse.
    forDetection.push({
      player: e.player,
      index: e.index,
      battles,
      timingsMs: payloadFields ? [...payloadFields.timingsMs] : null,
      deviceHash: payloadFields ? hex(payloadFields.deviceHash) : null,
    });
  }

  return { bundleEntries, forDetection, scoringInput, allLosses };
}

/** One row of the published ranking, in published (leaf) order. */
export interface RankingRow {
  /** Entry index (seat). */
  index: number;
  /** Base58 wallet. */
  player: string;
  /** Competition rank (D3-B): tied players share one — 1, 2, 2, 4. */
  rank: number;
  /** The split-pot amount committed for this seat; 0 for an unpaid seat. */
  amountLamports: bigint;
  scoreHalf: number;
  zones: number;
}

/**
 * The published ranking and its tree. **Leaf order is load-bearing**: rank
 * ascending then entry index ascending, exactly as `crank.ts` published it
 * and as `backend/indexer/src/archive.ts::recomputeRoot` re-derives it. A
 * proof is only valid against the root built from this order.
 */
export interface PublishedRanking {
  rows: RankingRow[];
  leaves: Uint8Array[];
  root: Uint8Array;
}

/** Sort into published order, build the leaves, build the root. */
export function buildRanking(
  scored: readonly PlayerResult[],
  playerAt: (index: number) => string
): PublishedRanking {
  const byRank = [...scored].sort((a, b) => a.rank - b.rank || a.index - b.index);
  const rows: RankingRow[] = byRank.map((r) => ({
    index: r.index,
    player: playerAt(r.index),
    rank: r.rank,
    amountLamports: r.amountLamports,
    scoreHalf: r.scoreHalf,
    zones: r.zones,
  }));
  const leaves = rows.map((r) =>
    leafBytes({
      player: base58Decode(r.player),
      rank: r.rank,
      amountLamports: r.amountLamports,
    })
  );
  return { rows, leaves, root: merkleRoot(leaves) };
}

/** The Merkle proof for one published row, by its position in leaf order. */
export function proofForRow(ranking: PublishedRanking, rowPosition: number): ProofStep[] {
  return merkleProof(ranking.leaves, rowPosition);
}

/**
 * Recompute a SETTLED pool's published ranking from the secret and the
 * sealed ciphertexts. The pot is read from chain state (D-A1 revised),
 * never derived from the entry price.
 *
 * Throws when the recomputed root does not equal the pool's committed
 * `results_root`: every proof built from this ranking would be rejected by
 * the program anyway, and a mismatch means the inputs moved under us —
 * refusing loudly beats paying against a ranking nobody published.
 */
export async function recomputeRanking(
  ciphertexts: CiphertextStore,
  poolId: bigint,
  secret: Uint8Array,
  entries: readonly ChainEntryView[],
  /**
   * The pool's own entrant count, from the Pool account. A program-account
   * scan can come back short from a lagging RPC backend, and the gapless-
   * index check further down passes whenever the missing seats are the
   * highest ones — so a short read has to be refused HERE, by the number the
   * chain itself carries, exactly as `crankPool` refuses it before commit
   * (audit 2026-09-11, B-09). Required, not optional: every caller holds the
   * Pool account already.
   */
  expectedEntrants: number,
  potLamports: bigint,
  committedRootHex: string | null
): Promise<PublishedRanking> {
  if (entries.length !== expectedEntrants) {
    throw new Error(
      `pool ${poolId} reports ${expectedEntrants} entrants but only ${entries.length} ` +
        `entry accounts were read — refusing to recompute a ranking against an incomplete field`
    );
  }
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const { scoringInput } = await revealEntries(ciphertexts, poolId, secret, sorted);
  const results = assignPrizes(scoreWithMissing(scoringInput), potLamports);
  const byIndex = new Map(sorted.map((e) => [e.index, e.player]));
  const ranking = buildRanking(results, (i) => {
    const p = byIndex.get(i);
    if (p === undefined) throw new Error(`no entry at index ${i} for pool ${poolId}`);
    return p;
  });
  if (committedRootHex !== null && hex(ranking.root) !== committedRootHex) {
    throw new Error(
      `recomputed results root ${hex(ranking.root)} does not match the committed ` +
        `${committedRootHex} for pool ${poolId} — refusing to build proofs against it`
    );
  }
  return ranking;
}
