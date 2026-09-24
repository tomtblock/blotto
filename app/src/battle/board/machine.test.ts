/*
 * The board machine, pinned: the clock starts on the first point and on
 * nothing else; placing never overshoots a field (easy) or the board
 * (hard); locks obey the two rules; submit and expiry apply the
 * lock-aware spread; review can resume with the PLACED board.
 *
 * The property test at the end is the load-bearing one: 10,000 random
 * event sequences per mode, every one ending on a legal entry. It is the
 * board's half of the allocation invariant (the other half is
 * `encodeBattleSet` at submission — backend/scoring/src/allocation.ts).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { STATS } from '../allocation';
import { BOARD_CLOCK_BUDGET_MS, EASY_PER_FIELD, FIELDS, HARD_TOTAL } from './mode';
import {
  type BoardEvent,
  type BoardMode,
  type BoardState,
  boardComplete,
  boardRemaining,
  canLock,
  fieldFull,
  fieldRemaining,
  initialBoardState,
  reduceBoard,
} from './machine';
import { fieldSum, gridSum } from './spread';

function begin(mode: BoardMode = 'easy'): BoardState {
  return reduceBoard(initialBoardState(mode), { type: 'begin' });
}
function run(mode: BoardMode, events: BoardEvent[]): BoardState {
  let s = begin(mode);
  for (const e of events) s = reduceBoard(s, e);
  return s;
}
function play(s: BoardState) {
  if (s.phase !== 'play') throw new Error(`expected play, got ${s.phase}`);
  return s;
}

describe('the clock', () => {
  it('holds at the full budget until the first point — looking around costs nothing', () => {
    const s = play(run('easy', [{ type: 'select', stat: 3 }, { type: 'tick', ms: 120_000 }]));
    expect(s.clockStarted).toBe(false);
    expect(s.remainingMs).toBe(BOARD_CLOCK_BUDGET_MS);
  });

  it('starts on the first point placed and runs from there', () => {
    const s = play(
      run('easy', [
        { type: 'place', field: 0, stat: 0, delta: 1 },
        { type: 'tick', ms: 5_000 },
        { type: 'tick', ms: 5_000 },
      ])
    );
    expect(s.clockStarted).toBe(true);
    expect(s.remainingMs).toBe(BOARD_CLOCK_BUDGET_MS - 10_000);
  });

  it('a no-op placement (taking back from an empty cell) does not start it', () => {
    const s = play(run('easy', [{ type: 'place', field: 0, stat: 0, delta: -5 }, { type: 'tick', ms: 1_000 }]));
    expect(s.clockStarted).toBe(false);
  });

  it('is three minutes', () => {
    expect(BOARD_CLOCK_BUDGET_MS).toBe(180_000);
  });
});

describe('placing (easy)', () => {
  it('pours one point at a time and never past the field', () => {
    const events: BoardEvent[] = [];
    for (let i = 0; i < 120; i++) events.push({ type: 'place', field: 2, stat: 1, delta: 1 });
    const s = play(run('easy', events));
    expect(s.grid[2][1]).toBe(EASY_PER_FIELD);
    expect(fieldFull(s, 2)).toBe(true);
    expect(fieldRemaining(s, 2)).toBe(0);
  });

  it('a step that would overshoot is clipped to what is left', () => {
    const s = play(run('easy', [{ type: 'place', field: 0, stat: 0, delta: 95 }, { type: 'place', field: 0, stat: 4, delta: 20 }]));
    expect(s.grid[0]).toEqual([95, 0, 0, 0, 5]);
  });

  it('a step down never goes below zero', () => {
    const s = play(run('easy', [{ type: 'place', field: 0, stat: 0, delta: 3 }, { type: 'place', field: 0, stat: 0, delta: -20 }]));
    expect(s.grid[0][0]).toBe(0);
  });

  it('fill_field sends everything left on the field to one stat; send_back empties one stat', () => {
    let s = play(run('easy', [{ type: 'place', field: 5, stat: 2, delta: 30 }, { type: 'fill_field', field: 5, stat: 3 }]));
    expect(s.grid[5]).toEqual([0, 0, 30, 70, 0]);
    s = play(reduceBoard(s, { type: 'send_back', field: 5, stat: 3 }));
    expect(s.grid[5]).toEqual([0, 0, 30, 0, 0]);
  });

  it('stamps the field\'s last-change time in run milliseconds', () => {
    const s = play(
      run('easy', [
        { type: 'place', field: 0, stat: 0, delta: 1 }, // t = 0
        { type: 'tick', ms: 4_000 },
        { type: 'place', field: 3, stat: 1, delta: 1 }, // t = 4000
        { type: 'tick', ms: 2_500 },
        { type: 'place', field: 0, stat: 0, delta: 1 }, // t = 6500
      ])
    );
    expect(s.lastChangeMs[0]).toBe(6_500);
    expect(s.lastChangeMs[3]).toBe(4_000);
    expect(s.lastChangeMs[1]).toBe(0);
  });
});

describe('placing (hard)', () => {
  it('a single field may hold the whole 700', () => {
    const s = play(run('hard', [{ type: 'fill_field', field: 1, stat: 0 }]));
    expect(s.grid[1][0]).toBe(HARD_TOTAL);
    expect(boardRemaining(s)).toBe(0);
    expect(boardComplete(s)).toBe(true);
  });

  it('the cap is the board\'s remainder, not the field\'s', () => {
    const s = play(run('hard', [{ type: 'place', field: 0, stat: 0, delta: 650 }, { type: 'place', field: 6, stat: 4, delta: 100 }]));
    expect(s.grid[6][4]).toBe(50);
    expect(gridSum(s.grid)).toBe(HARD_TOTAL);
  });

  it('fieldRemaining reads the board\'s remainder in hard mode', () => {
    const s = play(run('hard', [{ type: 'place', field: 0, stat: 0, delta: 100 }]));
    expect(fieldRemaining(s, 3)).toBe(600);
  });
});

describe('locking', () => {
  it('easy: a field locks only when it is Full', () => {
    let s = play(run('easy', [{ type: 'place', field: 0, stat: 0, delta: 60 }]));
    expect(canLock(s, 0)).toBe(false);
    s = play(reduceBoard(s, { type: 'lock', field: 0 }));
    expect(s.locked[0]).toBe(false);
    s = play(reduceBoard(s, { type: 'fill_field', field: 0, stat: 1 }));
    expect(canLock(s, 0)).toBe(true);
    s = play(reduceBoard(s, { type: 'lock', field: 0 }));
    expect(s.locked[0]).toBe(true);
  });

  it('a locked field takes no points and gives none back; unlock restores it', () => {
    let s = play(run('easy', [{ type: 'fill_field', field: 0, stat: 0 }, { type: 'lock', field: 0 }]));
    s = play(reduceBoard(s, { type: 'place', field: 0, stat: 0, delta: -10 }));
    s = play(reduceBoard(s, { type: 'send_back', field: 0, stat: 0 }));
    expect(s.grid[0][0]).toBe(100);
    s = play(reduceBoard(s, { type: 'unlock', field: 0 }));
    s = play(reduceBoard(s, { type: 'send_back', field: 0, stat: 0 }));
    expect(s.grid[0][0]).toBe(0);
  });

  it('hard: any count locks — except the last open field while points remain', () => {
    let s = play(run('hard', [{ type: 'place', field: 0, stat: 0, delta: 10 }]));
    for (let f = 0; f < FIELDS - 1; f++) s = play(reduceBoard(s, { type: 'lock', field: f }));
    expect(s.locked.filter(Boolean)).toHaveLength(6);
    expect(canLock(s, 6)).toBe(false);
    s = play(reduceBoard(s, { type: 'lock', field: 6 }));
    expect(s.locked[6]).toBe(false);
    // Place the rest, and the last lock is allowed.
    s = play(reduceBoard(s, { type: 'fill_field', field: 6, stat: 2 }));
    expect(canLock(s, 6)).toBe(true);
  });

  it('locking never starts the clock by itself', () => {
    // Only reachable after a point exists, but the lock event itself must not touch the clock.
    const s = play(run('easy', [{ type: 'lock', field: 0 }, { type: 'tick', ms: 1_000 }]));
    expect(s.clockStarted).toBe(false);
  });
});

describe('submit, expiry and review', () => {
  it('submit before any point is placed does nothing', () => {
    expect(run('easy', [{ type: 'submit' }]).phase).toBe('play');
  });

  it('submit spreads the unplaced points and keeps the placed board for resume', () => {
    const s = run('easy', [
      { type: 'place', field: 1, stat: 3, delta: 74 },
      { type: 'tick', ms: 30_000 },
      { type: 'submit' },
    ]);
    expect(s.phase).toBe('review');
    if (s.phase !== 'review') return;
    expect(s.expired).toBe(false);
    expect(s.remainingMs).toBe(BOARD_CLOCK_BUDGET_MS - 30_000);
    expect(s.battles[1]).toEqual([6, 5, 5, 79, 5]);
    expect(s.placed[1]).toEqual([0, 0, 0, 74, 0]);
    for (const row of s.battles) expect(fieldSum(row)).toBe(EASY_PER_FIELD);
    const back = reduceBoard(s, { type: 'resume' });
    expect(back.phase).toBe('play');
    if (back.phase === 'play') {
      expect(back.grid[1]).toEqual([0, 0, 0, 74, 0]);
      expect(back.remainingMs).toBe(BOARD_CLOCK_BUDGET_MS - 30_000);
      expect(back.clockStarted).toBe(true);
    }
  });

  it('expiry locks the board: review with expired=true, no resume', () => {
    const s = run('hard', [
      { type: 'place', field: 0, stat: 0, delta: 1 },
      { type: 'tick', ms: BOARD_CLOCK_BUDGET_MS },
    ]);
    expect(s.phase).toBe('review');
    if (s.phase !== 'review') return;
    expect(s.expired).toBe(true);
    expect(s.remainingMs).toBe(0);
    expect(gridSum(s.battles)).toBe(HARD_TOTAL);
    expect(reduceBoard(s, { type: 'resume' }).phase).toBe('review');
  });

  it('a locked field survives the spread untouched', () => {
    const s = run('hard', [
      { type: 'place', field: 2, stat: 4, delta: 33 },
      { type: 'lock', field: 2 },
      { type: 'tick', ms: BOARD_CLOCK_BUDGET_MS },
    ]);
    if (s.phase !== 'review') throw new Error(s.phase);
    expect(s.battles[2]).toEqual([0, 0, 0, 0, 33]);
    expect(s.locked[2]).toBe(true);
  });

  it('confirm freezes the entry', () => {
    const s = run('easy', [{ type: 'place', field: 0, stat: 0, delta: 1 }, { type: 'submit' }, { type: 'confirm' }]);
    expect(s.phase).toBe('confirmed');
    if (s.phase === 'confirmed') expect(s.battles).toHaveLength(FIELDS);
  });
});

/* ——— The property: any sequence of events ends on a legal entry. ——— */

const fieldArb = fc.integer({ min: -1, max: FIELDS });
const statArb = fc.integer({ min: -1, max: STATS });
const eventArb: fc.Arbitrary<BoardEvent> = fc.oneof(
  { weight: 12, arbitrary: fc.record({ type: fc.constant('place' as const), field: fieldArb, stat: statArb, delta: fc.integer({ min: -40, max: 40 }) }) },
  { weight: 30, arbitrary: fc.record({ type: fc.constant('place' as const), field: fieldArb, stat: statArb, delta: fc.constant(1) }) },
  { weight: 3, arbitrary: fc.record({ type: fc.constant('fill_field' as const), field: fieldArb, stat: statArb }) },
  { weight: 3, arbitrary: fc.record({ type: fc.constant('send_back' as const), field: fieldArb, stat: statArb }) },
  { weight: 4, arbitrary: fc.record({ type: fc.constant('lock' as const), field: fieldArb }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant('unlock' as const), field: fieldArb }) },
  { weight: 3, arbitrary: fc.record({ type: fc.constant('select' as const), stat: fc.oneof(fc.constant(null), statArb) }) },
  { weight: 6, arbitrary: fc.record({ type: fc.constant('tick' as const), ms: fc.integer({ min: -10, max: 20_000 }) }) },
  { weight: 1, arbitrary: fc.constant({ type: 'submit' as const }) },
  { weight: 1, arbitrary: fc.constant({ type: 'resume' as const }) }
);

function check(cond: boolean, what: string): void {
  if (!cond) throw new Error(what);
}
function same(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function legalEntry(mode: BoardMode, battles: readonly (readonly number[])[]) {
  check(battles.length === FIELDS, 'battles length');
  for (const row of battles) {
    check(row.length === STATS, 'row length');
    for (const v of row) check(Number.isInteger(v) && v >= 0, 'entry cell');
    if (mode === 'easy') check(fieldSum(row) === EASY_PER_FIELD, 'easy field != 100');
  }
  if (mode === 'hard') check(gridSum(battles) === HARD_TOTAL, 'hard total != 700');
}

for (const mode of ['easy', 'hard'] as const) {
  describe(`property — ${mode}`, () => {
    it('10,000 random runs: every state legal, every entry legal, locks and the clock honoured', () => {
      fc.assert(
        fc.property(fc.array(eventArb, { minLength: 1, maxLength: 120 }), (events) => {
          let s = begin(mode);
          let started = false;
          for (const e of events) {
            const prev = s;
            s = reduceBoard(s, e);
            if (s.phase === 'play') {
              // In-play invariants: cells non-negative integers; easy fields ≤ 100; hard board ≤ 700.
              for (const row of s.grid) for (const v of row) check(Number.isInteger(v) && v >= 0, 'cell');
              if (mode === 'easy') for (const row of s.grid) check(fieldSum(row) <= EASY_PER_FIELD, 'field over 100');
              else check(gridSum(s.grid) <= HARD_TOTAL, 'board over 700');
              // A locked field never changes.
              if (prev.phase === 'play') {
                for (let f = 0; f < FIELDS; f++) {
                  if (prev.locked[f] && s.locked[f]) check(same(s.grid[f], prev.grid[f]), 'locked field changed');
                }
              }
              // The clock only ever starts on a placement, and never stops.
              if (s.clockStarted && !started) {
                check(e.type === 'place' || e.type === 'fill_field' || e.type === 'resume', 'clock started by ' + e.type);
                started = true;
              }
              if (!s.clockStarted) check(s.remainingMs === BOARD_CLOCK_BUDGET_MS, 'clock moved before start');
              check(s.remainingMs > 0, 'play with no time');
              // Hard: never every field locked with points unplaced.
              if (mode === 'hard' && s.locked.every(Boolean)) check(boardRemaining(s) === 0, 'all locked with points left');
            } else if (s.phase === 'review') {
              legalEntry(mode, s.battles);
              // Locked fields carry through the spread unchanged.
              for (let f = 0; f < FIELDS; f++) if (s.locked[f]) check(same(s.battles[f], s.placed[f]), 'spread touched a locked field');
              check(s.timingsMs.length === FIELDS, 'timings length');
              for (const t of s.timingsMs) check(Number.isInteger(t) && t >= 0 && t <= BOARD_CLOCK_BUDGET_MS, 'timing out of range');
            }
          }
          // Whatever happened, forcing the end yields a legal entry.
          const end = s.phase === 'play' ? reduceBoard(s, { type: 'tick', ms: BOARD_CLOCK_BUDGET_MS + 1 }) : s;
          if (end.phase === 'review') legalEntry(mode, end.battles);
        }),
        { numRuns: 10_000 }
      );
    }, 240_000);

    it('is deterministic: the same events give the same entry', () => {
      fc.assert(
        fc.property(fc.array(eventArb, { minLength: 1, maxLength: 60 }), (events) => {
          const a = run(mode, [...events, { type: 'tick', ms: BOARD_CLOCK_BUDGET_MS + 1 }]);
          const b = run(mode, [...events, { type: 'tick', ms: BOARD_CLOCK_BUDGET_MS + 1 }]);
          expect(a).toEqual(b);
        }),
        { numRuns: 500 }
      );
    }, 60_000);
  });
}
