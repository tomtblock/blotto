import { describe, expect, it } from "vitest";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  WALLET_SIGN_IN_STATEMENT,
  directReconnect,
  directSignIn,
  directSigners,
  directStatement,
} from "./direct-sign-in";

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
  /** The wallet's own sign-in requests (`solana:signIn`), when the fake offers it. */
  signIns?: { statement?: string; nonce?: string; issuedAt?: string }[];
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

/* The wallet standard's own sign-in, as a mobile wallet app offers it. */
function withSignIn(
  base: Record<string, unknown>,
  record: Record_,
  over: { decline?: boolean; noResult?: boolean } = {},
): Record<string, unknown> {
  return {
    ...base,
    "solana:signIn": {
      version: "1.0.0",
      signIn: async (...inputs: { statement?: string; nonce?: string; issuedAt?: string }[]) => {
        (record.signIns ??= []).push(...inputs);
        if (over.decline) throw new Error("User rejected the request.");
        if (over.noResult) throw new Error("Sign in failed, no sign in result returned by wallet");
        return inputs.map(() => ({
          account: account(),
          signedMessage: new Uint8Array([1]),
          signature: new Uint8Array(64).fill(9),
        }));
      },
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

  describe("on the mobile channel (2026-09-30: a wallet app is one session per request)", () => {
    const mobile = (settle?: () => Promise<void>) => ({ ...deps, walletSignIn: true, settle });

    it("signs in through the wallet's own sign-in — one request, no connect, no separate signature", async () => {
      const record: Record_ = { signed: [], connects: [] };
      const outcome = await directSignIn(fakeWallet(withSignIn(features(record), record)), mobile());
      expect(outcome).toMatchObject({ ok: true, address: ADDRESS, walletId: "phantom" });
      expect(record.connects).toEqual([]);
      expect(record.signed).toEqual([]);
      expect(record.signIns).toEqual([
        { statement: WALLET_SIGN_IN_STATEMENT, nonce: "abc123", issuedAt: "2026-09-27T17:00:00.000Z" },
      ]);
      // A sign-in statement is one line; the wallet adds the address and the fields.
      expect(WALLET_SIGN_IN_STATEMENT).not.toContain("\n");
      expect(WALLET_SIGN_IN_STATEMENT).toContain("It moves nothing and costs nothing.");
    });

    it("a declined sign-in is declined, and nothing else is asked", async () => {
      const record: Record_ = { signed: [], connects: [] };
      const outcome = await directSignIn(
        fakeWallet(withSignIn(features(record), record, { decline: true })),
        mobile(),
      );
      expect(outcome).toMatchObject({ ok: false, code: "blotto_wallet_declined" });
      expect(record.connects).toEqual([]);
      expect(record.signed).toEqual([]);
    });

    it("a wallet that offers sign-in but returns no result falls back to the two-step route", async () => {
      const record: Record_ = { signed: [], connects: [] };
      const outcome = await directSignIn(
        fakeWallet(withSignIn(features(record), record, { noResult: true })),
        mobile(),
      );
      expect(outcome).toMatchObject({ ok: true, address: ADDRESS });
      expect(record.connects).toEqual([{}]);
      expect(record.signed).toHaveLength(1);
    });

    it("a wallet without the sign-in feature takes the two-step route, as on the web", async () => {
      const record: Record_ = { signed: [], connects: [] };
      const outcome = await directSignIn(fakeWallet(features(record)), mobile());
      expect(outcome).toMatchObject({ ok: true, address: ADDRESS });
      expect(record.connects).toEqual([{}]);
      expect(record.signed).toHaveLength(1);
    });

    it("the settle wait runs before EVERY prompt: sign-in, connect, message, transaction", async () => {
      const calls: string[] = [];
      const settle = async () => {
        calls.push("settle");
      };
      const record: Record_ = { signed: [], connects: [] };

      await directSignIn(fakeWallet(withSignIn(features(record), record)), mobile(settle));
      expect(calls).toEqual(["settle"]);

      calls.length = 0;
      await directSignIn(fakeWallet(features(record)), mobile(settle));
      expect(calls).toEqual(["settle", "settle"]);

      calls.length = 0;
      const [signer] = directSigners(fakeWallet(features(record), [account()]), settle);
      await signer!.signTransaction(new Uint8Array([1]));
      await signer!.signMessage!(new Uint8Array([2]));
      expect(calls).toEqual(["settle", "settle"]);
    });

    it("the web passes neither flag and is untouched: sign-in is never called there", async () => {
      const record: Record_ = { signed: [], connects: [] };
      const outcome = await directSignIn(fakeWallet(withSignIn(features(record), record)), deps);
      expect(outcome).toMatchObject({ ok: true, address: ADDRESS });
      expect(record.signIns).toBeUndefined();
      expect(record.connects).toEqual([{}]);
      expect(record.signed).toHaveLength(1);
    });
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
