# backend/_shared

Shared off-chain infrastructure: environment and config loading, the Postgres
block, HTTP hygiene for any public endpoint, the metrics and alert seam, and the
generic half of the Anchor event decoder.

**Carried from the predecessor repository** and extracted before the sealing
store (`../sealing/`) or the detection pipeline (`../detection/`) existed, so
that neither would invent its own. Both exist now, and so do seven more
packages; all nine import this one.

Consumed as co-located TypeScript source — no build step, no workspace linkage.
Each service re-exports it through a single `src/shared.ts`, so an infrastructure
change can swap in real package resolution without touching a consumer.

## What is here

| Module | What it is |
|---|---|
| `config.ts` | Env parsing (`required`, `optional`, `parseBool`, `parsePositiveInt`) and the Postgres connection config. Fail-closed on a missing required value. |
| `db.ts` | The `pg` pool and `withTransaction`. |
| `http-hygiene.ts` | Rate limiting, CORS, security headers — for any public endpoint. |
| `monitor.ts` | The `Monitor` seam: counters, gauges, alerts. Logging by default. |
| `prometheus.ts` | The Prometheus sink and the `/metrics` exposition. |
| `metrics.ts` | The metric and alert name registry, and which metrics may alert. |
| `events.ts` | Anchor `emit!` decoding — discriminators, `Program data:` extraction, and the generic layout registry. Product-agnostic. |
| `blotto-events.ts` | **The wire contract.** One layout per `#[event]` struct in the program, mirrored field-for-field in declaration order. There is no committed IDL, so these decoders *are* the contract; `scripts/check-mirrors.py` fails CI when they and the Rust disagree. Decoders are length-aware where an event has grown, so events recorded before a field was appended still replay. |
| `blotto-events.ts` (cont.) | Twenty-six layouts as of 2026-09-13, including `PoolSealed`'s appended `pot_lamports` and `reason`. |
| `config-account.ts` | The `Config` account's byte layout — one TypeScript copy, decoded by fixed offset, shared by the daemon and the indexer rather than duplicated. |
| `cluster.ts` | The one place a service learns which cluster it runs against. Unset means devnet; mainnet requires an explicit endpoint. |
| `attestation-message.ts` | The exact bytes a wallet signs for the D-B4 clickwrap — one definition, browser-bundleable, built by the app and rebuilt by the packet service to verify. |
| `env-number.ts` | Numeric environment variables that fail fast, because `Number('')` is `0` and `Number(undefined)` is `NaN` and neither is what a config file meant. |
| `metrics-listener.ts` | The private `/metrics` listener and the sink selection that makes the Prometheus path actually reachable in a deployment. |
| `priority-fee.ts` | The shared priority-fee choice, so the daemon that moves money bids what the browser bids. |
| `index.ts` | The package's public surface. |

## What was deliberately NOT carried

The predecessor's `events.ts` also held decoders for six of its own events; a
second module held its progression maths; a third decoded that product's wallet
accounts. All three describe a product that no longer exists and none was
carried. `events.ts` here keeps only the generic mechanism; this repository's
own layouts live beside it in `blotto-events.ts`.

## Migrations

`migrations/` holds the forward-only schema — twenty-two files as of
2026-09-13, from `0001_events_ledger.sql` onwards. The conventions, and the
`rederive-required` marker that makes a derived-table change rebuild before the
site serves, are in `migrations/README.md`.

**Never edit an applied migration.** New schema is a higher-numbered file. The
`postgres` job of `ci-fast` applies every file from an empty database on every
change and then drives every store against the schema that produced.

## Testing

```bash
npm run typecheck
npm test
```
