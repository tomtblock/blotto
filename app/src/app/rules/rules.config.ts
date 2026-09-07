/*
 * The rules tab's single data source (D-B6, ratified 2026-08-27). EVERY
 * number rendered on the rules page derives here from the same shared
 * constants the prize path uses — TIER_ENTRY_LAMPORTS / TIER_POT_LAMPORTS /
 * MIN_SEATS / GO_TIMER_SECS from @blotto/scoring (pinned to the Python
 * oracle and, via LiteSVM, to the on-chain program) — and from the
 * founder-owned config files (territories, terms). No hand-typed figures,
 * so the page cannot drift from what the program pays or enforces.
 *
 * All lamport arithmetic is bigint; formatting to SOL happens at the edge
 * through the same float-free formatter the rest of the app uses.
 */

import {
  GO_TIMER_SECS,
  MIN_SEATS,
  TIER_ENTRY_LAMPORTS,
  TIER_POT_LAMPORTS,
} from '@blotto/scoring';
import territories from '@config/territories.json';
import terms from '@config/terms.json';
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

/** The field-size numbers the rules prose carries (D-E4), from the shared
 * mirrors of the program constants. Small display integers, not lamports —
 * the Number conversion is exact. */
export const FIELD_RULES = {
  minSeats: Number(MIN_SEATS),
  goTimerHours: Number(GO_TIMER_SECS / 3600n),
} as const;

/** Display names for the ISO codes the schedule can carry today; an
 * unmapped code renders as the code itself (never silently dropped). */
const ISO_NAMES: Record<string, string> = {
  GB: 'United Kingdom',
  IE: 'Ireland',
  DE: 'Germany',
  BE: 'Belgium',
  AU: 'Australia',
};

const territoryName = (code: string) => ISO_NAMES[code] ?? code;

export interface Availability {
  /** Which way an unlisted territory falls (founder posture, 2026-08-28:
   * block-list — available everywhere except `blocked`). */
  posture: 'allow-list' | 'block-list';
  allowed: string[];
  blocked: string[];
  scheduleVersion: number;
}

/** Rendered from config/territories.json — the founder-owned schedule. */
export function availability(): Availability {
  return {
    posture: territories.posture === 'block-list' ? 'block-list' : 'allow-list',
    allowed: territories.allowed.map(territoryName),
    blocked: territories.blocked.map(territoryName),
    scheduleVersion: territories.version,
  };
}

export const CURRENT_TERMS_VERSION: number = terms.version;

export type RulesSection =
  | { id: string; heading: string; kind: 'text'; body: string; appendix?: string }
  | { id: string; heading: string; kind: 'tiers'; body: string; rows: TierRow[] }
  | { id: string; heading: string; kind: 'availability'; body: string; data: Availability }
  | { id: string; heading: string; kind: 'verify'; body: string; href: string; linkText: string };

/** The D-B6 section set, in reading order — one section per topic. */
export function rulesSections(): RulesSection[] {
  const rows = tierRows();
  const r = COPY.rules;
  const { minSeats, goTimerHours } = FIELD_RULES;
  return [
    {
      id: 'how-to-enter',
      heading: r.headings.howToEnter,
      kind: 'text',
      body: r.howToEnter(minSeats),
    },
    { id: 'price', heading: r.headings.price, kind: 'tiers', body: r.priceIntro, rows },
    // D-E2: one paid place — the prize IS the pot in the tier table above,
    // so this section is the rule, not a second table.
    { id: 'prizes', heading: r.headings.prizes, kind: 'text', body: r.prizeIntro },
    { id: 'scoring', heading: r.headings.scoring, kind: 'text', body: r.scoring },
    { id: 'ties', heading: r.headings.ties, kind: 'text', body: r.ties },
    { id: 'randomness', heading: r.headings.randomness, kind: 'text', body: r.randomness },
    { id: 'sealing', heading: r.headings.sealing, kind: 'text', body: r.sealing },
    {
      id: 'field-size',
      heading: r.headings.fieldSize,
      kind: 'text',
      body: r.fieldSize(minSeats, goTimerHours),
    },
    { id: 'refund', heading: r.headings.refund, kind: 'text', body: r.refund(minSeats) },
    {
      id: 'pool-opening',
      heading: r.headings.poolOpening,
      kind: 'text',
      body: r.poolOpening,
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
