/*
 * Ed25519 in WebCrypto, wherever the page runs (2026-09-30, found in the
 * Android shell).
 *
 * The entry transaction is partial-signed by the pass asset's own throwaway
 * keypair, generated on the device with `crypto.subtle` (entry/services.ts
 * → @solana/kit `generateKeyPair`). Browsers only gained Ed25519 there
 * recently — Chrome shipped it by default in 137 — and an Android WebView
 * can be older than the phone's Chrome: the emulator's was Chromium 124,
 * where kit's guard throws `ED25519_ALGORITHM_UNIMPLEMENTED` (3610002)
 * after the ciphertext is stored and before the wallet is asked, which the
 * play page could only report as "the network request did not go through".
 * The dApp Store package is a WebView, so this is a mobile-channel fact,
 * not a corner case.
 *
 * Solana's own polyfill (`@solana/webcrypto-ed25519-polyfill`, @noble
 * underneath) adds Ed25519 to `crypto.subtle`. It is loaded ONLY where the
 * native implementation is missing: a probe first, the download and the
 * install only on failure, so a modern browser pays nothing and never runs
 * a JavaScript Ed25519. Once, per page: kit caches its own support probe
 * (`@solana/assertions`), so the install must precede kit's first key
 * generation — which is why the register step awaits this before it.
 *
 * What is signed with the polyfilled key is the per-entry pass asset
 * signature; the player's wallet key never touches it (the wallet app
 * signs in its own process).
 */

interface SubtleLike {
  generateKey(algorithm: { name: string }, extractable: boolean, usages: string[]): Promise<unknown>;
}

/** Whether this runtime's `crypto.subtle` generates Ed25519 keys natively. */
export async function hasNativeEd25519(subtle: SubtleLike | undefined = globalThis.crypto?.subtle): Promise<boolean> {
  if (!subtle || typeof subtle.generateKey !== 'function') return false;
  try {
    await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

let ready: Promise<void> | null = null;

/**
 * Resolves once `crypto.subtle` can generate and sign with Ed25519 keys —
 * at once where it already can, after installing the polyfill where it
 * cannot. Memoized; safe to await before every key use.
 */
export function ensureEd25519(
  deps: {
    native?: () => Promise<boolean>;
    install?: () => Promise<void>;
  } = {},
): Promise<void> {
  if (ready) return ready;
  const native = deps.native ?? (() => hasNativeEd25519());
  const install =
    deps.install ??
    (async () => {
      const polyfill = await import('@solana/webcrypto-ed25519-polyfill');
      polyfill.install();
    });
  ready = (async () => {
    if (await native()) return;
    await install();
  })();
  // A failed install must not poison every later call: forget it and let the
  // next caller try again (kit's own guard then reports the real state).
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

/** Test seam: forget the memoized outcome. */
export function resetEd25519ForTests(): void {
  ready = null;
}
