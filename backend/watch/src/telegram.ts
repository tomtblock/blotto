/*
 * The one outbound channel: Telegram's Bot API `sendMessage`.
 *
 * A lost alert is the failure this whole service exists to prevent, so the
 * sender works around every refusal Telegram documents rather than giving up:
 *
 *   - 429: wait `retry_after`, then try again;
 *   - 400 "can't parse entities": send the same words as plain text;
 *   - `migrate_to_chat_id` (the group became a supergroup): send to the new
 *     id, and say once that TELEGRAM_CHAT_ID is stale;
 *   - anything else: record when delivery started failing, so the watcher's
 *     own /health turns 503 and backend-watch notices.
 *
 * The bot token is part of the request URL and appears in no log line.
 */

import type { Fetch } from './solana';

export interface SendOptions {
  /** Thread under this message (Telegram `reply_parameters`). */
  replyTo?: number | null;
  /** Deliver without sound or vibration. */
  silent?: boolean;
}

export interface Notifier {
  /** Returns the sent message's id, or null if nothing was delivered. */
  send(html: string, opts?: SendOptions): Promise<number | null>;
  /** When delivery started failing, or null while it works. */
  failingSinceMs(): number | null;
}

interface TelegramAnswer {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/** HTML → the same words as plain text, for when Telegram cannot parse the markup. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export class TelegramNotifier implements Notifier {
  private failingSince: number | null = null;

  constructor(
    private readonly token: string,
    private chatId: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly log: (line: string) => void = (l) => console.error(l),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = Date.now
  ) {}

  failingSinceMs(): number | null {
    return this.failingSince;
  }

  async send(html: string, opts: SendOptions = {}): Promise<number | null> {
    let text = html;
    let parseMode: 'HTML' | null = 'HTML';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const body: Record<string, unknown> = {
        chat_id: this.chatId,
        text,
        link_preview_options: { is_disabled: true },
        disable_notification: opts.silent === true,
      };
      if (parseMode) body.parse_mode = parseMode;
      if (opts.replyTo) body.reply_parameters = { message_id: opts.replyTo, allow_sending_without_reply: true };

      let status = 0;
      let answer: TelegramAnswer;
      try {
        const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        status = res.status;
        answer = (await res.json()) as TelegramAnswer;
      } catch (e) {
        this.log(`telegram: send failed: ${(e as Error).message}`);
        await this.sleep(2_000);
        continue;
      }
      if (answer.ok && answer.result) {
        this.failingSince = null;
        return answer.result.message_id;
      }
      const why = answer.description ?? 'no description';
      this.log(`telegram: send refused (HTTP ${status}): ${why}`);
      const migrated = answer.parameters?.migrate_to_chat_id;
      if (migrated !== undefined) {
        this.chatId = String(migrated);
        this.log(`telegram: the group moved to chat id ${migrated} — update the TELEGRAM_CHAT_ID secrets (Fly and GitHub)`);
        text = `${text}\n\n(Setup: this group's chat id changed to ${migrated}; update TELEGRAM_CHAT_ID in GitHub and run deploy-watch.)`;
        continue;
      }
      if (status === 429) {
        await this.sleep(Math.min((answer.parameters?.retry_after ?? 5) * 1000, 60_000));
        continue;
      }
      if (status === 400 && /parse entities/i.test(why) && parseMode !== null) {
        text = htmlToPlain(text);
        parseMode = null;
        continue;
      }
      break; // 401 (token), 403 (bot removed from the group), other 400s: retrying changes nothing
    }
    if (this.failingSince === null) this.failingSince = this.now();
    return null;
  }
}

/** Dry run (WATCH_DRY_RUN=1): print what would have been sent. */
export class StdoutNotifier implements Notifier {
  private next = 1;
  failingSinceMs(): number | null {
    return null;
  }
  async send(html: string, opts: SendOptions = {}): Promise<number | null> {
    const id = this.next++;
    const tag = `${opts.replyTo ? ` reply-to=${opts.replyTo}` : ''}${opts.silent ? ' silent' : ''}`;
    console.log(`--- telegram (dry run) #${id}${tag}\n${htmlToPlain(html)}\n---`);
    return id;
  }
}
