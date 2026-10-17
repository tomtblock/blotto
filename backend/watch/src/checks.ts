/*
 * Every check the watcher runs, as a PURE function from what it fetched to a
 * verdict. Fetching lives in `collect.ts`; deciding when a verdict becomes a
 * message lives in `incidents.ts`. Keeping the three apart is what lets the
 * specs replay this week's real failures — the daemon answering 200 with
 * `errors: 2` on every tick, an open pool with no pass collection, a Helius
 * `429 … max usage reached` — without a network.
 *
 * Each verdict is `pass`, `fail`, or `unknown`. Unknown means "could not
 * tell" (the source was unreachable, the service is mid-deploy) and moves no
 * counter either way: it neither raises an alert nor clears one.
 */

import type { ConfigAccountView } from '../../_shared/src/config-account';
import { lamportsToSol, solToLamports, type WatchConfig } from './config';
import type { PoolView } from './solana';

export type Status = 'pass' | 'fail' | 'unknown';

/**
 * critical: players are affected now (cannot enter, are not paid, cannot load
 * the site). warning: the system is degraded but nobody is blocked yet.
 */
export type Severity = 'critical' | 'warning';

export interface CheckResult {
  /** Stable incident key, e.g. `pools:not-enterable`. */
  key: string;
  status: Status;
  /** A headline, in plain words. */
  title: string;
  /** What was seen this time. */
  detail: string;
  severity: Severity;
  /** Consecutive failing observations before the first message. */
  failuresToOpen: number;
  /** Consecutive passing observations before the all-clear (default from config). */
  passesToClear?: number;
  /** Raw facts the cause table reads (e.g. an RPC response body). Never a URL or a credential. */
  facts?: Record<string, string>;
}

type Base = Omit<CheckResult, 'status' | 'detail'>;

const unknown = (r: Base, detail = ''): CheckResult => ({ ...r, status: 'unknown', detail });
const pass = (r: Base, detail: string): CheckResult => ({ ...r, status: 'pass', detail });
const fail = (r: Base, detail: string, facts?: Record<string, string>): CheckResult => ({
  ...r,
  status: 'fail',
  detail,
  ...(facts ? { facts } : {}),
});

// ── services ────────────────────────────────────────────────────────────────

/** One HTTP probe, as `collect.ts` records it. */
export interface Probe {
  /** HTTP status, or null when nothing answered. */
  status: number | null;
  body: string;
  /** Transport error (timeout, DNS, refused), when status is null. */
  error: string | null;
}

const SERVICE_SEVERITY: Record<string, Severity> = {
  'blotto-indexer': 'critical',
  'blotto-packet': 'critical',
  'blotto-daemon': 'critical',
  'blotto-review': 'warning',
};

const isOk = (p: Probe): boolean => p.status !== null && p.status >= 200 && p.status < 300;

/** A short reason out of a failed health body (`{"error": "…"}`), if any. */
function bodyReason(body: string): string | null {
  try {
    const j = JSON.parse(body) as { error?: unknown };
    return typeof j.error === 'string' ? j.error.slice(0, 200) : null;
  } catch {
    return null;
  }
}

function probeDetail(p: Probe): string {
  if (p.status === null) return `no answer (${p.error ?? 'timeout'})`;
  const why = bodyReason(p.body);
  return `HTTP ${p.status}${why ? `: ${why}` : ''}`;
}

/**
 * A service's `/health`. Held at unknown while a backend deploy is running or
 * settling: machines restart then, and that is not an outage.
 */
export function serviceResult(app: string, probe: Probe, t: WatchConfig, deploying: boolean): CheckResult {
  const base: Base = {
    key: `service:${app}`,
    title: `${app} is not answering its health check`,
    severity: SERVICE_SEVERITY[app] ?? 'warning',
    failuresToOpen: t.services.failuresToAlert[app] ?? 3,
  };
  if (deploying) return unknown(base, 'a backend deploy is running');
  return isOk(probe) ? pass(base, `HTTP ${probe.status}`) : fail(base, probeDetail(probe));
}

/** The indexer's webhook receiver (port 8080) — the path the RPC provider delivers events on. */
export function ingestResult(probe: Probe, t: WatchConfig, deploying: boolean): CheckResult {
  const base: Base = {
    key: 'service:blotto-indexer-ingest',
    title: "The indexer's webhook receiver is not answering",
    severity: 'warning',
    failuresToOpen: t.services.ingestFailuresToAlert,
  };
  if (deploying) return unknown(base, 'a backend deploy is running');
  return isOk(probe) ? pass(base, `HTTP ${probe.status}`) : fail(base, probeDetail(probe));
}

// ── daemon ──────────────────────────────────────────────────────────────────

/** The daemon's `/health` body (`backend/reveal/src/health.ts`), the parts read here. */
export interface DaemonHealth {
  ok?: boolean;
  ready?: boolean;
  settlementSol?: string | null;
  lastTick?: { at: string; errors: number } | null;
}

export function parseDaemonHealth(probe: Probe): DaemonHealth | null {
  if (probe.status === null) return null;
  try {
    const j = JSON.parse(probe.body) as DaemonHealth;
    return typeof j === 'object' && j !== null ? j : null;
  } catch {
    return null;
  }
}

/**
 * Remembers which tick the error verdict last counted. A daemon wedged on one
 * tick reports the same `lastTick` for minutes; counting it every poll would
 * turn one bad tick into "five in a row". Only a NEW tick moves the counter.
 */
export class TickMemory {
  lastCountedAt: string | null = null;
}

export function daemonResults(
  health: DaemonHealth | null,
  mem: TickMemory,
  nowMs: number,
  t: WatchConfig,
  deploying: boolean
): CheckResult[] {
  const stale: Base = {
    key: 'daemon:tick-stale',
    title: 'The settlement service has stopped completing ticks',
    severity: 'critical',
    failuresToOpen: 1,
  };
  const errors: Base = {
    key: 'daemon:tick-errors',
    title: 'The settlement service is failing a step on every tick',
    severity: 'warning',
    failuresToOpen: t.daemon.tickErrorPolls,
  };
  const sol: Base = {
    key: 'daemon:settlement-sol',
    title: 'The settlement signer is running low on SOL',
    severity: 'warning',
    failuresToOpen: 2,
  };
  if (health === null || health.ready !== true || deploying) {
    const why = deploying ? 'a backend deploy is running' : 'no readable health body, or still starting';
    return [unknown(stale, why), unknown(errors, why), unknown(sol, why)];
  }
  const out: CheckResult[] = [];

  const tick = health.lastTick ?? null;
  if (tick === null) {
    out.push(unknown(stale, 'no tick yet'), unknown(errors, 'no tick yet'));
  } else {
    const ageS = Math.floor((nowMs - Date.parse(tick.at)) / 1000);
    out.push(
      ageS > t.daemon.tickStaleSeconds
        ? fail(stale, `its last tick finished ${Math.floor(ageS / 60)} min ago`)
        : pass(stale, `last tick ${ageS} s ago`)
    );
    if (tick.at === mem.lastCountedAt) {
      out.push(unknown(errors, 'no new tick since the last look'));
    } else {
      mem.lastCountedAt = tick.at;
      out.push(
        tick.errors > 0
          ? fail(errors, `its latest tick logged ${tick.errors} error${tick.errors === 1 ? '' : 's'} while /health still reads ok`)
          : pass(errors, 'latest tick clean')
      );
    }
  }

  if (typeof health.settlementSol !== 'string') {
    out.push(unknown(sol, 'balance not reported'));
  } else {
    let held: bigint | null;
    try {
      held = solToLamports(health.settlementSol);
    } catch {
      held = null;
    }
    const floor = t.daemon.settlementFloorLamports;
    if (held === null) out.push(unknown(sol, `unreadable balance ${health.settlementSol}`));
    else if (held < floor) {
      out.push(fail(sol, `it holds ${lamportsToSol(held)} SOL, under the ${lamportsToSol(floor)} SOL floor`));
    } else out.push(pass(sol, `${lamportsToSol(held)} SOL`));
  }
  return out;
}

// ── pools, read from the chain ──────────────────────────────────────────────

export interface ChainPool {
  address: string;
  pool: PoolView;
  hasPassCollection: boolean;
  vaultLamports: bigint | null;
}

export interface ChainSnapshot {
  /** The chain's own clock (the Clock sysvar), never the watcher's. */
  nowUnix: bigint;
  config: ConfigAccountView;
  pools: ChainPool[];
}

/** Tiers the indexer's `/treasury` reports as unable to fund their next pot. */
export interface TreasuryView {
  policySource: string;
  short: { tier: number; shortByLamports: bigint }[];
}

export function parseTreasury(probe: Probe): TreasuryView | null {
  if (probe.status !== 200) return null;
  try {
    const j = JSON.parse(probe.body) as {
      policy_source?: string;
      tiers?: { tier: number; status: string; short_by_lamports: string }[];
    };
    return {
      policySource: String(j.policy_source ?? ''),
      short: (j.tiers ?? [])
        .filter((x) => x.status === 'short')
        .map((x) => ({ tier: x.tier, shortByLamports: BigInt(x.short_by_lamports) })),
    };
  } catch {
    return null;
  }
}

/**
 * How long each live pool has sat in its current state, by the watcher's
 * clock (the account carries no state-change time). A pool first seen
 * mid-state starts its clock then — so after a watcher restart a stuck pool
 * takes one full limit to be called stuck again.
 */
export class PoolStateClock {
  private readonly since = new Map<string, { state: string; atMs: number }>();

  observe(pools: PoolView[], nowMs: number): Map<string, number> {
    const ages = new Map<string, number>();
    const live = new Set<string>();
    for (const p of pools) {
      const id = p.id.toString();
      live.add(id);
      const prev = this.since.get(id);
      if (!prev || prev.state !== p.state) this.since.set(id, { state: p.state, atMs: nowMs });
      ages.set(id, nowMs - this.since.get(id)!.atMs);
    }
    for (const id of [...this.since.keys()]) if (!live.has(id)) this.since.delete(id);
    return ages;
  }
}

const poolName = (p: PoolView): string => `pool ${p.id} (${p.mode})`;

export function poolResults(
  snap: ChainSnapshot | null,
  stateAgesMs: Map<string, number>,
  treasury: TreasuryView | null,
  t: WatchConfig
): CheckResult[] {
  const c = t.chain;
  const enterable: Base = {
    key: 'pools:not-enterable',
    title: 'Entries are blocked',
    severity: 'critical',
    failuresToOpen: c.failuresToAlert,
  };
  const pastDeadline: Base = {
    key: 'pools:past-deadline',
    title: 'A pool is still open past its fill deadline',
    severity: 'critical',
    failuresToOpen: c.failuresToAlert,
  };
  const stuck: Base = {
    key: 'pools:stuck',
    title: 'A pool is stuck between closing and paying',
    severity: 'critical',
    failuresToOpen: c.failuresToAlert,
  };
  const noneOpen: Base = {
    key: 'pools:none-open',
    title: 'No pool is open on an enabled tier',
    severity: 'critical',
    failuresToOpen: c.failuresToAlert,
  };
  if (snap === null) return [unknown(enterable), unknown(pastDeadline), unknown(stuck), unknown(noneOpen)];
  const now = snap.nowUnix;

  const blocked: string[] = [];
  if (snap.config.paused && c.pausedIsIncident) blocked.push('entries are paused in Config');
  const late: string[] = [];
  const stalled: string[] = [];
  const limitsMin: Record<string, number> = {
    Sealed: c.sealedMaxMinutes,
    Scored: c.scoredMaxMinutes,
    Refunding: c.refundingMaxMinutes,
  };
  for (const { pool, hasPassCollection, vaultLamports } of snap.pools) {
    if (pool.state === 'Open') {
      if (now > pool.fillDeadline + BigInt(c.fillDeadlineSlackSeconds)) {
        late.push(`${poolName(pool)}: deadline passed ${(now - pool.fillDeadline) / 60n} min ago`);
        continue;
      }
      if (now > pool.fillDeadline) continue; // closing now; the daemon's next tick handles it
      if (now - pool.openedAt <= BigInt(c.passCollectionGraceSeconds)) continue; // still launching
      if (!hasPassCollection) blocked.push(`${poolName(pool)}: no pass collection`);
      if (vaultLamports !== null && vaultLamports < pool.potLamports) {
        blocked.push(`${poolName(pool)}: its vault holds less than its pot`);
      }
      continue;
    }
    const limit = limitsMin[pool.state];
    const ageMs = stateAgesMs.get(pool.id.toString()) ?? 0;
    if (limit !== undefined && ageMs > limit * 60_000) {
      stalled.push(`${poolName(pool)}: ${pool.state} for ${Math.floor(ageMs / 60_000)} min`);
    }
  }

  const shortTiers = new Set((treasury?.short ?? []).map((s) => s.tier));
  const idle: string[] = [];
  const ladders: [string, boolean[], bigint[], bigint[]][] = [
    ['easy', snap.config.openTiers, snap.config.activePoolByTier, snap.config.tierNextOpenAt],
    ['hard', snap.config.hardOpenTiers, snap.config.hardActivePoolByTier, snap.config.hardTierNextOpenAt],
  ];
  for (const [mode, enabled, active, nextOpenAt] of ladders) {
    enabled.forEach((on, tier) => {
      // A short treasury is its own incident (treasury:short), not a stall.
      if (!on || active[tier] !== 0n || shortTiers.has(tier)) return;
      const since = now - nextOpenAt[tier];
      if (since > BigInt(c.keeperSlackSeconds)) {
        idle.push(`tier ${tier} (${mode}): no open pool for ${since / 60n} min after it could open`);
      }
    });
  }

  const verdict = (base: Base, problems: string[], ok: string): CheckResult =>
    problems.length > 0 ? fail(base, problems.join('; ')) : pass(base, ok);
  return [
    verdict(enterable, blocked, 'every open pool has what entry needs'),
    verdict(pastDeadline, late, 'no pool overdue'),
    verdict(stuck, stalled, 'no pool stuck'),
    verdict(noneOpen, idle, 'every enabled tier has a pool'),
  ];
}

export function treasuryResult(treasury: TreasuryView | null): CheckResult {
  const base: Base = {
    key: 'treasury:short',
    title: 'The platform treasury cannot fund the next pot',
    severity: 'warning',
    failuresToOpen: 2,
  };
  if (treasury === null) return unknown(base);
  if (treasury.short.length === 0) return pass(base, 'no tier short');
  return fail(
    base,
    treasury.short.map((s) => `tier ${s.tier} short by ${lamportsToSol(s.shortByLamports)} SOL`).join('; ')
  );
}

// ── indexer freshness ───────────────────────────────────────────────────────

/** The indexer's `/pools` rows, the fields compared with the chain. */
export interface IndexedPool {
  id: bigint;
  entrants: number;
  state: string;
}

export function parseIndexedPools(probe: Probe): IndexedPool[] | null {
  if (probe.status !== 200) return null;
  try {
    const rows = JSON.parse(probe.body) as { id: string; entrants: number; state: string }[];
    return rows.map((r) => ({ id: BigInt(r.id), entrants: r.entrants, state: r.state }));
  } catch {
    return null;
  }
}

/**
 * Two lags, because each misses what the other sees: the newest pool id only
 * moves when a pool opens, so a dead webhook would hide for a pool's whole
 * life behind it; the entrant count moves with every entry.
 */
export function indexerResults(
  snap: ChainSnapshot | null,
  indexed: IndexedPool[] | null,
  treasury: TreasuryView | null,
  t: WatchConfig
): CheckResult[] {
  const behind: Base = {
    key: 'indexer:behind',
    title: 'The indexer is behind the chain',
    severity: 'warning',
    failuresToOpen: t.indexer.lagPolls,
  };
  const chainRead: Base = {
    key: 'indexer:chain-read',
    title: "The indexer can't read the chain",
    severity: 'warning',
    failuresToOpen: t.indexer.ledgerFallbackPolls,
  };
  const out: CheckResult[] = [];

  if (snap === null || indexed === null) out.push(unknown(behind));
  else {
    const gaps: string[] = [];
    const newestOnChain = snap.config.nextPoolId - 1n;
    const newestIndexed = indexed.reduce((m, p) => (p.id > m ? p.id : m), 0n);
    if (newestOnChain > 0n && newestIndexed < newestOnChain) {
      gaps.push(`newest pool on chain is ${newestOnChain}, the indexer's newest is ${newestIndexed}`);
    }
    const byId = new Map(indexed.map((p) => [p.id.toString(), p]));
    for (const { pool } of snap.pools) {
      const row = byId.get(pool.id.toString());
      if (row && row.entrants !== pool.entrants) {
        gaps.push(`pool ${pool.id}: ${pool.entrants} entrants on chain, ${row.entrants} indexed`);
      }
    }
    out.push(gaps.length > 0 ? fail(behind, gaps.join('; ')) : pass(behind, 'in step with the chain'));
  }

  if (treasury === null) out.push(unknown(chainRead));
  else if (treasury.policySource === 'ledger') {
    out.push(fail(chainRead, 'its /treasury report fell back to its own ledger (policy_source "ledger")'));
  } else out.push(pass(chainRead, 'reads the chain'));
  return out;
}

// ── the services' RPC provider ──────────────────────────────────────────────

export interface RpcProbe {
  ok: boolean;
  status: number | null;
  body: string;
  error: string | null;
}

export type ProviderState = 'ok' | 'creditsSpent' | 'rateLimited' | 'keyRejected' | 'unreachable';

/** What a provider answer means. "max usage" is Helius's words for a spent monthly allowance. */
export function classifyProvider(p: RpcProbe): ProviderState {
  if (p.ok) return 'ok';
  if (p.status === null) return 'unreachable';
  if (/max usage/i.test(p.body)) return 'creditsSpent';
  if (p.status === 429) return 'rateLimited';
  if (p.status === 401 || p.status === 403) return 'keyRejected';
  return 'unreachable';
}

/**
 * The services' provider, probed with one account read (`probeProvider`). A
 * spent allowance never recovers on its own, so it alerts on the first
 * sighting; everything else must persist. The URL carries the API key and
 * never reaches a message.
 */
export function providerResult(probe: RpcProbe | null, t: WatchConfig): CheckResult {
  const state = probe === null ? null : classifyProvider(probe);
  const base: Base = {
    key: 'rpc:primary',
    title: "The services' RPC provider is refusing calls",
    severity: 'critical',
    failuresToOpen:
      state === 'creditsSpent' ? t.provider.creditsSpentFailuresToAlert : t.provider.otherFailuresToAlert,
  };
  if (probe === null || state === null) return unknown(base, 'not probed this round');
  if (state === 'ok') return pass(base, 'an account read answered');
  const words: Record<Exclude<ProviderState, 'ok'>, string> = {
    creditsSpent: 'the monthly credit allowance is spent ("max usage reached")',
    rateLimited: 'rate limited (HTTP 429)',
    keyRejected: `the API key was refused (HTTP ${probe.status})`,
    unreachable:
      probe.status === null
        ? `no answer (${probe.error ?? 'timeout'})`
        : `an account read failed: ${probe.error ?? `HTTP ${probe.status}`}`,
  };
  return fail(base, words[state], { body: probe.body.slice(0, 500), state });
}

/** The watcher's own chain view failing: the pool checks are blind until it returns. */
export function chainReadResult(error: string | null, t: WatchConfig): CheckResult {
  const base: Base = {
    key: 'watch:chain-rpc',
    title: "The watcher can't read the chain",
    severity: 'warning',
    failuresToOpen: t.chain.readFailuresToAlert,
  };
  return error === null ? pass(base, 'reads the chain') : fail(base, error);
}

// ── the web app ─────────────────────────────────────────────────────────────

export function siteResult(key: 'site:alias' | 'site:domain', url: string, probe: Probe, t: WatchConfig): CheckResult {
  const base: Base = {
    key,
    title: key === 'site:alias' ? 'The web app is down' : 'www.blotto.gg is not answering',
    severity: 'critical',
    failuresToOpen: t.site.failuresToAlert,
  };
  if (isOk(probe)) return pass(base, `HTTP ${probe.status}`);
  return fail(
    base,
    probe.status === null ? `no answer from ${url} (${probe.error ?? 'timeout'})` : `${url} answered HTTP ${probe.status}`
  );
}

/** The app's `/api/version` body: `{version: <commit sha>}`. */
export function parseSiteVersion(probe: Probe): string | null {
  if (probe.status !== 200) return null;
  try {
    const v = (JSON.parse(probe.body) as { version?: unknown }).version;
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export interface MainHead {
  sha: string;
  committedAtMs: number;
}

export function deployLagResult(siteVersion: string | null, head: MainHead | null, nowMs: number, t: WatchConfig): CheckResult {
  const base: Base = {
    key: 'site:deploy-lag',
    title: 'The web app is not running the latest main',
    severity: 'warning',
    failuresToOpen: 1,
  };
  if (siteVersion === null || head === null) return unknown(base);
  if (siteVersion === head.sha) return pass(base, `serving ${head.sha.slice(0, 7)}`);
  const lagMin = Math.floor((nowMs - head.committedAtMs) / 60_000);
  if (lagMin <= t.site.versionLagMinutes) return pass(base, `main moved ${lagMin} min ago; within the build window`);
  return fail(
    base,
    `the site serves ${siteVersion.slice(0, 7)}; main has been at ${head.sha.slice(0, 7)} for ${lagMin} min`
  );
}

// ── GitHub Actions lanes ────────────────────────────────────────────────────

/** The newest decided run (success or failure) of one workflow on main. */
export interface LaneRun {
  workflow: string;
  name: string;
  conclusion: 'success' | 'failure';
  url: string;
  sha: string;
}

export function laneResult(workflow: string, run: LaneRun | null): CheckResult {
  const label = workflow.replace(/\.ya?ml$/, '');
  const base: Base = {
    key: `github:${label}`,
    title: label === 'deploy-backend' ? 'The backend deploy failed' : `${label} is red on main`,
    severity: label === 'deploy-backend' ? 'critical' : 'warning',
    failuresToOpen: 1,
    passesToClear: 1,
  };
  if (run === null) return unknown(base);
  if (run.conclusion === 'success') return pass(base, run.url);
  return fail(base, `${run.name} failed at ${run.sha.slice(0, 7)}: ${run.url}`, { url: run.url });
}

/** GitHub refusing the watcher's token: the lanes and diagnoses are blind. */
export function githubAccessResult(status: number | null): CheckResult {
  const base: Base = {
    key: 'watch:github',
    title: "GitHub refuses the watcher's token",
    severity: 'warning',
    failuresToOpen: 2,
  };
  if (status === null) return unknown(base);
  if (status === 401 || status === 403) return fail(base, `the GitHub API answered HTTP ${status}`);
  return pass(base, 'GitHub accepts the token');
}

/**
 * GitHub's `github-authentication-token-expiration` header, e.g.
 * "2027-01-01 00:00:00 UTC". Warns `tokenExpiryWarnDays` ahead, so rotating
 * the token is a chore, not an outage.
 */
export function tokenExpiryResult(header: string | null, nowMs: number, t: WatchConfig): CheckResult {
  const base: Base = {
    key: 'watch:github-token-expiry',
    title: "The watcher's GitHub token expires soon",
    severity: 'warning',
    failuresToOpen: 1,
    passesToClear: 1,
  };
  if (header === null) return unknown(base, 'no expiry reported');
  const at = Date.parse(header.trim().replace(' UTC', 'Z').replace(' ', 'T'));
  if (!Number.isFinite(at)) return unknown(base, `unreadable expiry ${header}`);
  const days = Math.floor((at - nowMs) / 86_400_000);
  return days <= t.lanes.tokenExpiryWarnDays
    ? fail(base, `it expires in ${Math.max(days, 0)} day${days === 1 ? '' : 's'} (${header.trim()})`)
    : pass(base, `expires in ${days} days`);
}
