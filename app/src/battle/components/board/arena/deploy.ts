/*
 * THE DEPLOY CURVE — ported from the mockup (src/model/deploy.ts). How many
 * troops a hold of `heldMs` has released: the rate ramps linearly from
 * `startPerSecond` to `maxPerSecond` over `rampSeconds`, then stays at max;
 * the count is the integral of that rate, floored and capped. Pure and
 * deterministic. With the mockup's numbers a hold releases 5 in half a
 * second, 46 at two seconds and 100 at about 3.4 seconds.
 *
 * The curve decides WHEN each single point is sent; every point is still
 * one `place +1`-shaped deposit against the reducer, which is the only
 * gate on where it may land (machine.ts).
 */

export interface DeployConfig {
  startPerSecond: number;
  maxPerSecond: number;
  rampSeconds: number;
  /** Most troops one hold can deploy. */
  max: number;
  /** Milliseconds a finger must rest on a field before the hold starts (a move before that pans). */
  armMs: number;
}

/** The mockup's defaults (its README "Parameters"). `max` is the hard-mode budget so a hold can fill a field in either mode. */
export const DEPLOY: DeployConfig = { startPerSecond: 6, maxPerSecond: 40, rampSeconds: 2.0, max: 700, armMs: 120 };

export function deployCountAt(heldMs: number, cfg: DeployConfig = DEPLOY): number {
  const t = Math.max(0, heldMs) / 1000;
  const { startPerSecond: a, maxPerSecond: b, rampSeconds: r } = cfg;
  let total: number;
  if (r <= 0 || t >= r) {
    const rampArea = r > 0 ? ((a + b) / 2) * r : 0;
    total = rampArea + b * (t - Math.max(0, r));
  } else {
    const rate = a + ((b - a) * t) / r;
    total = ((a + rate) / 2) * t;
  }
  return Math.min(cfg.max, Math.floor(total));
}

/** Milliseconds needed to reach `count` (inverse, for tests). */
export function msToDeploy(count: number, cfg: DeployConfig = DEPLOY): number {
  let lo = 0;
  let hi = 60_000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (deployCountAt(mid, cfg) >= count) hi = mid;
    else lo = mid;
  }
  return hi;
}
