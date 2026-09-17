/**
 * The mail seam (round four, 2026-09-17). The dispatcher in notify-pool.ts
 * hands a finished message here; what carries it is a deployment decision
 * the founder owns — a provider account and a sending domain are not this
 * repository's to make — so the production adapter is a SEAM like the geo
 * vendor's: one HTTP adapter shaped for a Resend-style JSON API, configured
 * from the environment, and a log-only adapter for the offline suites.
 *
 * NOTHING HERE LOGS AN ADDRESS. `maskAddress` is what any log line gets.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  /** Resolves when the provider has accepted the message; throws otherwise. */
  send(message: EmailMessage): Promise<void>;
  /** One line for the boot log and /health. */
  readonly describe: string;
}

/** `t***@example.com` — enough to recognise, never enough to write to. */
export function maskAddress(address: string): string {
  const at = address.indexOf('@');
  if (at <= 0) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

/**
 * A JSON POST with a bearer key — the shape Resend speaks
 * (`POST https://api.resend.com/emails`, `{ from, to, subject, text }`).
 * Another provider with a different shape is a change to `send` alone.
 */
export class HttpEmailSender implements EmailSender {
  readonly describe: string;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.describe = `http provider at ${new URL(url).host}, from ${from}`;
  }

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!res.ok) throw new Error(`email provider answered ${res.status}`);
  }
}

/** The offline sender: records what would have gone, for the suites. */
export class MemoryEmailSender implements EmailSender {
  readonly describe = 'memory (offline)';
  readonly sent: EmailMessage[] = [];
  /** Set to make every send fail — the retry path. */
  failing = false;

  async send(message: EmailMessage): Promise<void> {
    if (this.failing) throw new Error('email provider answered 503');
    this.sent.push(message);
  }
}
