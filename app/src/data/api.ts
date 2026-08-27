/*
 * The read-API client + the fixture fallback.
 *
 * With NEXT_PUBLIC_INDEXER_URL set, every read goes to the indexer's read
 * API. Without it (design work, tests, a fresh checkout) the FIXTURE
 * implementation serves a deterministic devnet-shaped pool so every page
 * renders — clearly watermarked as fixture data by the pool id.
 */

import type {
  EntryRow,
  IndexerApi,
  PayoutRow,
  PoolSummary,
  ProfileRow,
  ResultRow,
} from './types';
import { FIXTURE_API } from './fixture';

class HttpIndexerApi implements IndexerApi {
  constructor(private readonly base: string) {}

  private async get<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.base}${path}`, { cache: 'no-store' });
    if (res.status === 404) return null;
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
}

export function indexerApi(): IndexerApi {
  const base = process.env.NEXT_PUBLIC_INDEXER_URL;
  return base ? new HttpIndexerApi(base) : FIXTURE_API;
}
