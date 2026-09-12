# Postgres migrations

Forward-only Postgres schema migrations (`.sql`), applied by the indexer's
`migrate` command (`backend/indexer/src/migrate.ts`) and tracked in a
`schema_migrations` table.

**Conventions carried from the predecessor repository.** The migration files
themselves were not carried — every one of them described the old product's
schema. What is carried is the discipline below, which is the part that was
learned rather than written.

## Conventions

- **`NNNN_description.sql`**, numbered, append-only, applied in filename order.
- **Never edit an applied migration in place.** Supersede it with a
  higher-numbered file. An edited migration produces two different schemas from
  the same version number — one on machines that ran it before the edit, one on
  machines that ran it after — and nothing detects the divergence.
- **Each migration runs in its own transaction.** A migration that cannot be
  applied atomically should be split until it can.
- **Runnable from a clean database.** The first run applies everything, so a fresh
  environment and a long-lived one converge on the same schema. **This is checked
  on every change** since 2026-09-12 (audit 2026-09-11, G-04): the `postgres` job
  of `ci-fast` drops the `public` schema, applies every file in this directory
  through `backend/indexer/src/migrate.ts`, and then drives every Postgres-backed
  store against the schema that produced — `tests/postgres/`. It also proves the
  per-migration transaction: a fixture migration that creates a table and then
  fails must leave neither the table nor a `schema_migrations` row behind.
  (Until then the only check was a fresh Fly machine booting in production; the
  `tests/e2e/` shell harness that this paragraph used to blame was removed the
  same day — it called files that were not in the tree and pinned the
  predecessor's program address.)
- **A migration that invalidates a DERIVED table must say so, in one line:**

  ```sql
  -- BLOTTO-MIGRATION: rederive-required
  ```

  The derived tables — `pools`, `entries`, `results`, `payouts`, `profiles`,
  `player_history`, `tier_status` — are a pure function of the `events` ledger,
  so dropping or re-shaping one loses nothing that cannot be rebuilt. But
  nothing rebuilds it on its own: the boot backfill chains a replay only when it
  INSERTED something, which on a normal boot it does not, and until 2026-09-12
  the only instruction was a sentence addressed to a human in `0004`'s header,
  which nothing read (audit E-15). A migration carrying this line makes
  `migrate()` report `rederiveRequired`, and the `sync` boot path rebuilds
  before it serves — an empty derived table answered out of is a site saying
  "no tournaments" as though it were the truth.

  Put it in any comment; the checker is case-insensitive and deliberately
  eager, because a false positive costs one needless replay and a false
  negative serves empty tables. `declaresRederive()` in
  `backend/indexer/src/migrate.ts` is the matcher, and its spec pins both the
  real files that carry the marker and the near-misses that must not.

- **On-chain quantities are `NUMERIC`, never `BIGINT` or `DOUBLE PRECISION`.**
  Lamport amounts are `u64` and exceed both a signed 64-bit integer's range and a
  double's exact-integer range. A prize amount rounded by a float is a payment bug.

## Migrations

- **`0001_events_ledger.sql`** — the append-only `events` ledger: primary key
  `(signature, event_index)`, `NUMERIC` slot, the emitting program, the event name,
  and the decoded body as raw `jsonb` with every `u64` as a decimal string.

  This is the ONLY table Phase 0 creates, and it is deliberately generic: it can
  hold any event the program emits without a schema change.

## What Phase 2 adds here

Derived tables for the event set in TECH-ARCH §3.3 — pools, entries, results,
claims — in higher-numbered files.

**The ledger is the source of truth and every derived table is a pure function of
it.** TECH-ARCH §1 commits the backend to publishing everything needed to
recompute what it computed; a derived table that cannot be rebuilt from `events`
alone has quietly become a second source of truth. The indexer's `re-derive`
command exists to keep that honest, and a projection change should be followed by a
re-derive and a comparison, not by trust.

One table this schema will need and should be designed carefully: the **sealed
ciphertext store** (`backend/sealing/`). It holds entries nobody — including the
operator — may read before a pool closes. That is a property of the code paths
around it rather than of the schema, but the schema should not make the wrong thing
easy: no plaintext column, no convenience view that joins a ciphertext to anything
that would let it be guessed, and no index that reveals ordering the reveal is
supposed to establish.
