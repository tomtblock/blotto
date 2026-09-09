"use client";

/*
 * Wallet-standard detection and the one-tap sign-in sequence, kept OUT of the
 * provider bridge on purpose.
 *
 * Two reasons. First, "Phantom · DETECTED" is a fact about the browser, not
 * about the auth provider: a wallet registered in the page should show on the
 * sign-in surface immediately, before the provider SDK has loaded and even in
 * a preview build that has no provider credential at all. Second, the
 * sign-in-with-Solana sequence (connect → message → sign → log in) is plain
 * logic over three async calls; written against the wallet-standard
 * interfaces and a tiny dependency record it is unit-testable with a fake
 * wallet, where the bridge — a React component bound to the SDK — is not.
 *
 * The provider is still the only thing that can complete a login. The bridge
 * hands `siwsSignIn` the provider's two calls and nothing else.
 */

import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { useMemo, useSyncExternalStore } from "react";
import type { DetectedWallet } from "./types";

/** Stable id for a wallet-standard wallet, from its self-reported name. */
export function walletId(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/** The provider's embedded wallet registers under the provider's own name. */
export const isEmbeddedName = (name: string): boolean =>
  name.toLowerCase().includes("privy");

const isSolanaChain = (chain: string): boolean => chain.startsWith("solana:");

/** A wallet the sign-in surface should list: speaks Solana, is not the embedded one. */
export function isExternalSolanaWallet(wallet: Wallet): boolean {
  return wallet.chains.some(isSolanaChain) && !isEmbeddedName(wallet.name);
}

/*
 * The three wallet-standard features this module calls, typed structurally
 * so a fake wallet in a test needs nothing but these methods.
 */
export interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }>;
}
export interface SignMessageFeature {
  signMessage(
    ...inputs: readonly { account: WalletAccount; message: Uint8Array }[]
  ): Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>;
}
export interface SignTransactionFeature {
  signTransaction(
    ...inputs: readonly { account: WalletAccount; transaction: Uint8Array; chain?: string }[]
  ): Promise<readonly { signedTransaction: Uint8Array }[]>;
}

export function featureOf<T>(wallet: Wallet, name: string): T | null {
  const f = (wallet.features as Record<string, unknown>)[name];
  return f ? (f as T) : null;
}

/**
 * The order the sign-in surface lists wallets in: the wallets the product
 * is built around first (founder: Phantom is the one that matters), then
 * everything else in the order the browser registered it. A wallet that
 * merely happens to register first — a multi-chain extension that also
 * speaks Solana — must not sit above Phantom.
 */
const PREFERRED_ORDER = ["phantom", "solflare", "backpack"];

function rank(id: string): number {
  const i = PREFERRED_ORDER.indexOf(id);
  return i === -1 ? PREFERRED_ORDER.length : i;
}

/** Display rows for the sign-in surface: external Solana wallets, one per id, Phantom first. */
export function toDetected(wallets: readonly Wallet[]): DetectedWallet[] {
  const seen = new Set<string>();
  const out: DetectedWallet[] = [];
  for (const w of wallets) {
    if (!isExternalSolanaWallet(w)) continue;
    const id = walletId(w.name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: w.name, icon: w.icon });
  }
  // Stable sort: equal ranks keep registration order.
  return out
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank(a.row.id) - rank(b.row.id) || a.i - b.i)
    .map(({ row }) => row);
}

export function findStandardWallet(wallets: readonly Wallet[], id: string): Wallet | null {
  return wallets.find((w) => isExternalSolanaWallet(w) && walletId(w.name) === id) ?? null;
}

/* ---------- the live list, as an external store ---------- */

const EMPTY: readonly Wallet[] = [];
// `get()` returns a fresh array each call; useSyncExternalStore needs a
// stable snapshot, so it is cached and invalidated only by the registry's
// own register / unregister events.
let snapshotCache: readonly Wallet[] | null = null;

function subscribe(onChange: () => void): () => void {
  const api = getWallets();
  const offRegister = api.on("register", () => {
    snapshotCache = null;
    onChange();
  });
  const offUnregister = api.on("unregister", () => {
    snapshotCache = null;
    onChange();
  });
  return () => {
    offRegister();
    offUnregister();
  };
}

function getSnapshot(): readonly Wallet[] {
  if (snapshotCache === null) snapshotCache = getWallets().get();
  return snapshotCache;
}

/** Every wallet-standard wallet registered in this page, live. Empty on the server. */
export function useStandardWalletList(): readonly Wallet[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/** The detected external Solana wallets, live, as sign-in rows. */
export function useDetectedSolanaWallets(): DetectedWallet[] {
  const wallets = useStandardWalletList();
  return useMemo(() => toDetected(wallets), [wallets]);
}

/* ---------- the one-tap sign-in sequence ---------- */

/** What the provider contributes; the bridge supplies these from its hooks. */
export interface SiwsDeps {
  generateSiwsMessage(input: { address: string }): Promise<string>;
  loginWithSiws(input: {
    signature: string;
    message: string;
    walletClientType?: string;
    connectorType?: string;
  }): Promise<unknown>;
  /**
   * Ed25519 signature bytes → the text the provider's endpoint takes. The
   * bridge supplies BASE64: that is what the provider's own wallet modal
   * sends for a plain-text Solana sign-in (read from the installed SDK,
   * 2026-09-09), and a base58 string — what this seam sent until then — is
   * refused by the provider as an unverifiable signature, which surfaced as
   * "the wallet signed in, but the sign-in could not be completed".
   */
  encodeSignature(bytes: Uint8Array): string;
}

/**
 * Ed25519 signature bytes → base64, the form the provider's SIWS endpoint
 * verifies for a plain-text message (its own modal: `base64.encode` from
 * @scure/base). Written over btoa so it runs in the browser bundle
 * without a Buffer polyfill.
 */
export function signatureToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export type SiwsOutcome =
  | { ok: true; address: string }
  | {
      ok: false;
      code:
        | "blotto_wallet_no_headless_path"
        | "blotto_wallet_no_account"
        | "blotto_wallet_declined"
        | "blotto_wallet_signin_failed";
      detail?: string;
    };

/** Whether a thrown value reads as the player declining a wallet prompt. */
export function isRejection(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /reject|declin|denied|cancel|closed/i.test(text);
}

/**
 * Connect the wallet, have it sign the provider's sign-in-with-Solana
 * message for its first Solana account, and log in with the signature.
 * Never throws: every failure is an outcome the surface can show.
 */
export async function siwsSignIn(wallet: Wallet, deps: SiwsDeps): Promise<SiwsOutcome> {
  const connect = featureOf<ConnectFeature>(wallet, "standard:connect");
  const sign = featureOf<SignMessageFeature>(wallet, "solana:signMessage");
  if (!connect || !sign) return { ok: false, code: "blotto_wallet_no_headless_path" };

  let account: WalletAccount | undefined;
  try {
    const { accounts } = await connect.connect();
    account = accounts.find((a) => a.chains.some(isSolanaChain)) ?? accounts[0];
  } catch (error) {
    return {
      ok: false,
      code: isRejection(error) ? "blotto_wallet_declined" : "blotto_wallet_signin_failed",
      detail: String(error),
    };
  }
  if (!account) return { ok: false, code: "blotto_wallet_no_account" };

  try {
    const message = await deps.generateSiwsMessage({ address: account.address });
    const [signed] = await sign.signMessage({
      account,
      message: new TextEncoder().encode(message),
    });
    if (!signed) return { ok: false, code: "blotto_wallet_declined" };
    await deps.loginWithSiws({
      signature: deps.encodeSignature(signed.signature),
      message,
      walletClientType: walletId(wallet.name),
      connectorType: "injected",
    });
    return { ok: true, address: account.address };
  } catch (error) {
    return {
      ok: false,
      code: isRejection(error) ? "blotto_wallet_declined" : "blotto_wallet_signin_failed",
      detail: String(error),
    };
  }
}
