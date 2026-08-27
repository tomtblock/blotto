/**
 * Sealing specs (roadmap 2.3): the sealed box round-trips and rejects
 * tampering; the payload encoding is canonical; custody refuses export
 * before seal and allows it after — the sealing property as a test.
 */
import { expect } from 'chai';
import { sha256 } from '@noble/hashes/sha256';
import {
  DEVICE_HASH_BYTES,
  ExportRefusedError,
  LocalCustody,
  MemoryCiphertextStore,
  PAYLOAD_BYTES,
  decodePayload,
  encodePayload,
  generateKeypair,
  payloadBattlesHash,
  publicKeyOf,
  seal,
  sealOpen,
  type SealedPayload,
} from '../src';

const battles = Array.from({ length: 7 }, (_, k) => {
  const a = [20, 20, 20, 20, 20];
  a[k % 5] += 7;
  a[(k + 2) % 5] -= 7;
  return a;
});

function payload(): SealedPayload {
  return {
    battles: battles as never,
    salt: new Uint8Array(32).fill(9),
    timingsMs: [4200, 3100, 9800, 1500, 15000, 800, 6000],
    deviceHash: new Uint8Array(DEVICE_HASH_BYTES).fill(7),
  };
}

describe('sealed box', () => {
  it('round-trips a payload to the pool key', () => {
    const pool = generateKeypair();
    const bytes = encodePayload(payload());
    expect(bytes.length).to.equal(PAYLOAD_BYTES);
    const sealed = seal(bytes, pool.publicKey);
    const opened = sealOpen(sealed, pool);
    expect(opened).to.not.equal(null);
    expect(Buffer.from(opened!)).to.deep.equal(Buffer.from(bytes));
    const decoded = decodePayload(opened!);
    expect(decoded.battles).to.deep.equal(battles);
    expect(decoded.timingsMs).to.deep.equal(payload().timingsMs);
  });
  it('rejects a tampered ciphertext and a wrong key', () => {
    const pool = generateKeypair();
    const other = generateKeypair();
    const sealed = seal(encodePayload(payload()), pool.publicKey);
    const tampered = sealed.slice();
    tampered[tampered.length - 1] ^= 1;
    expect(sealOpen(tampered, pool)).to.equal(null);
    expect(sealOpen(sealed, other)).to.equal(null);
  });
  it('derives the public key of a secret (reveal-time sanity check)', () => {
    const pool = generateKeypair();
    expect(Buffer.from(publicKeyOf(pool.secretKey))).to.deep.equal(
      Buffer.from(pool.publicKey)
    );
  });
});

describe('payload commitment', () => {
  it('matches the scoring package battles hash', () => {
    const p = payload();
    const { battlesHash } = require('../src/scoring');
    expect(Buffer.from(payloadBattlesHash(p))).to.deep.equal(
      Buffer.from(battlesHash(p.battles, p.salt))
    );
  });
  it('rejects a payload whose battles violate the invariant', () => {
    const bad = payload();
    (bad.battles as unknown as number[][])[0] = [21, 20, 20, 20, 20];
    expect(() => encodePayload(bad)).to.throw('sum to exactly 100');
  });
});

describe('custody export policy (the sealing property)', () => {
  it('refuses export before seal, allows it after, hash matches', async () => {
    let sealedState = false;
    const custody = new LocalCustody(async () => sealedState);
    const published = await custody.createPoolKey(1n);
    expect(published.publicKey.length).to.equal(32);

    // Before seal: refused. This is the same semantics the Turnkey policy
    // enforces in production; the live-API version of this test runs in the
    // Phase 5 rehearsal.
    try {
      await custody.exportSecret(1n);
      expect.fail('export must be refused before seal');
    } catch (e) {
      expect(e).to.be.instanceOf(ExportRefusedError);
    }

    sealedState = true;
    const secret = await custody.exportSecret(1n);
    expect(Buffer.from(sha256(secret))).to.deep.equal(Buffer.from(published.secretHash));
    expect(Buffer.from(publicKeyOf(secret))).to.deep.equal(Buffer.from(published.publicKey));
  });
  it('refuses a second key for the same pool', async () => {
    const custody = new LocalCustody(async () => true);
    await custody.createPoolKey(2n);
    let threw = false;
    try {
      await custody.createPoolKey(2n);
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });
});

describe('ciphertext store', () => {
  it('stores, overwrites pre-seal, lists in order', async () => {
    const store = new MemoryCiphertextStore();
    await store.put(1n, 'alice', new Uint8Array([1]));
    await store.put(1n, 'bob', new Uint8Array([2]));
    await store.put(1n, 'alice', new Uint8Array([3])); // last write wins
    await store.put(2n, 'carol', new Uint8Array([4]));
    const rows = await store.listForPool(1n);
    expect(rows.map((r) => r.player).sort()).to.deep.equal(['alice', 'bob']);
    expect([...(await store.get(1n, 'alice'))!.ciphertext]).to.deep.equal([3]);
    expect(await store.get(1n, 'dave')).to.equal(null);
  });
});
