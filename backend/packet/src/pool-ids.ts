/**
 * Pool address → on-chain numeric pool id.
 *
 * The sealed-entry store is keyed on the pool's NUMERIC on-chain id — the
 * value `PoolOpened` carries and the value every reader uses: the settlement
 * crank (`backend/reveal/src/ranking.ts`), the read API's sealed-entries join
 * (`backend/indexer/src/read-api.ts`) and the next-place driver. The browser,
 * however, only ever knows the pool's PDA address, because that is what the
 * read API serves and what the entry transaction is built against.
 *
 * Until 2026-09-12 the route bridged that gap with a local hash of the PDA
 * string. Nothing read rows under that key, so every sealed allocation was
 * written where no reader could find it, and every pool would have settled
 * with its whole field scored as all losses. The audit of 2026-09-11 found
 * it; this module is the bridge that should always have been here.
 *
 * The mapping lives in the indexer's `pools` projection, which the same
 * Postgres instance already holds. Resolution FAILS CLOSED: an unknown pool
 * is a refused write, never a write under a guessed key. That is the right
 * direction of failure — a refused ciphertext costs a player one retry
 * before they have paid anything, while a ciphertext written under an
 * unreadable key costs them their entry after they have.
 */

import type { Queryable } from '../../_shared/src/db';

/** What the projection knows about a pool, as the ciphertext route needs it. */
export interface PoolFacts {
  /** The on-chain numeric id — the key the ciphertext store is read by. */
  id: bigint;
  /** The pool's lifecycle state as the indexer last projected it. */
  state: string;
}

export interface PoolIdResolver {
  /** The pool's id and state, or null when the address is unknown. */
  lookup(pool: string): Promise<PoolFacts | null>;
}

/**
 * Postgres-backed resolver over the indexer's `pools` projection.
 *
 * Deliberately uncached. The id alone would cache safely, but the route also
 * refuses a write to a pool that has stopped accepting entries, and a stale
 * "Open" would reopen exactly the window this lookup exists to close. One
 * indexed primary-key read per sealed entry is a price worth paying.
 */
export class PgPoolIdResolver implements PoolIdResolver {
  constructor(private readonly db: Queryable) {}

  async lookup(pool: string): Promise<PoolFacts | null> {
    const res = await this.db.query('SELECT id, state FROM pools WHERE pool = $1', [pool]);
    const row = res.rows[0] as { id: unknown; state: unknown } | undefined;
    if (!row || row.id === null || row.id === undefined) return null;
    return { id: BigInt(String(row.id)), state: String(row.state ?? '') };
  }
}

/** In-memory resolver for the route suites and the offline harness. */
export class MemoryPoolIdResolver implements PoolIdResolver {
  private readonly pools = new Map<string, PoolFacts>();

  set(pool: string, id: bigint, state = 'Open'): void {
    this.pools.set(pool, { id, state });
  }

  async lookup(pool: string): Promise<PoolFacts | null> {
    return this.pools.get(pool) ?? null;
  }
}
