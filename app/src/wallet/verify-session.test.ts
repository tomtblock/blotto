import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthTokenClaims } from "@privy-io/server-auth";
import {
  buildSessionVerifier,
  PrivyConfigError,
  verifySession,
  type SessionVerifier,
} from "./verify-session";

/** A full set of claims for a verified token, overridable per test. */
function claims(overrides: Partial<AuthTokenClaims> = {}): AuthTokenClaims {
  return {
    appId: "app-123",
    issuer: "privy.io",
    issuedAt: 1_700_000_000,
    expiration: 1_700_003_600,
    sessionId: "sess-abc",
    userId: "did:privy:clx0000account",
    ...overrides,
  };
}

/** A verifier that resolves the given claims. */
function resolvingVerifier(c: AuthTokenClaims): SessionVerifier {
  return { verifyAuthToken: vi.fn(async () => c) };
}

/** A verifier that throws — the SDK's behaviour for an invalid/expired token. */
function throwingVerifier(): SessionVerifier {
  return {
    verifyAuthToken: vi.fn(async () => {
      throw new Error("invalid auth token");
    }),
  };
}

/**
 * A deterministic env for the credential tests: spread the real env (so the required
 * `NODE_ENV` is present) then pin the two Privy keys — `undefined` removes one.
 */
function envWith(overrides: { id?: string; secret?: string }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NEXT_PUBLIC_PRIVY_APP_ID: overrides.id,
    PRIVY_APP_SECRET: overrides.secret,
  };
}

describe("verifySession", () => {
  it("returns the Privy DID as the account for a valid token", async () => {
    const verifier = resolvingVerifier(claims());
    expect(await verifySession("good.jwt.token", verifier)).toEqual({
      account: "did:privy:clx0000account",
    });
    expect(verifier.verifyAuthToken).toHaveBeenCalledWith("good.jwt.token");
  });

  it("returns invalid_session when the SDK rejects (invalid / expired)", async () => {
    expect(await verifySession("bad.jwt.token", throwingVerifier())).toEqual({
      error: "invalid_session",
    });
  });

  it("returns invalid_session for an empty / whitespace token WITHOUT calling the SDK", async () => {
    const verifier = throwingVerifier();
    expect(await verifySession("", verifier)).toEqual({
      error: "invalid_session",
    });
    expect(await verifySession("   ", verifier)).toEqual({
      error: "invalid_session",
    });
    expect(verifier.verifyAuthToken).not.toHaveBeenCalled();
  });

  it("returns invalid_session when verified claims carry no userId", async () => {
    const verifier = resolvingVerifier(claims({ userId: "" }));
    expect(await verifySession("good.jwt.token", verifier)).toEqual({
      error: "invalid_session",
    });
  });
});

describe("buildSessionVerifier (fail closed on missing credentials)", () => {
  it("throws PrivyConfigError when the app ID is missing", () => {
    expect(() => buildSessionVerifier(envWith({ secret: "secret" }))).toThrow(
      PrivyConfigError,
    );
  });

  it("throws PrivyConfigError when the app secret is missing", () => {
    expect(() => buildSessionVerifier(envWith({ id: "app-123" }))).toThrow(
      PrivyConfigError,
    );
  });

  it("builds a verifier when both credentials are present", () => {
    const verifier = buildSessionVerifier(
      envWith({ id: "app-123", secret: "secret" }),
    );
    expect(typeof verifier.verifyAuthToken).toBe("function");
  });
});

describe("verifySession fails closed end-to-end when env is unset", () => {
  const saved = {
    id: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    secret: process.env.PRIVY_APP_SECRET,
  };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
  });

  afterEach(() => {
    if (saved.id === undefined) delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    else process.env.NEXT_PUBLIC_PRIVY_APP_ID = saved.id;
    if (saved.secret === undefined) delete process.env.PRIVY_APP_SECRET;
    else process.env.PRIVY_APP_SECRET = saved.secret;
  });

  it("throws PrivyConfigError (never silently trusts the caller) when the default verifier cannot be built", async () => {
    // The default `verifier` arg is buildSessionVerifier(), evaluated here because it is
    // omitted — so the config error surfaces as a throw, not an { error } result.
    await expect(verifySession("any.token")).rejects.toBeInstanceOf(
      PrivyConfigError,
    );
  });
});
