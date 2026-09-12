/**
 * The private /metrics listener (audit 2026-09-11, E-09 / A-19).
 *
 * THE DEFECT. The Prometheus sink, `createMetricsServer` and
 * `serveMetricsIfPrometheus` had all existed and been tested since Step 6,
 * and not one was reachable in a deployment: no environment selected the
 * sink, and nothing started either server. Every alert in the system was a
 * single line on standard output.
 *
 * THE SECOND DEFECT, found while fixing the first. The indexer's one
 * `/metrics` route was mounted on its WEBHOOK port — the port the platform
 * routes to the internet, where the delivery arrives and where the deploy
 * probes health from a hosted runner. It was unreachable only because no
 * deployment had selected the sink, so simply selecting it would have
 * published the exposition, which names every counter and every alert reason
 * this system keeps. The route moved to a listener of its own on the private
 * network; these tests hold the listener to that.
 */
import { expect } from 'chai';
import type { AddressInfo } from 'net';
import { buildMonitor } from '../src/monitor';
import {
  DEFAULT_METRICS_PORT,
  METRICS_PORT_ENV,
  startMetricsListener,
} from '../src/metrics-listener';

function prometheusMonitor() {
  return buildMonitor({ sink: 'prometheus' }, 'test-service', {
    logger: { info: () => undefined, error: () => undefined },
  });
}

describe('startMetricsListener (E-09)', () => {
  it('binds nothing on the logging sink, and says so', () => {
    const lines: string[] = [];
    const server = startMetricsListener(
      buildMonitor({ sink: 'logging' }, 'test-service', {
        logger: { info: () => undefined, error: () => undefined },
      }),
      'test-service',
      {},
      { log: (l) => lines.push(l) }
    );
    expect(server, 'no sink, no listener').to.equal(null);
    expect(lines.join(' ')).to.contain('not prometheus');
  });

  it('binds nothing on the silent sink either', () => {
    expect(
      startMetricsListener(buildMonitor({ sink: 'silent' }, 's'), 's', {}, { log: () => undefined })
    ).to.equal(null);
  });

  /**
   * A port the operating system has just told us is free. The listener itself
   * refuses port 0 — a scrape target on a randomly assigned port is no scrape
   * target — so the test cannot ask for an ephemeral one and has to name a
   * real number instead.
   */
  async function freePort(): Promise<number> {
    const { createServer } = await import('net');
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

  it('serves the exposition on the Prometheus sink, and nothing else', async () => {
    const monitor = prometheusMonitor();
    monitor.recordEvent('probe_event_total');
    const port = await freePort();
    const server = startMetricsListener(
      monitor,
      'test-service',
      { [METRICS_PORT_ENV]: String(port) },
      { log: () => undefined }
    );
    expect(server).to.not.equal(null);
    await new Promise<void>((resolve) => {
      if (server!.listening) return resolve();
      server!.on('listening', () => resolve());
    });
    try {
      const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(metrics.status).to.equal(200);
      expect(metrics.headers.get('content-type')).to.contain('text/plain');
      expect(await metrics.text()).to.contain('probe_event_total');

      // Nothing else is a route. A metrics listener that answers anything
      // else is a second service surface nobody reviewed.
      for (const path of ['/', '/health', '/bundles']) {
        expect((await fetch(`http://127.0.0.1:${port}${path}`)).status, path).to.equal(404);
      }
    } finally {
      server!.close();
    }
  });

  it('refuses a port setting that is not a whole number, rather than binding port 0', () => {
    // Port 0 is not an error to the operating system: it binds a random port,
    // and a scrape target on an unpredictable port is no scrape target.
    for (const bad of ['', 'abc', '0', '70000']) {
      expect(
        () => startMetricsListener(prometheusMonitor(), 's', { [METRICS_PORT_ENV]: bad }, { log: () => undefined }),
        bad
      ).to.throw(new RegExp(METRICS_PORT_ENV));
    }
  });

  it('names a default port so a deployment need not set one', () => {
    expect(DEFAULT_METRICS_PORT).to.be.a('number');
    expect(DEFAULT_METRICS_PORT).to.be.greaterThan(1024);
  });
});

describe('the exposition is not on a publicly routed port (E-09)', () => {
  it('the indexer webhook server does not route /metrics', async () => {
    // Read as source rather than driven as a server: the webhook needs a
    // store, a secret and a database handle to start, and the property under
    // test is a routing decision, not a behaviour under load. If this route
    // ever comes back, it comes back where a reader of this file sees it.
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '..', '..', 'indexer', 'src', 'webhook.ts'),
      'utf8'
    );
    expect(src, 'the webhook port is the one the platform routes publicly').to.not.contain(
      'serveMetricsIfPrometheus('
    );
    expect(src, 'and the file says why, for whoever is tempted to add it back').to.contain(
      'NO `/metrics` here'
    );
  });
});
