/**
 * "Has this seat been paid for yet?" — the question the sealed-allocation
 * route needs and did not have.
 *
 * `ciphertexts.ts` gate 3 exists to stop a player destroying their own PAID
 * entry: the chain holds the first run's `battles_hash`, so replacing the
 * stored ciphertext under it makes the two disagree and the entry is scored
 * all losses at reveal. That harm is real and the gate must stay.
 *
 * It was asking the wrong question. "Does a ciphertext already exist?" and
 * "has the chain accepted this seat?" coincide only AFTER the register
 * lands. Before it they are opposites: a stored ciphertext with no
 * registered seat is an ABANDONED ATTEMPT — a refused packet, a dismissed
 * wallet prompt, a closed laptop, a dropped connection. Replacing it harms
 * nobody, and refusing it bars that wallet from that pool permanently,
 * having paid nothing, with no delete path and nothing that can say why
 * (DRIFT.md §H6; measured on devnet 2026-09-16 and again on 2026-09-18,
 * eleven wallets across three pools).
 *
 * THE KEY IS THE POOL'S PDA, NOT ITS NUMERIC ID. The ciphertext store is
 * keyed by the numeric id (`pool-ids.ts` explains why), but the `entries`
 * projection is keyed by the pool ADDRESS — `entries.pool` is TEXT holding
 * the base58 PDA, written from `EntryRegistered.pool`
 * (`backend/indexer/src/projection.ts`) and read that way by the read API
 * (`backend/indexer/src/read-api.ts`). Passing the numeric id here would
 * match zero rows for every player, which reads as "not registered" and
 * ALLOWS every overwrite — failing open, in the one direction that costs a
 * player their paid entry. The two keys are not interchangeable and this
 * module takes the address.
 *
 * Resolution FAILS CLOSED in the other direction: `null` means the
 * projection could not answer, and the caller then refuses the overwrite.
 * A wrong refusal costs one retry before anything is paid; a wrong
 * allowance costs a paid entry.
 */

import type { Queryable } from '../../_shared/src/db';

export interface SeatResolver {
  /**
   * True when the chain has an Entry for this pool and player, false when it
   * has none, null when the projection could not answer. Never guesses.
   *
   * @param pool   The pool's PDA, base58 — the `entries.pool` key. NOT the
   *               numeric id (see the module note).
   * @param player The player's wallet address, base58.
   */
  isRegistered(pool: string, player: string): Promise<boolean | null>;
}

/**
 * Postgres-backed resolver over the indexer's `entries` projection.
 *
 * Deliberately uncached, for the same reason `PgPoolIdResolver` is: the
 * answer is what decides whether a write is refused, and a stale "not
 * registered" reopens exactly the window this lookup exists to close. One
 * indexed primary-key read per overwrite attempt — which is rare, since the
 * common path stores once.
 *
 * THE RESIDUAL RACE, NAMED RATHER THAN HIDDEN. The projection lags the chain
 * by the indexer's catch-up time. A player who registers and then re-seals
 * inside that window is allowed an overwrite that harms them. It takes
 * deliberate action, by the keyholder, against their own entry, in a
 * seconds-wide window, and the outcome is the published lost-ciphertext rule
 * (scored all losses, with an operator alert) rather than a silent loss.
 * Against permanently barring every player who meets a transient failure,
 * this is the better trade by a wide margin. Closing the race too means
 * reading the `Entry` PDA over RPC — authoritative, one `getAccountInfo`,
 * and a chain dependency this service does not currently have.
 */
export class PgSeatResolver implements SeatResolver {
  constructor(private readonly db: Queryable) {}

  async isRegistered(pool: string, player: string): Promise<boolean | null> {
    try {
      const res = await this.db.query(
        'SELECT 1 FROM entries WHERE pool = $1 AND player = $2 LIMIT 1',
        [pool, player]
      );
      // `rowCount` is nullable in pg's types; the row array is the fact.
      return res.rows.length > 0;
    } catch {
      // The caller refuses on null — see the fail-closed note above. The
      // error is swallowed rather than thrown so a database blip refuses one
      // overwrite instead of 500-ing the whole route.
      return null;
    }
  }
}

/** In-memory resolver for the route suites and the offline harness. */
export class MemorySeatResolver implements SeatResolver {
  private readonly seats = new Set<string>();
  /** When true, every lookup answers "cannot say" — the broken-database case. */
  private broken = false;

  /** Record that the chain accepted this seat. */
  register(pool: string, player: string): void {
    this.seats.add(`${pool}:${player}`);
  }

  /** Make every lookup unanswerable, to prove the caller fails closed. */
  breakIt(): void {
    this.broken = true;
  }

  async isRegistered(pool: string, player: string): Promise<boolean | null> {
    if (this.broken) return null;
    return this.seats.has(`${pool}:${player}`);
  }
}
