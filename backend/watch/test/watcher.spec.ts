import { expect } from 'chai';
import { daemonResults, poolResults, TickMemory } from '../src/checks';
import { loadEnv } from '../src/config';
import { renderAlert } from '../src/format';
import { Github } from '../src/github';
import { IncidentBook } from '../src/incidents';
import { watchdogCheck, Watcher } from '../src/main';
import type { Notifier } from '../src/telegram';
import { cfg, chainPool, snapshot, T0 } from './fixtures';

describe('replaying the 2026-10-10 entry outage', () => {
  it('raises "Entries are blocked" within minutes, in one message with the daemon errors', () => {
    // Pool 101 opened at T0; the daemon's launch step threw every tick, so the
    // pass collection never appeared, while /health said ok:true throughout.
    const book = new IncidentBook({
      passesToClear: cfg.incidents.clearAfterPasses,
      reminderMs: cfg.incidents.reminderHours * 3_600_000,
      laneReminderMs: cfg.incidents.laneReminderHours * 3_600_000,
      flapWindowMs: cfg.incidents.flapWindowMinutes * 60_000,
      startedAtMs: 0,
    });
    const mem = new TickMemory();
    const wallT0 = Date.parse('2026-10-15T02:00:00Z');
    let message = '';
    let minute = 0;
    for (; minute < 15 && message === ''; minute++) {
      const wall = wallT0 + minute * 60_000;
      const snap = snapshot(T0 + BigInt(minute * 60), [
        chainPool({ id: 101n, openedAt: T0, fillDeadline: T0 + 24_000n, mode: 1 }, { hasPassCollection: false }),
      ]);
      const results = [
        ...daemonResults({ ok: true, ready: true, settlementSol: '9.2', lastTick: { at: new Date(wall - 5_000).toISOString(), errors: 2 } }, mem, wall, cfg, false),
        ...poolResults(snap, new Map(), null, cfg),
      ];
      const plan = book.observe(results, wall);
      if (plan.opened.length > 0) message = renderAlert(plan.opened, { diagnosing: true });
    }
    expect(message).to.contain('Entries are blocked');
    expect(message).to.contain('pool 101 (hard): no pass collection');
    // Five days of silence become minutes: the grace plus the confirmations.
    expect(minute).to.be.at.most(Math.ceil(cfg.chain.passCollectionGraceSeconds / 60) + cfg.chain.failuresToAlert + 1);
  });
});

describe("the watcher's own health", () => {
  const silent: Notifier = { send: async () => 1, failingSinceMs: () => null };
  const env = loadEnv({ WATCH_DRY_RUN: '1' });

  it('is 200 while rounds complete, 503 once they stop', () => {
    const w = new Watcher(cfg, env, silent, new Github('x/y', null), 0);
    w.rt.lastCycleMs = 1_000_000;
    expect(w.health(1_000_000 + 60_000).status).to.equal(200);
    expect(w.health(1_000_000 + 4 * cfg.loop.intervalSeconds * 1000).status).to.equal(503);
  });

  it('is 503 when Telegram has refused every message for fifteen minutes', () => {
    const refusing: Notifier = { send: async () => null, failingSinceMs: () => 0 };
    const w = new Watcher(cfg, env, refusing, new Github('x/y', null), 0);
    w.rt.lastCycleMs = 16 * 60_000;
    const h = w.health(16 * 60_000 + 1);
    expect(h.status).to.equal(503);
    expect(h.body.error).to.match(/Telegram/);
  });

  it('the watchdog exits when rounds stop completing, and not before', () => {
    const codes: number[] = [];
    watchdogCheck(0, 1_000, (c) => codes.push(c), 900);
    expect(codes).to.deep.equal([]);
    watchdogCheck(0, 1_000, (c) => codes.push(c), 5_000);
    expect(codes).to.deep.equal([1]);
  });
});
