/*
 * The watcher's settings: thresholds from `config/watch.json` (owner-set
 * numbers; legend and rationale in `config/watch.README.md`), credentials and
 * endpoints from the environment.
 *
 * Every threshold is required and unknown keys are refused: a typo must stop
 * the watcher at boot, loudly, not leave a check running on a default nobody
 * chose. A watcher that will not boot is caught twice over — Fly restarts the
 * crashing machine, and backend-watch probes this app.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface WatchConfig {
  loop: { intervalSeconds: number; watchdogSeconds: number; httpTimeoutSeconds: number };
  incidents: {
    clearAfterPasses: number;
    reminderHours: number;
    laneReminderHours: number;
    flapWindowMinutes: number;
    maxMessagesPerHour: number;
  };
  services: {
    apps: string[];
    failuresToAlert: Record<string, number>;
    ingestUrl: string;
    ingestFailuresToAlert: number;
  };
  daemon: { tickStaleSeconds: number; tickErrorPolls: number; settlementFloorLamports: bigint };
  chain: {
    readFailuresToAlert: number;
    failuresToAlert: number;
    passCollectionGraceSeconds: number;
    fillDeadlineSlackSeconds: number;
    keeperSlackSeconds: number;
    sealedMaxMinutes: number;
    scoredMaxMinutes: number;
    refundingMaxMinutes: number;
    pausedIsIncident: boolean;
  };
  indexer: { lagPolls: number; ledgerFallbackPolls: number };
  provider: { probeEverySeconds: number; creditsSpentFailuresToAlert: number; otherFailuresToAlert: number };
  alerts: { metricsPort: number; quietMinutesToClear: number; scrapeFailuresToAlert: number; ignoreReasons: string[] };
  site: { aliasUrl: string; domainUrl: string; failuresToAlert: number; versionLagMinutes: number };
  lanes: { pollEverySeconds: number; deploySettleSeconds: number; tokenExpiryWarnDays: number; watched: string[] };
  diagnosis: { maxPerDay: number; minMinutesBetweenSameCheck: number };
}

export const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../../config/watch.json');

type Kind = 'int' | 'lamports' | 'string' | 'strings' | 'bool' | 'intMap';
type Shape = { [k: string]: Kind | Shape };

/** The file's shape, key by key. Adding a threshold means adding it here, to the file and to the legend. */
export const SHAPE: Shape = {
  loop: { intervalSeconds: 'int', watchdogSeconds: 'int', httpTimeoutSeconds: 'int' },
  incidents: {
    clearAfterPasses: 'int',
    reminderHours: 'int',
    laneReminderHours: 'int',
    flapWindowMinutes: 'int',
    maxMessagesPerHour: 'int',
  },
  services: { apps: 'strings', failuresToAlert: 'intMap', ingestUrl: 'string', ingestFailuresToAlert: 'int' },
  daemon: { tickStaleSeconds: 'int', tickErrorPolls: 'int', settlementFloorLamports: 'lamports' },
  chain: {
    readFailuresToAlert: 'int',
    failuresToAlert: 'int',
    passCollectionGraceSeconds: 'int',
    fillDeadlineSlackSeconds: 'int',
    keeperSlackSeconds: 'int',
    sealedMaxMinutes: 'int',
    scoredMaxMinutes: 'int',
    refundingMaxMinutes: 'int',
    pausedIsIncident: 'bool',
  },
  indexer: { lagPolls: 'int', ledgerFallbackPolls: 'int' },
  provider: { probeEverySeconds: 'int', creditsSpentFailuresToAlert: 'int', otherFailuresToAlert: 'int' },
  alerts: { metricsPort: 'int', quietMinutesToClear: 'int', scrapeFailuresToAlert: 'int', ignoreReasons: 'strings' },
  site: { aliasUrl: 'string', domainUrl: 'string', failuresToAlert: 'int', versionLagMinutes: 'int' },
  lanes: { pollEverySeconds: 'int', deploySettleSeconds: 'int', tokenExpiryWarnDays: 'int', watched: 'strings' },
  diagnosis: { maxPerDay: 'int', minMinutesBetweenSameCheck: 'int' },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

function walk(raw: unknown, shape: Shape, at: string, problems: string[]): unknown {
  if (!isObj(raw)) {
    problems.push(`${at || '(root)'} must be an object`);
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (!(k in shape)) problems.push(`${at}${k} is not a known setting`);
  }
  for (const [k, kind] of Object.entries(shape)) {
    const name = `${at}${k}`;
    const v = raw[k];
    if (v === undefined) {
      problems.push(`${name} is missing`);
      continue;
    }
    if (typeof kind === 'object') {
      out[k] = walk(v, kind, `${name}.`, problems);
      continue;
    }
    switch (kind) {
      case 'int':
        if (!isPosInt(v)) problems.push(`${name} must be a positive integer`);
        out[k] = v;
        break;
      case 'lamports':
        // Lamports as a decimal STRING: integer-only, and no float ever
        // carries an amount (CLAUDE.md, "no floats").
        if (typeof v !== 'string' || !/^[0-9]{1,20}$/.test(v)) {
          problems.push(`${name} must be a whole number of lamports, as a string`);
          out[k] = 0n;
        } else out[k] = BigInt(v);
        break;
      case 'string':
        if (typeof v !== 'string' || v.length === 0) problems.push(`${name} must be a non-empty string`);
        out[k] = v;
        break;
      case 'strings':
        if (!Array.isArray(v) || !v.every((s) => typeof s === 'string' && s.length > 0)) {
          problems.push(`${name} must be a list of non-empty strings`);
        }
        out[k] = v;
        break;
      case 'bool':
        if (typeof v !== 'boolean') problems.push(`${name} must be true or false`);
        out[k] = v;
        break;
      case 'intMap':
        if (!isObj(v) || !Object.values(v).every(isPosInt)) {
          problems.push(`${name} must map names to positive integers`);
        }
        out[k] = v;
        break;
    }
  }
  return out;
}

/** Validate a parsed `config/watch.json`. Throws once, listing EVERY problem. */
export function validateWatchConfig(raw: unknown): WatchConfig {
  const problems: string[] = [];
  const cfg = walk(raw, SHAPE, '', problems) as WatchConfig;
  if (problems.length === 0) {
    for (const app of cfg.services.apps) {
      if (!(app in cfg.services.failuresToAlert)) problems.push(`services.failuresToAlert has no entry for ${app}`);
    }
    for (const app of Object.keys(cfg.services.failuresToAlert)) {
      if (!cfg.services.apps.includes(app)) problems.push(`services.failuresToAlert names ${app}, which is not in services.apps`);
    }
  }
  if (problems.length > 0) throw new Error(`config/watch.json is invalid:\n  - ${problems.join('\n  - ')}`);
  return cfg;
}

export function loadWatchConfig(file: string = DEFAULT_CONFIG_PATH): WatchConfig {
  return validateWatchConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** "1.5" SOL → 1_500_000_000n lamports. Integer arithmetic only; at most 9 decimals. */
export function solToLamports(sol: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(sol.trim());
  if (!m) throw new Error(`not a SOL amount: ${JSON.stringify(sol)}`);
  return BigInt(m[1]) * 1_000_000_000n + BigInt((m[2] ?? '').padEnd(9, '0'));
}

/** Lamports → "1.5" for a message. */
export function lamportsToSol(lamports: bigint): string {
  const neg = lamports < 0n;
  const abs = neg ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export interface Env {
  telegramToken: string | null;
  telegramChatId: string | null;
  /** Print messages instead of sending them. Must be asked for explicitly. */
  dryRun: boolean;
  /** The services' own RPC URL — probed for credit exhaustion only, never logged. */
  providerRpcUrl: string | null;
  /**
   * The RPC the watcher reads the chain through. Separate from the services'
   * on purpose: when their provider fails, this view must survive it.
   */
  chainRpcUrl: string;
  /** Fine-grained GitHub token (Actions: read and write on this repository only). */
  githubToken: string | null;
  githubRepo: string;
  port: number;
  buildCommit: string;
}

// PHASE-N-REVIEW: the public devnet endpoint carries two calls a minute on
// devnet; before mainnet, point WATCH_CHAIN_RPC_URL at a second provider that
// does not share the services' credit pool.
export const DEFAULT_CHAIN_RPC_URL = 'https://api.devnet.solana.com';

/**
 * Read the environment. Refuses to start without Telegram credentials unless
 * WATCH_DRY_RUN=1 — a local run must never message the founders' group by
 * accident, and a deployed one must never run mute by accident either.
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const blank = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);
  const port = Number(env.WATCH_HEALTH_PORT ?? '8085');
  if (!Number.isInteger(port) || port <= 0) throw new Error(`WATCH_HEALTH_PORT is not a port: ${env.WATCH_HEALTH_PORT}`);
  const dryRun = env.WATCH_DRY_RUN === '1';
  const telegramToken = blank(env.TELEGRAM_BOT_TOKEN);
  const telegramChatId = blank(env.TELEGRAM_CHAT_ID);
  if (!dryRun && (telegramToken === null || telegramChatId === null)) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required (set WATCH_DRY_RUN=1 to print messages instead of sending them)'
    );
  }
  return {
    telegramToken,
    telegramChatId,
    dryRun,
    providerRpcUrl: blank(env.WATCH_PROVIDER_RPC_URL),
    chainRpcUrl: blank(env.WATCH_CHAIN_RPC_URL) ?? DEFAULT_CHAIN_RPC_URL,
    githubToken: blank(env.WATCH_GITHUB_TOKEN),
    githubRepo: blank(env.WATCH_GITHUB_REPO) ?? 'tomtblock/blotto',
    port,
    buildCommit: blank(env.BLOTTO_BUILD_COMMIT) ?? 'unknown',
  };
}
