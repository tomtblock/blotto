/*
 * The cluster contract, asserted against invented environments and then
 * against the real one this build runs in — so a mainnet build that forgot
 * its RPC, or a devnet build pointed at mainnet, fails here rather than in
 * a player's browser.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SOLANA_CHAIN,
  assertClusterInvariants,
  clusterGate,
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
    // NEXT_PUBLIC_* values are read at build time and baked into the client
    // bundle, so a violation here is a violation in every visitor's browser.
    //
    // E-02: this case alone is VACUOUS in CI, where nothing is set and the
    // contract is satisfied by construction — it can only ever pass. It is
    // kept because it is the one case that reads the REAL environment, and
    // the cases below are what make it a gate rather than a decoration.
    expect(() => clusterGate()).not.toThrow();
  });
});

/*
 * THE GATE (audit 2026-09-11, A-06 / E-02).
 *
 * `assertClusterInvariants` stated the contract and was called by NOTHING
 * outside this file — the "build-time gate" in the module header was dead
 * in every deployment path, so a mainnet build with no RPC, or with the
 * devnet faucet or the automation signer left on, would have built and
 * shipped. `clusterGate` is the caller, and `next.config.ts` runs it before
 * Next compiles anything.
 */
describe('clusterGate', () => {
  const ENV = {
    devnet: {},
    mainnetOk: {
      NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet',
      NEXT_PUBLIC_SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x',
    },
  } as const;

  it('passes a sound devnet build and a sound mainnet build', () => {
    expect(() => clusterGate(ENV.devnet)).not.toThrow();
    expect(() => clusterGate(ENV.mainnetOk)).not.toThrow();
  });

  /*
   * The mainnet branch, exercised through the ENTRY POINT the build uses —
   * not through the pure function beside it. Each of these is a cutover
   * mistake that would otherwise reach a real-money bundle.
   */
  it('REFUSES a mainnet build with no RPC endpoint', () => {
    expect(() => clusterGate({ NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet' })).toThrow(
      /refusing to build/,
    );
    expect(() => clusterGate({ NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet' })).toThrow(
      /NEXT_PUBLIC_SOLANA_RPC_URL/,
    );
  });

  it('REFUSES a mainnet build pointed at devnet', () => {
    expect(() =>
      clusterGate({
        NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet',
        NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.devnet.solana.com',
      }),
    ).toThrow(/looks like devnet/);
  });

  it('REFUSES a real-money build with the faucet, the automation signer, or fixtures on', () => {
    expect(() =>
      clusterGate({ ...ENV.mainnetOk, NEXT_PUBLIC_DEVNET_FAUCET: '1' }),
    ).toThrow(/faucet/);
    expect(() =>
      clusterGate({ ...ENV.mainnetOk, NEXT_PUBLIC_ALLOW_TEST_SIGNER: '1' }),
    ).toThrow(/automation signer/);
    // A-07: fabricated tournaments with an Enter button, for real money.
    expect(() =>
      clusterGate({ ...ENV.mainnetOk, NEXT_PUBLIC_FIXTURE_DATA: '1' }),
    ).toThrow(/fixture tournaments/);
  });

  it('REFUSES a devnet build pointed at mainnet — a preview must never be', () => {
    expect(() =>
      clusterGate({ NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' }),
    ).toThrow(/looks like mainnet/);
  });

  it('REFUSES a typo in the cluster name rather than quietly building devnet', () => {
    expect(() => clusterGate({ NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet-beta' })).toThrow();
  });

  it('reports EVERY problem at once, so one build says the whole truth', () => {
    try {
      clusterGate({
        NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet',
        NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.devnet.solana.com',
        NEXT_PUBLIC_DEVNET_FAUCET: '1',
        NEXT_PUBLIC_ALLOW_TEST_SIGNER: '1',
      });
      throw new Error('expected the gate to refuse');
    } catch (e) {
      const message = String(e);
      expect(message).toMatch(/looks like devnet/);
      expect(message).toMatch(/faucet/);
      expect(message).toMatch(/automation signer/);
    }
  });

  /*
   * A-06: the finding was not that the contract was wrong — it was that
   * nothing ran it. A test of the gate that does not also check the gate is
   * CALLED would have passed happily for the whole time the guard was dead.
   */
  it('is actually wired into the build, not just tested here', () => {
    const config = readFileSync(
      fileURLToPath(new URL('../../next.config.ts', import.meta.url)),
      'utf8',
    );
    expect(config).toMatch(/import\s*\{\s*clusterGate\s*\}\s*from\s*"\.\/src\/chain\/cluster"/);
    // Called at module scope — Next evaluates the config before compiling,
    // so a call inside a lazy export would not be a build-time gate.
    expect(config).toMatch(/^clusterGate\(\);$/m);
  });
});
