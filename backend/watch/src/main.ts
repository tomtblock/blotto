/*
 * blotto-watch (decision R23): the failure-only watcher.
 *
 * Once a minute it looks at everything a player depends on — the four
 * services, the program's accounts on chain, the RPC provider's allowance,
 * the web app, the CI lanes — and says nothing unless something is wrong.
 * When something is, it writes to the founders' Telegram group: what broke,
 * the likely cause, the first thing to do; and it asks Claude, in GitHub
 * Actions, for a diagnosis that arrives as a reply in the same thread.
 *
 * It runs as its own Fly app, in a different region from the services, so
 * that the failures it exists to report cannot also silence it. It holds no
 * database credential, no signing key and no Fly token. Who watches it: Fly
 * restarts it when it exits (and the watchdog below makes a stuck loop exit),
 * and backend-watch probes its /health and posts to the group when it is
 * down.
 */

import { createServer, type Server } from 'http';
import { AlertCounterTracker, metricsReachResult } from './alerts';
import {
  chainReadResult,
  daemonResults,
  deployLagResult,
  githubAccessResult,
  indexerResults,
  ingestResult,
  laneResult,
  parseDaemonHealth,
  parseIndexedPools,
  parseSiteVersion,
  parseTreasury,
  PoolStateClock,
  poolResults,
  providerResult,
  serviceResult,
  siteResult,
  TickMemory,
  tokenExpiryResult,
  treasuryResult,
  type ChainSnapshot,
  type CheckResult,
  type LaneRun,
  type MainHead,
  type Probe,
  type RpcProbe,
} from './checks';
import { httpProbe, httpProbeIpv4, probeProvider, readChain, scrapeMetrics } from './collect';
import { loadEnv, loadWatchConfig, type Env, type WatchConfig } from './config';
import { keysToDiagnose, newDispatchLog, recordDispatch, renderDiagnosisUnavailable } from './diagnosis';
import { renderAgain, renderAlert, renderCleared, renderReminder, renderThreaded } from './format';
import { Github, GithubError } from './github';
import { IncidentBook, type Incident, type Plan } from './incidents';
import { StdoutNotifier, TelegramNotifier, type Notifier } from './telegram';

const SERVICE = 'watch';
const log = (line: string): void => console.log(`${SERVICE}: ${line}`);
const warn = (line: string): void => console.error(`${SERVICE}: ${line}`);

/** Everything that survives from one round to the next. */
interface Runtime {
  startedAtMs: number;
  lastCycleMs: number | null;
  lastProviderMs: number;
  provider: RpcProbe | null;
  lastLanesMs: number;
  lanes: Map<string, LaneRun | null>;
  mainHead: MainHead | null;
  deployHoldUntilMs: number;
  /** Incidents whose opening message has not been delivered yet. */
  unsent: Incident[];
  sentAtMs: number[];
  heldBack: number;
  metricsLogged: Set<string>;
}

export class Watcher {
  readonly rt: Runtime;
  private readonly book: IncidentBook;
  private readonly alertTracker: AlertCounterTracker;
  private readonly tickMem = new TickMemory();
  private readonly stateClock = new PoolStateClock();
  private readonly dispatches = newDispatchLog();

  constructor(
    private readonly cfg: WatchConfig,
    private readonly env: Env,
    private readonly notifier: Notifier,
    private readonly github: Github,
    nowMs: number
  ) {
    this.rt = {
      startedAtMs: nowMs,
      lastCycleMs: null,
      lastProviderMs: 0,
      provider: null,
      lastLanesMs: 0,
      lanes: new Map(),
      mainHead: null,
      deployHoldUntilMs: 0,
      unsent: [],
      sentAtMs: [],
      heldBack: 0,
      metricsLogged: new Set(),
    };
    this.book = new IncidentBook({
      passesToClear: cfg.incidents.clearAfterPasses,
      reminderMs: cfg.incidents.reminderHours * 3_600_000,
      laneReminderMs: cfg.incidents.laneReminderHours * 3_600_000,
      flapWindowMs: cfg.incidents.flapWindowMinutes * 60_000,
      startedAtMs: nowMs,
    });
    this.alertTracker = new AlertCounterTracker(cfg.alerts.quietMinutesToClear * 60_000, new Set(cfg.alerts.ignoreReasons));
  }

  /** One round: look at everything, decide, say what needs saying. */
  async cycle(nowMs: number = Date.now()): Promise<void> {
    const results = await this.observe(nowMs);
    const plan = this.book.observe(results, nowMs);
    await this.say(plan, nowMs);
    this.rt.lastCycleMs = nowMs;
  }

  /** One round of looking, with no decision and no message — for the diagnosis snapshot. */
  async inspect(nowMs: number = Date.now()): Promise<CheckResult[]> {
    return this.observe(nowMs);
  }

  private async observe(nowMs: number): Promise<CheckResult[]> {
    const { cfg, env } = this;
    const timeout = cfg.loop.httpTimeoutSeconds * 1000;
    const out: CheckResult[] = [];

    // GitHub first: whether a backend deploy is running decides how the
    // service checks read this round.
    if (env.githubToken) {
      try {
        if (await this.github.deployRunning()) {
          this.rt.deployHoldUntilMs = nowMs + cfg.lanes.deploySettleSeconds * 1000;
        }
      } catch (e) {
        if (!(e instanceof GithubError)) throw e;
      }
      out.push(githubAccessResult(this.github.lastStatus));
    }
    const deploying = nowMs < this.rt.deployHoldUntilMs;

    const fly = (app: string, path: string): Promise<Probe> => httpProbe(`https://${app}.fly.dev${path}`, timeout);
    const [services, ingest, pools, treasury, alias, domain, chain] = await Promise.all([
      Promise.all(cfg.services.apps.map((app) => fly(app, '/health'))),
      httpProbeIpv4(cfg.services.ingestUrl, timeout),
      fly('blotto-indexer', '/pools?limit=20'),
      fly('blotto-indexer', '/treasury'),
      httpProbe(cfg.site.aliasUrl, timeout),
      httpProbe(cfg.site.domainUrl, timeout),
      readChain(env.chainRpcUrl, timeout).then(
        (snap): { snap: ChainSnapshot | null; error: string | null } => ({ snap, error: null }),
        (e: Error) => ({ snap: null, error: e.message })
      ),
    ]);

    cfg.services.apps.forEach((app, i) => out.push(serviceResult(app, services[i], cfg, deploying)));
    out.push(ingestResult(ingest, cfg, deploying));

    const daemonIdx = cfg.services.apps.indexOf('blotto-daemon');
    const daemonHealth = daemonIdx >= 0 ? parseDaemonHealth(services[daemonIdx]) : null;
    out.push(...daemonResults(daemonHealth, this.tickMem, nowMs, cfg, deploying));

    out.push(chainReadResult(chain.error, cfg));
    const treasuryView = parseTreasury(treasury);
    const ages = chain.snap ? this.stateClock.observe(chain.snap.pools.map((p) => p.pool), nowMs) : new Map<string, number>();
    // A deploy restarts the daemon, which cranks and launches: hold the pool
    // verdicts with the service ones until it settles.
    const poolVerdicts = poolResults(chain.snap, ages, treasuryView, cfg);
    out.push(...(deploying ? poolVerdicts.map((r) => ({ ...r, status: 'unknown' as const })) : poolVerdicts));
    out.push(treasuryResult(treasuryView));
    const idx = indexerResults(chain.snap, parseIndexedPools(pools), treasuryView, cfg);
    out.push(...(deploying ? idx.map((r) => ({ ...r, status: 'unknown' as const })) : idx));

    // The services' own alerts, over the private network.
    const scrapes = await Promise.all(
      cfg.services.apps.map((app) => scrapeMetrics(app, cfg.alerts.metricsPort, timeout))
    );
    cfg.services.apps.forEach((app, i) => {
      const { text, error } = scrapes[i];
      if (!this.rt.metricsLogged.has(app)) {
        this.rt.metricsLogged.add(app);
        log(error === null ? `metrics ${app}: reachable` : `metrics ${app}: UNREACHABLE (${error})`);
      }
      const reach = metricsReachResult(app, deploying ? null : error, cfg.alerts.scrapeFailuresToAlert);
      out.push(deploying ? { ...reach, status: 'unknown' } : reach);
      out.push(...this.alertTracker.observe(app, deploying ? null : text, nowMs));
    });

    // The provider's allowance, every few minutes (each probe spends a credit).
    if (env.providerRpcUrl && nowMs - this.rt.lastProviderMs >= cfg.provider.probeEverySeconds * 1000) {
      this.rt.lastProviderMs = nowMs;
      this.rt.provider = await probeProvider(env.providerRpcUrl, timeout);
      out.push(providerResult(this.rt.provider, cfg));
    }

    // The web app, and whether it serves the latest main.
    out.push(siteResult('site:alias', cfg.site.aliasUrl, alias, cfg));
    out.push(siteResult('site:domain', cfg.site.domainUrl, domain, cfg));

    // CI lanes and main's head, every few minutes.
    if (env.githubToken && nowMs - this.rt.lastLanesMs >= cfg.lanes.pollEverySeconds * 1000) {
      this.rt.lastLanesMs = nowMs;
      for (const wf of cfg.lanes.watched) {
        try {
          this.rt.lanes.set(wf, await this.github.latestDecidedRun(wf));
          out.push(laneResult(wf, this.rt.lanes.get(wf) ?? null));
        } catch (e) {
          if (!(e instanceof GithubError)) throw e;
        }
      }
      try {
        this.rt.mainHead = await this.github.mainHead();
      } catch (e) {
        if (!(e instanceof GithubError)) throw e;
      }
      out.push(deployLagResult(parseSiteVersion(alias), this.rt.mainHead, nowMs, cfg));
      out.push(tokenExpiryResult(this.github.tokenExpiry, nowMs, cfg));
    }
    return out;
  }

  /** Send, within the hourly budget. Returns the message id, or null if held or failed. */
  private async send(html: string, opts: { replyTo?: number | null; silent?: boolean }, nowMs: number): Promise<number | null> {
    this.rt.sentAtMs = this.rt.sentAtMs.filter((t) => t > nowMs - 3_600_000);
    if (this.rt.sentAtMs.length >= this.cfg.incidents.maxMessagesPerHour) {
      this.rt.heldBack += 1;
      warn(`message held back: ${this.rt.sentAtMs.length} sent in the last hour`);
      return null;
    }
    const note =
      this.rt.heldBack > 0 ? `\n\n<i>(${this.rt.heldBack} other message(s) were held back by the hourly limit.)</i>` : '';
    const id = await this.notifier.send(html + note, opts);
    if (id !== null) {
      this.rt.sentAtMs.push(nowMs);
      this.rt.heldBack = 0;
    }
    return id;
  }

  private async say(plan: Plan, nowMs: number): Promise<void> {
    // Top level: this round's openings plus any earlier ones not yet
    // delivered (Telegram down, hourly budget), as long as still open.
    const openKeys = new Set(this.book.openIncidents().map((i) => i.key));
    const batch = [...this.rt.unsent.filter((i) => openKeys.has(i.key) && i.messageId === null), ...plan.opened];
    this.rt.unsent = [];
    if (batch.length > 0) {
      const keys = this.env.githubToken
        ? keysToDiagnose(batch, this.dispatches, this.cfg.diagnosis, nowMs)
        : [];
      const id = await this.send(renderAlert(batch, { diagnosing: keys.length > 0 }), {}, nowMs);
      if (id === null) {
        this.rt.unsent = batch;
      } else {
        this.book.attachMessage(batch.map((i) => i.key), id);
        if (keys.length > 0) await this.diagnose(keys, id, nowMs);
      }
    }

    for (const { parent, incident, silent } of plan.threaded) {
      const id = await this.send(renderThreaded(incident), { replyTo: parent.messageId, silent }, nowMs);
      if (id !== null) this.book.attachMessage([incident.key], id);
    }
    for (const { incident, threadId } of plan.again) {
      await this.send(renderAgain(incident), { replyTo: threadId, silent: true }, nowMs);
    }

    const byThread = <T extends { messageId: number | null }>(items: T[]): Map<number | null, T[]> => {
      const m = new Map<number | null, T[]>();
      for (const it of items) m.set(it.messageId, [...(m.get(it.messageId) ?? []), it]);
      return m;
    };
    for (const [thread, items] of byThread(plan.cleared.map((c) => ({ ...c, messageId: c.incident.messageId })))) {
      // An incident whose alert never went out needs no all-clear.
      if (thread === null) continue;
      await this.send(renderCleared(items), { replyTo: thread, silent: true }, nowMs);
    }
    for (const [thread, items] of byThread(plan.reminders)) {
      // Not yet delivered: the retry of the opening message covers it.
      if (thread === null) continue;
      await this.send(renderReminder(items, nowMs), { replyTo: thread }, nowMs);
    }
  }

  private async diagnose(keys: string[], messageId: number, nowMs: number): Promise<void> {
    try {
      await this.github.dispatchDiagnosis(keys, messageId);
      recordDispatch(this.dispatches, keys, nowMs);
      log(`diagnosis requested for ${keys.join(', ')}`);
    } catch (e) {
      warn(`diagnosis could not start: ${(e as Error).message}`);
      await this.send(
        renderDiagnosisUnavailable(`it could not be started (${(e as Error).message})`, null),
        { replyTo: messageId, silent: true },
        nowMs
      );
    }
  }

  /** The watcher's own health: 503 when its loop is stale or Telegram has refused it for 15 minutes. */
  health(nowMs: number): { status: number; body: Record<string, unknown> } {
    const intervalMs = this.cfg.loop.intervalSeconds * 1000;
    const last = this.rt.lastCycleMs ?? this.rt.startedAtMs;
    const stale = nowMs - last > 3 * intervalMs;
    const failingSince = this.notifier.failingSinceMs();
    const deliveryBroken = failingSince !== null && nowMs - failingSince > 15 * 60_000;
    const ok = !stale && !deliveryBroken;
    return {
      status: ok ? 200 : 503,
      body: {
        ok,
        service: SERVICE,
        lastCycleAt: this.rt.lastCycleMs === null ? null : new Date(this.rt.lastCycleMs).toISOString(),
        ...(deliveryBroken ? { error: 'Telegram has refused every message for 15 minutes' } : {}),
        ...(stale ? { error: 'the watch loop has not completed a round recently' } : {}),
        build: this.env.buildCommit,
      },
    };
  }
}

function serveHealth(w: Watcher, port: number): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const { status, body } = w.health(Date.now());
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => log(`health on :${port}`));
  return server;
}

/** One watchdog look: exit when no round has completed within `limitMs`. */
export function watchdogCheck(
  lastRoundMs: number,
  limitMs: number,
  exit: (code: number) => void,
  nowMs: number
): void {
  const idle = nowMs - lastRoundMs;
  if (idle > limitMs) {
    warn(`watchdog: no round completed for ${Math.round(idle / 1000)} s — exiting so Fly restarts this machine`);
    exit(1);
  }
}

/** Look every 15 s; Fly restarts the machine when the watchdog exits it. */
export function startWatchdog(lastRoundMs: () => number, limitMs: number, exit: (code: number) => void): NodeJS.Timeout {
  const t = setInterval(() => watchdogCheck(lastRoundMs(), limitMs, exit, Date.now()), 15_000);
  t.unref();
  return t;
}

async function main(): Promise<void> {
  const cfg = loadWatchConfig();
  const env = loadEnv();
  const notifier: Notifier = env.dryRun
    ? new StdoutNotifier()
    : new TelegramNotifier(env.telegramToken as string, env.telegramChatId as string);
  const github = new Github(env.githubRepo, env.githubToken);
  const w = new Watcher(cfg, env, notifier, github, Date.now());

  log(`build ${env.buildCommit}`);
  log(`messages: ${env.dryRun ? 'DRY RUN — printed, not sent' : 'Telegram'}`);
  log(`chain reads: ${new URL(env.chainRpcUrl).host}`);
  log(`provider allowance probe: ${env.providerRpcUrl ? 'on' : 'OFF (WATCH_PROVIDER_RPC_URL unset)'}`);
  log(`CI lanes and diagnosis: ${env.githubToken ? 'on' : 'OFF (WATCH_GITHUB_TOKEN unset)'}`);
  serveHealth(w, env.port);
  startWatchdog(() => w.rt.lastCycleMs ?? w.rt.startedAtMs, cfg.loop.watchdogSeconds * 1000, (code) => process.exit(code));

  const round = async (): Promise<void> => {
    try {
      await w.cycle();
    } catch (e) {
      // Each source's failure is data inside a round; a round that THROWS is
      // a bug in the watcher. It does not count as a completed round, so a
      // persistent one turns /health 503 and trips the watchdog — loud, via
      // backend-watch — instead of a watcher that runs and says nothing.
      warn(`round failed: ${(e as Error).stack ?? String(e)}`);
    }
    setTimeout(round, cfg.loop.intervalSeconds * 1000);
  };
  log('READY — silent while everything passes');
  await round();
}

if (require.main === module) {
  main().catch((e) => {
    warn(`fatal: ${(e as Error).message}`);
    process.exit(1);
  });
}
