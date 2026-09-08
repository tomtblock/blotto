/**
 * The results Merkle tree (roadmap 2.1; TECH-ARCH §6/§7 as amended by R10).
 *
 * The tree commits the pool's FULL ranking — one leaf per seat in the field,
 * 52..64 under D-E4; only its root goes on-chain
 * (`commit_results`). Since R10 removed per-payout proof verification from
 * the program (winners are committed directly — see the Phase 1 report), the
 * tree's consumer is the verify page: a player recomputes the ranking from
 * published data, rebuilds this exact tree, and compares roots. The scheme
 * is therefore defined HERE, canonically:
 *
 *   leaf bytes  = player(32) ‖ rank(u8) ‖ amount(u64 LE)
 *   leaf hash   = sha256(0x00 ‖ leaf bytes)
 *   node hash   = sha256(0x01 ‖ left ‖ right)
 *   an odd node at any level is PROMOTED unchanged (never duplicated —
 *   duplication creates ambiguous trees, the classic CVE-2012-2459 shape)
 *   leaves in rank order, rank 1 first
 *
 * The 0x00/0x01 domain separation makes a leaf unforgeable as an internal
 * node and vice versa.
 */

import { sha256 } from '@noble/hashes/sha256';

export interface ResultsLeaf {
  /** The player's 32-byte public key. */
  player: Uint8Array;
  /** 1-based rank. */
  rank: number;
  /** Prize in lamports (0 for every rank below the paid line — under D-E2, ranks 2..n). */
  amountLamports: bigint;
}

/** Canonical leaf bytes: player(32) ‖ rank(u8) ‖ amount(u64 LE). */
export function leafBytes(leaf: ResultsLeaf): Uint8Array {
  if (leaf.player.length !== 32) {
    throw new Error(`player pubkey must be 32 bytes, got ${leaf.player.length}`);
  }
  if (!Number.isInteger(leaf.rank) || leaf.rank < 1 || leaf.rank > 255) {
    throw new Error(`rank must fit a u8, got ${leaf.rank}`);
  }
  if (leaf.amountLamports < 0n || leaf.amountLamports > 0xffffffffffffffffn) {
    throw new Error(`amount must fit a u64, got ${leaf.amountLamports}`);
  }
  const out = new Uint8Array(32 + 1 + 8);
  out.set(leaf.player, 0);
  out[32] = leaf.rank;
  let a = leaf.amountLamports;
  for (let i = 0; i < 8; i++) {
    out[33 + i] = Number(a & 0xffn);
    a >>= 8n;
  }
  return out;
}

function hashLeaf(bytes: Uint8Array): Uint8Array {
  const input = new Uint8Array(1 + bytes.length);
  input[0] = 0x00;
  input.set(bytes, 1);
  return sha256(input);
}

function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  const input = new Uint8Array(1 + 64);
  input[0] = 0x01;
  input.set(left, 1);
  input.set(right, 33);
  return sha256(input);
}

/** Build the root over leaves given in rank order. */
export function merkleRoot(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) throw new Error('cannot build a tree over zero leaves');
  let level = leaves.map(hashLeaf);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(hashNode(level[i], level[i + 1]));
    }
    if (level.length % 2 === 1) next.push(level[level.length - 1]);
    level = next;
  }
  return level[0];
}

/** One step of an inclusion proof. */
export interface ProofStep {
  sibling: Uint8Array;
  /** True when the sibling is on the right of the running hash. */
  siblingOnRight: boolean;
}

/** Inclusion proof for `index` (position in the leaf list). */
export function merkleProof(leaves: readonly Uint8Array[], index: number): ProofStep[] {
  if (index < 0 || index >= leaves.length) throw new Error(`leaf index out of range: ${index}`);
  let level = leaves.map(hashLeaf);
  let i = index;
  const proof: ProofStep[] = [];
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let k = 0; k + 1 < level.length; k += 2) {
      next.push(hashNode(level[k], level[k + 1]));
    }
    const odd = level.length % 2 === 1;
    if (odd) next.push(level[level.length - 1]);
    if (odd && i === level.length - 1) {
      // Promoted — no sibling at this level.
    } else if (i % 2 === 0) {
      proof.push({ sibling: level[i + 1], siblingOnRight: true });
    } else {
      proof.push({ sibling: level[i - 1], siblingOnRight: false });
    }
    i = Math.floor(i / 2);
    level = next;
  }
  return proof;
}

/** Verify an inclusion proof against a root. */
export function verifyProof(
  leaf: Uint8Array,
  proof: readonly ProofStep[],
  root: Uint8Array
): boolean {
  let acc = hashLeaf(leaf);
  for (const step of proof) {
    acc = step.siblingOnRight ? hashNode(acc, step.sibling) : hashNode(step.sibling, acc);
  }
  if (acc.length !== root.length) return false;
  for (let i = 0; i < acc.length; i++) if (acc[i] !== root[i]) return false;
  return true;
}
