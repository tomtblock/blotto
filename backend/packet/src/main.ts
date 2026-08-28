/**
 * The packet service's deployment entry (E5): env → deps → serve. Every
 * credentialed seam REFUSES loudly when unconfigured rather than admitting
 * anyone — the packet service is the entry gate, and fail-closed is its
 * whole character (D-B3).
 *
 *   BLOTTO_PACKET_PORT          default 8082
 *   BLOTTO_DATABASE_URL         Postgres (attestations, notify, ciphertexts)
 *   BLOTTO_TERRITORIES_PATH     default config/territories.json
 *   BLOTTO_TERMS_PATH           default config/terms.json
 *   BLOTTO_TRUST_PROXY          "1" ONLY behind our own proxy (Fly/compose)
 *
 *   Entry signer, one of:
 *     TURNKEY_API_BASE_URL + TURNKEY_API_PUBLIC_KEY + TURNKEY_API_PRIVATE_KEY
 *       + TURNKEY_ORGANIZATION_ID + ENTRY_SIGNER_KEY_ID
 *       + ENTRY_SIGNER_PUBLIC_KEY_HEX          (production — C11 adapter)
 *     ENTRY_SIGNER_SEED_HEX                    (dev/rehearsal, 32-byte hex)
 *
 *   Geo, one of:
 *     GEO_VENDOR_URL + GEO_VENDOR_API_KEY      (production — R2 vendor)
 *     GEO_STUB_COUNTRY [+ GEO_STUB_REGION/GEO_STUB_VPN]  (dev stub)
 *
 * Sanctions: no vendor is wired in this repository yet — the deployment
 * ships the same always-clear answer the suite pins, with the vendor need
 * recorded in docs/hosting.md. The territory schedule (fail-closed) is the
 * operative geographic gate at launch.
 */

import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { loadPostgresConfig } from '../../_shared/src/config';
import { createPool } from '../../_shared/src/db';
import { loadHygieneConfig } from '../../_shared/src/http-hygiene';
import { PgCiphertextStore } from '../../sealing/src/store';
import { serveEntryApi } from './server';
import { LocalPacketSigner, type PacketSigner } from './packet';
import { TurnkeyPacketSigner } from './signer-turnkey';
import { StubGeoLookup, VendorHttpGeoLookup } from './geo-adapters';
import { loadTermsVersion } from './attestations';
import { loadTerritorySchedule } from './territories';
import { PgAttestationStore, PgNotifyPreferenceStore } from './stores-pg';
import type { GeoLookup } from './service';

const SERVICE = 'packet';

function buildSigner(env: NodeJS.ProcessEnv): PacketSigner {
  if (env.ENTRY_SIGNER_KEY_ID) {
    for (const k of [
      'TURNKEY_API_BASE_URL',
      'TURNKEY_API_PUBLIC_KEY',
      'TURNKEY_API_PRIVATE_KEY',
      'TURNKEY_ORGANIZATION_ID',
      'ENTRY_SIGNER_PUBLIC_KEY_HEX',
    ]) {
      if (!env[k]) throw new Error(`${SERVICE}: ${k} is required with ENTRY_SIGNER_KEY_ID`);
    }
    // Lazy vendor import — offline suites never load the SDK (C11 pattern).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Turnkey } = require('@turnkey/sdk-server') as typeof import('@turnkey/sdk-server');
    const client = new Turnkey({
      apiBaseUrl: env.TURNKEY_API_BASE_URL as string,
      apiPublicKey: env.TURNKEY_API_PUBLIC_KEY as string,
      apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY as string,
      defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID as string,
    }).apiClient();
    return new TurnkeyPacketSigner({
      client,
      organizationId: env.TURNKEY_ORGANIZATION_ID as string,
      signWith: env.ENTRY_SIGNER_KEY_ID,
      publicKeyHex: env.ENTRY_SIGNER_PUBLIC_KEY_HEX as string,
    });
  }
  if (env.ENTRY_SIGNER_SEED_HEX) {
    return new LocalPacketSigner(new Uint8Array(Buffer.from(env.ENTRY_SIGNER_SEED_HEX, 'hex')));
  }
  throw new Error(
    `${SERVICE}: no entry signer configured — set the Turnkey variables or ENTRY_SIGNER_SEED_HEX (dev)`
  );
}

function buildGeo(env: NodeJS.ProcessEnv): GeoLookup {
  if (env.GEO_VENDOR_URL && env.GEO_VENDOR_API_KEY) {
    return new VendorHttpGeoLookup(env.GEO_VENDOR_URL, env.GEO_VENDOR_API_KEY);
  }
  if (env.GEO_STUB_COUNTRY) {
    console.warn(`${SERVICE}: using the GEO STUB (dev only) — country=${env.GEO_STUB_COUNTRY}`);
    return new StubGeoLookup();
  }
  throw new Error(
    `${SERVICE}: no geo lookup configured — set GEO_VENDOR_URL + GEO_VENDOR_API_KEY (or the dev stub)`
  );
}

/*
 * The founder-owned config files ship at the REPO ROOT, next to backend/
 * (the service images copy both side by side), while the images run with
 * WORKDIR backend/packet — so the DEFAULT paths must not depend on the
 * process's working directory. Resolve them from this file's location
 * (src → package → backend → repo root). First Fly deploy, 2026-08-28:
 * the CWD-relative default crashed the packet machine at boot with
 * "ENOENT config/territories.json". Env overrides are used verbatim, as
 * the operator wrote them.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

export function main(env: NodeJS.ProcessEnv = process.env): void {
  const port = Number(env.BLOTTO_PACKET_PORT ?? 8082);
  const db = createPool(loadPostgresConfig(env));
  const territories = loadTerritorySchedule(
    env.BLOTTO_TERRITORIES_PATH ?? resolve(REPO_ROOT, 'config', 'territories.json')
  );
  const termsVersion = loadTermsVersion(
    env.BLOTTO_TERMS_PATH ?? resolve(REPO_ROOT, 'config', 'terms.json')
  );

  serveEntryApi(
    {
      packet: {
        geo: buildGeo(env),
        // No sanctions vendor is wired yet (module doc; docs/hosting.md).
        sanctions: { isSanctioned: async () => false },
        signer: buildSigner(env),
        attestations: new PgAttestationStore(db),
        config: { territories, kycTier: 0, termsVersion },
        now: () => BigInt(Math.floor(Date.now() / 1000)),
        nonce: () => BigInt('0x' + randomBytes(8).toString('hex')),
      },
      ciphertexts: new PgCiphertextStore(db),
      notify: new PgNotifyPreferenceStore(db),
      trustProxyHeader: env.BLOTTO_TRUST_PROXY === '1',
      // BR-005 posture from env (BLOTTO_API_CORS_ORIGINS etc.), widened in
      // CODE to this service's browser-facing POST surface — which methods a
      // surface accepts is a property of the code, never of a deployment.
      hygiene: (() => {
        const base = loadHygieneConfig(env);
        return {
          ...base,
          cors: {
            ...base.cors,
            allowMethods: 'GET, POST, OPTIONS',
            allowHeaders: 'content-type',
          },
        };
      })(),
    },
    port
  );
  console.log(`${SERVICE}: listening on :${port} (terms v${termsVersion})`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`${SERVICE}: fatal:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
