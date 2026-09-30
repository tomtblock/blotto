import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

/* The gate on a gated host, with a secret set so admission is possible. The
 * proxy reads the environment at call time. */
const ENV = { GATE_HOSTS: 'www.blotto.gg', GATE_COOKIE_SECRET: 'test-secret' };

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`https://www.blotto.gg${path}`, {
    headers: { host: 'www.blotto.gg', ...(cookie ? { cookie: `blotto_gate=${cookie}` } : {}) },
  });
}

describe('the gate proxy and /.well-known/ (2026-09-30)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterEach(() => {
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('still sends an unadmitted visitor on a gated host to /gate', () => {
    const res = proxy(request('/play'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/gate');
  });

  it('lets /.well-known/ through without a cookie — the wallet verifier follows no redirect', () => {
    const res = proxy(request('/.well-known/assetlinks.json'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('and an admitted visitor is untouched, as before', () => {
    const res = proxy(request('/play', 'test-secret'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
