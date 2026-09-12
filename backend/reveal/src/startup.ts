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

/**
 * The floor for the UPLOAD wallet on mainnet, where every reveal bundle is a
 * paid upload. A bundle is tens of kilobytes; this is orders of magnitude of
 * headroom over one, and the point is only that an EMPTY upload wallet is
 * discovered at startup rather than at the first settlement — where, since
 * 2026-09-12, a failed publish no longer blocks payment but does leave a
 * pool unpublished (audit 2026-09-11, C-01).
 *
 * PHASE-N-REVIEW: 0.01 SOL is a judgement with an override in the call, not
 * a ratified number.
 */
export const UPLOAD_WALLET_FLOOR_LAMPORTS = 10_000_000n;

export interface UploadWalletVerdict {
  /** True only on mainnet below the floor: the daemon must not start. */
  refuse: boolean;
  message: string;
}

/**
 * What to do about the upload wallet's balance, by network.
 *
 * Devnet uploads are free-tier (publisher-irys.ts), so an empty wallet there
 * is recorded and never refused — refusing would stop a rehearsal for a
 * balance nothing on devnet spends. Mainnet uploads are paid, so below the
 * floor the daemon refuses to start, the same way it refuses an empty
 * settlement signer.
 */
export function uploadWalletVerdict(
  address: string,
  lamports: bigint,
  network: 'mainnet' | 'devnet',
  floorLamports: bigint = UPLOAD_WALLET_FLOOR_LAMPORTS
): UploadWalletVerdict {
  if (network === 'devnet') {
    return {
      refuse: false,
      message:
        `${SERVICE_LABEL}: upload wallet ${address} holds ${formatSol(lamports)} SOL ` +
        `(devnet uploads are free-tier; the balance is recorded, not required)`,
    };
  }
  if (lamports >= floorLamports) {
    return {
      refuse: false,
      message: `${SERVICE_LABEL}: upload wallet ${address} holds ${formatSol(lamports)} SOL`,
    };
  }
  return {
    refuse: true,
    message:
      `${SERVICE_LABEL}: the upload wallet ${address} holds ${formatSol(lamports)} SOL, ` +
      `below the ${formatSol(floorLamports)} SOL floor. On mainnet it pays for every ` +
      `reveal bundle's permanent upload; with an empty wallet every settlement ` +
      `would pay the winner and then fail to publish, leaving the pool unverifiable ` +
      `until someone noticed. Fund the address and restart.`,
  };
}

/**
 * The unreadable-entry ceiling (audit 2026-09-11, B-08 — the crank's guard
 * landed in PR #106; THIS is the wiring it lacked, plan 2026-09-12 §5).
 *
 * `crank.ts` refuses to commit a pool in which more entries than the ceiling
 * could not be read back from the ciphertext store. Its default — all but
 * one — is a logical boundary, not a tuning: it stops only a field that is
 * entirely unreadable. `main.ts` never set anything, so the deployed daemon
 * ran on that default and would have settled a 64-entry pool with 63 lost
 * entries, every seat tied on zero.
 *
 * The VALUE is founder-owned (plan §2e recommends a small absolute number).
 * This parses it and decides what an unset value means per cluster: on
 * devnet the crank's default applies and is printed, so a rehearsal runs
 * without the number; on mainnet an unset ceiling refuses to start, the way
 * every other unconfigured seam here does — a settlement that pays real
 * money against an unread field is not a default anyone chose.
 */
export const UNREADABLE_CEILING_ENV = 'BLOTTO_MAX_UNREADABLE_ENTRIES';

export interface UnreadableCeiling {
  /** What to hand `CrankDeps.maxUnreadableEntries`; undefined = the crank's default. */
  ceiling: number | undefined;
  message: string;
}

export function parseUnreadableCeiling(
  raw: string | undefined,
  cluster: 'mainnet' | 'devnet'
): UnreadableCeiling {
  const v = (raw ?? '').trim();
  if (v === '') {
    if (cluster === 'mainnet') {
      throw new Error(
        `${SERVICE_LABEL}: ${UNREADABLE_CEILING_ENV} is required on mainnet. It is how ` +
          `many entries may be unreadable before the crank refuses to settle a pool; ` +
          `without it the crank would commit a 64-entry pool with 63 entries lost. ` +
          `Set the ratified figure and restart.`
      );
    }
    return {
      ceiling: undefined,
      message:
        `${SERVICE_LABEL}: unreadable-entry ceiling = the crank's default (all but one) — ` +
        `${UNREADABLE_CEILING_ENV} is unset. Devnet only: mainnet refuses to start without it.`,
    };
  }
  if (!/^\d+$/.test(v)) {
    throw new Error(
      `${SERVICE_LABEL}: ${UNREADABLE_CEILING_ENV} must be a whole number of entries (got "${raw}")`
    );
  }
  const ceiling = Number(v);
  return {
    ceiling,
    message: `${SERVICE_LABEL}: unreadable-entry ceiling = ${ceiling} entries (${UNREADABLE_CEILING_ENV})`,
  };
}

/**
 * Whether the daemon will tell the indexer where each settled pool's bundle
 * is (audit 2026-09-11, D-02).
 *
 * The announce is gated on two variables, and until 2026-09-12 neither was
 * staged for the deployed daemon: every boot logged "bundle announce OFF"
 * in the same tone as a routine line, the daemon published each bundle to
 * permanent storage, and no reader — not the archive, not the results page,
 * not /verify — was ever told where. The fallback, `archive-backfill`, was
 * scheduled by nothing. A publish nobody can find is the failure mode, so
 * the silence is now graded: OFF while bundles ARE being published is a
 * warning on devnet (the scheduled backfill still fills the archive daily)
 * and a refusal on mainnet, where an unverifiable settlement is real money.
 */
export interface AnnounceVerdict {
  on: boolean;
  /** OFF while bundles are being published — the archive depends on the backfill. */
  warn: boolean;
  /** Mainnet, OFF: do not start. */
  refuse: boolean;
  message: string;
}

export function announceVerdict(
  env: {
    BLOTTO_INDEXER_ANNOUNCE_URL?: string;
    BLOTTO_HELIUS_WEBHOOK_SECRET?: string;
    IRYS_UPLOAD_KEY?: string;
  },
  cluster: 'mainnet' | 'devnet'
): AnnounceVerdict {
  const url = (env.BLOTTO_INDEXER_ANNOUNCE_URL ?? '').trim();
  const secret = (env.BLOTTO_HELIUS_WEBHOOK_SECRET ?? '').trim();
  if (url !== '' && secret !== '') {
    return {
      on: true,
      warn: false,
      refuse: false,
      message: `${SERVICE_LABEL}: bundle announce ON → ${url}`,
    };
  }
  const missing = [
    url === '' ? 'BLOTTO_INDEXER_ANNOUNCE_URL' : null,
    secret === '' ? 'BLOTTO_HELIUS_WEBHOOK_SECRET' : null,
  ]
    .filter((n) => n !== null)
    .join(' + ');
  const publishing = (env.IRYS_UPLOAD_KEY ?? '').trim() !== '';
  if (!publishing) {
    return {
      on: false,
      warn: false,
      refuse: false,
      message: `${SERVICE_LABEL}: bundle announce OFF (${missing} unset) — and no IRYS_UPLOAD_KEY, so nothing is published either`,
    };
  }
  const refuse = cluster === 'mainnet';
  return {
    on: false,
    warn: true,
    refuse,
    message:
      `${SERVICE_LABEL}: bundle announce OFF (${missing} unset) while IRYS_UPLOAD_KEY is set — ` +
      `every settled pool's bundle will be published where no reader is told to look, and ` +
      `the verified-results archive fills only when archive-backfill runs ` +
      `(indexer-backfill.yml, daily). Stage both variables for the daemon ` +
      `(deploy-backend.yml, "Stage daemon secrets"). ` +
      (refuse
        ? 'On mainnet that is an unverifiable settlement of real money: refusing to start.'
        : 'Devnet: continuing.') +
      ' Audit 2026-09-11, D-02.',
  };
}
