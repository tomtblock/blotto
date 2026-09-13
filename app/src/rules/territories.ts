/**
 * The territory schedule, as the three player-facing surfaces need it
 * (founder instruction 2026-09-12 §3.3).
 *
 * ONE SOURCE, THREE SURFACES. The list is generated from
 * `config/territories.json` at build time and is never hand-typed into JSX —
 * the block screen, the rules page and the entry surfaces all read it here,
 * so a founder instruction that changes the schedule changes every one of
 * them in the same commit. `scripts/check-territories.ts` fails the build if
 * a code in the file has no display name, so nothing here can render a bare
 * code to a player.
 *
 * This module knows what is blocked. It does not decide it: that is
 * `config/territories.json`, which is founder-owned, and the enforcement is
 * `backend/packet` — nothing in the browser gates anything.
 */

import territories from '@config/territories.json';
import { territoryName } from './territoryNames';

export interface Availability {
  /** Which way an unlisted territory falls (founder posture, 2026-08-28:
   * block-list — available everywhere except `blocked`). */
  posture: 'allow-list' | 'block-list';
  allowed: string[];
  blocked: string[];
  scheduleVersion: number;
  /** The date of the founder instruction this schedule implements. Shown
   * beside the list so a reader can see how current it is. */
  updated: string;
}

/** Rendered from config/territories.json — the founder-owned schedule. */
export function availability(): Availability {
  return {
    posture: territories.posture === 'block-list' ? 'block-list' : 'allow-list',
    allowed: (territories.allowed as string[]).map(territoryName),
    blocked: territories.blocked.map(territoryName),
    scheduleVersion: territories.version,
    updated: territories.updated,
  };
}

/**
 * The blocked territories as one sentence-ready phrase.
 *
 * `max` caps how many are named before the rest become a count. The full
 * list belongs on the rules page, which has room for it; an entry screen
 * does not, and a fourteen-item list in a paragraph is not read by anyone.
 * Passing `Infinity` names all of them.
 */
export function blockedTerritoryPhrase(max = Infinity): string {
  const names = availability().blocked;
  if (names.length === 0) return '';
  if (names.length <= max) {
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  const shown = names.slice(0, max).join(', ');
  const rest = names.length - max;
  return `${shown} and ${rest} other ${rest === 1 ? 'territory' : 'territories'}`;
}
