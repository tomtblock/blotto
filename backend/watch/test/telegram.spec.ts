import { expect } from 'chai';
import { htmlToPlain, TelegramNotifier } from '../src/telegram';
import { fakeFetch } from './fixtures';

// Built at runtime so no token-shaped literal sits in the repository.
const TOKEN = ['000000', 'x'.repeat(30)].join(':');
const noSleep = async (): Promise<void> => undefined;
const quiet = (): void => undefined;

describe('the Telegram sender', () => {
  it('sends HTML, threaded and silent when asked, with link previews off', async () => {
    const { fetchImpl, calls } = fakeFetch([[200, { ok: true, result: { message_id: 42 } }]]);
    const n = new TelegramNotifier(TOKEN, '-100123', fetchImpl, quiet, noSleep);
    expect(await n.send('<b>hi</b>', { replyTo: 7, silent: true })).to.equal(42);
    const body = calls[0].body as Record<string, unknown>;
    expect(body).to.deep.include({ chat_id: '-100123', text: '<b>hi</b>', parse_mode: 'HTML', disable_notification: true });
    expect(body.reply_parameters).to.deep.equal({ message_id: 7, allow_sending_without_reply: true });
    expect(body.link_preview_options).to.deep.equal({ is_disabled: true });
  });

  it('waits out a 429 and tries again', async () => {
    const { fetchImpl } = fakeFetch([
      [429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 3 } }],
      [200, { ok: true, result: { message_id: 9 } }],
    ]);
    const waited: number[] = [];
    const n = new TelegramNotifier(TOKEN, '1', fetchImpl, quiet, async (ms) => void waited.push(ms));
    expect(await n.send('x')).to.equal(9);
    expect(waited).to.deep.equal([3000]);
  });

  it('falls back to plain text when Telegram cannot parse the markup', async () => {
    const { fetchImpl, calls } = fakeFetch([
      [400, { ok: false, description: "Bad Request: can't parse entities" }],
      [200, { ok: true, result: { message_id: 3 } }],
    ]);
    const n = new TelegramNotifier(TOKEN, '1', fetchImpl, quiet, noSleep);
    expect(await n.send('<b>a &amp; b</b>')).to.equal(3);
    expect(calls[1].body).to.deep.include({ text: 'a & b' });
    expect((calls[1].body as Record<string, unknown>).parse_mode).to.equal(undefined);
  });

  it('follows a group that became a supergroup, and says the chat id is stale', async () => {
    const { fetchImpl, calls } = fakeFetch([
      [400, { ok: false, description: 'group chat was upgraded', parameters: { migrate_to_chat_id: -1009 } }],
      [200, { ok: true, result: { message_id: 4 } }],
    ]);
    const n = new TelegramNotifier(TOKEN, '-1', fetchImpl, quiet, noSleep);
    expect(await n.send('x')).to.equal(4);
    expect(calls[1].body).to.deep.include({ chat_id: '-1009' });
    expect(String((calls[1].body as { text: string }).text)).to.contain('update TELEGRAM_CHAT_ID');
  });

  it('records when delivery started failing (bot removed), and clears it on the next success', async () => {
    const { fetchImpl } = fakeFetch([
      [403, { ok: false, description: 'Forbidden: bot was kicked from the group chat' }],
      [200, { ok: true, result: { message_id: 1 } }],
    ]);
    const n = new TelegramNotifier(TOKEN, '1', fetchImpl, quiet, noSleep, () => 1234);
    expect(await n.send('x')).to.equal(null);
    expect(n.failingSinceMs()).to.equal(1234);
    await n.send('y');
    expect(n.failingSinceMs()).to.equal(null);
  });

  it('never writes the token into a log line', async () => {
    const { fetchImpl } = fakeFetch([[401, { ok: false, description: 'Unauthorized' }]]);
    const lines: string[] = [];
    await new TelegramNotifier(TOKEN, '1', fetchImpl, (l) => lines.push(l), noSleep).send('x');
    expect(lines.join('\n')).not.to.contain(TOKEN);
  });

  it('turns HTML into the same words as plain text', () => {
    expect(htmlToPlain('<b>x</b> &lt;y&gt; &amp;')).to.equal('x <y> &');
  });
});
