/**
 * Attestation clickwrap specs (D-B4): the record persists only for a
 * wallet-signed acceptance of the CURRENT terms version; issuance requires
 * it; a version bump invalidates the old record end to end.
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
  acceptAttestation,
  attestationMessage,
  issuePacket,
  loadTerms,
  loadTermsVersion,
  type PacketServiceDeps,
} from '../src';
import { base58Encode } from '../src/shared';

const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(11));
const WALLET = base58Encode(kp.publicKey);
const POOL = base58Encode(new Uint8Array(32).fill(4));

/** The pool's on-chain numeric id; the route resolves the PDA to it before
 * writing a ciphertext (audit B-01). */
const POOL_ID = 7n;
const POOL_IDS = () => {
  const { MemoryPoolIdResolver } = require('../src/pool-ids');
  const r = new MemoryPoolIdResolver();
  r.set(POOL, POOL_ID);
  return r;
};

/** Two editions of the terms, as config/terms.json would declare them. */
const TERMS = {
  1: { version: 1, updated: '2026-09-06' },
  2: { version: 2, updated: '2026-09-07' },
} as const;

function sign(wallet: string, version: 1 | 2): string {
  return Buffer.from(
    nacl.sign.detached(attestationMessage(wallet, TERMS[version]), kp.secretKey)
  ).toString('base64');
}

function deps(store: MemoryAttestationStore, termsVersion = 1): PacketServiceDeps {
  return {
    geo: { lookup: async () => ({ country: 'GB', vpnOrProxy: false }) },
    sanctions: { isSanctioned: async () => false },
    signer: new LocalPacketSigner(new Uint8Array(32).fill(7)),
    attestations: store,
    config: { territories: DEFAULT_TERRITORY_SCHEDULE, kycTier: 0, termsVersion, termsUpdated: '2026-09-06' },
    now: () => 1_756_000_000n,
    nonce: () => 42n,
  };
}

describe('config/terms.json', () => {
  const path = join(__dirname, '..', '..', '..', 'config', 'terms.json');
  it('parses and carries a positive version', () => {
    const v = loadTermsVersion(path);
    expect(v).to.be.at.least(1);
  });
  it('carries the edition date the signed statement names, and the statement never says "version"', () => {
    const terms = loadTerms(path);
    expect(terms.updated).to.match(/^\d{4}-\d{2}-\d{2}$/);
    const text = new TextDecoder().decode(attestationMessage(WALLET, terms));
    expect(text).to.contain('terms dated');
    expect(text.toLowerCase()).to.not.contain('version');
  });
});

describe('acceptAttestation', () => {
  it('stores a wallet-signed acceptance of the current version', async () => {
    const store = new MemoryAttestationStore();
    const ok = await acceptAttestation(store, TERMS[1], () => 1_756_000_000n, {
      wallet: WALLET,
      termsVersion: 1,
      signature: sign(WALLET, 1),
    });
    expect(ok).to.equal(true);
    const record = await store.get(WALLET);
    expect(record).to.not.equal(null);
    expect(record!.termsVersion).to.equal(1);
    expect(record!.attested18).to.equal(true);
    expect(record!.timestamp).to.equal(1_756_000_000n);
  });

  it('refuses a stale version, a wrong signature, and malformed inputs — storing nothing', async () => {
    const store = new MemoryAttestationStore();
    const cases = [
      { wallet: WALLET, termsVersion: 2, signature: sign(WALLET, 2) }, // not the current version
      { wallet: WALLET, termsVersion: 1, signature: sign(WALLET, 2) }, // signature over the wrong message
      { wallet: WALLET, termsVersion: 1, signature: 'AAAA' }, // not 64 bytes
      { wallet: 'not-base58!', termsVersion: 1, signature: sign(WALLET, 1) },
    ];
    for (const c of cases) {
      expect(await acceptAttestation(store, TERMS[1], () => 0n, c), JSON.stringify(c)).to.equal(false);
    }
    expect(await store.get(WALLET)).to.equal(null);
  });

  it('a signature from a DIFFERENT key than the wallet is refused', async () => {
    const store = new MemoryAttestationStore();
    const otherWallet = base58Encode(new Uint8Array(32).fill(9));
    const ok = await acceptAttestation(store, TERMS[1], () => 0n, {
      wallet: otherWallet,
      termsVersion: 1,
      signature: sign(otherWallet, 1), // signed by kp, not otherWallet's key
    });
    expect(ok).to.equal(false);
  });
});

describe('issuance ties to the attestation record', () => {
  it('no record → the one generic rejection; current record → a packet carrying the version', async () => {
    const empty = new MemoryAttestationStore();
    expect(await issuePacket(deps(empty), { wallet: WALLET, pool: POOL, ip: '1.2.3.4' })).to.deep.equal(
      GENERIC_REJECTION
    );

    await acceptAttestation(empty, TERMS[1], () => 0n, {
      wallet: WALLET,
      termsVersion: 1,
      signature: sign(WALLET, 1),
    });
    const res = await issuePacket(deps(empty), { wallet: WALLET, pool: POOL, ip: '1.2.3.4' });
    if (!res.ok) throw new Error('expected a packet');
    const message = Buffer.from(res.message, 'base64');
    expect(message[83] | (message[84] << 8)).to.equal(1);
  });

  it('a terms-version bump re-gates a previously attested wallet', async () => {
    const store = new MemoryAttestationStore();
    await acceptAttestation(store, TERMS[1], () => 0n, {
      wallet: WALLET,
      termsVersion: 1,
      signature: sign(WALLET, 1),
    });
    // The service now runs version 2: the v1 record no longer clears.
    expect(await issuePacket(deps(store, 2), { wallet: WALLET, pool: POOL, ip: '1.2.3.4' })).to.deep.equal(
      GENERIC_REJECTION
    );
    // Re-attesting at v2 restores issuance.
    await acceptAttestation(store, TERMS[2], () => 0n, {
      wallet: WALLET,
      termsVersion: 2,
      signature: sign(WALLET, 2),
    });
    const res = await issuePacket(deps(store, 2), { wallet: WALLET, pool: POOL, ip: '1.2.3.4' });
    expect(res.ok).to.equal(true);
  });
});

describe('the /attestation route', () => {
  const { handleEntryRoute } = require('../src/server');
  const { MemoryCiphertextStore } = require('../../sealing/src');

  it('stores on a valid submission (204) and refuses everything else alike (403)', async () => {
    const store = new MemoryAttestationStore();
    const d = {
      packet: deps(store),
      ciphertexts: new MemoryCiphertextStore(),
      poolIds: POOL_IDS(),
      trustProxyHeader: false,
    };
    const ok = await handleEntryRoute(
      d,
      'POST',
      '/attestation',
      { wallet: WALLET, termsVersion: 1, signature: sign(WALLET, 1) },
      '1.2.3.4'
    );
    expect(ok).to.deep.equal({ status: 204, body: null });

    const bad = await handleEntryRoute(
      d,
      'POST',
      '/attestation',
      { wallet: WALLET, termsVersion: 1, signature: sign(WALLET, 2) },
      '1.2.3.4'
    );
    expect(bad.status).to.equal(403);
    expect(bad.body).to.deep.equal({ ok: false });
  });
});
