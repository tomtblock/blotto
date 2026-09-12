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

export interface PoolIdResolver {
  /** The pool's on-chain numeric id, or null when the address is unknown. */
  idFor(pool: string): Promise<bigint | null>;
}

/**
 * Postgres-backed resolver over the indexer's `pools` projection.
 *
 * A short positive cache keeps a full pool's 64 entries to one query without
 * holding a stale answer for long; negative answers are never cached, so a
 * pool that has only just opened resolves on the player's next attempt
 * rather than staying unknown for the cache lifetime.
 */
export class PgPoolIdResolver implements PoolIdResolver {
  private readonly cache = new Map<string, { id: bigint; at: number }>();

  constructor(
    private readonly db: Queryable,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  async idFor(pool: string): Promise<bigint | null> {
    const hit = this.cache.get(pool);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.id;
    const res = await this.db.query('SELECT id FROM pools WHERE pool = $1', [pool]);
    const row = res.rows[0] as { id: unknown } | undefined;
    if (!row || row.id === null || row.id === undefined) return null;
    const id = BigInt(String(row.id));
    this.cache.set(pool, { id, at: this.now() });
    return id;
  }
}

/** In-memory resolver for the route suites and the offline harness. */
export class MemoryPoolIdResolver implements PoolIdResolver {
  constructor(private readonly ids = new Map<string, bigint>()) {}

  set(pool: string, id: bigint): void {
    this.ids.set(pool, id);
  }

  async idFor(pool: string): Promise<bigint | null> {
    return this.ids.get(pool) ?? null;
  }
}
