/*
 * The arena's ONE seam onto the real scoring engine (R20: one module, two
 * runtimes — the same relative-path import the verify page proved
 * browser-safe in src/verify/logic.ts). Every outcome the arena animates is
 * derived through these names; nothing in src/arena/ may reimplement or
 * approximate any of them. If the backend workspace ever becomes a package,
 * this file is the only line in the arena that changes.
 */

export {
  BATTLES,
  STATS,
  STAT_NAMES,
  compareBattle,
  decodeBattleSet,
  encodeBattleSet,
  battlesHash,
  scorePool,
  assignPrizes,
  potLamports,
} from '../../../backend/scoring/src';
export type {
  Allocation,
  BattleSet,
  BattleComparison,
  BattleOutcome,
  PlayerResult,
} from '../../../backend/scoring/src';
export { scoreWithMissing } from '../../../backend/reveal/src/missing';
