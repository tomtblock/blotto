/*
 * The client side of the D-B4 clickwrap: build the canonical attestation
 * message (the SAME bytes the packet service verifies — one definition, in
 * backend/_shared), have the wallet sign it, POST it to the entry service,
 * and remember acceptance per (wallet, version) on this device only.
 *
 * FAIL-CLOSED like the geo gate: no entry API, no message-capable signer, a
 * refusal, or a network failure all leave the wallet unattested — the play
 * flow does not proceed. The server remains the authority at packet
 * issuance; the device cache only decides whether to SHOW the clickwrap.
 */

import { attestationMessage } from '../../../backend/_shared/src/attestation-message';
import termsConfig from '../../../config/terms.json';

export { attestationMessage };

/** The founder-owned current terms version (config/terms.json). */
export const TERMS_VERSION: number = termsConfig.version;

const cacheKey = (wallet: string, version: number) => `blotto:attested:v${version}:${wallet}`;

/** Device-cache check only — the server is the authority at issuance. */
export function hasLocalAttestation(wallet: string, version: number = TERMS_VERSION): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(cacheKey(wallet, version)) === '1';
  } catch {
    return false;
  }
}

export function rememberLocalAttestation(wallet: string, version: number = TERMS_VERSION): void {
  try {
    localStorage.setItem(cacheKey(wallet, version), '1');
  } catch {
    /* private mode: the clickwrap shows again next visit — harmless */
  }
}

export interface AttestationSigner {
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Sign and submit the clickwrap acceptance. True only when the entry
 * service stored the record (204); every other path is false.
 */
export async function submitAttestation(
  entryApiBase: string | undefined,
  signer: AttestationSigner | undefined,
  wallet: string,
  version: number = TERMS_VERSION,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (!entryApiBase || !signer?.signMessage) return false;
  try {
    const signature = await signer.signMessage(attestationMessage(wallet, version));
    const res = await fetchImpl(`${entryApiBase}/attestation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet,
        termsVersion: version,
        signature: Buffer.from(signature).toString('base64'),
      }),
    });
    if (res.status !== 204) return false;
    rememberLocalAttestation(wallet, version);
    return true;
  } catch {
    return false;
  }
}
