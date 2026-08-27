/**
 * The pool-key custody seam (roadmap 2.3; TECH-ARCH §5, R21).
 *
 * THE PROPERTY: nobody — the operator included — can read a sealed battle
 * before the pool closes. The mechanism is the export policy on the pool's
 * X25519 secret: it may leave custody only once the pool is `Sealed` or past
 * its fill deadline. `CLAUDE.md` names the silent failure mode: a code path
 * that reads plaintext early defeats sealing without breaking any test that
 * doesn't check for it. So the seam makes the policy a TYPE: every
 * implementation takes an `ExportPolicy` and must refuse when it says no.
 *
 * Production custody is Turnkey (R21: a sandbox sub-org on devnet, real
 * sub-org on mainnet, "nothing is local keys for now"). The Turnkey
 * implementation needs the founder's sub-org credentials, which do not exist
 * yet — provisioning is the transition playbook's §4 and the Phase 5
 * rehearsal wires it. What exists NOW is the interface the crank codes
 * against plus `LocalCustody`, which enforces the same refusal semantics
 * in-process so every policy test runs today. PHASE-2-REVIEW: the roadmap
 * 2.3 gate "export before seal is refused by Turnkey policy (assert the API
 * error)" therefore runs in the Phase 5 rehearsal, not here — recorded in
 * the Phase 2 report.
 */

import { sha256 } from '@noble/hashes/sha256';
import { generateKeypair, type X25519Keypair } from './sealedbox';

/** What `open_pool` publishes on-chain. */
export interface PublishedPoolKey {
  poolId: bigint;
  /** X25519 public key entries seal to (`Pool.sealing_pubkey`). */
  publicKey: Uint8Array;
  /** `sha256(secret)` (`Pool.sealing_secret_hash`) — makes the reveal checkable. */
  secretHash: Uint8Array;
}

/**
 * Decides whether a pool's secret may be exported. Implementations read
 * CHAIN state (the pool is `Sealed`, or past `fill_deadline`) — never a
 * local flag someone can flip.
 */
export type ExportPolicy = (poolId: bigint) => Promise<boolean>;

/** Thrown when the policy refuses an export — the sealing property working. */
export class ExportRefusedError extends Error {
  constructor(poolId: bigint) {
    super(
      `export of pool ${poolId} secret refused: pool is not Sealed and not past its fill deadline`
    );
    this.name = 'ExportRefusedError';
  }
}

export interface PoolKeyCustody {
  /** Create the pool's keypair under the export policy; return what to publish. */
  createPoolKey(poolId: bigint): Promise<PublishedPoolKey>;
  /**
   * The PUBLIC half already created for this pool, or null. Never touches the
   * secret. Exists for the daemon's crash window between `createPoolKey` and
   * `open_pool` landing: on resume it must republish the SAME key, because
   * custody holds the only copy of the secret the published hash commits to.
   */
  getPublishedKey(poolId: bigint): Promise<PublishedPoolKey | null>;
  /**
   * Export the secret for the reveal. MUST throw `ExportRefusedError` when
   * the policy refuses. The returned bytes go straight into
   * `reveal_pool_secret` — on-chain, hence public, forever.
   */
  exportSecret(poolId: bigint): Promise<Uint8Array>;
}

/**
 * In-process custody for development and tests. Same interface, same refusal
 * semantics; secrets live in memory. NOT for production (R21) — the Turnkey
 * implementation replaces it there, and nothing else may.
 */
export class LocalCustody implements PoolKeyCustody {
  private readonly keys = new Map<string, X25519Keypair>();

  constructor(private readonly policy: ExportPolicy) {}

  async createPoolKey(poolId: bigint): Promise<PublishedPoolKey> {
    const key = poolId.toString();
    if (this.keys.has(key)) {
      throw new Error(`pool ${poolId} already has a sealing key`);
    }
    const kp = generateKeypair();
    this.keys.set(key, kp);
    return { poolId, publicKey: kp.publicKey, secretHash: sha256(kp.secretKey) };
  }

  async getPublishedKey(poolId: bigint): Promise<PublishedPoolKey | null> {
    const kp = this.keys.get(poolId.toString());
    if (!kp) return null;
    return { poolId, publicKey: kp.publicKey, secretHash: sha256(kp.secretKey) };
  }

  async exportSecret(poolId: bigint): Promise<Uint8Array> {
    const kp = this.keys.get(poolId.toString());
    if (!kp) throw new Error(`no sealing key for pool ${poolId}`);
    if (!(await this.policy(poolId))) {
      throw new ExportRefusedError(poolId);
    }
    return kp.secretKey;
  }
}
