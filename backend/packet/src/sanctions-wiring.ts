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
 *
 * Since 2026-09-12 this module also carries the REFUSAL LOG (audit
 * 2026-09-11, B-36): a wallet refused for a sanctions match is written to
 * `sanctions_refusals` with the list that matched. It is attached to the
 * screening seam rather than passed separately through `PacketServiceDeps`
 * so that the existing wiring in `main.ts` picks it up unchanged — one seam
 * in, one seam out, and no deployment that forgets a new dependency and
 * keeps no record without noticing.
 */

import { asSanctionsList, wireScreening } from '../../sanctions/src';
import {
  MemorySanctionsRefusalLog,
  PgSanctionsRefusalLog,
  type SanctionsRefusalLog,
} from '../../sanctions/src/refusal-log';
import type { OfacSdnMirror, WiringOptions } from '../../sanctions/src';
import { createPool } from '../../_shared/src/db';
import { loadPostgresConfig } from '../../_shared/src/config';
import type { SanctionsList, SanctionsRefusal } from './service';

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
  /** False when the mirror is configured but did not load (C-18). */
  readonly ofacLoaded: boolean;
  /** Cancel the refresh schedule (tests; graceful shutdown). */
  stop(): void;
}

export interface PacketWiringOptions extends WiringOptions {
  /**
   * Where refusals are written. Defaults to Postgres when
   * `BLOTTO_DATABASE_URL` is set, and to an in-memory log otherwise — which
   * is a development posture, and says so at boot.
   */
  refusals?: SanctionsRefusalLog;
}

/**
 * Choose the refusal log. Its own small pool rather than the service's:
 * `wireSanctions` is handed the environment, not the service's `pg.Pool`,
 * and a pool is lazy — no connection is opened until a refusal is written,
 * which on a healthy day is never.
 */
function buildRefusalLog(
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
  warn: (line: string) => void
): { log: SanctionsRefusalLog; close(): void } {
  if ((env.BLOTTO_DATABASE_URL ?? '').trim() === '') {
    warn(
      `${SERVICE}: sanctions refusals are recorded IN MEMORY — BLOTTO_DATABASE_URL is unset, so ` +
        `a refused entry survives only as long as this process. Development only.`
    );
    return { log: new MemorySanctionsRefusalLog(), close: () => undefined };
  }
  const pool = createPool({ ...loadPostgresConfig(env), poolMax: 1 });
  log(`${SERVICE}: sanctions refusals recorded to sanctions_refusals`);
  return { log: new PgSanctionsRefusalLog(pool), close: () => void pool.end() };
}

/**
 * Select, load, schedule, adapt. Throws when nothing is configured or when
 * the mirror cannot load and is the only screener (see `wire.ts`).
 */
export async function wireSanctions(
  env: NodeJS.ProcessEnv,
  opts: PacketWiringOptions = {}
): Promise<WiredSanctions> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  const wired = await wireScreening(env, SERVICE, opts);
  const refusals = opts.refusals
    ? { log: opts.refusals, close: () => undefined }
    : buildRefusalLog(env, log, warn);

  const view = asSanctionsList(wired.check);
  const list: SanctionsList = {
    isSanctioned: (wallet, country) => view.isSanctioned(wallet, country),
    screen: (wallet) => view.screen(wallet),
    recordRefusal: (refusal: SanctionsRefusal) =>
      refusals.log.record({
        service: SERVICE,
        wallet: refusal.wallet,
        pool: refusal.pool,
        screenedAt: refusal.screening.checkedAt,
        matches: refusal.screening.matches.map((m) => ({
          source: m.source,
          listName: m.listName,
          entityName: m.entityName,
          entityId: m.entityId,
        })),
        consulted: [...refusal.screening.consulted],
        failed: [...refusal.screening.failed],
        country: refusal.country,
        ipPrefix: refusal.ipPrefix,
      }),
  };

  return {
    list,
    describe: wired.describe,
    ofac: wired.ofac,
    // A getter, not a snapshot: a mirror that failed at boot can load on a
    // later recovery tick, and a health payload reading a value frozen at
    // boot would go on saying the fallback is absent for ever.
    get ofacLoaded() {
      return wired.ofacLoaded;
    },
    stop: () => {
      wired.stop();
      refusals.close();
    },
  };
}
