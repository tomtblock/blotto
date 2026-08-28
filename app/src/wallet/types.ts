/*
 * Auth abstraction — the ONLY auth surface screens are allowed to import.
 *
 * D-08 ships an embedded-wallet provider with a confidence flag: the provider
 * landscape moves fast, and the provider may be swapped. Screens therefore
 * depend on this interface, never on the provider SDK directly — the blast
 * radius of a D-08 provider change is confined to the adapter in
 * auth-provider.tsx.
 */

import type { TxSigner } from "@/tx/types";

export type AuthStatus = "initializing" | "signed-out" | "signed-in";

/** Social login providers per D-08 (Google / Apple / X). */
export type SocialProvider = "google" | "apple" | "twitter";

export interface Auth {
  status: AuthStatus;
  /**
   * Base58 pubkey of the active Solana wallet (embedded or connected), or
   * null while initializing / signed out / before a wallet exists.
   */
  walletAddress: string | null;
  /**
   * Every connected wallet as a `TxSigner` for the tx seam (10.B Step 2) —
   * embedded and external side by side; empty until a wallet connects. The
   * dependency points auth → tx (types only) so lib/tx stays provider-free.
   */
  signers: TxSigner[];
  /** Hero path: social login backed by an embedded wallet (D-08). */
  signInWithSocial(provider: SocialProvider): void;
  /**
   * The provider's most recent sign-in FAILURE code, or null. A deliberate
   * cancel (the player closing the provider's modal) is not a failure and
   * never lands here. Founder report 2026-08-28: the social buttons
   * appeared to do nothing, because a provider that is not enabled — or a
   * domain not allow-listed — fails inside the provider's own flow and the
   * app said nothing at all. Screens render an honest line from this.
   */
  lastAuthError?: string | null;
  /** Secondary path: classic Solana wallet connect (D-08). */
  connectWallet(): void;
  signOut(): Promise<void>;
  /**
   * Open the provider's wallet-funding flow for `address` (C9). Optional:
   * absent when the provider is unconfigured or has no funding surface —
   * the top-up BUTTON additionally hides behind `NEXT_PUBLIC_TOPUP_ENABLED`
   * (default OFF, founder decision D-C).
   */
  addFunds?(address: string): Promise<void>;
}

/** `Ab3kf9Qz…9fQz` — the display form of an address, never the full string. */
export function truncateAddress(address: string): string {
  return address.length <= 9
    ? address
    : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
