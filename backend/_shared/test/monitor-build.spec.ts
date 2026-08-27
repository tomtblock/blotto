/**
 * Sink-selection + Prometheus-sink specs (offline, hermetic — Step 6, T9).
 *
 * Proves: the single `BLOTTO_MONITOR_SINK` selector resolves `logging` (default) / `silent` /
 * `prometheus`; the default is `logging` so offline suites are network-free; selecting `prometheus`
 * needs NO network and NO SDK at import; `buildMonitor` tags every metric with the service label;
 * the Prometheus sink accumulates + renders text exposition and pushes to Discord only when (and
 * exactly when) a webhook is configured.
 */

import { expect } from 'chai';
import {
  buildMonitor,
  loadMonitor,
  MONITOR_SINK_ENV,
  LoggingMonitor,
  SILENT_MONITOR,
  PrometheusMonitor,
  serveMetricsIfPrometheus,
  ALERTS_TOTAL,
  type Logger,
} from '../src/index';

function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return {
    logger: { info: (m) => lines.push(m), error: (m) => lines.push(m) },
    lines,
  };
}

describe('loadMonitor — single BLOTTO_MONITOR_SINK selector', () => {
  it('defaults to logging when unset (offline suites stay network-free)', () => {
    expect(loadMonitor({}).sink).to.equal('logging');
  });

  it('resolves silent and prometheus explicitly', () => {
    expect(loadMonitor({ [MONITOR_SINK_ENV]: 'silent' }).sink).to.equal('silent');
    expect(loadMonitor({ [MONITOR_SINK_ENV]: 'prometheus' }).sink).to.equal('prometheus');
  });

  it('is case-insensitive and trims', () => {
    expect(loadMonitor({ [MONITOR_SINK_ENV]: '  Prometheus ' }).sink).to.equal('prometheus');
  });

  it('throws on an unknown sink', () => {
    expect(() => loadMonitor({ [MONITOR_SINK_ENV]: 'datadog' })).to.throw(/BLOTTO_MONITOR_SINK/);
  });
});

describe('buildMonitor — sink construction + service label', () => {
  it('builds the right concrete sink per selector', () => {
    expect(buildMonitor({ sink: 'logging' }, 'svc')).to.be.instanceOf(LoggingMonitor);
    expect(buildMonitor({ sink: 'silent' }, 'svc')).to.equal(SILENT_MONITOR);
    expect(buildMonitor({ sink: 'prometheus' }, 'svc')).to.be.instanceOf(PrometheusMonitor);
  });

  it('the logging sink injects the service label on every signal', () => {
    const { logger, lines } = capturingLogger();
    const monitor = buildMonitor({ sink: 'logging' }, 'indexer', { logger });
    monitor.recordEvent('indexer_ingested', { event: 'buy' });
    monitor.reportGauge('indexer_last_slot', 42);
    monitor.alert('boom', { detail: 1 });
    expect(lines[0]).to.contain('"service":"indexer"').and.to.contain('"event":"buy"');
    expect(lines[1]).to.contain('"service":"indexer"');
    expect(lines[2]).to.contain('"service":"indexer"');
  });

  it('selecting prometheus needs no network/SDK at import or construction', () => {
    // No webhook + no scrape → constructing the sink performs zero IO. (If this required a network
    // call or an SDK it would throw here under the hermetic runner.)
    const monitor = buildMonitor({ sink: 'prometheus' }, 'metadata');
    expect(monitor).to.be.instanceOf(PrometheusMonitor);
  });
});

describe('PrometheusMonitor — accumulation + text exposition', () => {
  it('accumulates counters and gauges and renders them with the service label', () => {
    const m = new PrometheusMonitor({ serviceLabel: 'indexer' });
    m.recordEvent('indexer_ingested');
    m.recordEvent('indexer_ingested');
    m.reportGauge('indexer_last_slot', 1000);
    m.reportGauge('indexer_last_slot', 1005); // gauge overwrites

    const text = m.exposition();
    expect(text).to.contain('# TYPE indexer_ingested counter');
    expect(text).to.contain('indexer_ingested{service="indexer"} 2');
    expect(text).to.contain('# TYPE indexer_last_slot gauge');
    expect(text).to.contain('indexer_last_slot{service="indexer"} 1005');
  });

  it('keeps distinct series per label set (bounded dimensions)', () => {
    const m = new PrometheusMonitor({ serviceLabel: 'indexer' });
    m.recordEvent('indexer_ingested', { event: 'buy' });
    m.recordEvent('indexer_ingested', { event: 'buy' });
    m.recordEvent('indexer_ingested', { event: 'sell' });
    const text = m.exposition();
    expect(text).to.contain('indexer_ingested{event="buy",service="indexer"} 2');
    expect(text).to.contain('indexer_ingested{event="sell",service="indexer"} 1');
  });

  it('alert() surfaces an blotto_alerts_total counter + loud log, no push without a webhook', () => {
    const { logger, lines } = capturingLogger();
    let posted = 0;
    const m = new PrometheusMonitor({
      serviceLabel: 'metadata',
      logger,
      post: () => (posted += 1),
    });
    m.alert('trait table commitment mismatch — serving refused', { asset: 'A' });
    expect(posted).to.equal(0); // no webhook configured → no network
    expect(lines.some((l) => l.includes('[monitor][ALERT]'))).to.equal(true);
    expect(m.exposition()).to.contain(
      `${ALERTS_TOTAL}{reason="trait table commitment mismatch — serving refused",service="metadata"} 1`
    );
  });

  it('alert() posts to Discord exactly when a webhook IS configured', () => {
    const posts: Array<{ url: string; body: string }> = [];
    const m = new PrometheusMonitor({
      serviceLabel: 'me-registration',
      discordWebhookUrl: 'https://discord.example/webhook',
      post: (url, body) => posts.push({ url, body }),
    });
    m.alert('fallback signer underfunded at startup', { lamports: 1 });
    expect(posts).to.have.length(1);
    expect(posts[0].url).to.equal('https://discord.example/webhook');
    expect(posts[0].body).to.contain('fallback signer underfunded at startup');
  });
});

describe('serveMetricsIfPrometheus — /metrics routing', () => {
  function fakeRes(): { res: any; captured: { status?: number; body?: string } } {
    const captured: { status?: number; body?: string } = {};
    const res = {
      writeHead: (status: number) => {
        captured.status = status;
        return res;
      },
      end: (body?: string) => {
        captured.body = body;
      },
    };
    return { res, captured };
  }

  it('does not handle when the sink is not Prometheus', () => {
    const { res, captured } = fakeRes();
    const handled = serveMetricsIfPrometheus(
      new LoggingMonitor(),
      { method: 'GET', url: '/metrics' } as any,
      res as any
    );
    expect(handled).to.equal(false);
    expect(captured.status).to.equal(undefined);
  });

  it('serves the exposition on GET /metrics under the Prometheus sink', () => {
    const m = new PrometheusMonitor({ serviceLabel: 'indexer' });
    m.recordEvent('indexer_ingested', { event: 'buy' });
    const { res, captured } = fakeRes();
    const handled = serveMetricsIfPrometheus(m, { method: 'GET', url: '/metrics?x=1' } as any, res as any);
    expect(handled).to.equal(true);
    expect(captured.status).to.equal(200);
    expect(captured.body).to.contain('indexer_ingested');
  });

  it('ignores non-GET and non-/metrics paths (caller routing continues)', () => {
    const m = new PrometheusMonitor({ serviceLabel: 'indexer' });
    const { res } = fakeRes();
    expect(serveMetricsIfPrometheus(m, { method: 'POST', url: '/metrics' } as any, res as any)).to.equal(false);
    expect(serveMetricsIfPrometheus(m, { method: 'GET', url: '/health' } as any, res as any)).to.equal(false);
  });
});
