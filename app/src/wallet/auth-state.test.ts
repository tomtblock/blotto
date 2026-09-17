/*
 * Pins the update-loop guard's comparator (production incident,
 * 2026-08-28): the Privy bridge rebuilds its Auth object with fresh
 * callback closures on every render once the SDK initializes, and the
 * provider must treat those rebuilds as the SAME state or setState
 * re-enters forever (React #185, whole page down). The first test here is
 * the incident: callback-identity churn alone must compare equal. The
 * rest pin that every change a consumer can observe still gets through —
 * including the fields added for the wallet screen on 2026-09-08, each of
 * which would otherwise be swallowed by the guard.
 */
import { describe, expect, it } from "vitest";
import { sameAuthState } from "./auth-state";
import type { Auth } from "./types";
import type { TxSigner } from "@/tx/types";

const ADDRESS = "PLayer111111111111111111111111111111111111";
const OTHER = "PLayer222222222222222222222222222222222222";

/** A fresh signer object with fresh function identities every call. */
function signer(address: string, kind: TxSigner["kind"]): TxSigner {
  return {
    address,
    kind,
    label: kind === "embedded" ? "Privy" : "Phantom",
    signTransaction: async () => new Uint8Array(),
    signMessage: async () => new Uint8Array(),
  };
}

/** A fresh Auth snapshot — new object, new closures — like each adapter render. */
function snapshot(overrides: Partial<Auth> = {}): Auth {
  return {
    status: "signed-in",
    walletAddress: ADDRESS,
    email: null,
    signers: [signer(ADDRESS, "embedded")],
    detectedWallets: [{ id: "phantom", name: "Phantom", icon: "data:," }],
    lastError: null,
    clearError: () => {},
    signInWithSocial: () => {},
    signInWithWallet: async () => {},
    connectWallet: () => {},
    setActiveWallet: () => {},
    signOut: async () => {},
    addFunds: async () => {},
    exportWallet: async () => {},
    linkWallet: () => {},
    ...overrides,
  };
}

describe("sameAuthState", () => {
  it("treats two rebuilds differing only in callback identity as the same state (the #185 loop case)", () => {
    expect(sameAuthState(snapshot(), snapshot())).toBe(true);
  });

  it("sees a status change", () => {
    expect(sameAuthState(snapshot(), snapshot({ status: "signed-out" }))).toBe(
      false,
    );
  });

  it("sees the unavailable reason change", () => {
    expect(
      sameAuthState(snapshot(), snapshot({ unavailable: "rejected" })),
    ).toBe(false);
  });

  it("sees a wallet address change", () => {
    expect(
      sameAuthState(snapshot(), snapshot({ walletAddress: OTHER })),
    ).toBe(false);
    expect(
      sameAuthState(snapshot(), snapshot({ walletAddress: null })),
    ).toBe(false);
  });

  it("sees a signer appearing or disappearing", () => {
    expect(sameAuthState(snapshot(), snapshot({ signers: [] }))).toBe(false);
    expect(
      sameAuthState(
        snapshot(),
        snapshot({
          signers: [signer(ADDRESS, "embedded"), signer(OTHER, "external")],
        }),
      ),
    ).toBe(false);
  });

  it("sees a signer's address or kind change", () => {
    expect(
      sameAuthState(snapshot(), snapshot({ signers: [signer(OTHER, "embedded")] })),
    ).toBe(false);
    expect(
      sameAuthState(
        snapshot(),
        snapshot({ signers: [signer(ADDRESS, "external")] }),
      ),
    ).toBe(false);
  });

  it("sees the optional seams appearing or disappearing, but not their identity", () => {
    expect(sameAuthState(snapshot(), snapshot({ addFunds: undefined }))).toBe(
      false,
    );
    expect(
      sameAuthState(snapshot(), snapshot({ exportWallet: undefined })),
    ).toBe(false);
    expect(sameAuthState(snapshot(), snapshot({ linkWallet: undefined }))).toBe(
      false,
    );
    expect(
      sameAuthState(
        snapshot({ addFunds: undefined }),
        snapshot({ addFunds: undefined }),
      ),
    ).toBe(true);
  });

  it("sees a detected wallet appear, disappear or change", () => {
    expect(sameAuthState(snapshot(), snapshot({ detectedWallets: [] }))).toBe(
      false,
    );
    expect(
      sameAuthState(
        snapshot(),
        snapshot({
          detectedWallets: [{ id: "solflare", name: "Solflare", icon: "data:," }],
        }),
      ),
    ).toBe(false);
    // A fresh icon string for the same wallet is not a change.
    expect(
      sameAuthState(
        snapshot(),
        snapshot({
          detectedWallets: [{ id: "phantom", name: "Phantom", icon: "data:,x" }],
        }),
      ),
    ).toBe(true);
  });

  it("sees a failure appear, clear, or recur", () => {
    const failed = { code: "exited_auth_flow", at: 1 };
    expect(sameAuthState(snapshot(), snapshot({ lastError: failed }))).toBe(
      false,
    );
    expect(
      sameAuthState(snapshot({ lastError: failed }), snapshot({ lastError: failed })),
    ).toBe(true);
    // The same code again, later, is a new occurrence the surface must show.
    expect(
      sameAuthState(
        snapshot({ lastError: failed }),
        snapshot({ lastError: { code: "exited_auth_flow", at: 2 } }),
      ),
    ).toBe(false);
  });
});
