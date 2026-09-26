# backend/indexer

Ingests the `blotto_cup` program's on-chain events via **webhook deliveries** and writes them to
**Postgres**. It is the off-chain event store that the reveal, scoring, detection and read-API
pipelines read from.

## What it holds

- **`events`** (the ledger) — one row per decoded event, keyed `(signature, event_index)`, with the
  decoded body in a raw `jsonb` column. Defined in `../_shared/migrations/0001_events_ledger.sql`.
- **Derived tables** — projections of that ledger (`pools`, `entries`, `results`, `payouts`,
  `profiles`, `player_history`, `tier_status`, `rankings`, `bundles` and others). The per-migration
  detail is in [`../_shared/migrations/README.md`](../_shared/migrations/README.md).
  `src/projection.ts` is the reference projection and `src/projection-pg.ts` the Postgres one; both
  commit in the same transaction as the ledger append.

**The ledger is the source of truth; derived tables are a pure function of it.** The backend
publishes everything needed to recompute what it computed, and a derived table that could not be
rebuilt from the ledger alone would be a second source of truth. The `re-derive` command keeps that
honest, and is run — with its output compared — whenever a projection changes.

## The events it carries

`backend/_shared/src/events.ts` holds the generic decode mechanism; the layouts are declared in
`backend/_shared/src/blotto-events.ts`, one per `#[event]` struct in the program. **That module is
the event list** — the table below is a reading aid. In registration order:

| Event | Carries |
|---|---|
| `PoolOpened` | `pool, id, tier, entry_lamports, pot_lamports, fill_deadline, timer_seconds, sealing_pubkey, sealing_secret_hash, mode` — `pot_lamports` is the fixed prize pool moved treasury → pool vault at open; `mode` is 0 easy / 1 hard |
| `PoolVrfSeeded` | `pool, randomness_account, vrf_seed, slot` — the class draw's seed |
| `PassCollectionCreated` | `pool, pass_collection, name, uri` |
| `EntryRegistered` | `pool, player, index, battles_hash, class, slot_hash, pass_asset, terms_version` |
| `PoolSealed` | `pool, entrants, pot_lamports, reason` — the field the pool plays with (64 at the 64th entry, or 40–63 when the fill deadline closed it); `reason` is `Capacity` or `DeadlineMinFill` |
| `PoolMigrated` | `pool, min_seats, mode` — a pool account grown to the current layout |
| `TierSlotFreed` | `tier, pool_id, next_open_at, mode` — the cooldown stamp the "next pool in" countdown reads |
| `PoolSecretRevealed` | `pool, secret` — after which anyone can decrypt and verify every entry |
| `ResultsCommitted` | `pool, root, payouts[{entry_index, amount}]` — the results-tree root the verify page recomputes against, plus the seat-keyed payout list |
| `PrizesPaid` | `payouts[{player, entry_index, amount, escrowed}], paid_mask` — the prize pushed to the winning seat, or split across a tie for first; `escrowed` marks a share held for review |
| `EntryFlagged` | `player, flagged` — an entry held in escrow pending review |
| `EscrowReleased` | `player, amount` — a held share paid after review cleared it |
| `EscrowForfeited` | `player, amount, destination` — an upheld flag; the share stays in the pool's vault and nothing returns to the operator |
| `NextPlacePaid` | `from, to, rank, amount, group_size` — one member's portion of a forfeited share |
| `RefundTriggered` | `entrants` — a pool that missed the minimum field at its fill deadline |
| `Refunded` | `player, amount` |
| `SanctionsHoldPlaced` / `SanctionsHoldLifted` | `pool, player, placed_at` / `lifted_at` — a hold separate from integrity review |
| `PlatformFunded` / `PlatformWithdrawn` | `amount, platform_balance` — treasury movements |
| `TierEconomicsSet` / `TreasuryPolicySet` / `TiersOpened` | a tier's price and prize pool; the reserve policy; which tiers are open |
| `KeeperSet` / `PoolTimingSet` / `ConfigMigrated` | the keeper key; the fill-deadline and cooldown seconds |
| `HardLadderAdded` / `HardTiersOpened` | the hard-mode tier ladder and which of its tiers are open |

Decoders are length-aware where an event has grown, so events recorded before a field was appended
still replay (those fields decode as `null`).

Every recomputation input reaches this log. A player who does not trust the operator can
reconstruct the whole pool from this stream, which is why a decoder that silently drops a field is a
correctness bug, not a display bug.

## Commands

```bash
npm run migrate     # apply forward-only migrations (runnable from a clean DB)
npm run serve       # authenticated webhook receiver
npm run backfill    # catch up from RPC through the SAME write path
npm run re-derive   # rebuild derived tables from the ledger alone
npm run sync        # deployment entry: migrate (re-derive if a migration requires it), backfill, then serve
```

## The read API

`src/read-api.ts` is the app's data source (`app/src/data/`): read-only JSON served from the derived
tables — the pool list and one pool, a pool's entries, results, payouts, archive ranking and verify
record; a player's profile and history; the per-tier cooldown stamps; the server clock every
countdown derives from; and the treasury report. The module header carries the route table and each
route's fail-closed rules. Route handling is a pure function (path → handler), so the suite tests it
without sockets; `serveReadApi` is the thin Node http wrapper.

## Two paths, one write

The webhook and the backfill walk both funnel through `ingestTransaction`, so a signature observed
by both yields exactly one ledger row. Idempotency is enforced twice on purpose: in the application
(`InMemoryEventStore` / `PgEventStore` return `'duplicate'`) and in the schema (the
`(signature, event_index)` primary key). The application check keeps redelivery cheap; the
constraint makes a race impossible.

Backfill is the recovery path for a dropped delivery. A missed `EntryRegistered` would be a player
who paid and does not appear in the field, so `test/ingest.spec.ts` carries regression pins
(QA-C5-001) for a pagination defect that could truncate the walk whenever a page contained failed
transactions.

## Commitment

Ingests at `finalized` by default (`BLOTTO_INDEXER_COMMITMENT`), so a reorg rollback is moot at the
cost of a few seconds of latency. `confirmed` is available for a lower-latency read that a caller
must be prepared to see reverted.

## Threat notes

A read-only consumer of chain state. It holds no authority over any outcome — not the class draw,
not the scoring, not a payment. Its integrity comes from **re-derivability against the chain**, not
from trusting the service: anything it says can be checked against the events it read.

The webhook endpoint is the one public write surface. It authenticates a shared secret with a
constant-time compare, and `backend/_shared/src/http-hygiene.ts` supplies rate limiting, CORS and
security headers.
