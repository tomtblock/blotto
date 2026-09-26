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
import { walletAllowed, type WalletBlocklist } from './blocked-wallets';
import type { AttestationStore } from './attestations';
import { ALERT } from '../../_shared/src/metrics';
import type { Monitor } from '../../_shared/src/monitor';
import { ipPrefix, short } from '../../_shared/src/short';

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
  /**
   * Whether this adapter resolves a sub-national REGION for the addresses it
   * answers about — i.e. whether a `"US-NY"` line in the territory schedule
   * can bite (audit 2026-09-11, C-30).
   *
   * Undefined means "not declared", and not-declared is treated as NO: a
   * capability that has not been stated has not been proven, and the cost of
   * being wrong is a schedule entry that admits everyone it names while
   * reading as though it blocks them. `assertRegionCapability` below is the
   * boot check the Phase 0 record's accepted gap asked for.
   */
  readonly resolvesRegion?: boolean;
}

/**
 * What a screening said, for the record a refusal must leave (audit
 * 2026-09-11, B-36). The structural mirror of `SanctionsVerdict`'s public
 * half — declared here rather than imported for the reason the seam below
 * is: this module knows nothing about which package screens.
 *
 * `listed` remains the ONLY field any decision reads. The rest is evidence.
 */
export interface SanctionsScreening {
  listed: boolean;
  matches: readonly {
    source: string;
    listName: string;
    entityName: string;
    entityId?: string;
  }[];
  consulted: readonly string[];
  failed: readonly string[];
  /** ISO-8601, from the screener's own clock. */
  checkedAt: string;
}

/** One refused entry, as `issuePacket` saw it. */
export interface SanctionsRefusal {
  wallet: string;
  pool: string;
  /** What the geo lookup returned, or null when it did not answer. */
  country: string | null;
  /** The client address, ALREADY TRUNCATED — see `ipPrefix`. */
  ipPrefix: string;
  screening: SanctionsScreening;
}

export interface SanctionsList {
  isSanctioned(wallet: string, country: string): Promise<boolean>;
  /**
   * The whole screening, when the wiring can supply it. Optional so every
   * test double and the offline suites keep working with the boolean alone;
   * `issuePacket` prefers it, because a refusal recorded without the matched
   * list is not a record of anything.
   */
  screen?(wallet: string): Promise<SanctionsScreening>;
  /**
   * Persist a refusal. Optional for the same reason, and wired by
   * `sanctions-wiring.ts` when a database is configured.
   */
  recordRefusal?(refusal: SanctionsRefusal): Promise<void>;
}

export interface PacketServiceConfig {
  /** The founder-owned schedule from `config/territories.json` (D-B3). */
  territories: TerritorySchedule;
  /**
   * The founder-owned wallet blocklist (2026-09-19), behind the terms
   * clause "Refusing entry and withholding a prize". Consulted in
   * `issuePacket` beside the territory and sanctions checks, and answering
   * with the SAME generic rejection — a refused address learns nothing
   * about which check refused it. Shipped empty.
   */
  blockedWallets: WalletBlocklist;
  /** R3: KYC stays off at launch — issued packets carry tier 0. */
  kycTier: number;
  /** Current terms version from `config/terms.json` (D-B4). */
  termsVersion: number;
  /** The date of that edition (`updated` in the same file) — named in the signed statement. */
  termsUpdated: string;
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
  /** The lookup ISSUANCE uses — the call that decides whether money moves. */
  geo: GeoLookup;
  /**
   * The lookup the unauthenticated `GET /geo` pre-flight uses, when it is not
   * the same one.
   *
   * They were the same until 2026-09-12, and that was the defect: a courtesy
   * check for a visitor who has not signed in, not attested and not paid
   * competed for the same finite paid-vendor credits as issuance, so the
   * cheapest traffic in the system could starve the most valuable call in it
   * (audit 2026-09-11, B-04). `geo-budget.ts` gives issuance a reserve the
   * pre-flight cannot reach; this field is how the two faces arrive here.
   *
   * Optional, defaulting to `geo`, so every offline route suite and the
   * rehearsal are unchanged.
   */
  preflightGeo?: GeoLookup;
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
  /**
   * Where a sanctions refusal that could NOT be recorded is reported
   * (2026-09-16). Optional so every offline route suite is unchanged; without
   * it the failure is still logged, just not paged.
   */
  monitor?: Monitor;
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

/** The address truncation every log line and the durable refusal record
 * (B-36) apply — since 2026-09-16 the one shared rule in
 * `_shared/src/short.ts`, re-exported here for the callers that always
 * imported it from this module. */
export { ipPrefix };

function logGeo(verdict: 'ALLOW' | 'BLOCK', ip: string, detail: string): void {
  console.log(`packet: geo ${verdict} ${ipPrefix(ip)} — ${detail}`);
}

/**
 * Screen, preferring the whole verdict over the bare boolean so a refusal
 * can be recorded with the list that matched (B-36). A seam that offers only
 * `isSanctioned` — every existing test double — still works, and its
 * refusals are recorded with an empty match list rather than not at all.
 */
async function screen(
  sanctions: SanctionsList,
  wallet: string,
  country: string
): Promise<SanctionsScreening> {
  if (sanctions.screen) return sanctions.screen(wallet);
  const listed = await sanctions.isSanctioned(wallet, country);
  return { listed, matches: [], consulted: [], failed: [], checkedAt: new Date().toISOString() };
}

/**
 * Write the refusal down, and never let the writing change the answer.
 *
 * The entry is refused either way — the record is evidence, not a gate — so
 * a store that is unreachable must not turn a sanctions refusal into a
 * generic upstream failure or (worse, if the ordering were ever inverted) an
 * issued packet. A failed write is shouted into the log WITH the record, so
 * the evidence survives in the one place that is still working.
 *
 * PHASE-2-REVIEW (2026-09-12): the write is AWAITED before the rejection is
 * returned, which makes a sanctions refusal measurably slower than the other
 * refusals — a timing signal the uniform rejection otherwise hides. Taken
 * deliberately: the thing disclosed is that a wallet is on a PUBLISHED list
 * the caller can read for themselves, while the thing protected is a record
 * we are obliged to be able to produce. Fire-and-forget would keep the
 * timing flat and lose the row on a process that exits between the answer
 * and the insert.
 */
async function recordSanctionsRefusal(
  sanctions: SanctionsList,
  refusal: SanctionsRefusal,
  monitor?: Monitor
): Promise<void> {
  // Truncated identifiers on the log path (2026-09-16, the founder's
  // data-minimisation ruling of 2026-09-15): the durable refusal record is
  // the evidence, and a log line that outlives it must not be a second,
  // unbounded copy of the wallet. Until then this line carried the whole
  // wallet, and a failed insert dumped the entire record — matches,
  // the listed party's name and all — into standard output.
  const lists = refusal.screening.matches.map((m) => `${m.source}:${m.listName}`).join(', ');
  const who = `wallet=${short(refusal.wallet)} pool=${short(refusal.pool)}`;
  console.warn(
    `packet: SANCTIONS REFUSAL ${who} ` +
      `lists=[${lists}] consulted=[${refusal.screening.consulted.join(', ')}] ` +
      `failed=[${refusal.screening.failed.join(', ')}] country=${refusal.country ?? 'unknown'} ` +
      `ip=${refusal.ipPrefix} at=${refusal.screening.checkedAt}`
  );
  if (!sanctions.recordRefusal) return;
  try {
    await sanctions.recordRefusal(refusal);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`packet: FAILED to persist a sanctions refusal (${who}) — ${message}`);
    // The refusal stands; what is lost is the durable evidence, so this pages
    // rather than reprinting the record. The vendor's own query log and the
    // truncated line above are what remain to reconstruct it from.
    monitor?.alert(ALERT.packet.sanctionsRefusalUnrecorded, {
      wallet: short(refusal.wallet),
      pool: short(refusal.pool),
      lists,
      at: refusal.screening.checkedAt,
      error: message,
    });
  }
}

/**
 * True when the schedule carries a sub-national rule for the country this
 * lookup returned and the lookup produced no region to test it against
 * (audit 2026-09-11, C-30).
 *
 * The country-level rules beside it keep working, which is exactly what made
 * the original gap hard to notice: the file reads as though every line is
 * live.
 */
function regionRuleUnenforceable(
  schedule: TerritorySchedule,
  geo: { country: string; region?: string }
): boolean {
  if (geo.region !== undefined && geo.region !== '') return false;
  return schedule.blocked.some((code) => code.startsWith(`${geo.country}-`));
}

/**
 * The boot assertion the Phase 0 record's accepted gap named as the
 * prerequisite for the first sub-national rule, and which did not exist
 * (audit 2026-09-11, C-30).
 *
 * Call it once at startup with the loaded schedule and the lookup issuance
 * will use. It throws when the schedule carries a country-region entry and
 * the adapter does not declare `resolvesRegion` — the state in which those
 * entries admit every person they name, silently, with no error and no log
 * line. A country-only schedule (today's: `BE`, `AU`) passes with any
 * adapter, so this is inert until the day it is not.
 */
export function assertRegionCapability(
  schedule: TerritorySchedule,
  geo: GeoLookup,
  describe = 'the configured geo lookup'
): void {
  const subNational = schedule.blocked.filter((code) => code.includes('-'));
  if (subNational.length === 0) return;
  if (geo.resolvesRegion === true) return;
  throw new Error(
    `packet: the territory schedule blocks ${subNational.join(', ')}, which is a sub-national ` +
      `rule, and ${describe} does not resolve a region — so every one of those entries would ` +
      `admit the people it names, silently. Either configure a lookup that returns ISO 3166-2 ` +
      `region codes (and declares resolvesRegion), or remove the sub-national entries from ` +
      `config/territories.json. Refusing to start: a rule that cannot be applied must not look ` +
      `like one that is.`
  );
}

export async function issuePacket(
  deps: PacketServiceDeps,
  req: PacketRequest
): Promise<IssuedPacket | GenericRejection> {
  try {
    // Every check runs even after one fails: uniform timing, uniform answer.
    const geo = await deps.geo.lookup(req.ip);
    const territoryOk = territoryAllowed(deps.config.territories, geo.country, geo.region);
    // C-30: a sub-national rule that the lookup cannot feed is not a rule, it
    // is a line in a file. Refuse the entry rather than admit it under a rule
    // nobody can apply. `assertRegionCapability` catches this at boot; this
    // is the second line, for a deployment that never called it.
    const regionOk = !regionRuleUnenforceable(deps.config.territories, geo);
    const vpnOk = !geo.vpnOrProxy;
    // 2026-09-19: the founder's own list, distinct from the sanctions
    // sources below — those answer about published lists; this is the terms
    // clause's enumerated grounds, recorded per address in
    // config/blocked-wallets.README.md.
    const walletOk = walletAllowed(deps.config.blockedWallets, req.wallet);
    const screening = await screen(deps.sanctions, req.wallet, geo.country);
    const sanctioned = screening.listed;
    // D-B4: the durable, signature-verified clickwrap record replaces the
    // old per-request boolean; it must exist AT the current version.
    const attestation = await deps.attestations.get(req.wallet);
    const ageOk =
      attestation !== null &&
      attestation.attested18 === true &&
      attestation.termsVersion === deps.config.termsVersion;

    if (!territoryOk || !regionOk || !vpnOk || !walletOk || sanctioned || !ageOk) {
      // Every failing check, not just the first — the caller still learns
      // nothing, and an operator chasing a stalled fill needs to know
      // whether it is the territory schedule or a missing attestation.
      const failed = [
        territoryOk ? null : `territory(${geo.country}${geo.region ? `-${geo.region}` : ''})`,
        regionOk ? null : `region-unresolved(${geo.country})`,
        vpnOk ? null : 'vpn-or-proxy',
        walletOk ? null : 'wallet-blocklist',
        sanctioned ? 'sanctions' : null,
        ageOk ? null : 'attestation-missing-or-stale',
      ].filter(Boolean);
      logGeo('BLOCK', req.ip, `packet refused: ${failed.join(', ')}`);
      if (sanctioned) {
        await recordSanctionsRefusal(
          deps.sanctions,
          {
            wallet: req.wallet,
            pool: req.pool,
            country: geo.country ?? null,
            ipPrefix: ipPrefix(req.ip),
            screening,
          },
          deps.monitor
        );
      }
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
    // The pre-flight face when one is configured — see `preflightGeo`.
    const geo = await (deps.preflightGeo ?? deps.geo).lookup(ip);
    const territoryOk = territoryAllowed(deps.config.territories, geo.country, geo.region);
    if (!territoryOk) {
      logGeo('BLOCK', ip, `territory schedule: ${geo.country}${geo.region ? `-${geo.region}` : ''}`);
      return false;
    }
    // C-30, as in `issuePacket`: a sub-national rule with no region to test
    // against blocks here too, or the pre-flight would tell a visitor they
    // may enter and issuance would then refuse them.
    if (regionRuleUnenforceable(deps.config.territories, geo)) {
      logGeo('BLOCK', ip, `sub-national rule for ${geo.country} and no region resolved`);
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
