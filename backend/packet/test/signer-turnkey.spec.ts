/**
 * C11: TurnkeyPacketSigner over a fake raw signer. The r‖s assembly is
 * checked against a REAL Ed25519 signature: the fake signs with tweetnacl
 * and answers in Turnkey's r/s-hex shape, so the assembled 64 bytes must
 * verify against the configured public key — the adapter cannot reorder
 * or truncate without this failing.
 */
import { expect } from 'chai';
import nacl from 'tweetnacl';
import { TurnkeyPacketSigner, type TurnkeyRawSigner } from '../src';

const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const fake: TurnkeyRawSigner & { calls: unknown[] } = {
  calls: [],
  async signRawPayload(input) {
    this.calls.push(input);
    const message = new Uint8Array(Buffer.from(input.payload, 'hex'));
    const sig = nacl.sign.detached(message, kp.secretKey);
    return { r: hex(sig.slice(0, 32)), s: hex(sig.slice(32)) };
  },
};

describe('TurnkeyPacketSigner (C11)', () => {
  const signer = new TurnkeyPacketSigner({
    client: fake,
    organizationId: 'org',
    signWith: 'key-id',
    publicKeyHex: hex(kp.publicKey),
  });

  it('signs with the exact Turnkey activity shape and assembles r‖s correctly', async () => {
    const message = new Uint8Array(85).map((_, i) => i);
    const signature = await signer.sign(message);
    expect(signature.length).to.equal(64);
    // The assembled signature verifies against the configured key.
    expect(nacl.sign.detached.verify(message, signature, kp.publicKey)).to.equal(true);
    const call = fake.calls[0] as Record<string, string>;
    expect(call.encoding).to.equal('PAYLOAD_ENCODING_HEXADECIMAL');
    expect(call.hashFunction).to.equal('HASH_FUNCTION_NOT_APPLICABLE');
    expect(call.signWith).to.equal('key-id');
    expect(call.payload).to.equal(hex(message));
  });

  it('publicKey() answers the configured key; malformed config refuses', async () => {
    expect(hex(await signer.publicKey())).to.equal(hex(kp.publicKey));
    expect(
      () =>
        new TurnkeyPacketSigner({
          client: fake,
          organizationId: 'org',
          signWith: 'k',
          publicKeyHex: 'abcd',
        })
    ).to.throw(/32 bytes/);
  });

  it('refuses a malformed r/s answer instead of emitting a short signature', async () => {
    const bad = new TurnkeyPacketSigner({
      client: {
        async signRawPayload() {
          return { r: 'ab', s: 'cd' };
        },
      },
      organizationId: 'org',
      signWith: 'k',
      publicKeyHex: hex(kp.publicKey),
    });
    try {
      await bad.sign(new Uint8Array(10));
      expect.fail('short r/s must throw');
    } catch (e) {
      expect(String(e)).to.contain('expected 32/32');
    }
  });
});
