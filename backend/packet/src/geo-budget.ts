/**
 * A ceiling on what the entry gate may spend at a paid geo vendor, and a
 * reserve that only issuance may touch.
 *
 * THE PROBLEM. `GET /geo` is unauthenticated, takes no body, and costs one
 * paid lookup for every client address the per-address cache has not seen in
 * the last fifteen minutes. The entry page fires it on mount. So a few
 * thousand page views — or a few thousand addresses from a cheap proxy pool —
 * spend the whole credit balance, and from that moment the vendor answers 429
 * and every entry is refused (audit 2026-09-11, B-04).
 *
 * TWO SEPARATE THINGS ARE WRONG THERE, and this module addresses the second.
 * The first is having one source at all, which `geo-composite.ts` fixes. The
 * second is that a PRE-FLIGHT — a courtesy check for a visitor who has not
 * signed in, not attested, and not paid anything — competes for the same
 * credits as ISSUANCE, the call that actually decides whether a paying
 * entrant may enter. Nothing separated them, so the cheapest possible traffic
 * could starve the most valuable call in the system.
 *
 * THE RULE. One window, one allowance, two faces over it:
 *
 *   `forIssuance()`  may spend down to the last credit in the allowance.
 *   `forPreflight()` stops at `dailyCap - reserve`, leaving `reserve`
 *                    lookups that only `POST /packet` can reach.
 *
 * So an unauthenticated flood can cost us the pre-flight — visitors then see
 * the fail-closed "not available" panel, which is wrong but harmless and
 * recoverable — and cannot cost us the entry itself.
 *
 * FAIL-CLOSED IS PRESERVED EXACTLY. A refusal here throws, the callers catch,
 * and `/geo` answers `false` and `/packet` answers the one generic rejection,
 * as they already did for every other lookup failure. No path is opened; the
 * territory schedule still decides every answer that IS given. Changing the
 * pre-flight to degrade to "unknown" instead of "blocked" would be a change
 * to a compliance-facing control and is the founder's call, not this
 * module's — it is deliberately not done here.
 *
 * THE WINDOW IS OURS, NOT THE VENDOR'S. We do not know what hour the vendor
 * resets on, and guessing would be worse than not modelling it: this is a
 * fixed-length window from the first spend, sized by the operator BELOW the
 * vendor's own cap. Its job is to bound what WE spend, not to predict what
 * the vendor allows. Unconfigured, there is no ceiling and behaviour is
 * exactly as before — a cost control is not something to switch on for an
 * operator by guessing their plan.
 */

import { METRIC } from '../../_shared/src/metrics';
import { SILENT_MONITOR, type Monitor } from '../../_shared/src/monitor';
import type { GeoLookup, GeoLookupResult } from './service';

/** Our own ceiling stopped the call. No vendor credit was spent. */
export class GeoBudgetSpentError extends Error {
  constructor(
    readonly purpose: GeoPurpose,
    spent: number,
    ceiling: number
  ) {
    super(
      `geo budget: the ${purpose} allowance is spent (${spent}/${ceiling} in this window) — ` +
        `no vendor call was made. This is NOT a territory decision.`
    );
    this.name = 'GeoBudgetSpentError';
  }
}

/** Which face of the allowance a call came through — a bounded metric label. */
export type GeoPurpose = 'preflight' | 'issuance';

export interface GeoBudgetOptions {
  /** Lookups allowed per window, across both faces. Must be positive. */
  dailyCap: number;
  /**
   * Lookups at the end of the allowance that only issuance may spend.
   *
   * Defaults to a quarter of the cap. A quarter is a judgement, not a
   * ratified number: it is enough for a full field twice over at the
   * documented 64-seat pool size, and small enough that ordinary traffic
   * is not squeezed. See the PHASE-6-REVIEW note in `main.ts`.
   */
  reserve?: number;
  /** Window length. One day, matching the vendor plans this guards. */
  windowMs?: number;
  now?: () => number;
  monitor?: Monitor;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A shared allowance with two `GeoLookup` faces over it.
 *
 * Not a `GeoLookup` itself, deliberately: every caller has to say which face
 * it is, because the whole point is that the two are not interchangeable.
 */
export class GeoBudget {
  private readonly cap: number;
  private readonly reserve: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly monitor: Monitor;
  private spent = 0;
  private windowStartedAt: number;

  constructor(
    private readonly inner: GeoLookup,
    options: GeoBudgetOptions
  ) {
    if (!Number.isFinite(options.dailyCap) || options.dailyCap <= 0) {
      throw new Error('GeoBudget: dailyCap must be a positive number');
    }
    this.cap = Math.floor(options.dailyCap);
    const reserve = options.reserve ?? Math.floor(this.cap / 4);
    if (reserve < 0 || reserve >= this.cap) {
      throw new Error('GeoBudget: reserve must be between 0 and dailyCap');
    }
    this.reserve = reserve;
    this.windowMs = options.windowMs ?? DAY_MS;
    this.now = options.now ?? Date.now;
    this.monitor = options.monitor ?? SILENT_MONITOR;
    this.windowStartedAt = this.now();
  }

  /** Lookups spent in the current window — the startup/health line reads it. */
  get used(): number {
    return this.spent;
  }

  /** The ceiling each face stops at. */
  ceilingFor(purpose: GeoPurpose): number {
    return purpose === 'issuance' ? this.cap : this.cap - this.reserve;
  }

  forIssuance(): GeoLookup {
    return { lookup: (ip: string) => this.spendThen('issuance', ip) };
  }

  forPreflight(): GeoLookup {
    return { lookup: (ip: string) => this.spendThen('preflight', ip) };
  }

  private async spendThen(purpose: GeoPurpose, ip: string): Promise<GeoLookupResult> {
    this.turnWindow();
    const ceiling = this.ceilingFor(purpose);
    if (this.spent >= ceiling) {
      this.monitor.recordEvent(METRIC.packet.geoBudgetRefused, { purpose });
      throw new GeoBudgetSpentError(purpose, this.spent, ceiling);
    }
    // Counted BEFORE the call, not after. A call that throws still cost a
    // request at the vendor in every case except a local network fault, and
    // counting only successes would let a failing vendor be hammered for the
    // whole window — the opposite of what a ceiling is for.
    this.spent++;
    return this.inner.lookup(ip);
  }

  private turnWindow(): void {
    const now = this.now();
    if (now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now;
      this.spent = 0;
    }
  }
}
