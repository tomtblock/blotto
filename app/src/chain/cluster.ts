/*
 * The ONE place the app knows which Solana cluster it is built for.
 *
 * Until 2026-09-08 "devnet" was written into the app in three places (the
 * provider's chain id, the RPC fallback, the explorer link) and into the
 * services and scripts in five more. A mainnet copy would have meant editing
 * files, and a file edited for mainnet cannot also be the devnet file. Now
 * one build-time variable drives every one of them:
 *
 *   NEXT_PUBLIC_SOLANA_CLUSTER = devnet | mainnet      (unset → devnet)
 *
 * The rule from rpc.ts survives intact and gains teeth: a preview must never
 * point at mainnet. Unset means devnet BY CONSTRUCTION; mainnet is never
 * inferred from a URL and has no public default endpoint at all, so a
 * mainnet build that forgets its RPC fails to build instead of silently
 * borrowing one. `assertClusterInvariants` states the whole contract as
 * data, and the build-time test runs it against the real environment.
 *
 * Next inlines the public build variables at build time, so every read below
 * is a literal property access — never a computed key.
 */

export type Cluster = "devnet" | "mainnet";

export const DEFAULT_CLUSTER: Cluster = "devnet";

/** The one public endpoint this app will fall back to — devnet only. */
export const PUBLIC_DEVNET_RPC_URL = "https://api.devnet.solana.com";

/**
 * Parse the cluster variable. Empty and unset mean devnet; anything that is
 * not exactly one of the two names is a build error, not a fallback — a typo
 * in a deployment setting must not quietly become devnet.
 */
export function parseCluster(raw: string | undefined): Cluster {
  const v = (raw ?? "").trim();
  if (v === "" || v === DEFAULT_CLUSTER) return DEFAULT_CLUSTER;
  if (v === "mainnet") return "mainnet";
  throw new Error(
    `NEXT_PUBLIC_SOLANA_CLUSTER must be "devnet" or "mainnet" (got "${raw}")`,
  );
}

/** The cluster this build is for. */
export function cluster(): Cluster {
  return parseCluster(process.env.NEXT_PUBLIC_SOLANA_CLUSTER);
}

export function isMainnet(): boolean {
  return cluster() === "mainnet";
}

/**
 * The provider's chain id for this build. Every signing and funding call
 * passes it explicitly — the provider's own per-request default is mainnet
 * (see privy-bridge.tsx, pinned by privy-chain.test.ts).
 */
export const SOLANA_CHAIN: `solana:${Cluster}` = `solana:${cluster()}`;

/**
 * The RPC endpoint to use when NEXT_PUBLIC_SOLANA_RPC_URL is unset. Devnet
 * has a public one. Mainnet deliberately has none: a real-money build names
 * its endpoint or does not build.
 */
export function defaultRpcUrl(c: Cluster = cluster()): string {
  if (c === "devnet") return PUBLIC_DEVNET_RPC_URL;
  throw new Error(
    "a mainnet build must set NEXT_PUBLIC_SOLANA_RPC_URL — there is no public mainnet fallback",
  );
}

/** Explorer link for a transaction, on the right cluster. */
export function explorerTxUrl(signature: string, c: Cluster = cluster()): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  return c === "devnet" ? `${base}?cluster=devnet` : base;
}

/** True when the endpoint looks like Solana mainnet (a heuristic, see rpc.ts). */
export function looksLikeMainnetUrl(url: string): boolean {
  return /mainnet/i.test(url);
}

/** True when the endpoint looks like Solana devnet. */
export function looksLikeDevnetUrl(url: string): boolean {
  return /devnet/i.test(url);
}

/**
 * The build-time contract between the cluster and everything that depends
 * on it, as a list of violations (empty = sound). Pure, so a test can run it
 * against any environment — and the real one.
 *
 *   devnet:  the RPC, if set, must not look like mainnet.
 *   mainnet: the RPC must be set and must not look like devnet; the devnet
 *            faucet link and the automation signer must both be off.
 */
export function assertClusterInvariants(env: {
  NEXT_PUBLIC_SOLANA_CLUSTER?: string;
  NEXT_PUBLIC_SOLANA_RPC_URL?: string;
  NEXT_PUBLIC_DEVNET_FAUCET?: string;
  NEXT_PUBLIC_ALLOW_TEST_SIGNER?: string;
}): string[] {
  const problems: string[] = [];
  let c: Cluster;
  try {
    c = parseCluster(env.NEXT_PUBLIC_SOLANA_CLUSTER);
  } catch (e) {
    return [String(e instanceof Error ? e.message : e)];
  }
  const rpc = env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "";
  if (c === "devnet") {
    if (rpc !== "" && looksLikeMainnetUrl(rpc)) {
      problems.push(`devnet build but NEXT_PUBLIC_SOLANA_RPC_URL looks like mainnet: ${rpc}`);
    }
  } else {
    if (rpc === "") problems.push("mainnet build without NEXT_PUBLIC_SOLANA_RPC_URL");
    else if (looksLikeDevnetUrl(rpc)) {
      problems.push(`mainnet build but NEXT_PUBLIC_SOLANA_RPC_URL looks like devnet: ${rpc}`);
    }
    if (env.NEXT_PUBLIC_DEVNET_FAUCET === "1") {
      problems.push("mainnet build with NEXT_PUBLIC_DEVNET_FAUCET=1 — the faucet link is devnet-only");
    }
    if (env.NEXT_PUBLIC_ALLOW_TEST_SIGNER === "1") {
      problems.push("mainnet build with NEXT_PUBLIC_ALLOW_TEST_SIGNER=1 — the automation signer is devnet-only");
    }
  }
  return problems;
}
