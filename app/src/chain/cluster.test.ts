/*
 * The cluster contract, asserted against invented environments and then
 * against the real one this build runs in — so a mainnet build that forgot
 * its RPC, or a devnet build pointed at mainnet, fails here rather than in
 * a player's browser.
 */
import { describe, expect, it } from 'vitest';
import {
  SOLANA_CHAIN,
  assertClusterInvariants,
  cluster,
  defaultRpcUrl,
  explorerTxUrl,
  parseCluster,
} from './cluster';

describe('parseCluster', () => {
  it('reads unset and empty as devnet, by construction', () => {
    expect(parseCluster(undefined)).toBe('devnet');
    expect(parseCluster('')).toBe('devnet');
    expect(parseCluster('  devnet ')).toBe('devnet');
  });

  it('reads exactly "mainnet" as mainnet and nothing else', () => {
    expect(parseCluster('mainnet')).toBe('mainnet');
    for (const bad of ['mainnet-beta', 'Mainnet', 'testnet', 'prod', 'localnet']) {
      expect(() => parseCluster(bad), bad).toThrow();
    }
  });
});

describe('what the cluster decides', () => {
  it('has a public fallback endpoint on devnet and none on mainnet', () => {
    expect(defaultRpcUrl('devnet')).toBe('https://api.devnet.solana.com');
    expect(() => defaultRpcUrl('mainnet')).toThrow(/NEXT_PUBLIC_SOLANA_RPC_URL/);
  });

  it('links the explorer to the right cluster', () => {
    expect(explorerTxUrl('sig', 'devnet')).toBe('https://explorer.solana.com/tx/sig?cluster=devnet');
    expect(explorerTxUrl('sig', 'mainnet')).toBe('https://explorer.solana.com/tx/sig');
  });

  it('derives the provider chain id from the cluster', () => {
    expect(SOLANA_CHAIN).toBe(`solana:${cluster()}`);
  });
});

describe('assertClusterInvariants', () => {
  it('accepts a bare devnet build and a devnet build with a devnet RPC', () => {
    expect(assertClusterInvariants({})).toEqual([]);
    expect(
      assertClusterInvariants({ NEXT_PUBLIC_SOLANA_RPC_URL: 'https://devnet.helius-rpc.com/?api-key=x' }),
    ).toEqual([]);
  });

  it('refuses a devnet build whose RPC looks like mainnet', () => {
    expect(
      assertClusterInvariants({ NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' }),
    ).toHaveLength(1);
  });

  it('refuses a mainnet build with no RPC, a devnet RPC, the faucet, or the test signer', () => {
    expect(assertClusterInvariants({ NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet' })).toHaveLength(1);
    expect(
      assertClusterInvariants({
        NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet',
        NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.devnet.solana.com',
      }),
    ).toHaveLength(1);
    expect(
      assertClusterInvariants({
        NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet',
        NEXT_PUBLIC_SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x',
        NEXT_PUBLIC_DEVNET_FAUCET: '1',
        NEXT_PUBLIC_ALLOW_TEST_SIGNER: '1',
      }),
    ).toHaveLength(2);
  });

  it('accepts a complete mainnet build', () => {
    expect(
      assertClusterInvariants({
        NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet',
        NEXT_PUBLIC_SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x',
      }),
    ).toEqual([]);
  });

  it('holds in whatever environment this build runs in', () => {
    // The gate. NEXT_PUBLIC_* values are read at build time and baked into
    // the client bundle, so a violation here is a violation in every
    // visitor's browser.
    expect(
      assertClusterInvariants({
        NEXT_PUBLIC_SOLANA_CLUSTER: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
        NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
        NEXT_PUBLIC_DEVNET_FAUCET: process.env.NEXT_PUBLIC_DEVNET_FAUCET,
        NEXT_PUBLIC_ALLOW_TEST_SIGNER: process.env.NEXT_PUBLIC_ALLOW_TEST_SIGNER,
      }),
    ).toEqual([]);
  });
});
