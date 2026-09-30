/*
 * The direct wallet session (V2, founder 2026-09-27: "Phantom login working
 * today"). A sign-in route that never touches the embedded-wallet provider.
 *
 * WHY IT EXISTS. The provider composes its sign-in-with-Solana message on
 * its own servers and that message says `Chain ID: mainnet`; Phantom checks
 * the line against the network it is connected to (devnet) and refuses to
 * show the request. The provider confirmed in writing that the message
 * defaults to mainnet whatever we configure (docs/guide/HOSTING.md). So an
 * external wallet signs in HERE instead: the browser's wallet standard
 * connects it, it signs a short statement composed on the player's own
 * device to prove control of the address, and the app treats that address
 * as the signed-in wallet.
 *
 * WHAT A SESSION IS. Nothing server-side: the app has no session store, and
 * everything downstream keys off the wallet address alone — the entry
 * service verifies the 18+ confirmation with the wallet's own signature
 * over a message it composes itself, and the admin pages check the address
 * against the reviewer list. The statement signed here is for the player's
 * benefit (a wallet that cannot sign cannot enter, and a tap that connects
 * nothing should not read as a sign-in); it is not sent anywhere.
 *
 * This file is the PURE half — the sequence over the wallet-standard
 * interfaces and a nonce/clock record — so it is unit-tested with a fake
 * wallet. The React half (direct-session.tsx) owns the state, the silent
 * reconnect and the storage.
 */

import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { SOLANA_CHAIN } from "@/chain/cluster";
import type { TxSigner } from "@/tx/types";
import {
  featureOf,
  isRejection,
  walletId,
  type ConnectFeature,
  type SignInFeature,
  type SignMessageFeature,
  type SignTransactionFeature,
} from "./standard-wallets";

const isSolanaChain = (chain: string): boolean => chain.startsWith("solana:");

/** The statement the wallet signs. Plain words; names the wallet, the moment and a nonce. */
export function directStatement(address: string, nonce: string, issuedAt: string): string {
  return (
    "Blotto Cup\n\n" +
    "Sign in with this wallet.\n\n" +
    `Wallet: ${address}\n` +
    `Issued: ${issuedAt}\n` +
    `Nonce: ${nonce}\n\n` +
    "This signature proves you control the wallet. It moves nothing and costs nothing."
  );
}

/**
 * The same statement for the wallet standard's own sign-in, on one line: a
 * sign-in message's statement field may not hold a line break, and the
 * wallet adds the address, the nonce and the moment as fields of its own.
 */
export const WALLET_SIGN_IN_STATEMENT =
  "Sign in to Blotto Cup with this wallet. This signature proves you control the wallet. It moves nothing and costs nothing.";

export interface DirectDeps {
  nonce(): string;
  issuedAt(): string;
  /**
   * Sign in through the wallet's own `solana:signIn` where it offers one —
   * connect and the signed statement in ONE wallet session — instead of
   * connect then `signMessage`. The mobile channel passes true (see
   * in-front.ts for the race the second session runs on Android); the web
   * passes nothing and keeps the two-step route exactly as it was.
   */
  walletSignIn?: boolean;
  /** Awaited before every wallet prompt; the mobile channel's "page in front" wait (in-front.ts). */
  settle?: () => Promise<void>;
}

export type DirectOutcome =
  | { ok: true; address: string; walletId: string; account: WalletAccount }
  | {
      ok: false;
      code:
        | "blotto_wallet_no_headless_path"
        | "blotto_wallet_no_account"
        | "blotto_wallet_declined"
        | "blotto_wallet_signin_failed";
      detail?: string;
    };

function firstSolanaAccount(accounts: readonly WalletAccount[]): WalletAccount | undefined {
  return accounts.find((a) => a.chains.some(isSolanaChain)) ?? accounts[0];
}

/**
 * Connect the wallet and have it sign the statement for its first Solana
 * account. Never throws: every failure is an outcome the surface can show.
 */
export async function directSignIn(wallet: Wallet, deps: DirectDeps): Promise<DirectOutcome> {
  const connect = featureOf<ConnectFeature>(wallet, "standard:connect");
  const sign = featureOf<SignMessageFeature>(wallet, "solana:signMessage");
  if (!connect || !sign) return { ok: false, code: "blotto_wallet_no_headless_path" };

  const signIn = deps.walletSignIn ? featureOf<SignInFeature>(wallet, "solana:signIn") : null;
  if (signIn) {
    try {
      await deps.settle?.();
      const [signed] = await signIn.signIn({
        statement: WALLET_SIGN_IN_STATEMENT,
        nonce: deps.nonce(),
        issuedAt: deps.issuedAt(),
      });
      if (!signed || signed.signature.length === 0) return { ok: false, code: "blotto_wallet_declined" };
      if (!signed.account.address) return { ok: false, code: "blotto_wallet_no_account" };
      return { ok: true, address: signed.account.address, walletId: walletId(wallet.name), account: signed.account };
    } catch (error) {
      if (isRejection(error)) return { ok: false, code: "blotto_wallet_declined", detail: String(error) };
      // The wallet took the request but returned no sign-in result (a wallet
      // app without the sign-in payload): fall through to the two-step route.
      // Its connect is cached by the library, so no second session opens
      // for it; the statement costs the one prompt it always did.
    }
  }

  let account: WalletAccount | undefined;
  try {
    await deps.settle?.();
    const { accounts } = await connect.connect();
    account = firstSolanaAccount(accounts);
  } catch (error) {
    return {
      ok: false,
      code: isRejection(error) ? "blotto_wallet_declined" : "blotto_wallet_signin_failed",
      detail: String(error),
    };
  }
  if (!account) return { ok: false, code: "blotto_wallet_no_account" };

  try {
    const statement = directStatement(account.address, deps.nonce(), deps.issuedAt());
    await deps.settle?.();
    const [signed] = await sign.signMessage({ account, message: new TextEncoder().encode(statement) });
    if (!signed || signed.signature.length === 0) return { ok: false, code: "blotto_wallet_declined" };
    return { ok: true, address: account.address, walletId: walletId(wallet.name), account };
  } catch (error) {
    return {
      ok: false,
      code: isRejection(error) ? "blotto_wallet_declined" : "blotto_wallet_signin_failed",
      detail: String(error),
    };
  }
}

/**
 * Reconnect a wallet the player signed in with earlier, without a prompt.
 * `accepts` decides which account the session is for (the stored token of
 * the address — the address itself is never written to storage). No
 * signature: the earlier one proved control; a silent reconnect only asks
 * the wallet whether it still holds that account.
 */
export async function directReconnect(
  wallet: Wallet,
  accepts: (address: string) => boolean,
): Promise<WalletAccount | null> {
  const connect = featureOf<ConnectFeature>(wallet, "standard:connect");
  if (!connect) return null;
  try {
    const { accounts } = await connect.connect({ silent: true });
    return accounts.find((a) => a.chains.some(isSolanaChain) && accepts(a.address)) ?? null;
  } catch {
    return null;
  }
}

/**
 * The wallet's Solana accounts as TxSigners for the tx seam. `settle`, when
 * given, is awaited before every prompt — the mobile channel's "page in
 * front" wait (in-front.ts): the seal signs a message and then, a few RPC
 * round trips later, the transaction, and on Android those are two wallet
 * sessions in a row.
 */
export function directSigners(wallet: Wallet, settle?: () => Promise<void>): TxSigner[] {
  const signTx = featureOf<SignTransactionFeature>(wallet, "solana:signTransaction");
  const signMsg = featureOf<SignMessageFeature>(wallet, "solana:signMessage");
  if (!signTx) return [];
  return wallet.accounts
    .filter((a) => a.chains.some(isSolanaChain))
    .map((account) => ({
      address: account.address,
      kind: "external" as const,
      label: wallet.name,
      signTransaction: async (transaction: Uint8Array) => {
        await settle?.();
        const [out] = await signTx.signTransaction({ account, transaction, chain: SOLANA_CHAIN });
        if (!out) throw new Error(`${wallet.name} returned no signed transaction`);
        return out.signedTransaction;
      },
      signMessage: signMsg
        ? async (message: Uint8Array) => {
            await settle?.();
            const [out] = await signMsg.signMessage({ account, message });
            if (!out) throw new Error(`${wallet.name} returned no signature`);
            return out.signature;
          }
        : undefined,
    }));
}

/** A nonce for the statement: 16 random bytes as hex, from the browser's CSPRNG. */
export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
