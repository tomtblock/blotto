# backend/_shared

Shared off-chain infrastructure used by every backend service: environment and config loading, the
Postgres pool, HTTP hygiene for public endpoints, the metrics and alert seam, and the Anchor event
decoder with this program's event layouts.

Consumed as co-located TypeScript source — no build step, no workspace linkage. Each service
re-exports it through a single `src/shared.ts`, so infrastructure can later move to real package
resolution without touching a consumer.

## What is here

| Module | What it is |
|---|---|
| `config.ts` | Env parsing (`required`, `optional`, `parseBool`, `parsePositiveInt`) and the Postgres connection config. Fails closed on a missing required value. |
| `check-database-url.ts`, `db-preflight.ts` | A deploy-time preflight that proves the database connection string lets a service boot before a machine is replaced. |
| `db.ts` | The `pg` pool and `withTransaction`. |
| `http-hygiene.ts` | Rate limiting, CORS and security headers for any public endpoint. |
| `monitor.ts` | The `Monitor` seam: counters, gauges, alerts. Logs by default. |
| `prometheus.ts` | The Prometheus sink and the `/metrics` exposition. |
| `metrics.ts` | The metric and alert name registry, and which metrics may alert. |
| `metrics-listener.ts` | The private `/metrics` listener and the sink selection for a deployment. |
| `events.ts` | Generic Anchor `emit!` decoding — discriminators, `Program data:` extraction, the layout registry. |
| `blotto-events.ts` | **The wire contract.** One layout per `#[event]` struct in the program (28 today), mirrored field-for-field in declaration order. There is no committed IDL, so these decoders *are* the contract; `scripts/check-mirrors.py` fails CI when they and the Rust disagree. Decoders are length-aware where an event has grown (for example `PoolSealed`'s `pot_lamports`/`reason`, the `mode` byte on `PoolOpened`), so older recorded events still replay. |
| `config-account.ts` | The `Config` account's byte layout, decoded by fixed offset and shared by the daemon and the indexer. |
| `pool-account.ts` | The `Pool` account's size guard and head fields (id, tier, pot, entrants, deadline, state, mode), shared by the daemon and the watcher (R23). |
| `cluster.ts` | The one place a service learns which cluster it runs against. Unset means devnet; mainnet requires an explicit endpoint. |
| `attestation-message.ts` | The exact bytes a wallet signs for the entry terms acceptance (D-B4) — built by the app and rebuilt by the packet service to verify. |
| `env-number.ts` | Numeric environment variables that fail fast, because `Number('')` is `0` and `Number(undefined)` is `NaN`. |
| `priority-fee.ts` | The shared priority-fee choice, so the daemon bids what the browser bids. |
| `short.ts` | The truncations applied to identifiers before they reach a log line or an alert. |
| `index.ts` | The package's public surface. |

## Migrations

`migrations/` holds the forward-only Postgres schema (`0001_events_ledger.sql` onwards). Its
conventions, including the `rederive-required` marker that makes a derived-table change rebuild
before the site serves, are in [`migrations/README.md`](migrations/README.md).

**Never edit an applied migration.** New schema is a higher-numbered file. The `postgres` job of
`ci-fast` applies every file to an empty database on every change and drives every store against
the resulting schema.

## Testing

```bash
npm run typecheck
npm test
```
