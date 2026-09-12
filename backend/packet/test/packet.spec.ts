/**
 * Packet service specs (roadmap 4.2's gate): allowlisted → a signed packet
 * that verifies; blocked territory / VPN / sanctions / no attestation → the
 * SAME generic rejection, indistinguishable across causes. The encoding is
 * pinned to the Python oracle (fixtures/vectors.json).
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import nacl from 'tweetnacl';
import {
  DEFAULT_TERRITORY_SCHEDULE,
  GENERIC_REJECTION,
  LocalPacketSigner,
  MemoryAttestationStore,
  ed25519InstructionData,
  encodePacket,
  issuePacket,
  type AttestationStore,
  type PacketServiceDeps,
} from '../src';
import { base58Encode } from '../src/shared';
import { ciphertextMessage } from '../src/ciphertext-message';

const vectors = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'vectors.json'), 'utf8')
);

const WALLET = base58Encode(new Uint8Array(32).fill(3));
const POOL = base58Encode(new Uint8Array(32).fill(4));

/** A store already holding WALLET's clickwrap record at `termsVersion`. */
function attested(termsVersion = 1): AttestationStore {
  const store = new MemoryAttestationStore();
  void store.put({
    wallet: WALLET,
    termsVersion,
    attested18: true,
    timestamp: 1_756_000_000n,
    walletSignature: 'dGVzdA==',
  });
  return store;
}

function deps(
  overrides: Partial<{
    country: string;
    region: string;
    vpn: boolean;
    sanctioned: boolean;
    attestations: AttestationStore;
  }> = {}
): PacketServiceDeps {
  return {
    geo: {
      async lookup() {
        return {
          country: overrides.country ?? 'GB',
          region: overrides.region,
          vpnOrProxy: overrides.vpn ?? false,
        };
      },
    },
    sanctions: {
      async isSanctioned() {
        return overrides.sanctioned ?? false;
      },
    },
    signer: new LocalPacketSigner(new Uint8Array(32).fill(7)),
    attestations: overrides.attestations ?? attested(),
    config: { territories: DEFAULT_TERRITORY_SCHEDULE, kycTier: 0, termsVersion: 1, termsUpdated: '2026-09-06' },
    now: () => 1_756_000_000n,
    nonce: () => 42n,
  };
}

const request = { wallet: WALLET, pool: POOL, ip: '203.0.113.7' };

describe('the packet encoding (pinned to the Python oracle)', () => {
  for (const c of vectors.cases) {
    it(`layout: ${c.name}`, () => {
      const bytes = encodePacket({
        wallet: c.wallet,
        pool: c.pool,
        nonce: BigInt(c.nonce),
        geoCleared: c.geo_cleared === 1,
        ageVerified: c.age_verified === 1,
        kycTier: c.kyc_tier,
        issuedAt: BigInt(c.issued_at),
        termsVersion: c.terms_version,
      });
      expect(Buffer.from(bytes).toString('hex')).to.equal(c.expected_hex);
    });
  }
});

describe('packet issuance', () => {
  it('allowlisted, clean, attested → a packet whose signature verifies', async () => {
    const res = await issuePacket(deps(), request);
    if (!res.ok) throw new Error('expected a packet');
    const message = Buffer.from(res.message, 'base64');
    const signature = Buffer.from(res.signature, 'base64');
    const publicKey = Buffer.from(res.publicKey, 'base64');
    expect(message.length).to.equal(85);
    expect(nacl.sign.detached.verify(message, signature, publicKey)).to.equal(true);
    // geo_cleared and age_verified are set; kyc tier is 0 at launch (R3).
    expect(message[72]).to.equal(1);
    expect(message[73]).to.equal(1);
    expect(message[74]).to.equal(0);
    // D-B4: the accepted terms version rides at offset 83 (u16 LE).
    expect(message[83] | (message[84] << 8)).to.equal(1);
    // The ed25519 instruction bytes are self-referential and well-formed.
    const ix = ed25519InstructionData(publicKey, signature, message);
    expect(ix[0]).to.equal(1);
    expect(ix.length).to.equal(16 + 32 + 64 + 85);
  });

  it('every failure is the SAME generic rejection', async () => {
    const results = await Promise.all([
      issuePacket(deps({ country: 'BE' }), request), // blocked territory
      issuePacket(deps({ vpn: true }), request), // VPN
      issuePacket(deps({ sanctioned: true }), request), // sanctions
      issuePacket(deps({ attestations: new MemoryAttestationStore() }), request), // no attestation
      issuePacket(deps({ attestations: attested(0) }), request), // stale terms version
      issuePacket(
        {
          ...deps(),
          geo: {
            async lookup(): Promise<never> {
              throw new Error('vendor down');
            },
          },
        },
        request
      ), // upstream failure
    ]);
    for (const r of results) {
      expect(r).to.deep.equal(GENERIC_REJECTION);
    }
    // Literally identical serialisations — nothing to fingerprint.
    const texts = results.map((r) => JSON.stringify(r));
    expect(new Set(texts).size).to.equal(1);
  });

  it('the launch policy blocks BE and AU — and only those (founder, 2026-08-28)', async () => {
    expect(DEFAULT_TERRITORY_SCHEDULE.posture).to.equal('block-list');
    expect(DEFAULT_TERRITORY_SCHEDULE.allowed).to.deep.equal([]);
    expect(DEFAULT_TERRITORY_SCHEDULE.blocked).to.deep.equal(['BE', 'AU']);
    for (const country of ['GB', 'IE', 'DE', 'US', 'FR', 'AR']) {
      const r = await issuePacket(deps({ country }), request);
      expect(r.ok, country).to.equal(true);
    }
    for (const country of ['BE', 'AU']) {
      const r = await issuePacket(deps({ country }), request);
      expect(r.ok, country).to.equal(false);
    }
  });
});

describe('the entry service routes', () => {
  const { handleEntryRoute } = require('../src/server');
  const { MemoryPoolIdResolver } = require('../src/pool-ids');
  const { MemoryCiphertextStore } = require('../../sealing/src');

  /** The pool's on-chain numeric id — the key every reader of the ciphertext
   * store uses. The route must resolve the PDA to THIS, not to anything it
   * derives locally (audit B-01). */
  const POOL_ID = 7n;

  /** A wallet that can actually sign, so the route's ownership check is
   * exercised rather than stubbed. */
  function sealer() {
    const kp = nacl.sign.keyPair();
    const wallet = base58Encode(kp.publicKey);
    return {
      wallet,
      sign(pool: string, ciphertext: Uint8Array): string {
        const msg = ciphertextMessage(pool, wallet, new Uint8Array(ciphertext));
        return Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString('base64');
      },
    };
  }
  const SEALER = sealer();
  const ATTACKER = (() => {
    const kp = nacl.sign.keyPair();
    return {
      sign(pool: string, ciphertext: Uint8Array): string {
        // Signs the VICTIM's canonical message with the attacker's key.
        const msg = ciphertextMessage(pool, SEALER.wallet, new Uint8Array(ciphertext));
        return Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString('base64');
      },
    };
  })();
  const POOL_IDS = () => {
    const r = new MemoryPoolIdResolver();
    r.set(POOL, POOL_ID);
    return r;
  };

  function serverDeps() {
    return {
      packet: deps(),
      ciphertexts: new MemoryCiphertextStore(),
      poolIds: POOL_IDS(),
      trustProxyHeader: false,
    };
  }

  it('issues a packet over POST /packet and rejects generically on block', async () => {
    const d = serverDeps();
    const ok = await handleEntryRoute(
      d,
      'POST',
      '/packet',
      { wallet: WALLET, pool: POOL },
      '203.0.113.7'
    );
    expect(ok.status).to.equal(200);
    const blocked = await handleEntryRoute(
      { ...d, packet: deps({ country: 'BE' }) },
      'POST',
      '/packet',
      { wallet: WALLET, pool: POOL },
      '203.0.113.7'
    );
    expect(blocked.status).to.equal(403);
    expect(blocked.body).to.deep.equal(GENERIC_REJECTION);
    // Malformed input: the SAME generic body.
    const malformed = await handleEntryRoute(d, 'POST', '/packet', { wallet: 'x' }, 'ip');
    expect(malformed.status).to.equal(403);
    expect(malformed.body).to.deep.equal(GENERIC_REJECTION);
  });

  it('stores a well-formed ciphertext and rejects wrong sizes', async () => {
    const d = serverDeps();
    const goodBytes = Buffer.alloc(48 + 127, 7);
    const good = goodBytes.toString('base64');
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: POOL, player: SEALER.wallet, ciphertext: good, signature: SEALER.sign(POOL, goodBytes) },
      'ip'
    );
    expect(res.status).to.equal(204);
    // Read back by the NUMERIC pool id — the key the crank and the read API
    // use. Reading back through any transform this route applied would pin
    // the defect instead of catching it.
    const stored = await d.ciphertexts.get(POOL_ID, SEALER.wallet);
    expect(stored).to.not.equal(null);
    const short = Buffer.alloc(10);
    const bad = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: POOL, player: SEALER.wallet, ciphertext: short.toString('base64'), signature: SEALER.sign(POOL, short) },
      'ip'
    );
    expect(bad.status).to.equal(400);
  });

  it('refuses a ciphertext for a pool it cannot resolve, rather than guessing a key', async () => {
    const d = serverDeps();
    const unknown = base58Encode(new Uint8Array(32).fill(9));
    const bytes = Buffer.alloc(48 + 127, 7);
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: unknown, player: SEALER.wallet, ciphertext: bytes.toString('base64'), signature: SEALER.sign(unknown, bytes) },
      'ip'
    );
    expect(res.status).to.equal(400);
    expect(await d.ciphertexts.listForPool(POOL_ID)).to.have.length(0);
  });

  it('refuses a sealed allocation signed by anyone other than the player (audit B-02)', async () => {
    const d = serverDeps();
    const bytes = Buffer.alloc(48 + 127, 7);
    // The attacker signs with their OWN key and names the victim as player.
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      {
        pool: POOL,
        player: SEALER.wallet,
        ciphertext: bytes.toString('base64'),
        signature: ATTACKER.sign(POOL, bytes),
      },
      'ip'
    );
    expect(res.status).to.equal(403);
    expect(await d.ciphertexts.get(POOL_ID, SEALER.wallet)).to.equal(null);
  });

  it('refuses an unsigned sealed allocation', async () => {
    const d = serverDeps();
    const bytes = Buffer.alloc(48 + 127, 7);
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: POOL, player: SEALER.wallet, ciphertext: bytes.toString('base64') },
      'ip'
    );
    expect(res.status).to.equal(403);
  });

  it('will not silently replace an allocation a seat already holds, and stays idempotent', async () => {
    const d = serverDeps();
    const first = Buffer.alloc(48 + 127, 7);
    const again = Buffer.alloc(48 + 127, 9);
    const post = (b: Buffer) =>
      handleEntryRoute(
        d,
        'POST',
        '/ciphertexts',
        { pool: POOL, player: SEALER.wallet, ciphertext: b.toString('base64'), signature: SEALER.sign(POOL, b) },
        'ip'
      );
    expect((await post(first)).status).to.equal(204);
    // The same bytes again is an ordinary retry.
    expect((await post(first)).status).to.equal(204);
    // Different bytes would destroy the entry the chain already committed to.
    expect((await post(again)).status).to.equal(409);
    const stored = await d.ciphertexts.get(POOL_ID, SEALER.wallet);
    expect(Buffer.from(stored!.ciphertext).equals(first)).to.equal(true);
  });

  it('refuses a sealed allocation once the pool has stopped accepting entries', async () => {
    const d = serverDeps();
    d.poolIds.set(POOL, POOL_ID, 'Sealed');
    const bytes = Buffer.alloc(48 + 127, 7);
    const res = await handleEntryRoute(
      d,
      'POST',
      '/ciphertexts',
      { pool: POOL, player: SEALER.wallet, ciphertext: bytes.toString('base64'), signature: SEALER.sign(POOL, bytes) },
      'ip'
    );
    expect(res.status).to.equal(409);
  });
});
