/**
 * The wallet blocklist (2026-09-19) — the mechanism behind the terms clause
 * "Refusing entry and withholding a prize".
 *
 * Three things are proven here, in the order they matter:
 *
 *   1. A LISTED ADDRESS IS REFUSED A PACKET, through `issuePacket` itself
 *      rather than through the decision function alone — the same standard
 *      `sanctions-wiring.spec.ts` sets, because the branch that is never
 *      exercised end to end is the branch that turns out to be unwired.
 *   2. THE REFUSAL IS THE GENERIC ONE. A blocked address must learn nothing
 *      about why, or the gate becomes an oracle for the founder's list.
 *   3. THE PARSER FAILS CLOSED. Every malformation throws, so a file that
 *      cannot be trusted stops the service instead of quietly admitting
 *      everyone on it.
 *
 * Plus the mirror pin: `DEFAULT_WALLET_BLOCKLIST` and the committed
 * `config/blocked-wallets.json` must agree, exactly as
 * `territories.spec.ts` pins the schedule.
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import nacl from 'tweetnacl';
import {
  DEFAULT_TERRITORY_SCHEDULE,
  DEFAULT_WALLET_BLOCKLIST,
  GENERIC_REJECTION,
  issuePacket,
  parseWalletBlocklist,
  walletAllowed,
  type PacketServiceDeps,
  type WalletBlocklist,
} from '../src';
import { base58Encode } from '../src/shared';

const CONFIG = join(__dirname, '..', '..', '..', 'config', 'blocked-wallets.json');

/** A well-formed base58 address, deterministic per seed. */
function address(seed: number): string {
  const bytes = new Uint8Array(32).fill(seed);
  return base58Encode(bytes);
}

const PLAYER = address(7);
const BLOCKED = address(9);
const POOL = address(11);

function deps(blockedWallets: WalletBlocklist): PacketServiceDeps {
  const signer = nacl.sign.keyPair();
  return {
    geo: { lookup: async () => ({ country: 'GB', vpnOrProxy: false }) },
    sanctions: { isSanctioned: async () => false },
    signer: {
      sign: async (m: Uint8Array) => nacl.sign.detached(m, signer.secretKey),
      publicKey: async () => signer.publicKey,
    },
    attestations: {
      get: async (wallet: string) => ({
        wallet,
        attested18: true,
        termsVersion: 1,
        signature: '',
        acceptedAt: '2026-09-19T00:00:00.000Z',
      }),
      put: async () => undefined,
    },
    config: {
      territories: DEFAULT_TERRITORY_SCHEDULE,
      blockedWallets,
      kycTier: 0,
      termsVersion: 1,
      termsUpdated: '2026-09-19',
    },
    now: () => 1_800_000_000n,
    nonce: () => 1n,
  } as unknown as PacketServiceDeps;
}

const listed: WalletBlocklist = { version: 1, wallets: [BLOCKED], updated: '2026-09-19' };

describe('the wallet blocklist refuses an entry', () => {
  it('issues a packet to an address that is not listed', async () => {
    const result = await issuePacket(deps(listed), { wallet: PLAYER, pool: POOL, ip: '1.2.3.4' });
    expect(result.ok, 'an unlisted address still enters').to.equal(true);
  });

  it('refuses a listed address', async () => {
    const result = await issuePacket(deps(listed), { wallet: BLOCKED, pool: POOL, ip: '1.2.3.4' });
    expect(result.ok).to.equal(false);
  });

  it('refuses it with the SAME generic rejection as every other check', async () => {
    // The whole point of the uniform answer: a refused address cannot tell
    // the founder's list from a blocked territory, a VPN, a sanctions match
    // or a missing attestation. If this ever differs, the gate has become a
    // list oracle.
    const blocked = await issuePacket(deps(listed), { wallet: BLOCKED, pool: POOL, ip: '1.2.3.4' });
    const territory = await issuePacket(
      {
        ...deps(listed),
        geo: { lookup: async () => ({ country: 'BE', vpnOrProxy: false }) },
      } as PacketServiceDeps,
      { wallet: PLAYER, pool: POOL, ip: '1.2.3.4' }
    );
    expect(blocked).to.deep.equal(GENERIC_REJECTION);
    expect(blocked).to.deep.equal(territory);
  });

  it('issues to everyone while the list is empty, which is how it ships', async () => {
    const result = await issuePacket(deps(DEFAULT_WALLET_BLOCKLIST), {
      wallet: BLOCKED,
      pool: POOL,
      ip: '1.2.3.4',
    });
    expect(DEFAULT_WALLET_BLOCKLIST.wallets).to.deep.equal([]);
    expect(result.ok).to.equal(true);
  });
});

describe('walletAllowed', () => {
  it('allows an unlisted address and refuses a listed one', () => {
    expect(walletAllowed(listed, PLAYER)).to.equal(true);
    expect(walletAllowed(listed, BLOCKED)).to.equal(false);
  });

  it('answers membership only — the address SHAPE is the route\'s refusal, not this one', () => {
    // `handleEntryRoute` refuses anything that is not base58 before
    // `issuePacket` is reached, with the same generic rejection. A second,
    // slightly different shape rule here would be two gates disagreeing
    // about one input; this function answers "is it on the list".
    expect(walletAllowed(listed, '')).to.equal(true);
    expect(walletAllowed(listed, undefined)).to.equal(true);
    expect(walletAllowed(listed, null)).to.equal(true);
    expect(walletAllowed(listed, 'not-base58-!!')).to.equal(true);
  });
});

describe('parseWalletBlocklist fails closed', () => {
  const good = JSON.stringify({ version: 1, wallets: [BLOCKED], updated: '2026-09-19' });

  it('parses a well-formed document', () => {
    const list = parseWalletBlocklist(good);
    expect(list.wallets).to.deep.equal([BLOCKED]);
    expect(list.version).to.equal(1);
  });

  it('accepts an empty list', () => {
    expect(
      parseWalletBlocklist(JSON.stringify({ version: 1, wallets: [], updated: '2026-09-19' }))
        .wallets
    ).to.deep.equal([]);
  });

  for (const [name, text] of [
    ['not JSON', '{'],
    ['not an object', '[]'],
    ['no version', JSON.stringify({ wallets: [], updated: '2026-09-19' })],
    ['version zero', JSON.stringify({ version: 0, wallets: [], updated: '2026-09-19' })],
    ['no updated', JSON.stringify({ version: 1, wallets: [] })],
    ['wallets not an array', JSON.stringify({ version: 1, wallets: {}, updated: '2026-09-19' })],
    ['a non-string address', JSON.stringify({ version: 1, wallets: [7], updated: '2026-09-19' })],
    [
      'an address that is not base58',
      JSON.stringify({ version: 1, wallets: ['0OIl-not-base58-not-base58-not'], updated: '2026-09-19' }),
    ],
    ['a duplicate address', JSON.stringify({ version: 1, wallets: [BLOCKED, BLOCKED], updated: '2026-09-19' })],
  ] as const) {
    it(`throws on ${name}`, () => {
      expect(() => parseWalletBlocklist(text)).to.throw();
    });
  }
});

describe('config/blocked-wallets.json', () => {
  it('parses with the real parser', () => {
    expect(() => parseWalletBlocklist(readFileSync(CONFIG, 'utf8'))).to.not.throw();
  });

  it('matches the mirror the tests and a config-less deployment use', () => {
    const committed = parseWalletBlocklist(readFileSync(CONFIG, 'utf8'));
    expect(committed.version).to.equal(DEFAULT_WALLET_BLOCKLIST.version);
    expect(committed.wallets).to.deep.equal(DEFAULT_WALLET_BLOCKLIST.wallets);
    expect(committed.updated).to.equal(DEFAULT_WALLET_BLOCKLIST.updated);
  });

  it('ships empty — the mechanism exists and nobody is on it', () => {
    expect(parseWalletBlocklist(readFileSync(CONFIG, 'utf8')).wallets).to.deep.equal([]);
  });
});
