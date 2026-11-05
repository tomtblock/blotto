/**
 * Fill-rule replay (founder instruction 2026-09-12 §5.2), per pool size since
 * the Ladder (D-E19).
 *
 * The question this exists to answer, first asked of the single 64-player
 * pool: *"how often, on realistic arrival curves, does the rule seal vs
 * refund — I will use it to decide whether the numbers stay."* Since D-E19
 * there are four sizes, each with its own minimum field (8 → 5, 16 → 10,
 * 32 → 20, 64 → 40), so the answer is four curves.
 *
 * So it is not a test. It is a measurement, and its output is a markdown
 * report (`docs/testing/FILL-SIMULATION.md`).
 *
 * WHAT IT MODELS. Entries arriving at one pool as a Poisson process over the
 * fill window, run through the two gates that can stop one — the territory
 * schedule and the pool's capacity — and then through the fill state machine
 * exactly as `seal_at_deadline` and `trigger_refund` define it: seal when the
 * last seat of the pool's capacity fills, seal at the deadline at or above
 * the pool's minimum field, refund below it.
 *
 * WHAT IT DOES NOT MODEL, so nobody reads more into it than is there:
 *   - demand is exogenous, and each size is simulated alone. A pool that
 *     refunds probably depresses the next pool's arrivals; a fast fill
 *     probably raises them; and with four sizes open at once, players
 *     choosing one size are players another size does not get. Nothing here
 *     has a feedback or a split term, so the rates below are first-order
 *     estimates, not a forecast.
 *   - arrivals are independent and uniform in rate. Real entries will
 *     cluster around whatever is posted, and clustering RAISES the seal rate
 *     at a given mean.
 *   - the sanctions screening is not simulated: it rejects by wallet
 *     against live lists, which a country code cannot stand in for.
 *
 * Every figure comes from the shared constants (`@blotto/scoring`'s
 * LADDER_TABLES, MIN_FIELD_BY_CAPACITY, TIER_ENTRY_LAMPORTS, the fill
 * deadline) and `config/territories.json` — nothing is typed here.
 *
 * Deterministic: one seeded PRNG per (size, rate), so a re-run reproduces the
 * report and a change to the rule shows up as a diff.
 *
 * Run: npx tsx scripts/sim/fill-replay.ts [--write | --self-test]
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  DEFAULT_FILL_DEADLINE_SECS,
  LADDER_TABLES,
  MIN_FIELD_BY_CAPACITY,
  POOL_CAPACITIES,
  TIER_ENTRY_LAMPORTS,
  prizePoolFor,
  type PoolCapacity,
} from '../../backend/scoring/src/prizes';
import {
  loadTerritorySchedule,
  territoryAllowed,
  type TerritorySchedule,
} from '../../backend/packet/src/territories';

const ROOT = resolve(__dirname, '..', '..');
const DEADLINE = Number(DEFAULT_FILL_DEADLINE_SECS);
/** The report prices every size at tier 0 — the tier the devnet launch opens. */
const TIER = 0;

// ---------------------------------------------------------------------------
// A seeded PRNG. mulberry32 — small, fast, and good enough for arrival times.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The timeline a sim consumes — the shape §5.2 specifies.
// ---------------------------------------------------------------------------

export interface Arrival {
  t_offset_secs: number;
  wallet: string;
  country: string;
  region?: string;
}

export interface PoolOutcome {
  outcome: 'sealed_at_capacity' | 'sealed_at_deadline' | 'refunded';
  capacity: number;
  floor: number;
  seated: number;
  /** The pool's fixed prize pool (its size's table at the tier price). */
  prizePoolLamports: bigint;
  /** Entries returned in full, when the pool refunded. */
  refunds: number;
  rejectedByTerritory: number;
  rejectedByDeadline: number;
  /** Seconds from open to the seal, or the deadline when it ran out. */
  concludedAtSecs: number;
}

/**
 * One pool of `capacity`, from a timeline. The state machine mirrors the
 * program's: `register` accepts while `now <= fill_deadline` and
 * `entrants < capacity`; the last seat seals immediately; past the deadline
 * the pool's minimum field decides the fork.
 */
export function replayPool(
  arrivals: readonly Arrival[],
  schedule: TerritorySchedule,
  opts: { capacity: PoolCapacity; floor?: number; tier?: number }
): PoolOutcome {
  const capacity = opts.capacity;
  const floor = opts.floor ?? MIN_FIELD_BY_CAPACITY[capacity];
  const tier = opts.tier ?? TIER;
  let seated = 0;
  let rejectedByTerritory = 0;
  let rejectedByDeadline = 0;
  let sealedAt: number | null = null;

  for (const a of [...arrivals].sort((x, y) => x.t_offset_secs - y.t_offset_secs)) {
    if (sealedAt !== null) {
      // The pool is closed; anything later is refused for that reason, not
      // by the clock.
      rejectedByDeadline++;
      continue;
    }
    if (a.t_offset_secs > DEADLINE) {
      rejectedByDeadline++;
      continue;
    }
    // The entry gate, before the chain ever sees it.
    if (!territoryAllowed(schedule, a.country, a.region)) {
      rejectedByTerritory++;
      continue;
    }
    seated++;
    if (seated === capacity) sealedAt = a.t_offset_secs;
  }

  const prizePoolLamports = prizePoolFor(LADDER_TABLES[capacity], TIER_ENTRY_LAMPORTS[tier]);
  const base = { capacity, floor, seated, prizePoolLamports, rejectedByTerritory, rejectedByDeadline };
  if (sealedAt !== null) {
    return { ...base, outcome: 'sealed_at_capacity', refunds: 0, concludedAtSecs: sealedAt };
  }
  if (seated >= floor) {
    return { ...base, outcome: 'sealed_at_deadline', refunds: 0, concludedAtSecs: DEADLINE };
  }
  return { ...base, outcome: 'refunded', refunds: seated, concludedAtSecs: DEADLINE };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Countries an arrival can come from. Weighted towards the open markets of
 * PID §9, with a share from blocked ones so the territory gate is exercised
 * rather than assumed away. The exact mix is a guess and is labelled as one
 * in the report — what it is NOT is a claim about where demand will be. */
const COUNTRY_MIX: readonly (readonly [string, number])[] = [
  ['GB', 20],
  ['US', 25],
  ['DE', 10],
  ['FR', 8],
  ['CA', 7],
  ['BR', 6],
  ['NL', 5],
  ['ES', 4],
  ['JP', 3],
  ['AU', 6],
  ['IN', 4],
  ['SG', 2],
];

function pickCountry(rnd: () => number): string {
  const total = COUNTRY_MIX.reduce((a, [, w]) => a + w, 0);
  let x = rnd() * total;
  for (const [code, w] of COUNTRY_MIX) {
    x -= w;
    if (x <= 0) return code;
  }
  return COUNTRY_MIX[COUNTRY_MIX.length - 1][0];
}

/**
 * A Poisson arrival process over the window: inter-arrival times are
 * exponential with mean `window / expected`.
 */
export function poissonTimeline(expected: number, rnd: () => number, window = DEADLINE): Arrival[] {
  const out: Arrival[] = [];
  const mean = window / expected;
  let t = 0;
  let i = 0;
  for (;;) {
    t += -Math.log(1 - rnd()) * mean;
    // A pool cannot take more than its capacity, but the TIMELINE can carry
    // more: the surplus is what `rejectedByDeadline` counts once the pool has
    // closed, and it is real demand the next pool inherits.
    if (t > window * 1.5) break;
    out.push({ t_offset_secs: Math.round(t), wallet: `sim-${i++}`, country: pickCountry(rnd) });
  }
  return out;
}

/** §5.2 fixture 3: the adversarial case — one entry short of the minimum
 * field until the last minute, and the entry that would have saved it
 * arrives one second late. */
export function adversarialTimeline(floor: number): Arrival[] {
  const out: Arrival[] = [];
  for (let i = 0; i < floor - 1; i++) {
    out.push({ t_offset_secs: DEADLINE - 60 + Math.floor(i / 10), wallet: `edge-${i}`, country: 'GB' });
  }
  out.push({ t_offset_secs: DEADLINE + 1, wallet: 'edge-late', country: 'GB' });
  return out;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/** Mean attempts in the window, as multiples of the pool's capacity — the
 * same relative curve at every size, so the four tables compare directly. */
const RATE_MULTIPLES: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

interface RateResult {
  expected: number;
  trials: number;
  sealedAtCapacity: number;
  sealedAtDeadline: number;
  refunded: number;
  meanSeated: number;
  meanTerritoryRejected: number;
  /** Treasury result per pool that ran, in lamports: its entries less its prize pool. */
  meanReturnLamports: bigint;
}

function sweep(schedule: TerritorySchedule, capacity: PoolCapacity, trials: number): RateResult[] {
  const price = TIER_ENTRY_LAMPORTS[TIER];
  return RATE_MULTIPLES.map((k) => Math.round(capacity * k)).map((expected) => {
    const rnd = mulberry32(0x5eed + capacity * 100_000 + Math.round(expected * 1000));
    let sealedAtCapacity = 0;
    let sealedAtDeadline = 0;
    let refunded = 0;
    let seatedTotal = 0;
    let territoryTotal = 0;
    let returnTotal = 0n;
    for (let i = 0; i < trials; i++) {
      const r = replayPool(poissonTimeline(expected, rnd), schedule, { capacity });
      seatedTotal += r.seated;
      territoryTotal += r.rejectedByTerritory;
      if (r.outcome === 'sealed_at_capacity') sealedAtCapacity++;
      else if (r.outcome === 'sealed_at_deadline') sealedAtDeadline++;
      else refunded++;
      // A pool that plays returns its field's entries less its prize pool;
      // one that refunds returns nothing and costs nothing (the prize pool
      // goes back to the treasury).
      if (r.outcome !== 'refunded') returnTotal += BigInt(r.seated) * price - r.prizePoolLamports;
    }
    const ran = sealedAtCapacity + sealedAtDeadline;
    return {
      expected,
      trials,
      sealedAtCapacity,
      sealedAtDeadline,
      refunded,
      meanSeated: seatedTotal / trials,
      meanTerritoryRejected: territoryTotal / trials,
      meanReturnLamports: ran === 0 ? 0n : returnTotal / BigInt(ran),
    };
  });
}

const sol = (lamports: bigint): string => {
  const neg = lamports < 0n;
  const v = neg ? -lamports : lamports;
  const whole = v / 1_000_000_000n;
  const frac = (v % 1_000_000_000n).toString().padStart(9, '0').slice(0, 3);
  return `${neg ? '-' : ''}${whole}.${frac}`;
};

const pct = (n: number, of: number): string => `${((100 * n) / of).toFixed(1)}%`;

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function report(schedule: TerritorySchedule, results: Map<PoolCapacity, RateResult[]>, trials: number): string {
  const price = TIER_ENTRY_LAMPORTS[TIER];
  const lines: string[] = [];
  lines.push('# Fill-rule simulation — how often does each pool size seal?');
  lines.push('');
  lines.push('**Generated by `scripts/sim/fill-replay.ts`. Do not edit by hand — re-run it with `--write`.**');
  lines.push('');
  lines.push(
    'It answers one question per pool size (D-E19): on realistic arrival curves, how often does a pool ' +
      'reach its minimum field by its deadline and play, rather than refund every entry?'
  );
  lines.push('');

  lines.push('## What it says');
  lines.push('');
  {
    const total = COUNTRY_MIX.reduce((a, [, w]) => a + w, 0);
    const blockedWeight = COUNTRY_MIX.filter(([c]) => !territoryAllowed(schedule, c, null)).reduce((a, [, w]) => a + w, 0);
    lines.push(
      `**Read this first.** The simulated arrivals follow an assumed country mix (below), and under ` +
        `territory schedule version ${schedule.version} **${Math.round((blockedWeight / total) * 100)}% of that mix is blocked** ` +
        'at the entry gate. The figures therefore depend heavily on that assumption; the "Mean seated" column is ' +
        'what actually reaches a seat.'
    );
    lines.push('');
  }
  lines.push('**The rate each size needs.** The attempts in 12 hours at which a pool refunds less than one time in ten:');
  lines.push('');
  for (const capacity of POOL_CAPACITIES) {
    const rows = results.get(capacity) ?? [];
    const enough = rows.find((r) => r.refunded / r.trials <= 0.1);
    lines.push(
      `- **${capacity} players** (minimum field ${MIN_FIELD_BY_CAPACITY[capacity]}): ` +
        (enough
          ? `about **${enough.expected}** attempts — roughly ${(enough.expected / 12).toFixed(1)} an hour, sustained.`
          : `more than ${rows[rows.length - 1]?.expected ?? '?'} attempts — beyond the range simulated.`)
    );
  }
  lines.push('');
  lines.push(
    '**What a pool returns.** Every minimum field is exactly break-even — the prize pool equals the minimum ' +
      "field's entries (D-E19, as R7-b was at 64) — so a pool sealing at its floor returns nothing. A full pool " +
      'returns the entries above its prize pool. The "mean return" column is the average over pools that ran.'
  );
  lines.push('');

  lines.push('## What was simulated');
  lines.push('');
  lines.push(`- Window **${DEADLINE / 3600} hours** (the fill deadline), tier ${TIER}: entry ${sol(price)} SOL.`);
  lines.push('');
  lines.push('| Pool size | Minimum field | Places paid | Prize pool | Full-pool return |');
  lines.push('|---|---|---|---|---|');
  for (const capacity of POOL_CAPACITIES) {
    const pool = prizePoolFor(LADDER_TABLES[capacity], price);
    lines.push(
      `| ${capacity} | ${MIN_FIELD_BY_CAPACITY[capacity]} | ${LADDER_TABLES[capacity].length} | ${sol(pool)} SOL | ` +
        `${sol(BigInt(capacity) * price - pool)} SOL |`
    );
  }
  lines.push('');
  lines.push(
    `- ${trials.toLocaleString('en-GB')} pools per size and arrival rate, Poisson arrivals, one seeded PRNG per ` +
      `(size, rate). Rates are ${RATE_MULTIPLES.map((k) => `${k}x`).join(', ')} the pool size.`
  );
  lines.push(`- Territory schedule version ${schedule.version} (${schedule.posture}), blocking: ${schedule.blocked.join(', ')}.`);
  lines.push('');

  lines.push('## The result');
  for (const capacity of POOL_CAPACITIES) {
    lines.push('');
    lines.push(`### ${capacity} players — minimum field ${MIN_FIELD_BY_CAPACITY[capacity]}`);
    lines.push('');
    lines.push(
      '| Mean attempts in 12h | Seals full | Seals at deadline | **Refunds** | Mean seated | Blocked by territory | Mean return per pool that ran |'
    );
    lines.push('|---|---|---|---|---|---|---|');
    for (const r of results.get(capacity) ?? []) {
      lines.push(
        `| ${r.expected} | ${pct(r.sealedAtCapacity, r.trials)} | ${pct(r.sealedAtDeadline, r.trials)} | ` +
          `**${pct(r.refunded, r.trials)}** | ${r.meanSeated.toFixed(1)} | ${r.meanTerritoryRejected.toFixed(1)} | ` +
          `${sol(r.meanReturnLamports)} SOL |`
      );
    }
  }
  lines.push('');
  lines.push('The arrival rate is **attempts**, before the territory gate — the "mean seated" column is what');
  lines.push('actually reaches a seat, and the gap between them is the blocked share.');
  lines.push('');

  lines.push('## The adversarial case');
  lines.push('');
  lines.push(
    'One entry short of the minimum field until the last minute, and the entry that would have saved it ' +
      'arrives one second after the deadline.'
  );
  lines.push('');
  lines.push('| Pool size | Outcome | Seated | Refunded | Rejected by the deadline |');
  lines.push('|---|---|---|---|---|');
  for (const capacity of POOL_CAPACITIES) {
    const a = replayPool(adversarialTimeline(MIN_FIELD_BY_CAPACITY[capacity]), schedule, { capacity });
    lines.push(`| ${capacity} | **${a.outcome}** | ${a.seated} | ${a.refunds} | ${a.rejectedByDeadline} |`);
  }
  lines.push('');
  lines.push('This is the case worth being uncomfortable about: it refunds, and it refunds for the');
  lines.push('sake of one second. It is also the case the rule is supposed to produce — the');
  lines.push('alternative is a clock that moves, and a clock that moves is a clock the operator');
  lines.push('chooses. Nothing here is a bug; it is the cost of the boundary being strict.');
  lines.push('');

  lines.push('## What this does not model');
  lines.push('');
  lines.push('- **Demand is exogenous, and each size runs alone.** A pool that refunds probably depresses the');
  lines.push('  next one, a fast fill probably raises it, and with several sizes open at once a player who');
  lines.push('  chooses one size is a player another size does not get. There is no feedback or split term,');
  lines.push('  so these are first-order estimates, not a forecast.');
  lines.push('- **Arrivals are independent.** Real entries cluster around whatever is posted, and');
  lines.push('  clustering RAISES the seal rate at a given mean by making the count less random.');
  lines.push('  The refund percentages above are therefore pessimistic.');
  lines.push('- **The country mix is a guess**, labelled as one. It exercises the territory gate;');
  lines.push('  it is not a claim about where demand will be.');
  lines.push('- **Sanctions screening is not simulated** — it rejects by wallet against live lists,');
  lines.push('  which a country code cannot stand in for.');
  lines.push('');
  return lines.join('\n');
}

/**
 * The sim RE-IMPLEMENTS the fill rule, which makes it the one place that can
 * drift from the program while every other lane stays green. These pin it, at
 * EVERY pool size, to the same boundaries `tests/litesvm/tests/fill_rule.rs`
 * pins on chain — the gate tests itself before it reports.
 */
function selfTest(schedule: TerritorySchedule): boolean {
  let pass = true;
  const ok = (name: string, cond: boolean) => {
    if (!cond) {
      console.error(`self-test FAILED: ${name}`);
      pass = false;
    }
  };
  const gb = (n: number, at: number): Arrival[] =>
    Array.from({ length: n }, (_, i) => ({ t_offset_secs: at, wallet: `t-${i}`, country: 'GB' }));
  const price = TIER_ENTRY_LAMPORTS[TIER];

  ok('the four Ladder sizes are simulated', POOL_CAPACITIES.join(',') === '8,16,32,64');
  for (const capacity of POOL_CAPACITIES) {
    const floor = MIN_FIELD_BY_CAPACITY[capacity];
    const at = (n: number, t = 100) => replayPool(gb(n, t), schedule, { capacity });
    const name = (s: string) => `${capacity} players: ${s}`;
    // The rule's own shape, which the report's "returns nothing at the floor" rests on.
    ok(name('the minimum field is break-even'), prizePoolFor(LADDER_TABLES[capacity], price) === BigInt(floor) * price);
    ok(name('the minimum field is above the places paid and within the size'), floor > LADDER_TABLES[capacity].length && floor <= capacity);
    // The floor, from both sides — the same boundary as S4/S5 on chain.
    ok(name('at the floor it seals'), at(floor).outcome === 'sealed_at_deadline');
    ok(name('one below the floor it refunds'), at(floor - 1).outcome === 'refunded');
    // Capacity seals early, and the surplus is refused rather than seated.
    const full = at(capacity + 5);
    ok(name('capacity seals'), full.outcome === 'sealed_at_capacity');
    ok(name('capacity is never exceeded'), full.seated === capacity);
    ok(name('the surplus is refused'), full.rejectedByDeadline === 5);
    ok(name('one short of capacity does not seal early'), at(capacity - 1).outcome === 'sealed_at_deadline');
    // The deadline is strict on both sides — S8.
    ok(name('an entry AT the deadline is accepted'), at(floor, DEADLINE).outcome === 'sealed_at_deadline');
    ok(name('an entry one second past it is not'), at(floor, DEADLINE + 1).seated === 0);
    // The territory gate runs before the seat is taken.
    const blocked = schedule.blocked[0];
    if (blocked !== undefined && !blocked.includes('-')) {
      const r = replayPool([...gb(floor, 100), { t_offset_secs: 100, wallet: 'x', country: blocked }], schedule, { capacity });
      ok(name('a blocked territory takes no seat'), r.seated === floor && r.rejectedByTerritory === 1);
    }
    // A refunded pool returns every entry it took.
    const short = at(floor - 1);
    ok(name('a refund returns every seat'), short.refunds === short.seated);
    // The adversarial fixture is one short and then one second late.
    ok(name('the adversarial case refunds'), replayPool(adversarialTimeline(floor), schedule, { capacity }).outcome === 'refunded');
  }
  return pass;
}

function main(): void {
  const schedule = loadTerritorySchedule(resolve(ROOT, 'config', 'territories.json'));
  if (!selfTest(schedule)) {
    console.error('fill-replay: the SIM is wrong, not the rule — fix it before reading the report.');
    process.exit(2);
  }
  if (process.argv.includes('--self-test')) {
    console.log('fill-replay: self-test passed');
    return;
  }
  const trials = 2000;
  const results = new Map<PoolCapacity, RateResult[]>();
  for (const capacity of POOL_CAPACITIES) results.set(capacity, sweep(schedule, capacity, trials));
  const md = report(schedule, results, trials);
  if (process.argv.includes('--write')) {
    const out = resolve(ROOT, 'docs', 'testing', 'FILL-SIMULATION.md');
    writeFileSync(out, `${md}\n`);
    console.log(`wrote ${out}`);
  } else {
    console.log(md);
  }
}

if (require.main === module) main();
