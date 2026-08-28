"use client";

/*
 * Privy adapter — the ONLY file that imports the provider SDK (D-08
 * swappability; provider verified 2026-08-08, see the Step 1 PR).
 *
 * D4: loaded as a LAZY BRIDGE (next/dynamic, ssr:false, from
 * auth-provider.tsx) so the provider SDK never sits in the first-load
 * bundle of every page. The bridge renders nothing itself: page content
 * lives OUTSIDE the PrivyProvider and consumes the app's own AuthContext,
 * which this bridge feeds through `onAuth`. Privy's own UI (login modal,
 * signing prompts) portals to document.body, so wrapping the page tree is
 * not required — only the SDK hooks below must live under the provider.
 *
 * Wiring per D-08: social login (Google/Apple/X) backed by an embedded
 * Solana wallet is the default path; classic wallet connect rides Privy's
 * wallet-standard connectors (Phantom/Solflare/Backpack + Mobile Wallet
 * Adapter surface through the wallet-standard). 'siws' = sign-in with
 * Solana, the wallet login method.
 */

import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import {
  toSolanaWalletConnectors,
  useFundWallet,
  useSignMessage,
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useEffect, useMemo, useState } from "react";
import type { Auth, SocialProvider } from "./types";
import type { TxSigner } from "@/tx/types";
import { rpcUrl } from "@/chain/rpc";

/*
 * The ONLY Solana chain this app configures. Signing calls pass it
 * EXPLICITLY — Privy's per-request default is mainnet, and an implicit
 * default is exactly what broke the first on-device signing attempt
 * (PR #102 P0: "No RPC configuration found for chain solana:mainnet").
 * Mainnet stays UNCONFIGURED by construction (the previews-never-mainnet
 * rule, lib/chain/rpc.ts) until 10.F says otherwise — a signing call that
 * drifts to mainnet must keep failing loudly, not silently succeed.
 */
const SOLANA_CHAIN = "solana:devnet" as const;

/**
 * Devnet RPC config for Privy's signing path (config.solana.rpcs, per the
 * installed v3 SDK types) — same endpoint rule as every other RPC use
 * (NEXT_PUBLIC_SOLANA_RPC_URL, public devnet fallback). Module-level so the
 * provider config keeps a stable identity across renders.
 */
const SOLANA_RPCS_CONFIG = {
  [SOLANA_CHAIN]: {
    rpc: createSolanaRpc(rpcUrl()),
    rpcSubscriptions: createSolanaRpcSubscriptions(
      rpcUrl().replace(/^http/, "ws"),
    ),
    blockExplorerUrl: "https://explorer.solana.com",
  },
};

/*
 * SPIKE-ONLY diagnostic flag (10.B Step 2 P0: buy tap kills the page on
 * real iOS Safari). The /design/signing page sets this; when true, embedded
 * signing skips Privy's confirmation modal (showWalletUIs false) so the
 * device pass can isolate whether the modal is the page-killer. Remove with
 * the spike page — the real trade UI (Steps 3/4) decides modal policy
 * deliberately, not via a window global.
 */
declare global {
  interface Window {
    __BLOTTO_SIGN_NO_MODAL__?: boolean;
  }
}

/** PrivyErrorCode.USER_EXITED_AUTH_FLOW's value — the player closing the
 * provider's modal, which is a decision, not a failure. */
const USER_CANCELLED = "exited_auth_flow";

function PrivyAdapter({ onAuth }: { onAuth: (auth: Auth) => void }) {
  const { ready, authenticated, user, logout } = usePrivy();
  /*
   * Sign-in failures are DATA, not silence (founder report 2026-08-28: the
   * social buttons "don't work"). A provider that is not enabled for this
   * app, or a domain that is not allow-listed, fails inside the provider's
   * own flow — the app used to hear nothing and show nothing. The code is
   * kept for the console; screens render their own honest line from the
   * fact that one exists. A deliberate cancel is NOT a failure.
   */
  const [lastAuthError, setLastAuthError] = useState<string | null>(null);
  const { login } = useLogin({
    onComplete: () => setLastAuthError(null),
    onError: (code) => {
      // The SDK ships PrivyErrorCode as a TYPE-ONLY export (verified
      // against the installed 3.37.0 build: it is absent from the runtime
      // module), so the cancel code is compared as its documented literal.
      // Importing it as a value would typecheck and then throw in the
      // browser.
      if (code === USER_CANCELLED) return;
      console.warn(`[auth] sign-in failed: ${code}`);
      setLastAuthError(String(code));
    },
  });
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const { fundWallet } = useFundWallet();

  const value = useMemo<Auth>(() => {
    // Active Solana wallet: a connected standard wallet (embedded or
    // external) first; else the embedded wallet linked on the Privy user —
    // covers the gap between login completing and the wallet connecting.
    const linkedSolana = user?.linkedAccounts.find(
      (a) => a.type === "wallet" && a.chainType === "solana",
    );
    const walletAddress =
      wallets[0]?.address ??
      (linkedSolana && "address" in linkedSolana
        ? linkedSolana.address
        : null);

    // Each connected standard wallet as a TxSigner (10.B Step 2 tx seam):
    // one signing interface for both paths — the embedded wallet registers
    // as the wallet-standard wallet named "Privy"; everything else is an
    // external connector (Phantom / Solflare / …).
    const signers: TxSigner[] = wallets.map((wallet) => ({
      address: wallet.address,
      kind: wallet.standardWallet.name.toLowerCase().includes("privy")
        ? "embedded"
        : "external",
      label: wallet.standardWallet.name,
      signTransaction: async (transaction: Uint8Array) => {
        // Chain is explicit — never Privy's default (see SOLANA_CHAIN). The
        // try/catch guarantees ANY SDK throw reaches the tx seam as a normal
        // rejected promise (→ a §5 failed state with honest copy), never as
        // an unhandled error loose in the page.
        try {
          const { signedTransaction } = await signTransaction({
            transaction,
            wallet,
            chain: SOLANA_CHAIN,
            ...(typeof window !== "undefined" && window.__BLOTTO_SIGN_NO_MODAL__
              ? { options: { uiOptions: { showWalletUIs: false } } }
              : {}),
          });
          return signedTransaction;
        } catch (error) {
          // Preserve the original message — the seam's classifier reads it
          // (user rejection vs everything else).
          throw error instanceof Error
            ? error
            : new Error(`privy signing failed: ${String(error)}`);
        }
      },
      // D-B4: the attestation clickwrap signs a human-readable message.
      signMessage: async (message: Uint8Array) => {
        try {
          const { signature } = await signMessage({ message, wallet });
          return signature;
        } catch (error) {
          throw error instanceof Error
            ? error
            : new Error(`privy message signing failed: ${String(error)}`);
        }
      },
    }));

    return {
      status: !ready
        ? "initializing"
        : authenticated
          ? "signed-in"
          : "signed-out",
      walletAddress,
      signers,
      signInWithSocial: (provider: SocialProvider) => {
        setLastAuthError(null);
        login({ loginMethods: [provider] });
      },
      connectWallet: () => {
        setLastAuthError(null);
        login({ loginMethods: ["wallet"] });
      },
      lastAuthError,
      signOut: logout,
      // C9: Privy's funding flow, exposed as the provider-neutral seam. The
      // top-up button additionally hides behind NEXT_PUBLIC_TOPUP_ENABLED.
      addFunds: async (fundAddress: string) => {
        await fundWallet({ address: fundAddress });
      },
    };
  }, [
    ready,
    authenticated,
    user,
    wallets,
    signTransaction,
    signMessage,
    fundWallet,
    login,
    logout,
    lastAuthError,
  ]);

  useEffect(() => {
    onAuth(value);
  }, [value, onAuth]);

  return null;
}

export default function PrivyBridge({
  appId,
  onAuth,
}: {
  appId: string;
  onAuth: (auth: Auth) => void;
}) {
  return (
    <PrivyProvider
      appId={appId}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID}
      config={{
        // D-08 methods: socials as hero, classic wallet connect alongside.
        loginMethods: ["google", "apple", "twitter", "wallet"],
        appearance: {
          theme: "dark",
          // Literals required here (provider-modal config consumed by the
          // Privy SDK, not component styling) — keep in sync with
          // --color-brand in src/styles/tokens.css (D1 arena palette; the
          // predecessor violet was a stale carry, caught in D4).
          accentColor: "#3d8bff",
          walletChainType: "solana-only",
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
        // Devnet ONLY — no mainnet entry by construction (see SOLANA_CHAIN).
        solana: { rpcs: SOLANA_RPCS_CONFIG },
      }}
    >
      <PrivyAdapter onAuth={onAuth} />
    </PrivyProvider>
  );
}
