/*
 * Battle-flow machine specs: the R9 timeout rule (lock-current, NEVER
 * randomise), timing capture, the seven-screen shape, and the second half
 * of the roadmap 3.4 property gate.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BATTLES,
  initialState,
  reduce,
  type BattleFlowEvent,
  type BattleFlowState,
} from './machine';
import { ALLOCATION_SUM, EVEN_SPLIT } from './allocation';

function run(state: BattleFlowState, events: BattleFlowEvent[]): BattleFlowState {
  return events.reduce(reduce, state);
}

describe('the battle flow machine', () => {
  it('opens every screen at the even split with a full timer', () => {
    const s = initialState(15);
    expect(s.phase).toBe('battle');
    if (s.phase === 'battle') {
      expect(s.display).toEqual(EVEN_SPLIT);
      expect(s.remainingMs).toBe(15_000);
    }
  });

  it('locks seven screens then reviews then confirms', () => {
    let s: BattleFlowState = initialState();
    for (let k = 0; k < BATTLES; k++) {
      s = run(s, [
        { type: 'drag', stat: k % 5, value: 60 },
        { type: 'tick', ms: 2000 },
        { type: 'lock_in' },
      ]);
    }
    expect(s.phase).toBe('review');
    if (s.phase === 'review') {
      expect(s.battles.length).toBe(BATTLES);
      for (const b of s.battles) {
        expect(b.reduce((a, v) => a + v, 0)).toBe(ALLOCATION_SUM);
      }
      expect(s.timingsMs).toEqual(Array(BATTLES).fill(2000));
    }
    s = reduce(s, { type: 'confirm' });
    expect(s.phase).toBe('confirmed');
  });

  it('R9: timeout locks EXACTLY the displayed integers — untouched screens lock the even split', () => {
    let s: BattleFlowState = initialState(15);
    // Sit through all seven screens without touching anything.
    for (let k = 0; k < BATTLES; k++) {
      s = reduce(s, { type: 'tick', ms: 15_000 });
    }
    expect(s.phase).toBe('review');
    if (s.phase === 'review') {
      for (const b of s.battles) expect(b).toEqual(EVEN_SPLIT);
      expect(s.timingsMs).toEqual(Array(BATTLES).fill(15_000));
    }
  });

  it('property: whatever the drags and ticks, timeout locks the last display', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            stat: fc.integer({ min: 0, max: 4 }),
            value: fc.double({ min: 0, max: 500, noNaN: true }),
            tickMs: fc.integer({ min: 1, max: 4000 }),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        (moves) => {
          let s: BattleFlowState = initialState(15);
          let lastDisplay = EVEN_SPLIT as readonly number[];
          for (const m of moves) {
            if (s.phase !== 'battle' || s.screen !== 0) break;
            s = reduce(s, { type: 'drag', stat: m.stat, value: m.value });
            if (s.phase === 'battle') lastDisplay = s.display;
            s = reduce(s, { type: 'tick', ms: m.tickMs });
          }
          // Force the timeout if screen 0 is still live.
          if (s.phase === 'battle' && s.screen === 0) {
            if (s.phase === 'battle') lastDisplay = s.display;
            s = reduce(s, { type: 'tick', ms: 20_000 });
          }
          // Screen 0's locked battle is exactly what was displayed.
          const locked =
            s.phase === 'battle' ? s.locked[0] : s.phase === 'review' ? s.battles[0] : null;
          expect(locked).toEqual(lastDisplay);
          expect(locked!.reduce((a, b) => a + b, 0)).toBe(ALLOCATION_SUM);
        }
      ),
      { numRuns: 2_000 }
    );
  });

  it('captures elapsed time per screen, capped at the budget', () => {
    let s: BattleFlowState = initialState(15);
    s = run(s, [
      { type: 'tick', ms: 1234 },
      { type: 'lock_in' },
      { type: 'tick', ms: 99_999 }, // blows straight past the budget
    ]);
    if (s.phase === 'battle') {
      expect(s.timingsMs[0]).toBe(1234);
      expect(s.timingsMs[1]).toBe(15_000); // capped
      expect(s.screen).toBe(2);
    } else {
      throw new Error('expected battle phase');
    }
  });

  it('even split resets mid-screen', () => {
    let s: BattleFlowState = initialState();
    s = run(s, [
      { type: 'drag', stat: 2, value: 90 },
      { type: 'even_split' },
    ]);
    if (s.phase === 'battle') expect(s.display).toEqual(EVEN_SPLIT);
  });

  it('is total: irrelevant events are no-ops', () => {
    const review = run(
      initialState(),
      Array(BATTLES).fill({ type: 'lock_in' } as const)
    );
    expect(reduce(review, { type: 'drag', stat: 0, value: 3 })).toBe(review);
    const confirmed = reduce(review, { type: 'confirm' });
    expect(reduce(confirmed, { type: 'lock_in' })).toBe(confirmed);
  });
});
