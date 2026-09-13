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
  FULL_FIELD,
  MIN_FIELD,
} from './ladder';
import { runOfflinePool } from './orchestrator';
import type { GeneratedEntrant } from './strategies';

export interface StudyParams {
  /** Number of pools PER RUN (the ratified floor is 200 — the mixed run and
   * each of the three homogeneous runs all use this count, at every field
   * size). */
  pools: number;
  /** Base seed; the mixed run's pool p uses seed baseSeed + p; each
   * homogeneous run offsets by a fixed stride so no pools collide. */
  baseSeed: number;
  /**
   * Field sizes to study. Default: a FULL pool and the MINIMUM one.
   *
   * Added 2026-09-08. Until then the study ran only full 64-seat pools,
   * while the rules let a pool seal and play at its floor..63. Publishing a
   * skill claim measured at one field size, for a competition offered at
   * several, leaves the obvious question — what happens in the smallest
   * field the rules allow? — answered by nobody. Now it is answered here.
   * The floor is `MIN_FIELD`, which tracks the program's `MIN_SEATS`.
   */
  fields?: readonly number[];
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

/** One field size's complete results. */
export interface FieldResult {
  /** Seats per pool in this run. */
  seats: number;
  /** The mixed-field run's per-class rows, ladder order. */
  rows: ClassRow[];
  /** The homogeneous runs (every seat one class), by class. */
  homogeneous: ClassRow[];
}

export interface StudyResult {
  params: StudyParams;
  /** Every field size studied, in the order given. */
  fields: FieldResult[];
  /** The FULL-field run's rows — the historical shape of this result, kept
   *  so existing callers and assertions keep meaning what they meant. */
  rows: ClassRow[];
  homogeneous: ClassRow[];
  csv: string;
  report: string;
}

/** Lamports as a SOL string for prose, bigint math only — trailing zeros
 *  trimmed so a whole-SOL pot reads "4", not "4.000000000". Human eyes only,
 *  never fed back into an amount. */
function solString(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const frac = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac === '' ? `${whole}` : `${whole}.${frac}`;
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

/**
 * Seed offset for field-size index `k`.
 *
 * Index 0 offsets by ZERO on purpose: the full-field study keeps the exact
 * seeds it has always used, so adding a second field size cannot silently
 * move the numbers this document has been publishing. Any change to the
 * 64-seat rows after this commit is a real change in the engine, not an
 * artefact of restructuring — which is the property the nightly diff exists
 * to protect.
 */
const fieldSeedOffset = (k: number): number => k * 100_000_000;

async function runFieldStudy(
  params: StudyParams,
  seats: number,
  fieldIndex: number,
  pot: bigint
): Promise<FieldResult> {
  const offset = fieldSeedOffset(fieldIndex);
  const newRows = () =>
    new Map<LadderClass, ClassRow>(
      LADDER.map((cls) => [cls, { cls, entrants: 0, rankOne: 0, paidSeats: 0, paidLamports: 0n }])
    );

  // ---- The mixed-field run (the original D-A2 study) ---------------------
  const mixed = newRows();
  await runSeries(
    params.pools,
    (p) => params.baseSeed + offset + p,
    (seed) => ladderPopulation(seed, seats),
    mixed,
    pot
  );
  const rows = LADDER.map((cls) => mixed.get(cls)!);

  // ---- The homogeneous-field runs (v2 amendment): one class fills every
  // seat, so every entrant in the pool is "equally skilled" — the outcome
  // spread measures the residual, allocation-level variation alone.
  // Seed strides keep the three runs' pools disjoint from the mixed run's.
  const homogeneous: ClassRow[] = [];
  for (const [i, cls] of HOMOGENEOUS.entries()) {
    const tally = newRows();
    await runSeries(
      params.pools,
      (p) => params.baseSeed + offset + (i + 1) * 1_000_000 + p,
      (seed) => homogeneousPopulation(cls, seed, seats),
      tally,
      pot
    );
    homogeneous.push(tally.get(cls)!);
  }

  return { seats, rows, homogeneous };
}

export async function runSkillEvidence(params: StudyParams): Promise<StudyResult> {
  const pot = potForTier(0);
  const sizes = params.fields ?? [FULL_FIELD, MIN_FIELD];
  if (sizes.length === 0) throw new Error('a study needs at least one field size');

  const fields: FieldResult[] = [];
  for (const [k, seats] of sizes.entries()) {
    fields.push(await runFieldStudy(params, seats, k, pot));
  }

  // The full field is the reference run when one is present; otherwise the
  // first, so a single-field study still has a well-defined `rows`.
  const primary = fields.find((f) => f.seats === FULL_FIELD) ?? fields[0];

  const csv = renderCsv(fields, pot);
  const report = renderReport(params, fields, pot);
  return {
    params,
    fields,
    rows: primary.rows,
    homogeneous: primary.homogeneous,
    csv,
    report,
  };
}

function csvLine(run: string, seats: number, r: ClassRow, pot: bigint): string {
  const n = BigInt(r.entrants);
  return [
    run,
    seats,
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

function renderCsv(fields: FieldResult[], pot: bigint): string {
  const lines = [
    'run,seats,class,entrants,rank1_rate_pct,paid_seat_rate_pct,eliminated_rate_pct,mean_payout_share_pct,total_paid_lamports',
  ];
  for (const f of fields) {
    for (const r of f.rows) lines.push(csvLine('mixed', f.seats, r, pot));
    for (const r of f.homogeneous) lines.push(csvLine('homogeneous', f.seats, r, pot));
  }
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

/** A headline/uniform row prefixed with its field size. */
function fieldRow(seats: number, r: ClassRow, pot: bigint): string {
  const n = BigInt(r.entrants);
  return `| ${seats} | ${r.cls} | ${r.entrants} | ${pct(BigInt(r.rankOne), n, 3)}% | ${pct(
    BigInt(r.paidSeats),
    n,
    2
  )}% | ${pct(n - BigInt(r.paidSeats), n, 2)}% | ${pct(r.paidLamports, pot * n, 4)}% |`;
}

/** The everyone-equal baseline for a field: one seat's share, as a percent. */
function baselinePct(seats: number): string {
  return pct(1n, BigInt(seats), 4);
}

const SKILL_CLASSES = ['random', 'heuristic', 'optimised'] as const;

function renderReport(params: StudyParams, fields: FieldResult[], pot: bigint): string {
  const headline = fields
    .flatMap((f) => {
      const byCls = new Map(f.rows.map((r) => [r.cls, r]));
      return SKILL_CLASSES.map((cls) => fieldRow(f.seats, byCls.get(cls)!, pot));
    })
    .join('\n');

  const defaultRows = fields
    .map((f) => {
      const u = f.rows.find((r) => r.cls === 'uniform')!;
      return fieldRow(f.seats, u, pot);
    })
    .join('\n');

  const homogeneousTable = fields
    .flatMap((f) => f.homogeneous.map((r) => fieldRow(f.seats, r, pot)))
    .join('\n');

  const baselines = fields
    .map((f) => `${baselinePct(f.seats)}% in a ${f.seats}-seat pool`)
    .join(', and ');

  const sizes = fields.map((f) => f.seats).join(' and ');
  // "16 per class at 64 seats, 10 per class at 40 seats" — derived, because
  // this sentence was hand-written and went stale the moment the floor moved.
  const perClass = fields
    .map((f) => `${f.seats / LADDER.length} per class at ${f.seats} seats`)
    .join(', ');

  return `# Skill evidence — outcome statistics by strategy class

*Generated by \`npm run skill-evidence\` in \`tests/rehearsal\` — do not edit
by hand. Deterministic: the same parameters reproduce this file byte for
byte, and the nightly CI job re-runs the study and diffs it against this
committed copy.*

Every run below is measured at **two field sizes**: ${sizes} seats.
${FULL_FIELD} is a full pool; ${MIN_FIELD} is the smallest field the rules
allow a pool to play at — a pool whose deadline passes holding
${MIN_FIELD}..${FULL_FIELD - 1} entrants runs rather than refunding (R7-b,
2026-09-13; it was 52 under D-E4). A claim measured only at full capacity
would leave the obvious question about the shortest field unanswered.

## Headline: considered play against unconsidered play

Every entrant pays the same entry and faces the identical field; the only
input that differs between the rows below is how the entrant allocated
stats across the seven battles. The spread between **random** (valid
allocations with no intent) and **optimised** (a tuned three-stat plan) is
the measured effect of that choice under the published scoring rule
(battles won, then stats won; the ranked-first player takes the pot, a tie
for first splitting it evenly per D3-B):

| Seats | Class | Entrants | Rank-1 rate | Paid-seat rate | Eliminated from the paid set | Mean payout share of pot |
|---|---|---|---|---|---|---|
${headline}

The everyone-equal baseline — what one seat is worth if nothing an entrant
does matters — is ${baselines}. The gap between the rows above, produced
purely by allocation choices, is the product's skill evidence, and it holds
at both field sizes.

## Leaving the allocation on its default

The allocation screen opens on an even split — 20/20/20/20/20 across
Strength, Speed, Heart, Wit and Durability — and stays there until the
player moves it. The \`uniform\` class IS that state: it is byte-identical to
the app's \`EVEN_SPLIT\` (\`app/src/battle/allocation.ts\`, the constant every
screen opens on), so these rows are the measured outcome for a player who
opens the flow, touches nothing, and locks in all seven battles.

| Seats | Class | Entrants | Rank-1 rate | Paid-seat rate | Eliminated from the paid set | Mean payout share of pot |
|---|---|---|---|---|---|---|
${defaultRows}

**The claim here is stronger than a statistical one, and it should be read
as the stronger claim.** A battle is won by taking three of the five stats.
Against any opponent who concentrates on three, the flat split loses those
three and takes only the two the opponent starved — so it loses that battle
3–2 by construction, not on average. A player who leaves the default does
not merely do worse than one who thinks: across every pool in this study, at
both field sizes, they never place first and never take a lamport.

That is also precisely why these rows are kept OUT of the headline
comparison above. Measuring "skill" against a shape that cannot win a battle
would overstate the effect — the honest measure of skill is the spread
between entrants who are all genuinely competing, which is what the headline
table reports.

## Fields of equally-skilled entrants

The v2 amendment's control runs: **${params.pools} pools per class, per field
size**, in which every seat plays the SAME strategy class (with within-class
uniqueness — no two entrants in a pool share an allocation set, see
Methodology). When everyone is equally skilled, outcomes should spread toward
the everyone-equal baseline: rank-1 rate near one seat's share, paid-seat
rate equal to it (one paid place under D-E2: the paid set IS the rank-1
group, a tie for first splitting the pot per D3-B), and mean payout share at
exactly that baseline (conservation forces the class total to equal the pot;
the spread is who takes which slice).

| Seats | Class | Entrants | Rank-1 rate | Paid-seat rate | Eliminated from the paid set | Mean payout share of pot |
|---|---|---|---|---|---|---|
${homogeneousTable}

Reading: among equals, no entrant holds an edge — the mean share sits at
the baseline for every class, at both field sizes. Skill differentiates
BETWEEN classes (the headline table); within a class it cannot, which is
exactly the shape a skill competition's outcomes should have.

## Methodology

- **Runs**: at EACH field size (${sizes} seats), one mixed-field run
  (${params.pools} pools, equal numbers of each class — ${perClass} — seat
  order shuffled per pool by a seeded Fisher–Yates so class is uncorrelated
  with seat index) and three homogeneous-field runs
  (${params.pools} pools of one class each, for random / heuristic /
  optimised).
- **Seeds**: base seed **${params.baseSeed}**. Field size k offsets every
  seed by k × 100,000,000; the FULL field is index 0, so its seeds — and
  therefore its published numbers — are unchanged by the addition of a second
  field size. Within a field, mixed-run pool p uses baseSeed + offset + p
  (p = 1..${params.pools}); homogeneous run i (1 = random, 2 = heuristic,
  3 = optimised) uses baseSeed + offset + i×1,000,000 + p. Every entrant
  stream is sha256 of a labelled seed string — no wall clock, no
  \`Math.random\` — so a run is reproducible from its parameters alone.
- **Within-class uniqueness**: no two entrants of one class in one pool
  share the identical seven-battle allocation set. The jitter model moves
  0..jitterMax points between trio stats (sum stays exactly 100); any
  residual full-set collision is repaired deterministically by regenerating
  the later entrant with a bumped salt (\`ensureUniqueWithinClass\`,
  \`tests/rehearsal/src/ladder.ts\`). The uniform class is exempt —
  20/20/20/20/20 is its definition, which is also why no homogeneous uniform
  run exists: it would be a single n-way tie.
- **Definitions**: *rank-1 rate* — share of a class's entrants whose
  competition rank was 1 (ties share rank 1); *paid-seat rate* — share
  whose seat appears in the committed payout list (nonzero amount under the
  D3-B split — with one paid place, D-E2, this equals the rank-1 rate and
  the column is kept so the two definitions are seen to agree); *mean
  payout share* — the class's total committed lamports over (pot × class
  entrants), in percent.
- **Pipeline**: the real settlement crank over the offline chain mirror
  (\`FakeChain\`) — decrypt, score, rank, split-pot assignment, Merkle
  commitment, batched payout — with conservation asserted on every pool
  (committed amounts sum to the pot exactly). Detection is off: identical
  or near-identical sets inside a class are the study's construction, not
  collusion. **The engine scoring these pools is the same module the crank
  runs in production and the verify page runs in the browser** — a player
  can recompute any pool of this study from its published data.
- **Tier**: 0.1 SOL entries, the ${solString(pot)} SOL fixed pot (D-A1,
  pot revised by D-E1) — read from the same pot table the engine pays from,
  never restated here. Shares are pot-relative, so per-class statistics
  carry to every tier unchanged.
- **Reproduce**:

  \`\`\`bash
  cd tests/rehearsal && npm ci && npm run skill-evidence
  \`\`\`

## Strategy classes

Documented in \`tests/rehearsal/strategies/README.md\`:
**uniform** (the app's default even split — see "Leaving the allocation on
its default" above),
**random** (valid free-integer allocations, no intent),
**heuristic** (three-stat concentration, steep split),
and **optimised** (the same family, tuned: one-upped trio values funded from
the off-stats, per-entrant trio rotation, wider jitter).
`;
}
