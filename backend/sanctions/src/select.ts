/**
 * The sanctions-provider SELECTOR, in its own module so it can be
 * unit-tested — `backend/packet/src/signer-select.ts` is the model, and its
 * header records why the selector must not live in a service's `main.ts`.
 *
 * Every branch says which path it chose, because a clean boot proves the
 * credentials were present, not which screener is live.
 *
 *   Production: any of
 *     SANCTIONS_CHAINALYSIS_API_KEY        → Chainalysis (primary)
 *     SANCTIONS_OPENSANCTIONS_API_KEY      → OpenSanctions (cross-check)
 *     SANCTIONS_OFAC_SDN=1                 → the mirrored OFAC SDN list
 *       [SANCTIONS_OFAC_SDN_URL | SANCTIONS_OFAC_SDN_PATH, SANCTIONS_OFAC_MAX_AGE_HOURS]
 *   composed by `CompositeSanctionsCheck`, wrapped in a per-address cache
 *   unless SANCTIONS_CACHE_TTL_MS=0.
 *
 *   Development: SANCTIONS_STUB_LISTED (comma-separated; empty = nobody)
 *   behind an explicit ALLOW_STUB_SANCTIONS=1, exactly as the dev entry
 *   signer requires its own opt-in — absence of vendor keys must never
 *   silently mean "screen against nothing".
 *
 *   Nothing configured → throw. The packet service refuses to boot rather
 *   than issue packets unscreened; the daemon does the same.
 */

import { CachingSanctionsCheck } from './cache';
import { ChainalysisCheck } from './chainalysis';
import { CompositeSanctionsCheck, type NamedSource } from './composite';
import { OfacSdnMirror } from './ofac-sdn';
import { OpenSanctionsCheck } from './opensanctions';
import { StubSanctionsCheck, type SanctionsCheck } from './seam';

export interface BuiltSanctions {
  check: SanctionsCheck;
  /** Present when the OFAC mirror is configured — the caller schedules `refresh()`. */
  ofac: OfacSdnMirror | null;
  /** One line per source, for the startup log. Never contains a secret. */
  describe: string[];
}

function redact(v: string | undefined): string {
  if (!v) return '<unset>';
  return v.length <= 8 ? '****' : `${v.slice(0, 4)}…`;
}

export function buildSanctions(env: NodeJS.ProcessEnv, service: string): BuiltSanctions {
  const sources: NamedSource[] = [];
  const describe: string[] = [];
  let ofac: OfacSdnMirror | null = null;

  if (env.SANCTIONS_CHAINALYSIS_API_KEY) {
    sources.push({
      name: 'chainalysis',
      check: new ChainalysisCheck({ apiKey: env.SANCTIONS_CHAINALYSIS_API_KEY }),
    });
    describe.push(`chainalysis (key ${redact(env.SANCTIONS_CHAINALYSIS_API_KEY)})`);
  }
  if (env.SANCTIONS_OPENSANCTIONS_API_KEY) {
    sources.push({
      name: 'opensanctions',
      check: new OpenSanctionsCheck({ apiKey: env.SANCTIONS_OPENSANCTIONS_API_KEY }),
    });
    describe.push(`opensanctions (key ${redact(env.SANCTIONS_OPENSANCTIONS_API_KEY)})`);
  }
  if (env.SANCTIONS_OFAC_SDN === '1') {
    const hours = env.SANCTIONS_OFAC_MAX_AGE_HOURS ? Number(env.SANCTIONS_OFAC_MAX_AGE_HOURS) : 36;
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new Error(`${service}: SANCTIONS_OFAC_MAX_AGE_HOURS must be a positive number`);
    }
    ofac = new OfacSdnMirror({
      url: env.SANCTIONS_OFAC_SDN_URL || undefined,
      path: env.SANCTIONS_OFAC_SDN_PATH || undefined,
      maxAgeMs: hours * 3_600_000,
    });
    sources.push({ name: 'ofac-sdn', check: ofac });
    describe.push(
      `ofac-sdn mirror (${env.SANCTIONS_OFAC_SDN_PATH ? `file ${env.SANCTIONS_OFAC_SDN_PATH}` : 'Sanctions List Service'}, max age ${hours} h)`
    );
  }

  if (sources.length > 0) {
    const composite = new CompositeSanctionsCheck(sources);
    const ttl = env.SANCTIONS_CACHE_TTL_MS === undefined ? 900_000 : Number(env.SANCTIONS_CACHE_TTL_MS);
    if (!Number.isFinite(ttl) || ttl < 0) {
      throw new Error(`${service}: SANCTIONS_CACHE_TTL_MS must be a non-negative number`);
    }
    const check = ttl > 0 ? new CachingSanctionsCheck(composite, { ttlMs: ttl }) : composite;
    describe.push(ttl > 0 ? `per-address cache ${ttl} ms` : 'cache DISABLED');
    console.log(`${service}: sanctions = ${describe.join('; ')}`);
    return { check, ofac, describe };
  }

  if (env.SANCTIONS_STUB_LISTED !== undefined) {
    if (env.ALLOW_STUB_SANCTIONS !== '1') {
      throw new Error(
        `${service}: SANCTIONS_STUB_LISTED is set but no vendor key is, so the DEVELOPMENT ` +
          `stub would screen every wallet. If that is intended, set ALLOW_STUB_SANCTIONS=1. ` +
          `If a vendor was intended, its key is missing from this process's environment.`
      );
    }
    console.warn(`${service}: sanctions = STUB (SANCTIONS_STUB_LISTED, ALLOW_STUB_SANCTIONS=1) — NOT a vendor. Development only.`);
    // Parsed from the env THIS call was handed, never from process.env: the
    // selector's whole reason for being a function of `env` is that a test
    // (and a service booted with an explicit environment) sees exactly what
    // it passed.
    const listed = env.SANCTIONS_STUB_LISTED.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { check: new StubSanctionsCheck(listed), ofac: null, describe: ['stub'] };
  }

  throw new Error(
    `${service}: no sanctions screener configured — set SANCTIONS_CHAINALYSIS_API_KEY, ` +
      `SANCTIONS_OPENSANCTIONS_API_KEY and/or SANCTIONS_OFAC_SDN=1, or SANCTIONS_STUB_LISTED ` +
      `with ALLOW_STUB_SANCTIONS=1 (dev)`
  );
}
