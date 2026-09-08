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
import { COPY } from '@/copy';
import { availability, type Availability } from '@/app/rules/rules.config';

/** The study's player classes, in the order the page reads them. */
export const SKILL_CLASSES = ['uniform', 'random', 'heuristic', 'optimised'] as const;
export type SkillClass = (typeof SKILL_CLASSES)[number];

export const FULL_FIELD = 64;
export const MIN_FIELD = 52;

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
