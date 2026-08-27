/*
 * Dev-only automation hook (extracted from the 10.B Step 2 signing spike so
 * Step 3+ trade surfaces share it): a Playwright run can inject a
 * keypair-backed signer at `window.__BLOTTO_TEST_SIGNER__` to drive the
 * SAME TxSigner seam without a wallet extension or the Privy modals. It
 * stands in for the external path in automated devnet verification; the real
 * wallet paths are verified by the founder's on-device pass (embedded auth
 * cannot be automated). Never present outside a test-driven browser context.
 */

import type { TxSigner } from "./types";

declare global {
  interface Window {
    __BLOTTO_TEST_SIGNER__?: {
      address: string;
      signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
    };
  }
}

export function testSignerFromWindow(): TxSigner | null {
  if (typeof window === "undefined") return null;
  const injected = window.__BLOTTO_TEST_SIGNER__;
  if (!injected) return null;
  return {
    address: injected.address,
    kind: "external",
    label: "injected test signer",
    signTransaction: (tx) => injected.signTransaction(tx),
  };
}
