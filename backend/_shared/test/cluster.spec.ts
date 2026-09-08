/**
 * The services' cluster contract: unset means devnet by construction, mainnet
 * is only ever named, mainnet has no public fallback, and a URL that looks
 * like the other cluster is refused before the first request.
 */
import { strict as assert } from 'assert';
import { PUBLIC_DEVNET_RPC_URL, clusterName, parseCluster, resolveRpcUrl } from '../src/cluster';

describe('parseCluster', () => {
  it('reads unset and empty as devnet', () => {
    assert.equal(parseCluster(undefined), 'devnet');
    assert.equal(parseCluster(''), 'devnet');
    assert.equal(parseCluster(' devnet '), 'devnet');
  });

  it('reads exactly "mainnet" and refuses anything else', () => {
    assert.equal(parseCluster('mainnet'), 'mainnet');
    for (const bad of ['mainnet-beta', 'Mainnet', 'testnet', 'prod']) {
      assert.throws(() => parseCluster(bad), /BLOTTO_CLUSTER/);
    }
  });
});

describe('resolveRpcUrl', () => {
  it('falls back to the public devnet endpoint only on devnet', () => {
    assert.equal(resolveRpcUrl({}), PUBLIC_DEVNET_RPC_URL);
    assert.equal(resolveRpcUrl({ BLOTTO_CLUSTER: 'devnet' }), PUBLIC_DEVNET_RPC_URL);
    assert.throws(() => resolveRpcUrl({ BLOTTO_CLUSTER: 'mainnet' }), /no public mainnet fallback/);
  });

  it('keeps an explicit devnet endpoint on devnet', () => {
    const url = 'https://devnet.helius-rpc.com/?api-key=x';
    assert.equal(resolveRpcUrl({ BLOTTO_RPC_URL: url }), url);
  });

  it('refuses a URL that looks like the other cluster', () => {
    assert.throws(
      () => resolveRpcUrl({ BLOTTO_RPC_URL: 'https://api.mainnet-beta.solana.com' }),
      /looks like mainnet/,
    );
    assert.throws(
      () => resolveRpcUrl({ BLOTTO_CLUSTER: 'mainnet', BLOTTO_RPC_URL: PUBLIC_DEVNET_RPC_URL }),
      /looks like devnet/,
    );
  });

  it('accepts a complete mainnet configuration', () => {
    const url = 'https://mainnet.helius-rpc.com/?api-key=x';
    assert.equal(resolveRpcUrl({ BLOTTO_CLUSTER: 'mainnet', BLOTTO_RPC_URL: url }), url);
    assert.equal(clusterName({ BLOTTO_CLUSTER: 'mainnet' }), 'mainnet');
  });
});
