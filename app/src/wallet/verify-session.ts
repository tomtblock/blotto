/*
 * BR-002 — SERVER-VERIFIED SESSION primitive (the server half, and ONLY the server half).
 *
 * `verifySession(token)` verifies a Privy access token SERVER-SIDE and returns the
 * authenticated account identifier. This is the ONLY trustworthy answer to "who is
 * calling?" for a privileged write: the identifier is derived from a cryptographically
 * verified JWT, NEVER from a client assertion. A client can claim any account; only a
 * verified token proves one.
 *
 * WHY THIS EXISTS. The referral gate (`lib/referral/contract.ts`) can validate a code
 * today but cannot REDEEM one, because redemption binds a code single-use to an account
 * and that account must be server-verified or the binding is forgeable. The /redeem route
 * therefore ships a deliberate `501 awaiting_server_verified_identity_BR_002`. This module
 * is the primitive that unblocks that wiring.
 *
 * WHAT THIS IS NOT — SCOPE FENCE. This step ships the primitive ONLY. It does NOT wire
 * `/api/referral/redeem` (that 501 stays exactly as-is), does not touch any UI, and does
 * not call `redeemReferralCode`. Wiring the primitive into redeem — extract the token from
 * the request header, `verifySession` it, then call `redeemReferralCode(code, account)`
 * AFTER the launch tx confirms (the call order pinned in contract.ts) — is a SEPARATE
 * later step.
 *
 * THE ACCOUNT IDENTIFIER = the Privy DID (`AuthTokenClaims.userId`, e.g.
 * "did:privy:clx…"). Rationale:
 *   - It is what token verification NATIVELY returns — no second `getUser()` round-trip,
 *     so the primitive fails closed on one call and has no partial-success state.
 *   - It is the durable, per-PERSON identity: one login == one DID, regardless of how many
 *     wallets that user connects. Single-use referral redemption is a per-person rule, so
 *     binding to the DID is the defensible anti-abuse anchor. Binding to a wallet address
 *     would let one person burn multiple codes by connecting multiple external wallets.
 *   - The return shape stays provider-NEUTRAL (`{ account: string }`) in the D-08
 *     swappability spirit: the redeem wiring depends on "an account string", not on Privy.
 * `contract.ts`'s `redeemReferralCode(code, account)` is identifier-agnostic (`account:
 * string`), so this is the step that commits the identifier. The redeem-wiring step must
 * use the SAME identifier this returns — flagged for founder/redeem-step ratification.
 *
 * SDK NOTE. Uses `@privy-io/server-auth` (stable v1.x; token verification is its purpose,
 * via local `jose` JWT checks). Privy's newer `@privy-io/node` SDK was rejected here: it is
 * pre-1.0 (0.x) and pulls a `@solana/kit@^5` peer that conflicts with this app's kit
 * version — a heavy footprint for a pure token-verify primitive.
 */

import { PrivyClient, type AuthTokenClaims } from "@privy-io/server-auth";
import { assertServerOnly } from "./server-guard";

// Server-only, defence-in-depth: if this module is ever pulled into a client bundle it
// throws the moment it runs in a browser, rather than leaking the app secret path.
assertServerOnly("wallet/verify-session");

/**
 * Thrown when Privy server credentials are absent. This is a DEPLOY misconfiguration, not
 * a normal auth outcome, so it is thrown (fail closed, loud) rather than returned as an
 * `{ error }` result — the server must never fall back to trusting client input.
 */
export class PrivyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivyConfigError";
  }
}

/** Outcome of a verification attempt. `{ account }` on success, `{ error }` on failure. */
export type VerifySessionResult =
  | { account: string }
  | { error: "invalid_session" };

/**
 * The one capability this primitive needs from the SDK. Declaring it (rather than
 * depending on the concrete `PrivyClient`) is the test seam: unit tests inject a fake and
 * never touch the network. `PrivyClient` satisfies it structurally.
 */
export interface SessionVerifier {
  verifyAuthToken(token: string): Promise<AuthTokenClaims>;
}

/**
 * Build the Privy server client from env, failing CLOSED if either credential is missing.
 *
 * The app ID is read from `NEXT_PUBLIC_PRIVY_APP_ID` — the app ID is not a secret (it is
 * already the value handed to the client `PrivyProvider`), so there is deliberately no
 * separate server-only `PRIVY_APP_ID`. The secret is `PRIVY_APP_SECRET` (server-side only,
 * per `apps/web/.env.example`).
 */
export function buildSessionVerifier(
  env: NodeJS.ProcessEnv = process.env,
): SessionVerifier {
  const appId = env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  if (!appId) {
    throw new PrivyConfigError(
      "NEXT_PUBLIC_PRIVY_APP_ID is not set — cannot verify sessions server-side.",
    );
  }
  if (!appSecret) {
    throw new PrivyConfigError(
      "PRIVY_APP_SECRET is not set — cannot verify sessions server-side.",
    );
  }
  return new PrivyClient(appId, appSecret);
}

/**
 * Verify a Privy access token and return the authenticated account (the Privy DID).
 *
 * @param token The raw Privy access token (JWT). The caller (a route handler, in the later
 *   wiring step) is responsible for stripping any `Bearer ` prefix before calling this.
 * @param verifier Injectable for tests; defaults to a real Privy client built from env.
 *   NOTE: the default is evaluated only when `verifier` is omitted, so a call with missing
 *   credentials throws `PrivyConfigError` here (fail closed) before any work runs.
 * @returns `{ account }` (the verified DID) on success; `{ error: "invalid_session" }` for
 *   a missing / malformed / invalid / expired token — never a partial result.
 * @throws {PrivyConfigError} when server credentials are absent (deploy misconfiguration).
 */
export async function verifySession(
  token: string,
  verifier: SessionVerifier = buildSessionVerifier(),
): Promise<VerifySessionResult> {
  if (typeof token !== "string" || token.trim() === "") {
    return { error: "invalid_session" };
  }

  try {
    const claims = await verifier.verifyAuthToken(token);
    // Defensive: a verified token with no subject is unusable as an account anchor.
    if (!claims.userId) {
      return { error: "invalid_session" };
    }
    return { account: claims.userId };
  } catch {
    // Any verification failure (bad signature, expired, malformed) is a normal auth
    // outcome — a typed error, never a thrown exception and never a partial result.
    return { error: "invalid_session" };
  }
}
