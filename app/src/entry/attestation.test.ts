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

  it('ok only on a 204 from the entry service', async () => {
    expect(await submitAttestation('https://e', signer, WALLET, T1, answering(204))).toEqual({
      ok: true,
    });
    expect(hasLocalAttestation(WALLET, 1)).toBe(true);
  });

  /*
   * C-13 (audit 2026-09-11). Every one of these used to be the same bare
   * `false`, and the gate rendered one sentence for all of them: "check
   * your connection and try again". Two of them cannot be fixed by trying
   * again at all, and one of them is the player saying no.
   */
  it('names WHY it failed, so the screen can say something true', async () => {
    const failing: typeof fetch = (async () => {
      throw new Error('offline');
    }) as never;
    const declining = {
      signMessage: async () => {
        throw new Error('User rejected the request');
      },
    };
    const broken = {
      signMessage: async () => {
        throw new Error('the wallet returned a malformed response');
      },
    };
    expect(await submitAttestation(undefined, signer, WALLET, T1, answering(204))).toEqual({
      ok: false,
      reason: 'not-configured',
    });
    expect(await submitAttestation('https://e', {}, WALLET, T1, answering(204))).toEqual({
      ok: false,
      reason: 'cannot-sign',
    });
    expect(await submitAttestation('https://e', signer, WALLET, T1, answering(403))).toEqual({
      ok: false,
      reason: 'refused',
    });
    expect(await submitAttestation('https://e', signer, WALLET, T1, failing)).toEqual({
      ok: false,
      reason: 'unreachable',
    });
    expect(await submitAttestation('https://e', declining, WALLET, T1, answering(204))).toEqual({
      ok: false,
      reason: 'declined',
    });
    expect(await submitAttestation('https://e', broken, WALLET, T1, answering(204))).toEqual({
      ok: false,
      reason: 'cannot-sign',
    });
  });

  it('stops waiting on a prompt that never answers, instead of hanging for ever', async () => {
    const silent = { signMessage: () => new Promise<Uint8Array>(() => {}) };
    expect(
      await submitAttestation('https://e', silent, WALLET, T1, answering(204), { timeoutMs: 5 })
    ).toEqual({ ok: false, reason: 'timed-out' });
    expect(hasLocalAttestation(WALLET, 1)).toBe(true); // unchanged by a timeout
  });

  it('can be cancelled, and says so — the gate offers a way out', async () => {
    const silent = { signMessage: () => new Promise<Uint8Array>(() => {}) };
    const controller = new AbortController();
    const pending = submitAttestation('https://e', silent, 'Cance1', T1, answering(204), {
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' });
    // Cancelling records nothing: the wallet is still unattested.
    expect(hasLocalAttestation('Cance1', 1)).toBe(false);
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
