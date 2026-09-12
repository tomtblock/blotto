/**
 * A database handle that can group writes so they land together or not at
 * all (audit 2026-09-11, B-20 / F-05).
 *
 * The archive ingest wrote four kinds of statement — the attempt row, a
 * wholesale DELETE of the pool's served rankings, N inserts, and the flag
 * that vouches for them — each on its own autocommitted round trip, in an
 * order that published the vouching flag FIRST. Two failures fell out of
 * that: a crash after the DELETE left an empty leaderboard still marked
 * verified, and any reader arriving between the flag and the last insert saw
 * a truncated field presented as the whole result.
 *
 * `Queryable` (the shared `pg` surface) cannot express a transaction: both a
 * `Pool` and an in-transaction `PoolClient` satisfy it, which is what makes
 * it useful everywhere and useless here. `AtomicDb` adds the one method the
 * ingest needs, and `atomicDb()` is the only place that knows it is a `pg`
 * pool underneath — so a test can supply an implementation that proves the
 * grouping by failing inside it.
 */

import type { Pool } from 'pg';
import { withTransaction } from './shared';
import type { Queryable } from './shared';

export interface AtomicDb extends Queryable {
  /**
   * Run `fn`'s statements as one unit: every write inside either commits
   * together or is undone together, and a throw inside `fn` surfaces once
   * the database has discarded them.
   */
  atomically<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

/** Wrap a `pg` pool as an `AtomicDb`. */
export function atomicDb(pool: Pool): AtomicDb {
  return {
    query: (text, params) => pool.query(text, params as unknown[]),
    atomically: (fn) => withTransaction(pool, (client) => fn(client)),
  };
}
