/**
 * Where a detection report goes (audit 2026-09-11, A-18 / D-36; founder
 * ruling D-E9, 2026-09-12).
 *
 * THE DEFECT. The five signals ran on every settled pool and the report
 * reached nobody. The daemon `console.log`ged it — only when it had findings
 * — and that was the whole surface: no store, no endpoint, no page. A
 * finding was seen if and only if a human happened to be reading the
 * settlement daemon's output at the moment a pool settled, and nothing
 * remained afterwards to read at all. The review page drives the manual
 * `/decisions` flow over entries a person already flagged, so the layer that
 * is supposed to TELL a person what to look at was connected to nothing.
 *
 * WHAT D-E9 RATIFIED (option (a), `docs/BUILD-ROADMAP_v1.0.md`): detection
 * stays manual — no signal takes an automatic action, ever, and the on-chain
 * `Config.detection_hard_block` switch is read by nothing off-chain — but
 * every report is PERSISTED and surfaced to the reviewer before the review
 * window closes. The reviewer still decides every flag; they now see what
 * the signals saw while there is still time to act on it.
 *
 * THE RECORD IS APPEND-ONLY, like the decision log: a re-run of the crank on
 * a pool writes a NEW row rather than overwriting what the last run said.
 * The surface serves the latest; the history stays for anyone asking why a
 * recommendation changed between runs.
 *
 * THESE ROWS ARE NOT PUBLIC. They name players a signal fired on, before any
 * human has looked at them. `GET /detection` is operator-token only
 * (`server.ts`); no player-facing surface reads this store.
 */

import type { DetectionReport } from './pipeline';

/** One persisted run of the pipeline over one pool. */
export interface StoredDetectionReport {
  /** Pool PDA, base58 — the key every review surface uses. */
  pool: string;
  /** The u64 pool id the daemon ran under, as a decimal string. */
  poolId: string;
  /** ISO instant the pipeline ran. */
  producedAt: string;
  report: DetectionReport;
}

export interface DetectionReportStore {
  /** Append one run. Never replaces an earlier one. */
  save(r: StoredDetectionReport): Promise<void>;
  /** The most recent run for a pool, or null when detection never ran on it. */
  latest(pool: string): Promise<StoredDetectionReport | null>;
}

/** In-memory store — tests, and any offline run of the pipeline. */
export class MemoryDetectionReportStore implements DetectionReportStore {
  private rows: StoredDetectionReport[] = [];
  async save(r: StoredDetectionReport): Promise<void> {
    this.rows.push({ ...r, report: { ...r.report } });
  }
  async latest(pool: string): Promise<StoredDetectionReport | null> {
    const forPool = this.rows.filter((r) => r.pool === pool);
    if (forPool.length === 0) return null;
    const last = forPool.reduce((a, b) =>
      Date.parse(b.producedAt) >= Date.parse(a.producedAt) ? b : a
    );
    return { ...last, report: { ...last.report } };
  }
}
