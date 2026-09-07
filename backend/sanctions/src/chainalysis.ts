/**
 * Chainalysis Sanctions Screening API adapter — the primary.
 *
 * What is VERIFIED against the live service (2026-09-07, from this
 * repository's build environment, without a key):
 *
 *   GET https://public.chainalysis.com/api/v1/address/<address>   — PATH form
 *   X-API-Key: <key>
 *   no key      → HTTP 403 (an HTML challenge page, not JSON)
 *   invalid key → HTTP 401  {"message":"Invalid API Key"}
 *
 * What is NOT yet verified, because it needs a real key: the 200 body. This
 * adapter reads the shape Chainalysis documents for the free sanctions API —
 * `{ "identifications": [ { "category", "name", "description", "url" } ] }`,
 * with an EMPTY `identifications` array for a clean address — and it is
 * written to fail closed against that assumption: a 200 body WITHOUT an
 * `identifications` array throws rather than reading as clean.
 * **Capture one real 200 response with the first issued key and pin it as
 * the fixture in `test/chainalysis.spec.ts` before this goes live**, the way
 * `geo-iplocate.spec.ts` pins a verbatim IPLocate response. Until then the
 * fixture in that spec is the documented shape, labelled as such.
 *
 * The API answers list membership only — it carries no score, which is the
 * property this package exists to preserve.
 */

import type { SanctionsCheck, SanctionsMatch, SanctionsVerdict } from './seam';
import { withRetry, type RetryOptions } from './http';

export interface ChainalysisOptions extends RetryOptions {
  /** Default https://public.chainalysis.com/api/v1/address */
  baseUrl?: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface Identification {
  category?: unknown;
  name?: unknown;
  description?: unknown;
  url?: unknown;
}

export class ChainalysisCheck implements SanctionsCheck {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly o: ChainalysisOptions) {
    if (!o.apiKey) throw new Error('ChainalysisCheck: apiKey is required');
    this.baseUrl = (o.baseUrl ?? 'https://public.chainalysis.com/api/v1/address').replace(
      /\/+$/,
      ''
    );
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.now = o.now ?? (() => new Date());
  }

  async screen(address: string): Promise<SanctionsVerdict> {
    const raw = await withRetry('chainalysis', this.o, (signal) =>
      this.fetchImpl(`${this.baseUrl}/${encodeURIComponent(address)}`, {
        headers: { 'X-API-Key': this.o.apiKey, accept: 'application/json' },
        signal,
      })
    );
    const ids = (raw as { identifications?: unknown } | null)?.identifications;
    if (!Array.isArray(ids)) {
      throw new Error('chainalysis: no identifications array in the answer');
    }
    const matches: SanctionsMatch[] = (ids as Identification[]).map((i) => ({
      source: 'chainalysis',
      listName: typeof i.category === 'string' ? i.category : 'sanctions',
      entityName: typeof i.name === 'string' ? i.name : '(unnamed)',
      entityId: typeof i.url === 'string' ? i.url : undefined,
      addressMatched: address,
    }));
    return {
      address,
      listed: matches.length > 0,
      matches,
      consulted: ['chainalysis'],
      failed: [],
      checkedAt: this.now().toISOString(),
    };
  }
}
