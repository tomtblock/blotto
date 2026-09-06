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

/**
 * The settlement signer pays for every instruction the daemon sends —
 * `open_pool`, `commit_vrf_seed`, `create_pass_collection`,
 * `reveal_pool_secret`, `commit_results`, `pay_prizes` — plus the rent for
 * every account those create.
 *
 * On 2026-09-06 it held nothing. The runbook's C6 said to generate and stage
 * the keypair and never said to fund it, so the keeper failed on
 * `open_pool` every fifteen seconds with Solana's message for an unfunded fee
 * payer, "Attempt to debit an account but found no record of a prior credit"
 * — accurate, and unrecognisable unless you already know what it means.
 *
 * Every other credentialed seam in `main.ts` is fail-closed with a named
 * message: no `SWITCHBOARD_QUEUE` and no `RANDOMNESS_ACCOUNT` → refuse; no
 * `IRYS_UPLOAD_KEY` → refuse. An empty fee payer is the same class of thing
 * and now refuses in the same place, saying so in words.
 */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Floor: 0.05 SOL, about three pools at the measured per-pool cost (roughly
 * 0.016 SOL — `Pool` PDA rent 0.00679, its vault 0.00089, the Switchboard
 * randomness and pass-collection accounts, and fees). Enough that the daemon
 * never opens a pool it cannot afford to finish settling.
 */
export const SETTLEMENT_FLOOR_LAMPORTS = 50_000_000n;

/** Integer-only lamports → SOL, for human eyes. Never fed back into an amount. */
export function formatSol(lamports: bigint): string {
  const sign = lamports < 0n ? '-' : '';
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, '0');
  return `${sign}${whole}.${frac}`;
}

export function assertCanPayFees(
  address: string,
  lamports: bigint,
  floorLamports: bigint = SETTLEMENT_FLOOR_LAMPORTS
): void {
  if (lamports >= floorLamports) return;
  throw new Error(
    `${SERVICE_LABEL}: the settlement signer ${address} holds ` +
      `${formatSol(lamports)} SOL, below the ${formatSol(floorLamports)} SOL floor. ` +
      `It pays the fee and the account rent for every instruction this daemon ` +
      `sends — open_pool, commit_vrf_seed, create_pass_collection, ` +
      `reveal_pool_secret, commit_results, pay_prizes — so with an empty ` +
      `signer the keeper cannot open a pool and fails once per tick with ` +
      `"Attempt to debit an account but found no record of a prior credit". ` +
      `Fund the address and restart. Refusing to run rather than retry that ` +
      `silently.`
  );
}

const SERVICE_LABEL = 'daemon';
