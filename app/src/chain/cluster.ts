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
 * data; `clusterGate` at the foot of this file is what RUNS it, from
 * next.config.ts, before a single file is compiled (audit A-06 / E-02 —
 * until 2026-09-11 nothing called it but its own test).
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
 *            faucet link, the automation signer and the fixture catalogue
 *            must all be off.
 */
export function assertClusterInvariants(env: {
  NEXT_PUBLIC_SOLANA_CLUSTER?: string;
  NEXT_PUBLIC_SOLANA_RPC_URL?: string;
  NEXT_PUBLIC_DEVNET_FAUCET?: string;
  NEXT_PUBLIC_ALLOW_TEST_SIGNER?: string;
  NEXT_PUBLIC_FIXTURE_DATA?: string;
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
    // Audit 2026-09-11 (A-07): the in-repo fixture catalogue is a design
    // and screenshot tool. A real-money build that serves fabricated
    // tournaments with an Enter button is the finding itself.
    if (env.NEXT_PUBLIC_FIXTURE_DATA === "1") {
      problems.push("mainnet build with NEXT_PUBLIC_FIXTURE_DATA=1 — fixture tournaments are never real money");
    }
  }
  return problems;
}

/* Structural, not `NodeJS.ProcessEnv`: `process.env` satisfies it, and so
 * does a plain object, so a test can state a hostile environment in one
 * literal without inventing the rest of the process's variables. */
export type ClusterEnv = Readonly<Record<string, string | undefined>>;

/**
 * THE GATE ITSELF — run at BUILD TIME from `next.config.ts` (audit
 * 2026-09-11, A-06 / E-02).
 *
 * `assertClusterInvariants` above states the contract as data and has done
 * since 2026-09-08. What it did not have was a caller: nothing outside
 * `cluster.test.ts` ever invoked it, so the "build-time gate" the module
 * header described was dead code in every deployment path. A mainnet build
 * that forgot its RPC, or a mainnet build with the devnet faucet or the
 * automation signer left on, would have built and shipped — the exact
 * cutover mistake the contract exists to stop, with a guard in the repo
 * that was never asked.
 *
 * Next evaluates `next.config.ts` in Node before compiling anything, so a
 * throw here fails `next build` and `next dev` with the reason. It reads
 * the SAME `process.env` Next is about to inline into the client bundle, so
 * a violation here is a violation in every visitor's browser.
 *
 * Throwing rather than warning: a warning in build output is a warning
 * nobody reads on the one deploy that matters.
 */
export function clusterGate(env: ClusterEnv = process.env as ClusterEnv): void {
  const problems = assertClusterInvariants({
    NEXT_PUBLIC_SOLANA_CLUSTER: env.NEXT_PUBLIC_SOLANA_CLUSTER,
    NEXT_PUBLIC_SOLANA_RPC_URL: env.NEXT_PUBLIC_SOLANA_RPC_URL,
    NEXT_PUBLIC_DEVNET_FAUCET: env.NEXT_PUBLIC_DEVNET_FAUCET,
    NEXT_PUBLIC_ALLOW_TEST_SIGNER: env.NEXT_PUBLIC_ALLOW_TEST_SIGNER,
    NEXT_PUBLIC_FIXTURE_DATA: env.NEXT_PUBLIC_FIXTURE_DATA,
  });
  if (problems.length === 0) return;
  throw new Error(
    `refusing to build: the cluster configuration is unsound.\n  - ${problems.join("\n  - ")}\n` +
      "Fix the environment (app/.env.example documents every variable) — " +
      "these values are compiled into the browser bundle.",
  );
}
