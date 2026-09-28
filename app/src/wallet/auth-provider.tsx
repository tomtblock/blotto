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
 *
 * The same is now true when the app ID is PRESENT BUT INVALID. Measured
 * 2026-09-08 by driving a real browser at a build carrying a malformed ID:
 * `PrivyProvider` throws during render ("Cannot initialize the Privy provider
 * with an invalid Privy app ID"), and because the bridge sits beside
 * `{children}` under this provider, that throw took the WHOLE PAGE down —
 * every button gone, replaced by "This page couldn't load", which tells an
 * operator nothing about the cause. One mistyped character in a deployment
 * setting is enough. The bridge is now isolated behind an error boundary:
 * it renders nothing visible, so containing its failure costs nothing, and
 * sign-in degrades to the same honest disabled state as an absent ID.
 */

import dynamic from "next/dynamic";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { testSignerFromWindow } from "../tx/test-signer";
import { AuthContext } from "./auth-context";
import { AUTH_INIT_TIMEOUT_MS, selectAuth, unavailableMessage } from "./auth-select";
import { sameAuthState } from "./auth-state";
import { useDetectedSolanaWallets } from "./standard-wallets";
import { useDirectSession } from "./direct-session";
import type { Auth } from "./types";

const PrivyBridge = dynamic(() => import("./privy-bridge"), { ssr: false });

/*
 * WHEN THE BRIDGE LOADS (2026-09-27, page speed). The provider SDK and the
 * wallet adapters it carries are the largest thing the browser downloads
 * (about 500 KB gzipped over three chunks), and they used to start the
 * moment any page mounted — ahead of the hero, the card and the board. A
 * returning session (the provider keeps its token under `privy:` keys in
 * storage) still loads it at once, so a signed-in player's header settles
 * as before. A first-time visitor gets it once the page has painted and
 * the main thread is idle (bounded at 2.5 s), or on their first touch or
 * keypress, whichever comes first — so pressing Sign in never waits on a
 * timer. The ten-second deadline below starts when the bridge mounts.
 */
const IDLE_LOAD_TIMEOUT_MS = 2_500;
const SESSION_KEY_PREFIX = "privy:";

function hasProviderSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith(SESSION_KEY_PREFIX)) return true;
    }
  } catch {
    // Storage closed: treat as a first visit.
  }
  return false;
}

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

/*
 * C7 / B-e — the automation signer, behind three gates.
 *
 * Stage D 5.1 requires 64 automated entrants through the REAL front end, not
 * through the API, and embedded auth cannot be automated. `test-signer.ts`
 * has existed since the 10.B signing spike with nothing importing it; this is
 * the wiring, and every gate here is load-bearing:
 *
 *   1. BUILD-TIME FLAG. Next inlines NEXT_PUBLIC_* literally, so with the flag
 *      unset this function collapses to `return null` and everything below is
 *      unreachable — which the minifier drops. That is asserted, not assumed:
 *      the app-test-signer CI lane builds with the flag unset and greps the
 *      bundle for the injected global's name. The same lane builds WITH the
 *      flag on and requires the name to be present, so a grep that could only
 *      ever pass cannot masquerade as a gate.
 *   2. DEVNET ONLY. The app is devnet by construction (privy-bridge's
 *      SOLANA_CHAIN), but an operator can repoint the RPC — so the endpoint
 *      must name devnet, or be unset and take tx-rpc's devnet fallback.
 *      Fail-closed: anything else refuses.
 *   3. THE INJECTION ITSELF, absent in any ordinary browser.
 *
 * Never present outside a test-driven browser context — all three must hold.
 */
function testSignerAuth(): Auth | null {
  if (process.env.NEXT_PUBLIC_ALLOW_TEST_SIGNER !== "1") return null;

  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "";
  if (rpc !== "" && !/devnet/i.test(rpc)) return null;

  const signer = testSignerFromWindow();
  if (signer === null) return null;

  return {
    status: "signed-in",
    walletAddress: signer.address,
    email: null,
    signers: [signer],
    detectedWallets: [],
    lastError: null,
    // A driven browser never reaches these: the header renders no sign-in
    // affordance while signed in, and the run drives the play flow directly.
    clearError: () => {},
    signInWithSocial: () => {},
    signInWithWallet: async () => {},
    connectWallet: () => {},
    setActiveWallet: () => {},
    signOut: async () => {},
  };
}

/**
 * Contains a throw from the lazy bridge.
 *
 * A class, because React error boundaries can only be classes — there is no
 * hook form. It renders its children unchanged until one of them throws, and
 * nothing at all afterwards; the bridge is invisible either way, so the page
 * is unaffected apart from sign-in going inert.
 */
class BridgeBoundary extends Component<
  { children: ReactNode; onFailure: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged in full HERE, where the real cause is still in hand. The context
    // fallback can only offer generic advice; this is the line that names the
    // provider's own complaint.
    console.error(
      "[auth] the Privy bridge failed to initialise — sign-in is disabled:",
      error?.message ?? error,
      info?.componentStack ?? "",
    );
    this.props.onFailure(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [live, setLive] = useState<Auth | null>(null);
  // Whether the bridge should be mounted yet (see WHEN THE BRIDGE LOADS).
  // The initialiser runs once, in the browser; on the server the bridge is
  // never rendered (ssr: false), so the markup agrees either way.
  const [wantBridge, setWantBridge] = useState<boolean>(() => typeof window !== "undefined" && hasProviderSession());
  useEffect(() => {
    if (wantBridge || !appId) return;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setWantBridge(true);
    };
    // Safari has no requestIdleCallback; a plain timer stands in there.
    const hasIdle = typeof window.requestIdleCallback === "function";
    const idle = hasIdle
      ? window.requestIdleCallback(go, { timeout: IDLE_LOAD_TIMEOUT_MS })
      : window.setTimeout(go, IDLE_LOAD_TIMEOUT_MS);
    const opts = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", go, opts);
    window.addEventListener("keydown", go, opts);
    return () => {
      if (hasIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
  }, [wantBridge, appId]);
  // Set once, by the boundary below, when the bridge cannot initialise.
  const [bridgeRejected, setBridgeRejected] = useState(false);
  // Set once, by the deadline below, when the bridge has not reported in
  // time. Never cleared: a late report wins on its own through `live`.
  const [bridgeTimedOut, setBridgeTimedOut] = useState(false);
  // Resolved once, during render. `testSignerAuth` reads `window`, so this is
  // null on the server and stays null in every deployable build — the whole
  // branch is eliminated there (see next.config.ts), so no ordinary render
  // path is affected. Deliberately NOT an effect: setState in an effect body
  // triggers the cascading re-render this file's update-loop rule exists to
  // prevent, and eslint refuses it.
  const injected = useMemo(() => testSignerAuth(), []);
  // Detection is a fact about the browser, not the provider: the sign-in
  // surface lists a registered wallet as DETECTED before the SDK has loaded,
  // and in a build with no credential at all. The bridge reads the same
  // store, so the live value agrees.
  const detected = useDetectedSolanaWallets();
  // The direct wallet session (V2, 2026-09-27): an external wallet signed in
  // without the provider. Its hook reads the same wallet-standard store.
  const direct = useDirectSession();

  // See the update-loop rule above. Keeping the previous object also keeps
  // its callback closures; that is safe — the SDK's functions dispatch to
  // one underlying client, and any change that matters (sign-in, sign-out,
  // wallet connect) alters the compared fields and adopts the fresh object.
  const onAuth = useCallback((next: Auth) => {
    setLive((prev) =>
      prev !== null && sameAuthState(prev, next) ? prev : next,
    );
  }, []);

  // Guarded so a repeated failure cannot re-enter the update loop this file's
  // rule exists to prevent: the flag only ever goes false -> true, once.
  const onBridgeFailure = useCallback(() => {
    setBridgeRejected((prev) => (prev ? prev : true));
  }, []);

  /*
   * THE DEADLINE (audit 2026-09-11, C-03 — the reasoning is in
   * auth-select.ts). Armed only while there is something to wait for: a
   * credential, no report yet, no rejection, no injected signer. The state
   * write happens inside the timer callback, never in the effect body, so
   * this cannot join the update loop the rule above guards against; and it
   * only ever goes false -> true, once. The console line fires here, at the
   * moment of the deadline, so an operator reading a support screenshot sees
   * the cause without anyone having to click a disabled button first.
   */
  useEffect(() => {
    if (injected || live !== null || !appId || !wantBridge || bridgeRejected || bridgeTimedOut) return;
    const timer = setTimeout(() => {
      console.warn(unavailableMessage("unreachable"));
      setBridgeTimedOut((prev) => (prev ? prev : true));
    }, AUTH_INIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [injected, live, appId, wantBridge, bridgeRejected, bridgeTimedOut]);

  const value = useMemo<Auth>(
    () =>
      selectAuth({
        injected,
        direct: direct.auth,
        directSignIn: direct.signIn,
        directError: direct.lastError,
        directClearError: direct.clearError,
        live,
        appId,
        bridgeRejected,
        bridgeTimedOut,
        detected,
      }),
    [injected, direct.auth, direct.signIn, direct.lastError, direct.clearError, live, appId, bridgeRejected, bridgeTimedOut, detected],
  );

  return (
    <AuthContext.Provider value={value}>
      {appId && wantBridge && !bridgeRejected ? (
        <BridgeBoundary onFailure={onBridgeFailure}>
          <PrivyBridge appId={appId} onAuth={onAuth} />
        </BridgeBoundary>
      ) : null}
      {children}
    </AuthContext.Provider>
  );
}
