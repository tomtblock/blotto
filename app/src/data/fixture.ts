/*
 * Deterministic fixture data — what the pages render before an indexer URL
 * is configured. Shaped exactly like the read API's rows; the pool id
 * `FIXTURE` is the watermark.
 */

import type { IndexerApi, PoolSummary } from './types';

const POOL: PoolSummary = {
  pool: 'F1XTUREPoo1111111111111111111111111111111111',
  id: 'FIXTURE',
  tier: 0,
  entry_lamports: '100000000',
  pot_lamports: '5120000000',
  // A stable future-ish deadline; the countdown clamps at zero.
  fill_deadline: '4102444800',
  timer_seconds: 15,
  state: 'Open',
  sealing_pubkey: '11'.repeat(32),
  entrants: 23,
  results_root: null,
  secret: null,
};

export const FIXTURE_API: IndexerApi = {
  async listPools() {
    return [POOL];
  },
  async getPool(pool) {
    return pool === POOL.pool ? POOL : null;
  },
  async getEntries() {
    return [];
  },
  async getResults() {
    return [];
  },
  async getPayouts() {
    return [];
  },
  async getProfile() {
    return null;
  },
};
