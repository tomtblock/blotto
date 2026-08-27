"use client";

import { useSyncExternalStore } from "react";

/*
 * prefers-reduced-motion, subscribed (extracted from reveal-stage in 10.C
 * Step 4 so the card stage shares it — one implementation, both stages).
 *
 * Motion v13's own useReducedMotion is a ONE-SHOT
 * (`useState(prefersReducedMotion.current)`, with a source TODO about never
 * updating) — it latches whatever the media query said at the first-ever
 * render, which both misses live OS changes and reads false under emulated
 * media that lands a beat after hydration. The canonical
 * useSyncExternalStore form is SSR-safe (server snapshot false, corrected
 * pre-paint on hydration, no mismatch warning) and stays live.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}
