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

/**
 * What TLS posture a connection URL actually gets us.
 *
 *   `verified`    the certificate chain is checked. The only safe posture
 *                 for a remote database.
 *   `alias`       `require` or `verify-ca`, which `pg-connection-string`
 *                 currently treats as aliases for `verify-full` — verified
 *                 TODAY, and documented to stop being so.
 *   `plaintext`   no TLS at all: no `sslmode`, or `sslmode=disable`.
 */
export type TlsPosture = 'verified' | 'alias' | 'plaintext';

/**
 * Classify a connection URL's TLS posture.
 *
 * ── WHY THIS IS NOT THE FIX IT LOOKS LIKE (2026-09-22) ────────────────────
 *
 * A fix has been stranded on `step/fix-deploy-db-tls` since 2026-08-28,
 * written after the first devnet deploy crash-looped. Its premise was that
 * `pg` 8.x IGNORES `sslmode` inside a `connectionString`, so it added
 * `ssl: true` to the `PoolConfig`. Both halves of that are false on the
 * pinned `pg` 8.23.0, checked by execution rather than taken on trust:
 *
 *   1. The POOL's `options.ssl` is indeed `undefined` — which is what the
 *      original author measured — but that is a red herring. Each `Client`
 *      parses the connection string itself, and `client.ssl` comes back
 *      `{}` for `sslmode=require`. TLS is already on.
 *   2. An explicit `ssl` option passed ALONGSIDE a `connectionString` is
 *      ignored: passing `{ rejectUnauthorized: false }` still leaves
 *      `client.ssl` as `{}`. The string wins. So the stranded fix would
 *      have changed nothing at all, in either direction.
 *
 * So it is not ported. What the check DID have right is its reasoning, and
 * that reasoning now points at a dated risk instead of a present one.
 * `pg-connection-string` emits this at runtime today:
 *
 *   "The SSL modes 'prefer', 'require', and 'verify-ca' are treated as
 *    aliases for 'verify-full'. In the next major version … these modes
 *    will adopt standard libpq semantics, which have weaker security
 *    guarantees. If you want the current behavior, explicitly use
 *    'sslmode=verify-full'."
 *
 * In other words: a URL saying `require` is verified TLS on `pg` 8 and
 * UNVERIFIED TLS on `pg` 9 — a MITM-accepting posture, arriving silently
 * with a dependency bump, on the connection that carries every sealed
 * entry and every complaint a player has written. The remedy is in the URL,
 * because the URL is what wins; no code here can override it.
 *
 * Hence: classify, and let the caller be loud about it. Pure and exported so
 * it is testable without a database.
 */
export function tlsPosture(url: string): TlsPosture {
  const mode = /[?&]sslmode=([a-z-]+)/.exec(url)?.[1];
  if (mode === 'verify-full') return 'verified';
  if (mode === 'require' || mode === 'verify-ca' || mode === 'prefer') return 'alias';
  return 'plaintext';
}

/** True when this URL names a host that can only be a developer's own machine. */
export function isLocalUrl(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|postgres)[:/]/.test(url);
}

/**
 * What to say at boot about this URL's TLS, or null when there is nothing to
 * say. Separated from the logging so a test asserts the judgement rather
 * than a console.
 *
 * PHASE-N-REVIEW (2026-09-22), CLOSED 2026-09-24: this WARNS where it could
 * refuse, and that was deliberate rather than timid — the URL lived in a
 * deploy secret the session could not read, a battle test was live that
 * night, and a code change that stops the backend booting over a condition
 * nobody had inspected is worse than a loud line in a boot log. The note
 * said the refusal should exist once the posture was confirmed.
 *
 * It now does, in `db-preflight.ts`, run by `check-database-url.ts` at the
 * head of `deploy-backend`'s deploy job — before a machine is replaced
 * rather than after, which was the point. THIS function stays a warning and
 * stays here: a boot line is the only thing that speaks for a machine
 * restarted by the platform rather than by a deploy, and the refusal upstream
 * cannot see that restart happen.
 */
export function tlsWarning(url: string): string | null {
  if (isLocalUrl(url)) return null;
  const posture = tlsPosture(url);
  if (posture === 'verified') return null;
  if (posture === 'alias') {
    return (
      'pg: DATABASE_URL relies on an sslmode that pg-connection-string treats as ' +
      'verify-full TODAY and will treat as unverified TLS from pg 9 — set sslmode=verify-full ' +
      'in the secret so the posture survives a dependency bump'
    );
  }
  return (
    'pg: DATABASE_URL names a remote host with NO TLS — every row, including sealed entries ' +
    'and complaint text, crosses the network in the clear. Set sslmode=verify-full in the secret'
  );
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
  // Said ONCE, at boot, where an operator reads it. The URL is what decides
  // the TLS posture (an `ssl` option passed here loses to it), so this is a
  // report rather than a correction — see `tlsWarning`.
  const warning = tlsWarning(config.url);
  if (warning !== null) console.warn(warning);

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
