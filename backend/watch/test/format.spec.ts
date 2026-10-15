import { expect } from 'chai';
import { escapeHtml, formatDuration, renderAlert, renderCleared, renderReminder } from '../src/format';
import type { Incident } from '../src/incidents';

const inc = (key: string, extra: Partial<Incident> = {}): Incident => ({
  key,
  title: `title of ${key}`,
  detail: `detail of ${key}`,
  severity: 'critical',
  facts: {},
  openedAtMs: 0,
  messageId: null,
  lastNotifiedAtMs: 0,
  parentKey: null,
  sinceRestart: false,
  ...extra,
});

describe('Telegram messages', () => {
  it('escapes every dynamic string', () => {
    const html = renderAlert([inc('service:blotto-daemon', { detail: 'HTTP 502: <html>bad & worse</html>' })], { diagnosing: false });
    expect(html).to.contain('HTTP 502: &lt;html&gt;bad &amp; worse&lt;/html&gt;');
    expect(html).not.to.contain('<html>');
  });

  it('names the cause and the first step, and says when a diagnosis is coming', () => {
    const html = renderAlert([inc('pools:not-enterable', { detail: 'pool 101 (hard): no pass collection' })], { diagnosing: true });
    expect(html).to.contain('pool 101 (hard): no pass collection');
    expect(html).to.contain('Likely cause:');
    expect(html).to.contain('What to do:');
    expect(html).to.contain('Claude is diagnosing');
  });

  it('stays under the Telegram limit with fifty incidents, saying how many were left out', () => {
    const many = Array.from({ length: 50 }, (_, i) => inc(`alerts:blotto-daemon:reason ${i}`, { detail: 'x'.repeat(200) }));
    const html = renderAlert(many, { diagnosing: true });
    expect(html.length).to.be.at.most(4096);
    expect(html).to.match(/and \d+ more not shown/);
  });

  it('says it may predate the watcher after a restart', () => {
    expect(renderAlert([inc('a', { sinceRestart: true })], { diagnosing: false })).to.contain('watcher restarted');
  });

  it('words the all-clear and the reminder', () => {
    expect(renderCleared([{ incident: inc('a'), minutesOpen: 42 }])).to.equal('✅ <b>Cleared:</b> title of a (after 42 min)');
    expect(renderReminder([inc('a', { openedAtMs: 0 })], 5 * 3_600_000)).to.contain('open 5 h');
    expect(formatDuration(125)).to.equal('2 h 5 min');
    expect(escapeHtml('a<b>&c')).to.equal('a&lt;b&gt;&amp;c');
  });
});
