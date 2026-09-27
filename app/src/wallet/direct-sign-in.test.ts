import { describe, expect, it } from "vitest";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { directReconnect, directSignIn, directSigners, directStatement } from "./direct-sign-in";

const ADDRESS = "EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD";

function account(over: Partial<WalletAccount> = {}): WalletAccount {
  return {
    address: ADDRESS,
    publicKey: new Uint8Array(32),
    chains: ["solana:devnet"],
    features: ["solana:signMessage", "solana:signTransaction"],
    ...over,
  } as WalletAccount;
}

interface Record_ {
  signed: Uint8Array[];
  connects: { silent?: boolean }[];
}

function fakeWallet(features: Record<string, unknown>, accounts: WalletAccount[] = []): Wallet {
  return {
    version: "1.0.0",
    name: "Phantom",
    icon: "data:image/svg+xml;base64,",
    chains: ["solana:devnet"],
    accounts,
    features,
  } as unknown as Wallet;
}

function features(record: Record_, over: { declineSign?: boolean; declineConnect?: boolean } = {}) {
  return {
    "standard:connect": {
      version: "1.0.0",
      connect: async (input?: { silent?: boolean }) => {
        record.connects.push(input ?? {});
        if (over.declineConnect) throw new Error("User rejected the request.");
        return { accounts: [account()] };
      },
    },
    "solana:signMessage": {
      version: "1.0.0",
      signMessage: async (...inputs: { message: Uint8Array }[]) => {
        if (over.declineSign) throw new Error("User rejected the request.");
        for (const i of inputs) record.signed.push(i.message);
        return inputs.map((i) => ({ signedMessage: i.message, signature: new Uint8Array(64).fill(7) }));
      },
    },
    "solana:signTransaction": {
      version: "1.0.0",
      signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
        inputs.map((i) => ({ signedTransaction: i.transaction })),
    },
  };
}

const deps = { nonce: () => "abc123", issuedAt: () => "2026-09-27T17:00:00.000Z" };

describe("the direct wallet session (V2, 2026-09-27)", () => {
  it("connects, has the wallet sign a statement naming the address, and reports the address", async () => {
    const record: Record_ = { signed: [], connects: [] };
    const outcome = await directSignIn(fakeWallet(features(record)), deps);
    expect(outcome).toMatchObject({ ok: true, address: ADDRESS, walletId: "phantom" });
    expect(record.connects).toEqual([{}]);
    expect(record.signed).toHaveLength(1);
    const text = new TextDecoder().decode(record.signed[0]);
    expect(text).toBe(directStatement(ADDRESS, "abc123", "2026-09-27T17:00:00.000Z"));
    expect(text).toContain("It moves nothing and costs nothing.");
  });

  it("reads a declined prompt as declined, connect or sign", async () => {
    const r1: Record_ = { signed: [], connects: [] };
    expect(await directSignIn(fakeWallet(features(r1, { declineConnect: true })), deps)).toMatchObject({
      ok: false,
      code: "blotto_wallet_declined",
    });
    const r2: Record_ = { signed: [], connects: [] };
    expect(await directSignIn(fakeWallet(features(r2, { declineSign: true })), deps)).toMatchObject({
      ok: false,
      code: "blotto_wallet_declined",
    });
  });

  it("refuses a wallet that cannot connect or sign messages", async () => {
    const record: Record_ = { signed: [], connects: [] };
    const f = features(record) as Record<string, unknown>;
    delete f["solana:signMessage"];
    expect(await directSignIn(fakeWallet(f), deps)).toMatchObject({ ok: false, code: "blotto_wallet_no_headless_path" });
  });

  it("reconnects silently, without a signature, and only to the remembered account", async () => {
    const record: Record_ = { signed: [], connects: [] };
    const wallet = fakeWallet(features(record));
    expect(await directReconnect(wallet, (a) => a === ADDRESS)).toMatchObject({ address: ADDRESS });
    expect(await directReconnect(wallet, () => false)).toBeNull();
    expect(record.connects).toEqual([{ silent: true }, { silent: true }]);
    expect(record.signed).toHaveLength(0);
  });

  it("exposes every Solana account as an external signer that signs with the chain named", async () => {
    const record: Record_ = { signed: [], connects: [] };
    const wallet = fakeWallet(features(record), [account(), account({ address: "other", chains: ["eip155:1"] })]);
    const signers = directSigners(wallet);
    expect(signers.map((s) => [s.address, s.kind, s.label])).toEqual([[ADDRESS, "external", "Phantom"]]);
    expect(await signers[0]!.signTransaction(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(await signers[0]!.signMessage!(new Uint8Array([9]))).toHaveLength(64);
  });
});
