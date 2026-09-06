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
 * 503 and the platform restarts it — otherwise the fix would trade a visible
 * failure for a silent one, which is the exact fault it exists to remove.
 *
 * Structure follows `backend/detection/src/server.ts`: a pure function the
 * specs exercise directly, and a thin server around it.
 */

import { createServer, type Server } from 'http';
import type { TickReport } from './daemon';
import { formatSol } from './startup';

const SERVICE = 'daemon';

/**
 * How long initialisation may take before the daemon is treated as stuck.
 * The measured path is ~25s (Switchboard queue fetch plus the Irys uploader);
 * 120s leaves generous headroom for a slow RPC without letting a genuinely
 * wedged process sit there looking fine.
 */
export const STARTUP_BUDGET_MS = 120_000;

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
}

export function newDaemonHealth(startedAtMs: number = Date.now()): DaemonHealth {
  return { phase: 'starting', startedAtMs, lastTick: null, settlementLamports: null };
}

/**
 * The /health contract, as a pure function of state and the current time.
 *
 *   ready                        → 200 { ready: true }
 *   still starting, within budget → 200 { ready: false } — do not kill it
 *   still starting, past budget   → 503 — it is stuck; restart it
 *
 * `lastTick` is the liveness signal once running: a hung RPC shows up as a
 * stale `at`, which is what the platform's checks alert on.
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
  return {
    status: stuck ? 503 : 200,
    body: {
      ok: !stuck,
      ready,
      service: SERVICE,
      phase: state.phase,
      uptimeMs,
      settlementSol:
        state.settlementLamports === null ? null : formatSol(state.settlementLamports),
      ...(stuck
        ? {
            error: `still ${state.phase} after ${STARTUP_BUDGET_MS}ms — initialisation is stuck`,
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
  now: () => number = Date.now
): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const { status, body } = healthPayload(state, now());
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => {
    console.log(`${SERVICE}: health on :${port} (reporting startup phase until ready)`);
  });
  return server;
}
