/**
 * The published reveal bundle — the verify page's input, and therefore part
 * of the player-recompute contract (tradeoff order #3). Everything needed to
 * recompute the on-chain results root from scratch is in here or on-chain:
 * the secret is ALSO on-chain (PoolSecretRevealed), the battles hashes are
 * on-chain per entry, and the root this bundle reproduces is on-chain in
 * ResultsCommitted.
 *
 * JSON with every binary field hex-encoded and every lamport amount a
 * decimal string. Stable field order is not load-bearing (the root is
 * recomputed from decoded values, never from the JSON text).
 *
 * VERSION 2 (2026-09-12, audit 2026-09-11 B-31). Version 1 entries carried
 * two more fields from the sealed payload: `timings_ms` (the seven
 * per-screen timings) and `device_hash` (the browser's device marker).
 * Version 2 carries neither, because:
 *   - the bundle is PERMANENT PUBLIC storage (an Irys transaction nobody
 *     can amend or withdraw), so anything in it is published for ever;
 *   - both fields are detection inputs (TECH-ARCH §9, R11) that no
 *     verification step needs — the verify page, the indexer archive and
 *     the read API recompute everything from battles, salts and hashes;
 *   - the device hash is STABLE ACROSS POOLS, so publishing it linked a
 *     player's entries across every pool they ever played, by anyone, for
 *     ever.
 * The detection pipeline still receives both, through the non-published
 * channel `revealEntries(...).forDetection` in `ranking.ts`, which the
 * crank hands straight to the detection hook and to nothing else.
 */

export interface RevealBundleEntry {
  player: string; // base58
  index: number;
  /** Hex, 35 bytes — null when the ciphertext was lost or failed to verify. */
  battles: string | null;
  salt: string | null; // hex 32
  battles_hash: string; // hex 32 — the on-chain commitment
  /** 'ok' | 'missing_ciphertext' | 'decrypt_failed' | 'hash_mismatch' */
  status: string;
}

export interface RevealBundleResult {
  index: number;
  player: string;
  score_half: number;
  zones: number;
  /** Competition rank (D3-B): tied players share one — 1, 2, 2, 4. */
  rank: number;
  /** The split-pot amount actually committed for this seat (0 unpaid). */
  amount_lamports: string;
}

/** One row of the on-chain committed payout list, mirrored for the page. */
export interface RevealBundlePayout {
  entry_index: number;
  player: string;
  amount_lamports: string;
}

export interface RevealBundle {
  /** 2 since 2026-09-12 (B-31) — see the header for what left with v1. */
  version: 2;
  pool_id: string;
  secret: string; // hex 32 — also on-chain
  entry_lamports: string;
  entries: RevealBundleEntry[];
  results: RevealBundleResult[];
  /**
   * The committed payout list (D3-B), seat-sorted — under D-E2 that is the
   * single paid place, or one row per member of a tie for first.
   */
  payouts: RevealBundlePayout[];
  results_root: string; // hex 32 — must equal the on-chain commitment
  /**
   * The published lost-ciphertext rule applied to this pool: entries scored
   * as all losses, listed so the entry-refund obligation (from the platform
   * treasury — an off-chain payment) is explicit and auditable.
   */
  scored_as_all_losses: string[]; // base58
}
