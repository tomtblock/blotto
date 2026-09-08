/**
 * Shared Postgres client for the Phase 9 services — the first `pg` consumer in `services/`,
 * established here so a later service reuses one client instead of pinning a
 * second. Built on the `PostgresConfig` the Step 0 config loader already exposes; no connection
 * literal is baked in (it comes from `loadPostgresConfig`).
 *
 * This is a thin wrapper over `pg.Pool` — a `query` passthrough and a `tx` helper that runs a
 * callback inside a single `BEGIN/COMMIT` (reverted on throw). The indexer needs the
 * transaction so a `(signature, event_index)` ledger insert and its derived-table projection
 * commit atomically: a row is either in the ledger AND projected, or in neither.
 *
 * Per TM-504 the service's DB role is write-restricted to the indexer tables (an ops/migration
 * concern, not enforced in code here); this client opens no more authority than its role grants.
 */

import { Pool, type PoolClient, type PoolConfig, type QueryResult } from 'pg';
import type { PostgresConfig } from './config';

/** A minimal queryable surface — satisfied by both `Pool` and a `PoolClient` (in-tx). */
export interface Queryable {
  query(text: string, params?: readonly unknown[]): Promise<QueryResult>;
}

/** Build a `pg.Pool` from the shared Postgres config. */
export function createPool(config: PostgresConfig): Pool {
  const poolConfig: PoolConfig = {
    connectionString: config.url,
    max: config.poolMax,
    // Close our idle clients BEFORE a managed host's own idle reaper does
    // (Neon's pooler drops idle connections after a few minutes), and keep
    // TCP keepalives on so half-open connections surface promptly.
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  };
  const pool = new Pool(poolConfig);
  // REQUIRED, not optional: pg emits 'error' on the pool for any idle
  // client that fails, and an unhandled 'error' event kills the process.
  // Production incident (first devnet deploy, 2026-08-28): the indexer
  // passed its deploy health checks, then died minutes later when the
  // managed Postgres dropped an idle connection — a crash loop no suite
  // caught because tests use short-lived pools. The next query simply
  // takes a fresh client; losing an idle one is routine, so log and live.
  pool.on('error', (err) => {
    console.error('pg pool: idle client error (continuing):', err.message);
  });
  return pool;
}

/**
 * Run `fn` inside a single transaction borrowed from the pool: `BEGIN`, then `COMMIT` on
 * success or `ROLLBACK` on any throw. The client is always released back to the pool.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure; surface the original error
    }
    throw err;
  } finally {
    client.release();
  }
}
