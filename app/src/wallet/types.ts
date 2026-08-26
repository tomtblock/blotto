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
  /** Secondary path: classic Solana wallet connect (D-08). */
  connectWallet(): void;
  signOut(): Promise<void>;
}

/** `Ab3kf9Qz…9fQz` — the display form of an address, never the full string. */
export function truncateAddress(address: string): string {
  return address.length <= 9
    ? address
    : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
