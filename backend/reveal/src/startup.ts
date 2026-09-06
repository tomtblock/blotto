/**
 * Startup step instrumentation for the settlement daemon (E5).
 *
 * WHY THIS EXISTS. On 2026-09-06 the daemon deployed successfully, logged
 * `VRF = SWITCHBOARD On-Demand`, and then went silent — no ready line, no
 * ticks, no error, no crash. It sat there. The only thing between that log
 * line and the tick loop is a network call into a vendor SDK with no timeout,
 * so a stall there is indistinguishable from work.
 *
 * That silence is expensive in a way worth stating, because it is not
 * obvious: past its startup budget the daemon's /health correctly answers
 * **503**, and Fly's proxy does not route to an instance whose check is
 * failing — so the endpoint that knows what is wrong becomes unreachable
 * precisely when it has something to say. A stalled daemon can only explain
 * itself through the log. Hence: every startup step is named, timed, logged,
 * and bounded.
 *
 * A timeout here is deliberately FATAL rather than a retry. `main.ts` already
 * refuses to start on an unconfigured seam; a vendor that will not answer is
 * the same class of thing, and a process that exits with a named reason is
 * restartable and diagnosable, where one that hangs is neither.
 */

/** Raised when a startup step outruns its budget. Names the step. */
export class StartupTimeout extends Error {
  constructor(
    readonly step: string,
    readonly budgetMs: number
  ) {
    super(
      `${step} did not finish within ${budgetMs}ms. This step calls out to a ` +
        `third party; it has not failed, it has not answered. The process is ` +
        `exiting rather than sitting in a state where its own health endpoint ` +
        `cannot be reached to say so.`
    );
    this.name = 'StartupTimeout';
  }
}

/**
 * Run one startup step under a named budget, logging its start and its
 * elapsed time. Rejects with `StartupTimeout` if the budget is exceeded.
 *
 * The pending work is NOT cancelled — a Promise cannot be — so the caller is
 * expected to treat a timeout as fatal rather than continue alongside it.
 */
export async function step<T>(
  name: string,
  budgetMs: number,
  work: () => Promise<T>,
  log: (line: string) => void = console.log,
  now: () => number = Date.now
): Promise<T> {
  const startedAt = now();
  log(`${name}: starting (budget ${budgetMs}ms)`);
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StartupTimeout(name, budgetMs)), budgetMs);
        // Never hold the process open on this timer alone.
        timer.unref?.();
      }),
    ]);
    log(`${name}: done in ${now() - startedAt}ms`);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
