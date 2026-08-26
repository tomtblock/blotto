/*
 * POWER LEVEL count-up maths (10.C Step 4, Beat 6 — ratified: the hero
 * numeral counts up from zero; reveal-spec §3 Beat 6).
 *
 * Pure and frame-driven: the card stage calls this with the elapsed time
 * per animation frame; no timers, no state in here. Ease-out cubic —
 * digits sprint early and land softly, the counter idiom — with the two
 * properties count-up.test.ts pins:
 *
 *  - EXACT landing: at (or past) the duration the value IS the target, not
 *    a float neighbour of it (the §2a sum is the card's headline fact —
 *    a 370 that reads 369 for a frame at the end is a display lie);
 *  - monotone: the display never ticks down mid-count.
 *
 * Display-layer floats are fine here (NG-010 binds on-chain and derivation
 * math; this animates a number the metadata service derived) — the OUTPUT
 * is still always an integer.
 */

/**
 * The displayed value `elapsedMs` into a count-up to `target` over
 * `durationMs`. Clamped: 0 before the start, exactly `target` from the
 * duration onward (and immediately when the duration is zero or negative —
 * the reduced-motion path).
 */
export function countUpValue(
  target: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return target;
  if (elapsedMs <= 0) return 0;
  const progress = elapsedMs / durationMs;
  const eased = 1 - (1 - progress) ** 3;
  return Math.min(target, Math.floor(target * eased));
}
