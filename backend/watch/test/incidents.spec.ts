import { expect } from 'chai';
import type { CheckResult } from '../src/checks';
import { IncidentBook } from '../src/incidents';

const H = 3_600_000;
const T = Date.parse('2026-10-15T00:00:00Z');

const book = (startedAtMs = T - H): IncidentBook =>
  new IncidentBook({
    passesToClear: 2,
    reminderMs: 4 * H,
    laneReminderMs: 24 * H,
    flapWindowMs: 30 * 60_000,
    startedAtMs,
  });

const r = (key: string, status: CheckResult['status'], extra: Partial<CheckResult> = {}): CheckResult => ({
  key,
  status,
  title: key,
  detail: `${key} ${status}`,
  severity: 'critical',
  failuresToOpen: 3,
  ...extra,
});

describe('the incident book', () => {
  it('says nothing until a check fails failuresToOpen times in a row', () => {
    const b = book();
    expect(b.observe([r('a', 'fail')], T).opened).to.have.length(0);
    expect(b.observe([r('a', 'fail')], T + 1).opened).to.have.length(0);
    expect(b.observe([r('a', 'fail')], T + 2).opened.map((i) => i.key)).to.deep.equal(['a']);
    expect(b.observe([r('a', 'fail')], T + 3).opened).to.have.length(0);
  });

  it('treats unknown as neutral: it neither breaks a failing run nor counts as a pass', () => {
    const b = book();
    b.observe([r('a', 'fail')], T);
    b.observe([r('a', 'unknown')], T + 1);
    b.observe([r('a', 'fail')], T + 2);
    expect(b.observe([r('a', 'fail')], T + 3).opened).to.have.length(1);
  });

  it('a pass resets the run of failures', () => {
    const b = book();
    b.observe([r('a', 'fail')], T);
    b.observe([r('a', 'fail')], T + 1);
    b.observe([r('a', 'pass')], T + 2);
    expect(b.observe([r('a', 'fail')], T + 3).opened).to.have.length(0);
  });

  it('opens everything failing in the same round as one batch', () => {
    const b = book();
    const p = b.observe([r('x', 'fail', { failuresToOpen: 1 }), r('y', 'fail', { failuresToOpen: 1 })], T);
    expect(p.opened.map((i) => i.key)).to.deep.equal(['x', 'y']);
  });

  it('clears after clearAfterPasses passes, reporting how long it was open', () => {
    const b = book();
    b.observe([r('a', 'fail', { failuresToOpen: 1 })], T);
    b.attachMessage(['a'], 7);
    expect(b.observe([r('a', 'pass')], T + 20 * 60_000).cleared).to.have.length(0);
    const p = b.observe([r('a', 'pass')], T + 42 * 60_000);
    expect(p.cleared).to.have.length(1);
    expect(p.cleared[0].minutesOpen).to.equal(42);
    expect(p.cleared[0].incident.messageId).to.equal(7);
  });

  it('threads a consequence under an already-open cause; silent unless players are affected', () => {
    const b = book();
    b.observe([r('rpc:primary', 'fail', { failuresToOpen: 1 })], T);
    b.attachMessage(['rpc:primary'], 11);
    const p = b.observe(
      [r('rpc:primary', 'fail'), r('indexer:behind', 'fail', { failuresToOpen: 1, severity: 'warning' }), r('pools:not-enterable', 'fail', { failuresToOpen: 1 })],
      T + 60_000
    );
    expect(p.opened).to.have.length(0);
    expect(p.threaded.map((t) => [t.incident.key, t.parent.key, t.silent])).to.deep.equal([
      ['indexer:behind', 'rpc:primary', true],
      ['pools:not-enterable', 'rpc:primary', false],
    ]);
  });

  it('never threads two incidents opening in the same round under each other (no deadlock)', () => {
    // daemon:tick-stale and service:blotto-daemon each list the other as a consequence.
    const b = book();
    const p = b.observe(
      [r('daemon:tick-stale', 'fail', { failuresToOpen: 1 }), r('service:blotto-daemon', 'fail', { failuresToOpen: 1 })],
      T
    );
    expect(p.opened.map((i) => i.key)).to.have.members(['daemon:tick-stale', 'service:blotto-daemon']);
    expect(p.threaded).to.have.length(0);
  });

  it('reminds every reminderMs while open, and a red CI lane only every laneReminderMs', () => {
    const b = book();
    b.observe([r('a', 'fail', { failuresToOpen: 1 }), r('github:ci-fast', 'fail', { failuresToOpen: 1 })], T);
    expect(b.observe([r('a', 'fail')], T + 3 * H).reminders).to.have.length(0);
    expect(b.observe([r('a', 'fail')], T + 4 * H).reminders.map((i) => i.key)).to.deep.equal(['a']);
    expect(b.observe([], T + 23 * H).reminders.map((i) => i.key)).to.deep.equal(['a']);
    expect(b.observe([], T + 24 * H).reminders.map((i) => i.key)).to.include('github:ci-fast');
  });

  it('a key failing again soon after clearing goes back into its old thread', () => {
    const b = book();
    b.observe([r('a', 'fail', { failuresToOpen: 1 })], T);
    b.attachMessage(['a'], 21);
    b.observe([r('a', 'pass')], T + 60_000);
    b.observe([r('a', 'pass')], T + 120_000);
    const p = b.observe([r('a', 'fail', { failuresToOpen: 1 })], T + 10 * 60_000);
    expect(p.opened).to.have.length(0);
    expect(p.again.map((x) => [x.incident.key, x.threadId])).to.deep.equal([['a', 21]]);
  });

  it('marks openings soon after the watcher started: they may predate it', () => {
    const b = book(T);
    expect(b.observe([r('a', 'fail', { failuresToOpen: 1 })], T + 60_000).opened[0].sinceRestart).to.equal(true);
    const later = book(T - H);
    expect(later.observe([r('a', 'fail', { failuresToOpen: 1 })], T).opened[0].sinceRestart).to.equal(false);
  });

  it('a consequence whose cause cleared stands on its own and is reminded from then on', () => {
    const b = book();
    b.observe([r('rpc:primary', 'fail', { failuresToOpen: 1 })], T);
    b.attachMessage(['rpc:primary'], 5);
    b.observe([r('rpc:primary', 'fail'), r('indexer:behind', 'fail', { failuresToOpen: 1 })], T + 1);
    b.observe([r('rpc:primary', 'pass'), r('indexer:behind', 'fail')], T + 2);
    b.observe([r('rpc:primary', 'pass'), r('indexer:behind', 'fail')], T + 3);
    const p = b.observe([r('indexer:behind', 'fail')], T + 5 * H);
    expect(p.reminders.map((i) => i.key)).to.deep.equal(['indexer:behind']);
  });
});
