/*
 * The dial-coupling rule (architect brief §1.1) — pure, integer-only.
 *
 * When the player drags stat `k` to target `t`, the other four stats
 * re-apportion the remaining budget PROPORTIONALLY TO THEIR CURRENT
 * VALUES, rounded with largest-remainder so the sum is exactly 100 after
 * every event, with no drift. A stat already at 0 stays at 0; a big stat
 * gives up (or gains) more. If all four others are 0, the remainder is
 * shared equally — the only principled split.
 *
 * Equivalence note, so review does not re-derive it: the brief phrases the
 * rule as "distribute −delta proportionally to current values, clamp,
 * repeat". For values ≥ 0 that is algebraically identical to re-scaling
 * the others to fill 100 − t in one step (new_i = old_i · rest / others),
 * which can produce nothing negative and nothing above the budget — so no
 * clamp iteration is needed, and the brief's worked example reproduces
 * exactly (see rebalance.test.ts).
 *
 * THE CLIENT INVARIANT (PID §4.6): nothing leaves this function except
 * five non-negative integers summing to exactly 100 in the fixed stat
 * order. The dragged stat always lands exactly on the (clamped) target —
 * the dial and its number can never disagree.
 */

import { ALLOCATION_SUM, STATS, type Allocation } from '@/battle/allocation';

/** Which stats are locked, by index. Five booleans in stat order. */
export type Locks = readonly boolean[];

export const NO_LOCKS: Locks = [false, false, false, false, false];

/**
 * The most a stat can be dragged to given the locks: everything the
 * UNLOCKED others hold could flow into it, and nothing a locked stat holds
 * can. With no locks this is 100. The dials read it as their range.
 */
export function maxTarget(alloc: Allocation, k: number, locks: Locks): number {
  let lockedSum = 0;
  for (let i = 0; i < STATS; i++) {
    if (i !== k && locks[i]) lockedSum += alloc[i];
  }
  return ALLOCATION_SUM - lockedSum;
}

/** Drag stat `k` to `target` with no locks; returns the full rebalanced
 * allocation. Kept as the unlocked case of `rebalanceLocked` so every
 * caller and test that predates locks reads unchanged. */
export function rebalance(alloc: Allocation, k: number, target: number): Allocation {
  return rebalanceLocked(alloc, k, target, NO_LOCKS);
}

/**
 * LOCKS (founder 2026-09-13): a locked stat keeps its value whatever the
 * other dials do. Dragging stat `k` re-apportions only the UNLOCKED others;
 * the locked ones are copied through untouched, and the target is capped at
 * what the unlocked others can give — so with Strength locked at 20 the
 * other four share exactly 80, and no dial can reach past it. A drag on a
 * locked stat is a no-op (the dial is disabled; this is the guard behind
 * it). With four stats locked the fifth is determined and cannot move.
 *
 * THE CLIENT INVARIANT is unchanged: five non-negative integers summing to
 * exactly 100 in the fixed stat order, after every event, always.
 */
export function rebalanceLocked(alloc: Allocation, k: number, target: number, locks: Locks): Allocation {
  if (!Number.isInteger(k) || k < 0 || k >= STATS) {
    throw new Error(`stat index out of range: ${k}`);
  }
  if (locks[k]) return alloc;

  const ceiling = maxTarget(alloc, k, locks);
  const t = Math.max(0, Math.min(ceiling, Math.round(target)));

  const others: number[] = [];
  let othersTotal = 0;
  for (let i = 0; i < STATS; i++) {
    if (i !== k && !locks[i]) {
      others.push(i);
      othersTotal += alloc[i];
    }
  }
  // Four locked: the fifth holds exactly what is left and cannot move.
  if (others.length === 0) return alloc;

  // What the unlocked others share: the budget less the target less every
  // locked value (the ceiling already accounts for the locked values).
  const rest = ceiling - t;

  const next = [...alloc] as number[];
  next[k] = t;

  if (othersTotal <= 0) {
    // Every unlocked other is 0 (the dragged stat held all of the free
    // budget): share the remainder equally, largest-remainder on the equal
    // quotas — the first `rest % n` in stat order take the extra unit.
    const n = others.length;
    const base = Math.floor(rest / n);
    let extra = rest - base * n;
    for (const i of others) {
      next[i] = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
    }
    return next as unknown as Allocation;
  }

  // Proportional quotas, then largest-remainder rounding to land the sum
  // exactly on `rest`. Ties break to the earlier stat (deterministic).
  const quotas = others.map((i) => (alloc[i] * rest) / othersTotal);
  const floors = quotas.map(Math.floor);
  let remainder = rest - floors.reduce((a, b) => a + b, 0);
  const order = quotas
    .map((q, j) => ({ j, frac: q - Math.floor(q) }))
    .sort((a, b) => b.frac - a.frac || a.j - b.j);
  for (const { j } of order) {
    if (remainder <= 0) break;
    floors[j] += 1;
    remainder--;
  }
  others.forEach((i, j) => {
    next[i] = floors[j];
  });
  return next as unknown as Allocation;
}
