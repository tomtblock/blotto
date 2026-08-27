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
 */

export interface RevealBundleEntry {
  player: string; // base58
  index: number;
  /** Hex, 35 bytes — null when the ciphertext was lost or failed to verify. */
  battles: string | null;
  salt: string | null; // hex 32
  timings_ms: number[] | null;
  device_hash: string | null; // hex 32
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
  version: 1;
  pool_id: string;
  secret: string; // hex 32 — also on-chain
  entry_lamports: string;
  entries: RevealBundleEntry[];
  results: RevealBundleResult[];
  /** The committed payout list (D3-B), seat-sorted — can exceed 16 rows. */
  payouts: RevealBundlePayout[];
  results_root: string; // hex 32 — must equal the on-chain commitment
  /**
   * The published lost-ciphertext rule applied to this pool: entries scored
   * as all losses, listed so the fee-refund obligation (from the platform
   * share — an off-chain payment) is explicit and auditable.
   */
  scored_as_all_losses: string[]; // base58
}
