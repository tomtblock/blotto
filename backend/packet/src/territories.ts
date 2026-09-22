/**
 * The territory schedule (D-B3, ratified 2026-08-27; posture redirected by
 * founder instruction 2026-08-28) — the founder-owned, config-driven policy
 * behind `GeoLookup`, FAIL-CLOSED at every edge:
 *
 *   - a lookup failure or an ambiguous/unknown location → blocked, in
 *     EITHER posture (the fail-closed property is not posture-dependent)
 *   - a territory on the `blocked` list → blocked, whatever else says
 *   - otherwise, the posture decides:
 *       "allow-list"  → blocked unless the country is on `allowed`
 *                       (R2's original carry: GB / IE / DE)
 *       "block-list"  → allowed (the launch policy since 2026-08-28:
 *                       everywhere except Belgium and Australia)
 *
 * The file is `config/territories.json` at the repository root:
 *
 *   { "version": 2, "posture": "block-list", "allowed": [],
 *     "blocked": ["BE", "AU"], "updated": "YYYY-MM-DD" }
 *
 * Codes are ISO 3166-1 alpha-2 country codes, optionally suffixed with a
 * region for sub-national blocks (US states: "US-NY"). `blocked` supports
 * both granularities and always wins. A missing `posture` reads as
 * "allow-list" (the original schema); under "block-list" the `allowed`
 * list must be empty — a populated allowlist that decides nothing would
 * misstate the policy to anyone reading the file. Contents are
 * FOUNDER-OWNED (R2): never edit the lists or posture without a founder
 * instruction.
 */

import { readFileSync } from 'fs';

export type TerritoryPosture = 'allow-list' | 'block-list';

export interface TerritorySchedule {
  version: number;
  /** Which way an unlisted (but resolved) territory falls. */
  posture: TerritoryPosture;
  /** ISO 3166-1 alpha-2 codes a player may enter from (allow-list posture;
   * must be empty under block-list). */
  allowed: readonly string[];
  /** Explicit blocks — country ("BE") or country-region ("US-NY"). Wins. */
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
  const posture = (doc as { posture?: unknown }).posture ?? 'allow-list';
  if (posture !== 'allow-list' && posture !== 'block-list') {
    throw new Error('territory schedule: posture must be "allow-list" or "block-list"');
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
  if (posture === 'block-list' && (doc.allowed as string[]).length > 0) {
    throw new Error(
      'territory schedule: allowed must be empty under block-list posture'
    );
  }
  return {
    version: doc.version as number,
    posture,
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
 * an unresolvable address is. Only a well-formed, unblocked location ever
 * reaches the posture branch.
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
  return schedule.posture === 'block-list' || schedule.allowed.includes(country);
}

/**
 * The launch policy as a schedule — the committed config file's contents.
 *
 * Version 3 (founder instruction 2026-09-12): the PID §9 legal-review block,
 * confirmed rows only. India, Belgium and Australia; the six GCC states; and
 * China, Hong Kong, Singapore, Malaysia, Indonesia.
 *
 * Two sets of §9 rows are deliberately ABSENT, both recorded with their
 * reasons in `config/territories.README.md`:
 *
 *   - THE US STATES, including Washington, are sub-national rules. No geo
 *     source wired here resolves an ISO 3166-2 region, so
 *     `assertRegionCapability` would refuse to start rather than admit every
 *     person those rows name. Held on a region-capable source.
 *   - THE SANCTIONS SET is held pending counsel's exact list. It opens
 *     nothing: those countries are already refused on every entry by the
 *     wallet screening in `backend/sanctions/`, which checks live lists and
 *     named individuals rather than a country code.
 *
 * This mirror exists for tests and for a deployment with no config file. The
 * committed file is the authority and `territories.spec.ts` pins the two
 * together.
 */
export const DEFAULT_TERRITORY_SCHEDULE: TerritorySchedule = {
  version: 5,
  posture: 'block-list',
  allowed: [],
  // Sorted, because this must deep-equal config/territories.json and that
  // file is written sorted. Provenance is in the note below rather than in
  // the layout: grouping by version here is what broke the mirror test.
  //
  //   version 3 (2026-09-12) — the fourteen PID §9 rows marked confirmed
  //   version 4 (2026-09-21, D-B3-3) — US, at COUNTRY level and wider than
  //     §9's twelve states on purpose: the geo source of record returns a
  //     subdivision NAME and never an ISO 3166-2 code, so
  //     `assertRegionCapability` refuses to start on a `US-SS` row. Narrows
  //     to the twelve the day a region-capable source is contracted.
  //   version 5 (founder instruction 2026-09-18, landed 2026-09-22 as
  //     D-B3-4) — ES, FR, IT. §9 had these "open subject to counsel
  //     confirmation"; the instruction supersedes that pending a written
  //     opinion, on the counsel brief Part 6.3 reading that all three need a
  //     state authorisation for paid skill competitions with cash prizes
  //     whatever the answer on chance.
  blocked: [
    'AE', 'AU', 'BE', 'BH', 'CN', 'ES', 'FR', 'HK', 'ID',
    'IN', 'IT', 'KW', 'MY', 'OM', 'QA', 'SA', 'SG', 'US',
  ],
  updated: '2026-09-22',
};
