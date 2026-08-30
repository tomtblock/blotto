/*
 * The arena's phase resolver + the lobby's visual projection — pure, no
 * React, no I/O (the machine-and-dumb-clock discipline of
 * src/battle/machine.ts, minus the clock: phase is DERIVED from server
 * state every render, never stored).
 *
 * THE SEALING GUARANTEE, MADE STRUCTURAL (the RevealVisual idiom,
 * src/reveal/machine.ts): `LobbyVisual` is everything the lobby is allowed
 * to render, and it carries NO allocation, score or ranking field AT THE
 * TYPE LEVEL. The indexer genuinely does not serve any of those before the
 * reveal (read-api: entries expose player/idx/class/battles_hash only), but
 * the projection makes the guarantee reviewable in one place: a component
 * rendering from `LobbyVisual` cannot leak what the type cannot hold.
 */

import type { EntryRow, PoolSummary } from '@/data/types';
import type { PublishedBundle } from '@/verify/logic';

export type ArenaPhase =
  /** Pool open, viewer holds no seat — build and enter. */
  | 'create'
  /** Pool open, viewer's entry is sealed in — watch the seats fill. */
  | 'lobby'
  /** Pool closed, results not yet published — an honest wait, no fake data. */
  | 'sealing'
  /** Results published, viewer held a seat — the full battle playback. */
  | 'battle'
  /** Results published, viewer held no seat — playback of the field. */
  | 'spectate'
  /** The pool missed its fill deadline — refunds, honest terminal copy. */
  | 'refunding'
  | 'closed';

export function arenaPhase(
  pool: PoolSummary,
  myEntry: EntryRow | null,
  submittedThisSession: boolean,
  bundle: PublishedBundle | null
): ArenaPhase {
  switch (pool.state) {
    case 'Open':
      return myEntry !== null || submittedThisSession ? 'lobby' : 'create';
    case 'Sealed':
    case 'Scored':
    case 'Paid':
      if (bundle === null) return 'sealing';
      return myEntry !== null ? 'battle' : 'spectate';
    case 'Refunding':
      return 'refunding';
    case 'Closed':
      return 'closed';
  }
}

/** One filled seat as the lobby may show it: position, cosmetic class
 * (public on-chain from EntryRegistered — see EntryRow), a shortened wallet.
 * NOTHING else exists here. */
export interface LobbySeat {
  idx: number;
  class: number;
  playerShort: string;
  mine: boolean;
}

/** Everything the lobby renders from. No allocation/score/ranking field
 * exists on this type — see the header. */
export interface LobbyVisual {
  entrants: number;
  seats: readonly LobbySeat[];
  fillDeadline: string;
  state: PoolSummary['state'];
}

const shortAddress = (player: string) =>
  player.length > 8 ? `${player.slice(0, 4)}…${player.slice(-4)}` : player;

export function lobbyVisual(
  pool: PoolSummary,
  entries: readonly EntryRow[],
  walletAddress: string | null
): LobbyVisual {
  return {
    entrants: pool.entrants,
    seats: entries
      .map((e) => ({
        idx: e.idx,
        class: e.class,
        playerShort: shortAddress(e.player),
        mine: walletAddress !== null && e.player === walletAddress,
      }))
      .sort((a, b) => a.idx - b.idx),
    fillDeadline: pool.fill_deadline,
    state: pool.state,
  };
}
