# Postgres migrations

Forward-only Postgres schema migrations (`.sql`), applied by the indexer's `migrate` command
(`backend/indexer/src/migrate.ts`) and tracked in a `schema_migrations` table.

## Conventions

- **`NNNN_description.sql`**, numbered, append-only, applied in filename order.
- **Never edit an applied migration in place.** Supersede it with a higher-numbered file. An edited
  migration produces two different schemas under the same version number, and nothing detects the
  divergence.
- **Each migration runs in its own transaction.** A migration that cannot be applied atomically is
  split until it can.
- **Runnable from a clean database**, so a fresh environment and a long-lived one converge on the
  same schema. This is checked on every change: the `postgres` job of `ci-fast` drops the `public`
  schema, applies every file here through `backend/indexer/src/migrate.ts`, and drives every
  Postgres-backed store against the result (`tests/postgres/`). It also proves the per-migration
  transaction: a fixture migration that creates a table and then fails must leave neither the table
  nor a `schema_migrations` row behind.
- **A migration that invalidates a derived table says so, in one line:**

  ```sql
  -- BLOTTO-MIGRATION: rederive-required
  ```

  The derived tables rebuilt by a re-derive — `pools`, `entries`, `results`, `payouts`, `profiles`,
  `player_history`, `tier_status` — are a pure function of the `events` ledger, so dropping or
  reshaping one loses nothing that cannot be rebuilt. Nothing rebuilds them on its own, though: a
  normal boot's backfill inserts nothing and so triggers no replay. A migration carrying this line
  makes `migrate()` report `rederiveRequired`, and the `sync` boot path rebuilds before it serves,
  so the site never answers from an emptied table.

  The marker may sit in any comment; the check is case-insensitive and deliberately eager, because a
  false positive costs one needless replay and a false negative serves empty tables.
  `declaresRederive()` in `backend/indexer/src/migrate.ts` is the matcher, and
  `backend/indexer/test/migrate-marker.spec.ts` pins both the real files that carry it
  (`0004`, `0019`, `0025`) and near-misses that must not match.
- **On-chain quantities are `NUMERIC`, never `BIGINT` or `DOUBLE PRECISION`.** Lamport amounts are
  `u64` and exceed both a signed 64-bit integer's range and a double's exact-integer range. A prize
  amount rounded by a float is a payment bug.

## The schema

| File | Adds |
|---|---|
| `0001_events_ledger.sql` | The append-only `events` ledger: primary key `(signature, event_index)`, `NUMERIC` slot, emitting program, event name, and the decoded body as raw `jsonb` with every `u64` as a decimal string. Generic: it holds any event the program emits without a schema change. |
| `0002_sealed_entries.sql` | `sealed_entries` — the sealed ciphertext store (see below). |
| `0003_derived_tables.sql` | `pools`, `entries`, `results`, `payouts`, `profiles`. |
| `0004_seat_payouts.sql` | `results` and `payouts` rebuilt keyed by seat. |
| `0006_review_decisions.sql` | `review_decisions`. |
| `0008_player_history.sql` | `player_history`. |
| `0009_notify_optin.sql` | `notify_optin`. |
| `0010_deployment_stores.sql` | `published_pool_keys`, `attestations`. |
| `0011_archive.sql` | `rankings`, `bundles`. |
| `0013_tier_status.sql` | `tier_status`. |
| `0016_published_bundles.sql` | `published_bundles`. |
| `0019_sanctions.sql` | `sanctions_refusals`. |
| `0021_detection_reports.sql` | `detection_reports`. |
| `0023_notify_pool_optin.sql` | `notify_pool_optin`. |
| `0024_complaints.sql` | `complaints`. |
| `0025_pool_mode.sql` | `pools.mode` (0 easy, 1 hard) and `tier_status` re-keyed by `(tier, mode)`, since each mode keeps its own tier ladder. |

The remaining files add or drop columns and indexes on these tables; each file's header says what
and why.

**The ledger is the source of truth and every derived table is a pure function of it.** The backend
publishes everything needed to recompute what it computed; a derived table that cannot be rebuilt
from `events` alone would be a second source of truth. The indexer's `re-derive` command keeps that
honest, and a projection change is followed by a re-derive and a comparison.

## The sealed ciphertext store

`sealed_entries` holds entries nobody — including the operator — may read before a pool closes.
That is enforced by the custody policy in `backend/sealing/`, not by the schema, but the schema does
not make the wrong thing easy: no plaintext column, no convenience view that joins a ciphertext to
anything that would let it be guessed, and no index that reveals an ordering the reveal is meant to
establish.
