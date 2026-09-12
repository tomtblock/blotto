/**
 * Turnkey pool-key custody (C11, R21) — the production `PoolKeyCustody`.
 *
 * WHAT TURNKEY ACTUALLY OFFERS shaped this adapter (verified against the
 * installed @turnkey/sdk-server 8.2.1 types, not recalled):
 *
 *   - Curves are ED25519 / P256 / SECP256K1 — there is NO X25519, and the
 *     on-chain `sealing_secret_hash` must exist AT `open_pool`, before any
 *     export could happen. So the X25519 keypair is generated HERE, its
 *     public half and `sha256(secret)` captured for publication, and the
 *     32-byte secret is IMPORTED into Turnkey (HPKE-encrypted to the
 *     enclave's import target key via @turnkey/crypto) and the local copy
 *     wiped. Turnkey stores it under the ED25519 curve label — a 32-byte
 *     scalar is a valid ed25519 seed; the key is NEVER used to sign, only
 *     ever exported back. PHASE-C-REVIEW: storage-label reuse; the
 *     credentialed rehearsal confirms Turnkey round-trips the bytes.
 *   - Turnkey policies gate WHO (which API key, what quorum) may run
 *     `exportPrivateKey`; they cannot read Solana state, so the WHEN — the
 *     sealing property itself — stays this adapter's `ExportPolicy`, the
 *     same chain-state check `LocalCustody` enforces. Both layers hold:
 *     an unauthorized caller is refused by Turnkey (the live test asserts
 *     that API error), an early caller by this policy.
 *
 * The published (public) halves go through a `PublishedKeyStore` so a
 * restarted daemon republishes the SAME key (custody holds the only copy
 * of the secret the on-chain hash commits to). If the store is lost in the
 * crash window before `open_pool`, a fresh key is created and the imported
 * orphan stays unreferenced in the sub-org — harmless, auditable.
 *
 * Credentials (all founder-provisioned, playbook §4): TURNKEY_API_BASE_URL,
 * TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY, TURNKEY_ORGANIZATION_ID
 * (the sub-org), TURNKEY_USER_ID. Without them the daemon runs
 * `LocalCustody` (devnet only, R21).
 */

import { createHash, randomBytes } from 'crypto';
import { generateKeypair, publicKeyOf } from './sealedbox';
import {
  ExportRefusedError,
  type ExportPolicy,
  type PoolKeyCustody,
  type PublishedPoolKey,
} from './custody';

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));

/** The narrow slice of Turnkey's api client this adapter drives — injected
 * so the refusal/round-trip specs run against a fake, and the live client
 * (`new Turnkey({...}).apiClient()`) satisfies it structurally. */
export interface TurnkeyKeyVault {
  initImportPrivateKey(input: {
    organizationId: string;
    userId: string;
  }): Promise<{ importBundle: string }>;
  importPrivateKey(input: {
    organizationId: string;
    userId: string;
    privateKeyName: string;
    encryptedBundle: string;
    curve: 'CURVE_ED25519';
    addressFormats: [];
  }): Promise<{ privateKeyId: string }>;
  exportPrivateKey(input: {
    organizationId: string;
    privateKeyId: string;
    targetPublicKey: string;
  }): Promise<{ exportBundle: string }>;
}

/** Durable record of a pool's PUBLIC half + its Turnkey key id. All public
 * data — persist anywhere (memory here; pg in deployment wiring). */
export interface StoredPublishedKey {
  publicKeyHex: string;
  secretHashHex: string;
  privateKeyId: string;
}

/**
 * Raised when a second, DIFFERENT sealing key is offered for a pool that
 * already has one (audit 2026-09-11, B-29). See `PublishedKeyStore.save`
 * for why this must be loud rather than either silently dropped or silently
 * overwritten. Its own type so a caller can tell "someone else got there
 * first" apart from a database being unreachable.
 */
export class PublishedKeyConflictError extends Error {
  constructor(
    readonly poolId: bigint,
    readonly stored: StoredPublishedKey,
    readonly offered: StoredPublishedKey
  ) {
    super(
      `pool ${poolId} already has a different sealing key: stored hash ` +
        `${stored.secretHashHex} (key ${stored.privateKeyId}), offered ` +
        `${offered.secretHashHex} (key ${offered.privateKeyId}). This pool's key was ` +
        `published by another writer; do not open the pool with the offered key.`
    );
    this.name = 'PublishedKeyConflictError';
  }
}

/** Field-by-field equality — the whole record, because every field is load-bearing. */
export function samePublishedKey(a: StoredPublishedKey, b: StoredPublishedKey): boolean {
  return (
    a.publicKeyHex === b.publicKeyHex &&
    a.secretHashHex === b.secretHashHex &&
    a.privateKeyId === b.privateKeyId
  );
}

export interface PublishedKeyStore {
  /**
   * First write wins, and a conflicting second write THROWS
   * `PublishedKeyConflictError` (audit 2026-09-11, B-29).
   *
   * THE DEFECT this contract exists to close. `createPoolKey` checks
   * `load()` and then acts, so two concurrent opens of the same pool both
   * pass the check, both mint a keypair, both import it to the enclave, and
   * both call `save`. The two implementations then disagreed and BOTH were
   * unsafe: the Postgres one had `ON CONFLICT DO NOTHING`, so the second
   * write vanished while its caller was told it succeeded; the memory one
   * overwrote, so the FIRST caller's record vanished instead. Either way one
   * caller walks away holding a secret hash the store does not have, opens
   * the pool on chain committing that hash, and custody can only ever export
   * the other key. Every entry sealed to that pool is then permanently
   * unreadable: the pool cannot be revealed, cannot be scored, and cannot
   * satisfy the commitment it made on chain.
   *
   * So `save` — not the `load` pre-check — is the concurrency barrier. The
   * loser must learn it lost BEFORE it commits its hash anywhere.
   *
   * Re-saving the SAME record is not a conflict. A retry after a transient
   * failure must be able to complete, and the record is fully determined by
   * the key it describes, so an identical write is a no-op by definition.
   */
  save(poolId: bigint, record: StoredPublishedKey): Promise<void>;
  load(poolId: bigint): Promise<StoredPublishedKey | null>;
}

export class MemoryPublishedKeyStore implements PublishedKeyStore {
  private rows = new Map<string, StoredPublishedKey>();
  async save(poolId: bigint, record: StoredPublishedKey): Promise<void> {
    const existing = this.rows.get(poolId.toString());
    if (existing) {
      // Same contract as the Postgres twin: identical is a no-op, different
      // is refused. A test double that overwrites here would prove the
      // opposite of what the deployed store does.
      if (samePublishedKey(existing, record)) return;
      throw new PublishedKeyConflictError(poolId, { ...existing }, { ...record });
    }
    this.rows.set(poolId.toString(), { ...record });
  }
  async load(poolId: bigint): Promise<StoredPublishedKey | null> {
    const r = this.rows.get(poolId.toString());
    return r ? { ...r } : null;
  }
}

/**
 * The HPKE envelope around import/export — @turnkey/crypto in production
 * (`turnkeyEnvelope()`), injected so the adapter's specs run offline (the
 * real functions verify enclave signatures no fake can produce).
 */
export interface BundleEnvelope {
  /** Encrypt a hex private key to the enclave's import bundle. */
  encryptToImport(args: {
    privateKeyHex: string;
    importBundle: string;
    userId: string;
    organizationId: string;
  }): Promise<string>;
  /** Generate the export target key and decrypt the export bundle with it. */
  decryptExport(args: {
    exportBundle: string;
    organizationId: string;
    targetPrivateKey: string;
  }): Promise<string>;
  /** Fresh P256 target keypair (hex private, uncompressed public). */
  generateTargetKey(): { privateKey: string; publicKeyUncompressed: string };
}

/** The production envelope over @turnkey/crypto (2.11.3, types verified).
 * Loaded lazily so offline suites never import the vendor package. */
export function turnkeyEnvelope(): BundleEnvelope {
  /* eslint-disable @typescript-eslint/no-var-requires */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tk = require('@turnkey/crypto') as typeof import('@turnkey/crypto');
  return {
    async encryptToImport(a) {
      return tk.encryptPrivateKeyToBundle({
        privateKey: a.privateKeyHex,
        keyFormat: 'HEXADECIMAL',
        importBundle: a.importBundle,
        userId: a.userId,
        organizationId: a.organizationId,
      });
    },
    async decryptExport(a) {
      return tk.decryptExportBundle({
        exportBundle: a.exportBundle,
        embeddedKey: a.targetPrivateKey,
        organizationId: a.organizationId,
        keyFormat: 'HEXADECIMAL',
        returnMnemonic: false,
      });
    },
    generateTargetKey() {
      const kp = tk.generateP256KeyPair();
      return { privateKey: kp.privateKey, publicKeyUncompressed: kp.publicKeyUncompressed };
    },
  };
}

export interface TurnkeyCustodyConfig {
  vault: TurnkeyKeyVault;
  envelope: BundleEnvelope;
  organizationId: string;
  userId: string;
  policy: ExportPolicy;
  store?: PublishedKeyStore;
}

export class TurnkeyCustody implements PoolKeyCustody {
  private readonly store: PublishedKeyStore;

  constructor(private readonly cfg: TurnkeyCustodyConfig) {
    this.store = cfg.store ?? new MemoryPublishedKeyStore();
  }

  /**
   * Mint, import and publish one pool's sealing key.
   *
   * The `load` check below is a courtesy, not the guard: it is a
   * check-then-act, so two concurrent calls for one pool both pass it. The
   * guard is `store.save`, which refuses a second, different key and throws
   * (audit 2026-09-11, B-29). That throw is why nothing here returns a
   * `PublishedPoolKey` whose hash the store does not hold — the caller must
   * never commit a hash on chain that custody cannot later reproduce.
   */
  async createPoolKey(poolId: bigint): Promise<PublishedPoolKey> {
    if (await this.store.load(poolId)) {
      throw new Error(`pool ${poolId} already has a sealing key`);
    }
    // The X25519 keypair exists in this process's memory ONLY between here
    // and the import below; the published hash commits to exactly it.
    const kp = generateKeypair();
    const secretHash = sha256(kp.secretKey);

    const { importBundle } = await this.cfg.vault.initImportPrivateKey({
      organizationId: this.cfg.organizationId,
      userId: this.cfg.userId,
    });
    const encryptedBundle = await this.cfg.envelope.encryptToImport({
      privateKeyHex: hex(kp.secretKey),
      importBundle,
      userId: this.cfg.userId,
      organizationId: this.cfg.organizationId,
    });
    const { privateKeyId } = await this.cfg.vault.importPrivateKey({
      organizationId: this.cfg.organizationId,
      userId: this.cfg.userId,
      // The random suffix keeps a crash-window re-create from colliding
      // with an orphaned earlier import (names are unique per org).
      privateKeyName: `pool-${poolId}-sealing-${hex(randomBytes(4))}`,
      encryptedBundle,
      curve: 'CURVE_ED25519',
      addressFormats: [],
    });
    // Wipe the local secret; Turnkey now holds the only copy.
    kp.secretKey.fill(0);

    await this.store.save(poolId, {
      publicKeyHex: hex(kp.publicKey),
      secretHashHex: hex(secretHash),
      privateKeyId,
    });
    return { poolId, publicKey: kp.publicKey, secretHash };
  }

  async getPublishedKey(poolId: bigint): Promise<PublishedPoolKey | null> {
    const r = await this.store.load(poolId);
    if (!r) return null;
    return { poolId, publicKey: unhex(r.publicKeyHex), secretHash: unhex(r.secretHashHex) };
  }

  async exportSecret(poolId: bigint): Promise<Uint8Array> {
    const record = await this.store.load(poolId);
    if (!record) throw new Error(`no sealing key for pool ${poolId}`);
    // THE sealing property: chain state says whether the pool may open its
    // secrets. Refused here before Turnkey is ever asked.
    if (!(await this.cfg.policy(poolId))) {
      throw new ExportRefusedError(poolId);
    }
    // Fresh P256 target key per export; the bundle decrypts only to it.
    const target = this.cfg.envelope.generateTargetKey();
    const { exportBundle } = await this.cfg.vault.exportPrivateKey({
      organizationId: this.cfg.organizationId,
      privateKeyId: record.privateKeyId,
      targetPublicKey: target.publicKeyUncompressed,
    });
    const secretHex = await this.cfg.envelope.decryptExport({
      exportBundle,
      organizationId: this.cfg.organizationId,
      targetPrivateKey: target.privateKey,
    });
    const secret = unhex(secretHex.replace(/^0x/, ''));
    if (secret.length !== 32) {
      throw new Error(`turnkey export returned ${secret.length} bytes, expected 32`);
    }
    // Integrity: what came back must be the secret the chain's hash
    // commits to, or the reveal would fail on-chain anyway — fail loudly
    // here instead.
    if (hex(sha256(secret)) !== record.secretHashHex) {
      throw new Error(`exported secret for pool ${poolId} does not match the published hash`);
    }
    // And it must correspond to the published PUBLIC key.
    if (hex(publicKeyOf(secret)) !== record.publicKeyHex) {
      throw new Error(`exported secret for pool ${poolId} does not derive the published key`);
    }
    return secret;
  }
}
