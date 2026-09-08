/**
 * The ONE place the services and scripts know which Solana cluster they run
 * against.
 *
 *   BLOTTO_CLUSTER  = devnet | mainnet   (unset → devnet)
 *   BLOTTO_RPC_URL  = the endpoint       (required on mainnet)
 *
 * Until 2026-09-08 the public devnet endpoint was written as a fallback into
 * five services and scripts; a mainnet copy meant editing each. Now unset
 * means devnet BY CONSTRUCTION, and mainnet has no fallback at all: a
 * mainnet service that forgets its endpoint refuses to start instead of
 * quietly borrowing devnet's. A URL that looks like the other cluster is
 * refused too — the ordinary mistake, caught before the first transaction.
 */

export type Cluster = 'devnet' | 'mainnet';

export const DEFAULT_CLUSTER: Cluster = 'devnet';

/** The one public endpoint anything here will fall back to — devnet only. */
export const PUBLIC_DEVNET_RPC_URL = 'https://api.devnet.solana.com';

export function parseCluster(raw: string | undefined): Cluster {
  const v = (raw ?? '').trim();
  if (v === '' || v === DEFAULT_CLUSTER) return DEFAULT_CLUSTER;
  if (v === 'mainnet') return 'mainnet';
  throw new Error(`BLOTTO_CLUSTER must be "devnet" or "mainnet" (got "${raw}")`);
}

export interface ClusterEnv {
  BLOTTO_CLUSTER?: string;
  BLOTTO_RPC_URL?: string;
}

/** Resolve the RPC endpoint for the configured cluster, or throw. */
export function resolveRpcUrl(env: ClusterEnv): string {
  const cluster = parseCluster(env.BLOTTO_CLUSTER);
  const url = (env.BLOTTO_RPC_URL ?? '').trim();
  if (cluster === 'devnet') {
    if (url !== '' && /mainnet/i.test(url)) {
      throw new Error(`BLOTTO_CLUSTER is devnet but BLOTTO_RPC_URL looks like mainnet: ${url}`);
    }
    return url === '' ? PUBLIC_DEVNET_RPC_URL : url;
  }
  if (url === '') {
    throw new Error('BLOTTO_CLUSTER is mainnet but BLOTTO_RPC_URL is unset — there is no public mainnet fallback');
  }
  if (/devnet/i.test(url)) {
    throw new Error(`BLOTTO_CLUSTER is mainnet but BLOTTO_RPC_URL looks like devnet: ${url}`);
  }
  return url;
}

/** The cluster name, for logs and for vendors that take one (Irys, explorer). */
export function clusterName(env: ClusterEnv): Cluster {
  return parseCluster(env.BLOTTO_CLUSTER);
}
