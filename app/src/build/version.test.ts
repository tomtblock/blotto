import { describe, expect, it } from 'vitest';
import { checkBuildVersion, versionVerdict, VERSION_ROUTE } from './version';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('versionVerdict', () => {
  it('is same only for the identical, non-empty string', () => {
    expect(versionVerdict('abc123', { version: 'abc123' })).toBe('same');
    expect(versionVerdict('abc123', { version: 'def456' })).toBe('stale');
    expect(versionVerdict('unversioned', { version: 'unversioned' })).toBe('same');
  });

  it('treats a malformed answer as unknown, never as stale', () => {
    // An answer the route did not write must not refuse an entry.
    expect(versionVerdict('abc123', null)).toBe('unknown');
    expect(versionVerdict('abc123', 'abc123')).toBe('unknown');
    expect(versionVerdict('abc123', {})).toBe('unknown');
    expect(versionVerdict('abc123', { version: '' })).toBe('unknown');
    expect(versionVerdict('abc123', { version: 42 })).toBe('unknown');
    // Own property only: the same discipline as knownCiphertextReason.
    expect(versionVerdict('abc123', Object.create({ version: 'abc123' }))).toBe('unknown');
  });
});

describe('checkBuildVersion', () => {
  it('asks the version route with no caching and reports same', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const verdict = await checkBuildVersion({
      current: 'abc123',
      fetch: async (url, init) => {
        seen = { url, init };
        return json({ version: 'abc123' });
      },
    });
    expect(verdict).toBe('same');
    expect(seen!.url).toBe(VERSION_ROUTE);
    expect(seen!.init.cache).toBe('no-store');
  });

  it('reports stale when the server is on a different build', async () => {
    expect(
      await checkBuildVersion({ current: 'abc123', fetch: async () => json({ version: 'def456' }) })
    ).toBe('stale');
  });

  it('is unknown — and never throws — on a non-2xx, a throw, or a timeout', async () => {
    expect(await checkBuildVersion({ current: 'a', fetch: async () => json({ version: 'a' }, 503) })).toBe(
      'unknown'
    );
    expect(
      await checkBuildVersion({
        current: 'a',
        fetch: async () => {
          throw new Error('offline');
        },
      })
    ).toBe('unknown');
    expect(
      await checkBuildVersion({
        current: 'a',
        timeoutMs: 10,
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      })
    ).toBe('unknown');
  });
});
