/*
 * The run machine, pinned (v4 single-clock semantics + the rules that
 * survived from R9): the clock starts on the first dial touch and never
 * on payment; expiry locks deterministically — current screen as shown,
 * untouched screens at even split; timings are captured per screen; the
 * review confirms or nothing (§8.6).
 */
import { describe, expect, it } from 'vitest';
import { EVEN_SPLIT } from './allocation';
import { RUN_CLOCK_BUDGET_MS } from './run-clock';
import { BATTLES, initialState, reduce, type BattleFlowState } from './machine';

function begin(): BattleFlowState {
  return reduce(initialState(), { type: 'begin' });
}

describe('the run clock', () => {
  it('holds at the full budget until the first dial interaction', () => {
    let s = begin();
    s = reduce(s, { type: 'tick', ms: 60_000 }); // a slow wallet's minute
    expect(s.phase).toBe('battle');
    if (s.phase === 'battle') {
      expect(s.clockStarted).toBe(false);
      expect(s.remainingMs).toBe(RUN_CLOCK_BUDGET_MS);
      expect(s.screenElapsedMs).toBe(60_000); // detection still sees the time
    }
  });

  it('starts on the first dial touch, idempotently, and runs through advances', () => {
    let s = begin();
    s = reduce(s, { type: 'dial', stat: 0, target: 40 });
    s = reduce(s, { type: 'tick', ms: 5_000 });
    s = reduce(s, { type: 'lock_in' });
    s = reduce(s, { type: 'tick', ms: 5_000 }); // next screen, clock still running
    expect(s.phase).toBe('battle');
    if (s.phase === 'battle') {
      expect(s.clockStarted).toBe(true);
      expect(s.remainingMs).toBe(RUN_CLOCK_BUDGET_MS - 10_000);
    }
  });

  it('even split alone does not start the clock — it is the opening state', () => {
    let s = begin();
    s = reduce(s, { type: 'even_split' });
    s = reduce(s, { type: 'tick', ms: 1_000 });
    if (s.phase === 'battle') expect(s.clockStarted).toBe(false);
  });
});

describe('locking', () => {
  it('locks exactly what the dials show and advances with a fresh even screen', () => {
    let s = begin();
    s = reduce(s, { type: 'dial', stat: 0, target: 60 });
    s = reduce(s, { type: 'lock_in' });
    expect(s.phase).toBe('battle');
    if (s.phase === 'battle') {
      expect(s.screen).toBe(1);
      expect(s.locked[0]).toEqual([60, 10, 10, 10, 10]);
      expect(s.alloc).toEqual(EVEN_SPLIT);
    }
  });

  it('seven lock-ins reach review with seven battles and seven timings', () => {
    let s = begin();
    for (let k = 0; k < BATTLES; k++) {
      s = reduce(s, { type: 'dial', stat: k % 5, target: 30 + k });
      s = reduce(s, { type: 'tick', ms: 1_000 });
      s = reduce(s, { type: 'lock_in' });
    }
    expect(s.phase).toBe('review');
    if (s.phase === 'review') {
      expect(s.battles).toHaveLength(BATTLES);
      expect(s.timingsMs).toHaveLength(BATTLES);
      expect(s.expired).toBe(false);
      for (const b of s.battles) expect(b.reduce((a, v) => a + v, 0)).toBe(100);
    }
  });
});

describe('expiry (the one rule a player must be able to predict)', () => {
  it('locks the current battle as shown and every untouched battle at even split', () => {
    let s = begin();
    s = reduce(s, { type: 'dial', stat: 2, target: 70 }); // battle 1 shaped, clock running
    s = reduce(s, { type: 'lock_in' }); // battle 2 opens even
    s = reduce(s, { type: 'dial', stat: 4, target: 55 }); // battle 2 shaped
    s = reduce(s, { type: 'tick', ms: RUN_CLOCK_BUDGET_MS }); // the whole budget burns
    expect(s.phase).toBe('review');
    if (s.phase === 'review') {
      expect(s.expired).toBe(true);
      expect(s.battles[0][2]).toBe(70);
      expect(s.battles[1][4]).toBe(55);
      for (let k = 2; k < BATTLES; k++) expect(s.battles[k]).toEqual(EVEN_SPLIT);
      expect(s.timingsMs).toHaveLength(BATTLES);
      expect(s.timingsMs.slice(2).every((t) => t === 0)).toBe(true);
    }
  });

  it('never randomises anything on timeout — same inputs, same lock, always', () => {
    const runOnce = () => {
      let s = begin();
      s = reduce(s, { type: 'dial', stat: 1, target: 45 });
      s = reduce(s, { type: 'tick', ms: RUN_CLOCK_BUDGET_MS + 1 });
      return s;
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

describe('review and confirm', () => {
  it('review answers only to confirm — no way back into a battle (§8.6)', () => {
    let s = begin();
    for (let k = 0; k < BATTLES; k++) s = reduce(s, { type: 'lock_in' });
    const review = s;
    expect(reduce(review, { type: 'dial', stat: 0, target: 90 })).toBe(review);
    expect(reduce(review, { type: 'begin' })).toBe(review);
    s = reduce(review, { type: 'confirm' });
    expect(s.phase).toBe('confirmed');
    if (s.phase === 'confirmed') {
      expect(s.battles.every((b) => b.reduce((a, v) => a + v, 0) === 100)).toBe(true);
    }
  });
});
