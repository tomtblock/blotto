# Hosting (E5) — topology, images, health, and the runbook

The product runs as **one Next.js app on Vercel** (docs/deploy-vercel.md)
plus **four backend services and one Postgres** in the EU (TECH-ARCH §11:
Frankfurt/Dublin, never US). Everything below deploys from this repository
with no build step beyond `npm ci` — the services run ts-node directly.

## Topology

| Service | Entry | Ports | Health | Needs |
|---|---|---|---|---|
| indexer | `backend/indexer` → `src/index.ts sync` | 8080 webhook · 8081 read API | `GET /health` on both | Postgres, Helius webhook secret |
| packet | `backend/packet` → `src/main.ts` | 8082 | `GET /health` | Postgres, entry signer (Turnkey or dev seed), geo (vendor or dev stub), `config/territories.json` + `config/terms.json` |
| review | `backend/detection` → `src/main.ts` | 8083 | `GET /health` | Postgres, `config/reviewers.json`, settlement keypair, RPC |
| daemon | `backend/reveal` → `src/main.ts` | 8084 (health only) | `GET /health` (reports the last tick) | Postgres, settlement keypair, Turnkey custody, Irys wallet, Randomness account, RPC |

Every service reads `BLOTTO_DATABASE_URL` and applies nothing itself — run
migrations once per deploy (`npm --prefix backend/indexer run migrate`,
also step 3 of `scripts/deploy-devnet.sh`).

Every credentialed seam **fails closed**: a service missing its signer,
geo vendor, custody or upload wallet refuses to start (or refuses the
request) with an explicit message. That is the design, not a deploy bug.

## Local / staging: docker compose

```bash
cp backend/.env.example .env    # fill what you have; see fail-closed note
docker compose up --build postgres indexer packet   # the read path
docker compose up --build                           # everything
```

Compose builds the four images in `deploy/docker/Dockerfile.*` (build
context is the repo root — the packages cross-import by relative path, so
each image carries the whole backend tree plus `config/`).

## Fly.io (production shape)

The founder-facing, no-terminal version of this section is
`docs/deploy-backend.md` + the `deploy-backend` GitHub Action (indexer +
packet, secrets from the repository's Actions secrets, dev stubs per that
runbook's small print).

One Fly app per service, all `primary_region = "fra"` (Frankfurt):

```bash
fly launch --no-deploy --config deploy/fly/indexer.fly.toml   # once per app
fly secrets set BLOTTO_DATABASE_URL=... BLOTTO_HELIUS_WEBHOOK_SECRET=... -a blotto-indexer
fly deploy --config deploy/fly/indexer.fly.toml
```

- Postgres: a managed EU instance (Fly Postgres in `fra`, or Supabase/Neon
  EU) — set `BLOTTO_DATABASE_URL` as a secret on every app.
- The indexer app serves the read API as its main HTTP service and the
  Helius webhook on a second service (port 8080) — both health-checked.
- Keypair files (settlement signer) mount via Fly secrets as base64 →
  written to `/run/secrets` by a release command, or use `fly secrets set
  SETTLEMENT_SIGNER_KEYPAIR=/path` with a volume; the compose file shows
  the same read-only mount shape.
- The app on Vercel points at these: `NEXT_PUBLIC_INDEXER_URL` → the
  indexer app's public URL, `NEXT_PUBLIC_ENTRY_API_URL` → the packet
  app's, `NEXT_PUBLIC_REVIEW_API_URL` → the review app's.

## Health checks

All four services expose `GET /health` returning `{ ok: true, ... }`.
The daemon's additionally carries the LAST TICK summary (`at`, counts of
opened/cranked/refunds/errors) — a stale `at` is the "hung RPC" alarm;
platform checks should alert on staleness, not just non-200.

## Creating the Helius webhook (E6)

The indexer's receiver validates every delivery before touching the
ledger (`backend/indexer/src/webhook.ts`): the `Authorization` header must
equal `BLOTTO_HELIUS_WEBHOOK_SECRET` **byte-for-byte** (length-checked,
timing-safe compare); anything else is `401` with nothing ingested, an
unparseable body is `400`, and a store failure answers `500` so Helius
redelivers. The server starts only when the secret is set
(`requireWebhookSecret` — fail-closed). Spec-pinned in
`backend/indexer/test/webhook.spec.ts`.

Create the webhook (Helius dashboard → Webhooks, or the API) with exactly:

| Setting | Value |
|---|---|
| Webhook URL | `https://<indexer-host>:8080/webhook` (the receiver accepts any POST path; use `/webhook` for log legibility) |
| Webhook type | **Raw** (the parser reads `signature` / `slot` / `meta.logMessages` from raw-transaction deliveries) |
| Transaction types | All (the program's events ride log messages; the ingest decoder filters to this program) |
| Account addresses | the program id — `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` |
| Commitment | `finalized` — must MATCH `BLOTTO_INDEXER_COMMITMENT` (default `finalized`); a mismatch double-feeds or starves the ledger |
| Auth header | the generated secret — the same value as `BLOTTO_HELIUS_WEBHOOK_SECRET`, sent verbatim (no `Bearer` prefix) |

Rotation: set the new value in Helius first, then update the service's
secret and restart — deliveries in between answer 401 and Helius
redelivers them once the values agree; the backfill on the next `sync`
start catches anything dropped past the retry window.

The webhook is delivery optimisation, not truth: the ledger rebuilds from
RPC via `backfill`, and `sync` runs one backfill before serving.

## Vendor needs (the open list)

| Need | Blocks | Where it lands |
|---|---|---|
| Helius webhook + API key | indexer ingest | `BLOTTO_HELIUS_WEBHOOK_SECRET`, webhook creation settings in E6's section of this doc |
| Turnkey org (entry signer, custody user) | packet signing, daemon custody | `TURNKEY_*`, `ENTRY_SIGNER_*` |
| Geo vendor (R2) | packet issuance in production | `GEO_VENDOR_URL/_API_KEY` |
| Irys funded wallet | bundle publishing | `IRYS_UPLOAD_KEY` |
| Switchboard On-Demand queue (public config, not a credential) | VRF commit on live devnet | `SWITCHBOARD_QUEUE` — the production coordinator (`backend/reveal/src/vrf-switchboard.ts`) creates a fresh Randomness account per pool and bundles the reveal with `commit_vrf_seed`; `RANDOMNESS_ACCOUNT` selects the tests/bench stub instead; the daemon refuses to start with neither |
| Mail provider (founder's pick) | D3 email notifications | a dispatch job reading `notify_optin`, resolving addresses via the sign-in provider |
| Sanctions screening — vendor keys (optional beside the mirror) | a second and third source at entry; the winner check at resolving (Stage F) | `SANCTIONS_CHAINALYSIS_API_KEY`, `SANCTIONS_OPENSANCTIONS_API_KEY`. The mirrored OFAC SDN list (`SANCTIONS_OFAC_SDN=1`) needs no credential and is staged on every deploy, so entry screening is live without a vendor; the packet service refuses to start with no source at all |

## Sequencing (first devnet bring-up)

1. Postgres up; `scripts/deploy-devnet.sh` (build, extend-if-needed,
   deploy, migrate, re-derive).
2. `scripts/admin.ts init-config` + `fund-platform-wallet` +
   `set-open-tiers` (docs/devnet-rehearsal.md step 2).
3. indexer up (webhook + read API), Helius webhook created (E6 settings).
4. packet up; app deployed with the three `NEXT_PUBLIC_*` URLs.
5. daemon up (opens the first pool once the treasury covers tier 0);
   review up when reviewers are configured.
