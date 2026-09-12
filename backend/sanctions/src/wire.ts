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
 * Posture, as amended 2026-09-12 by audit findings C-18 and B-28:
 *
 *   - NOTHING CONFIGURED → the caller refuses to boot. Absence of a vendor
 *     key must never mean "screen against nothing" (`select.ts` throws).
 *   - OFAC MIRROR CANNOT LOAD AT BOOT → RETRIED with backoff inside a
 *     bounded budget, and then:
 *       * mirror is the ONLY source → the caller refuses to boot. Every
 *         screening would fail anyway; failing at boot is the same outcome
 *         with a log line that says why.
 *       * a vendor is configured beside it → the service STARTS, screening
 *         on the vendors, with a loud alert and a fast recovery schedule.
 *         See `loadMirrorAtBoot` for why, in full.
 *   - OFAC REFRESH FAILS LATER → logged; the previous list is KEPT and keeps
 *     answering until it is older than its max age, when the mirror refuses.
 *     A refresh runs at a quarter of the max age (36 h → every 9 h), so a
 *     single failed download never reaches the refusal.
 *   - THE MIRROR APPROACHES OR PASSES ITS MAX AGE → a monitor alert, not a
 *     console line (B-28). The cliff is what stops entry and holds every
 *     payment in the staged production config, where the mirror is the only
 *     assured source; it was announced by nothing a pager could see.
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
import { ALERT, METRIC } from '../../_shared/src/metrics';
import { buildMonitor, loadMonitor, type Monitor } from '../../_shared/src/monitor';

export interface WiredScreening {
  /** The screener, wrapped so a partially failed source set is logged. */
  readonly check: SanctionsCheck;
  /** One line per source, for the startup log. Never contains a secret. */
  readonly describe: readonly string[];
  /** The mirror when configured, for a health payload. `null` otherwise. */
  readonly ofac: OfacSdnMirror | null;
  /**
   * False when the mirror is configured but could not be loaded at boot and
   * the service started on its other sources anyway (C-18). A health payload
   * should say so: the fallback is not there.
   */
  readonly ofacLoaded: boolean;
  /** Cancel the refresh schedule (tests; graceful shutdown). */
  stop(): void;
}

export interface WiringOptions {
  /** Injected so a test can drive the schedule; defaults to the global timer. */
  schedule?: (fn: () => void, ms: number) => { unref?(): unknown } | unknown;
  log?: (line: string) => void;
  warn?: (line: string) => void;
  /**
   * The metrics/alert sink. Defaults to the one this process's environment
   * selects (`BLOTTO_MONITOR_SINK`), so neither caller's `main.ts` has to
   * pass anything for the staleness alerts to reach a pager.
   */
  monitor?: Monitor;
  /** Boot-load retry policy — see `loadMirrorAtBoot`. Tests drive it. */
  boot?: BootLoadOptions;
}

/** The refresh cadence: a quarter of the mirror's max age. */
export function ofacRefreshIntervalMs(maxAgeMs: number): number {
  return Math.max(60_000, Math.floor(maxAgeMs / 4));
}

/**
 * How often to LOOK at the mirror's age, as opposed to how often to refresh
 * it. A ninth of the refresh cadence — hourly at the 36 h default — so the
 * approach to the cliff is reported with useful resolution rather than in
 * nine-hour steps. Reading the age costs nothing: it is arithmetic on a
 * timestamp, never a fetch.
 */
export function ofacStalenessCheckIntervalMs(maxAgeMs: number): number {
  return Math.min(3_600_000, Math.max(60_000, Math.floor(ofacRefreshIntervalMs(maxAgeMs) / 9)));
}

/**
 * The fraction of the max age at which "approaching" starts.
 *
 * Derived, not chosen: a refresh runs every quarter of the max age, so ages
 * up to 50% are reachable with ONE failed refresh and are not evidence of
 * anything. 75% is the first age that requires three consecutive failures —
 * i.e. the first age at which a transient blip is ruled out — and it leaves a
 * quarter of the window (9 h at the default) to act in before the mirror
 * stops answering.
 */
export const OFAC_STALE_SOON_FRACTION = 0.75;

export interface BootLoadOptions {
  /** Attempts before giving up. Default 4. */
  attempts?: number;
  /**
   * Total wall-clock budget for all attempts. Default 120 s.
   *
   * It is a BUDGET, not a per-attempt timeout: each attempt is given what is
   * left of it, so four attempts cannot become four two-minute downloads.
   * The daemon runs this inside a 150 s startup step
   * (`reveal/src/main.ts`), and a loader that outran that step would report
   * the step's generic timeout instead of the real reason.
   */
  budgetMs?: number;
  /** First backoff ceiling in ms; doubles per attempt, with full jitter. Default 2000. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const BOOT_DEFAULTS = { attempts: 4, budgetMs: 120_000, backoffMs: 2_000 };

/**
 * How often to retry a mirror that never loaded, while the service runs on
 * its other sources. Deliberately far faster than the ordinary refresh
 * cadence (9 h at the default): the point of C-18 is that an outage at
 * restart must not need a human, and a nine-hour wait to re-try a download
 * that now takes ninety seconds is a human's problem by any other name.
 */
export const OFAC_RECOVERY_INTERVAL_MS = 600_000;

export interface BootLoadResult {
  snapshot: OfacMirrorSnapshot | null;
  attempts: number;
  /** The last failure, when every attempt failed. */
  error?: Error;
}

/**
 * Load the mirror at boot, retrying transient failure inside a bounded
 * budget.
 *
 * WHY RETRY AT ALL (audit 2026-09-11, C-18). The load is a ~29 MB download
 * from a government host, in a REQUIRED boot path for two services: the
 * packet service does not open its listener until it returns, and the daemon
 * budgets it as a startup step. One attempt, no retry, throw on failure — so
 * a Treasury-host blip during a deploy or a machine restart crash-looped both
 * services, and the platform's answer to a crash loop is to restart faster,
 * which is the worst possible response to an upstream that is struggling.
 *
 * WHAT HAPPENS WHEN IT ULTIMATELY FAILS — the decision this comment exists
 * to record. **Bounded retry, then refuse if the mirror is the only screener,
 * and start without it if a vendor is configured beside it.** The rejected
 * alternative was a cached copy of the list on disk, and it was rejected for
 * three reasons:
 *
 *   1. It is already available, and it belongs to the operator, not to this
 *      code. `SANCTIONS_OFAC_SDN_PATH` loads the list from a local file
 *      instead of the network; an operator who wants a staged copy on the
 *      machine has one today, deliberately, with no second code path and no
 *      question about which copy is authoritative.
 *   2. A cache that this code wrote and read would have to carry the age of
 *      the DATA, not the age of the file, or it would silently defeat the
 *      one property the mirror exists to hold — a stale list refuses to
 *      answer rather than saying "not listed" (`ofac-sdn.ts`, property 1).
 *      The published date is day-granular, so the reconstructed age would be
 *      coarser than the 36 h window it is compared against.
 *   3. On the platform this runs on, the filesystem a service restarts onto
 *      is not the filesystem it wrote to — a deploy replaces it — so the
 *      cache would be empty in the most common restart of all, and present
 *      only in the case a volume was provisioned for it. A recovery path
 *      that is usually absent is worse than none: it invites a confidence it
 *      has not proven.
 *
 * What the retry does NOT do is pretend an unavailable list is a clean one.
 * Every path here ends in either a loaded mirror, a refusal, or a service
 * that screens on vendors with the fallback loudly absent.
 */
export async function loadMirrorAtBoot(
  ofac: OfacSdnMirror,
  o: BootLoadOptions = {},
  report: (line: string) => void = () => undefined
): Promise<BootLoadResult> {
  const attempts = o.attempts ?? BOOT_DEFAULTS.attempts;
  const budgetMs = o.budgetMs ?? BOOT_DEFAULTS.budgetMs;
  const backoffMs = o.backoffMs ?? BOOT_DEFAULTS.backoffMs;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = o.random ?? Math.random;
  const now = o.now ?? Date.now;

  const deadline = now() + budgetMs;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    try {
      const snapshot = await ofac.refresh({ timeoutMs: remaining });
      return { snapshot, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const left = deadline - now();
      if (attempt >= attempts || left <= 0) break;
      // Full jitter, as everywhere else here: two services restarting
      // together must not retry a struggling host in lockstep.
      const wait = Math.min(left, Math.floor(random() * backoffMs * 2 ** (attempt - 1)));
      report(
        `ofac-sdn mirror load attempt ${attempt}/${attempts} FAILED (${lastError.message}) — ` +
          `retrying in ${wait}ms, ${Math.floor(left / 1000)}s of budget left`
      );
      await sleep(wait);
    }
  }
  return { snapshot: null, attempts: attempts, error: lastError ?? new Error('ofac-sdn: boot budget spent') };
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
 * Select, load, schedule. Throws when nothing is configured, or when the
 * mirror cannot load and is the only thing that could have screened.
 */
export async function wireScreening(
  env: NodeJS.ProcessEnv,
  service: string,
  opts: WiringOptions = {}
): Promise<WiredScreening> {
  const schedule = opts.schedule ?? ((fn, ms) => setInterval(fn, ms));
  const log = opts.log ?? ((line) => console.log(line));
  const warn = opts.warn ?? ((line) => console.warn(line));
  const monitor = opts.monitor ?? buildMonitor(loadMonitor(env), service);

  const built = buildSanctions(env, service);
  let refreshTimer: { unref?(): unknown } | unknown = null;
  let staleTimer: { unref?(): unknown } | unknown = null;
  let ofacLoaded = false;

  if (built.ofac) {
    const ofac = built.ofac;
    const otherSources = built.sources.filter((s) => s !== 'ofac-sdn');

    const boot = await loadMirrorAtBoot(ofac, opts.boot, (line) => warn(`${service}: ${line}`));
    if (boot.snapshot) {
      ofacLoaded = true;
      log(
        `${service}: ofac-sdn mirror loaded — ${describeSnapshot(boot.snapshot)}` +
          (boot.attempts > 1 ? ` (after ${boot.attempts} attempts)` : '')
      );
    } else {
      const why = boot.error?.message ?? 'unknown';
      monitor.recordEvent(METRIC.sanctions.ofacBootRetry, { outcome: 'exhausted' });
      if (otherSources.length === 0) {
        // The mirror is the whole screener. Starting would mean issuing
        // packets nothing screened, which is the one thing this module
        // exists to prevent — so the caller ends the process, as before.
        monitor.alert(ALERT.sanctions.ofacBootFailed, {
          service,
          sources: built.sources,
          started: false,
          attempts: boot.attempts,
          error: why,
        });
        throw new Error(
          `${service}: the OFAC mirror is the only configured screening source and it could ` +
            `not be loaded after ${boot.attempts} attempts — ${why}. Refusing to start: a ` +
            `service that starts here screens nobody. Stage a second source, or set ` +
            `SANCTIONS_OFAC_SDN_PATH to a local copy of the list, and restart.`
        );
      }
      // PHASE-2-REVIEW (2026-09-12, audit C-18): starting here is a
      // deliberate narrowing of the old "mirror will not load → refuse"
      // rule, not a relaxation of the posture. The posture is that nothing
      // is ever issued UNSCREENED; with a vendor configured, screening still
      // happens on every entry, the composite already treats a source that
      // throws as `failed` while the others decide, and every verdict says
      // so out loud. Killing the process instead would take the entry gate
      // down for an outage at a FALLBACK, which is the crash loop C-18
      // describes.
      monitor.alert(ALERT.sanctions.ofacBootFailed, {
        service,
        sources: built.sources,
        started: true,
        screeningOn: otherSources,
        attempts: boot.attempts,
        error: why,
      });
      warn(
        `${service}: ofac-sdn mirror FAILED to load after ${boot.attempts} attempts — ${why}. ` +
          `Continuing on [${otherSources.join(', ')}]: every entry is still screened, but the ` +
          `fallback is absent, so a vendor outage now has nothing behind it. Retrying every ` +
          `${Math.floor(OFAC_RECOVERY_INTERVAL_MS / 60_000)} min.`
      );
    }

    // While the mirror has never loaded, retry at the recovery cadence; once
    // it has, refresh at a quarter of its max age. The schedule is replaced
    // on the first success rather than left fast, so a working mirror is not
    // downloaded every ten minutes.
    const normalEvery = ofacRefreshIntervalMs(ofac.maxAgeMs);
    const refreshTick = (): void => {
      ofac.refresh().then(
        (s) => {
          const wasLoaded = ofacLoaded;
          ofacLoaded = true;
          monitor.recordEvent(METRIC.sanctions.ofacRefresh, { outcome: 'ok' });
          log(`${service}: ofac-sdn mirror refreshed — ${describeSnapshot(s)}`);
          if (!wasLoaded) {
            log(
              `${service}: ofac-sdn mirror RECOVERED — back to a refresh every ` +
                `${Math.floor(normalEvery / 60_000)} min`
            );
            cancel(refreshTimer);
            refreshTimer = arm(schedule, refreshTick, normalEvery);
          }
        },
        (e: unknown) => {
          monitor.recordEvent(METRIC.sanctions.ofacRefresh, { outcome: 'failed' });
          warn(
            `${service}: ofac-sdn mirror refresh FAILED (previous list kept, refuses past ` +
              `${Math.floor(ofac.maxAgeMs / 3_600_000)} h): ${e instanceof Error ? e.message : String(e)}`
          );
        }
      );
    };
    const firstEvery = ofacLoaded ? normalEvery : OFAC_RECOVERY_INTERVAL_MS;
    refreshTimer = arm(schedule, refreshTick, firstEvery);
    log(`${service}: ofac-sdn mirror refresh every ${Math.floor(firstEvery / 60_000)} min`);

    // The staleness watch (B-28). Separate from the refresh because looking
    // at the age is free and downloading 29 MB is not.
    const watch = makeStalenessWatch(ofac, service, monitor, warn);
    staleTimer = arm(schedule, watch, ofacStalenessCheckIntervalMs(ofac.maxAgeMs));
  }

  return {
    check: withFailureLog(built.check, service, warn),
    describe: built.describe,
    ofac: built.ofac,
    get ofacLoaded() {
      return ofacLoaded;
    },
    stop() {
      cancel(refreshTimer);
      cancel(staleTimer);
    },
  };
}

/** Schedule `fn`, never holding the process open for the timer alone. */
function arm(
  schedule: (fn: () => void, ms: number) => { unref?(): unknown } | unknown,
  fn: () => void,
  ms: number
): { unref?(): unknown } | unknown {
  const timer = schedule(fn, ms);
  if (timer && typeof (timer as { unref?: unknown }).unref === 'function') {
    (timer as { unref(): unknown }).unref();
  }
  return timer;
}

function cancel(timer: { unref?(): unknown } | unknown): void {
  if (timer) clearInterval(timer as NodeJS.Timeout);
}

/**
 * The staleness watch: one function, exported for its own test, that reads
 * the mirror's age and decides what to say about it.
 *
 * ALERT CADENCE. "Approaching" is raised once per crossing — it is
 * actionable, not urgent, and re-raising it hourly for nine hours would
 * teach an operator to mute it. "Past the limit" is raised on EVERY check:
 * at that point the mirror is answering nothing, and in the staged
 * production config that is the entry gate closed. It does not recover on
 * its own, and a state that does not recover on its own should keep saying
 * so.
 */
export function makeStalenessWatch(
  ofac: OfacSdnMirror,
  service: string,
  monitor: Monitor,
  warn: (line: string) => void
): () => void {
  let approachAnnounced = false;
  return () => {
    const ageMs = ofac.ageMs();
    if (ageMs === null) return; // never loaded; the boot path already said so
    const maxAgeMs = ofac.maxAgeMs;
    const ageHours = ageMs / 3_600_000;
    const limitHours = maxAgeMs / 3_600_000;
    monitor.reportGauge(METRIC.sanctions.ofacAgeHours, Math.floor(ageHours));

    if (ageMs > maxAgeMs) {
      approachAnnounced = true;
      monitor.alert(ALERT.sanctions.ofacStale, {
        service,
        ageHours: Math.floor(ageHours),
        limitHours: Math.floor(limitHours),
        consequence: 'the mirror refuses every screening until a refresh succeeds',
      });
      warn(
        `${service}: ofac-sdn mirror is ${Math.floor(ageHours)} h old, PAST its ${Math.floor(
          limitHours
        )} h limit — it is refusing to answer, and every screening it was the only source for fails`
      );
      return;
    }

    if (ageMs >= maxAgeMs * OFAC_STALE_SOON_FRACTION) {
      if (approachAnnounced) return;
      approachAnnounced = true;
      monitor.alert(ALERT.sanctions.ofacStaleSoon, {
        service,
        ageHours: Math.floor(ageHours),
        limitHours: Math.floor(limitHours),
        hoursLeft: Math.floor(limitHours - ageHours),
      });
      warn(
        `${service}: ofac-sdn mirror is ${Math.floor(ageHours)} h old and refuses to answer at ` +
          `${Math.floor(limitHours)} h — at least three consecutive refreshes have failed. ` +
          `${Math.floor(limitHours - ageHours)} h left to fix it.`
      );
      return;
    }

    // Back inside the healthy band: re-arm the approach alert so the NEXT
    // slide towards the cliff is announced too.
    approachAnnounced = false;
  };
}
