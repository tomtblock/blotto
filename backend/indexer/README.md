# backend/indexer

Ingests the `blotto_cup` program's on-chain events via **webhook deliveries** and
writes them to **Postgres**. The canonical off-chain event store the reveal,
scoring, claim and detection pipelines read from.

**Carried from the predecessor repository**, with every event decoder and the whole
derived-table projection removed. What was carried is the *shape*, and the shape is
the valuable part — see `EXTRACTION-REPORT.md`.

## What it holds

- **`events`** (the ledger) — one row per decoded event, keyed
  `(signature, event_index)`, with the decoded body in a raw `jsonb` column.
  Defined in `../_shared/migrations/0001_events_ledger.sql` and it is the ONLY
  table Phase 0 creates.
- **Derived tables** — none yet. Phase 2 adds them in higher-numbered migrations,
  driven by the event list in TECH-ARCH §3.3.

**The ledger is the source of truth; derived tables are a pure function of it.**
That is not a style preference. TECH-ARCH §1 commits the backend to publishing
everything needed to recompute what it computed, and a derived table that cannot be
rebuilt from the ledger alone has quietly become a second source of truth. The
`re-derive` command exists to keep that honest, and it should be run — and its
output compared — whenever a projection changes.

## The events it will carry (TECH-ARCH §3.3)

None are registered yet; `backend/_shared/src/events.ts` has an empty layout
registry and a `TODO(phase-2)` naming each one:

| Event | Carries |
|---|---|
| `PoolOpened` | the pool's public key, the sealed-secret hash, the class root |
| `EntryRegistered` | `player, index, battles_hash, class, slot_hash` |
| `PoolSealed` | the 64th entry landed |
| `PoolSecretRevealed` | `secret` — after which anyone can decrypt and verify |
| `ResultsCommitted` | `root` — the Merkle root a claim proves against |
| `Claimed` | a prize paid |
| `EntryFlagged` | an entry held in escrow pending review |
| `Refunded` | a refund on a pool that missed its minimum fill |

Every recomputation input reaches this log. A player who does not trust the
operator reconstructs the whole pool from this stream, which is why a decoder that
silently drops a field is a correctness bug and not a display bug.

## Commands

```bash
npm run migrate     # apply forward-only migrations (runnable from a clean DB)
npm run serve       # authenticated webhook receiver
npm run backfill    # catch up from RPC through the SAME write path
npm run re-derive   # rebuild derived tables from the ledger alone
```

## Two paths, one write

The webhook and the backfill walk both funnel through `ingestTransaction`, so a
signature observed by both yields exactly one ledger row. Idempotency is enforced
twice on purpose: in the application (`InMemoryEventStore` / `PgEventStore` return
`'duplicate'`) and in the schema (the `(signature, event_index)` primary key). The
application check keeps the common redelivery cheap; the constraint makes a race
impossible.

Backfill is the recovery path for a dropped delivery. In this product that matters
more than it did in the last one: a missed `EntryRegistered` is a player who paid
and does not appear in the field. `test/ingest.spec.ts` carries the QA-C5-001
regression pins for exactly this — a pagination defect that silently truncated the
walk whenever a page contained failed transactions.

## Commitment

Ingests at `finalized` by default, so a reorg rollback is moot at the cost of a few
seconds of latency. `confirmed` is available via config for a lower-latency read
that a caller must be prepared to see rolled back.

## Threat notes

Read-only consumer of chain state. It holds no authority over any outcome — not
the class draw, not the scoring, not a payment. Its integrity comes from
**re-derivability against the chain**, not from trusting the service: anything it
says can be checked against the events it read.

The webhook endpoint is the one public surface. It is authenticated on a shared
secret, and `backend/_shared/src/http-hygiene.ts` carries the rate limiting, CORS
and security headers for it.
