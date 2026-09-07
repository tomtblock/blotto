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
  environment and a long-lived one converge on the same schema. **Nothing checks
  this automatically today** (recorded 2026-09-07): `tests/e2e/` holds three
  library scripts and a fixture carried from the predecessor, no stage scripts,
  and no workflow runs it — the earlier claim that "the end-to-end harness resets
  its database every run" described a harness that does not exist here. The
  indexer image's `sync` entry applies every migration at boot, so a fresh Fly
  machine is the de-facto check; a clean-database migration run in CI is on the
  audit's open items.
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
