/*
 * The rules tab's single data source (D-B6, ratified 2026-08-27). EVERY
 * number rendered on the rules page derives here from the same shared
 * constants the prize path uses — TIER_ENTRY_LAMPORTS / TIER_POT_LAMPORTS /
 * amountForRank from @blotto/scoring (pinned to the Python oracle and, via
 * LiteSVM, to the on-chain program) — and from the founder-owned config
 * files (territories, terms). No hand-typed figures, so the page cannot
 * drift from what the program pays.
 *
 * All lamport arithmetic is bigint; formatting to SOL happens at the edge
 * through the same float-free formatter the rest of the app uses.
 */

import {
  PAID_RANKS,
  TIER_ENTRY_LAMPORTS,
  TIER_POT_LAMPORTS,
  amountForRank,
} from '@blotto/scoring';
import territories from '@config/territories.json';
import terms from '@config/terms.json';
import { COPY } from '@/copy';
import { lamportsToSol } from '@/data/format';

export interface TierRow {
  tier: number;
  entrySol: string;
  potSol: string;
  /** Prize per position 1..16, SOL strings. */
  prizesSol: string[];
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
      prizesSol: Array.from({ length: PAID_RANKS }, (_, i) =>
        lamportsToSol(amountForRank(pot, i + 1).toString())
      ),
    };
  });
}

/** Display names for the ISO codes the schedule can carry today; an
 * unmapped code renders as the code itself (never silently dropped). */
const ISO_NAMES: Record<string, string> = {
  GB: 'United Kingdom',
  IE: 'Ireland',
  DE: 'Germany',
};

const territoryName = (code: string) => ISO_NAMES[code] ?? code;

export interface Availability {
  allowed: string[];
  blocked: string[];
  scheduleVersion: number;
}

/** Rendered from config/territories.json — the founder-owned schedule. */
export function availability(): Availability {
  return {
    allowed: territories.allowed.map(territoryName),
    blocked: territories.blocked.map(territoryName),
    scheduleVersion: territories.version,
  };
}

export const CURRENT_TERMS_VERSION: number = terms.version;

export type RulesSection =
  | { id: string; heading: string; kind: 'text'; body: string; appendix?: string }
  | { id: string; heading: string; kind: 'tiers'; body: string; rows: TierRow[] }
  | { id: string; heading: string; kind: 'prizes'; body: string; rows: TierRow[] }
  | { id: string; heading: string; kind: 'availability'; body: string; data: Availability }
  | { id: string; heading: string; kind: 'verify'; body: string; href: string; linkText: string };

/** The D-B6 section set, in reading order — one section per topic. */
export function rulesSections(): RulesSection[] {
  const rows = tierRows();
  const r = COPY.rules;
  return [
    { id: 'how-to-enter', heading: r.headings.howToEnter, kind: 'text', body: r.howToEnter },
    { id: 'price', heading: r.headings.price, kind: 'tiers', body: r.priceIntro, rows },
    { id: 'prizes', heading: r.headings.prizes, kind: 'prizes', body: r.prizeIntro, rows },
    { id: 'scoring', heading: r.headings.scoring, kind: 'text', body: r.scoring },
    { id: 'ties', heading: r.headings.ties, kind: 'text', body: r.ties },
    { id: 'randomness', heading: r.headings.randomness, kind: 'text', body: r.randomness },
    { id: 'sealing', heading: r.headings.sealing, kind: 'text', body: r.sealing },
    { id: 'refund', heading: r.headings.refund, kind: 'text', body: r.refund },
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
      body: r.availabilityIntro,
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
