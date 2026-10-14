/**
 * The daemon's health endpoint (E5), split out from `main.ts` so it can be
 * tested without credentials — the reason its behaviour went unchecked until
 * a deploy failed on it.
 *
 * WHY THIS IS ITS OWN FILE. Deploy 2026-09-06 got every credential right and
 * still failed: Fly killed the machine because nothing was listening on 8084
 * when it looked. The daemon does have a health endpoint; it bound the port
 * LAST, after `makeSwitchboardOps` (21 seconds on that run) and
 * `irysUploaderFromEnv`. Both awaits were reached for the first time that
 * night — `SWITCHBOARD_QUEUE` and `IRYS_UPLOAD_KEY` had been empty until then
 * — so the startup path had never been exercised. The code did not regress;
 * it was never run.
 *
 * The fix is to bind first and let the payload tell the truth about what the
 * process is doing. That creates a second hazard, which is the one this file
 * is careful about: a daemon wedged in initialisation must NOT report healthy
 * forever. Past `STARTUP_BUDGET_MS` without reaching `ready`, /health returns
 * 503 — otherwise the fix would trade a visible failure for a silent one,
 * which is the exact fault it exists to remove.
 *
 * WHAT A 503 DOES, AND DOES NOT DO. Until 2026-10-14 this comment said the
 * platform restarts the machine on a 503. It does not: on Fly a failing
 * service check only takes the machine out of routing
 * (fly.io/docs/reference/health-checks). The process keeps running, and the
 * proxy stops forwarding requests to it, so the probe in `backend-watch`
 * times out instead of reading this payload; `backend-status` prints the
 * check's last output. `backend-watch` starts a STOPPED machine and never
 * restarts a running one (its header). So a 503 is an alarm — backend-watch
 * goes red within a cycle — and recovery is either the condition clearing on
 * its own (the next tick that completes turns this back to 200) or a person
 * restarting the machine.
 *
 * PHASE-N-REVIEW: nothing restarts a daemon that is wedged rather than
 * failing. Observed 2026-10-11 → 10-14, where the cause was the RPC
 * provider's exhausted credit allowance, a restart would not have helped — the
 * same process went back to 200 on its next tick once credits were restored,
 * after 63 hours on 503 with no restart. For
 * a tick stuck on a socket that never answers it is the remedy, and
 * backend-watch is forbidden it by design. Whether to allow it is a founder
 * call, not this file's.
 *
 * Structure follows `backend/detection/src/server.ts`: a pure function the
 * specs exercise directly, and a thin server around it.
 */

import { createServer, type Server } from 'http';
import { serveMetricsIfPrometheus } from '../../_shared/src/prometheus';
import type { Monitor } from '../../_shared/src/monitor';
import type { TickReport } from './daemon';
import { formatSol } from './startup';

const SERVICE = 'daemon';

/**
 * How long initialisation may take before the daemon is treated as stuck.
 * The measured path is ~25s (Switchboard queue fetch plus the Irys uploader);
 * 120s leaves generous headroom for a slow RPC without letting a genuinely
 * wedged process sit there looking fine.
 */
// Raised from 120s on 2026-09-08. This is the budget for the WHOLE start, and
// the start grew: Switchboard (45s) + Irys (45s) + the OFAC mirror (150s) can
// legitimately exceed two minutes now that the daemon screens winners. A stuck
// detector that fires during a healthy boot is worse than none — it restarts a
// process that was going to succeed, forever, and every restart begins the same
// slow load again.
//
// It stays a real bound rather than being removed: past this the daemon has
// genuinely failed to start and a restart is the right answer. The number is
// the sum of the steps it must contain, plus slack, and it moves when they do.
export const STARTUP_BUDGET_MS = 300_000;

/**
 * How long a READY daemon may go without completing a tick before /health
 * says so with a 503 (audit 2026-09-11, C-05 / C-22 / C-27 / E-04). Until
 * 2026-09-12 a ready daemon could never report unhealthy again: a tick wedged
 * on a vendor socket that never answered left `lastTick.at` frozen while the
 * endpoint kept answering 200, and both manuals' "alert on `at` going stale"
 * was implemented by nothing.
 *
 * PHASE-N-REVIEW: fifteen minutes. A normal tick takes seconds; the longest
 * legitimate one is a settlement whose winner screening runs once per tied
 * winner (up to ~13 s each on the vendor's retry budget), so a 52-way tie
 * could approach eleven minutes. The budget sits above that so a healthy
 * worst case never reports itself unhealthy, and well below the twelve-hour
 * review window so a wedged daemon raises the alarm long before any clock it
 * drives matters (it is not restarted automatically — see the file header).
 * Not a founder number; tune from measured ticks.
 */
export const STALE_TICK_MS = 15 * 60_000;

/** Where initialisation has got to. `ready` means the tick loop is running. */
export type DaemonPhase = 'starting' | 'connecting' | 'switchboard' | 'irys' | 'ready';

/**
 * Mutable startup/liveness state. `main()` holds one of these and updates it
 * in place as each step completes; the server closes over the same object.
 */
export interface DaemonHealth {
  phase: DaemonPhase;
  /** `Date.now()` at process start — the clock the startup budget runs on. */
  readonly startedAtMs: number;
  lastTick: { at: string; report: TickReport } | null;
  /**
   * The settlement signer's balance in lamports, refreshed each tick. It pays
   * every fee and every account rent the daemon incurs; startup refuses below
   * a floor (startup.ts), and this is here so a slow drain toward that floor
   * is visible without waiting for a restart to catch it. `null` until first
   * read. Lamports, integer — no float touches a balance.
   */
  settlementLamports: bigint | null;
  /**
   * Whether the daemon tells the indexer where each settled pool's bundle
   * is (startup.ts `announceVerdict`, audit 2026-09-11 D-02). Absent until
   * decided during startup. Reported so `backend-status` shows an archive
   * that will never fill on its own, rather than the log alone.
   */
  announce?: 'on' | 'off';
  /**
   * `Date.now()` when `phase` became `ready` — the point the tick clock
   * starts from, so a daemon that is ready but has never completed a tick is
   * judged against the same staleness budget as one whose ticks stopped.
   */
  readyAtMs?: number;
}

export function newDaemonHealth(startedAtMs: number = Date.now()): DaemonHealth {
  return { phase: 'starting', startedAtMs, lastTick: null, settlementLamports: null };
}

/**
 * The /health contract, as a pure function of state and the current time.
 *
 *   ready, a tick within the staleness budget → 200 { ready: true }
 *   ready, no tick for STALE_TICK_MS         → 503 — the loop is wedged; restart it
 *   still starting, within budget            → 200 { ready: false } — do not kill it
 *   still starting, past budget              → 503 — it is stuck; restart it
 *
 * `lastTick` is the liveness signal once running. Since 2026-09-12 the
 * endpoint judges its age itself rather than leaving that to a platform
 * check nobody had written (audit 2026-09-11, C-27).
 */
export function healthPayload(
  state: DaemonHealth,
  nowMs: number
): { status: number; body: Record<string, unknown> } {
  const ready = state.phase === 'ready';
  // Named `uptimeMs`, not `startingForMs`: it keeps counting once ready, so a
  // healthy daemon reporting `startingForMs: 97171` reads as "has been
  // starting for 97 seconds". An operator should not need the source to read
  // the field.
  const uptimeMs = nowMs - state.startedAtMs;
  const stuck = !ready && uptimeMs > STARTUP_BUDGET_MS;
  // Once ready, the last completed tick (or the moment of readiness, before
  // the first one) must be younger than the staleness budget.
  const lastTickAtMs =
    state.lastTick === null ? (state.readyAtMs ?? state.startedAtMs) : Date.parse(state.lastTick.at);
  const sinceTickMs = ready ? nowMs - lastTickAtMs : null;
  const stale = ready && sinceTickMs !== null && sinceTickMs > STALE_TICK_MS;
  const unhealthy = stuck || stale;
  return {
    status: unhealthy ? 503 : 200,
    body: {
      ok: !unhealthy,
      ready,
      service: SERVICE,
      phase: state.phase,
      uptimeMs,
      settlementSol:
        state.settlementLamports === null ? null : formatSol(state.settlementLamports),
      bundleAnnounce: state.announce ?? null,
      ...(stuck
        ? {
            error: `still ${state.phase} after ${STARTUP_BUDGET_MS}ms — initialisation is stuck`,
          }
        : {}),
      ...(stale
        ? {
            error:
              `no tick completed for ${sinceTickMs}ms (budget ${STALE_TICK_MS}ms) — ` +
              `the loop is wedged on something that will not answer; restart`,
            sinceTickMs,
          }
        : {}),
      lastTick:
        state.lastTick === null
          ? null
          : {
              at: state.lastTick.at,
              opened: state.lastTick.report.opened.length,
              cranked: state.lastTick.report.cranked.length,
              refundsTriggered: state.lastTick.report.refundsTriggered.length,
              sealedAtDeadline: state.lastTick.report.sealedAtDeadline.length,
              released: state.lastTick.report.released.length,
              nextPlacePaid: state.lastTick.report.nextPlacePaid.length,
              held: state.lastTick.report.held.length,
              published: state.lastTick.report.published.length,
              errors: state.lastTick.report.errors.length,
            },
    },
  };
}

/**
 * Serve /health on `port`. Called as the FIRST thing `main()` does — before
 * any credential, database handle or network fetch — so the platform can see
 * the process from the moment it starts.
 */
export function serveDaemonHealth(
  state: DaemonHealth,
  port: number,
  now: () => number = Date.now,
  /** When the Prometheus sink is selected, `/metrics` is served beside `/health`. */
  monitor?: Monitor
): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const { status, body } = healthPayload(state, now());
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    if (monitor && serveMetricsIfPrometheus(monitor, req, res)) {
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => {
    console.log(`${SERVICE}: health on :${port} (reporting startup phase until ready)`);
  });
  return server;
}
