/*
 * The rules tab's single data source (D-B6, ratified 2026-08-27). EVERY
 * number rendered on the rules page derives here from the same shared
 * constants the prize path uses — TIER_ENTRY_LAMPORTS / TIER_POT_LAMPORTS /
 * MIN_SEATS / DEFAULT_FILL_DEADLINE_SECS / DEFAULT_COOLDOWN_SECS from
 * @blotto/scoring (pinned to the Python
 * oracle and, via LiteSVM, to the on-chain program) — and from the
 * founder-owned config file (territories). No hand-typed figures,
 * so the page cannot drift from what the program pays or enforces.
 *
 * All lamport arithmetic is bigint; formatting to SOL happens at the edge
 * through the same float-free formatter the rest of the app uses.
 */

import {
  DEFAULT_COOLDOWN_SECS,
  DEFAULT_FILL_DEADLINE_SECS,
  MIN_SEATS,
  TIER_ENTRY_LAMPORTS,
  TIER_POT_LAMPORTS,
} from '@blotto/scoring';
import { BOARD_CLOCK_BUDGET_MS } from '@/battle/board/mode';
import { COPY } from '@/copy';
import { lamportsToSol } from '@/data/format';

export interface TierRow {
  tier: number;
  entrySol: string;
  /** The FIXED prize pool — under D-E2 the winner's prize, whole. */
  potSol: string;
}

/** One row per configured tier, straight from the shared constants. */
export function tierRows(): TierRow[] {
  return TIER_ENTRY_LAMPORTS.map((entry, tier) => {
    // D-A1 revised: the pot is the tier's FIXED constant, never derived
    // from the entry price.
    const pot = TIER_POT_LAMPORTS[tier];
    return {
      tier,
      entrySol: lamportsToSol(entry.toString()),
      potSol: lamportsToSol(pot.toString()),
    };
  });
}

/** The field-size and timing numbers the rules prose carries (D-E4; the
 * 2026-09-07 rulings), from the shared mirrors of the program constants.
 * Small display integers, not lamports — the Number conversion is exact.
 * `fillDeadlineHours` and `cooldownMinutes` are the LAUNCH values seeded
 * into Config (the admin can change them for future pools; the prose
 * follows this mirror, which follows the program). */
export const FIELD_RULES = {
  minSeats: Number(MIN_SEATS),
  fillDeadlineHours: Number(DEFAULT_FILL_DEADLINE_SECS / 3600n),
  cooldownMinutes: Number(DEFAULT_COOLDOWN_SECS / 60n),
} as const;

// The five-entry ISO_NAMES table that used to live here moved to
// `@/rules/territoryNames` on 2026-09-13 (founder instruction 2026-09-12
// §3.3). It covered GB/IE/DE/BE/AU, which was survivable with two
// territories in the schedule and is not with fourteen: an unmapped code
// renders as the bare code, so a blocked player would be told they are
// blocked by a page reading "SG". `scripts/check-territories.ts` now fails
// the build if a code reaches the schedule without a name.

// The `Availability` shape and `availability()` moved to
// `@/rules/territories` on 2026-09-13 (founder instruction 2026-09-12 §3.3):
// the block screen and the entry surfaces need the same generated list, and
// a module under `app/src/app/rules/` is a route's data source rather than a
// shared one. Re-exported here so this file stays the rules page's single
// entry point.
import type { Availability } from '@/rules/territories';
import { availability } from '@/rules/territories';

export type { Availability };
export { availability };

export type RulesSection =
  | { id: string; heading: string; kind: 'text'; body: string; appendix?: string }
  | { id: string; heading: string; kind: 'tiers'; body: string; rows: TierRow[] }
  | { id: string; heading: string; kind: 'availability'; body: string; data: Availability }
  | { id: string; heading: string; kind: 'verify'; body: string; href: string; linkText: string };

/** The D-B6 section set, in reading order — one section per topic. */
export function rulesSections(): RulesSection[] {
  const rows = tierRows();
  const r = COPY.rules;
  const { minSeats, fillDeadlineHours, cooldownMinutes } = FIELD_RULES;
  return [
    {
      id: 'how-to-enter',
      heading: r.headings.howToEnter,
      kind: 'text',
      body: r.howToEnter(minSeats, BOARD_CLOCK_BUDGET_MS / 60_000),
    },
    {
      id: 'price',
      heading: r.headings.price,
      kind: 'tiers',
      body: r.priceIntro(cooldownMinutes),
      rows,
    },
    // D-E2: one paid place — the prize IS the pot in the tier table above,
    // so this section is the rule, not a second table.
    { id: 'prizes', heading: r.headings.prizes, kind: 'text', body: r.prizeIntro },
    { id: 'scoring', heading: r.headings.scoring, kind: 'text', body: r.scoring },
    // R9-b (founder addendum 2026-09-07): the timer rule and its effect,
    // its own section — and the same wording sits on the battle screen.
    { id: 'battle-timer', heading: r.headings.battleTimer, kind: 'text', body: r.battleTimer },
    { id: 'ties', heading: r.headings.ties, kind: 'text', body: r.ties },
    { id: 'randomness', heading: r.headings.randomness, kind: 'text', body: r.randomness },
    { id: 'sealing', heading: r.headings.sealing, kind: 'text', body: r.sealing },
    {
      id: 'field-size',
      heading: r.headings.fieldSize,
      kind: 'text',
      body: r.fieldSize(minSeats, fillDeadlineHours),
    },
    {
      id: 'refund',
      heading: r.headings.refund,
      kind: 'text',
      body: r.refund(minSeats, fillDeadlineHours),
    },
    {
      id: 'pool-opening',
      heading: r.headings.poolOpening,
      kind: 'text',
      body: r.poolOpening(cooldownMinutes),
    },
    {
      id: 'verify',
      heading: r.headings.verify,
      kind: 'verify',
      body: r.verify,
      href: '/verify',
      linkText: r.verifyLink,
    },
    {
      id: 'availability',
      heading: r.headings.availability,
      kind: 'availability',
      body:
        availability().posture === 'block-list'
          ? r.availabilityIntroBlockList
          : r.availabilityIntro,
      data: availability(),
    },
    { id: 'age', heading: r.headings.age, kind: 'text', body: r.age },
    {
      id: 'responsible-play',
      heading: r.headings.responsiblePlay,
      kind: 'text',
      body: r.responsiblePlay,
    },
    // R4: detection criteria must be stated on the rules page. The wording
    // is founder/counsel prose (Phase 6) — the one permitted placeholder.
    // The review-process summary (C10) is mechanical and rides as its
    // appendix, filled now.
    {
      id: 'detection',
      heading: r.headings.detection,
      kind: 'text',
      body: r.detection,
      appendix: r.reviewProcess,
    },
  ];
}
