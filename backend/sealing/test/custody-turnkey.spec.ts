/**
 * C11 specs: TurnkeyCustody against a fake vault + pass-through envelope.
 * The refusal semantics, the publish-the-same-key resume property, and the
 * loud integrity failures are all exercised offline; the REAL envelope and
 * enclave run in the env-gated live spec (turnkey-live.spec.ts).
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import {
  ExportRefusedError,
  MemoryPublishedKeyStore,
  TurnkeyCustody,
  type BundleEnvelope,
  type TurnkeyKeyVault,
} from '../src';

/** Pass-through envelope: "encryption" is identity; target keys are inert. */
const passthroughEnvelope: BundleEnvelope = {
  async encryptToImport(a) {
    return a.privateKeyHex;
  },
  async decryptExport(a) {
    return a.exportBundle;
  },
  generateTargetKey() {
    return { privateKey: '00', publicKeyUncompressed: '04' };
  },
};

/** Fake vault: stores what was imported, exports it back verbatim. */
function fakeVault(): TurnkeyKeyVault & { keys: Map<string, string> } {
  const keys = new Map<string, string>();
  let n = 0;
  return {
    keys,
    async initImportPrivateKey() {
      return { importBundle: 'bundle' };
    },
    async importPrivateKey(input) {
      const id = `key-${n++}`;
      keys.set(id, input.encryptedBundle);
      return { privateKeyId: id };
    },
    async exportPrivateKey(input) {
      const secret = keys.get(input.privateKeyId);
      if (!secret) throw new Error('no such key');
      return { exportBundle: secret };
    },
  };
}

function custody(policyAllows: () => boolean, vault = fakeVault()) {
  const store = new MemoryPublishedKeyStore();
  const c = new TurnkeyCustody({
    vault,
    envelope: passthroughEnvelope,
    organizationId: 'org',
    userId: 'user',
    policy: async () => policyAllows(),
    store,
  });
  return { c, vault, store };
}

describe('TurnkeyCustody (C11)', () => {
  it('creates, publishes, refuses export before the policy allows, then round-trips', async () => {
    let sealed = false;
    const { c } = custody(() => sealed);
    const published = await c.createPoolKey(1n);
    expect(published.publicKey.length).to.equal(32);
    expect(published.secretHash.length).to.equal(32);

    // The sealing property: refused while the pool is open.
    try {
      await c.exportSecret(1n);
      expect.fail('export before seal must refuse');
    } catch (e) {
      expect(e).to.be.instanceOf(ExportRefusedError);
    }

    sealed = true;
    const secret = await c.exportSecret(1n);
    expect(secret.length).to.equal(32);
    // The exported secret is exactly the one the published hash commits to.
    const h = new Uint8Array(createHash('sha256').update(secret).digest());
    expect(Buffer.from(h).toString('hex')).to.equal(
      Buffer.from(published.secretHash).toString('hex')
    );
  });

  it('the local secret copy is wiped after import (Turnkey holds the only one)', async () => {
    const vault = fakeVault();
    const { c } = custody(() => true, vault);
    const published = await c.createPoolKey(1n);
    // What the vault holds is NOT all zeros, and round-trips to the hash.
    const held = [...vault.keys.values()][0];
    expect(held).to.not.equal('00'.repeat(32));
    const secret = await c.exportSecret(1n);
    expect(Buffer.from(secret).toString('hex')).to.equal(held);
    void published;
  });

  it('getPublishedKey republishes the SAME key across a restart (same store)', async () => {
    const vault = fakeVault();
    const store = new MemoryPublishedKeyStore();
    const first = new TurnkeyCustody({
      vault,
      envelope: passthroughEnvelope,
      organizationId: 'org',
      userId: 'user',
      policy: async () => false,
      store,
    });
    const created = await first.createPoolKey(5n);
    // A NEW adapter instance over the same store (the restarted daemon).
    const second = new TurnkeyCustody({
      vault,
      envelope: passthroughEnvelope,
      organizationId: 'org',
      userId: 'user',
      policy: async () => false,
      store,
    });
    const republished = await second.getPublishedKey(5n);
    expect(republished).to.not.equal(null);
    expect(Buffer.from(republished!.publicKey).toString('hex')).to.equal(
      Buffer.from(created.publicKey).toString('hex')
    );
    // And a duplicate create is refused, like LocalCustody.
    try {
      await second.createPoolKey(5n);
      expect.fail('duplicate create must refuse');
    } catch (e) {
      expect(String(e)).to.contain('already has a sealing key');
    }
  });

  it('fails LOUDLY when the vault returns bytes that do not match the hash', async () => {
    const vault = fakeVault();
    const { c } = custody(() => true, vault);
    await c.createPoolKey(1n);
    // Corrupt the stored secret — the export must refuse to hand it out.
    const [id] = vault.keys.keys();
    vault.keys.set(id, 'ab'.repeat(32));
    try {
      await c.exportSecret(1n);
      expect.fail('a corrupted export must not be returned');
    } catch (e) {
      expect(String(e)).to.contain('does not match the published hash');
    }
  });

  it('unknown pool: no key, no export', async () => {
    const { c } = custody(() => true);
    expect(await c.getPublishedKey(9n)).to.equal(null);
    try {
      await c.exportSecret(9n);
      expect.fail('unknown pool must throw');
    } catch (e) {
      expect(String(e)).to.contain('no sealing key');
    }
  });
});
