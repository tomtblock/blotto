/*
 * Pins the update-loop guard's comparator (production incident,
 * 2026-08-28): the Privy bridge rebuilds its Auth object with fresh
 * callback closures on every render once the SDK initializes, and the
 * provider must treat those rebuilds as the SAME state or setState
 * re-enters forever (React #185, whole page down). The first test here is
 * the incident: callback-identity churn alone must compare equal. The
 * rest pin that every change a consumer can observe still gets through.
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
    signers: [signer(ADDRESS, "embedded")],
    signInWithSocial: () => {},
    connectWallet: () => {},
    signOut: async () => {},
    addFunds: async () => {},
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

  it("sees the funding seam appearing or disappearing, but not its identity", () => {
    expect(sameAuthState(snapshot(), snapshot({ addFunds: undefined }))).toBe(
      false,
    );
    expect(
      sameAuthState(
        snapshot({ addFunds: undefined }),
        snapshot({ addFunds: undefined }),
      ),
    ).toBe(true);
  });
});
