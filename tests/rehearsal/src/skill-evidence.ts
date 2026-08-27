/**
 * The skill-evidence study (D-A2 as amended by master prompt v2,
 * 2026-08-27): run mixed-ladder AND homogeneous-field populations through
 * the REAL settlement crank at scale and publish the observed outcome
 * statistics per strategy class.
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

import { potForTier } from '../../../backend/scoring/src';
import {
  LADDER,
  homogeneousPopulation,
  ladderPopulation,
  type LadderClass,
} from './ladder';
import { runOfflinePool } from './orchestrator';
import type { GeneratedEntrant } from './strategies';

export interface StudyParams {
  /** Number of 64-entrant pools PER RUN (the ratified floor is 200 — the
   * mixed run and each of the three homogeneous runs all use this count). */
  pools: number;
  /** Base seed; the mixed run's pool p uses seed baseSeed + p; each
   * homogeneous run offsets by a fixed stride so no pools collide. */
  baseSeed: number;
}

export interface ClassRow {
  cls: LadderClass;
  entrants: number;
  /** Entrants whose competition rank was 1 (ties included). */
  rankOne: number;
  /** Entrants whose seat was in the committed payout list. */
  paidSeats: number;
  /** Total lamports committed to the class across the run. */
  paidLamports: bigint;
}

export interface StudyResult {
  params: StudyParams;
  /** The mixed-field run's per-class rows, ladder order. */
  rows: ClassRow[];
  /** The three homogeneous runs (all 64 entrants one class), by class. */
  homogeneous: ClassRow[];
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

/** Run `pools` pools with `populationFor(poolSeed)` and tally per class. */
async function runSeries(
  pools: number,
  seedOf: (p: number) => number,
  populationFor: (poolSeed: number) => GeneratedEntrant[],
  byClass: Map<LadderClass, ClassRow>,
  pot: bigint
): Promise<void> {
  for (let p = 1; p <= pools; p++) {
    const poolSeed = seedOf(p);
    const population = populationFor(poolSeed);
    // Detection off: near-identical sets inside a class are the study's own
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
}

/** The homogeneous runs' classes (uniform excluded by construction — a
 * homogeneous uniform pool is a single 64-way tie, not a study run). */
const HOMOGENEOUS: readonly LadderClass[] = ['random', 'heuristic', 'optimised'];

export async function runSkillEvidence(params: StudyParams): Promise<StudyResult> {
  const pot = potForTier(0);
  const newRows = () =>
    new Map<LadderClass, ClassRow>(
      LADDER.map((cls) => [cls, { cls, entrants: 0, rankOne: 0, paidSeats: 0, paidLamports: 0n }])
    );

  // ---- The mixed-field run (the original D-A2 study) ---------------------
  const mixed = newRows();
  await runSeries(
    params.pools,
    (p) => params.baseSeed + p,
    (seed) => ladderPopulation(seed),
    mixed,
    pot
  );
  const rows = LADDER.map((cls) => mixed.get(cls)!);

  // ---- The homogeneous-field runs (v2 amendment): one class fills all 64
  // seats, so every entrant in the pool is "equally skilled" — the outcome
  // spread measures the residual, allocation-level variation alone.
  // Seed strides keep the three runs' pools disjoint from the mixed run's.
  const homogeneous: ClassRow[] = [];
  for (const [i, cls] of HOMOGENEOUS.entries()) {
    const tally = newRows();
    await runSeries(
      params.pools,
      (p) => params.baseSeed + (i + 1) * 1_000_000 + p,
      (seed) => homogeneousPopulation(cls, seed),
      tally,
      pot
    );
    homogeneous.push(tally.get(cls)!);
  }

  const csv = renderCsv(rows, homogeneous, pot);
  const report = renderReport(params, rows, homogeneous, pot);
  return { params, rows, homogeneous, csv, report };
}

function csvLine(run: string, r: ClassRow, pot: bigint): string {
  const n = BigInt(r.entrants);
  return [
    run,
    r.cls,
    r.entrants,
    pct(BigInt(r.rankOne), n, 3),
    pct(BigInt(r.paidSeats), n, 2),
    pct(n - BigInt(r.paidSeats), n, 2),
    // Mean share of the pot per entrant of the class, in percent.
    pct(r.paidLamports, pot * n, 4),
    r.paidLamports.toString(),
  ].join(',');
}

function renderCsv(rows: ClassRow[], homogeneous: ClassRow[], pot: bigint): string {
  const lines = [
    'run,class,entrants,rank1_rate_pct,paid_seat_rate_pct,eliminated_rate_pct,mean_payout_share_pct,total_paid_lamports',
  ];
  for (const r of rows) lines.push(csvLine('mixed', r, pot));
  for (const r of homogeneous) lines.push(csvLine('homogeneous', r, pot));
  return lines.join('\n') + '\n';
}

function tableRow(r: ClassRow, pot: bigint): string {
  const n = BigInt(r.entrants);
  return `| ${r.cls} | ${r.entrants} | ${pct(BigInt(r.rankOne), n, 3)}% | ${pct(
    BigInt(r.paidSeats),
    n,
    2
  )}% | ${pct(n - BigInt(r.paidSeats), n, 2)}% | ${pct(r.paidLamports, pot * n, 4)}% |`;
}

function renderReport(
  params: StudyParams,
  rows: ClassRow[],
  homogeneous: ClassRow[],
  pot: bigint
): string {
  const byCls = new Map(rows.map((r) => [r.cls, r]));
  const headline = (['random', 'heuristic', 'optimised'] as const)
    .map((cls) => tableRow(byCls.get(cls)!, pot))
    .join('\n');
  const uniformRow = tableRow(byCls.get('uniform')!, pot);
  const homogeneousTable = homogeneous.map((r) => tableRow(r, pot)).join('\n');

  return `# Skill evidence — outcome statistics by strategy class

*Generated by \`npm run skill-evidence\` in \`tests/rehearsal\` — do not edit
by hand. Deterministic: the same parameters reproduce this file byte for
byte, and the nightly CI job re-runs the study and diffs it against this
committed copy.*

## Headline: considered play against unconsidered play

Every entrant pays the same entry and faces the identical field; the only
input that differs between the rows below is how the entrant allocated
stats across the seven battles. The spread between **random** (valid
allocations with no intent) and **optimised** (a tuned three-stat plan) is
the measured effect of that choice under the published scoring rule
(battles won, then stats won; ties split evenly per D3-B):

| Class | Entrants | Rank-1 rate | Paid-seat rate | Eliminated from the paid set | Mean payout share of pot |
|---|---|---|---|---|---|
${headline}

The everyone-equal baseline for a 64-seat pool is a mean payout share of
**1.5625%** (1/64) per entrant. The gap between the rows above — produced
purely by allocation choices — is the product's skill evidence.

## Fields of equally-skilled entrants

The v2 amendment's control runs: **${params.pools} pools per class** in
which all 64 entrants play the SAME strategy class (with within-class
uniqueness — no two entrants in a pool share an allocation set, see
Methodology). When everyone is equally skilled, outcomes should spread
toward the everyone-equal baseline: rank-1 rate near 1/64 (≈ 1.563%),
paid-seat rate set by how the class's allocations tie under D3-B, and mean
payout share at exactly 1.5625% of the pot (conservation forces the class
total to equal the pot; the spread is who takes which slice).

| Class (all 64 seats) | Entrants | Rank-1 rate | Paid-seat rate | Eliminated from the paid set | Mean payout share of pot |
|---|---|---|---|---|---|
${homogeneousTable}

Reading: among equals, no entrant holds an edge — the mean share sits at
the baseline for every class. Skill differentiates BETWEEN classes (the
headline table); within a class it cannot, which is exactly the shape a
skill competition's outcomes should have.

## Methodology

- **Runs**: one mixed-field run (${params.pools} pools × 64 entrants:
  16 per class, seat order shuffled per pool by a seeded Fisher–Yates so
  class is uncorrelated with seat index) and three homogeneous-field runs
  (${params.pools} pools × 64 entrants of one class each, for random /
  heuristic / optimised).
- **Seeds**: base seed **${params.baseSeed}**. Mixed-run pool p uses seed
  baseSeed + p (p = 1..${params.pools}); homogeneous run i (1 = random,
  2 = heuristic, 3 = optimised) uses baseSeed + i×1,000,000 + p. Every
  entrant stream is sha256 of a labelled seed string — no wall clock, no
  \`Math.random\` — so a run is reproducible from its parameters alone.
- **Within-class uniqueness**: no two entrants of one class in one pool
  share the identical seven-battle allocation set. The jitter model moves
  0..jitterMax points between trio stats (sum stays exactly 100); any
  residual full-set collision is repaired deterministically by regenerating
  the later entrant with a bumped salt (\`ensureUniqueWithinClass\`,
  \`tests/rehearsal/src/ladder.ts\`). The uniform class is exempt —
  20/20/20/20/20 is its definition (see the appendix).
- **Definitions**: *rank-1 rate* — share of a class's entrants whose
  competition rank was 1 (ties share rank 1); *paid-seat rate* — share
  whose seat appears in the committed payout list (nonzero amount under the
  D3-B split); *mean payout share* — the class's total committed lamports
  over (pot × class entrants), in percent.
- **Pipeline**: the real settlement crank over the offline chain mirror
  (\`FakeChain\`) — decrypt, score, rank, split-pot assignment, Merkle
  commitment, batched payout — with conservation asserted on every pool
  (committed amounts sum to the pot exactly). Detection is off: identical
  or near-identical sets inside a class are the study's construction, not
  collusion. **The engine scoring these pools is the same module the crank
  runs in production and the verify page runs in the browser** — a player
  can recompute any pool of this study from its published data.
- **Tier**: 0.1 SOL entries, the 5.12 SOL fixed pot (D-A1 revised). Shares
  are pot-relative, so per-class statistics carry to every tier unchanged.
- **Reproduce**:

  \`\`\`bash
  cd tests/rehearsal && npm ci && npm run skill-evidence
  \`\`\`

## Strategy classes

Documented in \`tests/rehearsal/strategies/README.md\`:
**random** (valid free-integer allocations, no intent),
**heuristic** (three-stat concentration, steep split),
**optimised** (the same family, tuned: one-upped trio values funded from the
off-stats, per-entrant trio rotation, wider jitter),
and **uniform** (the appendix's structural baseline).

## Appendix: the uniform baseline

| Class | Entrants | Rank-1 rate | Paid-seat rate | Eliminated from the paid set | Mean payout share of pot |
|---|---|---|---|---|---|
${uniformRow}

The flat 20/20/20/20/20 split is not a strategy but a STRUCTURAL baseline:
against any three-stat concentration it loses that battle 3–2 (the
concentrated side takes its three funded stats; the flat side takes the two
starved ones), so a uniform entrant loses every battle against every
concentrating opponent by construction. Its row is reported for
completeness and kept out of the headline comparison — measuring "skill"
against a shape that cannot win a battle would overstate the effect. The
uniform class is also exempt from within-class uniqueness (the flat split
IS the class), which is why a homogeneous uniform run does not exist: it
would be a single 64-way tie by definition.
`;
}
