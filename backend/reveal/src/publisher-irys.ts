/**
 * The Irys reveal-bundle publisher (C11) — the production `BundlePublisher`,
 * one method, as roadmap 2.4 specified. The bundle JSON is uploaded as a
 * permanent transaction on the Irys datachain and addressed by its id at
 * the public gateway, so the URI outlives the operator.
 *
 * The UPLOADER seam is injected: the live one comes from
 * `irysUploaderFromEnv` below (@irys/upload + @irys/upload-solana,
 * verified against the installed 0.0.15 / 0.1.8 types); specs drive a
 * fake. Funding the upload wallet is founder provisioning (playbook §4):
 * IRYS_UPLOAD_KEY (the Solana secret key, base58) and IRYS_NETWORK
 * ("mainnet" | "devnet").
 *
 * IRYS_NETWORK is NOT a second opinion about which cluster we are on. It is
 * cross-checked against BLOTTO_CLUSTER at boot and a disagreement refuses to
 * start — see `irysNetworkFor` (audit 2026-09-11, E-12).
 */

import type { RevealBundle } from './bundle';
import type { BundlePublisher } from './publisher';
import { parseCluster, type Cluster } from '../../_shared/src/cluster';

/** What the adapter needs from Irys: upload bytes, get back the tx id. */
export interface IrysUploader {
  upload(
    data: string,
    opts?: { tags?: { name: string; value: string }[] }
  ): Promise<{ id: string }>;
}

export const IRYS_GATEWAY_BASE = 'https://gateway.irys.xyz';

export class IrysPublisher implements BundlePublisher {
  constructor(
    private readonly uploader: IrysUploader,
    private readonly gatewayBase: string = IRYS_GATEWAY_BASE
  ) {}

  async publish(bundle: RevealBundle): Promise<string> {
    const { id } = await this.uploader.upload(JSON.stringify(bundle), {
      tags: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'App-Name', value: 'blotto-cup' },
        { name: 'Blotto-Pool', value: bundle.pool_id },
        { name: 'Blotto-Bundle-Version', value: String(bundle.version) },
      ],
    });
    if (!id) throw new Error('irys upload returned no transaction id');
    return `${this.gatewayBase}/${id}`;
  }
}

/**
 * How long the SDK's own HTTP calls may take. Without this the builder uses
 * the vendor default, and `build()` — which talks to the Irys node before it
 * returns — can sit indefinitely. `main.ts` bounds the whole step as well;
 * this bounds each request inside it, so the failure is the SDK's own error
 * rather than an opaque outer timeout.
 */
export const IRYS_HTTP_TIMEOUT_MS = 20_000;

/**
 * Which Irys network this deployment publishes to — decided by the SAME
 * selector that decides the Solana cluster, and never independently of it.
 *
 * THE DEFECT THIS CLOSES (audit 2026-09-11, E-12). `IRYS_NETWORK` used to be
 * read on its own, with `=== 'mainnet' ? mainnet() : devnet()`. Two
 * consequences, both silent:
 *
 *   1. a MAINNET deployment that forgot the variable (or misspelt the value —
 *      `Mainnet`, `mainnet-beta`, a trailing space) published every settled
 *      pool's bundle to the DEVNET storage network, while paying real prizes
 *      on mainnet. Devnet Irys is free-tier and not permanent, so the
 *      verifiability spine — "every number a player is paid is recomputable
 *      from published data" (CLAUDE.md tradeoff order #3) — would be resting
 *      on a throwaway upload nobody noticed, and the bundle is written once,
 *      after payment: there is no second chance at it;
 *   2. a DEVNET deployment carrying a stale `IRYS_NETWORK=mainnet` spends
 *      real SOL from the upload wallet on rehearsal bundles.
 *
 * So: unset follows `BLOTTO_CLUSTER` (one selector, the default), and a set
 * value must name that same cluster or the process refuses to start. A value
 * that is neither `mainnet` nor `devnet` is refused outright rather than
 * silently meaning devnet — the misspelling above is exactly case 1.
 *
 * Exported so `main.ts` can use the one answer everywhere it needs the
 * network name (the upload wallet's balance verdict reads it too).
 */
export function irysNetworkFor(env: {
  BLOTTO_CLUSTER?: string;
  IRYS_NETWORK?: string;
}): Cluster {
  // Throws on anything but devnet/mainnet/unset, with the cluster module's
  // own message — one definition of what a cluster name is.
  const cluster = parseCluster(env.BLOTTO_CLUSTER);
  const raw = (env.IRYS_NETWORK ?? '').trim().toLowerCase();
  if (raw === '') return cluster;
  if (raw !== 'devnet' && raw !== 'mainnet') {
    throw new Error(
      `IRYS_NETWORK must be "devnet" or "mainnet" (got "${env.IRYS_NETWORK}"); ` +
        'leave it unset to follow BLOTTO_CLUSTER'
    );
  }
  if (raw !== cluster) {
    throw new Error(
      `IRYS_NETWORK is "${raw}" but BLOTTO_CLUSTER is "${cluster}" — a bundle published to the ` +
        'wrong storage network cannot be moved or re-published, so this refuses to start. ' +
        'Unset IRYS_NETWORK to follow the cluster, or fix whichever one is wrong.'
    );
  }
  return cluster;
}

/** Build the live uploader from env (devnet uploads are free-tier; mainnet
 * needs the funded wallet). Imported lazily so tests never load the SDK.
 *
 * The network comes from `irysNetworkFor`, so a mismatch between
 * `IRYS_NETWORK` and `BLOTTO_CLUSTER` throws HERE, at startup, before a
 * single bundle can go to the wrong network.
 *
 * `BLOTTO_RPC_URL` is passed through as the token's RPC. Left unset, the SDK
 * picks its own default Solana endpoint — a second, unnamed dependency that
 * nothing in this project configures, monitors or can swap when it is slow.
 * `withRpc` and `timeout` are both on the installed builder (@irys/upload
 * 0.0.15, dist/types/builder.d.ts); neither is assumed. */
export async function irysUploaderFromEnv(env: {
  IRYS_UPLOAD_KEY?: string;
  IRYS_NETWORK?: string;
  BLOTTO_CLUSTER?: string;
  BLOTTO_RPC_URL?: string;
}): Promise<IrysUploader> {
  if (!env.IRYS_UPLOAD_KEY) {
    throw new Error('IRYS_UPLOAD_KEY is not set (the funded Solana upload wallet)');
  }
  // Before the SDK is even loaded: a cluster disagreement is a configuration
  // error, not a vendor error, and must not look like one in the logs.
  const network = irysNetworkFor(env);
  const { Uploader } = await import('@irys/upload');
  const { default: Solana } = await import('@irys/upload-solana');
  let builder = Uploader(Solana).withWallet(env.IRYS_UPLOAD_KEY);
  builder = network === 'mainnet' ? builder.mainnet() : builder.devnet();
  if (env.BLOTTO_RPC_URL) builder = builder.withRpc(env.BLOTTO_RPC_URL);
  const irys = await builder.timeout(IRYS_HTTP_TIMEOUT_MS).build();
  return {
    async upload(data, opts) {
      const res = await irys.upload(data, opts);
      return { id: res.id };
    },
  };
}
