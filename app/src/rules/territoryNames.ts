/**
 * Display names for the codes `config/territories.json` can carry.
 *
 * Lifted out of `app/src/app/rules/rules.config.ts` on 2026-09-13 (founder
 * instruction 2026-09-12 §3.3), where it was a five-entry table covering
 * `GB / IE / DE / BE / AU` and an unmapped code rendered as the bare code.
 * That was survivable with two territories in the schedule. With the PID §9
 * block it is not: a player in a blocked territory would be told they are
 * blocked by a page reading "IN", "SG", "US-WA".
 *
 * THE CODES ARE FOUNDER-OWNED, THE NAMES ARE NOT. What is blocked is
 * decided in `config/territories.json` and nowhere else; this file only says
 * how a code is written down for a reader. Adding a name here blocks
 * nothing, and removing one blocks nothing — it only makes the page worse.
 *
 * Entries exist for codes the schedule does NOT carry yet (the US states and
 * the sanctions set, both held — see `config/territories.README.md`). That
 * is deliberate: `scripts/check-territories.ts` fails the build if a code
 * reaches the schedule without a name here, and the failure should not be
 * the thing that stops a territory being blocked on the day counsel
 * confirms it.
 *
 * Region codes are ISO 3166-2 subdivisions and render as "Washington (US)"
 * — the subdivision first, because that is what the reader is looking for,
 * with the country in brackets so "Delaware (US)" is never confused with
 * Germany.
 */

/** Country names, ISO 3166-1 alpha-2. */
const COUNTRY_NAMES: Record<string, string> = {
  // — Live in the schedule since version 3 (PID §9, the confirmed rows).
  AE: 'United Arab Emirates',
  AU: 'Australia',
  BE: 'Belgium',
  BH: 'Bahrain',
  CN: 'China',
  HK: 'Hong Kong',
  ID: 'Indonesia',
  US: 'United States',
  IN: 'India',
  KW: 'Kuwait',
  MY: 'Malaysia',
  OM: 'Oman',
  QA: 'Qatar',
  SA: 'Saudi Arabia',
  SG: 'Singapore',

  // — Held pending counsel's exact sanctions set. Named here so the day it
  //   is settled is a one-line change to the JSON. These countries are
  //   already refused on every entry by the wallet screening, which checks
  //   live lists rather than a country code, so holding them opens nothing.
  BY: 'Belarus',
  CU: 'Cuba',
  IR: 'Iran',
  KP: 'North Korea',
  RU: 'Russia',
  SY: 'Syria',
  VE: 'Venezuela',

  // — Not blocked. Carried because the schedule was an ALLOW-list until
  //   2026-08-28 and these were its members; a posture change back would
  //   render them again.
  DE: 'Germany',
  GB: 'United Kingdom',
  IE: 'Ireland',
};

/** Subdivision names, ISO 3166-2, keyed by the full `CC-SSS` code. */
const REGION_NAMES: Record<string, string> = {
  // — Held: the geo vendor of record resolves a subdivision NAME, never a
  //   code, so the entry service refuses to start with any of these in the
  //   schedule rather than admit the people they name. See
  //   `config/territories.README.md` and `backend/packet/src/service.ts`
  //   (`assertRegionCapability`).
  'US-AR': 'Arkansas',
  'US-AZ': 'Arizona',
  'US-CT': 'Connecticut',
  'US-DE': 'Delaware',
  'US-LA': 'Louisiana',
  'US-MD': 'Maryland',
  'US-MT': 'Montana',
  'US-SC': 'South Carolina',
  'US-SD': 'South Dakota',
  'US-TN': 'Tennessee',
  'US-VT': 'Vermont',
  'US-WA': 'Washington',

  // — Held with the sanctions set above.
  'UA-09': 'Luhansk',
  'UA-14': 'Donetsk',
  'UA-43': 'Crimea',
};

/**
 * A code as a reader should see it.
 *
 * Falls back to the code itself, unchanged from the behaviour this replaced:
 * a territory that is blocked must still be NAMED on the page, and a missing
 * display name is a worse page, never a missing block. `check-territories`
 * makes the fallback unreachable for anything actually in the schedule.
 */
export function territoryName(code: string): string {
  const region = REGION_NAMES[code];
  if (region !== undefined) {
    // The subdivision leads, because that is what the reader is looking
    // for; the country code disambiguates, so "Delaware (US)" is never
    // read as Germany. The country's FULL name is not used — "Washington
    // (United States)" is longer without being clearer, and these render
    // in a list beside country names where a bracketed code reads as a
    // qualifier rather than as a second entry.
    return `${region} (${code.slice(0, 2)})`;
  }
  return COUNTRY_NAMES[code] ?? code;
}

/** Every code this module can name — the set `check-territories.ts` tests
 * the schedule against. */
export function namedTerritoryCodes(): readonly string[] {
  return [...Object.keys(COUNTRY_NAMES), ...Object.keys(REGION_NAMES)].sort();
}
