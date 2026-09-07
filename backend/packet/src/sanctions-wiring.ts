/**
 * The packet service's sanctions wiring (Phase 2, Stage B): the selected
 * screener from `@blotto/sanctions`, adapted to this service's `SanctionsList`
 * seam, with the OFAC mirror loaded BEFORE the service accepts traffic and
 * refreshed on a schedule after it.
 *
 * In its own module for the reason `signer-select.ts` gives: `main.ts` pulls
 * in Postgres and the sealing store and cannot be unit-tested, and the branch
 * that fails on devnet is always the untested one. Everything here is
 * exercised by `test/sanctions-wiring.spec.ts` through `issuePacket` itself,
 * so "a listed wallet is refused a packet" is a test, not a reading.
 *
 * Posture, matching the geo gate:
 *
 *   - NOTHING CONFIGURED → the service refuses to boot. Until 2026-09-07 this
 *     seam was wired to `async () => false` and the header said so; a packet
 *     was never screened. Absence of a vendor key must never mean "screen
 *     against nothing" (the same rule `ALLOW_DEV_ENTRY_SIGNER` enforces for
 *     the signer), so the selector throws and `main` exits non-zero.
 *   - OFAC MIRROR CANNOT LOAD AT BOOT → the service refuses to boot. With the
 *     mirror the only source, every entry would be refused anyway (a mirror
 *     that is not loaded is a failed source, never a clean one); failing
 *     loudly at boot is the same outcome with a log line that says why.
 *   - OFAC REFRESH FAILS LATER → logged; the previous list is KEPT and keeps
 *     answering until it is older than its max age, when the mirror refuses.
 *     A refresh runs at a quarter of the max age (36 h → every 9 h), so a
 *     single failed download never reaches the refusal.
 *   - A LOOKUP FAILS AT ENTRY → `issuePacket` already refuses and logs the
 *     vendor's own error text (`service.ts`, the catch branch). Nothing to
 *     add here.
 *   - A SOURCE FAILS BESIDE ANOTHER THAT ANSWERED → the verdict still decides
 *     on `listed`, and the failed source is logged here so the operator can
 *     see a vendor degrading before it is the only one left.
 */

import { asSanctionsList, buildSanctions } from '../../sanctions/src';
import type { OfacMirrorSnapshot, OfacSdnMirror, SanctionsCheck } from '../../sanctions/src';
import type { SanctionsList } from './service';

const SERVICE = 'packet';

export interface WiredSanctions {
  /** What `PacketServiceDeps.sanctions` takes. */
  readonly list: SanctionsList;
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
 * visible to the operator. The wallet is not logged: the geo log lines name
 * an IP because an operator chasing a stalled fill needs it; nothing here
 * needs the address, and the verdict's `listed` is all the boolean view
 * carries.
 */
function withFailureLog(check: SanctionsCheck, warn: (line: string) => void): SanctionsCheck {
  return {
    async screen(address) {
      const verdict = await check.screen(address);
      if (verdict.failed.length > 0) {
        warn(
          `${SERVICE}: sanctions source(s) FAILED [${verdict.failed.join(', ')}] — decided on ` +
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
 * Select, load, schedule, adapt. Throws when nothing is configured or the
 * mirror cannot load — the caller lets that end the process.
 */
export async function wireSanctions(
  env: NodeJS.ProcessEnv,
  opts: WiringOptions = {}
): Promise<WiredSanctions> {
  const schedule = opts.schedule ?? ((fn, ms) => setInterval(fn, ms));
  const log = opts.log ?? ((line) => console.log(line));
  const warn = opts.warn ?? ((line) => console.warn(line));

  const built = buildSanctions(env, SERVICE);
  let timer: { unref?(): unknown } | unknown = null;

  if (built.ofac) {
    const ofac = built.ofac;
    // Boot-time load: a throw here is fatal by design (module doc).
    const first = await ofac.refresh();
    log(`${SERVICE}: ofac-sdn mirror loaded — ${describeSnapshot(first)}`);
    const every = ofacRefreshIntervalMs(ofac.maxAgeMs);
    timer = schedule(() => {
      ofac.refresh().then(
        (s) => log(`${SERVICE}: ofac-sdn mirror refreshed — ${describeSnapshot(s)}`),
        (e: unknown) =>
          warn(
            `${SERVICE}: ofac-sdn mirror refresh FAILED (previous list kept, refuses past ` +
              `${Math.floor(ofac.maxAgeMs / 3_600_000)} h): ${e instanceof Error ? e.message : String(e)}`
          )
      );
    }, every);
    // Never hold the process open for the schedule alone.
    if (timer && typeof (timer as { unref?: unknown }).unref === 'function') {
      (timer as { unref(): unknown }).unref();
    }
    log(`${SERVICE}: ofac-sdn mirror refresh every ${Math.floor(every / 60_000)} min`);
  }

  return {
    list: asSanctionsList(withFailureLog(built.check, warn)),
    describe: built.describe,
    ofac: built.ofac,
    stop() {
      if (timer) clearInterval(timer as NodeJS.Timeout);
    },
  };
}
