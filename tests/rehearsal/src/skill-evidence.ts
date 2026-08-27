/**
 * The skill-evidence study (D-A2, ratified 2026-08-27): run mixed-ladder
 * populations through the REAL settlement crank at scale and publish the
 * observed outcome statistics per strategy class.
 *
 * Everything is deterministic from (baseSeed, pools): the same inputs
 * produce byte-identical CSV and report, which is what lets the nightly CI
 * job diff a fresh run against the committed artifacts — any engine change
 * that shifts outcomes shows up as a diff, never silently.
 *
 * Statistics are computed in BIGINT and only formatted to fixed-precision
 * decimal strings at the end — no lamport value and no derived share ever
 * passes through a JavaScript float (CLAUDE.md hard rule, applied to the
 * evidence pipeline as well).
 */

import { potLamports } from '../../../backend/scoring/src';
import { LADDER, ladderPopulation, type LadderClass } from './ladder';
import { runOfflinePool } from './orchestrator';

/** The study runs at the 0.1 SOL tier; shares are pot-relative, so the
 * per-class statistics carry over to every tier unchanged. */
const ENTRY_LAMPORTS = 100_000_000n;

export interface StudyParams {
  /** Number of 64-entrant pools (the ratified floor is 200). */
  pools: number;
  /** Base seed; pool p uses seed baseSeed + p (p = 1..pools). */
  baseSeed: number;
}

export interface ClassRow {
  cls: LadderClass;
  entrants: number;
  /** Entrants whose competition rank was 1 (ties included). */
  rankOne: number;
  /** Entrants whose seat was in the committed payout list. */
  paidSeats: number;
  /** Total lamports committed to the class across the study. */
  paidLamports: bigint;
}

export interface StudyResult {
  params: StudyParams;
  rows: ClassRow[];
  csv: string;
  report: string;
}

/** rate = numerator/denominator as a fixed-decimals percent string, bigint math. */
function pct(numerator: bigint, denominator: bigint, decimals: number): string {
  if (denominator === 0n) return '0';
  const scale = 10n ** BigInt(decimals);
  const scaled = (numerator * 100n * scale) / denominator;
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(decimals, '0');
  return decimals > 0 ? `${whole}.${frac}` : `${whole}`;
}

export async function runSkillEvidence(params: StudyParams): Promise<StudyResult> {
  const byClass = new Map<LadderClass, ClassRow>(
    LADDER.map((cls) => [cls, { cls, entrants: 0, rankOne: 0, paidSeats: 0, paidLamports: 0n }])
  );
  const pot = potLamports(ENTRY_LAMPORTS);

  for (let p = 1; p <= params.pools; p++) {
    const poolSeed = params.baseSeed + p;
    const population = ladderPopulation(poolSeed);
    // Detection off: identical sets inside a class are the study's own
    // construction, not collusion (see OfflinePoolOptions.detect).
    const run = await runOfflinePool(poolSeed, { population, detect: false });
    if (run.outcome.finalState !== 'Paid') {
      throw new Error(`pool ${poolSeed} ended ${run.outcome.finalState}, expected Paid`);
    }
    const bundle = run.publisher.published.get(run.outcome.bundleUri!);
    if (!bundle) throw new Error(`pool ${poolSeed}: no published bundle`);

    // Conservation re-checked on every pool: the committed amounts must sum
    // to exactly the pot, or the evidence is measuring a broken engine.
    let committed = 0n;
    for (const r of bundle.results) committed += BigInt(r.amount_lamports);
    if (committed !== pot) {
      throw new Error(`pool ${poolSeed}: committed ${committed} != pot ${pot}`);
    }

    for (const r of bundle.results) {
      const cls = population[r.index].strategy as LadderClass;
      const row = byClass.get(cls);
      if (!row) throw new Error(`pool ${poolSeed}: unknown class ${cls} at seat ${r.index}`);
      row.entrants += 1;
      if (r.rank === 1) row.rankOne += 1;
      const amount = BigInt(r.amount_lamports);
      if (amount > 0n) {
        row.paidSeats += 1;
        row.paidLamports += amount;
      }
    }
  }

  const rows = LADDER.map((cls) => byClass.get(cls)!);
  const csv = renderCsv(rows, pot);
  const report = renderReport(params, rows, pot);
  return { params, rows, csv, report };
}

function renderCsv(rows: ClassRow[], pot: bigint): string {
  const lines = [
    'class,entrants,rank1_rate_pct,paid_seat_rate_pct,eliminated_rate_pct,mean_payout_share_pct,total_paid_lamports',
  ];
  for (const r of rows) {
    const n = BigInt(r.entrants);
    lines.push(
      [
        r.cls,
        r.entrants,
        pct(BigInt(r.rankOne), n, 3),
        pct(BigInt(r.paidSeats), n, 2),
        pct(n - BigInt(r.paidSeats), n, 2),
        // Mean share of the pot per entrant of the class, in percent.
        pct(r.paidLamports, pot * n, 4),
        r.paidLamports.toString(),
      ].join(',')
    );
  }
  return lines.join('\n') + '\n';
}

function renderReport(params: StudyParams, rows: ClassRow[], pot: bigint): string {
  const table = rows
    .map((r) => {
      const n = BigInt(r.entrants);
      return `| ${r.cls} | ${r.entrants} | ${pct(BigInt(r.rankOne), n, 3)}% | ${pct(
        BigInt(r.paidSeats),
        n,
        2
      )}% | ${pct(n - BigInt(r.paidSeats), n, 2)}% | ${pct(r.paidLamports, pot * n, 4)}% |`;
    })
    .join('\n');

  return `# Skill evidence — outcome statistics by strategy class

*Generated by \`npm run skill-evidence\` in \`tests/rehearsal\` — do not edit
by hand. Deterministic: the same parameters reproduce this file byte for
byte, and the nightly CI job re-runs the study and diffs it against this
committed copy.*

## Parameters

- Pools: **${params.pools}** × 64 entrants (16 per strategy class, seat order
  shuffled per pool so class is uncorrelated with seat index)
- Base seed: **${params.baseSeed}** (pool p uses seed baseSeed + p, p = 1..${params.pools})
- Tier: 0.1 SOL entry (shares are pot-relative; per-class statistics are
  tier-invariant)
- Pipeline: the real settlement crank over the offline chain mirror
  (\`FakeChain\`), full D3-B split-pot settlement; detection off (identical
  sets inside a class are the study's construction, not collusion)
- Conservation asserted on every pool: committed amounts sum to the pot
  exactly

## Strategy classes

Documented in \`tests/rehearsal/strategies/README.md\`:
**uniform** (20/20/20/20/20 every battle — the zero-thought baseline),
**random** (valid free-integer allocations, no intent),
**heuristic** (three-stat concentration, steep split),
**optimised** (the same family, tuned: one-upped trio values funded from the
off-stats, per-entrant trio rotation, wider jitter).

## Results

| Class | Entrants | Rank-1 rate | Paid-seat rate | Eliminated from the paid set | Mean payout share of pot |
|---|---|---|---|---|---|
${table}

## Reading the table

Every entrant pays the same entry and faces the identical field; the only
input that differs between the rows above is how the entrant allocated
stats across the seven battles. The spread between the rows is the measured
effect of that choice under the published scoring rule (battles won, then
stats won; ties split evenly per D3-B). A pool's whole outcome is
recomputable by any player from the published data — the same engine that
produced these numbers runs on the verify page.

## Reproduce

\`\`\`bash
cd tests/rehearsal && npm ci && npm run skill-evidence
\`\`\`
`;
}
