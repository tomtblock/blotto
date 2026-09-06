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

/** Drag stat `k` to `target`; returns the full rebalanced allocation. */
export function rebalance(alloc: Allocation, k: number, target: number): Allocation {
  if (!Number.isInteger(k) || k < 0 || k >= STATS) {
    throw new Error(`stat index out of range: ${k}`);
  }
  const t = Math.max(0, Math.min(ALLOCATION_SUM, Math.round(target)));
  const rest = ALLOCATION_SUM - t;

  const others: number[] = [];
  let othersTotal = 0;
  for (let i = 0; i < STATS; i++) {
    if (i !== k) {
      others.push(i);
      othersTotal += alloc[i];
    }
  }

  const next = [...alloc] as number[];
  next[k] = t;

  if (othersTotal <= 0) {
    // All four others are 0 (the dragged stat held everything): share the
    // remainder equally, largest-remainder on the equal quotas — i.e. the
    // first `rest % 4` in stat order take the extra unit.
    const base = Math.floor(rest / 4);
    let extra = rest - base * 4;
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
