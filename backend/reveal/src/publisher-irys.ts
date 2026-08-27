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
 */

import type { RevealBundle } from './bundle';
import type { BundlePublisher } from './publisher';

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

/** Build the live uploader from env (devnet uploads are free-tier; mainnet
 * needs the funded wallet). Imported lazily so tests never load the SDK. */
export async function irysUploaderFromEnv(env: {
  IRYS_UPLOAD_KEY?: string;
  IRYS_NETWORK?: string;
}): Promise<IrysUploader> {
  if (!env.IRYS_UPLOAD_KEY) {
    throw new Error('IRYS_UPLOAD_KEY is not set (the funded Solana upload wallet)');
  }
  const { Uploader } = await import('@irys/upload');
  const { default: Solana } = await import('@irys/upload-solana');
  const builder = Uploader(Solana).withWallet(env.IRYS_UPLOAD_KEY);
  const irys = await (env.IRYS_NETWORK === 'mainnet' ? builder.mainnet() : builder.devnet()).build();
  return {
    async upload(data, opts) {
      const res = await irys.upload(data, opts);
      return { id: res.id };
    },
  };
}
