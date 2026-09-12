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
 *
 * WHY THIS RETURNS A REASON (audit 2026-09-11, C-13). It used to return a
 * bare boolean, and the gate rendered one sentence for every false: "check
 * your connection and try again". Four of the five ways it can fail have
 * nothing to do with a connection, and one of them — a wallet that cannot
 * sign messages at all — can never be fixed by trying again, so the screen
 * sent the player round a loop with no exit. It also waited FOR EVER: the
 * wallet prompt is outside our control, and a prompt that never resolves
 * (a mobile wallet that never came back to the tab, an extension that lost
 * its window) left the button disabled and the page dead. There is now a
 * ceiling, and the caller can stop waiting.
 */

import { attestationMessage, type TermsEdition } from '@blotto/shared/attestation-message';
import termsConfig from '@config/terms.json';
import { classifySigningError } from '@/tx/errors';

export { attestationMessage, type TermsEdition };

/** The founder-owned current terms edition (config/terms.json): version + date. */
export const TERMS: TermsEdition = { version: termsConfig.version, updated: termsConfig.updated };
/** The founder-owned current terms version (config/terms.json). */
export const TERMS_VERSION: number = TERMS.version;

/**
 * How long the clickwrap waits on the wallet prompt and the POST together.
 *
 * PHASE-N-REVIEW: an architect-owned failure-mode ceiling, not a product
 * timer — it decides when a hung prompt is reported, never how long a
 * player may think. The value is the tx seam's own ceiling for waiting on
 * something outside our control (`DEFAULT_CONFIRM_TIMEOUT_MS`, 90 s) rather
 * than a new number: a person has to read the prompt and find the button,
 * so the 8 s used for our own reads would report a working wallet as
 * broken. The founder-owned per-screen and run timers are untouched by it.
 */
export const ATTESTATION_TIMEOUT_MS = 90_000;

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
 * Why the acceptance was not recorded. Each one needs a different sentence
 * and a different next step, which is the point of naming them:
 *
 *  - `not-configured` — this build has no entry service. Nothing the player
 *    can do; retrying cannot help.
 *  - `cannot-sign`    — the connected wallet has no message-signing
 *    capability. Retrying cannot help either; a different wallet can.
 *  - `declined`       — the player closed or refused the prompt. Expected,
 *    not an error; pressing again is exactly right.
 *  - `cancelled`      — the player stopped waiting (the cancel control).
 *  - `timed-out`      — the prompt or the POST exceeded the ceiling.
 *  - `refused`        — the service answered, and did not accept it.
 *  - `unreachable`    — the POST never got an answer. The ONLY one the old
 *    "check your connection" sentence was ever right about.
 */
export type AttestationFailure =
  | 'not-configured'
  | 'cannot-sign'
  | 'declined'
  | 'cancelled'
  | 'timed-out'
  | 'refused'
  | 'unreachable';

export type AttestationResult = { ok: true } | { ok: false; reason: AttestationFailure };

/**
 * What waiting on an uncancellable outside party can produce. A wallet
 * prompt cannot be withdrawn, so `timed-out` and `cancelled` mean "stopped
 * waiting", not "stopped": a late signature is simply ignored, which is
 * safe because the server is the authority at issuance and pressing again
 * costs nothing.
 */
type Deadline<T> =
  | { kind: 'value'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'timed-out' }
  | { kind: 'cancelled' };

function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<Deadline<T>> {
  return new Promise<Deadline<T>>((resolve) => {
    let settled = false;
    const finish = (result: Deadline<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ kind: 'cancelled' });
    const timer = setTimeout(() => finish({ kind: 'timed-out' }), timeoutMs);
    if (signal?.aborted) {
      finish({ kind: 'cancelled' });
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish({ kind: 'value', value }),
      (error: unknown) => finish({ kind: 'error', error })
    );
  });
}

/** The fetch's own deadline, combined with the caller's cancel where the
 * runtime can combine them (every target the app supports has
 * `AbortSignal.timeout`; `AbortSignal.any` is newer, so its absence falls
 * back to the ceiling alone rather than losing the ceiling). */
function requestSignal(timeoutMs: number, signal: AbortSignal | undefined): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  if (!signal) return deadline;
  const any = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  return any ? any([deadline, signal]) : deadline;
}

/**
 * Sign and submit the clickwrap acceptance. `{ ok: true }` only when the
 * entry service stored the record (204); every other path names its reason.
 */
export async function submitAttestation(
  entryApiBase: string | undefined,
  signer: AttestationSigner | undefined,
  wallet: string,
  terms: TermsEdition = TERMS,
  fetchImpl: typeof fetch = fetch,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<AttestationResult> {
  if (!entryApiBase) return { ok: false, reason: 'not-configured' };
  // A wallet with no message-signing capability cannot attest, ever. Said
  // plainly instead of dressed up as a network failure with a retry.
  if (!signer?.signMessage) return { ok: false, reason: 'cannot-sign' };
  const timeoutMs = options.timeoutMs ?? ATTESTATION_TIMEOUT_MS;

  let signed: Deadline<Uint8Array>;
  try {
    signed = await withDeadline(
      signer.signMessage(attestationMessage(wallet, terms)),
      timeoutMs,
      options.signal
    );
  } catch (error) {
    // A signer that throws SYNCHRONOUSLY never produced a promise.
    signed = { kind: 'error', error };
  }
  if (signed.kind === 'timed-out') return { ok: false, reason: 'timed-out' };
  if (signed.kind === 'cancelled') return { ok: false, reason: 'cancelled' };
  if (signed.kind === 'error') {
    // The seam's own classifier decides what a rejection looks like, so the
    // clickwrap and the transaction agree about "the player said no".
    return {
      ok: false,
      reason:
        classifySigningError(signed.error).kind === 'user-rejected' ? 'declined' : 'cannot-sign',
    };
  }
  const signature = signed.value;

  try {
    const res = await fetchImpl(`${entryApiBase}/attestation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet,
        termsVersion: terms.version,
        signature: Buffer.from(signature).toString('base64'),
      }),
      signal: requestSignal(timeoutMs, options.signal),
    });
    if (res.status !== 204) return { ok: false, reason: 'refused' };
  } catch {
    if (options.signal?.aborted) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'unreachable' };
  }
  rememberLocalAttestation(wallet, terms.version);
  return { ok: true };
}
