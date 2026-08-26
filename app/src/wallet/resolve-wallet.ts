/*
 * BR-002 — resolve a verified Privy user (DID) to their Solana WALLET address, server-side.
 *
 * WHY THIS EXISTS. The referral LAUNCH GATE binds a redeemed code single-use to the user's
 * WALLET ADDRESS (ratified 2026-08-24, Q-045) — deliberately NOT the Privy DID that
 * `verifySession` returns. This module turns a verified DID into that wallet: it looks the
 * user up server-side via the Privy SDK and picks their Solana wallet from linked accounts.
 *
 * WHY WALLET, NOT DID. For a hand-picked v1 cohort, multi-wallet gaming is not a live
 * threat, so wallet-binding is correct and DID-binding would be over-engineering. NOTE the
 * scope fence in Q-045: the FUTURE influencer-attribution reuse of referral codes has the
 * OPPOSITE requirement (person-level identity to resist payout inflation) and must NOT
 * assume this wallet-binding — that identifier is re-decided when revenue-share is designed.
 *
 * SDK NOTE. Uses `getUser(userId)` on `@privy-io/server-auth`. That overload is marked
 * @deprecated in favour of `getUser({ idToken })` for rate-limit reasons — but the idToken
 * variant needs the client to send Privy's *identity* token, which it does not today (the
 * redeem route receives only the *access* token). Given a once-per-launch call volume, the
 * DID lookup is the correct available path; hoisting to idToken is a later optimisation that
 * would require a client change.
 */

import { PrivyClient, type User, type WalletWithMetadata } from "@privy-io/server-auth";
import { assertServerOnly } from "./server-guard";
import { PrivyConfigError } from "./verify-session";

// Server-only, defence-in-depth (same guard as verify-session / the referral store).
assertServerOnly("wallet/resolve-wallet");

/** `{ wallet }` when a Solana wallet is found; `{ error }` when the user has none. */
export type ResolveWalletResult =
  | { wallet: string }
  | { error: "no_wallet" };

/**
 * The one capability this needs from the SDK — the test seam. `PrivyClient` satisfies it
 * structurally; unit tests inject a fake and never touch the network.
 */
export interface UserDirectory {
  getUser(userId: string): Promise<User>;
}

/**
 * Build the Privy server client from env, failing CLOSED if either credential is missing —
 * the same posture and env vars as `buildSessionVerifier`. `NEXT_PUBLIC_PRIVY_APP_ID` is the
 * (non-secret) app id; `PRIVY_APP_SECRET` is server-only.
 */
export function buildUserDirectory(
  env: NodeJS.ProcessEnv = process.env,
): UserDirectory {
  const appId = env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  if (!appId) {
    throw new PrivyConfigError(
      "NEXT_PUBLIC_PRIVY_APP_ID is not set — cannot resolve wallets server-side.",
    );
  }
  if (!appSecret) {
    throw new PrivyConfigError(
      "PRIVY_APP_SECRET is not set — cannot resolve wallets server-side.",
    );
  }
  return new PrivyClient(appId, appSecret);
}

/**
 * Resolve a verified Privy DID to the user's Solana wallet address.
 *
 * Selection is DETERMINISTIC so the same person always resolves to the same wallet (which
 * is what keeps single-use binding honest): prefer the embedded Privy wallet
 * (`walletClientType === "privy"` — one per user, the D-08 default), else the first linked
 * external Solana wallet.
 *
 * @param account The verified Privy DID (from `verifySession`).
 * @param directory Injectable for tests; defaults to a real Privy client built from env.
 * @returns `{ wallet }` on success; `{ error: "no_wallet" }` when the verified user has no
 *   resolvable Solana wallet (e.g. social-only, embedded wallet not yet created) or the
 *   lookup fails. NEVER returns the DID as a wallet substitute.
 * @throws {PrivyConfigError} when server credentials are absent (deploy misconfiguration).
 */
export async function resolveSolanaWallet(
  account: string,
  directory: UserDirectory = buildUserDirectory(),
): Promise<ResolveWalletResult> {
  let user: User;
  try {
    user = await directory.getUser(account);
  } catch {
    // A failed lookup is treated as "no bindable wallet", never as a partial success.
    return { error: "no_wallet" };
  }

  const solanaWallets = user.linkedAccounts.filter(
    (a): a is WalletWithMetadata =>
      a.type === "wallet" && a.chainType === "solana",
  );

  const chosen =
    solanaWallets.find((w) => w.walletClientType === "privy") ??
    solanaWallets[0];

  if (!chosen) {
    return { error: "no_wallet" };
  }
  return { wallet: chosen.address };
}
