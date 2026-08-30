/*
 * Character identities — one FIXED archetype per battle index (0..6).
 *
 * Deterministic and cosmetic by construction: the identity is a function of
 * the battle index alone, identical for every player in every pool (the
 * NG-007 posture — even cosmetic variance must never invite outcome-reading),
 * and it confers nothing (PID §8.4). The character's BODY is the allocation
 * itself (creature/creature-geometry.ts); this module only names the slot.
 *
 * Names live in the copy module like every user-facing string; this file is
 * the typed accessor.
 */

import { COPY } from '@/copy';

export interface CharacterIdentity {
  /** Battle index, 0..6 — the identity key. */
  battleIndex: number;
  name: string;
}

export const CHARACTER_COUNT = 7;

export function characterFor(battleIndex: number): CharacterIdentity {
  if (!Number.isInteger(battleIndex) || battleIndex < 0 || battleIndex >= CHARACTER_COUNT) {
    throw new Error(`battle index out of range: ${battleIndex}`);
  }
  return { battleIndex, name: COPY.arena.characterNames[battleIndex] };
}
