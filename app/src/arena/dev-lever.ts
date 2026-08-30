/*
 * ?arena=<phase> dev lever (never linked from the UI — the ?reveal lever's
 * posture): jump the arena to any phase on fixture data, so every state is
 * reachable by hand without a backend, a wallet, or a filled pool. The
 * lever supplies fixture SERVER STATE and lets the real phase resolver and
 * the real engine do everything else — it never forges a phase the
 * resolver wouldn't derive.
 */

import type { EntryRow, PoolSummary } from '@/data/types';
import type { PublishedBundle } from '@/verify/logic';
import {
  FIXTURE_CAPACITY,
  FIXTURE_MY_SEAT,
  fixtureBundle,
  fixtureEntries,
  fixturePlayer,
  fixturePoolSummary,
} from './fixtures';

export const ARENA_LEVER_PHASES = [
  'create',
  'lobby',
  'sealing',
  'battle',
  'spectate',
  'refunding',
] as const;

export type ArenaLeverPhase = (typeof ARENA_LEVER_PHASES)[number];

export function isArenaLeverPhase(value: string): value is ArenaLeverPhase {
  return (ARENA_LEVER_PHASES as readonly string[]).includes(value);
}

export interface ArenaLeverData {
  pool: PoolSummary;
  entries: EntryRow[];
  bundle: PublishedBundle | null;
  /** Stands in for the signed-in wallet; null = no seat held. */
  walletOverride: string | null;
}

const OPEN_ENTRANTS = 23;

export function leverData(phase: ArenaLeverPhase): ArenaLeverData {
  const me = fixturePlayer(FIXTURE_MY_SEAT);
  switch (phase) {
    case 'create':
      return {
        pool: fixturePoolSummary('Open', OPEN_ENTRANTS),
        entries: fixtureEntries(OPEN_ENTRANTS),
        bundle: null,
        walletOverride: null,
      };
    case 'lobby':
      return {
        pool: fixturePoolSummary('Open', OPEN_ENTRANTS),
        entries: fixtureEntries(OPEN_ENTRANTS),
        bundle: null,
        walletOverride: me,
      };
    case 'sealing':
      return {
        pool: fixturePoolSummary('Sealed', FIXTURE_CAPACITY),
        entries: fixtureEntries(FIXTURE_CAPACITY),
        bundle: null,
        walletOverride: me,
      };
    case 'battle':
      return {
        pool: fixturePoolSummary('Scored', FIXTURE_CAPACITY),
        entries: fixtureEntries(FIXTURE_CAPACITY),
        bundle: fixtureBundle(),
        walletOverride: me,
      };
    case 'spectate':
      return {
        pool: fixturePoolSummary('Paid', FIXTURE_CAPACITY),
        entries: fixtureEntries(FIXTURE_CAPACITY),
        bundle: fixtureBundle(),
        walletOverride: null,
      };
    case 'refunding':
      return {
        pool: fixturePoolSummary('Refunding', OPEN_ENTRANTS),
        entries: fixtureEntries(OPEN_ENTRANTS),
        bundle: null,
        walletOverride: me,
      };
  }
}
