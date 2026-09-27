"use client";

/*
 * The React half of the direct wallet session (see direct-sign-in.ts for
 * why it exists). Owns: the live session, the silent reconnect on load, the
 * one storage entry that remembers which wallet to reconnect, and the Auth
 * object the rest of the app reads.
 *
 * STORAGE (storage/opaque-key.ts policy, 2026-09-16): the key names neither
 * the purpose nor the wallet, and the value carries the wallet-standard id
 * ("phantom") plus a TOKEN of the address — never the address. On load the
 * wallet is reconnected silently and the account whose token matches is the
 * session; if the player switched accounts inside the wallet, nothing
 * matches and they simply sign in again.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Wallet } from "@wallet-standard/base";
import { opaqueKey, opaqueToken } from "@/storage/opaque-key";
import type { Auth, AuthFailure } from "./types";
import { findStandardWallet, useDetectedSolanaWallets, useStandardWalletList } from "./standard-wallets";
import { directReconnect, directSignIn, directSigners, randomNonce } from "./direct-sign-in";

const PURPOSE = "direct-session";
const STORAGE_KEY = opaqueKey(PURPOSE, "active");

interface Remembered {
  id: string;
  token: string;
}

function readRemembered(): Remembered | null {
  if (STORAGE_KEY === null) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Remembered>;
    return typeof parsed.id === "string" && typeof parsed.token === "string" ? { id: parsed.id, token: parsed.token } : null;
  } catch {
    return null;
  }
}

function remember(value: Remembered | null): void {
  if (STORAGE_KEY === null) return;
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be closed (private mode); the session still holds in memory.
  }
}

interface Session {
  id: string;
  address: string;
  wallet: Wallet;
}

export interface DirectSession {
  /** The signed-in Auth, or null while there is no direct session. */
  auth: Auth | null;
  /** One-tap sign-in with a detected wallet, by its id. */
  signIn(id: string): Promise<void>;
  lastError: AuthFailure | null;
  clearError(): void;
}

export function useDirectSession(): DirectSession {
  const wallets = useStandardWalletList();
  const detected = useDetectedSolanaWallets();
  const [session, setSession] = useState<Session | null>(null);
  const [lastError, setLastError] = useState<AuthFailure | null>(null);
  // The silent reconnect runs once per remembered wallet, the moment the
  // wallet registers in the page; never again in the same load.
  const reconnected = useRef<string | null>(null);

  useEffect(() => {
    if (session) return;
    const stored = readRemembered();
    if (!stored || reconnected.current === stored.id) return;
    const wallet = findStandardWallet(wallets, stored.id);
    if (!wallet) return;
    reconnected.current = stored.id;
    let cancelled = false;
    void directReconnect(wallet, (address) => opaqueToken(PURPOSE, address) === stored.token).then((account) => {
      if (cancelled) return;
      if (account) setSession({ id: stored.id, address: account.address, wallet });
      else remember(null);
    });
    return () => {
      cancelled = true;
    };
  }, [wallets, session]);

  const signIn = useCallback(
    async (id: string) => {
      const wallet = findStandardWallet(wallets, id);
      if (!wallet) {
        setLastError({ code: "blotto_wallet_not_detected", at: Date.now() });
        return;
      }
      const outcome = await directSignIn(wallet, {
        nonce: randomNonce,
        issuedAt: () => new Date().toISOString(),
      });
      if (!outcome.ok) {
        if (outcome.detail) console.error("[auth] direct wallet sign-in failed:", outcome.detail);
        setLastError({ code: outcome.code, at: Date.now(), ...(outcome.detail ? { detail: outcome.detail } : {}) });
        return;
      }
      setLastError(null);
      const token = opaqueToken(PURPOSE, outcome.address);
      remember(token ? { id: outcome.walletId, token } : null);
      setSession({ id: outcome.walletId, address: outcome.address, wallet });
    },
    [wallets],
  );

  const clearError = useCallback(() => setLastError(null), []);

  const signOut = useCallback(async () => {
    const current = session;
    setSession(null);
    remember(null);
    reconnected.current = null;
    if (!current) return;
    const disconnect = (current.wallet.features as Record<string, { disconnect?: () => Promise<void> }>)[
      "standard:disconnect"
    ];
    try {
      await disconnect?.disconnect?.();
    } catch {
      // The wallet may refuse or lack the feature; the app-side session is gone either way.
    }
  }, [session]);

  const auth = useMemo<Auth | null>(() => {
    if (!session) return null;
    const signers = directSigners(session.wallet);
    return {
      status: "signed-in",
      walletAddress: session.address,
      email: null,
      signers,
      detectedWallets: detected,
      lastError,
      clearError,
      // Already signed in: the social and secondary routes are inert here.
      signInWithSocial: () => {},
      signInWithWallet: signIn,
      connectWallet: () => {},
      setActiveWallet: (address) => {
        if (signers.some((s) => s.address === address)) {
          const token = opaqueToken(PURPOSE, address);
          remember(token ? { id: session.id, token } : null);
          setSession({ ...session, address });
        }
      },
      signOut,
    };
  }, [session, detected, lastError, clearError, signIn, signOut]);

  return { auth, signIn, lastError, clearError };
}
