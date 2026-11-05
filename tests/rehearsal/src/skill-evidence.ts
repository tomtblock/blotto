/**
 * The skill-evidence study (D-A2 as amended by master prompt v2,
 * 2026-08-27; re-run under the Ladder, D-E19, 2026-11-05): run mixed-ladder
 * AND homogeneous-field populations through the REAL settlement crank at
 * scale and publish the observed outcome statistics per strategy class — at
 * every pool size, full and at its minimum field.
 *
 * Everything is deterministic from (baseSeed, pools): the same inputs
 * produce byte-identical CSV and report, which is what lets the nightly CI
 * job diff a fresh run against the committed artifacts — any engine change
 * that shifts outcomes shows up as a diff, never silently.
 *
 * Statistics are computed in BIGINT and only formatted to fixed-precision
 * decimal strings at the end — no lamport value and no derived rate or ratio
 * ever passes through a JavaScript float (CLAUDE.md hard rule, applied to
 * the evidence pipeline as well).
 */

import {
  LADDER_TABLES,
  MAX_CAPACITY,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
  assignPrizes,
  assignRanks,
  compareBattle,
  ladderTable,
  minFieldFor,
  prizePoolFor,
  scorePool,
  type BoardMode,
  type PoolCapacity,
} from '../../../backend/scoring/src';
import { generateLadderEntrant } from './ladder';
import { generateEntrant } from './strategies';
import {
  LADDER,
  STUDY_FIELDS,
  homogeneousPopulation,
  ladderPopulation,
  type LadderClass,
  type StudyField,
} from './ladder';
import { OFFLINE_ENTRY_LAMPORTS, runOfflinePool } from './orchestrator';
import type { GeneratedEntrant } from './strategies';

export interface StudyParams {
  /** Number of pools PER RUN (the ratified floor is 200 — the mixed run and
   * each of the three homogeneous runs all use this count, at every field). */
  pools: number;
  /** Base seed; each field adds its fixed offset (`fieldSeedOffset`), the
   * mixed run's pool p uses seed baseSeed + offset + p, and each
   * homogeneous run adds a further fixed stride so no pools collide. */
  baseSeed: number;
  /**
   * Fields to study. Default `STUDY_FIELDS`: every pool size of the Ladder
   * (8, 16, 32, 64), full and at its minimum field.
   *
   * History: until 2026-09-08 the study ran only full 64-seat pools; from
   * then until the Ladder (2026-11-05) it ran 64 and the 40-player floor.
   * Publishing a skill claim measured at one field, for a competition
   * offered at several, leaves the obvious question — what happens in the
   * smallest field the rules allow, at the smallest pool? — answered by
   * nobody. Every field the rules offer is answered here.
   */
  fields?: readonly StudyField[];
  /**
   * The placing rule the pools play (Phase B, 2026-09-25). Default easy.
   * `hard` runs the hard ladder (`ladder.ts`) through the same crank under
   * the 700-anywhere rule and writes to its own directory.
   */
  mode?: BoardMode;
}

export interface ClassRow {
  cls: LadderClass;
  entrants: number;
  /** Entries whose competition rank was 1 (ties included). */
  rankOne: number;
  /** Entries committed a nonzero amount. */
  paidEntries: number;
  /** Total lamports committed to the class across the run. */
  paidLamports: bigint;
  /** Total score (half-points) across the class's entries — read by the
   *  report's default-player section, not published as a column. */
  scoreHalf: bigint;
}

/**
 * Drawn battles over one run: every pairwise battle comparison the crank
 * scored, and how many of them neither side won. The draw rate is the
 * number the free-integer space buys (CLAUDE.md tradeoff 4); under the hard
 * rule a conceded battle draws only against another conceded battle, so the
 * rate is expected to move, and the hard report prints it.
 */
export interface DrawTally {
  run: 'mixed' | LadderClass;
  draws: bigint;
  comparisons: bigint;
}

/** One field's complete results. */
export interface FieldResult {
  /** The pool size: it alone fixes the prize table the pools settled on. */
  capacity: PoolCapacity;
  /** Players seated per pool in this field. */
  seats: number;
  /** The prize table the pools settled on, multiples of the entry. */
  table: readonly number[];
  /** The fixed prize pool every pool of this field paid, in lamports. */
  prizePoolLamports: bigint;
  /** The mixed-field run's per-class rows, ladder order. */
  rows: ClassRow[];
  /** The homogeneous runs (every seat one class), by class. */
  homogeneous: ClassRow[];
  /** Draw rates per run: the mixed run first, then each homogeneous class. */
  draws: DrawTally[];
}

export interface StudyResult {
  params: StudyParams;
  /** Every field studied, in the order given. */
  fields: FieldResult[];
  /** The largest full field's rows (64 of 64) — the historical shape of this
   *  result, kept so existing callers and assertions keep meaning what they
   *  meant. */
  rows: ClassRow[];
  homogeneous: ClassRow[];
  csv: string;
  report: string;
}

/** Lamports as a SOL string for prose, bigint math only — trailing zeros
 *  trimmed so a whole-SOL amount reads "4", not "4.000000000". Human eyes
 *  only, never fed back into an amount. */
export function solString(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const frac = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac === '' ? `${whole}` : `${whole}.${frac}`;
}

/** n/d to `decimals` places, truncated toward zero, sign kept — bigint math. */
function fixed(numerator: bigint, denominator: bigint, decimals: number): string {
  if (denominator === 0n) return decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0';
  const negative = numerator < 0n !== denominator < 0n && numerator !== 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const scale = 10n ** BigInt(decimals);
  const scaled = (n * scale) / d;
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(decimals, '0');
  const body = decimals > 0 ? `${whole}.${frac}` : `${whole}`;
  return negative && scaled !== 0n ? `-${body}` : body;
}

/** rate = numerator/denominator as a fixed-decimals percent string, bigint math. */
function pct(numerator: bigint, denominator: bigint, decimals: number): string {
  return fixed(numerator * 100n, denominator, decimals);
}

/** A class's paid rate, as a percent string to 2 places. */
const paidRate = (r: ClassRow) => pct(BigInt(r.paidEntries), BigInt(r.entrants), 2);
const rankOneRate = (r: ClassRow) => pct(BigInt(r.rankOne), BigInt(r.entrants), 3);

/**
 * The class's paid rate minus the reference (`random`) class's, in
 * percentage points to 2 places, signed: (p_c/n_c − p_r/n_r) × 100, one
 * exact bigint fraction, truncated toward zero only when formatted.
 * A difference, not a ratio, because the random class's paid rate can be
 * exactly zero — a ratio over it has no value to print.
 */
function paidVsRandom(r: ClassRow, random: ClassRow): string {
  const num =
    BigInt(r.paidEntries) * BigInt(random.entrants) - BigInt(random.paidEntries) * BigInt(r.entrants);
  const s = pct(num, BigInt(r.entrants) * BigInt(random.entrants), 2);
  return num > 0n ? `+${s}` : s;
}

/**
 * Average return per entry: the class's committed lamports over (its
 * entries × the entry price) — prize lamports per lamport of entry, as a
 * four-place decimal string. Every prize is a whole multiple of the entry
 * (D-E19), so the ratio is the same at every tier.
 */
function returnPerEntry(r: ClassRow): string {
  return fixed(r.paidLamports, BigInt(r.entrants) * OFFLINE_ENTRY_LAMPORTS, 4);
}

/** Count the drawn battles across every pair in a population. */
function tallyDraws(population: GeneratedEntrant[], tally: DrawTally): void {
  for (let i = 0; i < population.length; i++) {
    for (let j = i + 1; j < population.length; j++) {
      for (let k = 0; k < 7; k++) {
        tally.comparisons += 1n;
        const c = compareBattle(
          population[i].battles[k] as never,
          population[j].battles[k] as never
        );
        if (c.outcome === 'draw') tally.draws += 1n;
      }
    }
  }
}

/** Run `pools` pools with `populationFor(poolSeed)` and tally per class. */
async function runSeries(
  pools: number,
  seedOf: (p: number) => number,
  populationFor: (poolSeed: number) => GeneratedEntrant[],
  byClass: Map<LadderClass, ClassRow>,
  field: { capacity: PoolCapacity; table: readonly number[]; prizePoolLamports: bigint },
  mode: BoardMode,
  draws: DrawTally
): Promise<void> {
  for (let p = 1; p <= pools; p++) {
    const poolSeed = seedOf(p);
    const population = populationFor(poolSeed);
    tallyDraws(population, draws);
    // Detection off: near-identical sets inside a class are the study's own
    // construction, not collusion (see OfflinePoolOptions.detect).
    const run = await runOfflinePool(poolSeed, {
      population,
      detect: false,
      mode,
      capacity: field.capacity,
    });
    if (run.outcome.finalState !== 'Paid') {
      throw new Error(`pool ${poolSeed} ended ${run.outcome.finalState}, expected Paid`);
    }
    const bundle = run.publisher.published.get(run.outcome.bundleUri!);
    if (!bundle) throw new Error(`pool ${poolSeed}: no published bundle`);

    // Conservation re-checked on every pool: the committed amounts must sum
    // to exactly the pool's prize pool, or the evidence is measuring a
    // broken engine.
    let committed = 0n;
    for (const r of bundle.results) committed += BigInt(r.amount_lamports);
    if (committed !== field.prizePoolLamports) {
      throw new Error(
        `pool ${poolSeed}: committed ${committed} != prize pool ${field.prizePoolLamports}`
      );
    }

    // Every amount re-derived from the PUBLISHED scores over the size's own
    // table — what a player recomputing the pool does. A crank that paid a
    // different table than the pool opened with fails here, not in print.
    const recomputed = assignPrizes(
      assignRanks(
        bundle.results.map((r) => ({ index: r.index, scoreHalf: r.score_half, zones: r.zones }))
      ),
      field.table,
      OFFLINE_ENTRY_LAMPORTS
    );
    const committedAt = new Map(bundle.results.map((r) => [r.index, BigInt(r.amount_lamports)]));
    for (const r of recomputed) {
      if (committedAt.get(r.index) !== r.amountLamports) {
        throw new Error(
          `pool ${poolSeed}: seat ${r.index} committed ${committedAt.get(r.index)}, ` +
            `the table pays ${r.amountLamports}`
        );
      }
    }

    for (const r of bundle.results) {
      const cls = population[r.index].strategy as LadderClass;
      const row = byClass.get(cls);
      if (!row) throw new Error(`pool ${poolSeed}: unknown class ${cls} at seat ${r.index}`);
      row.entrants += 1;
      row.scoreHalf += BigInt(r.score_half);
      if (r.rank === 1) row.rankOne += 1;
      const amount = BigInt(r.amount_lamports);
      if (amount > 0n) {
        row.paidEntries += 1;
        row.paidLamports += amount;
      }
    }
  }
}

/** The homogeneous runs' classes (uniform excluded by construction — a
 * homogeneous uniform pool is a single n-way tie, not a study run). */
const HOMOGENEOUS: readonly LadderClass[] = ['random', 'heuristic', 'optimised'];

/**
 * Seed offset per field, FIXED by (pool size, field) rather than by the
 * field's position in the list.
 *
 * The two 64-player fields keep the exact seeds they have always used —
 * 64 of 64 offset ZERO (since D-A2) and 40 of 64 offset 100,000,000 (since
 * 2026-09-08) — so the Ladder re-run cannot silently move the populations
 * this document has been publishing: their rank-1 rates reproduce to the
 * byte, and every other change in those rows is the new prize table, which
 * is the change being measured. The six new fields take offsets from
 * 700,000,000 up, clear of the default-player measurement's seeds
 * (300,000,000..600,000,000 + p).
 */
const FIELD_SEED_OFFSETS: ReadonlyMap<string, number> = new Map([
  ['64/64', 0],
  ['64/40', 100_000_000],
  ['8/8', 700_000_000],
  ['8/5', 800_000_000],
  ['16/16', 900_000_000],
  ['16/10', 1_000_000_000],
  ['32/32', 1_100_000_000],
  ['32/20', 1_200_000_000],
]);

export function fieldSeedOffset(capacity: number, seats: number): number {
  const offset = FIELD_SEED_OFFSETS.get(`${capacity}/${seats}`);
  if (offset === undefined) {
    throw new Error(`no seed offset is assigned to ${seats} players in a pool of ${capacity}`);
  }
  return offset;
}

async function runFieldStudy(params: StudyParams, f: StudyField): Promise<FieldResult> {
  const { capacity, seats } = f;
  if (seats > capacity || seats < minFieldFor(capacity)) {
    throw new Error(
      `${seats} players is not a field a pool of ${capacity} plays at ` +
        `(${minFieldFor(capacity)}..${capacity})`
    );
  }
  const offset = fieldSeedOffset(capacity, seats);
  const mode: BoardMode = params.mode ?? 'easy';
  const table = ladderTable(capacity);
  const settle = { capacity, table, prizePoolLamports: prizePoolFor(table, OFFLINE_ENTRY_LAMPORTS) };
  const newRows = () =>
    new Map<LadderClass, ClassRow>(
      LADDER.map((cls) => [
        cls,
        { cls, entrants: 0, rankOne: 0, paidEntries: 0, paidLamports: 0n, scoreHalf: 0n },
      ])
    );
  const draws: DrawTally[] = [];

  // ---- The mixed-field run (the original D-A2 study) ---------------------
  const mixed = newRows();
  const mixedDraws: DrawTally = { run: 'mixed', draws: 0n, comparisons: 0n };
  await runSeries(
    params.pools,
    (p) => params.baseSeed + offset + p,
    (seed) => ladderPopulation(seed, seats, mode),
    mixed,
    settle,
    mode,
    mixedDraws
  );
  draws.push(mixedDraws);
  const rows = LADDER.map((cls) => mixed.get(cls)!);

  // ---- The homogeneous-field runs (v2 amendment): one class fills every
  // seat, so every entrant in the pool is "equally skilled" — the outcome
  // spread measures the residual, allocation-level variation alone.
  // Seed strides keep the three runs' pools disjoint from the mixed run's.
  const homogeneous: ClassRow[] = [];
  for (const [i, cls] of HOMOGENEOUS.entries()) {
    const tally = newRows();
    const classDraws: DrawTally = { run: cls, draws: 0n, comparisons: 0n };
    await runSeries(
      params.pools,
      (p) => params.baseSeed + offset + (i + 1) * 1_000_000 + p,
      (seed) => homogeneousPopulation(cls, seed, seats, mode),
      tally,
      settle,
      mode,
      classDraws
    );
    homogeneous.push(tally.get(cls)!);
    draws.push(classDraws);
  }

  return {
    capacity,
    seats,
    table,
    prizePoolLamports: settle.prizePoolLamports,
    rows,
    homogeneous,
    draws,
  };
}

export async function runSkillEvidence(params: StudyParams): Promise<StudyResult> {
  const sizes = params.fields ?? STUDY_FIELDS;
  if (sizes.length === 0) throw new Error('a study needs at least one field');

  const fields: FieldResult[] = [];
  for (const f of sizes) fields.push(await runFieldStudy(params, f));

  // The largest full field is the reference run when one is present;
  // otherwise the first, so a single-field study still has `rows`.
  const largest = Number(MAX_CAPACITY);
  const primary = fields.find((f) => f.capacity === largest && f.seats === largest) ?? fields[0];

  const csv = renderCsv(fields);
  const report = renderReport(params, fields);
  return {
    params,
    fields,
    rows: primary.rows,
    homogeneous: primary.homogeneous,
    csv,
    report,
  };
}

/** The CSV's columns — the JSON the Fair play page imports carries the same. */
export const CSV_COLUMNS = [
  'run',
  'capacity',
  'seats',
  'class',
  'entrants',
  'rank1_entries',
  'paid_entries',
  'total_paid_lamports',
  'rank1_rate_pct',
  'paid_rate_pct',
  'paid_rate_vs_random_pp',
  'return_per_entry',
] as const;

function csvLine(run: string, f: FieldResult, r: ClassRow, random: ClassRow): string {
  return [
    run,
    f.capacity,
    f.seats,
    r.cls,
    r.entrants,
    r.rankOne,
    r.paidEntries,
    r.paidLamports.toString(),
    rankOneRate(r),
    paidRate(r),
    paidVsRandom(r, random),
    returnPerEntry(r),
  ].join(',');
}

const randomOf = (rows: ClassRow[]) => {
  const r = rows.find((x) => x.cls === 'random');
  if (!r) throw new Error('a run has no random row to compare against');
  return r;
};

function renderCsv(fields: FieldResult[]): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const f of fields) {
    for (const r of f.rows) lines.push(csvLine('mixed', f, r, randomOf(f.rows)));
    for (const r of f.homogeneous) lines.push(csvLine('homogeneous', f, r, randomOf(f.homogeneous)));
  }
  return lines.join('\n') + '\n';
}

const TABLE_HEAD = `| Pool size | Field | Class | Entrants | Rank-1 rate | Paid rate | Paid rate vs random | Return per entry |
|---|---|---|---|---|---|---|---|`;

/** One report row: the CSV's figures for a class in a field. */
function fieldRow(f: FieldResult, r: ClassRow, random: ClassRow): string {
  return `| ${f.capacity} | ${f.seats} | ${r.cls} | ${r.entrants} | ${rankOneRate(r)}% | ${paidRate(
    r
  )}% | ${paidVsRandom(r, random)} pp | ${returnPerEntry(r)} |`;
}

const SKILL_CLASSES = ['random', 'heuristic', 'optimised'] as const;

const ordinalSuffix = (n: number): string => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
};
function ordinal(n: number): string {
  return `${n}${n % 10 > 3 ? 'th' : ordinalSuffix(n)}`;
}

/**
 * A table's prizes in SOL at `entry`, first place first: runs of three or
 * more equal places collapse to "0.1 each, 9th–16th". SOL amounts only —
 * never multiples of the entry (D-E19: players see SOL per place).
 */
function prizesInSol(table: readonly number[], entry: bigint): string {
  const parts: string[] = [];
  let i = 0;
  while (i < table.length) {
    let j = i;
    while (j + 1 < table.length && table[j + 1] === table[i]) j++;
    const sol = solString(BigInt(table[i]) * entry);
    if (j - i + 1 >= 3) {
      parts.push(`${sol} each, ${ordinal(i + 1)}–${ordinal(j + 1)}`);
    } else {
      for (let k = i; k <= j; k++) parts.push(sol);
    }
    i = j + 1;
  }
  return parts.join('; ');
}

/** The Ladder at the study's entry price, from the engine's own tables. */
function renderPrizeTables(): string {
  const entry = OFFLINE_ENTRY_LAMPORTS;
  const rows = POOL_CAPACITIES.map((capacity) => {
    const table = LADDER_TABLES[capacity];
    return `| ${capacity} | ${MIN_FIELD_BY_CAPACITY[capacity]} | ${table.length} | ${prizesInSol(
      table,
      entry
    )} | ${solString(prizePoolFor(table, entry))} |`;
  }).join('\n');
  return `| Pool size | Minimum field | Places paid | Prizes in SOL, 1st place first | Prize pool (SOL) |
|---|---|---|---|---|
${rows}`;
}

/** What each field's figures would be if nothing an entrant did mattered. */
function renderBaselines(fields: FieldResult[]): string {
  const rows = fields
    .map((f) => {
      const seats = BigInt(f.seats);
      const paidPlaces = BigInt(Math.min(f.table.length, f.seats));
      return `| ${f.capacity} | ${f.seats} | ${pct(1n, seats, 3)}% | ${pct(
        paidPlaces,
        seats,
        2
      )}% | ${fixed(f.prizePoolLamports, seats * OFFLINE_ENTRY_LAMPORTS, 4)} |`;
    })
    .join('\n');
  return `| Pool size | Field | Rank-1 rate | Paid rate | Return per entry |
|---|---|---|---|---|
${rows}`;
}

/** "8 of 8, 5 of 8, 16 of 16, …" — the fields, derived. */
function fieldList(fields: FieldResult[]): string {
  return fields.map((f) => `${f.seats} of ${f.capacity}`).join(', ');
}

/** 1200000000 → "1,200,000,000" — integer grouping without a locale lookup. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The headline's closing sentence, GENERATED: whether the optimised class's
 * paid rate is above the random class's at every field, read from the rows,
 * so the sentence cannot outlive the data that supports it.
 */
function separationSentence(fields: FieldResult[]): string {
  const failing = fields.filter((f) => {
    const by = new Map(f.rows.map((r) => [r.cls, r]));
    const o = by.get('optimised')!;
    const r = by.get('random')!;
    return BigInt(o.paidEntries) * BigInt(r.entrants) <= BigInt(r.paidEntries) * BigInt(o.entrants);
  });
  if (failing.length === 0) {
    return `In every field above — every pool size, full and at its minimum — the
optimised class's paid rate is above the random class's. That gap, produced
purely by allocation choices, is the product's skill evidence.`;
  }
  return `The optimised class's paid rate is NOT above the random class's in
${failing.length} field(s): ${fieldList(failing)}. Read those rows before
citing this study for those pool sizes.`;
}

/** Totals of one class across every field's mixed run. */
function acrossFields(fields: FieldResult[], cls: LadderClass): ClassRow {
  const total: ClassRow = { cls, entrants: 0, rankOne: 0, paidEntries: 0, paidLamports: 0n, scoreHalf: 0n };
  for (const f of fields) {
    const r = f.rows.find((x) => x.cls === cls)!;
    total.entrants += r.entrants;
    total.rankOne += r.rankOne;
    total.paidEntries += r.paidEntries;
    total.paidLamports += r.paidLamports;
  }
  return total;
}

/** The default rows in one sentence, generated from the data. */
function defaultSummary(fields: FieldResult[]): { sentence: string; nothing: boolean } {
  const u = acrossFields(fields, 'uniform');
  if (u.rankOne === 0 && u.paidEntries === 0) {
    return {
      nothing: true,
      sentence: `The rows above say the default never places first and is never paid, at any
pool size or field, *in this study*.`,
    };
  }
  return {
    nothing: false,
    sentence: `The rows above say the default placed first in ${u.rankOne} of ${u.entrants}
entries and was paid in ${u.paidEntries} of ${u.entrants}, across every pool size and
field, *in this study*.`,
  };
}

/** Whether uniform's mean score beats random's in every field's mixed run. */
function uniformOutscoresRandom(fields: FieldResult[]): boolean {
  return fields.every((f) => {
    const u = f.rows.find((r) => r.cls === 'uniform')!;
    const r = f.rows.find((x) => x.cls === 'random')!;
    return u.scoreHalf * BigInt(r.entrants) > r.scoreHalf * BigInt(u.entrants);
  });
}

/**
 * The default's three tiers (§H22, corrected 2026-09-19), MEASURED here so the
 * report's prose is generated like every other number in it.
 *
 * Until 2026-09-26 this section of `REPORT.md` was written by hand from a run
 * that was never committed, so the nightly reproduction could not produce it
 * and the lane was red from 2026-09-20. It is now computed: the default (20
 * in every stat of every battle) takes seat 0 against 39 seats of one
 * composition, over `DEFAULT_TIER_POOLS` pools, ranked by the real engine
 * (battles won, then stats won; ties share the better rank).
 *
 * The field is a 64-player pool at its minimum field — 40 players, the size
 * of the devnet pool that prompted the correction — and its prizes are that
 * pool size's table (D-E19), assigned by the engine.
 *
 * Seeds are disjoint from every study run (offset 300,000,000 and up).
 */
export const DEFAULT_TIER_POOLS = 400;
export const DEFAULT_TIER_CAPACITY: PoolCapacity = 64;
export const DEFAULT_TIER_SEATS = minFieldFor(DEFAULT_TIER_CAPACITY);
export const ONE_DELIBERATE_POOLS = 200;

export interface DefaultTiers {
  rows: { label: string; firsts: number; median: number; min: number; max: number }[];
  /** Pools in which ONE deliberate entrant among defaults ranked first, alone. */
  soleWins: number;
  /** A field of nothing but defaults: what each entrant is paid. */
  allDefaultEach: bigint;
  /** One deliberate entrant among defaults, alone in first: its prize, and
   *  the smallest share any default took (the floor of the tie split). */
  soleFirstPrize: bigint;
  soleOthersEach: bigint;
}

export function measureDefaultTiers(baseSeed: number): DefaultTiers {
  const EVEN = () => Array.from({ length: 7 }, () => [20, 20, 20, 20, 20]);
  const table = ladderTable(DEFAULT_TIER_CAPACITY);
  const entry = OFFLINE_ENTRY_LAMPORTS;
  const others = DEFAULT_TIER_SEATS - 1;
  const compositions: { label: string; field: (p: number) => number[][][] }[] = [
    {
      label: "this study's mixed ladder",
      field: (p) => {
        const pop = ladderPopulation(baseSeed + 300_000_000 + p, DEFAULT_TIER_SEATS);
        pop.splice(pop.findIndex((e) => e.strategy === 'uniform'), 1);
        return pop.map((e) => e.battles);
      },
    },
    {
      label: 'three-stat concentrators only',
      field: (p) =>
        Array.from({ length: others }, (_, i) =>
          generateLadderEntrant(i % 2 ? 'heuristic' : 'optimised', (baseSeed + 400_000_000 + p) * 1000 + i).battles
        ),
    },
    {
      label: 'arbitrary free-integer allocations',
      field: (p) =>
        Array.from({ length: others }, (_, i) =>
          generateEntrant('random', (baseSeed + 500_000_000 + p) * 1000 + i).battles
        ),
    },
  ];
  const rows = compositions.map(({ label, field }) => {
    const ranks: number[] = [];
    for (let p = 1; p <= DEFAULT_TIER_POOLS; p++) {
      ranks.push(scorePool([EVEN(), ...field(p)] as never)[0].rank);
    }
    const sorted = [...ranks].sort((a, b) => a - b);
    return {
      label,
      firsts: ranks.filter((r) => r === 1).length,
      median: sorted[Math.floor((sorted.length - 1) / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  });

  const allDefault = assignPrizes(
    scorePool(Array.from({ length: DEFAULT_TIER_SEATS }, EVEN) as never),
    table,
    entry
  );
  const allDefaultEach = allDefault.reduce((m, r) => (r.amountLamports < m ? r.amountLamports : m), allDefault[0].amountLamports);

  let soleWins = 0;
  let soleFirstPrize = 0n;
  let soleOthersEach = 0n;
  for (let p = 1; p <= ONE_DELIBERATE_POOLS; p++) {
    const cls = p % 2 ? 'heuristic' : 'optimised';
    const res = assignPrizes(
      scorePool(
        [generateLadderEntrant(cls, baseSeed + 600_000_000 + p).battles, ...Array.from({ length: others }, EVEN)] as never
      ),
      table,
      entry
    );
    if (res[0].rank === 1 && res.filter((r) => r.rank === 1).length === 1) {
      soleWins++;
      if (soleFirstPrize === 0n) {
        soleFirstPrize = res[0].amountLamports;
        soleOthersEach = res
          .slice(1)
          .reduce((m, r) => (r.amountLamports < m ? r.amountLamports : m), res[1].amountLamports);
      }
    }
  }
  return { rows, soleWins, allDefaultEach, soleFirstPrize, soleOthersEach };
}

function tierCell(r: DefaultTiers['rows'][number], seats: number): string {
  if (r.min === r.max && r.max === seats) return `**${ordinal(seats)} — last, every pool**`;
  if (r.max === 1) return '**1st**';
  return `${ordinal(r.median)} of ${seats}`;
}

/** The one-deliberate-entrant paragraph, from the engine's own amounts. */
function notAStrategy(tiers: DefaultTiers): string {
  const seats = DEFAULT_TIER_SEATS;
  const table = ladderTable(DEFAULT_TIER_CAPACITY);
  const prizePool = prizePoolFor(table, OFFLINE_ENTRY_LAMPORTS);
  const entry = OFFLINE_ENTRY_LAMPORTS;
  const backExactly = tiers.allDefaultEach === entry;
  const lessThanEntry = tiers.soleOthersEach < entry;
  return `**And the default is not a strategy, because it cannot be one.** If every
entrant in a ${seats}-player field of a ${DEFAULT_TIER_CAPACITY}-player pool leaves the default, all ${seats} scores are
identical, all ${seats} tie for first and share the prizes of every place they occupy
— the whole ${solString(prizePool)} SOL prize pool, ${solString(tiers.allDefaultEach)} SOL each${
    backExactly ? ': exactly their entry back, and nobody profits' : ''
  }. Introduce a single three-stat player into that field and they place first alone, in
${tiers.soleWins} of ${ONE_DELIBERATE_POOLS} measured pools, taking the ${solString(
    tiers.soleFirstPrize
  )} SOL first prize; the ${seats - 1} who left the default tie
for second and share what the remaining places pay — ${solString(tiers.soleOthersEach)} SOL each
(the indivisible lamport remainder to the lowest entry index, D3-B)${
    lessThanEntry ? ', less than the entry each of them paid' : ''
  }. One deliberate entrant is enough to make doing nothing ${
    lessThanEntry ? 'return less than it cost' : 'pay less than playing'
  }.`;
}

/** The easy report's reading of the default rows, generated from the data. */
function easyDefaultReading(fields: FieldResult[], tiers: DefaultTiers): string {
  const seats = DEFAULT_TIER_SEATS;
  const summary = defaultSummary(fields);
  const table = tiers.rows
    .map((r) => {
      const rate = pct(BigInt(r.firsts), BigInt(DEFAULT_TIER_POOLS), 1);
      return `| ${r.label} | **${rate}%** (${r.firsts}/${DEFAULT_TIER_POOLS}) | ${tierCell(r, seats)} |`;
    })
    .join('\n');
  const outscores = uniformOutscoresRandom(fields)
    ? `The superlative that used to appear
here, and in the app's rules copy, is not supported by this study's own data:
the \`uniform\` class outscores the \`random\` class within these very runs, in
every field.`
    : `The superlative that used to appear
here, and in the app's rules copy, is not supported by the measurement above.`;
  return `**The part of this that is structural.** A battle is won by taking three of
the five stats. Against any opponent who concentrates on three, the flat
split loses those three and takes only the two the opponent starved — so it
loses that battle 3–2 **by construction, not on average**. That holds for
any three-stat opponent and needs no statistics.

**The part of this that is about THIS population, corrected 2026-09-19.**
${summary.sentence} Two of the four ladder classes — \`heuristic\` and
\`optimised\` — are defined as three-stat concentration, so half of every
mixed field (as near half as a field of 5 or 10 allows) is the one shape the
default loses to by construction. ${
    summary.nothing ? 'The 0.000% is' : 'Those rates are'
  } real and reproducible, and ${summary.nothing ? 'it is' : 'they are'} **a
property of a field that is half deliberate play**, not a property of the
allocation.

An earlier version of this section read as though it were the latter, and a
${seats}-player pool on devnet (pool 20, 2026-09-19) contradicted it: two entrants
who left the default tied for first and split the whole prize, against a field
that concentrated on one and two stats rather than three. The correction
below is measured with the product's own scoring engine over ${DEFAULT_TIER_POOLS} pools of ${seats}
players — a ${DEFAULT_TIER_CAPACITY}-player pool at its minimum field — generated with this report
(\`measureDefaultTiers\`, \`tests/rehearsal/src/skill-evidence.ts\`):

| the other ${seats - 1} players | default's rank-1 rate | median rank |
|---|---|---|
${table}

**So the default is the MIDDLE of three tiers, not the bottom.** Deliberate
three-stat play beats it totally; careless concentration loses to it totally.
The rank-1 rate alone cannot show this — the middle tier and the bottom tier
can both read 0.000% and look identical. ${outscores}

${notAStrategy(tiers)}

That is also why these rows are kept OUT of the headline comparison above:
the honest measure of skill is the spread between entrants who are all
genuinely competing, which is what the headline table reports.
`;
}

/**
 * The hard report's reading of the same rows. Written with the correction
 * the easy report carries since 2026-09-19 (the default is the MIDDLE of
 * three tiers, not the bottom): what is structural is separated from what
 * is a property of this study's population.
 */
function hardDefaultReading(fields: FieldResult[]): string {
  const summary = defaultSummary(fields);
  return `**The part of this that is structural.** Under the hard rule the default is
20 in every stat of every battle. Against a stacked battle (140 across a
trio with nonzero off-stats) it loses that battle 3–2 by construction; against
a conceded battle (nothing placed) it wins 5–0. So against either stacked
class it wins exactly the two conceded battles and loses the other five —
every time, not on average.

**The part of this that is about THIS population.** Half of every mixed
field here (as near half as a field of 5 or 10 allows) is the two stacked
classes. ${summary.sentence} Against a field of free-integer boards (the
\`random\` class, about 20 a stat with spread) the default is an even contest
stat for stat, and against careless concentration it can rank well — as the
easy study measured on 2026-09-19. ${
    summary.nothing ? 'The 0.000% is' : 'Those rates are'
  } real and reproducible; ${summary.nothing ? 'it is' : 'they are'} a property of a field that is
half deliberate play, not a property of the allocation. These rows are kept
OUT of the headline comparison above for the same reason as in the easy
report: the honest measure of skill is the spread between entrants who are
all genuinely competing.
`;
}

/** The hard report's extra sections; empty for easy. */
function renderHardSections(params: StudyParams, fields: FieldResult[]): string {
  if ((params.mode ?? 'easy') !== 'hard') return '';
  const drawRows = fields
    .flatMap((f) =>
      f.draws.map(
        (d) =>
          `| ${f.capacity} | ${f.seats} | ${d.run} | ${d.comparisons} | ${d.draws} | ${pct(
            d.draws,
            d.comparisons,
            3
          )}% |`
      )
    )
    .join('\n');
  return `
## Draw rate under the hard rule

A drawn battle is one where neither side takes three stats. Under the hard
rule a battle may hold nothing, and a battle holding nothing loses 5–0 to
any battle holding anything — so draws come from two conceded battles
meeting, from two boards that happen to split a battle 2–2 with a tied
stat, and from the uniform class meeting itself. The table counts every
pairwise battle comparison the crank scored in each run:

| Pool size | Field | Run | Battle comparisons | Drawn | Draw rate |
|---|---|---|---|---|---|
${drawRows}

The \`mixed\` rows include the uniform quarter of the field, which draws
every battle against itself by construction; the \`random\` rows are the
free-integer draw rate of the hard board on its own.
`;
}

/** The seed offsets, as the methodology states them — from the table. */
function seedOffsetsProse(fields: FieldResult[]): string {
  return fields
    .map((f) => {
      const o = grouped(fieldSeedOffset(f.capacity, f.seats));
      return `${f.seats} of ${f.capacity} → ${o}`;
    })
    .join('; ');
}

/** "2 each at 8; 1 or 2 each at 5 (rotating) …" — derived from classCounts. */
function perClassProse(fields: FieldResult[]): string {
  return fields
    .map((f) => {
      const base = Math.floor(f.seats / LADDER.length);
      return f.seats % LADDER.length === 0
        ? `${base} each at ${f.seats} of ${f.capacity}`
        : `${base} or ${base + 1} each at ${f.seats} of ${f.capacity} (the extra entries rotating between classes pool by pool)`;
    })
    .join('; ');
}

function renderReport(params: StudyParams, fields: FieldResult[]): string {
  const hard = (params.mode ?? 'easy') === 'hard';
  const headline = fields
    .flatMap((f) => {
      const byCls = new Map(f.rows.map((r) => [r.cls, r]));
      return SKILL_CLASSES.map((cls) => fieldRow(f, byCls.get(cls)!, byCls.get('random')!));
    })
    .join('\n');

  const defaultRows = fields
    .map((f) => fieldRow(f, f.rows.find((r) => r.cls === 'uniform')!, randomOf(f.rows)))
    .join('\n');

  const homogeneousTable = fields
    .flatMap((f) => f.homogeneous.map((r) => fieldRow(f, r, randomOf(f.homogeneous))))
    .join('\n');

  const capacities = [...new Set(fields.map((f) => f.capacity))].join(', ');
  const entrySol = solString(OFFLINE_ENTRY_LAMPORTS);

  const modeNote = hard
    ? `
**THE HARD BOARD (Phase B, 2026-09-25).** Every pool in this file was
opened under the hard rule: 700 points placed anywhere across the seven
battles, a battle free to hold nothing. The four classes are the hard
ladder (\`tests/rehearsal/src/ladder.ts\`, "THE HARD LADDER"): uniform is
still 20 in every stat (the hard board's own buzzer default, 700 / 35);
random is 700 over the 35 cells; heuristic concedes two battles and stacks
the other five at 140 each across a trio; optimised is that family tuned.
The easy study is \`../REPORT.md\`.
`
    : '';

  return `# Skill evidence — outcome statistics by strategy class${hard ? ' (hard board)' : ''}

*Generated by \`npm run skill-evidence\` in \`tests/rehearsal\` — do not edit
by hand. Deterministic: the same parameters reproduce this file byte for
byte, and the nightly CI job re-runs the study and diffs it against this
committed copy.*
${modeNote}
**The Ladder (D-E19).** A pool holds ${capacities} players and pays the top
quarter of its size on a fixed prize table that depends on the size alone —
never on how many entered. Every run below is measured at **every pool size,
full and at its minimum field**: ${fieldList(fields)}. The minimum field is
the smallest field a size may play at — a pool whose deadline passes holding
at least that many entrants plays rather than refunding. A claim measured
only at one size, or only at full capacity, would leave the obvious questions
about the others unanswered.

## The prizes these pools paid

At the ${entrySol} SOL entry every pool in this study settled on its size's
published table (\`LADDER_TABLES\`, \`backend/scoring/src/prizes.ts\`, copied
onto the pool at open as \`open_pool\` does). Players tied on battles and
stats share the prizes of the places they occupy (D3-B), so a tie can
straddle the last paid place and every member of it is paid.

${renderPrizeTables()}

## Headline: considered play against unconsidered play

Every entrant pays the same entry and faces the identical field; the only
input that differs between the rows below is how the entrant allocated
stats across the seven battles. The spread between **random** (valid
allocations with no intent) and **optimised** (a tuned three-stat plan) is
the measured effect of that choice under the published scoring rule
(battles won, then stats won; the pool's table paid by rank, ties sharing
per D3-B):

${TABLE_HEAD}
${headline}

The everyone-equal baseline — what each entry is worth if nothing an
entrant does matters, so that every entrant is equally placed to take any
rank:

${renderBaselines(fields)}

${separationSentence(fields)}

## Leaving the allocation on its default

The allocation screen opens on an even split — 20/20/20/20/20 across
Strength, Speed, Heart, Wit and Durability — and stays there until the
player moves it. The \`uniform\` class IS that state: it is byte-identical to
the app's \`EVEN_SPLIT\` (\`app/src/battle/allocation.ts\`, the constant every
screen opens on), so these rows are the measured outcome for a player who
opens the flow, touches nothing, and locks in all seven battles.

${TABLE_HEAD}
${defaultRows}

${hard ? hardDefaultReading(fields) : easyDefaultReading(fields, measureDefaultTiers(params.baseSeed))}
## Fields of equally-skilled entrants

The v2 amendment's control runs: **${params.pools} pools per class, per
field**, in which every seat plays the SAME strategy class (with within-class
uniqueness — no two entrants in a pool share an allocation set, see
Methodology). When everyone is equally skilled, outcomes should spread toward
the everyone-equal baseline above: rank-1 rate near one entry's share of the
field, paid rate near the places paid over the field (a tie straddling the
last paid place lifts it a little, since every member of that tie is paid),
and return per entry at exactly the baseline (conservation forces the class
total to equal the prize pool; the spread is who takes which prize). The
"vs random" column here compares against the homogeneous random run of the
same field.

${TABLE_HEAD}
${homogeneousTable}

Reading: among equals, no entrant holds an edge — the return per entry sits
at the baseline for every class, at every pool size and field. Skill
differentiates BETWEEN classes (the headline table); within a class it
cannot, which is exactly the shape a skill competition's outcomes should
have.

${hard ? renderHardSections(params, fields) + '\n' : ''}## Methodology

- **Runs**: at EACH field (${fieldList(fields)}), one mixed-field run
  (${params.pools} pools; ${perClassProse(fields)}; seat order shuffled per
  pool by a seeded Fisher–Yates so class is uncorrelated with seat index)
  and three homogeneous-field runs (${params.pools} pools of one class each,
  for random / heuristic / optimised).
- **Seeds**: base seed **${params.baseSeed}**. Each field has a fixed seed
  offset — ${seedOffsetsProse(fields)}. The two 64-player fields keep the
  seeds this study has used since D-A2 and 2026-09-08, so their populations,
  and with them their rank-1 rates, are unchanged by the Ladder; what moved
  in those rows is the prize table. Within a field, mixed-run pool p uses
  baseSeed + offset + p (p = 1..${params.pools}); homogeneous run i
  (1 = random, 2 = heuristic, 3 = optimised) uses
  baseSeed + offset + i×1,000,000 + p. Every entrant stream is sha256 of a
  labelled seed string — no wall clock, no \`Math.random\` — so a run is
  reproducible from its parameters alone.
- **Within-class uniqueness**: no two entrants of one class in one pool
  share the identical seven-battle allocation set. The jitter model moves
  0..jitterMax points between trio stats (the sum holds exactly); any
  residual full-set collision is repaired deterministically by regenerating
  the later entrant with a bumped salt (\`ensureUniqueWithinClass\`,
  \`tests/rehearsal/src/ladder.ts\`). The uniform class is exempt —
  20/20/20/20/20 is its definition, which is also why no homogeneous uniform
  run exists: it would be a single n-way tie.
- **Definitions**: *rank-1 rate* — share of a class's entries whose
  competition rank was 1 (ties share rank 1); *paid rate* — share of a
  class's entries committed a nonzero amount; *paid rate vs random* — the
  class's paid rate minus the \`random\` class's in the same run and field,
  in percentage points; *return per entry* — the class's total committed
  lamports over (class entries × the entry price), i.e. prize lamports per
  lamport of entry. Every figure is computed from integer counts and
  lamports and truncated to the places shown only when printed; the CSV
  carries the integer counts beside each rate.
- **Pipeline**: the real settlement crank over the offline chain mirror
  (\`FakeChain\`) — decrypt, score, rank, prize assignment over the pool's own
  table, Merkle commitment, batched payout — with conservation asserted on
  every pool (committed amounts sum to the prize pool exactly) and every
  committed amount re-derived from the published scores with
  \`assignPrizes\` over the same table. Detection is off: identical or
  near-identical sets inside a class are the study's construction, not
  collusion. **The engine scoring these pools is the same module the crank
  runs in production and the verify page runs in the browser** — a player
  can recompute any pool of this study from its published data.
- **Tier**: ${entrySol} SOL entries (tier 0, D1). Each pool's prizes are its
  size's table at that entry (D-E19), read from the same tables the engine
  pays from, never restated here. Every prize is a whole multiple of the
  entry, so every rate and every return per entry carries to every tier
  unchanged.
- **Reproduce**:

  \`\`\`bash
  cd tests/rehearsal && npm ci && ${hard ? 'SKILL_EVIDENCE_MODE=hard ' : ''}npm run skill-evidence
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
