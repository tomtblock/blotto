import { describe, expect, it, vi } from "vitest";
import type { User, WalletWithMetadata } from "@privy-io/server-auth";
import {
  buildUserDirectory,
  resolveSolanaWallet,
  type UserDirectory,
} from "./resolve-wallet";
import { PrivyConfigError } from "./verify-session";

/** A linked wallet account (metadata fields elided — only the read fields matter here). */
function wallet(
  address: string,
  opts: { chainType?: string; client?: string } = {},
): WalletWithMetadata {
  return {
    type: "wallet",
    address,
    chainType: opts.chainType ?? "solana",
    walletClientType: opts.client,
  } as unknown as WalletWithMetadata;
}

/** A user carrying the given linked accounts. */
function userWith(accounts: WalletWithMetadata[]): User {
  return { id: "did:privy:u1", linkedAccounts: accounts } as unknown as User;
}

/** A directory that returns the given user. */
function directoryOf(user: User): UserDirectory {
  return { getUser: vi.fn(async () => user) };
}

function envWith(overrides: { id?: string; secret?: string }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NEXT_PUBLIC_PRIVY_APP_ID: overrides.id,
    PRIVY_APP_SECRET: overrides.secret,
  };
}

describe("resolveSolanaWallet", () => {
  it("prefers the embedded Privy wallet over an external one", async () => {
    const user = userWith([
      wallet("EXTERNAL_SOL", { client: "phantom" }),
      wallet("EMBEDDED_SOL", { client: "privy" }),
    ]);
    expect(await resolveSolanaWallet("did:privy:u1", directoryOf(user))).toEqual(
      { wallet: "EMBEDDED_SOL" },
    );
  });

  it("falls back to the first linked Solana wallet when there is no embedded one", async () => {
    const user = userWith([
      wallet("FIRST_SOL", { client: "phantom" }),
      wallet("SECOND_SOL", { client: "solflare" }),
    ]);
    expect(await resolveSolanaWallet("did:privy:u1", directoryOf(user))).toEqual(
      { wallet: "FIRST_SOL" },
    );
  });

  it("ignores non-Solana wallets", async () => {
    const user = userWith([
      wallet("ETH_ADDR", { chainType: "ethereum", client: "privy" }),
      wallet("SOL_ADDR", { chainType: "solana", client: "phantom" }),
    ]);
    expect(await resolveSolanaWallet("did:privy:u1", directoryOf(user))).toEqual(
      { wallet: "SOL_ADDR" },
    );
  });

  it("returns no_wallet when the user has no Solana wallet", async () => {
    const user = userWith([wallet("ETH_ADDR", { chainType: "ethereum" })]);
    expect(await resolveSolanaWallet("did:privy:u1", directoryOf(user))).toEqual(
      { error: "no_wallet" },
    );
  });

  it("returns no_wallet (never throws) when the lookup fails", async () => {
    const directory: UserDirectory = {
      getUser: vi.fn(async () => {
        throw new Error("not found / rate limited");
      }),
    };
    expect(await resolveSolanaWallet("did:privy:u1", directory)).toEqual({
      error: "no_wallet",
    });
  });
});

describe("buildUserDirectory (fail closed on missing credentials)", () => {
  it("throws PrivyConfigError when the app ID is missing", () => {
    expect(() => buildUserDirectory(envWith({ secret: "secret" }))).toThrow(
      PrivyConfigError,
    );
  });

  it("throws PrivyConfigError when the app secret is missing", () => {
    expect(() => buildUserDirectory(envWith({ id: "app-123" }))).toThrow(
      PrivyConfigError,
    );
  });

  it("builds a directory when both credentials are present", () => {
    const directory = buildUserDirectory(
      envWith({ id: "app-123", secret: "secret" }),
    );
    expect(typeof directory.getUser).toBe("function");
  });
});
