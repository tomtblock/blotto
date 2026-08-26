# backend/_shared

Shared off-chain infrastructure: environment and config loading, the Postgres
block, HTTP hygiene for any public endpoint, the metrics and alert seam, and the
generic half of the Anchor event decoder.

**Carried from the predecessor repository.** This is the plumbing the sealing store
(`../sealing/`) and the detection pipeline (`../detection/`) will need, extracted
before either exists so that neither invents its own.

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
| `events.ts` | Anchor `emit!` decoding — discriminators, `Program data:` extraction, the layout registry. **No event layouts are registered yet.** |

## What was deliberately NOT carried

The predecessor's `events.ts` also held decoders for six of its own events; its
a second module held its progression maths; a third decoded that product's wallet
accounts. All three describe a product that no longer exists and
none was carried. `events.ts` here keeps only the generic mechanism and a
`TODO(phase-2)` naming the events in TECH-ARCH §3.3.

## Migrations

`migrations/` holds the forward-only schema. Conventions are in
`migrations/README.md`; the only migration Phase 0 ships is
`0001_events_ledger.sql`, the generic event ledger.

**Never edit an applied migration.** New schema is a higher-numbered file.

## Testing

```bash
npm run typecheck
npm test
```
