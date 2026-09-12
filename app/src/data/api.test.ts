/*
 * Which read API a build gets, and what a missing indexer does (audit
 * 2026-09-11, A-07 / C-26 / D-15 / E-01).
 *
 * The finding: a production deploy with NEXT_PUBLIC_INDEXER_URL unset or
 * empty served the in-repo fixture tournaments through the ordinary pages —
 * an Enter button on a tournament that does not exist, and a pool id that is
 * not a number, which then threw inside `BigInt(pool.id)` after the player
 * had spent ninety seconds allocating. These tests pin the branch that makes
 * that impossible while keeping the fixtures for development and tests.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { INDEXER_UNCONFIGURED_MESSAGE, indexerApi, live } from './api';
import { FIXTURE_API } from './fixture';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('indexerApi', () => {
  it('serves the fixtures in development and in tests — design work needs them', () => {
    vi.stubEnv('NEXT_PUBLIC_INDEXER_URL', '');
    vi.stubEnv('NEXT_PUBLIC_FIXTURE_DATA', '0');
    for (const mode of ['development', 'test'] as const) {
      vi.stubEnv('NODE_ENV', mode);
      expect(indexerApi(), mode).toBe(FIXTURE_API);
    }
  });

  it('serves them in a production build ONLY when that build asked for them', () => {
    // The visual journey suite screenshots a real production build with no
    // backend at all — a legitimate need, and the reason the fallback
    // existed. The finding was that it happened BY OMISSION; this is the
    // deliberate form, and the cluster gate refuses it on mainnet.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_INDEXER_URL', '');
    vi.stubEnv('NEXT_PUBLIC_FIXTURE_DATA', '1');
    expect(indexerApi()).toBe(FIXTURE_API);
    // Anything but exactly "1" leaves it off — no truthy-string surprises.
    for (const off of ['0', 'true', 'yes', '']) {
      vi.stubEnv('NEXT_PUBLIC_FIXTURE_DATA', off);
      expect(indexerApi(), off).not.toBe(FIXTURE_API);
    }
  });

  it('serves NO fixtures in a production build — every read fails instead', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_FIXTURE_DATA', '0');
    for (const unset of ['', '   ', undefined]) {
      vi.stubEnv('NEXT_PUBLIC_INDEXER_URL', unset);
      const api = indexerApi();
      expect(api, String(unset)).not.toBe(FIXTURE_API);
      // Every read, not merely the one a page happens to call first.
      await expect(api.listPools()).rejects.toThrow(/not configured/);
      await expect(api.getPool('anything')).rejects.toThrow(/not configured/);
      await expect(api.getEntries('anything')).rejects.toThrow(/not configured/);
      await expect(api.getResults('anything')).rejects.toThrow(/not configured/);
      await expect(api.getProfile('anyone')).rejects.toThrow(/not configured/);
      await expect(api.getTreasury()).rejects.toThrow(/not configured/);
      await expect(api.getLeaderboard('anything')).rejects.toThrow(/not configured/);
    }
  });

  it('names the variable to set, so an operator reading a log knows the fix', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_FIXTURE_DATA', '0');
    vi.stubEnv('NEXT_PUBLIC_INDEXER_URL', '');
    await expect(indexerApi().listPools()).rejects.toThrow('NEXT_PUBLIC_INDEXER_URL');
    expect(INDEXER_UNCONFIGURED_MESSAGE).toContain('NEXT_PUBLIC_INDEXER_URL');
  });

  it('degrades through the existing outage guard rather than crashing a page', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_FIXTURE_DATA', '0');
    vi.stubEnv('NEXT_PUBLIC_INDEXER_URL', '');
    // `live()` is what every server-rendered page reads through; an
    // unconfigured build must land in the SAME honest "unavailable" state as
    // an unreachable indexer — never in "no tournament is open".
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await live(() => indexerApi().listPools())).toEqual({ ok: false });
    error.mockRestore();
  });

  it('uses the HTTP client whenever a base URL is configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_INDEXER_URL', 'https://indexer.example');
    expect(indexerApi()).not.toBe(FIXTURE_API);
    // A configured build is not the throwing stand-in: reads reach the network.
    expect(typeof indexerApi().listPools).toBe('function');
  });
});
