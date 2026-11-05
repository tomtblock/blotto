/*
 * The Fair play page's single data source. Like rules.config.ts, nothing on
 * the page is hand-typed: the skill table comes from the study's committed
 * output (`docs/skill-evidence/results.json`, the CSV re-shaped, reproduced
 * nightly by CI), the availability list from the founder-owned territory
 * schedule, and every sentence from the copy module.
 *
 * The page describes MECHANISMS — what is checked, what is measured, where
 * to look — and never asserts a status (D-B7). Its title is one copy key;
 * counsel decides the final wording.
 */

import evidence from '@docs/skill-evidence/results.json';
import { POOL_CAPACITIES, minFieldFor } from '@blotto/scoring';
import { COPY } from '@/copy';
import { availability, type Availability } from '@/app/rules/rules.config';

/** The study's player classes, in the order the page reads them. */
export const SKILL_CLASSES = ['uniform', 'random', 'heuristic', 'optimised'] as const;
export type SkillClass = (typeof SKILL_CLASSES)[number];

/**
 * The fields the page shows: every pool size (D-E19, the Ladder), full and
 * at its minimum field — read from the same shared mirrors of the program
 * constants the rules page uses, NOT typed here.
 *
 * Until the Ladder this was two constants, `FULL_FIELD` (64) and `MIN_FIELD`
 * (40). They were literals once, and when R7-b moved the floor 52 → 40 the
 * study re-ran at 40 and `rateFor` below threw on the field the evidence no
 * longer had a row for — taking the page down at build time rather than
 * quietly showing a stale number. That is still the failure mode: if the
 * pool sizes or minimum fields move without the study re-running, the page
 * refuses to build.
 */
export interface PoolSize {
  capacity: number;
  minField: number;
}

export const POOL_SIZES: readonly PoolSize[] = POOL_CAPACITIES.map((capacity) => ({
  capacity,
  minField: minFieldFor(capacity),
}));

export interface SkillRow {
  cls: SkillClass;
  label: string;
  /** First-place rate in a FULL pool of each size, `POOL_SIZES` order, as
   * the study's own percent string ("5.156"). */
  full: string[];
  /** First-place rate at each size's MINIMUM field, `POOL_SIZES` order. */
  min: string[];
}

export type EvidenceRow = Record<string, string>;

/**
 * One class's first-place rate in the mixed run at (`capacity`, `seats`).
 * Throws when the evidence has no such row: a page that cannot find its
 * number must not render a blank or a guess in its place.
 */
export function rateFor(
  rows: readonly EvidenceRow[],
  cls: SkillClass,
  capacity: number,
  seats: number,
): string {
  const row = rows.find(
    (r) =>
      r.run === 'mixed' &&
      r.class === cls &&
      Number(r.capacity) === capacity &&
      Number(r.seats) === seats,
  );
  if (!row) {
    throw new Error(
      `skill evidence: no mixed row for ${cls} at ${seats} players in a pool of ${capacity}`,
    );
  }
  return row.rank1_rate_pct;
}

/**
 * The headline table: first-place rate per player class at every pool size,
 * full and at its minimum field, straight from the committed evidence.
 * Strings throughout — the study formats its own percentages and nothing
 * here re-derives them.
 *
 * PHASE-N-REVIEW: the page shows the first-place rate only, as it did before
 * the Ladder. The study also measures how often each class is paid a prize;
 * whether that rate belongs on a public page is counsel's call (no "% paid"
 * claims in public copy), so it stays in docs/skill-evidence/ for now.
 */
export function skillTable(rows: readonly EvidenceRow[] = evidence.rows as EvidenceRow[]): SkillRow[] {
  return SKILL_CLASSES.map((cls) => ({
    cls,
    label: COPY.fairPlay.skillRows[cls] ?? cls,
    full: POOL_SIZES.map((s) => rateFor(rows, cls, s.capacity, s.capacity)),
    min: POOL_SIZES.map((s) => rateFor(rows, cls, s.capacity, s.minField)),
  }));
}

export interface FairPlayView {
  sizes: readonly PoolSize[];
  skill: SkillRow[];
  availability: Availability;
}

export function fairPlayView(): FairPlayView {
  return { sizes: POOL_SIZES, skill: skillTable(), availability: availability() };
}
