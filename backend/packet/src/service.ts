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
  /** R3: no KYC at launch — issued packets carry tier 0. */
  kycTier: number;
}

export interface PacketRequest {
  wallet: string;
  pool: string;
  ip: string;
  /** The client's age self-attestation (R3: attestation, not verification). */
  ageAttested: boolean;
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
  config: PacketServiceConfig;
  /** Injected clock (unix seconds) — testable freshness. */
  now(): bigint;
  /** Injected nonce source. */
  nonce(): bigint;
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
    const ageOk = req.ageAttested === true;

    if (!territoryOk || !vpnOk || sanctioned || !ageOk) {
      return GENERIC_REJECTION;
    }

    const issuedAt = deps.now();
    const fields: EntryPacketFields = {
      wallet: req.wallet,
      pool: req.pool,
      nonce: deps.nonce(),
      geoCleared: true,
      ageVerified: true,
      kycTier: deps.config.kycTier,
      issuedAt,
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
  } catch {
    // An upstream failure must not leak WHICH upstream failed either.
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
    return territoryAllowed(deps.config.territories, geo.country, geo.region) && !geo.vpnOrProxy;
  } catch {
    return false;
  }
}
