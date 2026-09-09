/*
 * The provider-free half of wallet sign-in, against a fake wallet-standard
 * wallet: which wallets the sign-in surface lists, and the exact sequence a
 * one-tap sign-in performs — connect, ask the provider for its message, have
 * the wallet sign THOSE bytes, hand the provider the ENCODED signature under
 * the wallet's id — with every failure returned as an outcome, never thrown.
 * (The encoding itself is the bridge's: base64, as the provider's own modal
 * sends — see the bridge's `encodeSignature` and its test.)
 *
 * This is the evidence the sandboxed browser cannot give: it cannot reach
 * the provider's API, so the sequence is proven here with the provider's two
 * calls faked, and the browser run proves only that a registered wallet
 * renders as DETECTED.
 */
import { describe, expect, it, vi } from "vitest";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  findStandardWallet,
  isExternalSolanaWallet,
  signatureToBase64,
  siwsSignIn,
  toDetected,
  walletId,
  type SiwsDeps,
} from "./standard-wallets";

const ADDRESS = "EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD";

function account(over: Partial<WalletAccount> = {}): WalletAccount {
  return {
    address: ADDRESS,
    publicKey: new Uint8Array(32),
    chains: ["solana:devnet", "solana:mainnet"],
    features: ["solana:signMessage"],
    ...over,
  } as WalletAccount;
}

function fakeWallet(over: {
  name?: string;
  chains?: string[];
  features?: Record<string, unknown>;
}): Wallet {
  return {
    version: "1.0.0",
    name: over.name ?? "Phantom",
    icon: "data:image/svg+xml;base64,",
    chains: over.chains ?? ["solana:devnet"],
    accounts: [],
    features: over.features ?? {},
  } as unknown as Wallet;
}

function fullFeatures(record: { signed: Uint8Array[]; connects: number }) {
  return {
    "standard:connect": {
      version: "1.0.0",
      connect: async () => {
        record.connects += 1;
        return { accounts: [account()] };
      },
    },
    "solana:signMessage": {
      version: "1.0.0",
      signMessage: async (...inputs: { message: Uint8Array }[]) => {
        for (const i of inputs) record.signed.push(i.message);
        return inputs.map((i) => ({ signedMessage: i.message, signature: new Uint8Array(64).fill(9) }));
      },
    },
  };
}

function deps(over: Partial<SiwsDeps> = {}): SiwsDeps & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { generate: [], login: [] };
  return {
    calls,
    generateSiwsMessage: async (i) => {
      calls.generate.push(i);
      return `blotto.example wants you to sign in with your Solana account:\n${i.address}\n\nNonce: abc`;
    },
    loginWithSiws: async (i) => {
      calls.login.push(i);
      return { id: "did:privy:test" };
    },
    encodeSignature: (b) => `b64(${b.length})`,
    ...over,
  };
}

describe("which wallets the sign-in surface lists", () => {
  it("lists external Solana wallets and skips the provider's embedded one and non-Solana wallets", () => {
    const rows = toDetected([
      fakeWallet({ name: "Phantom" }),
      fakeWallet({ name: "Privy Wallet" }),
      fakeWallet({ name: "MetaMask", chains: ["eip155:1"] }),
      fakeWallet({ name: "Ctrl Wallet", chains: ["solana:mainnet", "eip155:1"] }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["phantom", "ctrl-wallet"]);
    expect(rows[1]).toMatchObject({ name: "Ctrl Wallet" });
  });

  it("lists Phantom first even when a multi-chain wallet registered before it", () => {
    // Founder 2026-09-09: MetaMask (Solana-enabled) registered ahead of Phantom
    // and sat above it on the sign-in page.
    const rows = toDetected([
      fakeWallet({ name: "MetaMask", chains: ["eip155:1", "solana:mainnet"] }),
      fakeWallet({ name: "Ctrl Wallet", chains: ["solana:mainnet"] }),
      fakeWallet({ name: "Phantom" }),
      fakeWallet({ name: "Solflare" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["phantom", "solflare", "metamask", "ctrl-wallet"]);
  });

  it("lists one row per wallet id even if a wallet registers twice", () => {
    expect(toDetected([fakeWallet({}), fakeWallet({})])).toHaveLength(1);
  });

  it("derives a stable id from the name and finds the wallet back by it", () => {
    expect(walletId("  Ctrl  Wallet ")).toBe("ctrl-wallet");
    const w = fakeWallet({ name: "Solflare" });
    expect(findStandardWallet([fakeWallet({}), w], "solflare")).toBe(w);
    expect(findStandardWallet([w], "phantom")).toBeNull();
    expect(isExternalSolanaWallet(fakeWallet({ name: "Privy" }))).toBe(false);
  });
});

describe("siwsSignIn", () => {
  it("connects, signs the provider's message bytes, and logs in with the encoded signature under the wallet's id", async () => {
    const record = { signed: [] as Uint8Array[], connects: 0 };
    const d = deps();
    const out = await siwsSignIn(fakeWallet({ features: fullFeatures(record) }), d);

    expect(out).toEqual({ ok: true, address: ADDRESS });
    expect(record.connects).toBe(1);
    expect(d.calls.generate).toEqual([{ address: ADDRESS }]);
    // The wallet signed exactly the message the provider issued.
    expect(new TextDecoder().decode(record.signed[0])).toContain(ADDRESS);
    expect(d.calls.login).toEqual([
      {
        signature: "b64(64)",
        message: expect.stringContaining("Nonce: abc"),
        walletClientType: "phantom",
        connectorType: "injected",
      },
    ]);
  });

  it("reports a wallet with no headless path so the bridge can fall back to the provider's flow", async () => {
    const out = await siwsSignIn(fakeWallet({ features: {} }), deps());
    expect(out).toEqual({ ok: false, code: "blotto_wallet_no_headless_path" });
  });

  it("reports a wallet that connects but offers no account", async () => {
    const features = {
      "standard:connect": { connect: async () => ({ accounts: [] }) },
      "solana:signMessage": { signMessage: async () => [] },
    };
    const out = await siwsSignIn(fakeWallet({ features }), deps());
    expect(out).toEqual({ ok: false, code: "blotto_wallet_no_account" });
  });

  it("reports the player declining, at connect or at sign, without throwing", async () => {
    const declinedConnect = {
      "standard:connect": {
        connect: async () => {
          throw new Error("User rejected the request.");
        },
      },
      "solana:signMessage": { signMessage: async () => [] },
    };
    expect(await siwsSignIn(fakeWallet({ features: declinedConnect }), deps())).toMatchObject({
      ok: false,
      code: "blotto_wallet_declined",
    });

    const declinedSign = {
      "standard:connect": { connect: async () => ({ accounts: [account()] }) },
      "solana:signMessage": {
        signMessage: async () => {
          throw new Error("Signature request cancelled");
        },
      },
    };
    expect(await siwsSignIn(fakeWallet({ features: declinedSign }), deps())).toMatchObject({
      ok: false,
      code: "blotto_wallet_declined",
    });
  });

  it("reports a provider failure as a sign-in failure and never calls login without a signature", async () => {
    const record = { signed: [] as Uint8Array[], connects: 0 };
    const d = deps({
      generateSiwsMessage: vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    });
    const out = await siwsSignIn(fakeWallet({ features: fullFeatures(record) }), d);
    expect(out).toMatchObject({ ok: false, code: "blotto_wallet_signin_failed" });
    expect(record.signed).toHaveLength(0);
    expect(d.calls.login).toHaveLength(0);
  });
});

describe("signatureToBase64", () => {
  it("encodes a 64-byte Ed25519 signature exactly as base64 (the provider's own modal form)", () => {
    const sig = new Uint8Array(64).map((_, i) => (i * 37 + 11) & 0xff);
    expect(signatureToBase64(sig)).toBe(Buffer.from(sig).toString("base64"));
    expect(signatureToBase64(sig)).toHaveLength(88);
  });
});
