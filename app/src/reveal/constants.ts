/*
 * Reveal-surface constants. The predecessor's 40-odd theatrical magnitudes
 * (taps, jolts, eggs, fragments) were deleted with the tap-to-crack reveal
 * in the UI constitution rebuild — the entry moment is now the calm
 * sealed → 80/20 split → live ring sequence (PART 6.5), and the pass is a
 * quiet card afterwards. What remains here is transaction-lifecycle
 * pacing, not theatre.
 */

/**
 * How long the pending entry may sit unconfirmed before the host switches
 * to the honest stalled message (the entry is submitted; nothing further
 * is needed). PROVISIONAL founder-tunable, unchanged from the previous
 * flow.
 */
export const STALL_THRESHOLD_MS = 30_000;
