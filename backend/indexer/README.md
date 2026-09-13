# backend/indexer

Ingests the `blotto_cup` program's on-chain events via **webhook deliveries** and
writes them to **Postgres**. The canonical off-chain event store the reveal,
scoring, detection and read-API pipelines read from.

**Carried from the predecessor repository**, with every event decoder and the whole
derived-table projection removed. What was carried is the *shape*, and the shape is
the valuable part — see `EXTRACTION-REPORT.md`.

## What it holds

- **`events`** (the ledger) — one row per decoded event, keyed
  `(signature, event_index)`, with the decoded body in a raw `jsonb` column.
  Defined in `../_shared/migrations/0001_events_ledger.sql`.
- **Derived tables** — projections of that ledger, added by migrations 0002–0015
  in `../_shared/migrations/` (that directory's README owns the per-migration
  detail): `sealed_entries` (0002); `pools`, `entries`, `results`, `payouts`,
  `profiles` (0003, with `results`/`payouts` rebuilt seat-keyed by 0004);
  `review_decisions` (0006); `player_history` (0008); `notify_optin` (0009);
  `published_pool_keys` and `attestations` (0010); `rankings` and `bundles`
  (0011); `tier_status` (0013). 0005, 0007, 0012, 0014 and 0015 add columns and
  indexes to those tables rather than new ones. `./src/projection.ts` is the
  reference projection and `./src/projection-pg.ts` the Postgres one; both
  commit in the same transaction as the ledger append.

**The ledger is the source of truth; derived tables are a pure function of it.**
That is not a style preference. TECH-ARCH §1 commits the backend to publishing
everything needed to recompute what it computed, and a derived table that cannot be
rebuilt from the ledger alone has quietly become a second source of truth. The
`re-derive` command exists to keep that honest, and it should be run — and its
output compared — whenever a projection changes.

## The events it carries

`backend/_shared/src/events.ts` holds the generic decode mechanism; the layouts
are declared in `backend/_shared/src/blotto-events.ts`, one per `#[event]` struct
in `programs/blotto_cup/src/{events.rs, vrf.rs, pass.rs}`. **That module is the
event list** — the table below is a reading aid and will drift if it is trusted
over the code. In registration order:

| Event | Carries |
|---|---|
| `PoolOpened` | `pool, id, tier, entry_lamports, pot_lamports, fill_deadline, timer_seconds, sealing_pubkey, sealing_secret_hash` — `pot_lamports` is the FIXED pot moved treasury → prize vault at open (D-A1 revised) |
| `PoolVrfSeeded` | `randomness_account, vrf_seed, slot` — the class draw's seed |
| `PassCollectionCreated` | `pass_collection, name, uri` |
| `EntryRegistered` | `player, index, battles_hash, class, slot_hash, pass_asset, terms_version` |
| `PoolSealed` | `entrants` — the field the pool plays with: 64 at the 64th entry, or the pool's own floor..63 when `seal_at_deadline` closed it (40..63 since R7-b). Since R7-b the event also carries `pot_lamports` and `reason` (`Capacity` or `DeadlineMinFill`); the decoder is length-aware, so events recorded before that still replay |
| `TierSlotFreed` | `tier, pool_id, next_open_at` — the cooldown stamp the "next pool in" countdown reads |
| `PoolSecretRevealed` | `secret` — after which anyone can decrypt and verify |
| `ResultsCommitted` | `root` — the results-tree root the verify page recomputes against (R10: no claim, prizes are pushed), plus the seat-keyed committed payout list |
| `PrizesPaid` | `payouts[{player, entry_index, amount, escrowed}], paid_mask` — the prize pushed to the winning seat, or split across a tie for first; `escrowed` marks a share held rather than transferred |
| `EntryFlagged` | `player, flagged` — an entry held in escrow pending review |
| `EscrowReleased` | `player, amount` — a held share paid after review cleared it |
| `EscrowForfeited` | `player, amount, destination` — an upheld flag; the share stays in the pool's vault and nothing returns to the operator |
| `NextPlacePaid` | `from, to, rank, amount, group_size` — one member's portion of a forfeited share |
| `RefundTriggered` | `entrants` — a pool that missed `MIN_SEATS` at its fill deadline |
| `Refunded` | `player, amount` |
| `PlatformFunded` / `PlatformWithdrawn` | `amount, platform_balance` — treasury movements (D-A1 revised) |
| `TierEconomicsSet` / `TreasuryPolicySet` / `TiersOpened` | a tier's price and pot; the reserve policy; which tiers are open |
| `KeeperSet` / `PoolTimingSet` / `ConfigMigrated` | the keeper key, the fill-deadline and cooldown seconds |

`SanctionsHoldPlaced` and `SanctionsHoldLifted` are emitted by the program but
have **no layout yet**, so they do not reach the ledger.

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

## The read API

`./src/read-api.ts` is the app's data seam (`app/src/data/`): read-only JSON
served off the derived tables — the pool list and one pool, a pool's entries,
results, payouts, verified archive ranking, verify record and sealed entries; a
player's profile, career history and rivals; the per-tier cooldown stamps; the
server clock every countdown derives from; the treasury report; and the D-A2
history summaries. Its module header carries the route table, and that header is
where a route's exact shape and its fail-closed rules are documented — this
README does not duplicate it. Route handling is a pure function (path →
handler), so the suite tests it without sockets; `serveReadApi` is the thin Node
http wrapper.

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
that a caller must be prepared to see reverted.

## Threat notes

Read-only consumer of chain state. It holds no authority over any outcome — not
the class draw, not the scoring, not a payment. Its integrity comes from
**re-derivability against the chain**, not from trusting the service: anything it
says can be checked against the events it read.

The webhook endpoint is the one public surface. It is authenticated on a shared
secret, and `backend/_shared/src/http-hygiene.ts` carries the rate limiting, CORS
and security headers for it.
