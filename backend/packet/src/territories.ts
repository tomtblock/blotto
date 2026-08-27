/**
 * The territory schedule (D-B3, ratified 2026-08-27) — the founder-owned,
 * config-driven policy behind `GeoLookup`, FAIL-CLOSED at every edge:
 *
 *   - a lookup failure or an ambiguous/unknown location → blocked
 *   - a territory on the `blocked` list → blocked, whatever else says
 *   - a territory absent from the `allowed` list → blocked (R2's allowlist
 *     posture, carried: default United Kingdom / Ireland / Germany until the
 *     founder names otherwise; everything else is unavailable)
 *
 * The file is `config/territories.json` at the repository root:
 *
 *   { "version": 1, "allowed": ["GB", ...], "blocked": ["US-NY", ...],
 *     "updated": "YYYY-MM-DD" }
 *
 * Codes are ISO 3166-1 alpha-2 country codes, optionally suffixed with a
 * region for sub-national blocks (US states: "US-NY"). `blocked` supports
 * both granularities and always wins over `allowed`; the D-B3 schema names
 * `blocked` and this module adds `allowed` so R2's allowlist lives in the
 * same founder-editable file instead of in code. Contents are FOUNDER-OWNED
 * (R2): never edit the lists without a founder instruction.
 */

import { readFileSync } from 'fs';

export interface TerritorySchedule {
  version: number;
  /** ISO 3166-1 alpha-2 codes a player may enter from. */
  allowed: readonly string[];
  /** Explicit blocks — country ("US") or country-region ("US-NY"). Wins. */
  blocked: readonly string[];
  /** Founder's last-edited date, informational. */
  updated: string;
}

const COUNTRY = /^[A-Z]{2}$/;
const COUNTRY_OR_REGION = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

/** Parse + validate a schedule document. Throws on ANY malformation —
 * a schedule that cannot be trusted must not silently admit anyone. */
export function parseTerritorySchedule(text: string): TerritorySchedule {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('territory schedule: not valid JSON');
  }
  const doc = raw as Partial<TerritorySchedule> | null;
  if (!doc || typeof doc !== 'object') throw new Error('territory schedule: not an object');
  if (!Number.isInteger(doc.version) || (doc.version as number) < 1) {
    throw new Error('territory schedule: version must be a positive integer');
  }
  if (typeof doc.updated !== 'string' || doc.updated.length === 0) {
    throw new Error('territory schedule: updated must be a non-empty string');
  }
  for (const [field, pattern] of [
    ['allowed', COUNTRY],
    ['blocked', COUNTRY_OR_REGION],
  ] as const) {
    const list = doc[field];
    if (!Array.isArray(list)) throw new Error(`territory schedule: ${field} must be an array`);
    for (const code of list) {
      if (typeof code !== 'string' || !pattern.test(code)) {
        throw new Error(`territory schedule: bad ${field} code ${JSON.stringify(code)}`);
      }
    }
  }
  return {
    version: doc.version as number,
    allowed: [...(doc.allowed as string[])],
    blocked: [...(doc.blocked as string[])],
    updated: doc.updated,
  };
}

/** Load and validate `config/territories.json` (deployment wiring). */
export function loadTerritorySchedule(path: string): TerritorySchedule {
  return parseTerritorySchedule(readFileSync(path, 'utf8'));
}

/**
 * The one decision function. `country` / `region` come from the geo lookup;
 * anything missing, empty, or malformed answers false — never assume where
 * an unresolvable address is.
 */
export function territoryAllowed(
  schedule: TerritorySchedule,
  country: string | undefined | null,
  region?: string | undefined | null
): boolean {
  if (typeof country !== 'string' || !COUNTRY.test(country)) return false;
  if (schedule.blocked.includes(country)) return false;
  if (region !== undefined && region !== null && region !== '') {
    if (!/^[A-Z0-9]{1,3}$/.test(region)) return false; // ambiguous region → blocked
    if (schedule.blocked.includes(`${country}-${region}`)) return false;
  }
  return schedule.allowed.includes(country);
}

/** R2's launch policy as a schedule — the committed config file's contents. */
export const DEFAULT_TERRITORY_SCHEDULE: TerritorySchedule = {
  version: 1,
  allowed: ['GB', 'IE', 'DE'],
  blocked: [],
  updated: '2026-08-27',
};
