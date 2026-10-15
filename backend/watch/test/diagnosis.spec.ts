import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
  DIAGNOSIS_SCHEMA,
  diagnosable,
  extractStructuredOutput,
  keysToDiagnose,
  newDispatchLog,
  parseDiagnosis,
  recordDispatch,
  renderDiagnosis,
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

describe('the workflow asks Claude for exactly this schema', () => {
  it('diagnose.yml --json-schema equals DIAGNOSIS_SCHEMA', () => {
    const wf = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/diagnose.yml'), 'utf8');
    const m = /--json-schema '([^']+)'/.exec(wf);
    expect(m, 'diagnose.yml passes --json-schema').to.not.equal(null);
    expect(JSON.parse(m![1])).to.deep.equal(DIAGNOSIS_SCHEMA);
  });

  it('gives Claude read-only tools and nothing else', () => {
    const wf = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/diagnose.yml'), 'utf8');
    expect(wf).to.contain('--allowedTools Read,Grep,Glob\n');
    expect(wf).to.match(/--disallowedTools [^\n]*Bash[^\n]*WebFetch/);
  });
});
