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
 *     ENTRY_SIGNER_SEED_HEX + ALLOW_DEV_ENTRY_SIGNER=1   (dev only — the
       opt-in is required so a missing ENTRY_SIGNER_KEY_ID can never
       silently downgrade a Turnkey deployment to the development key)
 *
 *   Geo, one of:
 *     GEO_VENDOR_URL + GEO_VENDOR_API_KEY      (production — IPLocate, R2)
 *       optional: GEO_VENDOR_ATTEMPTS (3), GEO_VENDOR_TIMEOUT_MS (4000),
 *       GEO_CACHE_TTL_MS (900000; 0 disables the per-IP cache)
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
import { buildSigner } from './signer-select';
import { StubGeoLookup, VendorHttpGeoLookup } from './geo-adapters';
import { IpLocateGeoLookup } from './geo-iplocate';
import { CachingGeoLookup } from './geo-cache';
import { loadTermsVersion } from './attestations';
import { loadTerritorySchedule } from './territories';
import { PgAttestationStore, PgNotifyPreferenceStore } from './stores-pg';
import type { GeoLookup } from './service';

const SERVICE = 'packet';



function buildGeo(env: NodeJS.ProcessEnv): GeoLookup {
  if (env.GEO_VENDOR_URL && env.GEO_VENDOR_API_KEY) {
    // IPLocate is the vendor of record (R2). `VendorHttpGeoLookup` remains
    // the documented generic seam for a future vendor swap; it is not the
    // production path and never matched IPLocate's actual contract.
    const vendor = new IpLocateGeoLookup({
      baseUrl: env.GEO_VENDOR_URL,
      apiKey: env.GEO_VENDOR_API_KEY,
      attempts: Number(env.GEO_VENDOR_ATTEMPTS ?? 3),
      timeoutMs: Number(env.GEO_VENDOR_TIMEOUT_MS ?? 4000),
    });
    // The plan's request budget is real: two lookups per entrant (the /geo
    // pre-flight on page load, then /packet) across 64 entrants is 128 per
    // pool, against a DAILY cap over a finite, non-renewing credit balance.
    // The cache changes no verdict — see geo-cache.ts for why — it only
    // stops the same address being asked about twice.
    const ttlMs = Number(env.GEO_CACHE_TTL_MS ?? 15 * 60 * 1000);
    if (ttlMs > 0) {
      console.log(`${SERVICE}: geo = IPLOCATE (${env.GEO_VENDOR_URL}), per-IP cache ${ttlMs}ms`);
      return new CachingGeoLookup(vendor, { ttlMs });
    }
    console.log(`${SERVICE}: geo = IPLOCATE (${env.GEO_VENDOR_URL}), cache DISABLED`);
    return vendor;
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
  // FIRST line, before anything can fail: which code is actually running.
  // Both of 2026-08-31's incidents were a deploy shipping code older than
  // the fix, diagnosed only by comparing a commit on a web page against a
  // branch. The service can simply say.
  console.log(`${SERVICE}: build ${env.BLOTTO_BUILD_COMMIT ?? 'unknown'}`);
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
