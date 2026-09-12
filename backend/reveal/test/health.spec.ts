/**
 * The daemon's /health contract. Three states, and the third is the one that
 * matters: a process still initialising past the startup budget must report
 * UNHEALTHY, or binding the port early trades a visible deploy failure for a
 * machine that looks fine while doing nothing.
 *
 * Real HTTP is exercised too — the 2026-09-06 failure was not a handler bug,
 * it was a port that was not open — so one spec starts the server on an
 * ephemeral port and reads /health over the wire before the daemon would have
 * finished its first await.
 */

import { expect } from 'chai';
import { get } from 'http';
import type { AddressInfo } from 'net';
import {
  STALE_TICK_MS,
  STARTUP_BUDGET_MS,
  healthPayload,
  newDaemonHealth,
  serveDaemonHealth,
  type DaemonHealth,
} from '../src/health';
import type { TickReport } from '../src/daemon';

const T0 = Date.parse('2026-09-06T02:00:00Z');

function report(errors = 0): TickReport {
  return {
    opened: [{ poolId: 1n, tier: 0 }],
    cranked: [],
    refundsTriggered: [],
    sealedAtDeadline: [],
    released: [],
    nextPlacePaid: [],
    held: [],
    published: [],
    completed: [],
    // A real TickReport, not a cast: a fixture that lies about its own shape
    // is how a summary quietly stops matching what it summarises.
    errors: Array.from({ length: errors }, (_, i) => ({
      action: 'crank',
      poolId: '1',
      message: `error ${i}`,
    })),
  };
}

function starting(phase: DaemonHealth['phase'] = 'switchboard'): DaemonHealth {
  const state = newDaemonHealth(T0);
  state.phase = phase;
  return state;
}

describe('the daemon health payload', () => {
  it('reports 200 while still starting, so the platform stops killing it mid-init', () => {
    // 25s in: the Switchboard fetch alone took 21s on the run that failed.
    const { status, body } = healthPayload(starting(), T0 + 25_000);
    expect(status).to.equal(200);
    expect(body.ready).to.equal(false);
    expect(body.ok).to.equal(true);
    expect(body.phase).to.equal('switchboard');
    expect(body.uptimeMs).to.equal(25_000);
    expect(body.lastTick).to.equal(null);
  });

  it('reports 503 once initialisation is past the budget — a wedged daemon is not healthy', () => {
    const { status, body } = healthPayload(starting('irys'), T0 + STARTUP_BUDGET_MS + 1);
    expect(status).to.equal(503);
    expect(body.ok).to.equal(false);
    expect(body.ready).to.equal(false);
    expect(String(body.error)).to.match(/stuck/);
  });

  it('holds 200 right up to the budget, and flips the moment it is exceeded', () => {
    expect(healthPayload(starting(), T0 + STARTUP_BUDGET_MS).status).to.equal(200);
    expect(healthPayload(starting(), T0 + STARTUP_BUDGET_MS + 1).status).to.equal(503);
  });

  it('reports ready with the last tick summarised once the loop is running', () => {
    const state = newDaemonHealth(T0);
    state.phase = 'ready';
    state.lastTick = { at: '2026-09-06T02:01:00.000Z', report: report(2) };
    // A minute after that tick — well inside the staleness budget.
    const { status, body } = healthPayload(state, T0 + 120_000);
    expect(status).to.equal(200);
    expect(body.ready).to.equal(true);
    expect(body.lastTick).to.deep.equal({
      at: '2026-09-06T02:01:00.000Z',
      opened: 1,
      cranked: 0,
      refundsTriggered: 0,
      sealedAtDeadline: 0,
      released: 0,
      nextPlacePaid: 0,
      held: 0,
      published: 0,
      errors: 2,
    });
  });

  it('judges a ready daemon by its ticks, never by its age: a fresh tick keeps a month-old process healthy', () => {
    // Until 2026-09-12 this test said the opposite — that a ready daemon
    // could never fail for age — which is the C-27 defect in one line.
    const state = newDaemonHealth(T0);
    state.phase = 'ready';
    state.readyAtMs = T0 + 30_000;
    const aMonth = T0 + 30 * 24 * 3600 * 1000;
    state.lastTick = { at: new Date(aMonth - 1_000).toISOString(), report: report() };
    expect(healthPayload(state, aMonth).status).to.equal(200);
    expect(healthPayload(state, aMonth + STALE_TICK_MS + 1).status).to.equal(503);
  });
});

describe('the daemon health server', () => {
  it('answers on the port before initialisation finishes', async () => {
    const state = starting('connecting');
    const server = serveDaemonHealth(state, 0, () => T0 + 5_000);
    try {
      const port = (server.address() as AddressInfo).port;
      const { status, json } = await fetchHealth(port, '/health');
      expect(status).to.equal(200);
      expect(json.ready).to.equal(false);
      expect(json.phase).to.equal('connecting');
    } finally {
      server.close();
    }
  });

  it('serves the same state object the daemon mutates, so ready shows up without a restart', async () => {
    const state = starting('irys');
    const server = serveDaemonHealth(state, 0, () => T0 + 5_000);
    try {
      const port = (server.address() as AddressInfo).port;
      expect((await fetchHealth(port, '/health')).json.ready).to.equal(false);
      state.phase = 'ready';
      expect((await fetchHealth(port, '/health')).json.ready).to.equal(true);
    } finally {
      server.close();
    }
  });

  it('404s anything that is not /health', async () => {
    const server = serveDaemonHealth(starting(), 0, () => T0);
    try {
      const port = (server.address() as AddressInfo).port;
      expect((await fetchHealth(port, '/')).status).to.equal(404);
    } finally {
      server.close();
    }
  });
});

function fetchHealth(
  port: number,
  path: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json: Record<string, unknown> = {};
        try {
          json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          json = {};
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    }).on('error', reject);
  });
}

/*
 * A READY daemon that stops ticking is unhealthy (2026-09-12, audit
 * 2026-09-11: C-05 / C-22 / C-27 / E-04). Before this the endpoint could
 * never say so again once it had said ready.
 */
describe('the daemon health payload once ready: tick staleness', () => {
  function ready(readyAtMs: number): DaemonHealth {
    const state = newDaemonHealth(T0);
    state.phase = 'ready';
    state.readyAtMs = readyAtMs;
    return state;
  }

  it('is healthy while the last tick is younger than the budget', () => {
    const state = ready(T0 + 30_000);
    state.lastTick = { at: new Date(T0 + 60_000).toISOString(), report: report() };
    const { status, body } = healthPayload(state, T0 + 60_000 + STALE_TICK_MS - 1);
    expect(status).to.equal(200);
    expect(body.ok).to.equal(true);
    expect(body.ready).to.equal(true);
  });

  it('turns 503 once no tick has completed for the budget, and says how long', () => {
    const state = ready(T0 + 30_000);
    state.lastTick = { at: new Date(T0 + 60_000).toISOString(), report: report() };
    const { status, body } = healthPayload(state, T0 + 60_000 + STALE_TICK_MS + 1);
    expect(status).to.equal(503);
    expect(body.ok).to.equal(false);
    expect(body.ready).to.equal(true, 'ready is a fact about startup, not about liveness');
    expect(body.sinceTickMs).to.equal(STALE_TICK_MS + 1);
    expect(String(body.error)).to.match(/no tick completed/);
    expect(String(body.error)).to.match(/restart/);
  });

  it('judges a daemon that never ticked from the moment it became ready', () => {
    const state = ready(T0 + 30_000);
    expect(healthPayload(state, T0 + 30_000 + STALE_TICK_MS).status).to.equal(200);
    expect(healthPayload(state, T0 + 30_000 + STALE_TICK_MS + 1).status).to.equal(503);
  });

  it('a fresh tick makes it healthy again', () => {
    const state = ready(T0 + 30_000);
    state.lastTick = { at: new Date(T0 + 60_000).toISOString(), report: report() };
    expect(healthPayload(state, T0 + 60_000 + STALE_TICK_MS + 1).status).to.equal(503);
    state.lastTick = { at: new Date(T0 + 60_000 + STALE_TICK_MS + 1).toISOString(), report: report() };
    expect(healthPayload(state, T0 + 60_000 + STALE_TICK_MS + 2).status).to.equal(200);
  });
});
