/*
 * The battle replay — pure model (V2, founder 2026-09-27: "a replay frame
 * with a play button" on the results page). Ported from the co-founder's
 * arena prototype (blotto-game, src/replay/replay.ts) and re-based on the
 * scoring engine this repository runs (R20: one module, crank and browser).
 *
 * WHAT IT SHOWS. Two published entries, every battle at once. In each
 * battle the five stats clash side by side: the two crowds trade bodies one
 * for one at a fixed rate until the smaller side is gone. Whoever still has
 * bodies standing wins the stat; equal crowds wipe each other out and the
 * stat is level. Three stats take the battle — exactly the rule
 * `compareBattle` scores by, which is the only thing that decides the
 * outcome here. The fight is a way of WATCHING that rule happen; a frame is
 * a pure function of elapsed time, and the survivor always agrees with the
 * engine (pinned in replay.test.ts).
 *
 * INTEGERS ONLY. Bodies fallen = floor(elapsedMs × rate / 1000) on integer
 * milliseconds; the tally carries a drawn battle as one half-point (two per
 * win), never as 0.5. Display-only: nothing here feeds a score back.
 */

import { compareBattle, type BattleComparison, type BattleOutcome, type BattleSet } from '@blotto/scoring';

/** Bodies that fall per second, on both sides at once. */
export const FALLS_PER_SECOND = 24;
/** The march before the first body falls, and the hold after the last. */
export const MARCH_MS = 900;
export const RESULT_HOLD_MS = 600;

export interface ClashState {
  mine: number;
  theirs: number;
  mineLeft: number;
  theirsLeft: number;
  resolved: boolean;
}

/** Pure: who is still standing `elapsedMs` into a clash of `mine` vs `theirs` bodies. */
export function fightState(mine: number, theirs: number, elapsedMs: number, fallsPerSecond = FALLS_PER_SECOND): ClashState {
  const toFall = Math.min(mine, theirs);
  const fallen = Math.min(toFall, Math.max(0, Math.floor((Math.max(0, elapsedMs) * fallsPerSecond) / 1000)));
  return { mine, theirs, mineLeft: mine - fallen, theirsLeft: theirs - fallen, resolved: fallen >= toFall };
}

export interface FieldFrame {
  field: number;
  clashes: ClashState[];
  /** Every clash settled. */
  resolved: boolean;
  /** The engine's verdict, shown only once the field is resolved. */
  comparison: BattleComparison;
}

export interface Tally {
  /** Battles won, in half-points (a win is 2, a draw is 1). */
  mineHalf: number;
  theirsHalf: number;
  wins: number;
  losses: number;
  draws: number;
  statsMine: number;
  statsTheirs: number;
}

export interface ReplayFrame {
  fields: FieldFrame[];
  settledFields: number;
  tally: Tally;
  /** Every field settled. */
  done: boolean;
}

/** How long the fighting lasts, in ms: the longest clash on the board. */
export function fightDurationMs(mine: BattleSet, theirs: BattleSet, fallsPerSecond = FALLS_PER_SECOND): number {
  let longest = 0;
  for (let f = 0; f < mine.length; f++) {
    for (let z = 0; z < 5; z++) {
      const toFall = Math.min(mine[f]![z]!, theirs[f]?.[z] ?? 0);
      longest = Math.max(longest, Math.ceil((toFall * 1000) / fallsPerSecond));
    }
  }
  return longest;
}

const EMPTY_TALLY: Tally = { mineHalf: 0, theirsHalf: 0, wins: 0, losses: 0, draws: 0, statsMine: 0, statsTheirs: 0 };

/**
 * The board `elapsedMs` into the fight (the march is not counted here; the
 * component holds elapsed at 0 during it).
 */
export function replayFrame(mine: BattleSet, theirs: BattleSet, elapsedMs: number, fallsPerSecond = FALLS_PER_SECOND): ReplayFrame {
  const tally: Tally = { ...EMPTY_TALLY };
  const fields: FieldFrame[] = mine.map((battle, f) => {
    const other = theirs[f] ?? [0, 0, 0, 0, 0];
    const clashes = battle.map((m, z) => fightState(m, other[z] ?? 0, elapsedMs, fallsPerSecond));
    const resolved = clashes.every((c) => c.resolved);
    const comparison = compareBattle(battle, other);
    if (resolved) {
      if (comparison.outcome === 'win') {
        tally.wins += 1;
        tally.mineHalf += 2;
      } else if (comparison.outcome === 'loss') {
        tally.losses += 1;
        tally.theirsHalf += 2;
      } else {
        tally.draws += 1;
        tally.mineHalf += 1;
        tally.theirsHalf += 1;
      }
      tally.statsMine += comparison.statsA;
      tally.statsTheirs += comparison.statsB;
    }
    return { field: f, clashes, resolved, comparison };
  });
  const settledFields = fields.filter((f) => f.resolved).length;
  return { fields, settledFields, tally, done: settledFields === fields.length };
}

/** Who a resolved clash's survivors say won it — must equal the engine's stat verdict. */
export function clashVerdict(c: ClashState): 'mine' | 'theirs' | 'level' {
  return c.mineLeft > c.theirsLeft ? 'mine' : c.theirsLeft > c.mineLeft ? 'theirs' : 'level';
}

/** The head-to-head verdict in the rule's own order: battles won, then stats won. */
export function headToHead(tally: Tally): { winner: 'mine' | 'theirs' | 'level'; byStats: boolean } {
  if (tally.mineHalf !== tally.theirsHalf) return { winner: tally.mineHalf > tally.theirsHalf ? 'mine' : 'theirs', byStats: false };
  if (tally.statsMine !== tally.statsTheirs) return { winner: tally.statsMine > tally.statsTheirs ? 'mine' : 'theirs', byStats: true };
  return { winner: 'level', byStats: false };
}

export type { BattleOutcome };
