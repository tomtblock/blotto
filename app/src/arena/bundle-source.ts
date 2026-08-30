/*
 * The bundle seam — the arena's ONLY entry point for unsealed data.
 *
 * Nothing serves the published reveal bundle to the app yet (the crank logs
 * its URI and drops it; the verify page takes a paste). This seam keeps the
 * arena honest about that: an HTTP implementation for when a transport
 * exists (`NEXT_PUBLIC_REVEAL_BUNDLE_URL`, `<base>/<pool>.json` — or a
 * future indexer `GET /pools/:pool/bundle`), and the fixture fallback so
 * the whole surface renders today. Pre-reveal there is NO bundle by
 * construction — this seam returning null IS the sealing guarantee's data
 * reality, and the phase resolver treats null as the honest sealing wait.
 */

import type { PublishedBundle } from '@/verify/logic';
import { FIXTURE_ARENA_POOL, fixtureBundle } from './fixtures';

export interface ArenaBundleSource {
  /** The published bundle, or null while unpublished. */
  getBundle(pool: string): Promise<PublishedBundle | null>;
}

class HttpBundleSource implements ArenaBundleSource {
  constructor(private readonly base: string) {}
  async getBundle(pool: string): Promise<PublishedBundle | null> {
    const res = await fetch(`${this.base}/${pool}.json`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`reveal bundle fetch: ${res.status}`);
    return (await res.json()) as PublishedBundle;
  }
}

const FIXTURE_SOURCE: ArenaBundleSource = {
  async getBundle(pool) {
    return pool === FIXTURE_ARENA_POOL ? fixtureBundle() : null;
  },
};

export function bundleSource(): ArenaBundleSource {
  const base = process.env.NEXT_PUBLIC_REVEAL_BUNDLE_URL;
  return base ? new HttpBundleSource(base) : FIXTURE_SOURCE;
}
