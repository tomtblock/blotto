/**
 * The derived-table projection (roadmap 2.5, R15) — `pools`, `entries`,
 * `results`, `payouts`, `profiles` as a PURE FUNCTION of the event ledger.
 *
 * The ledger stays the single source of truth: every rule here is expressed
 * by `projectEvent`, which turns one decoded event into a list of mechanical
 * operations (upsert / increment / two named conditionals). Both
 * implementations — the in-memory reference and Postgres — EXECUTE the same
 * operation list, so their semantics cannot drift apart rule by rule; and
 * `rederive()` rebuilds every table from the ledger alone, which is the
 * property that keeps a derived row from quietly becoming a second source
 * of truth.
 *
 * Profiles (R15): a lifetime, read-only record — pools entered, prize totals,
 * the cosmetic class collection. Nothing here can affect a pool. (Rank
 * labels are not projected: under D3-B they are not in the events — they
 * live in the published bundle, where the verify page recomputes them.)
 */

import type { DecodedEvent } from './shared';

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type ProjectionOp =
  | {
      kind: 'upsert';
      table: 'pools' | 'entries' | 'results' | 'payouts' | 'profiles' | 'player_history';
      key: Record<string, string | number>;
      set: Record<string, unknown>;
    }
  | {
      kind: 'increment';
      table: 'pools' | 'entries' | 'profiles';
      key: Record<string, string | number>;
      field: string;
      /** Decimal string — increments are numeric and may exceed 2^53. */
      by: string;
    }
  | {
      /**
       * Insert the player-history row for one entry (D-A2 v2): tier and
       * pot copied from the `pools` row, `entries_to_date` read from
       * `profiles.pools_entered` — which the SAME event's increment op has
       * already bumped, so the value is "this is my Nth entry". A named op
       * (like the two conditionals) because it reads across tables.
       */
      kind: 'history_on_entry';
      pool: string;
      player: string;
      seat: number;
    }
  | {
      /** `pools.state = 'Closed'` once `refunded_count >= entrants`. */
      kind: 'close_if_fully_refunded';
      pool: string;
    }
  | {
      /**
       * `pools.paid_mask = mask` (decimal string of the on-chain u64), and
       * `pools.state = 'Paid'` once every committed seat's bit (the
       * `results` rows) is set — mirroring the program's own transition.
       */
      kind: 'paid_if_fully_settled';
      pool: string;
      mask: string;
    };

/** Map one decoded event to its projection operations. Unknown events: []. */
export function projectEvent(e: DecodedEvent): ProjectionOp[] {
  switch (e.event) {
    case 'PoolOpened':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: {
            id: e.id,
            tier: e.tier,
            entry_lamports: e.entry_lamports,
            pot_lamports: e.pot_lamports,
            fill_deadline: e.fill_deadline,
            timer_seconds: e.timer_seconds,
            sealing_pubkey: e.sealing_pubkey,
            sealing_secret_hash: e.sealing_secret_hash,
            state: 'Open',
            entrants: 0,
            paid_mask: 0,
            refunded_count: 0,
          },
        },
      ];
    case 'PoolVrfSeeded':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { vrf_seed: e.vrf_seed },
        },
      ];
    case 'PassCollectionCreated':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { pass_collection: e.pass_collection },
        },
      ];
    case 'EntryRegistered': {
      const cls = e.class as number;
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: {
            idx: e.index,
            battles_hash: e.battles_hash,
            class: cls,
            slot_hash: e.slot_hash,
            pass_asset: e.pass_asset,
            terms_version: e.terms_version,
            flagged: false,
            refunded: false,
            escrow_settled: null,
          },
        },
        {
          kind: 'increment',
          table: 'pools',
          key: { pool: e.pool as string },
          field: 'entrants',
          by: '1',
        },
        {
          kind: 'increment',
          table: 'profiles',
          key: { player: e.player as string },
          field: 'pools_entered',
          by: '1',
        },
        {
          kind: 'increment',
          table: 'profiles',
          key: { player: e.player as string },
          field: `class_${cls}`,
          by: '1',
        },
        // AFTER the pools_entered increment above — entries_to_date is the
        // post-increment counter (D-A2 v2's player-history exhibit).
        {
          kind: 'history_on_entry',
          pool: e.pool as string,
          player: e.player as string,
          seat: e.index as number,
        },
      ];
    }
    case 'GoTimerStarted':
      // D-E4: the 52nd entry shortened the on-chain `fill_deadline` in place
      // to the go deadline. Mirror both: `fill_deadline` stays THE effective
      // deadline for every reader; `go_deadline` says the timer started.
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { fill_deadline: e.go_deadline, go_deadline: e.go_deadline },
        },
      ];
    case 'PoolSealed':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { state: 'Sealed', entrants: e.entrants },
        },
      ];
    case 'PoolSecretRevealed':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { secret: e.secret },
        },
      ];
    case 'ResultsCommitted': {
      // D3-B: the committed payout list is keyed by SEAT; competition-rank
      // labels are not on-chain — they live in the published bundle (the
      // verify page recomputes them from it).
      const ops: ProjectionOp[] = [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { results_root: e.root, state: 'Scored' },
        },
      ];
      for (const p of e.payouts as Array<{ entry_index: number; amount: string }>) {
        ops.push({
          kind: 'upsert',
          table: 'results',
          key: { pool: e.pool as string, seat: p.entry_index },
          set: { amount: p.amount },
        });
      }
      return ops;
    }
    case 'PrizesPaid': {
      const ops: ProjectionOp[] = [];
      for (const p of e.payouts as Array<{
        player: string;
        entry_index: number;
        amount: string;
        escrowed: boolean;
      }>) {
        ops.push({
          kind: 'upsert',
          table: 'payouts',
          key: { pool: e.pool as string, seat: p.entry_index },
          set: { player: p.player, amount: p.amount, escrowed: p.escrowed },
        });
        ops.push({
          kind: 'increment',
          table: 'profiles',
          key: { player: p.player },
          field: 'seats_paid',
          by: '1',
        });
        // The history row's outcome: a committed payout is a paid seat,
        // escrowed or not (escrow is custody, not a smaller prize).
        ops.push({
          kind: 'upsert',
          table: 'player_history',
          key: { pool: e.pool as string, player: p.player },
          set: { paid: true, amount_lamports: p.amount },
        });
        if (!p.escrowed) {
          ops.push({
            kind: 'increment',
            table: 'profiles',
            key: { player: p.player },
            field: 'total_won_lamports',
            by: p.amount,
          });
        }
      }
      // paid_mask is a u64 seat bitmask — carried as a decimal string, never
      // a JS number.
      ops.push({
        kind: 'paid_if_fully_settled',
        pool: e.pool as string,
        mask: String(e.paid_mask),
      });
      return ops;
    }
    case 'EntryFlagged':
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: { flagged: e.flagged },
        },
      ];
    case 'EscrowReleased':
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: { escrow_settled: 'released' },
        },
        {
          kind: 'increment',
          table: 'profiles',
          key: { player: e.player as string },
          field: 'total_won_lamports',
          by: e.amount as string,
        },
      ];
    case 'EscrowForfeited':
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: { escrow_settled: 'forfeited' },
        },
      ];
    case 'RefundTriggered':
      return [
        {
          kind: 'upsert',
          table: 'pools',
          key: { pool: e.pool as string },
          set: { state: (e.entrants as number) === 0 ? 'Closed' : 'Refunding' },
        },
      ];
    case 'Refunded':
      return [
        {
          kind: 'upsert',
          table: 'entries',
          key: { pool: e.pool as string, player: e.player as string },
          set: { refunded: true },
        },
        {
          kind: 'increment',
          table: 'pools',
          key: { pool: e.pool as string },
          field: 'refunded_count',
          by: '1',
        },
        { kind: 'close_if_fully_refunded', pool: e.pool as string },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// The projection seam + the in-memory reference
// ---------------------------------------------------------------------------

export interface Projection {
  apply(event: DecodedEvent): Promise<void>;
  /** Drop every derived row (the start of a re-derive). */
  reset(): Promise<void>;
}

type Row = Record<string, unknown>;

/** In-memory projection — the reference semantics the Postgres one matches. */
export class MemoryProjection implements Projection {
  private tables = new Map<string, Map<string, Row>>();

  private table(name: string): Map<string, Row> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  private static rowKey(key: Record<string, string | number>): string {
    return Object.keys(key)
      .sort()
      .map((k) => `${k}=${key[k]}`)
      .join('|');
  }

  async apply(event: DecodedEvent): Promise<void> {
    for (const op of projectEvent(event)) {
      switch (op.kind) {
        case 'upsert': {
          const t = this.table(op.table);
          const k = MemoryProjection.rowKey(op.key);
          t.set(k, { ...(t.get(k) ?? {}), ...op.key, ...op.set });
          break;
        }
        case 'increment': {
          const t = this.table(op.table);
          const k = MemoryProjection.rowKey(op.key);
          const row = t.get(k) ?? { ...op.key };
          const current = BigInt((row[op.field] as string | number | undefined) ?? 0);
          row[op.field] = (current + BigInt(op.by)).toString();
          t.set(k, row);
          break;
        }
        case 'history_on_entry': {
          const poolRow = this.table('pools').get(MemoryProjection.rowKey({ pool: op.pool }));
          const profile = this.table('profiles').get(
            MemoryProjection.rowKey({ player: op.player })
          );
          const t = this.table('player_history');
          const k = MemoryProjection.rowKey({ pool: op.pool, player: op.player });
          t.set(k, {
            pool: op.pool,
            player: op.player,
            seat: op.seat,
            tier: (poolRow?.tier as number | undefined) ?? null,
            pot_lamports: (poolRow?.pot_lamports as string | undefined) ?? null,
            entries_to_date: String(profile?.pools_entered ?? '1'),
            paid: false,
            amount_lamports: '0',
            ...(t.get(k) ?? {}),
            // The identity fields above always win; the spread keeps a
            // paid flag that a replayed PrizesPaid already set. (Events
            // replay in ledger order, so in practice entry precedes pay.)
          });
          break;
        }
        case 'close_if_fully_refunded': {
          const t = this.table('pools');
          const k = MemoryProjection.rowKey({ pool: op.pool });
          const row = t.get(k);
          if (row) {
            const refunded = BigInt((row.refunded_count as string | number | undefined) ?? 0);
            const entrants = BigInt((row.entrants as string | number | undefined) ?? 0);
            if (entrants > 0n && refunded >= entrants) row.state = 'Closed';
          }
          break;
        }
        case 'paid_if_fully_settled': {
          const pools = this.table('pools');
          const k = MemoryProjection.rowKey({ pool: op.pool });
          const row = pools.get(k);
          if (row) {
            row.paid_mask = op.mask;
            const mask = BigInt(op.mask);
            const committed = [...this.table('results').values()].filter(
              (r) => r.pool === op.pool
            );
            if (
              committed.length > 0 &&
              committed.every((r) => ((mask >> BigInt(r.seat as number)) & 1n) === 1n)
            ) {
              row.state = 'Paid';
            }
          }
          break;
        }
      }
    }
  }

  async reset(): Promise<void> {
    this.tables.clear();
  }

  /** Deep, sorted snapshot for tests — two identical projections compare equal. */
  snapshot(): Record<string, Record<string, Row>> {
    const out: Record<string, Record<string, Row>> = {};
    for (const [name, t] of [...this.tables.entries()].sort()) {
      out[name] = {};
      for (const [k, row] of [...t.entries()].sort()) {
        out[name][k] = { ...row };
      }
    }
    return out;
  }
}
