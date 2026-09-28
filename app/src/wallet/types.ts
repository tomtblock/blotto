/*
 * Auth abstraction — the ONLY auth surface screens are allowed to import.
 *
 * D-08 ships an embedded-wallet provider with a confidence flag: the provider
 * landscape moves fast, and the provider may be swapped. Screens therefore
 * depend on this interface, never on the provider SDK directly — the blast
 * radius of a D-08 provider change is confined to the adapter in
 * auth-provider.tsx.
 *
 * Widened 2026-09-08 for the wallet screen and the sign-in surface players
 * already know from other Solana products:
 * detected wallets, one-tap wallet sign-in, an error channel, an active-
 * wallet choice, and the two exits (send is a tx-seam concern — see
 * src/tx/send-sol.ts — but key export is the provider's, so it lives here).
 */

import type { TxSigner } from "@/tx/types";

export type AuthStatus = "initializing" | "signed-out" | "signed-in";

/**
 * Social login providers.
 *
 * D-08 named three — Google, Apple and X. **Apple was removed on 2026-09-24**
 * by founder decision, after a review of the sign-in surface found it had
 * never worked: the Privy dashboard refuses it (`403 disallowed_login_method`)
 * and the page said nothing, so a player pressed a button that did nothing at
 * all. The founder chose removal over enabling it in the dashboard.
 *
 * The removal is HERE, in the type, and not only in the button: a provider the
 * app cannot name is a provider it cannot accidentally offer again from a
 * second surface.
 */
export type SocialProvider = "google" | "twitter";

/**
 * A Solana wallet the browser has REGISTERED (installed extension or in-app
 * wallet), whether or not it is connected — what "Phantom · DETECTED" means.
 * `id` is stable per wallet name and is what `signInWithWallet` takes;
 * `icon` is the wallet's own data-URI image, never an external URL.
 */
export interface DetectedWallet {
  id: string;
  name: string;
  icon: string;
}

/**
 * The last thing that went wrong in the provider, for the surface that
 * started it to explain. `code` is the provider's error code (or one of the
 * few codes this seam raises itself, prefixed `blotto_`); `at` distinguishes
 * a repeat of the same failure from the same one still showing.
 */
export interface AuthFailure {
  code: string;
  at: number;
  /**
   * The provider's own words for the failure, when it gave any — shown small
   * under the plain-language line so a screenshot of the page carries the
   * cause (founder 2026-09-09: "could not be completed" said nothing usable).
   */
  detail?: string;
}

/**
 * How the funding flow should open. `receive` opens straight onto the
 * deposit-address screen — the only funding route that can work on devnet,
 * where no card or exchange provider sells SOL. `any` lets the provider
 * choose among whatever methods are switched on in its dashboard.
 */
export interface AddFundsOptions {
  method?: "receive" | "any";
}

export interface Auth {
  status: AuthStatus;
  /**
   * Set only when sign-in cannot work, and why. Absent means it can.
   *
   * A surface must not decide this for itself from the environment. The
   * sign-in page used to read NEXT_PUBLIC_PRIVY_APP_ID directly, which is
   * non-empty even when the value is malformed — so with a bad credential the
   * buttons rendered ENABLED and did nothing when clicked, silently. Measured
   * in a real browser 2026-09-08. Only the provider knows whether the SDK
   * actually came up, so only the provider says.
   *
   * `unreachable` (2026-09-12): the provider never reported ready within the
   * shell's deadline — an outage, a tracker blocklist, a corporate DNS filter.
   * Until then this state had no name, no deadline and no control: the header
   * held an inert placeholder for as long as the provider stayed silent
   * (audit 2026-09-11, C-03). Unlike the other two it can clear on its own:
   * a late provider still takes over the moment it reports.
   */
  unavailable?: "absent" | "rejected" | "unreachable";
  /**
   * Base58 pubkey of the ACTIVE Solana wallet — the one that enters, is
   * paid, and whose balance is shown — or null while initializing / signed
   * out / before a wallet exists. With more than one wallet connected this
   * is the player's choice (`setActiveWallet`); see the adapter for the
   * default.
   */
  walletAddress: string | null;
  /**
   * The address the sign-in provider knows for this account — a Google
   * sign-in carries one; a wallet or X sign-in does not, and this is
   * null. Read by the one-message opt-in on the sealed screen (round four,
   * 2026-09-17) so a social sign-in is one press; never sent anywhere
   * without the wallet signing the request that carries it.
   */
  email: string | null;
  /**
   * Every connected wallet as a `TxSigner` for the tx seam (10.B Step 2) —
   * embedded and external side by side; empty until a wallet connects. The
   * dependency points auth → tx (types only) so lib/tx stays provider-free.
   */
  signers: TxSigner[];
  /**
   * Why `signers` is empty although a wallet is signed in, when the reason
   * is KNOWN rather than a reconnect still in flight (2026-09-28, D-E18).
   * A mobile wallet reached through the mobile wallet standard may offer
   * sign-and-send only; the tx seam needs a wallet that signs and hands the
   * transaction back (tx/execute.ts, the founder-ruled signing order), so
   * such a wallet can sign in but cannot enter. The play page says so in
   * words instead of waiting eight seconds for a signer that will never
   * come. Absent means "no known limitation".
   */
  signerLimit?: 'no-sign-transaction';
  /** Wallets registered in this browser, connected or not (see above). */
  detectedWallets: readonly DetectedWallet[];
  /** The most recent failure, or null. Cleared by `clearError` or a success. */
  lastError: AuthFailure | null;
  clearError(): void;
  /** Hero path: social login backed by an embedded wallet (D-08). */
  signInWithSocial(provider: SocialProvider): void;
  /**
   * One-tap sign-in with a DETECTED wallet: connect it, have it sign the
   * provider's sign-in-with-Solana message, log in — no provider chrome.
   * Falls back to the provider's own wallet flow when the wallet cannot
   * sign messages. Rejections land in `lastError`, never as a throw the
   * surface has to catch.
   */
  signInWithWallet(id: string): Promise<void>;
  /** Secondary path: the provider's own wallet list (mobile, QR, the rest). */
  connectWallet(): void;
  /** Choose which connected wallet is the active one. Persisted per user. */
  setActiveWallet(address: string): void;
  signOut(): Promise<void>;
  /**
   * Open the provider's wallet-funding flow for `address` (C9). Optional:
   * absent when the provider is unconfigured or has no funding surface —
   * the top-up BUTTON additionally hides behind `NEXT_PUBLIC_TOPUP_ENABLED`
   * (default OFF, founder decision D-C). Resolves when the flow OPENS, not
   * when funds arrive.
   */
  addFunds?(address: string, options?: AddFundsOptions): Promise<void>;
  /**
   * Show the player the private key of an EMBEDDED wallet, on the provider's
   * own screen that this app cannot read, so they can import it into a
   * wallet they control (the "move my wallet to Phantom" exit). Absent when
   * no embedded wallet is connected. Resolves when the player closes it.
   */
  exportWallet?(address: string): Promise<void>;
  /**
   * Attach a wallet the player already has (Phantom, …) to THIS account —
   * so a Google sign-in can play and be paid with Phantom without becoming
   * a second identity. Absent while signed out.
   */
  linkWallet?(): void;
}

/** `Ab3kf9Qz…9fQz` — the display form of an address, never the full string. */
export function truncateAddress(address: string): string {
  return address.length <= 9
    ? address
    : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
