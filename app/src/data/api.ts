/*
 * The read-API client, the fixture fallback, and the production guard.
 *
 * With NEXT_PUBLIC_INDEXER_URL set, every read goes to the indexer's read
 * API. Without it, what happens depends on the BUILD:
 *
 *   - development and test: the FIXTURE implementation serves a
 *     deterministic devnet-shaped catalogue so every page renders without a
 *     live tournament — watermarked as fixture data by the pool id;
 *   - production: NOTHING is served. Every read throws, which is the honest
 *     "we cannot know right now" the degraded states already render — unless
 *     the build DELIBERATELY asked for fixtures (NEXT_PUBLIC_FIXTURE_DATA,
 *     the visual journey suite's one use; see `fixturesAllowed`).
 *
 * The production branch is audit 2026-09-11 (A-07 / C-26 / D-15 / E-01).
 * The old comment here claimed fixtures were "clearly watermarked", and
 * scenarios.ts claimed "nothing here is reachable in production". Neither
 * was true: with the variable unset or empty a deployed build served the
 * fabricated tournaments through the ordinary pages, Enter button and all,
 * and the fixture pool's non-numeric id then threw inside `BigInt(pool.id)`
 * at confirm — ninety seconds of allocation into a dead end. A watermark in
 * an id is not a gate; this is.
 */

import type {
  CareerRow,
  EntryRow,
  IndexerApi,
  PayoutRow,
  PoolLeaderboard,
  PoolSummary,
  ProfileRow,
  ResultRow,
  TiersResponse,
  TreasuryTiers,
} from './types';
import { FIXTURE_API } from './fixture';

/**
 * Ceiling on one read of the indexer, server or browser. Without it a
 * hung indexer hangs the server render of every page that reads it
 * (founder 2026-09-09: the entry page "taking far too long"); with it the
 * read throws, `live` degrades the page and the browser fallback takes over.
 */
const READ_TIMEOUT_MS = 8_000;

class HttpIndexerApi implements IndexerApi {
  constructor(private readonly base: string) {}

  private async get<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.base}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    // 404: no such row. 400: the path names something that cannot exist
    // (a malformed address) — the same answer to a reader, and one a retry
    // could never change, so it is "not here" rather than a failure.
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`indexer read API ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  async listPools() {
    return (await this.get<PoolSummary[]>('/pools')) ?? [];
  }
  async getPool(pool: string) {
    return this.get<PoolSummary>(`/pools/${pool}`);
  }
  async getEntries(pool: string) {
    return (await this.get<EntryRow[]>(`/pools/${pool}/entries`)) ?? [];
  }
  async getResults(pool: string) {
    return (await this.get<ResultRow[]>(`/pools/${pool}/results`)) ?? [];
  }
  async getPayouts(pool: string) {
    return (await this.get<PayoutRow[]>(`/pools/${pool}/payouts`)) ?? [];
  }
  async getProfile(player: string) {
    return this.get<ProfileRow>(`/profiles/${player}`);
  }
  async getCareer(player: string) {
    return (await this.get<CareerRow[]>(`/profiles/${player}/history`)) ?? [];
  }
  async getTreasury() {
    return this.get<TreasuryTiers>('/treasury');
  }
  async getTiers() {
    return this.get<TiersResponse>('/tiers');
  }
  async getLeaderboard(pool: string) {
    // 404 = no VERIFIED archive for this pool (the read API fails closed;
    // an unverified or mismatched bundle is indistinguishable from none).
    return this.get<PoolLeaderboard>(`/pools/${pool}/leaderboard`);
  }
}

/**
 * The message every read carries when a production build has no indexer.
 * Named so an operator reading a server log or a browser console sees the
 * cause and the fix, not a generic network error.
 */
export const INDEXER_UNCONFIGURED_MESSAGE =
  'indexer not configured (NEXT_PUBLIC_INDEXER_URL) — no live pool data is available in this build';

/**
 * The production stand-in for a missing indexer: every method rejects.
 *
 * Rejecting is deliberate and is the whole fix. `live()` below turns a
 * rejected read into the designed "live data unavailable" card on every
 * server-rendered page, and the browser-side readers already have their own
 * failure states (the play page's "The pool could not be loaded", the
 * profile's unavailable card). Serving `[]` or `null` instead would say
 * "no tournament is open", which is a claim about the world we cannot make.
 *
 * Built as a Proxy rather than eleven hand-written stubs so a method added
 * to `IndexerApi` later cannot quietly fall back to `undefined` here.
 */
const UNCONFIGURED_API: IndexerApi = new Proxy({} as IndexerApi, {
  get(_target, property) {
    return async () => {
      throw new Error(`${INDEXER_UNCONFIGURED_MESSAGE} (read: ${String(property)})`);
    };
  },
});

/**
 * May this build serve fixtures at all?
 *
 * `process.env.NODE_ENV` is set by the framework and inlined at build time
 * ('production' for `next build`, 'development' for `next dev`, 'test'
 * under vitest), so in the ordinary case this folds to a constant and the
 * fixture branch is dead code in a deployed bundle.
 *
 * NEXT_PUBLIC_FIXTURE_DATA is the ONE way to get fixtures out of a
 * production build, and it exists for one caller: the visual journey suite
 * (playwright.config.ts) screenshots every page of a REAL production build
 * with no backend at all. That is a legitimate need, and it is why the
 * fallback existed in the first place.
 *
 * What the audit found was not that fixtures exist — it was that they were
 * served BY OMISSION: forget one environment variable in a deploy and
 * players got fabricated tournaments with an Enter button. A flag somebody
 * has to set deliberately is a different thing, and it is guarded twice
 * over: `next.config.ts` normalises it to "0" when unset (so it inlines as
 * a literal rather than staying a runtime lookup — the exact mistake the
 * app-test-signer CI lane was written about), and
 * `assertClusterInvariants` refuses to build a MAINNET bundle with it on.
 *
 * PHASE-N-REVIEW: introducing a flag at all is a judgement call. The
 * alternative — no fixtures in any production build — would have taken the
 * visual journey suite's whole method away with it, and a suite that cannot
 * run is not a safer product.
 */
export function fixturesAllowed(): boolean {
  return (
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_FIXTURE_DATA === '1'
  );
}

/** Pick the read API for this build. */
export function indexerApi(): IndexerApi {
  const base = process.env.NEXT_PUBLIC_INDEXER_URL?.trim();
  if (base) return new HttpIndexerApi(base);
  return fixturesAllowed() ? FIXTURE_API : UNCONFIGURED_API;
}

/**
 * The SSR outage guard (production incident, 2026-08-28: the indexer went
 * down and every server-rendered page died to the framework's blank
 * "server error" screen). A page must DEGRADE when a backend read fails —
 * render an honest "live data unavailable" state — never crash. The
 * discriminated result keeps "the indexer says empty" distinct from "the
 * indexer is unreachable": conflating them would show "no tournament is
 * open" while the truth is "we cannot know right now".
 */
export type Live<T> = { ok: true; value: T } | { ok: false };

export async function live<T>(read: () => Promise<T>): Promise<Live<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    console.error('indexer read failed (page degrades):', error);
    return { ok: false };
  }
}
