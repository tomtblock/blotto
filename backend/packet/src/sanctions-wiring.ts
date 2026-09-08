/**
 * The packet service's sanctions wiring (Phase 2, Stage B): the shared
 * boot-time wiring from `@blotto/sanctions`, adapted to this service's
 * `SanctionsList` seam.
 *
 * Everything that used to live here — selection, the boot-time mirror load,
 * the refresh schedule, the failed-source log — moved into
 * `sanctions/src/wire.ts` when the settlement daemon became the second
 * service that screens (Stage F). It needs the identical guarantees at the
 * other end of a pool's life, and two implementations of "load the list
 * before you answer with it" is exactly the divergence this codebase keeps
 * refusing to accept. That module's header carries the posture; what remains
 * here is this service's half of the fork.
 *
 * In its own module for the reason `signer-select.ts` gives: `main.ts` imports
 * in Postgres and the sealing store and cannot be unit-tested, and the branch
 * that fails on devnet is always the untested one. Everything here is
 * exercised by `test/sanctions-wiring.spec.ts` through `issuePacket` itself,
 * so "a listed wallet is refused a packet" is a test, not a reading.
 *
 * This service's decision on a FAILED screening: `issuePacket` refuses the
 * entry and logs the vendor's own error text (`service.ts`, the catch
 * branch). Nothing to add here.
 */

import { asSanctionsList, wireScreening } from '../../sanctions/src';
import type { OfacSdnMirror, WiringOptions } from '../../sanctions/src';
import type { SanctionsList } from './service';

export { ofacRefreshIntervalMs } from '../../sanctions/src';
export type { WiringOptions } from '../../sanctions/src';

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

/**
 * Select, load, schedule, adapt. Throws when nothing is configured or the
 * mirror cannot load — the caller lets that end the process.
 */
export async function wireSanctions(
  env: NodeJS.ProcessEnv,
  opts: WiringOptions = {}
): Promise<WiredSanctions> {
  const wired = await wireScreening(env, SERVICE, opts);
  return {
    list: asSanctionsList(wired.check),
    describe: wired.describe,
    ofac: wired.ofac,
    stop: () => wired.stop(),
  };
}
