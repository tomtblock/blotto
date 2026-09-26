import { describe, expect, it } from 'vitest';
import {
  entryServiceNotifyVersion,
  looksLikeEmail,
  notifyPoolMessage,
  submitPoolNotify,
} from './pool-notify';

const WALLET = '7fpaNh8mWq3f3wS4cVhD8j9nP5mZq2rT1uV6wX7yYPve';
const POOL = 'EgbFPxSRgtc8hd68vbxjsQ8irYAifen7Zxf5uYNkrngq';

function responder(status: number, json: unknown = null) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => json,
    } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const signer = { signMessage: async (m: Uint8Array) => new Uint8Array(64).fill(m.length % 251) };

describe('the one-message opt-in (notify v2)', () => {
  it('signs the canonical message and posts the four fields', async () => {
    const { fetchImpl, calls } = responder(204);
    const out = await submitPoolNotify('https://svc', signer, WALLET, POOL, ' Player@Example.com ', fetchImpl, () => 1_758_000_000n);
    expect(out).toBe('ok');
    expect(calls[0]?.url).toBe('https://svc/notify/pool');
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, string>;
    expect(body.wallet).toBe(WALLET);
    expect(body.pool).toBe(POOL);
    expect(body.email).toBe('Player@Example.com');
    expect(body.atUnix).toBe('1758000000');
    expect(Buffer.from(body.signature, 'base64')).toHaveLength(64);
  });

  it('the message bytes are the versioned four lines', () => {
    const text = new TextDecoder().decode(notifyPoolMessage(WALLET, POOL, 'a@b.co', 5n));
    expect(text).toBe(`blotto-cup notify v2\nwallet: ${WALLET}\npool: ${POOL}\nemail: a@b.co\nat: 5`);
  });

  it('refuses a typo before any wallet prompt', async () => {
    let prompted = false;
    const s = { signMessage: async () => { prompted = true; return new Uint8Array(64); } };
    const { fetchImpl, calls } = responder(204);
    expect(await submitPoolNotify('https://svc', s, WALLET, POOL, 'not an address', fetchImpl)).toBe('refused');
    expect(prompted).toBe(false);
    expect(calls).toHaveLength(0);
    expect(looksLikeEmail('a@b.co')).toBe(true);
    expect(looksLikeEmail('a@b')).toBe(false);
  });

  it('is unsigned without a message-signing wallet, and when the prompt is declined', async () => {
    const { fetchImpl } = responder(204);
    expect(await submitPoolNotify('https://svc', {}, WALLET, POOL, 'a@b.co', fetchImpl)).toBe('unsigned');
    const declined = { signMessage: async () => { throw new Error('user rejected'); } };
    expect(await submitPoolNotify('https://svc', declined, WALLET, POOL, 'a@b.co', fetchImpl)).toBe('unsigned');
    expect(await submitPoolNotify(undefined, signer, WALLET, POOL, 'a@b.co', fetchImpl)).toBe('unsigned');
  });

  it('maps the service answers: 403 refused, 5xx or a dead socket unavailable', async () => {
    expect(await submitPoolNotify('https://svc', signer, WALLET, POOL, 'a@b.co', responder(403).fetchImpl)).toBe('refused');
    expect(await submitPoolNotify('https://svc', signer, WALLET, POOL, 'a@b.co', responder(503).fetchImpl)).toBe('unavailable');
    const dead = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await submitPoolNotify('https://svc', signer, WALLET, POOL, 'a@b.co', dead)).toBe('unavailable');
  });

  it('reads the notify version off /health and nothing else', async () => {
    expect(await entryServiceNotifyVersion('https://svc', responder(200, { ok: true, notify: 'v2' }).fetchImpl)).toBe('v2');
    expect(await entryServiceNotifyVersion('https://svc', responder(200, { ok: true }).fetchImpl)).toBe(null);
    expect(await entryServiceNotifyVersion('https://svc', responder(500).fetchImpl)).toBe(null);
    expect(await entryServiceNotifyVersion(undefined, responder(200, { notify: 'v2' }).fetchImpl)).toBe(null);
  });
});
