/*
 * RPC endpoint resolution.
 *
 * Carried from the predecessor repository for ONE rule, which is the whole
 * reason this module exists as its own file rather than an inline
 * `process.env` read:
 *
 *   **A preview deployment must never point at mainnet.**
 *
 * The endpoint is resolved from `NEXT_PUBLIC_SOLANA_RPC_URL`, and the fallback
 * is devnet — so an environment that forgets to set it lands on devnet by
 * construction rather than on whatever the last person configured. The value is
 * world-readable in the client bundle, so it must be a public RPC or a
 * domain-restricted keyed URL, never an unrestricted key.
 *
 * What was NOT carried: the predecessor's account fetch and decode
 * (`fetchCollectionAccounts`, `deriveCurveAddress`, the Collection/Curve
 * decoders). All of it decoded the old product's account layouts, none of which
 * exist here. Phase 1 writes this product's reads against the accounts in
 * TECH-ARCH §3.1 once they exist, and Phase 3 wires the surfaces.
 *
 * TECH-ARCH §11 adds a second constraint this module will have to honour when
 * a real endpoint is chosen: the RPC provider must offer a non-US endpoint, and
 * hosting must sit outside every blocked market (PID §9) — in every environment
 * including previews.
 */

import { PUBLIC_DEVNET_RPC_URL, defaultRpcUrl } from "./cluster";

/**
 * The devnet fallback. Deliberately a public endpoint and deliberately devnet:
 * see the rule at the top of this file. Since 2026-09-08 the cluster itself
 * is one build-time variable (`./cluster.ts`); mainnet has NO fallback at all.
 */
export const DEFAULT_DEVNET_RPC_URL = PUBLIC_DEVNET_RPC_URL;

/**
 * The RPC endpoint this build talks to.
 *
 * Read through this function, never `process.env.NEXT_PUBLIC_SOLANA_RPC_URL`
 * directly — the fallback is the safety property, and an inline read skips it.
 */
export function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || defaultRpcUrl();
}

/**
 * True when the configured endpoint looks like Solana mainnet.
 *
 * A heuristic, not a guarantee — a custom provider hostname can front mainnet
 * without saying so, which is exactly why the deployment-level control in
 * TECH-ARCH §11 (region and endpoint fixed in the hosting provider's
 * configuration, previews included) is the real defence and this is only a
 * loud local check. It exists so a build can assert on it rather than discover
 * the problem from a user's transaction.
 */
export function looksLikeMainnet(url: string = rpcUrl()): boolean {
  return /mainnet/i.test(url);
}
