"use client";

/*
 * The auth shell (D-08 swappability, restructured by D4 for the Lighthouse
 * performance bar): page content consumes the app's own AuthContext, and
 * the provider SDK loads as a LAZY BRIDGE (next/dynamic, ssr:false) that
 * feeds that context — so the SDK chunk never sits in the first-load
 * bundle of every page, and the page tree never remounts when it arrives.
 * Until the bridge reports, auth is "initializing"; the header reserves
 * its slot for exactly this state.
 *
 * Without NEXT_PUBLIC_PRIVY_APP_ID the app still renders (signed-out,
 * sign-in disabled with a console warning) — previews and local dev must
 * not crash before credentials exist.
 */

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AuthContext } from "./auth-context";
import { sameAuthState } from "./auth-state";
import type { Auth } from "./types";

const PrivyBridge = dynamic(() => import("./privy-bridge"), { ssr: false });

const INITIALIZING: Auth = {
  status: "initializing",
  walletAddress: null,
  signers: [],
  // Inert until the bridge loads — the header shows no sign-in affordance
  // in the initializing state, so these cannot be reached from the UI.
  signInWithSocial: () => {},
  connectWallet: () => {},
  signOut: async () => {},
};

/*
 * UPDATE-LOOP RULE (production incident, 2026-08-28): the bridge's adapter
 * rebuilds its Auth object whenever any provider-SDK hook return changes
 * identity — and once the SDK finishes initializing (real credentials
 * only, so no fixture-mode test catches it), some of those returns are
 * fresh objects on EVERY render. Feeding each rebuild straight into
 * `setLive` re-rendered this provider, which re-rendered the adapter,
 * which rebuilt the object again — an infinite loop (React #185) that
 * took the whole page down to the default error screen on Vercel. The
 * guard below therefore keeps the PREVIOUS state object whenever the new
 * one is meaningfully identical, so React bails out of the re-render and
 * the cycle stops (comparator: ./auth-state.ts, unit-pinned). Never hand
 * `setLive` to the bridge unguarded.
 */

/** Renders when Privy credentials are absent: app works, sign-in is inert. */
function unconfiguredAuth(): Auth {
  const warn = () =>
    console.warn(
      "[auth] NEXT_PUBLIC_PRIVY_APP_ID is not set — sign-in is disabled. " +
        "See app/.env.example.",
    );
  return {
    status: "signed-out",
    walletAddress: null,
    signers: [],
    signInWithSocial: warn,
    connectWallet: warn,
    signOut: async () => warn(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [live, setLive] = useState<Auth | null>(null);

  // See the update-loop rule above. Keeping the previous object also keeps
  // its callback closures; that is safe — the SDK's functions dispatch to
  // one underlying client, and any change that matters (sign-in, sign-out,
  // wallet connect) alters the compared fields and adopts the fresh object.
  const onAuth = useCallback((next: Auth) => {
    setLive((prev) =>
      prev !== null && sameAuthState(prev, next) ? prev : next,
    );
  }, []);

  const value = useMemo<Auth>(
    () => live ?? (appId ? INITIALIZING : unconfiguredAuth()),
    [live, appId],
  );

  return (
    <AuthContext.Provider value={value}>
      {appId ? <PrivyBridge appId={appId} onAuth={onAuth} /> : null}
      {children}
    </AuthContext.Provider>
  );
}
