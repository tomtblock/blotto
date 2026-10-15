/*
 * When to ask Claude, and how its answer reads in the thread.
 *
 * The diagnosis runs in GitHub Actions (`.github/workflows/diagnose.yml`) on
 * the owner's Claude subscription — a quota shared with their own use — so
 * it is asked for sparingly: only for failures that logs and code can
 * explain, at most `maxPerDay` a day, and not twice for the same check
 * within `minMinutesBetweenSameCheck`. A spent RPC allowance, a low balance
 * or an expiring token are not diagnosed: the alert's own words are already
 * the whole answer.
 */

import { escapeHtml, fitBlocks } from './format';
import type { Incident } from './incidents';
import { redact } from './redact';

/** Incident keys a diagnosis can add something to. */
export function diagnosable(inc: Incident): boolean {
  const k = inc.key;
  if (k === 'rpc:primary') return inc.facts.state !== 'creditsSpent';
  return (
    k.startsWith('service:') ||
    k === 'daemon:tick-stale' ||
    k === 'daemon:tick-errors' ||
    k.startsWith('pools:') ||
    k.startsWith('indexer:') ||
    k.startsWith('alerts:') ||
    k.startsWith('github:') ||
    k === 'site:deploy-lag'
  );
}

export interface DispatchLog {
  /** When each diagnosis was started. */
  at: number[];
  /** Last diagnosis per incident key. */
  byKey: Map<string, number>;
}

export const newDispatchLog = (): DispatchLog => ({ at: [], byKey: new Map() });

/** The keys of `incidents` to diagnose now, honouring both limits; empty = do not dispatch. */
export function keysToDiagnose(
  incidents: Incident[],
  log: DispatchLog,
  limits: { maxPerDay: number; minMinutesBetweenSameCheck: number },
  nowMs: number
): string[] {
  const dayAgo = nowMs - 86_400_000;
  if (log.at.filter((t) => t > dayAgo).length >= limits.maxPerDay) return [];
  const gapMs = limits.minMinutesBetweenSameCheck * 60_000;
  return incidents
    .filter(diagnosable)
    // diagnose.yml refuses anything else in its inputs; a key it would
    // refuse must not leave a thread promising a diagnosis.
    .filter((i) => /^[A-Za-z0-9.:_ -]{1,120}$/.test(i.key))
    .filter((i) => {
      const last = log.byKey.get(i.key);
      return last === undefined || nowMs - last >= gapMs;
    })
    .map((i) => i.key);
}

export function recordDispatch(log: DispatchLog, keys: string[], nowMs: number): void {
  log.at = [...log.at.filter((t) => t > nowMs - 86_400_000), nowMs];
  for (const k of keys) log.byKey.set(k, nowMs);
}

/** The shape `diagnose.yml` asks Claude for (`--json-schema`). */
export interface Diagnosis {
  headline: string;
  cause: string;
  evidence: string[];
  fix_steps: string[];
  fix_kind: 'operator' | 'code' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  ask_claude: string;
}

export const DIAGNOSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'cause', 'evidence', 'fix_steps', 'fix_kind', 'confidence', 'ask_claude'],
  properties: {
    headline: { type: 'string', description: 'One line: what is wrong, in plain words.' },
    cause: { type: 'string', description: 'The root cause, citing the evidence.' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'Short quotes from the evidence files or file:line references.' },
    fix_steps: { type: 'array', items: { type: 'string' }, description: 'Numbered, hands-on steps a founder can follow.' },
    fix_kind: { type: 'string', enum: ['operator', 'code', 'unknown'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    ask_claude: { type: 'string', description: 'One sentence the founder can paste into Claude Code to have the fix made.' },
  },
} as const;

/**
 * Claude's structured answer out of claude-code-action's execution file —
 * read by PATH so the answer never passes through a workflow expression,
 * which the public log would print. The file is the session's message list
 * (a JSON array, or one JSON object per line); the answer is on the final
 * `result` message as `structured_output`, or as JSON text in `result`.
 * Returns the answer as a JSON string, or null.
 */
export function extractStructuredOutput(executionFile: string): string | null {
  let messages: unknown[] = [];
  try {
    const whole = JSON.parse(executionFile) as unknown;
    messages = Array.isArray(whole) ? whole : [whole];
  } catch {
    for (const line of executionFile.split('\n')) {
      try {
        messages.push(JSON.parse(line));
      } catch {
        // not a JSON line
      }
    }
  }
  for (const m of [...messages].reverse()) {
    if (typeof m !== 'object' || m === null) continue;
    const msg = m as { type?: unknown; structured_output?: unknown; result?: unknown };
    if (msg.structured_output !== undefined && msg.structured_output !== null) {
      return typeof msg.structured_output === 'string' ? msg.structured_output : JSON.stringify(msg.structured_output);
    }
    if (msg.type === 'result' && typeof msg.result === 'string') {
      const text = msg.result.trim();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) return text.slice(start, end + 1);
    }
  }
  return null;
}

/** Validate Claude's structured output; null when it is missing or the wrong shape. */
export function parseDiagnosis(raw: string): Diagnosis | null {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = j as Partial<Diagnosis>;
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (
    !str(d.headline) ||
    !str(d.cause) ||
    !strs(d.evidence) ||
    !strs(d.fix_steps) ||
    !['operator', 'code', 'unknown'].includes(String(d.fix_kind)) ||
    !['high', 'medium', 'low'].includes(String(d.confidence)) ||
    !str(d.ask_claude)
  ) {
    return null;
  }
  return d as Diagnosis;
}

/**
 * The diagnosis as a Telegram reply. Everything Claude wrote passes through
 * the same redaction as the evidence did, a second time: what reaches the
 * group must not depend on Claude having left a secret out.
 */
export function renderDiagnosis(d: Diagnosis): string {
  const clean = (s: string): string => escapeHtml(redact(s).text);
  const kind = { operator: 'you can fix this without code', code: 'needs a code change', unknown: 'fix unclear' }[d.fix_kind];
  const head = `🔎 <b>Claude's diagnosis</b> (${escapeHtml(d.confidence)} confidence; ${kind})`;
  const blocks = [
    `<b>${clean(d.headline)}</b>\n${clean(d.cause)}`,
    d.evidence.length > 0 ? `<i>Evidence</i>\n${d.evidence.slice(0, 6).map((e) => `• ${clean(e)}`).join('\n')}` : '',
    d.fix_steps.length > 0
      ? `<i>What to do</i>\n${d.fix_steps.slice(0, 10).map((s, i) => `${i + 1}. ${clean(s)}`).join('\n')}`
      : '',
    `<i>To have Claude make the fix, paste this into Claude Code:</i>\n<code>${clean(d.ask_claude)}</code>`,
  ].filter((b) => b.length > 0);
  return fitBlocks(head, blocks, '');
}

export function renderDiagnosisUnavailable(reason: string, runUrl: string | null): string {
  const where = runUrl ? ` Run: ${escapeHtml(runUrl)}` : '';
  return `🔎 <b>Claude's diagnosis is unavailable</b>: ${escapeHtml(reason)}.${where}\nThe likely cause above still stands.`;
}
