/**
 * Entrant strategies (roadmap 5.1): the four population shapes the rehearsal
 * fills pools with. Deterministic per (strategy, seed) so a rehearsal run is
 * reproducible; every strategy emits VALID allocations only — the harness
 * enters through the same client invariant as a human.
 *
 *   random            — spread free-integer allocations (the PID §4.3 ideal)
 *   consistent        — one considered shape, small per-battle variations
 *                       (the "skilled player" profile)
 *   clustered         — round numbers and reused shapes (the population the
 *                       radar design exists to AVOID; detection should note
 *                       these in shadow mode)
 *   scripted_uniform  — a bot: near-identical timings, low-entropy sets
 *                       (detection's timing signal should fire)
 */

import { createHash } from 'crypto';

export type StrategyName = 'random' | 'consistent' | 'clustered' | 'scripted_uniform';
export const STRATEGIES: readonly StrategyName[] = [
  'random',
  'consistent',
  'clustered',
  'scripted_uniform',
];

export interface GeneratedEntrant {
  strategy: StrategyName;
  battles: number[][];
  timingsMs: number[];
}

const sha = (s: string) => createHash('sha256').update(s).digest();

function freeAllocation(seedStr: string): number[] {
  const h = sha(seedStr);
  const d = [0, 1, 2, 3]
    .map((k) => (h[k * 2] | (h[k * 2 + 1] << 8)) % 101)
    .sort((a, b) => a - b);
  return [d[0], d[1] - d[0], d[2] - d[1], d[3] - d[2], 100 - d[3]];
}

function roundedAllocation(seedStr: string): number[] {
  // Multiples of ten summing to 100 — the clustered player's instinct.
  const h = sha(seedStr);
  const parts = [2, 2, 2, 2, 2];
  for (let step = 0; step < 4; step++) {
    const from = h[step] % 5;
    const to = h[step + 8] % 5;
    if (parts[from] > 0) {
      parts[from] -= 1;
      parts[to] += 1;
    }
  }
  return parts.map((p) => p * 10);
}

export function generateEntrant(strategy: StrategyName, seed: number): GeneratedEntrant {
  const battles: number[][] = [];
  const timingsMs: number[] = [];
  for (let k = 0; k < 7; k++) {
    const key = `${strategy}:${seed}:${k}`;
    switch (strategy) {
      case 'random':
        battles.push(freeAllocation(key));
        timingsMs.push(2500 + (sha(`t:${key}`)[0] % 9000) + (k === 0 ? 3000 : 0));
        break;
      case 'consistent': {
        // One base shape per entrant, nudged ±3 between battles.
        const base = freeAllocation(`base:${strategy}:${seed}`);
        const h = sha(key);
        const shape = [...base];
        const from = h[0] % 5;
        const to = h[1] % 5;
        const nudge = Math.min(shape[from], (h[2] % 3) + 1);
        shape[from] -= nudge;
        shape[to] += nudge;
        battles.push(shape);
        timingsMs.push(4000 + (sha(`t:${key}`)[0] % 6000) + (k === 0 ? 4000 : 0));
        break;
      }
      case 'clustered':
        battles.push(roundedAllocation(key));
        timingsMs.push(1500 + (sha(`t:${key}`)[0] % 4000) + (k === 0 ? 2000 : 0));
        break;
      case 'scripted_uniform': {
        const shape = freeAllocation(`bot:${seed}`); // the same set, every battle
        battles.push([...shape]);
        timingsMs.push(1400 + (sha(`t:${key}`)[0] % 40)); // machine-tight
        break;
      }
    }
  }
  for (const b of battles) {
    const sum = b.reduce((a, v) => a + v, 0);
    if (sum !== 100 || b.some((v) => v < 0)) {
      throw new Error(`strategy ${strategy} produced an invalid allocation: ${b}`);
    }
  }
  return { strategy, battles, timingsMs };
}

/** The rehearsal population mix for one pool (5.1): mostly random/consistent,
 * a clustered contingent, and one scripted bot per pool. */
export function poolPopulation(poolSeed: number): GeneratedEntrant[] {
  const out: GeneratedEntrant[] = [];
  for (let i = 0; i < 64; i++) {
    const strategy: StrategyName =
      i === 63 ? 'scripted_uniform' : i % 4 === 3 ? 'clustered' : i % 2 === 0 ? 'random' : 'consistent';
    out.push(generateEntrant(strategy, poolSeed * 1000 + i));
  }
  return out;
}
