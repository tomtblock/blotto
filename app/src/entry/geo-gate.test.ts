/* Geo pre-flight gate specs (D-B3): every failure mode lands on 'blocked'. */
import { beforeEach, describe, expect, it } from 'vitest';
import { GEO_ALLOWED_MEMO_MS, checkGeoGate, forgetGeoGate } from './geo-gate';

const answering = (status: number, body: unknown): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as never;

/** A fetch that counts how often the service was actually asked. */
const counting = (status: number, body: unknown) => {
  const c = { calls: 0, fetch: (async () => {
    c.calls++;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }) as unknown as typeof fetch };
  return c;
};

beforeEach(() => forgetGeoGate());

describe('checkGeoGate', () => {
  it('allows only on an explicit allowed: true', async () => {
    expect(await checkGeoGate('https://entry.example', answering(200, { allowed: true }))).toBe(
      'allowed'
    );
  });

  it('blocks on allowed: false, non-200, malformed body, network error, and no base URL', async () => {
    expect(await checkGeoGate('https://entry.example', answering(200, { allowed: false }))).toBe(
      'blocked'
    );
    expect(await checkGeoGate('https://entry.example', answering(403, {}))).toBe('blocked');
    expect(await checkGeoGate('https://entry.example', answering(200, {}))).toBe('blocked');
    expect(await checkGeoGate('https://entry.example', answering(200, { allowed: 'yes' }))).toBe(
      'blocked'
    );
    const failing: typeof fetch = (async () => {
      throw new Error('offline');
    }) as never;
    expect(await checkGeoGate('https://entry.example', failing)).toBe('blocked');
    expect(await checkGeoGate(undefined, answering(200, { allowed: true }))).toBe('blocked');
  });
});

/*
 * The tab memo (audit 2026-09-11, B-04): every ask costs the service a paid
 * lookup for an address it has not seen lately, and the page asked on every
 * mount. Only an `allowed` answer is remembered, for a bounded time, and a
 * "Check again" bypasses it.
 */
describe('checkGeoGate — the tab memo', () => {
  it('remembers an allowed answer and does not ask again within the window', async () => {
    let now = 1_000_000;
    const svc = counting(200, { allowed: true });
    const opts = { now: () => now };
    expect(await checkGeoGate('https://entry.example', svc.fetch, opts)).toBe('allowed');
    expect(await checkGeoGate('https://entry.example', svc.fetch, opts)).toBe('allowed');
    expect(await checkGeoGate('https://entry.example', svc.fetch, opts)).toBe('allowed');
    expect(svc.calls).toBe(1);
    now += GEO_ALLOWED_MEMO_MS;
    expect(await checkGeoGate('https://entry.example', svc.fetch, opts)).toBe('allowed');
    expect(svc.calls).toBe(2);
  });

  it('never remembers a refusal — the next mount asks again', async () => {
    const svc = counting(200, { allowed: false });
    expect(await checkGeoGate('https://entry.example', svc.fetch)).toBe('blocked');
    expect(await checkGeoGate('https://entry.example', svc.fetch)).toBe('blocked');
    expect(svc.calls).toBe(2);
  });

  it('a recheck asks the service even with an allowed answer remembered', async () => {
    const svc = counting(200, { allowed: true });
    await checkGeoGate('https://entry.example', svc.fetch);
    expect(await checkGeoGate('https://entry.example', svc.fetch, { recheck: true })).toBe('allowed');
    expect(svc.calls).toBe(2);
  });

  it('the memo is per service base, so a different API is asked afresh', async () => {
    const svc = counting(200, { allowed: true });
    await checkGeoGate('https://entry.example', svc.fetch);
    expect(await checkGeoGate('https://other.example', svc.fetch)).toBe('allowed');
    expect(svc.calls).toBe(2);
  });
});
