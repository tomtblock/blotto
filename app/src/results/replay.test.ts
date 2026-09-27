/*
 * The replay is a way of watching `compareBattle` happen: for every clash,
 * the side left standing at the end must be the side the engine awards the
 * stat to, and the field's verdict must be the engine's. Integer-only.
 */
import { describe, expect, it } from 'vitest';
import { compareBattle, type BattleSet } from '@blotto/scoring';
import { clashVerdict, fightDurationMs, fightState, headToHead, replayFrame } from './replay';

const mine: BattleSet = [
  [100, 0, 0, 0, 0],
  [34, 33, 33, 0, 0],
  [20, 20, 20, 20, 20],
  [50, 50, 0, 0, 0],
  [0, 0, 0, 50, 50],
  [40, 0, 30, 0, 30],
  [20, 20, 20, 20, 20],
];
const theirs: BattleSet = [
  [34, 33, 33, 0, 0],
  [0, 0, 34, 33, 33],
  [100, 0, 0, 0, 0],
  [20, 20, 20, 20, 20],
  [20, 20, 20, 20, 20],
  [0, 100, 0, 0, 0],
  [20, 20, 20, 20, 20],
];

describe('fightState', () => {
  it('trades bodies one for one until the smaller side is gone, and the survivor agrees with the rule', () => {
    for (const [m, t] of [
      [100, 34],
      [34, 100],
      [33, 33],
      [0, 20],
      [20, 0],
      [0, 0],
      [50, 50],
      [1, 2],
      [700, 0],
    ] as const) {
      const start = fightState(m, t, 0);
      expect(start).toMatchObject({ mineLeft: m, theirsLeft: t, resolved: Math.min(m, t) === 0 });
      const end = fightState(m, t, 60_000);
      expect(end.resolved).toBe(true);
      expect(end.mineLeft).toBe(m - Math.min(m, t));
      expect(end.theirsLeft).toBe(t - Math.min(m, t));
      const rule = compareBattle([m, 0, 0, 0, 0], [t, 0, 0, 0, 0]);
      const expected = rule.statsA > rule.statsB ? 'mine' : rule.statsB > rule.statsA ? 'theirs' : 'level';
      expect(clashVerdict(end)).toBe(expected);
    }
  });

  it('never goes negative and never falls more than the smaller side', () => {
    expect(fightState(5, 9, -100)).toMatchObject({ mineLeft: 5, theirsLeft: 9 });
    expect(fightState(5, 9, 10_000)).toMatchObject({ mineLeft: 0, theirsLeft: 4, resolved: true });
  });
});

describe('replayFrame', () => {
  it('starts with every body standing; only a battle with nobody to fight settles at once', () => {
    const f = replayFrame(mine, theirs, 0);
    expect(f.done).toBe(false);
    // Battle 6 is the one whose five clashes each have an empty side, so
    // nobody falls and it is settled before the march: a win for mine
    // (40 v 0, 30 v 0, 30 v 0) — counted the moment it settles.
    expect(f.fields.map((x) => x.resolved)).toEqual([false, false, false, false, false, true, false]);
    expect(f.settledFields).toBe(1);
    expect(f.tally).toMatchObject({ wins: 1, losses: 0, draws: 0, mineHalf: 2, theirsHalf: 0 });
    f.fields.forEach((field, k) => field.clashes.forEach((c, z) => expect([c.mineLeft, c.theirsLeft]).toEqual([mine[k]![z], theirs[k]![z]])));
  });

  it('ends on the engine verdict for every field, in half-points', () => {
    const f = replayFrame(mine, theirs, fightDurationMs(mine, theirs));
    expect(f.done).toBe(true);
    f.fields.forEach((field, k) => {
      const rule = compareBattle(mine[k]!, theirs[k]!);
      expect(field.comparison).toEqual(rule);
      field.clashes.forEach((c, z) => {
        const stat = mine[k]![z]! > theirs[k]![z]! ? 'mine' : theirs[k]![z]! > mine[k]![z]! ? 'theirs' : 'level';
        expect(clashVerdict(c)).toBe(stat);
      });
    });
    // draw, loss, win, loss, loss, win, draw → 2 wins, 3 losses, 2 draws.
    expect(f.tally).toMatchObject({ wins: 2, losses: 3, draws: 2, mineHalf: 6, theirsHalf: 8 });
    expect(headToHead(f.tally)).toEqual({ winner: 'theirs', byStats: false });
  });

  it('falls to stats won when the battles are level', () => {
    const a: BattleSet = [[100, 0, 0, 0, 0], ...Array.from({ length: 6 }, () => [20, 20, 20, 20, 20] as const)] as BattleSet;
    const b: BattleSet = [[34, 33, 33, 0, 0], ...Array.from({ length: 6 }, () => [20, 20, 20, 20, 20] as const)] as BattleSet;
    const f = replayFrame(a, b, fightDurationMs(a, b));
    expect(f.tally.mineHalf).toBe(f.tally.theirsHalf);
    expect(headToHead(f.tally)).toEqual({ winner: 'theirs', byStats: true });
    expect(headToHead(replayFrame(b, b, 10).tally)).toEqual({ winner: 'level', byStats: false });
  });

  it('is monotone: bodies only fall as time passes', () => {
    let prev = replayFrame(mine, theirs, 0);
    for (let t = 100; t <= 5_000; t += 100) {
      const next = replayFrame(mine, theirs, t);
      next.fields.forEach((field, k) =>
        field.clashes.forEach((c, z) => {
          const p = prev.fields[k]!.clashes[z]!;
          expect(c.mineLeft).toBeLessThanOrEqual(p.mineLeft);
          expect(c.theirsLeft).toBeLessThanOrEqual(p.theirsLeft);
        })
      );
      expect(next.settledFields).toBeGreaterThanOrEqual(prev.settledFields);
      prev = next;
    }
  });
});
