/**
 * Fill-rule replay (founder instruction 2026-09-12 §5.2).
 *
 * The question this exists to answer, in the founder's words: *"how often,
 * on realistic arrival curves, does the 40-at-12h rule seal vs refund — I
 * will use it to decide whether the numbers stay."*
 *
 * So it is not a test. It is a measurement, and its output is a markdown
 * report (`docs/testing/FILL-SIMULATION.md`).
 *
 * WHAT IT MODELS. Entries arriving at a pool as a Poisson process over the
 * 12-hour window, run through the two gates that can stop one — the
 * territory schedule and the pool's capacity — and then through the fill
 * state machine exactly as `seal_at_deadline` and `trigger_refund` define
 * it: seal at 64 whenever the 64th lands, seal at the deadline at or above
 * the floor, refund below it.
 *
 * WHAT IT DOES NOT MODEL, so nobody reads more into it than is there:
 *   - demand is exogenous. A pool that refunds probably depresses the next
 *     pool's arrivals, and a pool that fills fast probably raises them;
 *     nothing here has a feedback term, so the seal rates below are a
 *     first-order estimate, not a forecast.
 *   - arrivals are independent and uniform in rate. Real entries will
 *     cluster around whatever is posted, and clustering RAISES the seal rate
 *     at a given mean by making the count less like a Poisson draw.
 *   - the sanctions screening is not simulated: it rejects by wallet
 *     against live lists, which a country code cannot stand in for.
 *
 * Deterministic: one seeded PRNG, so a re-run reproduces the report and a
 * change to the rule shows up as a diff.
 *
 * Run: npx tsx scripts/sim/fill-replay.ts [--write]
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  CAPACITY,
  MIN_SEATS,
  DEFAULT_FILL_DEADLINE_SECS,
  TIER_ENTRY_LAMPORTS,
  TIER_POT_LAMPORTS,
} from '../../backend/scoring/src/prizes';
import {
  loadTerritorySchedule,
  territoryAllowed,
  type TerritorySchedule,
} from '../../backend/packet/src/territories';

const ROOT = resolve(__dirname, '..', '..');
const DEADLINE = Number(DEFAULT_FILL_DEADLINE_SECS);
const CAP = Number(CAPACITY);
const FLOOR = Number(MIN_SEATS);
/** The floor this change replaced, reported beside the new one so the
 * comparison the founder is making is on the same page as the numbers. */
const PREVIOUS_FLOOR = 52;

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
  seated: number;
  potLamports: bigint;
  /** Entries returned in full, when the pool refunded. */
  refunds: number;
  rejectedByTerritory: number;
  rejectedByDeadline: number;
  /** Seconds from open to the seal, or the deadline when it ran out. */
  concludedAtSecs: number;
}

/**
 * One pool, from a timeline. The state machine here mirrors the program's:
 * `register` accepts while `now <= fill_deadline` and `entrants < CAPACITY`;
 * the 64th seals immediately; past the deadline the field decides the fork.
 */
export function replayPool(
  arrivals: readonly Arrival[],
  schedule: TerritorySchedule,
  opts: { floor?: number; tier?: number } = {}
): PoolOutcome {
  const floor = opts.floor ?? FLOOR;
  const tier = opts.tier ?? 0;
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
    if (seated === CAP) sealedAt = a.t_offset_secs;
  }

  const potLamports = TIER_POT_LAMPORTS[tier];
  if (sealedAt !== null) {
    return {
      outcome: 'sealed_at_capacity',
      seated,
      potLamports,
      refunds: 0,
      rejectedByTerritory,
      rejectedByDeadline,
      concludedAtSecs: sealedAt,
    };
  }
  if (seated >= floor) {
    return {
      outcome: 'sealed_at_deadline',
      seated,
      potLamports,
      refunds: 0,
      rejectedByTerritory,
      rejectedByDeadline,
      concludedAtSecs: DEADLINE,
    };
  }
  return {
    outcome: 'refunded',
    seated,
    potLamports,
    refunds: seated,
    rejectedByTerritory,
    rejectedByDeadline,
    concludedAtSecs: DEADLINE,
  };
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
  ['AU', 6], // blocked
  ['IN', 4], // blocked under schedule v3
  ['SG', 2], // blocked under schedule v3
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
export function poissonTimeline(
  expected: number,
  rnd: () => number,
  window = DEADLINE
): Arrival[] {
  const out: Arrival[] = [];
  const mean = window / expected;
  let t = 0;
  let i = 0;
  for (;;) {
    t += -Math.log(1 - rnd()) * mean;
    // A pool cannot take more than capacity, but the TIMELINE can carry more
    // than that: the surplus is what `rejectedByDeadline` counts once the
    // pool has closed, and it is real demand the next pool inherits.
    if (t > window * 1.5) break;
    out.push({ t_offset_secs: Math.round(t), wallet: `sim-${i++}`, country: pickCountry(rnd) });
  }
  return out;
}

/** §5.2 fixture 3: the adversarial case — one seat short until the last
 * minute, and the seat that would have saved it arrives one second late. */
export function adversarialTimeline(floor = FLOOR): Arrival[] {
  const out: Arrival[] = [];
  for (let i = 0; i < floor - 1; i++) {
    out.push({
      t_offset_secs: DEADLINE - 60 + Math.floor(i / 10),
      wallet: `edge-${i}`,
      country: 'GB',
    });
  }
  out.push({ t_offset_secs: DEADLINE + 1, wallet: 'edge-late', country: 'GB' });
  return out;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

interface RateResult {
  expected: number;
  trials: number;
  sealedAtCapacity: number;
  sealedAtDeadline: number;
  refunded: number;
  /** The same trials judged against the floor this change replaced. */
  refundedUnderPrevious: number;
  meanSeated: number;
  meanTerritoryRejected: number;
  /** Treasury result per pool, in lamports, averaged over trials that ran. */
  meanReturnLamports: bigint;
}

function sweep(schedule: TerritorySchedule, rates: readonly number[], trials: number): RateResult[] {
  const price = TIER_ENTRY_LAMPORTS[0];
  const pot = TIER_POT_LAMPORTS[0];
  return rates.map((expected) => {
    const rnd = mulberry32(0x5eed + Math.round(expected * 1000));
    let sealedAtCapacity = 0;
    let sealedAtDeadline = 0;
    let refunded = 0;
    let refundedUnderPrevious = 0;
    let seatedTotal = 0;
    let territoryTotal = 0;
    let returnTotal = 0n;
    for (let i = 0; i < trials; i++) {
      const timeline = poissonTimeline(expected, rnd);
      const r = replayPool(timeline, schedule);
      seatedTotal += r.seated;
      territoryTotal += r.rejectedByTerritory;
      if (r.outcome === 'sealed_at_capacity') sealedAtCapacity++;
      else if (r.outcome === 'sealed_at_deadline') sealedAtDeadline++;
      else refunded++;
      // A pool that plays returns its field's entries less the pot; one that
      // refunds returns nothing and costs nothing (the pot goes back).
      if (r.outcome !== 'refunded') returnTotal += BigInt(r.seated) * price - pot;
      // The same arrivals under the old floor.
      const prev = replayPool(timeline, schedule, { floor: PREVIOUS_FLOOR });
      if (prev.outcome === 'refunded') refundedUnderPrevious++;
    }
    const ran = sealedAtCapacity + sealedAtDeadline;
    return {
      expected,
      trials,
      sealedAtCapacity,
      sealedAtDeadline,
      refunded,
      refundedUnderPrevious,
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

function report(schedule: TerritorySchedule, rows: RateResult[], trials: number): string {
  const blocked = schedule.blocked.join(', ');
  const adversarial = replayPool(adversarialTimeline(), schedule);
  const adversarialPrev = replayPool(adversarialTimeline(), schedule, { floor: PREVIOUS_FLOOR });

  const lines: string[] = [];
  lines.push('# Fill-rule simulation — does 40-at-12h seal often enough?');
  lines.push('');
  lines.push('**Generated by `scripts/sim/fill-replay.ts`. Do not edit by hand — re-run it.**');
  lines.push('');
  lines.push(
    `It answers one question: on realistic arrival curves, how often does the 40-at-12h ` +
      `rule seal a pool rather than refund it?`
  );
  lines.push('');

  // The lead finding, computed rather than written: the founder asked a
  // question and should not have to read a table to get the answer.
  const midRates = rows.filter((r) => r.expected >= 40 && r.expected <= 55);
  const avgNew = midRates.reduce((a, r) => a + r.refunded / r.trials, 0) / midRates.length;
  const avgOld = midRates.reduce((a, r) => a + r.refundedUnderPrevious / r.trials, 0) / midRates.length;
  const breakEven = rows.find((r) => r.refunded / r.trials <= 0.1);
  lines.push('## What it says');
  lines.push('');
  {
    const total = COUNTRY_MIX.reduce((a, [, w]) => a + w, 0);
    const blockedWeight = COUNTRY_MIX.filter(([c]) => !territoryAllowed(schedule, c, null)).reduce(
      (a, [, w]) => a + w,
      0,
    );
    const pct = Math.round((blockedWeight / total) * 100);
    lines.push(
      `**Read this first.** The simulated arrivals follow an assumed country mix (below), and under ` +
        `territory schedule version ${schedule.version} **${pct}% of that mix is blocked** at the entry gate. ` +
        'The figures therefore depend heavily on that assumption; the "Mean seated" column is what ' +
        'actually reaches a seat.',
    );
    lines.push('');
  }
  lines.push(
    `**Floor 40 against floor 52.** Averaged over ` +
      `${midRates[0].expected}-${midRates[midRates.length - 1].expected} attempts in 12 hours, ` +
      `the 40-seat floor refunds **${(100 * avgNew).toFixed(0)}%** of pools; the old 52-seat ` +
      `floor refunded **${(100 * avgOld).toFixed(0)}%** on the same arrivals. The full curve is ` +
      `in the table below.`
  );
  lines.push('');
  if (breakEven) {
    lines.push(
      `**The rate you need.** A pool refunds less than one time in ten once attempts reach about ` +
        `**${breakEven.expected} in 12 hours** — roughly ${(breakEven.expected / 12).toFixed(1)} an hour, ` +
        `sustained. Below that, refunds are common; the rule is working, the audience is not there yet.`
    );
    lines.push('');
  }
  lines.push(
    `**What a pool returns.** A pool sealing at the floor returns nothing — by design, ` +
      `because the prize pool equals forty entries (decision R7-b). The "mean return" column is the average over pools ` +
      `that ran, and it stays well under the 2.4 SOL of a full field until arrivals are ` +
      `comfortably above capacity, because a pool that seals at the deadline usually seals ` +
      `near the floor rather than near 64.`
  );
  lines.push('');
  lines.push('## What was simulated');
  lines.push('');
  lines.push(`- Floor **${FLOOR}** seats (R7-b), capacity **${CAP}**, window **${DEADLINE / 3600} hours**.`);
  lines.push(`- Tier 0: entry ${sol(TIER_ENTRY_LAMPORTS[0])} SOL, prize pool ${sol(TIER_POT_LAMPORTS[0])} SOL.`);
  lines.push(`- ${trials.toLocaleString()} pools per arrival rate, Poisson arrivals, one seeded PRNG.`);
  lines.push(`- Territory schedule version ${schedule.version} (${schedule.posture}), blocking: ${blocked}.`);
  lines.push('');
  lines.push('## The result');
  lines.push('');
  lines.push(
    '| Mean arrivals in 12h | Seals at 64 | Seals at deadline | **Refunds** | Refunds at the old 52-seat floor | Mean seated | Blocked by territory | Mean return per pool that ran |'
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(
      `| ${r.expected} | ${pct(r.sealedAtCapacity, r.trials)} | ${pct(r.sealedAtDeadline, r.trials)} | ` +
        `**${pct(r.refunded, r.trials)}** | ${pct(r.refundedUnderPrevious, r.trials)} | ` +
        `${r.meanSeated.toFixed(1)} | ${r.meanTerritoryRejected.toFixed(1)} | ${sol(r.meanReturnLamports)} SOL |`
    );
  }
  lines.push('');
  lines.push('Note the arrival rate is **attempts**, before the territory gate — the "mean seated"');
  lines.push('column is what actually reaches a seat, and the gap between them is the blocked share.');
  lines.push('');
  lines.push('## The adversarial case');
  lines.push('');
  lines.push(
    `One seat short of the floor until the last minute, and the seat that would have saved it ` +
      `arrives one second after the deadline.`
  );
  lines.push('');
  lines.push(`- Outcome: **${adversarial.outcome}**, ${adversarial.seated} seated, ${adversarial.refunds} refunded.`);
  lines.push(`- Rejected by the deadline: ${adversarial.rejectedByDeadline}.`);
  lines.push(`- Under the old 52-seat floor the same timeline: **${adversarialPrev.outcome}**.`);
  lines.push('');
  lines.push('This is the case worth being uncomfortable about: it refunds, and it refunds for the');
  lines.push('sake of one second. It is also the case the rule is supposed to produce — the');
  lines.push('alternative is a clock that moves, and a clock that moves is a clock the operator');
  lines.push('chooses. Nothing here is a bug; it is the cost of the boundary being strict.');
  lines.push('');
  lines.push('## What this does not model');
  lines.push('');
  lines.push('- **Demand is exogenous.** A pool that refunds probably depresses the next one, and a');
  lines.push('  pool that fills fast probably raises it. There is no feedback term, so these are');
  lines.push('  first-order estimates, not a forecast.');
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
 * drift from the program while every other lane stays green. These pin it to
 * the same boundaries `tests/litesvm/tests/fill_rule.rs` pins on chain — the
 * same house standard as the check scripts: the gate tests itself before it
 * reports.
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
    Array.from({ length: n }, (_, i) => ({
      t_offset_secs: at,
      wallet: `t-${i}`,
      country: 'GB',
    }));

  // The floor, from both sides — the same boundary as S4/S5 on chain.
  ok('at the floor it seals', replayPool(gb(FLOOR, 100), schedule).outcome === 'sealed_at_deadline');
  ok(
    'one below the floor it refunds',
    replayPool(gb(FLOOR - 1, 100), schedule).outcome === 'refunded'
  );
  // Capacity seals early, and the surplus is refused rather than seated.
  const full = replayPool(gb(CAP + 5, 100), schedule);
  ok('capacity seals', full.outcome === 'sealed_at_capacity');
  ok('capacity is never exceeded', full.seated === CAP);
  ok('the surplus is refused', full.rejectedByDeadline === 5);
  // The deadline is strict on both sides — S8.
  ok(
    'an entry AT the deadline is accepted',
    replayPool(gb(FLOOR, DEADLINE), schedule).outcome === 'sealed_at_deadline'
  );
  ok(
    'an entry one second past it is not',
    replayPool(gb(FLOOR, DEADLINE + 1), schedule).seated === 0
  );
  // The territory gate runs before the seat is taken.
  const blocked = schedule.blocked[0];
  if (blocked !== undefined && !blocked.includes('-')) {
    const r = replayPool(
      [...gb(FLOOR, 100), { t_offset_secs: 100, wallet: 'x', country: blocked }],
      schedule
    );
    ok('a blocked territory takes no seat', r.seated === FLOOR && r.rejectedByTerritory === 1);
  }
  // A refunded pool returns every entry it took.
  const short = replayPool(gb(FLOOR - 1, 100), schedule);
  ok('a refund returns every seat', short.refunds === short.seated);
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
  const rates = [30, 40, 45, 50, 55, 64, 80, 100];
  const trials = 2000;
  const rows = sweep(schedule, rates, trials);
  const md = report(schedule, rows, trials);
  if (process.argv.includes('--write')) {
    const out = resolve(ROOT, 'docs', 'testing', 'FILL-SIMULATION.md');
    writeFileSync(out, `${md}\n`);
    console.log(`wrote ${out}`);
  } else {
    console.log(md);
  }
}

if (require.main === module) main();
