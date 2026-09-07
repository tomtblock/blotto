/**
 * SELECT, LOAD, SCHEDULE — the boot-time wiring every service that screens
 * shares, in the package both of them depend on.
 *
 * Two services screen, at the two ends of a pool's life:
 *
 *   - the PACKET service at entry, which needs the boolean view
 *     (`asSanctionsList`) its own seam expects;
 *   - the SETTLEMENT daemon at resolving, which needs the whole verdict so
 *     the log can name which list matched.
 *
 * What they share is everything before that fork: choose the sources, load
 * the OFAC mirror BEFORE accepting traffic, refresh it on a schedule after,
 * and log a source that fails beside one that answered. That was written
 * once for the packet service (Stage B) and is here so the daemon gets the
 * identical guarantees rather than a second implementation of them — the
 * same reason `ranking.ts` exists.
 *
 * Posture, unchanged from where it was first stated:
 *
 *   - NOTHING CONFIGURED → the caller refuses to boot. Absence of a vendor
 *     key must never mean "screen against nothing" (`select.ts` throws).
 *   - OFAC MIRROR CANNOT LOAD AT BOOT → the caller refuses to boot. With the
 *     mirror the only source every screening would fail anyway; failing at
 *     boot is the same outcome with a log line that says why.
 *   - OFAC REFRESH FAILS LATER → logged; the previous list is KEPT and keeps
 *     answering until it is older than its max age, when the mirror refuses.
 *     A refresh runs at a quarter of the max age (36 h → every 9 h), so a
 *     single failed download never reaches the refusal.
 *   - A SOURCE FAILS BESIDE ANOTHER THAT ANSWERED → the verdict still decides
 *     on `listed`, and the failed source is logged so an operator can see a
 *     vendor degrading before it is the only one left.
 *
 * What a FAILED SCREENING means is deliberately NOT decided here. At entry
 * it refuses the entry; at settlement it holds one payment for a human. Both
 * call sites say so themselves.
 */

import { buildSanctions } from './select';
import type { OfacMirrorSnapshot, OfacSdnMirror } from './ofac-sdn';
import type { SanctionsCheck } from './seam';

export interface WiredScreening {
  /** The screener, wrapped so a partially failed source set is logged. */
  readonly check: SanctionsCheck;
  /** One line per source, for the startup log. Never contains a secret. */
  readonly describe: readonly string[];
  /** The mirror when configured, for a health payload. `null` otherwise. */
  readonly ofac: OfacSdnMirror | null;
  /** Cancel the refresh schedule (tests; graceful shutdown). */
  stop(): void;
}

export interface WiringOptions {
  /** Injected so a test can drive the schedule; defaults to the global timer. */
  schedule?: (fn: () => void, ms: number) => { unref?(): unknown } | unknown;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

/** The refresh cadence: a quarter of the mirror's max age. */
export function ofacRefreshIntervalMs(maxAgeMs: number): number {
  return Math.max(60_000, Math.floor(maxAgeMs / 4));
}

/**
 * Wrap the screener so a verdict with a partially failed source set is
 * visible to the operator. The address is not logged: nothing here needs it,
 * and `listed` is the whole of what a decision may read.
 */
export function withFailureLog(
  check: SanctionsCheck,
  service: string,
  warn: (line: string) => void
): SanctionsCheck {
  return {
    async screen(address) {
      const verdict = await check.screen(address);
      if (verdict.failed.length > 0) {
        warn(
          `${service}: sanctions source(s) FAILED [${verdict.failed.join(', ')}] — decided on ` +
            `[${verdict.consulted.join(', ')}] (listed=${verdict.listed})`
        );
      }
      return verdict;
    },
  };
}

function describeSnapshot(s: OfacMirrorSnapshot): string {
  return `${s.entries} entries, ${s.addresses} digital-currency addresses, published ${s.publishDate ?? 'unknown'}`;
}

/**
 * Select, load, schedule. Throws when nothing is configured or the mirror
 * cannot load — the caller lets that end the process.
 */
export async function wireScreening(
  env: NodeJS.ProcessEnv,
  service: string,
  opts: WiringOptions = {}
): Promise<WiredScreening> {
  const schedule = opts.schedule ?? ((fn, ms) => setInterval(fn, ms));
  const log = opts.log ?? ((line) => console.log(line));
  const warn = opts.warn ?? ((line) => console.warn(line));

  const built = buildSanctions(env, service);
  let timer: { unref?(): unknown } | unknown = null;

  if (built.ofac) {
    const ofac = built.ofac;
    // Boot-time load: a throw here is fatal by design (module doc).
    const first = await ofac.refresh();
    log(`${service}: ofac-sdn mirror loaded — ${describeSnapshot(first)}`);
    const every = ofacRefreshIntervalMs(ofac.maxAgeMs);
    timer = schedule(() => {
      ofac.refresh().then(
        (s) => log(`${service}: ofac-sdn mirror refreshed — ${describeSnapshot(s)}`),
        (e: unknown) =>
          warn(
            `${service}: ofac-sdn mirror refresh FAILED (previous list kept, refuses past ` +
              `${Math.floor(ofac.maxAgeMs / 3_600_000)} h): ${e instanceof Error ? e.message : String(e)}`
          )
      );
    }, every);
    // Never hold the process open for the schedule alone.
    if (timer && typeof (timer as { unref?: unknown }).unref === 'function') {
      (timer as { unref(): unknown }).unref();
    }
    log(`${service}: ofac-sdn mirror refresh every ${Math.floor(every / 60_000)} min`);
  }

  return {
    check: withFailureLog(built.check, service, warn),
    describe: built.describe,
    ofac: built.ofac,
    stop() {
      if (timer) clearInterval(timer as NodeJS.Timeout);
    },
  };
}
