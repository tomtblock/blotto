/*
 * The rule this module exists for, asserted.
 *
 * `rpc.ts` has said since Phase 0 that "a preview deployment must never point
 * at mainnet", and it exports `looksLikeMainnet` so "a build can assert on it
 * rather than discover the problem from a user's transaction". Nothing ever
 * did. This suite is that assertion: it runs in every CI lane and in every
 * Vercel preview build, so an environment that points the client at mainnet
 * fails the build instead of taking somebody's real SOL.
 *
 * The endpoint-level control in TECH-ARCH §11 (region and endpoint fixed in
 * the hosting provider's configuration) is still the real defence — a custom
 * provider hostname can front mainnet without saying so. This is the loud
 * local check that catches the ordinary mistake.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVNET_RPC_URL, looksLikeMainnet, rpcUrl } from './rpc';

describe('the RPC endpoint', () => {
  it('never falls back to mainnet', () => {
    expect(looksLikeMainnet(DEFAULT_DEVNET_RPC_URL)).toBe(false);
  });

  it('is not mainnet in whatever environment this build runs in', () => {
    // The gate: NEXT_PUBLIC_SOLANA_RPC_URL is read at build time and baked
    // into the client bundle, so a mainnet value here is a mainnet value in
    // every visitor's browser.
    expect(looksLikeMainnet(rpcUrl()), `NEXT_PUBLIC_SOLANA_RPC_URL = ${rpcUrl()}`).toBe(false);
  });

  it('recognises the mainnet hostnames it is meant to catch', () => {
    for (const url of [
      'https://api.mainnet-beta.solana.com',
      'https://solana-mainnet.example.net',
      'https://API.MAINNET-BETA.SOLANA.COM',
    ]) {
      expect(looksLikeMainnet(url), url).toBe(true);
    }
  });
});
