# Hosting — topology and deployment

This document covers where Blotto Cup runs and how each part is deployed. It includes the
go-live checklist and the map of vendors. For running a live deployment (admin transactions,
upgrades, incidents), see [`OPERATING-MANUAL.md`](OPERATING-MANUAL.md).

The product is **one Next.js app on Vercel**, **four backend services on Fly.io** and **one
Postgres database**. The services and the database run in the EU (Frankfurt, Fly region `fra`).
Everything deploys from this repository. The services run TypeScript directly, so there is no
build step beyond installing dependencies.

Hostnames below are placeholders: `https://<indexer-host>`, `https://<packet-host>`,
`https://<review-host>`, `https://<daemon-host>` and `https://<app-domain>`. The Fly app names are
set in `deploy/fly/*.fly.toml`.

**Contents**

1. [Topology](#topology)
2. [Health checks](#health-checks)
3. [Local and staging: docker compose](#local-and-staging-docker-compose)
4. [Deploying the backend to Fly](#deploying-the-backend-to-fly) — Steps 1–6
5. [Deploying the app to Vercel](#deploying-the-app-to-vercel)
6. [The RPC provider's webhook](#the-rpc-providers-webhook)
7. [Sign-in provider settings](#sign-in-provider-settings)
8. [Go-live checklist](#go-live-checklist)
9. [Vendor map](#vendor-map)
10. [Known limitations](#known-limitations)

---

## Topology

| Service | Entry | Ports | Health | Needs |
|---|---|---|---|---|
| **indexer** | `backend/indexer` → `src/index.ts sync` | 8080 webhook · 8081 read API | `GET /health` on both | Postgres, RPC, webhook secret |
| **packet** (the entry gate) | `backend/packet` → `src/main.ts` | 8082 | `GET /health` | Postgres, entry signer (Turnkey), geo vendor, sanctions source, `config/territories.json`, `config/terms.json`, `config/blocked-wallets.json` |
| **review** | `backend/detection` → `src/main.ts` | 8083 | `GET /health` | Postgres, `config/reviewers.json`, settlement keypair, RPC |
| **daemon** (keeper and crank) | `backend/reveal` → `src/main.ts` | 8084 (health only) | `GET /health` (reports the last tick) | Postgres, settlement keypair, Turnkey custody, Irys upload wallet, Switchboard queue, sanctions source, RPC |
| **app** | `app/` on Vercel | 443 | the site loads | The three service URLs, the RPC URL, the sign-in provider |

Each service also serves a Prometheus metrics endpoint on port 9090. That port is reachable only
over Fly's private network. Fly routes each service's `internal_port`, and nothing else.

**Where the money path runs.** An entry's payment goes from the player's wallet straight to the
program in one transaction. The packet service authorises the entry and the RPC relays it. No
service of ours is on the payment path.

**The indexer owns the schema.** Every service reads `BLOTTO_DATABASE_URL`. The indexer's `sync`
command, which is what its container runs, applies pending migrations. When a migration
invalidates a derived table, it rebuilds that table **before** the read API answers. Deploying
the indexer therefore needs no separate migrate step. The other three services apply nothing and
assume the indexer has run. To move the schema without starting the service, run
`npm --prefix backend/indexer run migrate`.

**Every credentialed seam fails closed.** A service missing its signer, geo vendor, custody,
sanctions source or upload wallet refuses to start, or refuses the request, with an explicit
message. That is the design, not a deploy bug.

## Health checks

All four services answer `GET /health` with `{ ok: true, … }`.

The daemon's payload adds:

- `ready`, which is `false` while it is still starting;
- `phase`;
- `settlementSol`;
- `lastTick`, with `at` and counts of pools opened, cranked, refunded, held and published, plus
  errors.

It answers **503** in two cases:

- it is still starting after five minutes (`STARTUP_BUDGET_MS`);
- it is ready but has not completed a tick in fifteen minutes (`STALE_TICK_MS`,
  `backend/reveal/src/health.ts`).

Either way, Fly's check restarts a stuck loop and the `backend-watch` workflow reports it
([`OPERATING-MANUAL.md` §9](OPERATING-MANUAL.md#9-monitoring)).

**A green `/health` is not proof that the database works.** Only the indexer's boot path touches
the database before it serves. The deploy workflow therefore proves the database URL separately
before replacing any machine (Step 5).

## Local and staging: docker compose

`docker-compose.yml` runs Postgres plus the four services, each built from
`deploy/docker/Dockerfile.*` with the repository root as build context. The step-by-step local
setup, including which variables each path needs, is in
[`GETTING-STARTED.md`](GETTING-STARTED.md). The points that matter for hosting:

- **The read path is `docker compose up --build postgres indexer`.** The packet, review and
  daemon containers need their credentialed seams: an entry signer, custody, an upload wallet,
  and the settlement keypair. Compose does not pass `ALLOW_DEV_ENTRY_SIGNER`, so even the packet
  service needs real Turnkey values to start. Without its credentials, a container exits at
  startup with a message naming what is missing.
- **`.env` at the repository root belongs to compose.** No service loads a dotenv file. A
  variable reaches a container only if `docker-compose.yml` names it in that container's
  `environment:` block.
- **`BLOTTO_HELIUS_WEBHOOK_SECRET` must be non-empty before the first `up`.** Compose's `:?`
  refuses an empty value. Locally, any string works.
- **CORS.** Compose passes `BLOTTO_API_CORS_ORIGINS` through to the indexer and packet
  containers. Unset means no CORS headers (`backend/_shared/src/http-hygiene.ts`). For a
  browser-driven local run, set `BLOTTO_API_CORS_ORIGINS=http://localhost:3000` in `.env`.
- **Cluster.** Compose does not pass `BLOTTO_CLUSTER`, so every container runs against devnet.

- **Cluster.** Leaving `BLOTTO_CLUSTER` unset means devnet, which is what a local stack wants. Set
  `BLOTTO_RPC_URL` to use a private RPC instead of the public endpoint.
- The daemon and the review service need their credentialed seams. Without them their containers
  exit at startup with a message saying so.

## Deploying the backend to Fly

The backend is deployed by `.github/workflows/deploy-backend.yml`, which you run by hand from the
Actions tab. **It is never triggered by a push**, because deploying is a decision, not a side
effect of merging. It deploys the indexer first, then the packet service, the daemon and the
review service. It stages only credentials that already exist as repository secrets. **It never
creates one.** Falling back to a development credential is an explicit, audited tick-box.

### Step 1 — Fly account and apps

Create a Fly.io account. The first run of the workflow creates the four apps from
`deploy/fly/*.fly.toml` if they do not exist, and gives each app public IPs. Fly app names are
global, so if a name is taken, change `app =` in the `.fly.toml`.

### Step 2 — Create the Fly org token

**The workflow needs an organization token.** A personal access token stops authenticating as
soon as any organization on the account requires single sign-on, and it keeps appearing
unrevoked in the dashboard, so nothing there looks wrong. The dashboard may not offer an org
token, so use the CLI:

```bash
fly auth login
fly orgs list                      # note the slug of the org that owns the apps
fly apps list                      # the four apps should be listed (after the first run)
fly tokens create org --org <org-slug> --name deploy-ci
```

Copy the **whole** output, **including the leading `FlyV1 ` and its space**. A copy that starts
at `fm2_` fails exactly like a rejected token. Paste it only into the GitHub secret field (Step 4).

The workflow's first Fly step checks the token (`fly apps list`). If Fly rejects it, the step
stops with a message pointing here, and nothing is deployed.

### Step 3 — The database

Use a managed Postgres in an EU region. The live deployment uses Neon in Frankfurt. Copy the
connection URI and **end it with `sslmode=verify-full`**. The reason is in
[`OPERATING-MANUAL.md` §7](OPERATING-MANUAL.md#a-deploy-refused-on-the-database-url).

### Step 4 — Set GitHub Actions secrets and variables

Go to **Repository → Settings → Secrets and variables → Actions**. GitHub encrypts secrets, and
the workflow can use them but no one can read them back. The run's preflight reports every
missing secret **by name**.

**Always required**

| Name | Kind | Value |
|---|---|---|
| `FLY_API_TOKEN` | secret | The org token from Step 2 |
| `BLOTTO_DATABASE_URL` | secret | The connection URI from Step 3 |
| `BLOTTO_HELIUS_WEBHOOK_SECRET` | secret | The exact string in the RPC provider webhook's Auth header ([below](#the-rpc-providers-webhook)). The run proves the indexer accepts it |
| `BLOTTO_DEVNET_RPC_URL` | secret | A **devnet** RPC URL (it carries an API key). The run refuses one that looks like mainnet |
| `BLOTTO_APP_ORIGINS` | **variable** | Every browser origin the services may answer, comma-separated, each `https://…` with **no trailing slash**: the domain, its `www` form, and the Vercel address. A missing origin makes the location check fail closed, and every visitor from it sees "not available in your region" |

**Packet service**

| Name | Source |
|---|---|
| `TURNKEY_API_BASE_URL`, `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY` (shown once), `TURNKEY_ORGANIZATION_ID` | The Turnkey console |
| `ENTRY_SIGNER_KEY_ID`, `ENTRY_SIGNER_PUBLIC_KEY_HEX` | The Turnkey entry-signer key |
| `GEO_VENDOR_URL`, `GEO_VENDOR_API_KEY` | The geo vendor |
| `SANCTIONS_CHAINALYSIS_API_KEY`, `SANCTIONS_OPENSANCTIONS_API_KEY` | Optional. They add sources beside the OFAC SDN mirror, which every run stages without a credential |
| `EMAIL_API_URL`, `EMAIL_API_KEY` (secrets) and `EMAIL_FROM` (variable) | Optional, and all three or none. They switch on the one-message opt-in |

**Daemon and review service**

| Name | Source |
|---|---|
| `TURNKEY_USER_ID` | The Turnkey console (sealing custody) |
| `SWITCHBOARD_QUEUE` | The Switchboard On-Demand queue address. This is public configuration, not a credential |
| `IRYS_UPLOAD_KEY` | The funded upload wallet's secret key, base58 |
| `SETTLEMENT_SIGNER_KEYPAIR_B64` | The settlement keypair file, base64 on one line. It is decoded into memory-backed storage at boot |
| `BLOTTO_REVIEW_OPERATOR_TOKEN` | Optional secret. It switches on the reviewer's detection and complaints queues. It is an operator secret and must never reach a browser bundle |
| `BLOTTO_MAX_UNREADABLE_ENTRIES` | Optional variable: the daemon's ceiling on unreadable entries. Set by the operator |
| `BLOTTO_IRYS_UPLOAD_ADDRESS` | Optional variable: the upload wallet's public key, for the archive's last-resort query |

### Step 5 — Run the deploy

**Two things must be true before anything is deployed.** The workflow's first job
(`scripts/ci-gate.sh`) checks both:

1. **It runs from `main`.** From any other ref it stops at once. There is no override. To deploy
   a branch, merge it first.
2. **The tests for that exact commit passed.** It finds the `ci-fast` result for the commit. If
   the result is still running, it waits up to about ten minutes. If the tests failed or never
   ran, it stops. It also stops if the on-chain lane ran for that commit and failed.

A refusal is a red first step within a minute or so, and nothing on any app changes.

Then:

1. **Actions → deploy-backend → Run workflow**, with the branch on `main`.
2. Leave **`allow_dev_credentials`** unticked. When ticked, it falls back only where a
   production credential is missing: a development entry-signer seed, or a geo stub that admits
   every address. It warns by name for each fallback, and it never replaces a credential that is
   already real.
3. Leave **`deploy_despite_red_ci`** unticked. It overrides only the test half of the gate, and
   the run records that you chose it. It never overrides the `main`-only rule.

**What the run checks, in order:**

- the operator-identity file (`scripts/check-operator-identity.ts`, which refuses a mainnet
  deploy while any value is unset);
- that Fly accepts the token;
- that every credential is present;
- that the RPC is not mainnet and the origins are well formed;
- **that the database URL actually connects** ([`OPERATING-MANUAL.md` §7](OPERATING-MANUAL.md#a-deploy-refused-on-the-database-url)).

Then it creates any missing apps and IPs, stages secrets, and deploys the four services. After
that it asserts:

- every machine is started;
- the daemon reached `"ready":true`;
- every service answers its smoke check;
- the indexer's ingest port answers and **accepts the staged webhook secret**. A `401` here turns
  the run red, because live ingest would otherwise stay shut;
- the deployed program still matches this commit (the same check as the `deployed-drift`
  workflow).

**The acceptance line.** The final step prints which signer and which randomness source each
service chose. A credentialed run reads `entry signer = TURNKEY`, has **no `GEO STUB` line**,
and reads `VRF = SWITCHBOARD On-Demand`. Anything else means a development path is live even
though the run is green.

**Troubleshooting**

| What you see | What it means |
|---|---|
| `Unauthorized` / "You must be authenticated" in the Fly step | The token type is no longer accepted. Create an org token (Step 2) and update the secret |
| "name is taken" | Fly app names are global. Rename the app in `deploy/fly/` |
| "timeout reached waiting for health checks" | The service is crashing at boot. `backend-status`, or the app's monitoring page on Fly, shows the error |
| Red on the ingest check with 401 | The secret in `BLOTTO_HELIUS_WEBHOOK_SECRET` differs from the webhook's Auth header |
| Red on the ingest check with no answer | Port 8080 is unreachable from outside. Shared Fly IPv4 addresses route only 80 and 443, so the indexer needs a dedicated IPv4 |
| Red on the deployed-program comparison | The program and the backend are out of step. Upgrade whichever is behind |

### Step 6 — Point the app at the services

In Vercel, set `NEXT_PUBLIC_INDEXER_URL`, `NEXT_PUBLIC_ENTRY_API_URL` and
`NEXT_PUBLIC_REVIEW_API_URL` to `https://<indexer-host>`, `https://<packet-host>` and
`https://<review-host>`, then **redeploy the app**. The full list is in the next section.

## Deploying the app to Vercel

The app lives in `app/`, but it bundles TypeScript straight from sibling packages under
`backend/` and reads `config/`. The backend sources' own dependencies resolve from **their**
directories, not the app's. **A default "Root Directory = app" project therefore fails to
build**, because the parent files are outside the build root.

**Project settings (one-time):**

1. **Root Directory** = `app`.
2. Turn on **"Include source files outside of the Root Directory"**. Without it, `../backend`
   and `../config` are not in the build container at all.
3. Set the environment variables below.

Everything else is committed. `app/vercel.json` sets the framework and an `installCommand` that
installs each backend package the app imports (with dev dependencies, which Next's typecheck
needs) before the app itself.

**Environment variables** (Production, and Preview if you want preview links to work). The
names are listed in `app/.env.example`. Every `NEXT_PUBLIC_*` value is compiled into the browser
bundle at build time, so **a change needs a redeploy**, and nothing secret may use that prefix.

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | A devnet RPC URL. It is public, so restrict the key to your domains at the provider if you can |
| `NEXT_PUBLIC_PROGRAM_ID` | `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` |
| `NEXT_PUBLIC_INDEXER_URL` / `NEXT_PUBLIC_ENTRY_API_URL` / `NEXT_PUBLIC_REVIEW_API_URL` | The three service URLs. Without the indexer URL, a production build serves no data rather than sample data |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID` | From the sign-in provider |
| `NEXT_PUBLIC_DEVNET_FAUCET` | `1` on devnet: the "Get test SOL" link. Testers cannot pass the balance check without it |
| `REVIEW_OPERATOR_TOKEN` | **Server-side only.** The review service's operator token, used by the app's reviewer routes |
| `GATE_CODE`, `GATE_COOKIE_SECRET`, `GATE_HOSTS` | The optional pre-launch access gate |

These must stay **unset** on any site people can reach:

- `NEXT_PUBLIC_ALLOW_TEST_SIGNER`, which lets a script sign as any wallet;
- `NEXT_PUBLIC_FIXTURE_DATA`, which serves sample tournaments;
- `NEXT_PUBLIC_TOPUP_ENABLED`, because nothing sells devnet SOL.

**Verifying the build locally.** Run it on a clean clone before changing the app's imports or
the install command:

```bash
# 1. The same install vercel.json runs, then the build:
cd app && sh -c "$(node -p "require('./vercel.json').installCommand")" && npm run build
# 2. The Vercel builder itself, from the repository root:
mkdir -p .vercel && printf '{"projectId":"x","orgId":"x","settings":{"framework":"nextjs","rootDirectory":"app"}}' > .vercel/project.json && npx vercel build
```

**Cross-package imports** go through the aliases in `app/tsconfig.json` (`@blotto/scoring`,
`@blotto/shared/*`, `@config/*`, …), mirrored for tests in `app/vitest.config.mts`. Never add a
raw `../../..` import in `app/src`.

## The RPC provider's webhook

The indexer's receiver (`backend/indexer/src/webhook.ts`) validates each delivery before touching
the ledger:

- The `Authorization` header must equal `BLOTTO_HELIUS_WEBHOOK_SECRET` **byte for byte**, using a
  length-checked, timing-safe compare. Anything else gets `401`, and nothing is ingested.
- An unparseable body gets `400`.
- A store failure gets `500`, so the provider redelivers.
- The server does not start without the secret.

Create the webhook in the Helius dashboard (Webhooks) or through its API, with exactly these
settings:

| Setting | Value |
|---|---|
| Webhook URL | `https://<indexer-host>:8080/webhook` (any POST path works, and `/webhook` keeps logs readable) |
| Network | The deployment's cluster (devnet) |
| Webhook type | **Raw**. The parser reads `signature`, `slot` and `meta.logMessages` |
| Transaction types | All. The ingest decoder filters to this program |
| Account addresses | The program id |
| Commitment | `finalized`. It must **match** `BLOTTO_INDEXER_COMMITMENT` (default `finalized`). A mismatch feeds the ledger twice or starves it |
| Auth header | The shared secret, sent verbatim with no `Bearer` prefix. Generate it with `openssl rand -hex 32` |

**Rotation.** Set the new value at the provider first. Then update the repository secret and run
the deploy. Deliveries in between get `401` and are redelivered once both sides agree. The
indexer's reconcile walk (every 15 minutes by default) and its boot-time backfill catch anything
dropped past the retry window.

The webhook only speeds up delivery. The chain is the source of truth, and the ledger rebuilds
from RPC.

## Sign-in provider settings

Sign-in and the embedded wallet come from Privy (`app/src/wallet/privy-bridge.tsx`). Some of its
settings live only in the Privy dashboard. **This repository declares them but cannot enforce
them.**

1. **Allowed domains.** Add `https://<app-domain>`, its `www` form if it is live, and the Vercel
   address. Remove stale entries. If a domain is missing, the site says "Sign-in is not switched
   on for this web address yet".
2. **Login methods.** Google and X are on. Apple is **off**: the app no longer offers it, so do
   not enable it in the dashboard alone. External Solana wallets are listed below.
3. **Embedded wallets → Solana.** Create on login for users without a wallet. Allow key export,
   which the "Move my wallet" flow needs. Leave funding off.
4. **The Solana chain setting.** Set it to **devnet** for a devnet deployment.

### Why wallet sign-in can fail

Sign-in with an external wallet (Phantom, Solflare, Backpack and others) uses a
sign-in-with-Solana message that the provider composes on its server. Captured from the live
page, that message states `Chain ID: mainnet` for an app that is devnet end to end. Phantom
compares that line with the chain it is connected to and refuses to show the request: "the chain
ID does not match the provided chain ID for verification". The provider's own login modal fails
the same way.

**No code in this repository can correct it.** `generateSiwsMessage` takes only an address, and
the SDK has no chain argument for it. The app's `SOLANA_RPCS_CONFIG` declares devnet only, and
that did not change the message. The fix has to come from the provider's configuration or the
provider itself. Until it does, **external-wallet sign-in is hidden** on the sign-in page
(`EXTERNAL_WALLET_SIGNIN_ENABLED` in `app/src/app/signin/signin-client.tsx`). The handlers stay
in place and under test. Restore the flag once the provider issues a devnet chain id, and re-run
the sign-in review against the real domain before saying it works. Social sign-in, with its
embedded wallet, is unaffected.

**The Google consent screen** names the sign-in provider's application, not the product, unless
the operator supplies its own Google OAuth credentials to the provider.

## Go-live checklist

This is the order that works for a devnet deployment on a custom domain. Steps 1 to 3 depend on
each other in sequence. Unpause last, so the first entries land on a site that can show them.

1. **RPC provider.** Create an API key for **devnet**. The app refuses to build with a
   mainnet-looking URL, and the deploy refuses one outright. If a key has ever been exposed,
   delete it. Generate the webhook secret and create the webhook
   ([settings above](#the-rpc-providers-webhook)).
2. **GitHub.** Set the secrets and variables (Step 4), then run `deploy-backend` from `main`
   (Step 5). Check that `GET https://<indexer-host>/pools` shows the chain's pools within minutes,
   and that `GET https://<daemon-host>/health` reads `"ready":true`. If `/pools` is still `[]`
   fifteen minutes later, run **Actions → indexer-backfill** and read its `inserted` count.
3. **Vercel.** Add the domain (Settings → Domains) and create the DNS records it shows. Set the
   variables ([above](#deploying-the-app-to-vercel)). **Redeploy** the newest production
   deployment. Check that `/wallet` and `/fair-play` load on the domain.
4. **Sign-in provider.** Configure allowed domains, login methods, embedded wallets and the
   Solana chain ([above](#sign-in-provider-settings)). Check that social sign-in completes on the
   domain.
5. **Unpause.** Send `set-paused --paused false` as a multisig proposal
   ([`OPERATING-MANUAL.md` §3](OPERATING-MANUAL.md#3-the-admin-cli)).
6. **Testers.** Each needs a devnet wallet holding a little test SOL. The balance check needs the
   entry price plus a margin for fees and rent. Sign-in with Google creates a wallet for them.
   Location is checked by IP against [`config/territories.json`](../../config/territories.json),
   so a VPN may be refused. The terms screen is signed once per wallet per terms version.

**Day-to-day controls**

| To | Do | Effect |
|---|---|---|
| Stop new entries | `set-paused --paused true` (proposal) | Entries are refused on chain. Open pools still settle or refund |
| Resume | `set-paused --paused false` | Entries accepted, and the daemon opens pools again |
| Ship a front-end change | Merge to `main` | Vercel builds `main`. A variable change needs a manual redeploy |
| Ship a backend change | Actions → deploy-backend, on `main` | Manual by design. A pool mid-settlement resumes |
| See what is running | Actions → backend-status | Read-only forensics for all four apps |
| Rebuild the indexer | Actions → indexer-backfill | Idempotent |
| Take the site down | Remove the domain in Vercel | Nothing on chain changes. Prefer pausing |

**If something breaks**

| What a player sees | Usually | Fix |
|---|---|---|
| "not available in your region" for everyone | The origin is missing from `BLOTTO_APP_ORIGINS`, or the packet service is down | Check `https://<packet-host>/health`, fix the variable, and redeploy the **backend** |
| "Sign-in is not switched on for this web address yet" | The domain is not in the provider's allowed domains | Add it. The change is immediate |
| Sign-in buttons disabled, "temporarily unavailable" | The provider app id is missing or rejected in the build | Set the Vercel variable, then redeploy |
| "No tournament is open" while a pool is open | The indexer has no data | `GET /pools`. If it returns `[]`, run indexer-backfill |
| "Entries are paused right now" | The deployment is paused | Unpause |
| "Your wallet is not ready" after sign-in | Embedded wallet creation is off, or the provider is still starting | Check the embedded-wallet setting, then reload once |
| A pool past its deadline that does not refund | The daemon is down | Check `https://<daemon-host>/health`. Refunds are also permissionless ([`OPERATING-MANUAL.md` §6](OPERATING-MANUAL.md#6-the-daemon-keeper-and-crank)) |

## Vendor map

What each outside service does, what talks to it, and what happens when it fails.

| Vendor | Job | Talks to | Configured by | When it fails |
|---|---|---|---|---|
| **Vercel** | Hosts the Next.js app and builds `main` on every merge. Serves server-side reads of the indexer. The verify page runs the scoring engine in the browser | Browser, indexer | Project settings (above) | The site is down. Nothing on chain or in the services changes |
| **Privy** | Social sign-in (Google, X), the embedded Solana wallet created at a social sign-in, key export, and external-wallet sign-in (hidden, see above) | Browser only | `NEXT_PUBLIC_PRIVY_*`, the provider dashboard | Sign-in stops working. The site still renders |
| **Helius** | The RPC for every read and send (browser, daemon, review, indexer backfill), and the webhook that pushes finalized program transactions to the indexer | Browser, services, Solana | `NEXT_PUBLIC_SOLANA_RPC_URL`, `BLOTTO_DEVNET_RPC_URL`, `BLOTTO_HELIUS_WEBHOOK_SECRET` | Browsers cannot read balances or send. The daemon stalls (its `lastTick.at` goes stale). The indexer catches up from RPC afterwards |
| **Fly.io** | Four machines in Frankfurt, one app per service | Postgres, RPC, the vendors below | `deploy/fly/*.fly.toml`, plus secrets staged by the deploy workflow | Each service fails closed on its own |
| **Neon** (managed Postgres, Frankfurt) | The event ledger and projections (indexer); attestations, notification preferences and ciphertexts (packet); the signed review log and complaints (review); published pool keys (daemon) | Every service | `BLOTTO_DATABASE_URL` | Every service degrades. The read API errors, packets are refused, ticks fail |
| **IPLocate** | The country and VPN/proxy verdict per IP behind the territory check, cached per IP for 15 minutes | Packet service | `GEO_VENDOR_URL`, `GEO_VENDOR_API_KEY` | Every entry is refused (fail-closed). A quota response is logged as a lookup failure, not a territory decision |
| **Sanctions sources** | A mirrored OFAC SDN list (no credential; it refuses to answer once stale), plus optional Chainalysis and OpenSanctions. Every entrant is screened at entry, and every winner at settlement | Packet service, daemon | `SANCTIONS_*` | With no source configured, the service does not start. At settlement, an unanswerable screening holds the share |
| **Turnkey** | The entry signer (Ed25519, cannot be exported) and custody of each pool's sealing secret (export-locked until the pool closes) | Packet service, daemon | `TURNKEY_*`, `ENTRY_SIGNER_*` | No packets, so no entries. A pool cannot be revealed, so settlement waits |
| **Switchboard On-Demand** | One randomness account per pool, whose reveal is bundled with `commit_vrf_seed`. It feeds the cosmetic class draw and nothing in scoring | Daemon (through the RPC), the program | `SWITCHBOARD_QUEUE` | A pool cannot take entries until its seed is committed. The daemon retries |
| **Metaplex Core** | The pass collection for each pool, and one frozen pass per entry | The program | A pinned program address | Entries fail if the collection is missing. The daemon creates it at open |
| **Irys** | Stores the published results bundle for each settled pool. The verify page fetches it | Daemon | `IRYS_UPLOAD_KEY`, `IRYS_NETWORK` | Payment still happens. The bundle is published on a later tick |
| **Squads** | The admin multisig. Every admin instruction is a Squads transaction | The program | [`config/custody.json`](../../config/custody.json) records it | Admin instructions cannot land. Pools keep running |
| **Mail provider** (optional) | The one-message notification to players who opt in. The address is resolved through the sign-in provider at send time | Packet service | `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM` | Off unless all three are set. Nothing else depends on it |
| **GitHub Actions** | CI on every change, the manual `deploy-backend`, `backend-watch` every 15 minutes, and `deployed-drift` and the archive backfill daily | Fly, the chain (read-only simulation) | `.github/workflows/` | Nothing live changes. Deploys and probes stop |
| **Solana** | The program, its PDAs, rent and fees. Players pay their own entry and pass rent. The keeper wallet pays each pool's open, randomness, collection and settlement transactions | Everything above | `declare_id!` | — |

The services also read operator-owned files from the repository rather than from a vendor:
`config/territories.json`, `config/terms.json`, `config/reviewers.json`,
`config/blocked-wallets.json` and `config/custody.json`.

## Known limitations

- **Public API hardening is off unless configured.** Rate limiting, CORS and security headers
  are three separate switches, and all three default to off (`backend/_shared/src/http-hygiene.ts`).
  `deploy-backend` turns all three on for the indexer, the packet service and the review service,
  with the CORS allowlist taken from `BLOTTO_APP_ORIGINS`. A deployment made any other way, such
  as with compose or by hand with `fly deploy`, must set them itself. The rate-limit numbers are
  proposals, not ratified values. [`../security/SECURITY-REVIEW.md`](../security/SECURITY-REVIEW.md)
  tracks this.
- **External-wallet sign-in is hidden** until the sign-in provider issues a devnet chain id
  ([above](#why-wallet-sign-in-can-fail)).
- **Nothing scrapes the metrics endpoint yet**, and no alert destination is configured. Alerts
  are log lines plus a counter.
- **A KYC provider is not connected.** The on-chain KYC switch is off.
