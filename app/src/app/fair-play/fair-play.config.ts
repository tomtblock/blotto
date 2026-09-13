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
import { CAPACITY, MIN_SEATS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { availability, type Availability } from '@/app/rules/rules.config';

/** The study's player classes, in the order the page reads them. */
export const SKILL_CLASSES = ['uniform', 'random', 'heuristic', 'optimised'] as const;
export type SkillClass = (typeof SKILL_CLASSES)[number];

/**
 * The two field sizes the study measures, read from the same shared mirrors of
 * the program constants the rules page uses — NOT typed here.
 *
 * `MIN_FIELD` was the literal `52` until 2026-09-13. When R7-b lowered the
 * minimum field to 40 the study re-ran at 40, and `rateFor` below throws on a
 * field size the evidence has no row for — so the literal would have taken the
 * page down at build time rather than quietly showing a stale number. That is
 * the right failure, and deriving the number removes the occasion for it.
 */
export const FULL_FIELD = Number(CAPACITY);
export const MIN_FIELD = Number(MIN_SEATS);

export interface SkillRow {
  cls: SkillClass;
  label: string;
  /** First-place rate, as the study's own percent string ("5.156"). */
  fullPct: string;
  minPct: string;
}

type EvidenceRow = Record<string, string>;

function rateFor(rows: EvidenceRow[], cls: SkillClass, seats: number): string {
  const row = rows.find(
    (r) => r.run === 'mixed' && r.class === cls && Number(r.seats) === seats,
  );
  if (!row) throw new Error(`skill evidence: no mixed row for ${cls} at ${seats} seats`);
  return row.rank1_rate_pct;
}

/**
 * The headline table: first-place rate per player class at both field
 * sizes, straight from the committed evidence. Strings throughout — the
 * study formats its own percentages and nothing here re-derives them.
 */
export function skillTable(): SkillRow[] {
  const rows = evidence.rows as EvidenceRow[];
  return SKILL_CLASSES.map((cls) => ({
    cls,
    label: COPY.fairPlay.skillRows[cls] ?? cls,
    fullPct: rateFor(rows, cls, FULL_FIELD),
    minPct: rateFor(rows, cls, MIN_FIELD),
  }));
}

export interface FairPlayView {
  skill: SkillRow[];
  availability: Availability;
}

export function fairPlayView(): FairPlayView {
  return { skill: skillTable(), availability: availability() };
}
