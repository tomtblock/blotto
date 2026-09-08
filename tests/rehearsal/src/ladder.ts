/**
 * The skill-evidence strategy ladder (D-A2, ratified 2026-08-27) — four
 * strategy classes of increasing deliberateness, used to measure how outcome
 * distributions differ by how considered an entrant's play is.
 *
 * These are DISTINCT from `strategies.ts` (the detection-oriented population
 * shapes of roadmap 5.1). The ladder exists for one purpose: run mixed
 * populations through the real crank at scale and publish the observed
 * outcome statistics per class (`docs/skill-evidence/REPORT.md`).
 *
 *   uniform    — 20/20/20/20/20 every battle: the zero-thought baseline.
 *                THIS IS THE APP'S ACTUAL DEFAULT. `app/src/battle/allocation.ts`
 *                exports `EVEN_SPLIT = [20, 20, 20, 20, 20]` and comments it
 *                "every screen opens here"; `battle/machine.ts` starts every one
 *                of the seven battles there. So a player who opens the flow,
 *                touches nothing and locks in produces EXACTLY a uniform
 *                entrant — which is what lets the exhibit say what happens if
 *                you leave the pentagon alone. `test/default-player.spec.ts`
 *                pins the two together so neither can drift in silence.
 *   random     — valid free-integer allocations with no intent behind them.
 *   heuristic  — a considered plan: concentrate on three stats per battle
 *                (a battle is won by taking three of five), steep split,
 *                small nonzero amounts on the remaining two.
 *   optimised  — the same three-stat family, tuned: slightly higher trio
 *                values funded from the off-stats, a per-entrant rotation
 *                schedule over the ten possible trios, seeded jitter to
 *                avoid exact mirror ties.
 *
 * Rationale and per-class documentation: tests/rehearsal/strategies/README.md.
 * Everything is deterministic per (class, seed): sha256 streams only — no
 * Date, no Math.random — so a run is reproducible from its base seed.
 */

import { createHash } from 'crypto';
import type { GeneratedEntrant } from './strategies';

export type LadderClass = 'uniform' | 'random' | 'heuristic' | 'optimised';
export const LADDER: readonly LadderClass[] = ['uniform', 'random', 'heuristic', 'optimised'];

const sha = (s: string) => createHash('sha256').update(s).digest();

/**
 * Runaway guard for the de-duplication loop — NOT a seat count.
 *
 * It bounds how many times a colliding entrant may be regenerated with a
 * bumped salt before we call it a bug. It read as a bare `64` until seat
 * counts became a parameter (n=52, D-E4's minimum field), where a reader
 * could easily mistake it for the field size. It is not: it is a ceiling on
 * retries, and it is unrelated to how many players are in the pool.
 */
const DEDUPE_SALT_LIMIT = 64;

/**
 * Field sizes the study runs. 64 is a full pool (CAPACITY); 52 is the
 * MINIMUM a pool may seal and run at (D-E4 — a pool whose deadline passes
 * with 52..63 entrants plays out rather than refunding).
 *
 * Both must divide by the number of ladder classes so a mixed field carries
 * equal numbers of each, leaving class membership uncorrelated with anything:
 * 64/4 = 16 and 52/4 = 13, both exact.
 */
export const FULL_FIELD = 64;
export const MIN_FIELD = 52;

/** All ten 3-of-5 stat trios, in a fixed order. */
const TRIOS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [0, 1, 3], [0, 1, 4], [0, 2, 3], [0, 2, 4],
  [0, 3, 4], [1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4],
];

function freeAllocation(seedStr: string): number[] {
  const h = sha(seedStr);
  const d = [0, 1, 2, 3]
    .map((k) => (h[k * 2] | (h[k * 2 + 1] << 8)) % 101)
    .sort((a, b) => a - b);
  return [d[0], d[1] - d[0], d[2] - d[1], d[3] - d[2], 100 - d[3]];
}

/**
 * Place `trioValues` on the trio's stats and `offValues` on the remaining
 * two, applying a seeded ±jitter that moves points BETWEEN trio stats so the
 * sum stays exactly 100 and mirror matchups do not tie stat-for-stat.
 *
 * The jitter model (documented per master prompt v2's A2 amendment): one
 * transfer of 0..jitterMax points from trio stat `from` to trio stat `to`
 * (skipped when from == to or the donor would drop to the off-stat level),
 * both drawn from sha256 of the jitter seed. Uniqueness within a class is
 * NOT left to jitter luck — `ensureUniqueWithinClass` below regenerates any
 * entrant whose full seven-battle set collides with an earlier same-class
 * entrant, bumping a salt deterministically until the set is unique.
 */
function concentrated(
  trio: readonly [number, number, number],
  trioValues: [number, number, number],
  offValues: [number, number],
  jitterSeed: string,
  jitterMax: number
): number[] {
  const values: [number, number, number] = [...trioValues];
  const h = sha(jitterSeed);
  const from = h[0] % 3;
  const to = h[1] % 3;
  const amount = h[2] % (jitterMax + 1);
  if (from !== to && values[from] - amount > offValues[0]) {
    values[from] -= amount;
    values[to] += amount;
  }
  const out = [0, 0, 0, 0, 0];
  trio.forEach((stat, i) => {
    out[stat] = values[i];
  });
  let off = 0;
  for (let stat = 0; stat < 5; stat++) {
    if (!trio.includes(stat)) out[stat] = offValues[off++];
  }
  return out;
}

/** One ladder entrant: seven valid battles + plausible deterministic
 * timings. `salt` (default 0) feeds the uniqueness fixup — a nonzero salt
 * reshapes the entrant's seeded streams without touching anyone else's. */
export function generateLadderEntrant(cls: LadderClass, seed: number, salt = 0): GeneratedEntrant {
  const battles: number[][] = [];
  const timingsMs: number[] = [];
  for (let k = 0; k < 7; k++) {
    const key = salt === 0 ? `ladder:${cls}:${seed}:${k}` : `ladder:${cls}:${seed}:${salt}:${k}`;
    switch (cls) {
      case 'uniform':
        battles.push([20, 20, 20, 20, 20]);
        timingsMs.push(900 + (sha(`t:${key}`)[0] % 700));
        break;
      case 'random':
        battles.push(freeAllocation(key));
        timingsMs.push(2500 + (sha(`t:${key}`)[0] % 9000));
        break;
      case 'heuristic': {
        // Trio re-picked per battle; steep 38/31/21 split, 6/4 off-stats.
        const trio = TRIOS[sha(key)[3] % TRIOS.length];
        battles.push(concentrated(trio, [38, 31, 21], [6, 4], `j:${key}`, 2));
        timingsMs.push(5000 + (sha(`t:${key}`)[0] % 7000));
        break;
      }
      case 'optimised': {
        // Per-entrant rotation over all ten trios; trio values one-upped
        // from the heuristic family, funded from the off-stats (4/3),
        // wider jitter so mirror matchups break asymmetrically.
        const start = sha(`rot:${cls}:${seed}:${salt}`)[0] % TRIOS.length;
        const trio = TRIOS[(start + k) % TRIOS.length];
        battles.push(concentrated(trio, [39, 32, 22], [4, 3], `j:${key}`, 3));
        timingsMs.push(3500 + (sha(`t:${key}`)[0] % 4000));
        break;
      }
    }
  }
  for (const b of battles) {
    const sum = b.reduce((a, v) => a + v, 0);
    if (sum !== 100 || b.some((v) => v < 0 || v > 100)) {
      throw new Error(`ladder class ${cls} produced an invalid allocation: ${b}`);
    }
  }
  return { strategy: cls, battles, timingsMs };
}

/**
 * Within-class uniqueness (master prompt v2, A2 amendment): no two entrants
 * of the same class in one pool may share the identical seven-battle
 * allocation set. Collisions are repaired deterministically — the LATER
 * entrant regenerates with a bumped salt until its set is fresh — so the
 * fixup is reproducible from the pool seed alone.
 *
 * The `uniform` class is EXEMPT, deliberately: 20/20/20/20/20 every battle
 * is the class's definition — it is the structural baseline, not a
 * strategy, and jittering it would destroy the property the appendix
 * documents (a flat split loses 3–2 to any three-stat concentration).
 * Recorded in the A2 step report as a judgement call.
 */
export function ensureUniqueWithinClass(
  entrants: GeneratedEntrant[],
  seedOf: (index: number) => number
): void {
  const seen = new Map<string, Set<string>>();
  entrants.forEach((e, i) => {
    if (e.strategy === 'uniform') return;
    let set = seen.get(e.strategy);
    if (!set) {
      set = new Set();
      seen.set(e.strategy, set);
    }
    let key = JSON.stringify(e.battles);
    let salt = 0;
    while (set.has(key)) {
      salt += 1;
      if (salt > DEDUPE_SALT_LIMIT) {
        throw new Error(`cannot de-duplicate ${e.strategy} entrant ${i}`);
      }
      const fresh = generateLadderEntrant(e.strategy as LadderClass, seedOf(i), salt);
      entrants[i] = fresh;
      e = fresh;
      key = JSON.stringify(e.battles);
    }
    set.add(key);
  });
}

/**
 * One study pool: `seats / 4` entrants of each class, seat order shuffled by
 * a seeded Fisher–Yates so class membership is uncorrelated with seat index
 * (seat order places the indivisible remainder of a tie split and the leaf
 * order — never who is paid — but the study removes even that correlation).
 *
 * `seats` defaults to a full pool. Pass MIN_FIELD to measure the shortest
 * field the rules allow: the claim being published is about the competition
 * as offered, and a pool that seals at 52 is as real as one that fills.
 */
export function ladderPopulation(
  poolSeed: number,
  seats: number = FULL_FIELD
): GeneratedEntrant[] {
  if (seats % LADDER.length !== 0) {
    throw new Error(
      `field of ${seats} does not divide by ${LADDER.length} classes — ` +
        'an unequal mixed field would correlate class with seat count'
    );
  }
  const per = seats / LADDER.length;
  const out: GeneratedEntrant[] = [];
  LADDER.forEach((cls, c) => {
    for (let i = 0; i < per; i++) {
      out.push(generateLadderEntrant(cls, poolSeed * 1000 + c * 100 + i));
    }
  });
  // Pre-shuffle, index i belongs to class floor(i/per), member i%per.
  ensureUniqueWithinClass(out, (i) => poolSeed * 1000 + Math.floor(i / per) * 100 + (i % per));
  for (let i = out.length - 1; i > 0; i--) {
    const h = sha(`shuffle:${poolSeed}:${i}`);
    const j = (h[0] | (h[1] << 8)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A HOMOGENEOUS-field pool (v2's A2 amendment): every seat from one class —
 * the "equally-skilled entrants" runs whose outcome spread the report
 * compares against the everyone-equal baseline (each seat expecting 1/`seats`
 * of the pot). Uniqueness within the class enforced as above (a homogeneous
 * uniform pool would be one n-way tie by definition and is not part of the
 * study).
 */
export function homogeneousPopulation(
  cls: LadderClass,
  poolSeed: number,
  seats: number = FULL_FIELD
): GeneratedEntrant[] {
  if (cls === 'uniform') {
    throw new Error(
      `a homogeneous uniform pool is a single ${seats}-way tie — not a study run`
    );
  }
  const out: GeneratedEntrant[] = [];
  for (let i = 0; i < seats; i++) {
    out.push(generateLadderEntrant(cls, poolSeed * 1000 + i));
  }
  ensureUniqueWithinClass(out, (i) => poolSeed * 1000 + i);
  return out;
}
