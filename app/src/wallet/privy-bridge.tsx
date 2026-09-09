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
 * Solana wallet is one path; a wallet the player already has is the other.
 * Since 2026-09-08 the wallet path has TWO doors: a one-tap sign-in with a
 * wallet DETECTED in the browser (wallet-standard connect → the provider's
 * sign-in-with-Solana message → signed by the wallet → `loginWithSiws`, no
 * provider chrome), and the provider's own wallet list for everything else
 * (mobile wallets, WalletConnect QR, wallets not installed). The provider's
 * login method for the second door is 'wallet'.
 */

import {
  PrivyProvider,
  useLinkAccount,
  useLogin,
  useLoginWithSiws,
  usePrivy,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import {
  toSolanaWalletConnectors,
  useExportWallet,
  useFundWallet,
  useSignMessage,
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useCallback, useEffect, useMemo, useState } from "react";
import { COPY } from "@/copy";
import type { AddFundsOptions, Auth, AuthFailure, SocialProvider } from "./types";
import {
  featureOf,
  findStandardWallet,
  isEmbeddedName,
  signatureToBase64,
  siwsSignIn,
  toDetected,
  useStandardWalletList,
  type SignMessageFeature,
  type SignTransactionFeature,
} from "./standard-wallets";
import { pickActiveWallet } from "./active-wallet";
import type { TxSigner } from "@/tx/types";
import { rpcUrl } from "@/chain/rpc";
import { SOLANA_CHAIN } from "@/chain/cluster";

/*
 * The ONLY Solana chain this app configures — `SOLANA_CHAIN`, derived from
 * the one build-time cluster variable (chain/cluster.ts). Signing AND funding
 * calls pass it EXPLICITLY — Privy's per-request default is mainnet, and an
 * implicit default is exactly what broke the first on-device signing attempt
 * (PR #102 P0: "No RPC configuration found for chain solana:mainnet") and
 * what pointed the funding flow at mainnet until 2026-09-08 (PR #86). A
 * devnet build configures no mainnet at all (the previews-never-mainnet
 * rule), so a call that drifts must keep failing loudly, not silently
 * succeed. Pinned by privy-chain.test.ts.
 */

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

/**
 * The wallet buttons Privy's own modal shows (the "More wallets" door and
 * the link-a-wallet flow), in this order. Phantom first because it is the
 * one the founder named; the detected bucket catches anything else the
 * browser has (Ctrl, Glow, …) under its own name and icon; the QR entry is
 * the desktop→phone path.
 */
const WALLET_LIST: NonNullable<
  NonNullable<PrivyClientConfig["appearance"]>["walletList"]
> = [
  "phantom",
  "solflare",
  "backpack",
  "detected_solana_wallets",
  "wallet_connect_qr_solana",
];

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

/** One line of the provider's own error text, for the sign-in page's detail row. */
function shortDetail(detail: string): string {
  const line = detail.replace(/^Error:\s*/, "").split("\n")[0] ?? detail;
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

function PrivyAdapter({ onAuth }: { onAuth: (auth: Auth) => void }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const [lastError, setLastError] = useState<AuthFailure | null>(null);
  const fail = useCallback((code: string, detail?: string) => {
    setLastError(detail ? { code, at: Date.now(), detail } : { code, at: Date.now() });
  }, []);
  const clearError = useCallback(() => setLastError(null), []);

  /*
   * THE MISSING ERROR HANDLER. Until 2026-09-08 `useLogin()` was called with
   * no callbacks, so every sign-in failure — provider switched off, origin
   * not allowlisted, popup blocked, player cancelled — was dispatched by the
   * SDK into an empty listener list and vanished. The sign-in page had no
   * way to say anything, which is why the previous failure produced no
   * diagnosis. `login` returns void, so a caller cannot `.catch()` it either;
   * this callback is the only channel.
   */
  const { login } = useLogin({
    onComplete: () => setLastError(null),
    onError: (code) => fail(String(code)),
  });
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws();
  const { linkWallet: privyLinkWallet } = useLinkAccount({
    onError: (code) => fail(String(code)),
  });
  const { wallets } = useWallets();
  // The browser's wallet-standard registry, read directly (standard-wallets.ts)
  // rather than through the provider, so detection does not wait on the SDK.
  const standardWallets = useStandardWalletList();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const { fundWallet } = useFundWallet();
  const { exportWallet: privyExportWallet } = useExportWallet();

  // Registered in this browser, connected or not — what "DETECTED" means.
  const detectedWallets = useMemo(() => toDetected(standardWallets), [standardWallets]);

  /*
   * The player's active-wallet choice, persisted per Privy user. Read during
   * render (this component is client-only) rather than in an effect — the
   * update-loop rule in auth-provider.tsx and the lint rule that enforces it
   * both refuse setState inside an effect body.
   */
  const storageKey = user?.id ? `blotto.activeWallet.${user.id}` : null;
  const stored = useMemo(() => {
    if (!storageKey) return null;
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [storageKey]);
  const [override, setOverride] = useState<{ key: string; address: string } | null>(null);
  const chosen = override && override.key === storageKey ? override.address : stored;
  const setActiveWallet = useCallback(
    (addr: string) => {
      if (!storageKey) return;
      setOverride({ key: storageKey, address: addr });
      try {
        window.localStorage.setItem(storageKey, addr);
      } catch {
        // Storage can be unavailable (private mode); the choice still holds
        // for this session through `override`.
      }
    },
    [storageKey],
  );

  const signInWithWallet = useCallback(
    async (id: string) => {
      const w = findStandardWallet(standardWallets, id);
      if (!w) {
        fail("blotto_wallet_not_detected");
        return;
      }
      // The sequence itself lives in standard-wallets.ts (unit-tested with a
      // fake wallet); the provider contributes exactly these two calls.
      const outcome = await siwsSignIn(w, {
        generateSiwsMessage,
        loginWithSiws,
        // INCIDENT 2026-09-09 (founder: "the wallet signed in, but the
        // sign-in could not be completed"): this sent the signature BASE58,
        // and the provider refused every one. The provider's own modal
        // encodes a plain-text Solana sign-in signature as BASE64 (its
        // SiwsFlow: `base64.encode(signature)` from @scure/base, read from
        // the installed SDK), so that is what its endpoint verifies.
        encodeSignature: signatureToBase64,
      });
      if (outcome.ok) {
        setLastError(null);
        return;
      }
      if (outcome.code === "blotto_wallet_no_headless_path") {
        // No headless path for this wallet — the provider's flow handles it.
        login({ loginMethods: ["wallet"], walletChainType: "solana-only" });
        return;
      }
      if (outcome.detail) console.error("[auth] wallet sign-in failed:", outcome.detail);
      fail(outcome.code, outcome.detail ? shortDetail(outcome.detail) : undefined);
    },
    [standardWallets, login, generateSiwsMessage, loginWithSiws, fail],
  );

  const value = useMemo<Auth>(() => {
    /*
     * The wallets that belong to THIS account, in the provider's own record:
     * the embedded wallet made at a social sign-in, a wallet the player
     * signed in with, a wallet they attached on the wallet screen. This set
     * — not "whatever is connected in the browser" — decides which wallet
     * enters and is paid.
     *
     * INCIDENT 2026-09-09 (founder: "it will connect me to a MetaMask
     * wallet"): a Solana-enabled MetaMask exposes its account to the page at
     * the wallet-standard level without the player choosing it here, and
     * the previous default — "the first external signer" — picked it up
     * ahead of the Phantom wallet the player had actually signed in with.
     * The attestation prompt then went to MetaMask, which could not sign it.
     */
    const linkedAddresses = new Set<string>();
    for (const a of user?.linkedAccounts ?? []) {
      if (a.type === "wallet" && a.chainType === "solana" && "address" in a) {
        linkedAddresses.add(a.address);
      }
    }

    // Each wallet Privy reports as connected, as a TxSigner (10.B Step 2 tx
    // seam): one signing interface for both paths — the embedded wallet
    // registers as the wallet-standard wallet named "Privy"; everything else
    // is an external connector (Phantom / Solflare / …).
    const privySigners: TxSigner[] = wallets.map((wallet) => ({
      address: wallet.address,
      kind: isEmbeddedName(wallet.standardWallet.name) ? "embedded" : "external",
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

    /*
     * A wallet the player signed in with THROUGH THE ONE-TAP DOOR is connected
     * at the wallet-standard level whether or not Privy's own connector has
     * caught up with it. Its signing features are addressed directly, so the
     * play flow never sees "an address with no signer behind it" for a wallet
     * that is demonstrably connected and able to sign. Privy's own entry for
     * the same address wins when both exist.
     * PHASE-N-REVIEW: whether Privy's connector always mirrors a connection
     * made outside its modal is unverified against a real extension; this
     * fallback makes the answer not matter.
     */
    const known = new Set(privySigners.map((s) => s.address));
    const standardSigners: TxSigner[] = [];
    for (const w of standardWallets) {
      if (isEmbeddedName(w.name)) continue;
      const signTx = featureOf<SignTransactionFeature>(w, "solana:signTransaction");
      const signMsg = featureOf<SignMessageFeature>(w, "solana:signMessage");
      if (!signTx) continue;
      for (const account of w.accounts) {
        if (known.has(account.address)) continue;
        // Only an account this player's provider record names. An account
        // some other extension merely exposes to the page is not theirs to
        // enter with, and must never become the active wallet by accident.
        if (!linkedAddresses.has(account.address)) continue;
        known.add(account.address);
        standardSigners.push({
          address: account.address,
          kind: "external",
          label: w.name,
          signTransaction: async (transaction: Uint8Array) => {
            const [out] = await signTx.signTransaction({
              account,
              transaction,
              chain: SOLANA_CHAIN,
            });
            if (!out) throw new Error(`${w.name} returned no signed transaction`);
            return out.signedTransaction;
          },
          signMessage: signMsg
            ? async (message: Uint8Array) => {
                const [out] = await signMsg.signMessage({ account, message });
                if (!out) throw new Error(`${w.name} returned no signature`);
                return out.signature;
              }
            : undefined,
        });
      }
    }
    const signers = [...privySigners, ...standardSigners];

    /*
     * THE ACTIVE WALLET — the one that enters, is paid, and whose balance is
     * shown. The player's stored choice wins while that wallet is connected.
     * Otherwise an EXTERNAL wallet is preferred over the embedded one:
     * PHASE-N-REVIEW: a Google sign-in only ever has a second wallet because
     * the player deliberately attached it ("use a different wallet"), and a
     * Phantom sign-in has no embedded wallet at all — so preferring external
     * is following the player's own action, not a surprise. The picker on the
     * wallet screen lets them switch back, and the choice persists.
     */
    // The rule and its reasons live in active-wallet.ts, unit-pinned.
    const walletAddress = pickActiveWallet({ signers, linked: linkedAddresses, chosen });

    const hasEmbedded = signers.some((s) => s.kind === "embedded");

    return {
      status: !ready
        ? "initializing"
        : authenticated
          ? "signed-in"
          : "signed-out",
      walletAddress,
      signers,
      detectedWallets,
      lastError,
      clearError,
      signInWithSocial: (provider: SocialProvider) =>
        login({ loginMethods: [provider] }),
      signInWithWallet,
      connectWallet: () =>
        login({ loginMethods: ["wallet"], walletChainType: "solana-only" }),
      setActiveWallet,
      signOut: logout,
      // C9: Privy's funding flow, exposed as the provider-neutral seam. The
      // top-up button additionally hides behind NEXT_PUBLIC_TOPUP_ENABLED.
      //
      // The chain is EXPLICIT for the same reason it is on signTransaction
      // above: the SDK's own default for an unspecified Solana funding
      // request is MAINNET (SolanaFundingConfig.chain is optional). Omitting
      // it here — as this call did until 2026-09-08 — pointed the funding
      // flow at mainnet while every balance read, signature and settlement
      // in this app is devnet, so a player could have spent real money into
      // a wallet the app then reports as empty.
      //
      // `receive` opens straight onto the deposit-address screen: on devnet
      // it is the only funding method that can work, since no card or
      // exchange provider sells devnet SOL. This resolves when the funding
      // MODAL OPENS, not when funds arrive (the SDK's own note: "funds can
      // take a few minutes to arrive"). Callers must not read it as
      // completion.
      addFunds: async (fundAddress: string, options?: AddFundsOptions) => {
        await fundWallet({
          address: fundAddress,
          options: {
            chain: SOLANA_CHAIN,
            ...(options?.method === "receive"
              ? { defaultFundingMethod: "manual" as const }
              : {}),
            uiConfig: {
              receiveFundsTitle: COPY.wallet.receiveTitle,
              receiveFundsSubtitle: COPY.wallet.receiveSubtitle,
            },
          },
        });
      },
      // The "move my wallet to Phantom" exit: Privy shows the private key in
      // a cross-domain iframe this app cannot read. Embedded wallets only —
      // an external wallet's key is already the player's.
      exportWallet: hasEmbedded
        ? async (walletAddr: string) => {
            await privyExportWallet({ address: walletAddr });
          }
        : undefined,
      // Attach a wallet the player already has to THIS account, so a Google
      // sign-in can play and be paid with Phantom without a second identity.
      linkWallet: authenticated
        ? () =>
            privyLinkWallet({
              walletChainType: "solana-only",
              walletList: WALLET_LIST,
              description: COPY.wallet.linkDescription,
            })
        : undefined,
    };
  }, [
    ready,
    authenticated,
    user,
    wallets,
    standardWallets,
    detectedWallets,
    lastError,
    clearError,
    chosen,
    setActiveWallet,
    signInWithWallet,
    signTransaction,
    signMessage,
    fundWallet,
    privyExportWallet,
    privyLinkWallet,
    login,
    logout,
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
        // Apple stays listed while the founder's dashboard decision is open;
        // the sign-in page's SOCIALS array is where its button is removed.
        loginMethods: ["google", "apple", "twitter", "wallet"],
        appearance: {
          // Literals required here (provider-modal config consumed by the
          // Privy SDK, not component styling) — keep in sync with
          // --color-base and --color-brand in src/styles/tokens.css. The
          // theme takes a hex ground, so the provider's modal sits on the
          // product's plum rather than a generic dark.
          theme: "#5e1b40",
          accentColor: "#ff7ac8",
          walletChainType: "solana-only",
          walletList: WALLET_LIST,
          showWalletLoginFirst: false,
          landingHeader: COPY.signin.title,
          loginMessage: COPY.signin.modalMessage,
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
