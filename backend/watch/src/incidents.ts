/*
 * When a failing check becomes a message, and when it stops being one.
 *
 * The rules, in the order they matter to the people reading the group:
 *
 *   1. Nothing is said while everything passes. No heartbeat, no "all green".
 *   2. A check must fail `failuresToOpen` times IN A ROW before anyone hears
 *      about it, so one slow probe is not a message.
 *   3. Everything that opens in the same round goes out as ONE message.
 *   4. A failure caused by another open one (the RPC provider is down, so the
 *      daemon cannot tick) is a reply in that incident's thread, not a new
 *      thread. The reply is silent unless players are affected (critical).
 *   5. While an incident stays open, one reminder every `reminderMs` (a red
 *      CI lane, which stays red until its next run, every `laneReminderMs`).
 *   6. A clear is a SILENT reply in the incident's thread — nobody's phone
 *      buzzes, but anyone scrolling can see it is over (owner's call, R23).
 *   7. A key that fails again within `flapWindowMs` of clearing goes back
 *      into its old thread, silently, instead of opening a new one.
 *
 * State is in memory. A watcher restart forgets what was open, so an ongoing
 * failure is announced again once — marked as such — and that is the price
 * of holding no database credential here.
 */

import type { CheckResult, Severity } from './checks';

export interface Incident {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
  facts: Record<string, string>;
  openedAtMs: number;
  /** The Telegram message this incident's thread hangs off (null until sent). */
  messageId: number | null;
  lastNotifiedAtMs: number;
  /** Open parent whose thread this incident was posted into, if any. */
  parentKey: string | null;
  /** True when opened within the watcher's first minutes: it may predate the watcher. */
  sinceRestart: boolean;
}

interface Track {
  fails: number;
  passes: number;
  incident: Incident | null;
  /** The thread of the last closed incident for this key, for "failing again". */
  lastMessageId: number | null;
  lastClosedAtMs: number | null;
}

/**
 * Which open incident explains which others. A child that opens while its
 * parent is open goes into the parent's thread. Matching is by key prefix.
 */
export const DEPENDENCIES: [parent: string, children: string[]][] = [
  ['rpc:primary', ['service:blotto-daemon', 'daemon:', 'indexer:', 'pools:', 'treasury:', 'alerts:']],
  ['service:blotto-daemon', ['daemon:', 'pools:', 'alerts:blotto-daemon:', 'watch:metrics:blotto-daemon', 'github:backend-watch']],
  [
    'service:blotto-indexer',
    [
      'indexer:',
      'treasury:',
      'service:blotto-indexer-ingest',
      'alerts:blotto-indexer:',
      'watch:metrics:blotto-indexer',
      'github:backend-watch',
    ],
  ],
  ['service:blotto-packet', ['alerts:blotto-packet:', 'watch:metrics:blotto-packet', 'github:backend-watch']],
  ['service:blotto-review', ['alerts:blotto-review:', 'watch:metrics:blotto-review', 'github:backend-watch']],
  ['daemon:tick-stale', ['daemon:tick-errors', 'pools:', 'service:blotto-daemon']],
  ['daemon:tick-errors', ['pools:']],
  ['site:alias', ['site:deploy-lag', 'site:domain']],
  ['watch:chain-rpc', ['pools:', 'indexer:behind']],
  ['watch:github', ['github:', 'site:deploy-lag', 'watch:github-token-expiry']],
];

export interface Plan {
  /** New incidents with no open parent: one message, one thread. */
  opened: Incident[];
  /** New incidents explained by an open parent: replies in that thread. */
  threaded: { parent: Incident; incident: Incident; silent: boolean }[];
  /** Keys failing again soon after clearing: silent replies in their old thread. */
  again: { incident: Incident; threadId: number }[];
  /** Incidents that cleared this round (silent replies). */
  cleared: { incident: Incident; minutesOpen: number }[];
  /** Open incidents due a reminder this round (grouped by thread when sent). */
  reminders: Incident[];
}

export interface BookOptions {
  passesToClear: number;
  reminderMs: number;
  /** Reminder interval for `github:` lanes. */
  laneReminderMs: number;
  /** A re-open within this long after a clear rejoins the old thread. */
  flapWindowMs: number;
  /** When the watcher started; incidents opened soon after are marked. */
  startedAtMs: number;
  /** How long after start an opening counts as "may predate the watcher". */
  restartWindowMs?: number;
}

export class IncidentBook {
  private readonly tracks = new Map<string, Track>();

  constructor(private readonly opts: BookOptions) {}

  /** Feed one round of verdicts; get back what to say. Pure apart from its own state. */
  observe(results: CheckResult[], nowMs: number): Plan {
    const plan: Plan = { opened: [], threaded: [], again: [], cleared: [], reminders: [] };
    const newlyOpen: Incident[] = [];

    for (const r of results) {
      const tr = this.track(r.key);
      if (r.status === 'unknown') continue;
      if (r.status === 'fail') {
        tr.fails += 1;
        tr.passes = 0;
        if (tr.incident) {
          tr.incident.detail = r.detail;
          tr.incident.facts = r.facts ?? tr.incident.facts;
        } else if (tr.fails >= r.failuresToOpen) {
          tr.incident = {
            key: r.key,
            title: r.title,
            detail: r.detail,
            severity: r.severity,
            facts: r.facts ?? {},
            openedAtMs: nowMs,
            messageId: null,
            lastNotifiedAtMs: nowMs,
            parentKey: null,
            sinceRestart: nowMs - this.opts.startedAtMs < (this.opts.restartWindowMs ?? 10 * 60_000),
          };
          newlyOpen.push(tr.incident);
        }
      } else {
        tr.passes += 1;
        tr.fails = 0;
        const need = r.passesToClear ?? this.opts.passesToClear;
        if (tr.incident && tr.passes >= need) {
          plan.cleared.push({
            incident: tr.incident,
            minutesOpen: Math.max(1, Math.round((nowMs - tr.incident.openedAtMs) / 60_000)),
          });
          tr.lastMessageId = tr.incident.messageId;
          tr.lastClosedAtMs = nowMs;
          tr.incident = null;
        }
      }
    }

    // Place each new incident: under the thread of a parent that was ALREADY
    // open, or top level. Incidents opening in the same round never thread
    // under one another — they share one message anyway (rule 3), and two
    // that name each other as parent would otherwise both wait on the other.
    const fresh = new Set(newlyOpen.map((i) => i.key));
    for (const inc of newlyOpen) {
      const tr = this.track(inc.key);
      if (
        tr.lastMessageId !== null &&
        tr.lastClosedAtMs !== null &&
        nowMs - tr.lastClosedAtMs < this.opts.flapWindowMs
      ) {
        inc.messageId = tr.lastMessageId;
        plan.again.push({ incident: inc, threadId: tr.lastMessageId });
        continue;
      }
      const parent = this.openParentOf(inc.key, fresh);
      if (parent) {
        inc.parentKey = parent.key;
        plan.threaded.push({ parent, incident: inc, silent: inc.severity !== 'critical' });
      } else {
        plan.opened.push(inc);
      }
    }

    for (const tr of this.tracks.values()) {
      const inc = tr.incident;
      if (!inc || fresh.has(inc.key)) continue;
      // A child whose parent has cleared stands on its own from here on.
      if (inc.parentKey !== null && !this.tracks.get(inc.parentKey)?.incident) inc.parentKey = null;
      if (inc.parentKey !== null) continue;
      const every = inc.key.startsWith('github:') ? this.opts.laneReminderMs : this.opts.reminderMs;
      if (nowMs - inc.lastNotifiedAtMs >= every) {
        inc.lastNotifiedAtMs = nowMs;
        plan.reminders.push(inc);
      }
    }
    return plan;
  }

  /** Record the Telegram message an incident (or a batch of them) went out as. */
  attachMessage(keys: string[], messageId: number): void {
    for (const k of keys) {
      const inc = this.tracks.get(k)?.incident;
      if (inc && inc.messageId === null) inc.messageId = messageId;
    }
  }

  openIncidents(): Incident[] {
    return [...this.tracks.values()].flatMap((t) => (t.incident ? [t.incident] : []));
  }

  private track(key: string): Track {
    let tr = this.tracks.get(key);
    if (!tr) {
      tr = { fails: 0, passes: 0, incident: null, lastMessageId: null, lastClosedAtMs: null };
      this.tracks.set(key, tr);
    }
    return tr;
  }

  /**
   * The first already-open incident whose dependency list covers `key`
   * (never itself, never one opening this round), followed to the root of
   * its thread.
   */
  private openParentOf(key: string, fresh: ReadonlySet<string>): Incident | null {
    for (const [parentKey, children] of DEPENDENCIES) {
      if (parentKey === key || fresh.has(parentKey)) continue;
      if (!children.some((c) => key === c || key.startsWith(c))) continue;
      const parent = this.tracks.get(parentKey)?.incident;
      if (parent) return this.root(parent);
    }
    return null;
  }

  private root(inc: Incident): Incident {
    let cur = inc;
    const seen = new Set<string>();
    while (cur.parentKey !== null && !seen.has(cur.key)) {
      seen.add(cur.key);
      const up = this.tracks.get(cur.parentKey)?.incident;
      if (!up) break;
      cur = up;
    }
    return cur;
  }
}
