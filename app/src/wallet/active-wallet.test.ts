import { describe, expect, it } from "vitest";
import { pickActiveWallet } from "./active-wallet";

const PHANTOM = { address: "Phantom111111111111111111111111111111111111", kind: "external" as const };
const METAMASK = { address: "MetaMask11111111111111111111111111111111111", kind: "external" as const };
const EMBEDDED = { address: "Embedded11111111111111111111111111111111111", kind: "embedded" as const };

describe("pickActiveWallet", () => {
  it("never picks a wallet the account does not link, even when it is listed first (the MetaMask incident)", () => {
    // MetaMask exposed its account to the page and sat first in the signer
    // list; the player had signed in with Phantom.
    expect(
      pickActiveWallet({
        signers: [METAMASK, PHANTOM],
        linked: new Set([PHANTOM.address]),
        chosen: null,
      })
    ).toBe(PHANTOM.address);
  });

  it("prefers a linked external wallet over the linked embedded one", () => {
    expect(
      pickActiveWallet({
        signers: [EMBEDDED, PHANTOM],
        linked: new Set([EMBEDDED.address, PHANTOM.address]),
        chosen: null,
      })
    ).toBe(PHANTOM.address);
  });

  it("a Google sign-in with only the embedded wallet plays with it", () => {
    expect(
      pickActiveWallet({ signers: [EMBEDDED], linked: new Set([EMBEDDED.address]), chosen: null })
    ).toBe(EMBEDDED.address);
  });

  it("the player's stored choice wins while that wallet is connected, and is ignored once it is not", () => {
    const linked = new Set([EMBEDDED.address, PHANTOM.address]);
    expect(
      pickActiveWallet({ signers: [EMBEDDED, PHANTOM], linked, chosen: EMBEDDED.address })
    ).toBe(EMBEDDED.address);
    expect(pickActiveWallet({ signers: [PHANTOM], linked, chosen: EMBEDDED.address })).toBe(
      PHANTOM.address
    );
  });

  it("falls back to the first signer, then to a linked address with no signer yet, then to null", () => {
    expect(pickActiveWallet({ signers: [METAMASK], linked: new Set(), chosen: null })).toBe(
      METAMASK.address
    );
    expect(
      pickActiveWallet({ signers: [], linked: new Set([PHANTOM.address]), chosen: null })
    ).toBe(PHANTOM.address);
    expect(pickActiveWallet({ signers: [], linked: new Set(), chosen: null })).toBeNull();
  });
});
