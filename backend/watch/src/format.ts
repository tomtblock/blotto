/*
 * What the group reads. Telegram HTML (`parse_mode: "HTML"`): only <b>, <i>
 * and <code>, every dynamic string escaped, every message under Telegram's
 * 4096-character limit. Blocks are dropped whole, never cut mid-tag.
 */

import { explain } from './causes';
import type { Incident } from './incidents';

/** Telegram's hard limit is 4096 characters after entity parsing; stay well under. */
export const MESSAGE_BUDGET = 3800;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Join blocks, dropping trailing ones (with a count) once the budget is reached. */
export function fitBlocks(head: string, blocks: string[], tail: string): string {
  const parts: string[] = [];
  let used = head.length + tail.length + 40;
  let dropped = 0;
  for (const b of blocks) {
    if (dropped > 0 || used + b.length + 2 > MESSAGE_BUDGET) {
      dropped += 1;
      continue;
    }
    parts.push(b);
    used += b.length + 2;
  }
  if (dropped > 0) parts.push(`<i>…and ${dropped} more not shown.</i>`);
  return [head, ...parts, tail].filter((s) => s.length > 0).join('\n\n');
}

function block(inc: Incident): string {
  const { cause, action } = explain(inc);
  const lines = [
    `${inc.severity === 'critical' ? '🔴' : '🟠'} <b>${escapeHtml(inc.title)}</b>`,
    escapeHtml(inc.detail),
    `<i>Likely cause:</i> ${escapeHtml(cause)}`,
    `<i>What to do:</i> ${escapeHtml(action)}`,
  ];
  return lines.join('\n');
}

export interface AlertOptions {
  /** A Claude diagnosis has been requested and will reply in the thread. */
  diagnosing: boolean;
}

/** The first message of a thread: everything that opened this round. */
export function renderAlert(incidents: Incident[], opts: AlertOptions): string {
  const n = incidents.length;
  const head = n === 1 ? '<b>Blotto needs attention</b>' : `<b>Blotto needs attention: ${n} problems</b>`;
  const notes: string[] = [];
  if (incidents.some((i) => i.sinceRestart)) {
    notes.push('<i>The watcher restarted a few minutes ago, so this may have started earlier.</i>');
  }
  if (opts.diagnosing) {
    notes.push('🔎 Claude is diagnosing this now. Its findings will arrive as a reply to this message.');
  }
  notes.push(`<code>${escapeHtml(incidents.map((i) => i.key).join(' · '))}</code>`);
  return fitBlocks(head, incidents.map(block), notes.join('\n'));
}

/** A related failure, posted into the thread of the incident that explains it. */
export function renderThreaded(incident: Incident): string {
  return fitBlocks('<b>Also failing now, probably for the same reason:</b>', [block(incident)], `<code>${escapeHtml(incident.key)}</code>`);
}

/** A key that cleared and failed again, posted into its old thread. */
export function renderAgain(incident: Incident): string {
  return fitBlocks('<b>Failing again:</b>', [block(incident)], `<code>${escapeHtml(incident.key)}</code>`);
}

/** The silent all-clear. */
export function renderCleared(items: { incident: Incident; minutesOpen: number }[]): string {
  const lines = items.map(
    ({ incident, minutesOpen }) => `✅ <b>Cleared:</b> ${escapeHtml(incident.title)} (after ${formatDuration(minutesOpen)})`
  );
  return fitBlocks('', lines, '');
}

export function renderReminder(incidents: Incident[], nowMs: number): string {
  const lines = incidents.map(
    (i) => `• ${escapeHtml(i.title)}: ${escapeHtml(i.detail)} (open ${formatDuration(Math.round((nowMs - i.openedAtMs) / 60_000))})`
  );
  return fitBlocks('⏰ <b>Still failing:</b>', lines, '');
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
