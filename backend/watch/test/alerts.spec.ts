import { expect } from 'chai';
import { ALERT } from '../../_shared/src/metrics';
import { AlertCounterTracker, alertSeverity, parseAlertCounters } from '../src/alerts';

const line = (reason: string, n: number, service = 'daemon'): string =>
  `blotto_alerts_total{reason="${reason.replace(/"/g, '\\"')}",service="${service}"} ${n}`;

const expo = (...lines: string[]): string =>
  ['# HELP blotto_alerts_total Alerts raised', '# TYPE blotto_alerts_total counter', ...lines, 'reveal_tick{outcome="ok",service="daemon"} 412'].join('\n');

describe('reading blotto_alerts_total', () => {
  it('parses reasons, including escaped quotes, and ignores other series and comments', () => {
    const m = parseAlertCounters(expo(line('a "quoted" reason', 3), line(ALERT.reveal.bundleUnpublished, 1)));
    expect(m.get('a "quoted" reason')).to.equal(3);
    expect(m.get(ALERT.reveal.bundleUnpublished)).to.equal(1);
    expect(m.size).to.equal(2);
  });
});

describe('the alert counter tracker', () => {
  const T = Date.parse('2026-10-15T00:00:00Z');
  const quiet = 60 * 60_000;
  const reason = ALERT.reveal.entryRefundOwed;

  it('takes a baseline on the first scrape of an app, raising nothing', () => {
    const t = new AlertCounterTracker(quiet, new Set());
    const out = t.observe('blotto-daemon', expo(line(reason, 4)), T);
    expect(out.map((r) => r.status)).to.deep.equal(['pass']);
  });

  it('fires on an increase, and on a reason that first appears after a good scrape', () => {
    const t = new AlertCounterTracker(quiet, new Set());
    t.observe('blotto-daemon', expo(line(reason, 4)), T);
    expect(t.observe('blotto-daemon', expo(line(reason, 5)), T + 60_000)[0].status).to.equal('fail');
    const appeared = t.observe('blotto-daemon', expo(line(reason, 5), line(ALERT.reveal.forfeitUnlanded, 1)), T + 120_000);
    expect(appeared.find((r) => r.key.endsWith(ALERT.reveal.forfeitUnlanded))?.status).to.equal('fail');
  });

  it('re-baselines silently when a counter goes down (the service restarted)', () => {
    const t = new AlertCounterTracker(quiet, new Set());
    t.observe('blotto-daemon', expo(line(reason, 9)), T);
    expect(t.observe('blotto-daemon', expo(line(reason, 1)), T + 60_000)[0].status).to.equal('pass');
  });

  it('clears after a quiet period, and reads unknown when the scrape fails', () => {
    const t = new AlertCounterTracker(quiet, new Set());
    t.observe('blotto-daemon', expo(line(reason, 1)), T);
    t.observe('blotto-daemon', expo(line(reason, 2)), T + 60_000);
    expect(t.observe('blotto-daemon', null, T + 120_000)[0].status).to.equal('unknown');
    expect(t.observe('blotto-daemon', expo(line(reason, 2)), T + 60_000 + quiet)[0].status).to.equal('pass');
  });

  it('skips ignored reasons, and keys each alert by app and reason', () => {
    const t = new AlertCounterTracker(quiet, new Set([ALERT.reveal.tickStale]));
    t.observe('blotto-daemon', expo(), T);
    const out = t.observe('blotto-daemon', expo(line(ALERT.reveal.tickStale, 1), line(reason, 1)), T + 60_000);
    expect(out.map((r) => r.key)).to.deep.equal([`alerts:blotto-daemon:${reason}`]);
  });

  it('calls the alerts that affect players critical', () => {
    expect(alertSeverity(ALERT.reveal.entryRefundOwed)).to.equal('critical');
    expect(alertSeverity(ALERT.indexer.reconcileFailed)).to.equal('warning');
  });
});
