/*
 * Which Auth the shell shows, as a pure function of what it knows.
 *
 * Moved out of auth-provider.tsx on 2026-09-12 so the decision is testable
 * without a provider SDK, a lazy bridge or a browser — the same discipline
 * as entry/geo-gate.ts: logic here, React state around it.
 *
 * THE DEADLINE (audit 2026-09-11, C-03). Auth was "initializing" for exactly
 * as long as the provider's ready flag was false, and nothing ever timed
 * that out. The provider's own initialisation ends in a catch that logs and
 * never sets ready, so any failure of its first round trip — an outage, a
 * tracker blocklist, a corporate DNS filter — pinned the whole app: the
 * header rendered an inert placeholder where the sign-in link goes, the
 * sign-in page disabled every button with no explanation, and the entry
 * page pointed at a control that was not there. Nobody could sign in,
 * nobody could enter, and nobody got a diagnostic string.
 *
 * Now the shell waits AUTH_INIT_TIMEOUT_MS and then falls through to an
 * honest signed-out state that names the cause, which the header renders
 * as the sign-in link and the sign-in page explains. The bridge stays
 * mounted, so a provider that merely took its time still takes over the
 * moment it reports — `live` wins over everything below it.
 */

import type { Auth, AuthFailure, DetectedWallet } from "./types";

/**
 * How long the shell waits for the provider before saying so.
 *
 * PHASE-N-REVIEW: ten seconds is a judgement, not a ratified number. Longer
 * than the entry page's eight-second geo ceiling because the SDK loads a
 * script, an iframe and an API round trip rather than one GET; short enough
 * that a blocked network is explained before a person gives up on the page.
 * A too-short value degrades gracefully — the sign-in page says
 * "unavailable" until the provider arrives, then enables — so the cost of
 * being wrong here is a few seconds of pessimism, never a dead end.
 */
export const AUTH_INIT_TIMEOUT_MS = 10_000;

export const INITIALIZING: Auth = {
  status: "initializing",
  walletAddress: null,
  email: null,
  signers: [],
  detectedWallets: [],
  lastError: null,
  // Inert until the bridge loads — the header shows no sign-in affordance
  // in the initializing state, so these cannot be reached from the UI.
  clearError: () => {},
  signInWithSocial: () => {},
  signInWithWallet: async () => {},
  connectWallet: () => {},
  setActiveWallet: () => {},
  signOut: async () => {},
};

/** The operator-facing line for each way sign-in can be off. */
export function unavailableMessage(reason: "absent" | "rejected" | "unreachable"): string {
  switch (reason) {
    case "absent":
      return (
        "[auth] NEXT_PUBLIC_PRIVY_APP_ID is not set — sign-in is disabled. " +
        "See app/.env.example."
      );
    case "rejected":
      return (
        "[auth] the Privy provider rejected NEXT_PUBLIC_PRIVY_APP_ID — sign-in " +
        "is disabled. The value is set but not valid: check it against the app " +
        "ID in the Privy dashboard (Configuration -> App settings -> Basics), " +
        "and remember NEXT_PUBLIC_ values are baked in at BUILD time, so a " +
        "corrected value needs a redeploy."
      );
    case "unreachable":
      return (
        `[auth] the sign-in provider did not report ready within ${AUTH_INIT_TIMEOUT_MS / 1000}s — ` +
        "sign-in is disabled until it does. Its script or its API (auth.privy.io) " +
        "may be blocked on this network or unavailable. Sign-in resumes on its own " +
        "if the provider comes up; a reload retries from scratch."
      );
  }
}

/**
 * Renders when sign-in cannot work: the app works, sign-in is inert.
 *
 * `reason` distinguishes the three ways to get here, because they need
 * different fixes and an operator reading the console must be able to tell
 * them apart: no credential at all, a credential the provider rejected, or a
 * provider that never answered.
 */
export function unconfiguredAuth(reason: "absent" | "rejected" | "unreachable"): Auth {
  const message = unavailableMessage(reason);
  const warn = () => console.warn(message);
  return {
    status: "signed-out",
    unavailable: reason,
    walletAddress: null,
    email: null,
    signers: [],
    detectedWallets: [],
    lastError: null,
    clearError: () => {},
    signInWithSocial: warn,
    signInWithWallet: async () => warn(),
    connectWallet: warn,
    setActiveWallet: warn,
    signOut: async () => warn(),
  };
}

export interface AuthInputs {
  /** The automation signer, when its three gates all hold (see auth-provider). */
  injected: Auth | null;
  /**
   * The direct wallet session (V2, 2026-09-27: wallet/direct-session.tsx),
   * when a player has signed in with an external wallet through it. It
   * outranks the provider's report: it is an explicit choice the player
   * made on this device, and the provider cannot currently complete an
   * external-wallet sign-in at all (its message names the wrong chain).
   */
  direct?: Auth | null;
  /** The direct route's sign-in and error channel, offered on every signed-out state. */
  directSignIn?: (id: string) => Promise<void>;
  directError?: AuthFailure | null;
  directClearError?: () => void;
  /** What the bridge last reported, or null before it has reported at all. */
  live: Auth | null;
  appId: string | undefined;
  /** The bridge threw during initialisation (the error boundary fired). */
  bridgeRejected: boolean;
  /** AUTH_INIT_TIMEOUT_MS passed with no report from the bridge. */
  bridgeTimedOut: boolean;
  detected: readonly DetectedWallet[];
}

/**
 * The precedence, top to bottom. Every branch below `live` is a fallback,
 * and `live` beats all of them: a provider that reports late is taken up
 * whatever the shell had concluded in the meantime.
 */
export function selectAuth(i: AuthInputs): Auth {
  if (i.injected) return i.injected;
  if (i.direct) return i.direct;
  const base = i.live
    ? i.live
    : !i.appId
      ? { ...unconfiguredAuth("absent"), detectedWallets: i.detected }
      : i.bridgeRejected
        ? { ...unconfiguredAuth("rejected"), detectedWallets: i.detected }
        : i.bridgeTimedOut
          ? { ...unconfiguredAuth("unreachable"), detectedWallets: i.detected }
          : { ...INITIALIZING, detectedWallets: i.detected };
  if (base.status === "signed-in" || !i.directSignIn) return base;
  // Signed out (or the provider absent, rejected, late): an external wallet
  // still signs in through the direct route, whatever the provider's state.
  return {
    ...base,
    signInWithWallet: i.directSignIn,
    lastError: base.lastError ?? i.directError ?? null,
    clearError: () => {
      base.clearError();
      i.directClearError?.();
    },
  };
}
