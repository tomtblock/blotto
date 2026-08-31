/**
 * Packet issuance (roadmap 4.2): every check must clear or the caller gets
 * ONE generic rejection — never which check failed. Geolocation vendors,
 * VPN/proxy intelligence and the sanctions list are seams: the vendor of
 * record is contracted in Phase 6 (R2 flags it must be named before this
 * service ships); stub implementations run today (`geo-adapters.ts`) and the
 * interfaces are what the vendor adapters implement.
 *
 * Territory policy (D-B3, carrying R2): the founder-owned schedule in
 * `config/territories.json` — an `allowed` list (default United Kingdom /
 * Ireland / Germany) plus an explicit `blocked` list that always wins and
 * supports US-state granularity. FAIL-CLOSED: a lookup failure, an unknown
 * country, or an ambiguous region blocks the entry. See `territories.ts`.
 */

import { encodePacket, type EntryPacketFields, type PacketSigner } from './packet';
import { territoryAllowed, type TerritorySchedule } from './territories';
import type { AttestationStore } from './attestations';

export interface GeoLookupResult {
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  /** Sub-national region where the vendor resolves one (US states). */
  region?: string;
  /** Whether the address is a known VPN/proxy/hosting exit. */
  vpnOrProxy: boolean;
}

export interface GeoLookup {
  lookup(ip: string): Promise<GeoLookupResult>;
}

export interface SanctionsList {
  isSanctioned(wallet: string, country: string): Promise<boolean>;
}

export interface PacketServiceConfig {
  /** The founder-owned schedule from `config/territories.json` (D-B3). */
  territories: TerritorySchedule;
  /** R3: KYC stays off at launch — issued packets carry tier 0. */
  kycTier: number;
  /** Current terms version from `config/terms.json` (D-B4). */
  termsVersion: number;
}

export interface PacketRequest {
  wallet: string;
  pool: string;
  ip: string;
}

export interface IssuedPacket {
  ok: true;
  /** The 83 canonical bytes, base64. */
  message: string;
  /** Ed25519 signature over the message, base64. */
  signature: string;
  /** The signer's public key, base64 — must equal `Config.entry_signer`. */
  publicKey: string;
  issuedAt: string;
}

/** THE generic rejection. One shape, one string, whatever failed. */
export interface GenericRejection {
  ok: false;
  error: 'entry_unavailable';
}

export const GENERIC_REJECTION: GenericRejection = { ok: false, error: 'entry_unavailable' };

export interface PacketServiceDeps {
  geo: GeoLookup;
  sanctions: SanctionsList;
  signer: PacketSigner;
  /** D-B4: the durable clickwrap records; issuance requires one at the
   * CURRENT terms version — an older record means the client re-prompts. */
  attestations: AttestationStore;
  config: PacketServiceConfig;
  /** Injected clock (unix seconds) — testable freshness. */
  now(): bigint;
  /** Injected nonce source. */
  nonce(): bigint;
}

/**
 * Server-side observability for the entry gate.
 *
 * The CLIENT gets one uniform answer, always — that is what makes the gate
 * non-probeable and it does not change here. The OPERATOR needs the reason
 * by name, and until 2026-08-31 got nothing at all on this path: `/geo`
 * caught every failure with a bare `catch { return false }`, so a live
 * vendor fault and a correctly blocked territory were identical in the
 * response AND absent from the logs. Ninety minutes went into the Turnkey
 * base URL for exactly that reason; this is the same fix one layer over.
 *
 * The two are not in tension: the log is not reachable by the caller.
 */

/** First two octets of a v4 address, or the first hextet of a v6 — enough to
 * correlate an entrant across log lines during a run, without writing whole
 * addresses to a log that outlives the reason for holding them. */
function ipPrefix(ip: string): string {
  if (ip.includes(':')) return `${ip.split(':')[0]}:…`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : 'unparsed';
}

function logGeo(verdict: 'ALLOW' | 'BLOCK', ip: string, detail: string): void {
  console.log(`packet: geo ${verdict} ${ipPrefix(ip)} — ${detail}`);
}

export async function issuePacket(
  deps: PacketServiceDeps,
  req: PacketRequest
): Promise<IssuedPacket | GenericRejection> {
  try {
    // Every check runs even after one fails: uniform timing, uniform answer.
    const geo = await deps.geo.lookup(req.ip);
    const territoryOk = territoryAllowed(deps.config.territories, geo.country, geo.region);
    const vpnOk = !geo.vpnOrProxy;
    const sanctioned = await deps.sanctions.isSanctioned(req.wallet, geo.country);
    // D-B4: the durable, signature-verified clickwrap record replaces the
    // old per-request boolean; it must exist AT the current version.
    const attestation = await deps.attestations.get(req.wallet);
    const ageOk =
      attestation !== null &&
      attestation.attested18 === true &&
      attestation.termsVersion === deps.config.termsVersion;

    if (!territoryOk || !vpnOk || sanctioned || !ageOk) {
      // Every failing check, not just the first — the caller still learns
      // nothing, and an operator chasing a stalled fill needs to know
      // whether it is the territory schedule or a missing attestation.
      const failed = [
        territoryOk ? null : `territory(${geo.country}${geo.region ? `-${geo.region}` : ''})`,
        vpnOk ? null : 'vpn-or-proxy',
        sanctioned ? 'sanctions' : null,
        ageOk ? null : 'attestation-missing-or-stale',
      ].filter(Boolean);
      logGeo('BLOCK', req.ip, `packet refused: ${failed.join(', ')}`);
      return GENERIC_REJECTION;
    }
    logGeo('ALLOW', req.ip, `packet issued: country=${geo.country}`);

    const issuedAt = deps.now();
    const fields: EntryPacketFields = {
      wallet: req.wallet,
      pool: req.pool,
      nonce: deps.nonce(),
      geoCleared: true,
      ageVerified: true,
      kycTier: deps.config.kycTier,
      issuedAt,
      termsVersion: attestation.termsVersion,
    };
    const message = encodePacket(fields);
    const signature = await deps.signer.sign(message);
    const publicKey = await deps.signer.publicKey();
    return {
      ok: true,
      message: Buffer.from(message).toString('base64'),
      signature: Buffer.from(signature).toString('base64'),
      publicKey: Buffer.from(publicKey).toString('base64'),
      issuedAt: issuedAt.toString(),
    };
  } catch (e) {
    // The CLIENT must never learn which upstream failed — that is what makes
    // the rejection uniform and the gate non-probeable. The OPERATOR must,
    // and until 2026-08-31 did not: a Turnkey signing failure and a blocked
    // territory were indistinguishable from outside AND from the logs, so a
    // live signer fault looked exactly like a correctly refused entry.
    //
    // Log server-side, answer generically. The two are not in tension: the
    // log is not reachable by the caller.
    console.error(
      `packet: entry packet NOT issued — ${e instanceof Error ? e.message : String(e)}`
    );
    return GENERIC_REJECTION;
  }
}

/**
 * The pre-flight verdict behind `GET /geo` (D-B3): the same lookup and the
 * same schedule as issuance, answering only a boolean — which check decided
 * is never disclosed. Any failure answers false: fail-closed.
 */
export async function geoVerdict(deps: PacketServiceDeps, ip: string): Promise<boolean> {
  try {
    const geo = await deps.geo.lookup(ip);
    const territoryOk = territoryAllowed(deps.config.territories, geo.country, geo.region);
    if (!territoryOk) {
      logGeo('BLOCK', ip, `territory schedule: ${geo.country}${geo.region ? `-${geo.region}` : ''}`);
      return false;
    }
    if (geo.vpnOrProxy) {
      logGeo('BLOCK', ip, `vendor reports vpn/proxy/tor: ${geo.country}`);
      return false;
    }
    logGeo('ALLOW', ip, `country=${geo.country}`);
    return true;
  } catch (e) {
    // THE fix. A vendor that is unreachable, out of quota, or answering a
    // shape we cannot read produced a silent `false` here — identical to a
    // country on the block list. It is now named, and the vendor's own
    // error text carries the distinction (GeoQuotaError says so outright).
    logGeo(
      'BLOCK',
      ip,
      `LOOKUP FAILED (this is NOT a territory decision) — ${e instanceof Error ? e.message : String(e)}`
    );
    return false;
  }
}
