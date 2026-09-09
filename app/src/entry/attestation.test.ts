/* D-B4 clickwrap client specs: message parity with the service, fail-closed
 * submission, and the version-keyed device cache. */
import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { attestationMessage as serviceMessage } from '@blotto/packet/attestations';
import {
  TERMS,
  TERMS_VERSION,
  attestationMessage,
  hasLocalAttestation,
  rememberLocalAttestation,
  submitAttestation,
} from './attestation';

const WALLET = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';

// Node has no localStorage; the module treats its absence as "not cached"
// (fail-closed). A Map-backed shim lets the cache behaviour be asserted.
const shim = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => shim.get(k) ?? null,
  setItem: (k: string, v: string) => void shim.set(k, v),
};

const T1 = { version: 1, updated: '2026-08-27' };
const T2 = { version: 2, updated: '2026-09-06' };
const T3 = { version: 3, updated: '2026-10-01' };

describe('the attestation message', () => {
  it('is byte-identical between the app and the packet service', () => {
    expect(attestationMessage(WALLET, T3)).toEqual(serviceMessage(WALLET, T3));
  });
  it('binds the wallet and the terms DATE into the signed text, and never says "version"', () => {
    const text = new TextDecoder().decode(attestationMessage(WALLET, T2));
    expect(text).toContain('18 or older');
    expect(text).toContain('terms dated 6 September 2026');
    expect(text).toContain(WALLET);
    // Founder 2026-09-09: the statement a wallet shows must not talk about
    // version numbers. The edition is bound by its date instead.
    expect(text.toLowerCase()).not.toContain('version');
    expect(text).not.toContain('v2');
  });
  it('a new edition changes the bytes even when the wording is otherwise identical', () => {
    expect(attestationMessage(WALLET, T2)).not.toEqual(attestationMessage(WALLET, T3));
  });
  it('the current edition in config carries a date the message can name', () => {
    expect(TERMS.version).toBe(TERMS_VERSION);
    expect(() => attestationMessage(WALLET, TERMS)).not.toThrow();
  });
  it('refuses a malformed date rather than signing "undefined"', () => {
    expect(() => attestationMessage(WALLET, { version: 2, updated: 'soon' })).toThrow();
  });
});

describe('submitAttestation (fail-closed)', () => {
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(5));
  const signer = {
    signMessage: async (m: Uint8Array) => nacl.sign.detached(m, kp.secretKey),
  };
  const answering = (status: number): typeof fetch =>
    (async () => ({ status, ok: status < 300, json: async () => ({}) })) as never;

  it('true only on a 204 from the entry service', async () => {
    expect(await submitAttestation('https://e', signer, WALLET, T1, answering(204))).toBe(true);
    expect(hasLocalAttestation(WALLET, 1)).toBe(true);
  });

  it('false without an API, without signMessage, on refusal, and on network failure', async () => {
    expect(await submitAttestation(undefined, signer, WALLET, T1, answering(204))).toBe(false);
    expect(await submitAttestation('https://e', {}, WALLET, T1, answering(204))).toBe(false);
    expect(await submitAttestation('https://e', signer, WALLET, T1, answering(403))).toBe(false);
    const failing: typeof fetch = (async () => {
      throw new Error('offline');
    }) as never;
    expect(await submitAttestation('https://e', signer, WALLET, T1, failing)).toBe(false);
  });

  it('the device cache is keyed by version — a bump re-prompts', () => {
    expect(hasLocalAttestation(WALLET, 999)).toBe(false);
  });

  it('a wallet that accepted version 1 is re-prompted at version 2 (the D-E2 terms bump)', () => {
    const wallet = 'Bump1111111111111111111111111111111111111111';
    rememberLocalAttestation(wallet, 1);
    expect(hasLocalAttestation(wallet, 1)).toBe(true);
    expect(hasLocalAttestation(wallet, 2)).toBe(false);
    // The gate reads the CURRENT version from config/terms.json; the record
    // written under the old version never satisfies it.
    expect(TERMS_VERSION).toBe(2);
    expect(hasLocalAttestation(wallet)).toBe(false);
  });
});
