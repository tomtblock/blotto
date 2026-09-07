/**
 * OpenSanctions adapter — the cross-check.
 *
 * Contract verified against the live OpenAPI document
 * (https://api.opensanctions.org/openapi.json) on 2026-09-07, not from
 * memory:
 *
 *   POST https://api.opensanctions.org/match/{dataset}
 *   Authorization: ApiKey <key>
 *   body     { "queries": { "<id>": { "schema": "CryptoWallet",
 *                                     "properties": { "publicKey": ["<addr>"] } } } }
 *   response { "responses": { "<id>": { "results": [ { "id", "caption",
 *              "schema", "datasets": [...], "match": bool, "score": number,
 *              ... } ], "total", "query" } }, "limit" }
 *
 * `CryptoWallet.publicKey` is the FollowTheMoney property that holds a
 * wallet address (schema explorer, same day). `score` is present on every
 * result and is DROPPED here — a listing counts only when the API's own
 * `match` boolean is true, which is its statement that the address is the
 * one on the list. The matching algorithm's confidence is not something a
 * payment may turn on.
 *
 * Failure taxonomy as `geo-iplocate.ts` (see `http.ts`). A body without the
 * expected `responses.<id>.results` array throws rather than reading as
 * "clean".
 */

import type { SanctionsCheck, SanctionsMatch, SanctionsVerdict } from './seam';
import { withRetry, type RetryOptions } from './http';

export interface OpenSanctionsOptions extends RetryOptions {
  /** Default https://api.opensanctions.org */
  baseUrl?: string;
  apiKey: string;
  /** Default "default" — the whole OpenSanctions collection. */
  dataset?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface MatchResult {
  id?: unknown;
  caption?: unknown;
  datasets?: unknown;
  match?: unknown;
}

const QUERY_ID = 'w';

export class OpenSanctionsCheck implements SanctionsCheck {
  private readonly baseUrl: string;
  private readonly dataset: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly o: OpenSanctionsOptions) {
    if (!o.apiKey) throw new Error('OpenSanctionsCheck: apiKey is required');
    this.baseUrl = (o.baseUrl ?? 'https://api.opensanctions.org').replace(/\/+$/, '');
    this.dataset = o.dataset ?? 'default';
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.now = o.now ?? (() => new Date());
  }

  async screen(address: string): Promise<SanctionsVerdict> {
    const body = JSON.stringify({
      queries: { [QUERY_ID]: { schema: 'CryptoWallet', properties: { publicKey: [address] } } },
    });
    const raw = await withRetry('opensanctions', this.o, (signal) =>
      this.fetchImpl(`${this.baseUrl}/match/${encodeURIComponent(this.dataset)}`, {
        method: 'POST',
        headers: { authorization: `ApiKey ${this.o.apiKey}`, 'content-type': 'application/json' },
        body,
        signal,
      })
    );
    const results = this.resultsOf(raw);
    const matches: SanctionsMatch[] = results
      .filter((r) => r.match === true)
      .map((r) => ({
        source: 'opensanctions',
        listName: Array.isArray(r.datasets) ? r.datasets.map(String).join(',') : 'opensanctions',
        entityName: typeof r.caption === 'string' ? r.caption : '(unnamed)',
        entityId: typeof r.id === 'string' ? r.id : undefined,
        addressMatched: address,
      }));
    return {
      address,
      listed: matches.length > 0,
      matches,
      consulted: ['opensanctions'],
      failed: [],
      checkedAt: this.now().toISOString(),
    };
  }

  private resultsOf(raw: unknown): MatchResult[] {
    const responses = (raw as { responses?: Record<string, { results?: unknown }> } | null)
      ?.responses;
    const results = responses?.[QUERY_ID]?.results;
    if (!Array.isArray(results)) {
      throw new Error('opensanctions: no responses.<id>.results array in the answer');
    }
    return results as MatchResult[];
  }
}
