/*
 * The canonical-outcomes gate: every fact in a battle script must be
 * re-derivable from the real engine, and the field loader must refuse
 * published results it cannot reproduce.
 */

import { describe, expect, it } from 'vitest';
import { BATTLES, compareBattle } from '@/arena/engine';
import { fixtureBattleSet, fixtureBundle, FIXTURE_CAPACITY } from '@/arena/fixtures';
import {
  ArenaRescoreMismatch,
  buildBattleScript,
  compileBeats,
  featuredSeats,
  loadField,
  matchupOutcome,
} from './script';

describe('buildBattleScript', () => {
  it('round outcomes equal compareBattle on every fixture matchup vs seat 0', () => {
    const mine = fixtureBattleSet(0);
    for (let opp = 1; opp < FIXTURE_CAPACITY; opp++) {
      const theirs = fixtureBattleSet(opp);
      const script = buildBattleScript(mine, theirs, 0, opp);
      expect(script.rounds).toHaveLength(BATTLES);
      script.rounds.forEach((round, k) => {
        const c = compareBattle(mine[k], theirs[k]);
        expect(round.outcome).toBe(c.outcome);
        // The last move's running pips are the engine's stat counts, except
        // when the round truncated at a KO (then the winner shows exactly 3).
        const finalPips = round.moves[round.moves.length - 1].running;
        if (round.koAtMove === null) {
          expect(round.outcome).toBe('draw');
          expect(round.moves).toHaveLength(5);
          expect(finalPips).toEqual({ me: c.statsA, opp: c.statsB });
        } else {
          expect(round.moves).toHaveLength(round.koAtMove + 1);
          expect(Math.max(finalPips.me, finalPips.opp)).toBe(3);
          expect(round.outcome).toBe(finalPips.me === 3 ? 'win' : 'loss');
        }
      });
      const wins = script.rounds.filter((r) => r.outcome === 'win').length;
      const losses = script.rounds.filter((r) => r.outcome === 'loss').length;
      expect(script.tally).toEqual({ wins, losses, draws: BATTLES - wins - losses });
    }
  });

  it('moves run in the fixed stat order — the canonical move order', () => {
    const script = buildBattleScript(fixtureBattleSet(1), fixtureBattleSet(2), 1, 2);
    for (const round of script.rounds) {
      round.moves.forEach((m, z) => expect(m.stat).toBe(z));
    }
  });
});

describe('compileBeats', () => {
  it('wraps every round in intro/result and every move in call/land', () => {
    const script = buildBattleScript(fixtureBattleSet(0), fixtureBattleSet(1), 0, 1);
    const beats = compileBeats(script);
    expect(beats[0]).toEqual({ kind: 'matchup-intro' });
    expect(beats[beats.length - 1]).toEqual({ kind: 'matchup-result' });
    const moveCount = script.rounds.reduce((n, r) => n + r.moves.length, 0);
    expect(beats).toHaveLength(2 + BATTLES * 2 + moveCount * 2);
  });
});

describe('loadField', () => {
  it('accepts the fixture bundle (results reproduce exactly)', () => {
    const field = loadField(fixtureBundle());
    expect(field.sets).toHaveLength(FIXTURE_CAPACITY);
    expect(field.results).toHaveLength(FIXTURE_CAPACITY);
    // Prizes are engine output: conservation was asserted inside assignPrizes.
    expect(field.results.some((r) => r.amountLamports > 0n)).toBe(true);
  });

  it('refuses a bundle whose published results do not reproduce', () => {
    const bundle = fixtureBundle();
    const tampered = {
      ...bundle,
      results: bundle.results.map((r, i) => (i === 3 ? { ...r, rank: r.rank + 1 } : r)),
    };
    expect(() => loadField(tampered)).toThrow(ArenaRescoreMismatch);
  });
});

describe('featuredSeats', () => {
  it('is deterministic, excludes the viewer, and picks at most three distinct seats', () => {
    const field = loadField(fixtureBundle());
    const mySeat = 0;
    const mine = field.sets[mySeat]!;
    const scripts = field.results
      .filter((r) => r.index !== mySeat)
      .map((r) => buildBattleScript(mine, field.sets[r.index]!, mySeat, r.index));
    const picks = featuredSeats(mySeat, scripts, field.results);
    expect(picks).toEqual(featuredSeats(mySeat, scripts, field.results));
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(3);
    expect(new Set(picks).size).toBe(picks.length);
    expect(picks).not.toContain(mySeat);
    for (const s of picks) expect(matchupOutcome(scripts.find((x) => x.oppSeat === s)!)).toBeDefined();
  });
});
