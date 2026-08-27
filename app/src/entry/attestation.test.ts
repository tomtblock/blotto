/* D-B4 clickwrap client specs: message parity with the service, fail-closed
 * submission, and the version-keyed device cache. */
import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { attestationMessage as serviceMessage } from '../../../backend/packet/src/attestations';
import {
  attestationMessage,
  hasLocalAttestation,
  submitAttestation,
} from './attestation';

const WALLET = '4pspHqtbdgqKTvSxvKFT2ycEU28u3EWdxjmj3xsTHD3Y';

// Node has no localStorage; the module treats its absence as "not cached"
// (fail-closed). A Map-backed shim lets the cache behaviour be asserted.
const shim = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => shim.get(k) ?? null,
  setItem: (k: string, v: string) => void shim.set(k, v),
};

describe('the attestation message', () => {
  it('is byte-identical between the app and the packet service', () => {
    expect(attestationMessage(WALLET, 3)).toEqual(serviceMessage(WALLET, 3));
  });
  it('binds the wallet and the version into the signed text', () => {
    const text = new TextDecoder().decode(attestationMessage(WALLET, 2));
    expect(text).toContain('18 or older');
    expect(text).toContain('version 2');
    expect(text).toContain(WALLET);
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
    expect(await submitAttestation('https://e', signer, WALLET, 1, answering(204))).toBe(true);
    expect(hasLocalAttestation(WALLET, 1)).toBe(true);
  });

  it('false without an API, without signMessage, on refusal, and on network failure', async () => {
    expect(await submitAttestation(undefined, signer, WALLET, 1, answering(204))).toBe(false);
    expect(await submitAttestation('https://e', {}, WALLET, 1, answering(204))).toBe(false);
    expect(await submitAttestation('https://e', signer, WALLET, 1, answering(403))).toBe(false);
    const failing: typeof fetch = (async () => {
      throw new Error('offline');
    }) as never;
    expect(await submitAttestation('https://e', signer, WALLET, 1, failing)).toBe(false);
  });

  it('the device cache is keyed by version — a bump re-prompts', () => {
    expect(hasLocalAttestation(WALLET, 999)).toBe(false);
  });
});
