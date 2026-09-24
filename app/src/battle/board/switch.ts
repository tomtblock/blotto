/*
 * THE BOARD SWITCH. The battle board is the run (founder 2026-09-24, on the
 * day Phase A merged: "I want everything to show the board"). One setting
 * remains so that a rollback is a setting and not a code change: exactly
 * `NEXT_PUBLIC_BATTLE_BOARD=0` at build time restores the dial run and the
 * landing page's practice machine as they were. Anything else — unset,
 * "1", "true" — is the board. Read here and nowhere else; the play page,
 * the landing page and its hero control all import this one constant.
 * The switch and the dial code it guards come out once the board has
 * played a real pool (docs/CHANGE-2026-09-24_battle-board.md).
 */
export const BATTLE_BOARD = process.env.NEXT_PUBLIC_BATTLE_BOARD !== '0';
