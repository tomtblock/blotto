import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
  DIAGNOSIS_SCHEMA,
  diagnosable,
  extractFailure,
  extractStructuredOutput,
  keysToDiagnose,
  newDispatchLog,
  parseDiagnosis,
  recordDispatch,
  renderDiagnosis,
  renderDiagnosisUnavailable,
  type Diagnosis,
} from '../src/diagnosis';
import type { Incident } from '../src/incidents';

const inc = (key: string, facts: Record<string, string> = {}): Incident => ({
  key,
  title: key,
  detail: '',
  severity: 'critical',
  facts,
  openedAtMs: 0,
  messageId: null,
  lastNotifiedAtMs: 0,
  parentKey: null,
  sinceRestart: false,
});

const limits = { maxPerDay: 6, minMinutesBetweenSameCheck: 360 };
const T = Date.parse('2026-10-15T00:00:00Z');

describe('when to ask Claude', () => {
  it('diagnoses what logs can explain, and not what the alert already answers', () => {
    expect(diagnosable(inc('daemon:tick-errors'))).to.equal(true);
    expect(diagnosable(inc('pools:not-enterable'))).to.equal(true);
    expect(diagnosable(inc('github:deploy-backend'))).to.equal(true);
    expect(diagnosable(inc('daemon:settlement-sol'))).to.equal(false);
    expect(diagnosable(inc('treasury:short'))).to.equal(false);
    expect(diagnosable(inc('watch:github'))).to.equal(false);
    expect(diagnosable(inc('rpc:primary', { state: 'creditsSpent' }))).to.equal(false);
    expect(diagnosable(inc('rpc:primary', { state: 'unreachable' }))).to.equal(true);
  });

  it('keeps to the daily cap and the per-check gap', () => {
    const log = newDispatchLog();
    expect(keysToDiagnose([inc('pools:stuck')], log, limits, T)).to.deep.equal(['pools:stuck']);
    recordDispatch(log, ['pools:stuck'], T);
    expect(keysToDiagnose([inc('pools:stuck')], log, limits, T + 60_000)).to.deep.equal([]);
    expect(keysToDiagnose([inc('pools:stuck')], log, limits, T + 361 * 60_000)).to.deep.equal(['pools:stuck']);
    for (let i = 1; i < 6; i++) recordDispatch(log, [`k${i}`], T + i);
    expect(keysToDiagnose([inc('daemon:tick-errors')], log, limits, T + 10)).to.deep.equal([]);
    expect(keysToDiagnose([inc('daemon:tick-errors')], log, limits, T + 86_400_001)).to.deep.equal(['daemon:tick-errors']);
  });
});

describe("Claude's answer", () => {
  const good: Diagnosis = {
    headline: 'The daemon cannot create pass collections',
    cause: 'create_pass_collection fails with 0x1771 at backend/reveal/src/daemon.ts:476',
    evidence: ['daemon: tick error {"action":"keeper","tier":0}'],
    fix_steps: ['Run backend-status', 'Restart the daemon'],
    fix_kind: 'operator',
    confidence: 'medium',
    ask_claude: 'Fix the keeper launch step failing on pool 101',
  };

  it('accepts the schema and refuses anything else', () => {
    expect(parseDiagnosis(JSON.stringify(good))).to.deep.equal(good);
    expect(parseDiagnosis('not json')).to.equal(null);
    expect(parseDiagnosis(JSON.stringify({ ...good, fix_kind: 'magic' }))).to.equal(null);
    expect(parseDiagnosis(JSON.stringify({ ...good, evidence: 'one string' }))).to.equal(null);
  });

  it('redacts what Claude wrote a second time before it reaches the group', () => {
    const leaky = { ...good, evidence: ['client 198.51.100.7 hit ?api-key=abc123'] };
    const html = renderDiagnosis(leaky);
    expect(html).not.to.contain('198.51.100.7');
    expect(html).not.to.contain('abc123');
    expect(html).to.contain('paste this into Claude Code');
    expect(html.length).to.be.at.most(4096);
  });
});

describe('reading the answer out of the execution file', () => {
  const answer = { headline: 'h', cause: 'c', evidence: [], fix_steps: [], fix_kind: 'unknown', confidence: 'low', ask_claude: 'a' };

  it('takes structured_output from the final result message', () => {
    const file = JSON.stringify([
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [] } },
      { type: 'result', subtype: 'success', structured_output: answer },
    ]);
    expect(JSON.parse(extractStructuredOutput(file) ?? 'null')).to.deep.equal(answer);
  });

  it('reads one-message-per-line files, and JSON text in result', () => {
    const file = [JSON.stringify({ type: 'system' }), JSON.stringify({ type: 'result', result: `Here:\n${JSON.stringify(answer)}` })].join('\n');
    expect(JSON.parse(extractStructuredOutput(file) ?? 'null')).to.deep.equal(answer);
  });

  it('returns null when there is no answer', () => {
    expect(extractStructuredOutput('[]')).to.equal(null);
    expect(extractStructuredOutput('garbage')).to.equal(null);
  });
});

describe('saying why there is no answer', () => {
  // The shape of the 2026-10-16 runs: one turn, 255 ms, no model usage.
  const refused = (result: unknown) =>
    JSON.stringify([
      { type: 'system', subtype: 'init', model: 'm' },
      { type: 'result', subtype: 'success', is_error: true, duration_ms: 255, num_turns: 1, result },
    ]);

  it('quotes what Claude Code said when the session ended in error', () => {
    expect(extractFailure(refused('Invalid API key · Please run /login'))).to.equal('Invalid API key · Please run /login');
  });

  it('names the error subtype when there is no text', () => {
    const file = JSON.stringify([{ type: 'result', subtype: 'error_max_turns', is_error: true }]);
    expect(extractFailure(file)).to.equal('error_max_turns');
  });

  it('reads the errors list when the result carries no text', () => {
    const file = JSON.stringify({ type: 'result', subtype: 'error_during_execution', errors: ['first', 'second'] });
    expect(extractFailure(file)).to.equal('first; second');
  });

  it('says nothing when the session did not end in error', () => {
    const file = JSON.stringify([{ type: 'result', subtype: 'success', is_error: false, result: 'prose, no JSON' }]);
    expect(extractFailure(file)).to.equal(null);
    expect(extractFailure('[]')).to.equal(null);
    expect(extractFailure('garbage')).to.equal(null);
  });

  it('redacts it and keeps it to one short line', () => {
    const said = extractFailure(refused(`request from 198.51.100.7 refused\n${'x'.repeat(500)}`)) ?? '';
    expect(said).not.to.contain('198.51.100.7');
    expect(said).not.to.contain('\n');
    expect(said.length).to.be.at.most(200);
  });

  it('puts it in the unavailable reply, escaped', () => {
    const html = renderDiagnosisUnavailable('the diagnosis step did not finish (failure)', null, 'limit <reached>');
    expect(html).to.contain('Claude Code said: <i>limit &lt;reached&gt;</i>');
    expect(html).to.contain('The likely cause above still stands.');
    expect(renderDiagnosisUnavailable('it produced no answer', null)).not.to.contain('Claude Code said');
  });
});

describe('the workflow asks Claude for exactly this schema', () => {
  it('diagnose.yml --json-schema equals DIAGNOSIS_SCHEMA', () => {
    const wf = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/diagnose.yml'), 'utf8');
    const m = /--json-schema '([^']+)'/.exec(wf);
    expect(m, 'diagnose.yml passes --json-schema').to.not.equal(null);
    expect(JSON.parse(m![1])).to.deep.equal(DIAGNOSIS_SCHEMA);
  });

  it('gathers what rules out the platform: machine histories and Fly status (2026-10-16)', () => {
    const wf = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/diagnose.yml'), 'utf8');
    expect(wf).to.contain('flyctl machine status "$id" --app "$app"');
    expect(wf).to.contain('https://status.flyio.net/api/v2/summary.json');
    expect(wf).to.contain('<app>.machines.txt');
    expect(wf).to.contain('fly-status.json');
  });

  it('gives Claude read-only tools and nothing else', () => {
    const wf = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/diagnose.yml'), 'utf8');
    expect(wf).to.contain('--allowedTools Read,Grep,Glob\n');
    expect(wf).to.match(/--disallowedTools [^\n]*Bash[^\n]*WebFetch/);
  });
});
