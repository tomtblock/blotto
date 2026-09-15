/*
 * The entry takeover's one remaining magnitude.
 *
 * Until 2026-09-15 this file held every duration and ratio the reveal
 * animated with — tap counts, jolts, leaks, the tell's bleed, the unseal's
 * fragment flight, the extended-tell class threshold — some forty
 * PROVISIONAL founder-tunables under the Q-026 pattern. The founder's
 * instruction of 2026-09-14 removed the reveal, and the stage that consumed
 * them went with it (`docs/CHANGE-2026-09-15_reveal-and-rarity.md`). What
 * stays is the one value the surviving beats still need.
 */

/**
 * PROVISIONAL — time waiting for confirmation before the come-back-later
 * state (PRD D-03: come-back triggers ONLY on genuine stall). Q-026 split,
 * pinned at Step 5a (2026-08-11): the STRUCTURE around it is ratified — the
 * come-back state and the resume-on-late-confirmation — but this MAGNITUDE
 * stays a FOUNDER-OWNED PROVISIONAL. 30 s = well past normal confirmation,
 * short enough that a user staring at a genuinely stuck screen isn't held
 * hostage.
 */
export const STALL_THRESHOLD_MS = 30_000;
