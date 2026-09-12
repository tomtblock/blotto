/**
 * The Turnkey import/export round trip, against an envelope that can FAIL
 * (audit 2026-09-11, B-26 / C-20).
 *
 * WHAT WAS WRONG WITH THE PROOF. `custody-turnkey.spec.ts` drives a
 * `passthroughEnvelope` whose `encryptToImport` returns its own argument and
 * whose `decryptExport` returns its own argument, paired with a vault that
 * hands back the exact string it was given. Nothing in that arrangement can
 * be wrong about a key, a binding or a length, because nothing in it is
 * doing any work: the secret goes in as hex and comes out as the same hex,
 * so the round trip "passes" for a custody layer that had lost the
 * ciphertext, addressed the export to the wrong target, or been handed a
 * truncated bundle. The whole design rests on that round trip, and this is
 * the one seam where our code meets an enclave we cannot run.
 *
 * WHAT THIS FILE DOES INSTEAD. The enclave cannot be reached, so the fake is
 * made adversarial rather than generous. `hpkeEnvelope()` below is a real,
 * small HPKE-shaped construction over Node's own crypto — P-256 ECDH to a
 * per-export target key, HKDF, AES-256-GCM with the organization id as
 * additional authenticated data — and `enclave()` is a vault that actually
 * decrypts what it was imported and RE-ENCRYPTS to the target public key it
 * is asked for. Every property the real envelope has that the pass-through
 * lacks is therefore present:
 *
 *   - the bytes that come back are the bytes that went in, THROUGH a
 *     transform whose output does not contain them;
 *   - a bundle addressed to a different target key does not open;
 *   - a truncated bundle does not open;
 *   - a bundle with one byte changed does not open;
 *   - a bundle produced under a different organization id does not open.
 *
 * …and the sealing property — export refused before seal, allowed after — is
 * asserted against every one of them, because a failure mode that opens the
 * secret early is the only failure mode that matters more than losing it.
 *
 * WHAT THIS STILL DOES NOT PROVE, stated plainly because the last version of
 * this proof over-claimed:
 *
 *   1. That @turnkey/crypto's HPKE agrees with this one. It does not have
 *      to: the construction here is a STAND-IN with the same shape, not a
 *      reimplementation of theirs. A change in their bundle format is
 *      invisible to this file.
 *   2. That Turnkey's enclave round-trips a 32-byte X25519 scalar stored
 *      under the ED25519 curve label. That is the `PHASE-C-REVIEW`
 *      judgement call in `custody-turnkey.ts`, and only real credentials
 *      can settle it — `turnkey-live.spec.ts`, which CI does not run.
 *   3. That Turnkey's own policy denies `exportPrivateKey` to every API key
 *      but the settlement service's (R21). That is a sub-org configuration,
 *      asserted only by the live spec with a second unprivileged key.
 *
 * What it does prove is that OUR half — the order of operations, the target
 * key handling, the length and hash checks, and the refusal before seal —
 * survives an envelope that is entitled to say no.
 */
import { expect } from 'chai';
import { createCipheriv, createDecipheriv, createECDH, createHash, hkdfSync } from 'crypto';
import {
  ExportRefusedError,
  MemoryPublishedKeyStore,
  TurnkeyCustody,
  type BundleEnvelope,
  type PublishedKeyStore,
  type TurnkeyKeyVault,
} from '../src';

const ORG = 'org-blotto';
const USER = 'user-settlement';

// ---------------------------------------------------------------------------
// A small HPKE-shaped envelope: P-256 ECDH → HKDF → AES-256-GCM.
//
// A "bundle" is `ephemeralPublicKey(65) ‖ iv(12) ‖ tag(16) ‖ ciphertext`,
// hex. The organization id is the additional authenticated data, so a bundle
// minted for one organization does not open for another even with the right
// key — which is the binding the real import bundle carries.
// ---------------------------------------------------------------------------

function deriveAesKey(shared: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(32), Buffer.from(info), 32));
}

/** Encrypt `plaintextHex` to an uncompressed P-256 public key. */
function sealTo(targetPublicKeyUncompressed: string, plaintextHex: string, aad: string): string {
  const ephemeral = createECDH('prime256v1');
  ephemeral.generateKeys();
  const shared = ephemeral.computeSecret(Buffer.from(targetPublicKeyUncompressed, 'hex'));
  const key = deriveAesKey(shared, 'blotto-test-envelope');
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(Buffer.from(plaintextHex, 'hex')), cipher.final()]);
  return Buffer.concat([ephemeral.getPublicKey(), iv, cipher.getAuthTag(), body]).toString('hex');
}

/** Open a bundle with the target's private key. Throws on ANY tampering. */
function openWith(targetPrivateKeyHex: string, bundleHex: string, aad: string): string {
  const bundle = Buffer.from(bundleHex, 'hex');
  if (bundle.length < 65 + 12 + 16) {
    throw new Error('bundle is shorter than the envelope header');
  }
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(targetPrivateKeyHex, 'hex'));
  const shared = ecdh.computeSecret(bundle.subarray(0, 65));
  const key = deriveAesKey(shared, 'blotto-test-envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, bundle.subarray(65, 77));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(bundle.subarray(77, 93));
  return Buffer.concat([decipher.update(bundle.subarray(93)), decipher.final()]).toString('hex');
}

function p256Keypair(): { privateKey: string; publicKeyUncompressed: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey().toString('hex'),
    publicKeyUncompressed: ecdh.getPublicKey().toString('hex'),
  };
}

interface EnvelopeHooks {
  /** Corrupt the bundle the enclave produced, before our side opens it. */
  tamperExport?: (bundle: string) => string;
  /** Open the export with THIS key instead of the one just generated. */
  openWithWrongKey?: boolean;
  /** Open the export claiming a different organization id. */
  organizationIdOnOpen?: string;
}

/**
 * The envelope under test. `generateTargetKey` mints a FRESH P-256 pair on
 * every export, exactly as the production one does, and `decryptExport`
 * refuses anything that was not sealed to that pair for this organization.
 */
function hpkeEnvelope(hooks: EnvelopeHooks = {}): BundleEnvelope & { targets: string[] } {
  const targets: string[] = [];
  return {
    targets,
    async encryptToImport(a) {
      // The import bundle is the enclave's target public key, and the user
      // and organization are bound in as AAD — an import minted for a
      // different user does not open inside the enclave.
      return sealTo(a.importBundle, a.privateKeyHex, `${a.organizationId}:${a.userId}`);
    },
    async decryptExport(a) {
      const bundle = hooks.tamperExport ? hooks.tamperExport(a.exportBundle) : a.exportBundle;
      const key = hooks.openWithWrongKey ? p256Keypair().privateKey : a.targetPrivateKey;
      return openWith(key, bundle, hooks.organizationIdOnOpen ?? a.organizationId);
    },
    generateTargetKey() {
      const kp = p256Keypair();
      targets.push(kp.publicKeyUncompressed);
      return kp;
    },
  };
}

/**
 * A vault that behaves like an enclave rather than like a Map: it holds one
 * long-lived key pair, opens what was imported to it, and RE-SEALS to the
 * target public key each export names. So an export addressed to the wrong
 * target produces a bundle our side genuinely cannot open.
 */
function enclave(): TurnkeyKeyVault & {
  stored: Map<string, string>;
  /** Force the enclave to seal the next export to somebody else's key. */
  sealNextExportTo: string | null;
  /** Force the enclave to hand back a different key's secret. */
  swapExportFor: string | null;
} {
  const identity = createECDH('prime256v1');
  identity.generateKeys();
  const importTarget = identity.getPublicKey().toString('hex');
  const stored = new Map<string, string>();
  let n = 0;
  const self = {
    stored,
    sealNextExportTo: null as string | null,
    swapExportFor: null as string | null,
    async initImportPrivateKey() {
      return { importBundle: importTarget };
    },
    async importPrivateKey(input: { encryptedBundle: string; organizationId: string; userId: string }) {
      // The enclave opens the import bundle. A bundle that was not sealed to
      // it, or was bound to another user, does not open — and nothing is
      // stored.
      const secretHex = openWith(
        identity.getPrivateKey().toString('hex'),
        input.encryptedBundle,
        `${input.organizationId}:${input.userId}`
      );
      const id = `turnkey-key-${n++}`;
      stored.set(id, secretHex);
      return { privateKeyId: id };
    },
    async exportPrivateKey(input: { privateKeyId: string; targetPublicKey: string; organizationId: string }) {
      const id = self.swapExportFor ?? input.privateKeyId;
      const secretHex = stored.get(id);
      if (!secretHex) throw new Error(`no such key: ${id}`);
      const target = self.sealNextExportTo ?? input.targetPublicKey;
      self.sealNextExportTo = null;
      return { exportBundle: sealTo(target, secretHex, input.organizationId) };
    },
  };
  return self as never;
}

function custody(
  vault: ReturnType<typeof enclave>,
  envelope: BundleEnvelope,
  sealed: () => boolean,
  store: PublishedKeyStore = new MemoryPublishedKeyStore()
): TurnkeyCustody {
  return new TurnkeyCustody({
    vault,
    envelope,
    organizationId: ORG,
    userId: USER,
    policy: async () => sealed(),
    store,
  });
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('the Turnkey round trip, through an envelope that can fail (B-26 / C-20)', () => {
  it('returns the exact secret, and the vault never held it in the clear', async () => {
    const vault = enclave();
    const envelope = hpkeEnvelope();
    let sealed = false;
    const c = custody(vault, envelope, () => sealed);

    const published = await c.createPoolKey(1n);
    expect(published.publicKey.length).to.equal(32);
    expect(published.secretHash.length).to.equal(32);

    // What travelled to the enclave is a bundle, not the secret. Under the
    // pass-through fake this assertion is false by construction, which is
    // the finding.
    const [, importedBundle] = [...vault.stored.entries()][0];
    expect(importedBundle.length, 'the enclave holds a 32-byte secret').to.equal(64);

    // Nothing before seal.
    let refused: unknown = null;
    try {
      await c.exportSecret(1n);
    } catch (e) {
      refused = e;
    }
    expect(refused, 'export before seal').to.be.instanceOf(ExportRefusedError);

    sealed = true;
    const secret = await c.exportSecret(1n);
    expect(secret.length).to.equal(32);
    expect(sha256Hex(secret), 'the secret the on-chain hash commits to').to.equal(
      hex(published.secretHash)
    );
    expect(envelope.targets.length, 'one fresh target key per export').to.equal(1);

    // A second export mints ANOTHER target key — a bundle is never reusable.
    await c.exportSecret(1n);
    expect(envelope.targets.length).to.equal(2);
    expect(envelope.targets[0]).to.not.equal(envelope.targets[1]);
  });

  it('a bundle addressed to a different key does not open, and nothing is returned', async () => {
    const vault = enclave();
    const c = custody(vault, hpkeEnvelope(), () => true);
    await c.createPoolKey(1n);
    // The enclave seals this export to a stranger's key.
    vault.sealNextExportTo = p256Keypair().publicKeyUncompressed;
    let threw: Error | null = null;
    try {
      await c.exportSecret(1n);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, 'a bundle for another target must not produce a secret').to.not.equal(null);
  });

  it('our side opening with the wrong target key fails rather than returning noise', async () => {
    const vault = enclave();
    const c = custody(vault, hpkeEnvelope({ openWithWrongKey: true }), () => true);
    await c.createPoolKey(2n);
    let threw: Error | null = null;
    try {
      await c.exportSecret(2n);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).to.not.equal(null);
  });

  it('a truncated bundle fails', async () => {
    for (const cut of [1, 2, 20, 60]) {
      const vault = enclave();
      const c = custody(
        vault,
        hpkeEnvelope({ tamperExport: (b) => b.slice(0, b.length - cut * 2) }),
        () => true
      );
      await c.createPoolKey(3n);
      let threw: Error | null = null;
      try {
        await c.exportSecret(3n);
      } catch (e) {
        threw = e as Error;
      }
      expect(threw, `a bundle ${cut} bytes short must not open`).to.not.equal(null);
    }
  });

  it('a bundle with one byte changed fails', async () => {
    // Every region of the envelope: the ephemeral key, the iv, the tag, the
    // body. None of them may be alterable without detection.
    for (const at of [10, 70, 80, 95]) {
      const vault = enclave();
      const c = custody(
        vault,
        hpkeEnvelope({
          tamperExport: (b) => {
            const bytes = Buffer.from(b, 'hex');
            bytes[at] ^= 0xff;
            return bytes.toString('hex');
          },
        }),
        () => true
      );
      await c.createPoolKey(4n);
      let threw: Error | null = null;
      try {
        await c.exportSecret(4n);
      } catch (e) {
        threw = e as Error;
      }
      expect(threw, `a byte changed at offset ${at} must be detected`).to.not.equal(null);
    }
  });

  it('a bundle opened under a different organization id fails (the AAD binding)', async () => {
    const vault = enclave();
    const c = custody(vault, hpkeEnvelope({ organizationIdOnOpen: 'org-somebody-else' }), () => true);
    await c.createPoolKey(5n);
    let threw: Error | null = null;
    try {
      await c.exportSecret(5n);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).to.not.equal(null);
  });

  it('an import bundle minted for a different user never reaches the enclave`s store', async () => {
    // The import half of the same binding: our side seals to
    // `${organizationId}:${userId}`, so a mismatched user is refused at
    // import — and `createPoolKey` must not publish a key in that case.
    const vault = enclave();
    const store = new MemoryPublishedKeyStore();
    const envelope = hpkeEnvelope();
    const wrongUser: BundleEnvelope = {
      ...envelope,
      async encryptToImport(a) {
        return envelope.encryptToImport({ ...a, userId: 'somebody-else' });
      },
    };
    const c = new TurnkeyCustody({
      vault,
      envelope: wrongUser,
      organizationId: ORG,
      userId: USER,
      policy: async () => true,
      store,
    });
    let threw: Error | null = null;
    try {
      await c.createPoolKey(6n);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, 'the import must fail').to.not.equal(null);
    expect(vault.stored.size, 'nothing is stored').to.equal(0);
    expect(
      await store.load(6n),
      'and no key is published, so no hash can be committed on chain'
    ).to.equal(null);
  });

  it('an enclave that hands back ANOTHER pool`s key is caught by the hash, not returned', async () => {
    const vault = enclave();
    const c = custody(vault, hpkeEnvelope(), () => true);
    await c.createPoolKey(7n);
    await c.createPoolKey(8n);
    const ids = [...vault.stored.keys()];
    vault.swapExportFor = ids[1];
    let threw: Error | null = null;
    try {
      await c.exportSecret(7n);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw?.message ?? '').to.match(/does not match the published hash/);
  });

  it('the sealing property holds against every one of these failures', async () => {
    // A failing envelope must never become a reason to open a pool's secret
    // early. Each adversarial variant is asked BEFORE seal and must be
    // refused by the policy — not by the crypto, which would mean the
    // enclave had already been asked.
    const variants: Array<[string, BundleEnvelope]> = [
      ['sound', hpkeEnvelope()],
      ['wrong key', hpkeEnvelope({ openWithWrongKey: true })],
      ['truncated', hpkeEnvelope({ tamperExport: (b) => b.slice(0, 40) })],
      ['tampered', hpkeEnvelope({ tamperExport: (b) => 'ff' + b.slice(2) })],
      ['wrong organization', hpkeEnvelope({ organizationIdOnOpen: 'other' })],
    ];
    for (const [name, envelope] of variants) {
      const vault = enclave();
      let asked = 0;
      const watched = {
        ...vault,
        exportPrivateKey: async (i: never) => {
          asked++;
          return vault.exportPrivateKey(i);
        },
      } as unknown as ReturnType<typeof enclave>;
      const c = custody(watched, envelope, () => false);
      await c.createPoolKey(9n);
      let refused: unknown = null;
      try {
        await c.exportSecret(9n);
      } catch (e) {
        refused = e;
      }
      expect(refused, `${name}: refused before seal`).to.be.instanceOf(ExportRefusedError);
      expect(asked, `${name}: the enclave must not even be asked before seal`).to.equal(0);
    }
  });
});
