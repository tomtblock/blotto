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
 *     GEO_VENDOR_2_URL + GEO_VENDOR_2_API_KEY  (optional fallback source —
 *       same contract, asked only when the first source cannot answer)
 *     GEO_STUB_COUNTRY [+ GEO_STUB_REGION/GEO_STUB_VPN]  (dev stub)
 *       + ALLOW_STUB_GEO=1   the opt-in is REQUIRED, so a vendor key lost
 *         out of band can never silently downgrade a paid deployment to a
 *         stub that answers every address with one country
 *       optional, per paid source:
 *         GEO_DAILY_CAP          our own ceiling per 24h (unset = none)
 *         GEO_ISSUANCE_RESERVE   lookups only `/packet` may spend
 *                                (default: a quarter of GEO_DAILY_CAP)
 *
 *   Sanctions (Phase 2, Stage B — `sanctions-wiring.ts`), any of:
 *     SANCTIONS_CHAINALYSIS_API_KEY            (Chainalysis, primary)
 *     SANCTIONS_OPENSANCTIONS_API_KEY          (OpenSanctions, cross-check)
 *     SANCTIONS_OFAC_SDN=1                     (mirrored OFAC SDN list; no
 *       credential — loaded before the service listens, refreshed on a
 *       schedule; refuses to answer past SANCTIONS_OFAC_MAX_AGE_HOURS)
 *     SANCTIONS_STUB_LISTED + ALLOW_STUB_SANCTIONS=1   (dev only)
 *   Nothing configured → the service does not start. Until 2026-09-07 this
 *   seam was wired to an always-clear answer; a packet was never screened.
 */

import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { loadPostgresConfig } from '../../_shared/src/config';
import { createPool } from '../../_shared/src/db';
import { loadHygieneConfig } from '../../_shared/src/http-hygiene';
import { PgCiphertextStore } from '../../sealing/src/store';
import { PgPoolIdResolver } from './pool-ids';
import { serveEntryApi } from './server';
import { buildSigner } from './signer-select';
import { wireSanctions } from './sanctions-wiring';
import { StubGeoLookup, VendorHttpGeoLookup } from './geo-adapters';
import { IpLocateGeoLookup } from './geo-iplocate';
import { CachingGeoLookup } from './geo-cache';
import { CompositeGeoLookup, type NamedGeoSource } from './geo-composite';
import { GeoBudget } from './geo-budget';
import { buildMonitor, loadMonitor } from '../../_shared/src/monitor';
import type { Monitor } from '../../_shared/src/monitor';
import { intEnv, optionalIntEnv, portEnv } from '../../_shared/src/env-number';
import { startMetricsListener } from '../../_shared/src/metrics-listener';
import { loadTerms } from './attestations';
import { loadTerritorySchedule } from './territories';
import { PgAttestationStore, PgNotifyPreferenceStore } from './stores-pg';
import { assertRegionCapability, type GeoLookup } from './service';

const SERVICE = 'packet';



/** The two faces of the geo path — see `geo-budget.ts` for why they differ. */
interface GeoFaces {
  issuance: GeoLookup;
  preflight: GeoLookup;
  describe: string;
}

/** One paid vendor, wrapped in its per-address cache. */
function buildVendor(
  url: string,
  apiKey: string,
  env: NodeJS.ProcessEnv
): { lookup: GeoLookup; cached: boolean } {
  // IPLocate is the vendor of record (R2). `VendorHttpGeoLookup` remains
  // the documented generic seam for a future vendor swap; it is not the
  // production path and never matched IPLocate's actual contract.
  const vendor = new IpLocateGeoLookup({
    baseUrl: url,
    apiKey,
    attempts: intEnv(env, 'GEO_VENDOR_ATTEMPTS', 3, { min: 1 }),
    timeoutMs: intEnv(env, 'GEO_VENDOR_TIMEOUT_MS', 4000, { min: 1 }),
  });
  // The request budget is real: two lookups per entrant (the /geo pre-flight
  // on page load, then /packet) across 64 entrants is 128 per pool, against a
  // DAILY cap over a finite, non-renewing credit balance. The cache changes
  // no verdict — see geo-cache.ts for why — it only stops the same address
  // being asked about twice.
  const ttlMs = intEnv(env, 'GEO_CACHE_TTL_MS', 15 * 60 * 1000, { min: 0 });
  if (ttlMs > 0) return { lookup: new CachingGeoLookup(vendor, { ttlMs }), cached: true };
  return { lookup: vendor, cached: false };
}

/**
 * Build the geo path: an ordered composite of every configured source, with
 * our own spending ceiling in front of it and issuance holding a reserve the
 * unauthenticated pre-flight cannot reach.
 *
 * The ceiling and the reserve are OFF unless `GEO_DAILY_CAP` is set. That is
 * deliberate: the vendor's own cap is a property of the operator's plan, and
 * inventing a number here would either throttle a paid tier for no reason or
 * give false comfort on a free one.
 *
 * PHASE-6-REVIEW: the reserve defaults to a quarter of the cap — enough for a
 * full 64-seat field twice over at any cap worth setting, small enough not to
 * squeeze ordinary traffic. The split is an operator-owned number, so it is a
 * default with an override (`GEO_ISSUANCE_RESERVE`) rather than a constant.
 */
// Exported for its own spec. The stub's opt-in (E-03 / C-31) is a refusal
// decided entirely by which variables are present, and the only honest way to
// test a refusal is to drive the selector directly with each combination —
// booting `main()` would need a database, a signer and a screener first.
export function buildGeo(env: NodeJS.ProcessEnv, monitor: Monitor): GeoFaces {
  if (env.GEO_VENDOR_URL && env.GEO_VENDOR_API_KEY) {
    const sources: NamedGeoSource[] = [];
    const primary = buildVendor(env.GEO_VENDOR_URL, env.GEO_VENDOR_API_KEY, env);
    sources.push({ name: 'primary', lookup: primary.lookup });
    if (env.GEO_VENDOR_2_URL && env.GEO_VENDOR_2_API_KEY) {
      const secondary = buildVendor(env.GEO_VENDOR_2_URL, env.GEO_VENDOR_2_API_KEY, env);
      sources.push({ name: 'secondary', lookup: secondary.lookup });
    }
    const composite = new CompositeGeoLookup(sources, monitor);

    const cap = intEnv(env, 'GEO_DAILY_CAP', 0, { min: 0 });
    if (cap <= 0) {
      // No ceiling. Exactly the behaviour before 2026-09-12, minus the
      // silence: a source failure is now a metric and, for a spent allowance
      // or a refused key, an alert.
      const describe =
        `geo = ${sources.length} source(s), per-address cache ` +
        `${primary.cached ? 'ON' : 'OFF'}, NO spending ceiling (set GEO_DAILY_CAP)` +
        (sources.length === 1
          ? ' — SINGLE SOURCE: a vendor outage still stops every entry (R2: name a second vendor)'
          : '');
      return { issuance: composite, preflight: composite, describe };
    }
    const reserve = optionalIntEnv(env, 'GEO_ISSUANCE_RESERVE', { min: 0 });
    const budget = new GeoBudget(composite, { dailyCap: cap, reserve, monitor });
    const describe =
      `geo = ${sources.length} source(s), per-address cache ${primary.cached ? 'ON' : 'OFF'}, ` +
      `ceiling ${budget.ceilingFor('issuance')}/24h ` +
      `(pre-flight stops at ${budget.ceilingFor('preflight')})` +
      (sources.length === 1
        ? ' — SINGLE SOURCE: a vendor outage still stops every entry (R2: name a second vendor)'
        : '');
    return { issuance: budget.forIssuance(), preflight: budget.forPreflight(), describe };
  }
  // The dev stub needs the SAME explicit opt-in as every other dev seam here
  // — `ALLOW_DEV_ENTRY_SIGNER` for the entry signer, `ALLOW_STUB_SANCTIONS`
  // for the screener (audit 2026-09-11, E-03 / C-31). It was the one
  // credentialed seam selectable from a single variable, guarded only by
  // which variables the deploy workflow happened to set. That is not a
  // guard: a vendor key rotated out of band, or a secret cleared by hand,
  // drops straight through the branch above into a stub that answers every
  // address with one country. The territory gate would keep returning
  // verdicts and keep looking healthy while screening nobody.
  if (env.GEO_STUB_COUNTRY && env.ALLOW_STUB_GEO === '1') {
    const stub = new StubGeoLookup();
    return {
      issuance: stub,
      preflight: stub,
      describe: `geo = STUB (dev only) — country=${env.GEO_STUB_COUNTRY}`,
    };
  }
  if (env.GEO_STUB_COUNTRY) {
    throw new Error(
      `${SERVICE}: GEO_STUB_COUNTRY is set but ALLOW_STUB_GEO is not "1" — refusing to screen ` +
        `entries with the development stub. Set ALLOW_STUB_GEO=1 to opt in (development only), ` +
        `or configure GEO_VENDOR_URL + GEO_VENDOR_API_KEY.`
    );
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

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  // FIRST line, before anything can fail: which code is actually running.
  // Both of 2026-08-31's incidents were a deploy shipping code older than
  // the fix, diagnosed only by comparing a commit on a web page against a
  // branch. The service can simply say.
  console.log(`${SERVICE}: build ${env.BLOTTO_BUILD_COMMIT ?? 'unknown'}`);
  const port = portEnv(env, 'BLOTTO_PACKET_PORT', 8082);
  const db = createPool(loadPostgresConfig(env));
  const territories = loadTerritorySchedule(
    env.BLOTTO_TERRITORIES_PATH ?? resolve(REPO_ROOT, 'config', 'territories.json')
  );
  const terms = loadTerms(env.BLOTTO_TERMS_PATH ?? resolve(REPO_ROOT, 'config', 'terms.json'));
  const termsVersion = terms.version;
  // Selected, loaded and scheduled BEFORE the listener opens: no request is
  // ever answered by a screener that is not ready. Throws → no service.
  //
  // This is the longest step in the boot by a wide margin — the OFAC mirror is
  // a ~29 MB download and parse — and until 2026-09-08 it happened in silence.
  // The deploy that failed on it reported only "timeout reached waiting for
  // health checks to pass", which names the symptom and not one thing about the
  // cause. Bracketing it with logs makes the next occurrence readable: a boot
  // that stops after the first line was still loading, and the elapsed time on
  // the second says how close to the platform's grace period the real load runs.
  // The shared metrics/alert sink, as the indexer already does it. Without
  // it the geo path's only failure signal was a line on standard output —
  // see `geo-composite.ts` for what that cost.
  const monitor = buildMonitor(loadMonitor(env), SERVICE);
  // E-09: the exposition, on the private network only. Silent no-op on
  // every sink but prometheus.
  startMetricsListener(monitor, SERVICE, env);
  const geo = buildGeo(env, monitor);
  console.log(`${SERVICE}: ${geo.describe}`);
  // C-30 (audit 2026-09-11): a sub-national line in the territory schedule
  // that the configured lookup cannot feed is not a rule — it admits every
  // person it names, silently, with no error and no log line. Refuse to start
  // rather than look like a gate that is applying it. Inert against today's
  // country-only schedule, which is the point: it fires the day someone adds
  // a region and the lookup cannot resolve one.
  assertRegionCapability(territories, geo.issuance, geo.describe);

  console.log(`${SERVICE}: loading sanctions sources (the OFAC mirror is ~29 MB)...`);
  const sanctionsStartedAt = Date.now();
  const sanctions = await wireSanctions(env);
  console.log(
    `${SERVICE}: sanctions ready in ${Date.now() - sanctionsStartedAt}ms — ` +
      `${sanctions.describe.join('; ')}`
  );

  serveEntryApi(
    {
      packet: {
        geo: geo.issuance,
        preflightGeo: geo.preflight,
        sanctions: sanctions.list,
        signer: buildSigner(env),
        attestations: new PgAttestationStore(db),
        config: { territories, kycTier: 0, termsVersion, termsUpdated: terms.updated },
        now: () => BigInt(Math.floor(Date.now() / 1000)),
        nonce: () => BigInt('0x' + randomBytes(8).toString('hex')),
      },
      ciphertexts: new PgCiphertextStore(db),
      poolIds: new PgPoolIdResolver(db),
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
  main().catch((err: unknown) => {
    console.error(`${SERVICE}: fatal:`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
