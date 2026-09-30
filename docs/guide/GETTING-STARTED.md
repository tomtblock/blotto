# Getting started

How to get Blotto Cup running on your own machine, build and test the program, and run every check
CI runs. Three ways to run it, in increasing order of what they need:

| Path | What you get | Needs |
|---|---|---|
| [1. The app on fixtures](#path-1--the-app-on-fixtures) | Every page on screen with deterministic sample data | Node only. No credentials, no database, no Docker |
| [2. The backend on Docker](#path-2--the-backend-on-docker) | The app reading a real indexer and Postgres, following devnet | Docker |
| [3. Enter a devnet pool](#path-3--enter-a-devnet-pool-from-a-local-app) | A real entry from a local app | Path 2, an entry service whose key the program recognises, a sign-in app, a devnet wallet |

What the product does is in [How it works](HOW-IT-WORKS.md); how it is built is in
[Architecture](../architecture/ARCHITECTURE.md).

---

## Prerequisites

Versions are the ones CI uses (`package.json`, `.github/workflows/ci-fast.yml`,
`.github/workflows/on-chain.yml`).

| Tool | Version | Needed for |
|---|---|---|
| Node.js | **20** (root `engines`: `>=20`; CI runs 20) | everything |
| npm | ships with Node | every package under `backend/`, `app/` and `tests/` |
| Yarn classic | **1.22.22** (root `packageManager`) | only the root's own dev dependencies (`npm run admin`, `npm run check-deployed`) |
| Python 3 | any current 3.x — standard library only; CI uses the runner's system `python3` | the scoring/packet/randomness oracles and `check-mirrors.py` |
| Docker + Compose v2 | a running daemon | path 2, and the easiest way to get a Postgres for the SQL suite |
| Rust | **1.95.0** (CI's `rust` job) | `cargo fmt`, `cargo clippy`, `cargo test` |
| Solana CLI (Anza) | **3.1.10** | `anchor build` (the SBF toolchain) |
| Anchor CLI | **1.0.2** (`cargo install anchor-cli@1.0.2 --locked`) | `anchor build` |
| gitleaks | 8.30.1 (optional) | the secret scan CI runs on every change |

The program depends on `anchor-lang = "=1.0.2"`, so the Anchor CLI must match. The Solana CLI installs
with `sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.10/install)"` and puts its tools under
`~/.local/share/solana/install/active_release/bin`, which must be on your `PATH`.

---

## Clone and install

```bash
git clone <this repository> blotto && cd blotto
git config core.hooksPath .githooks     # do this first — enables the keypair pre-commit hook
npm run setup                            # installs every backend package, then the app
```

**The hook.** `.githooks/pre-commit` refuses any staged file containing a Solana keypair (a JSON
array of 64 byte values). CI's gitleaks job catches the same shape, but only after the commit exists.

**`npm run setup` is required, not a convenience.** It runs `npm ci` in `backend/_shared`,
`scoring`, `class-digest`, `sealing`, `sanctions`, `reveal`, `indexer`, `packet`, `detection` (in
that order), then in `app/`. The app imports the backend packages' *source files* directly, and
those files resolve their dependencies from each backend package's own `node_modules`. Installing
`app/` alone is never enough: `next dev` fails with `Module not found: Can't resolve
'@turnkey/crypto'` (or a similar package) until every backend package is installed. It takes about
a minute and a half on a warm network.

**Two package managers — do not mix them.** The repository root uses **Yarn** (`yarn.lock`); every
package under `backend/`, `app/` and `tests/` uses **npm** (`package-lock.json`). `npm run setup`
only *runs* a script, so it is safe at the root. Running `npm install` at the root is not: it
rewrites `yarn.lock` and leaves a competing `package-lock.json`. If that has happened:

```bash
git checkout -- yarn.lock && rm package-lock.json
```

If you need the root's dev dependencies (the admin CLI), run `yarn install` at the root.

---

## Path 1 — the app on fixtures

```bash
cd app && npm run dev          # http://localhost:3000
```

No `.env` file is needed. With `NEXT_PUBLIC_INDEXER_URL` unset, a **development** build serves every
read from the in-repo fixture catalogue (`app/src/data/fixture.ts`, built from `scenarios.ts`), so
every page renders without a live tournament. The fixture pool ids make it obvious the data is not
live.

A **production** build with that variable unset serves nothing: every read fails and each page shows
its "live data unavailable" state (`app/src/data/api.ts`). That is deliberate — a deployment that
forgot the variable must never look like "no tournament is open". The one exception is a build
made with `NEXT_PUBLIC_FIXTURE_DATA=1`, which exists for the browser journey tests only.

What path 1 cannot do: sign in or enter a pool.

---

## Path 2 — the backend on Docker

`docker-compose.yml` defines a Postgres 16 plus the four services, each built from
`deploy/docker/Dockerfile.*` with the repository root as build context.

| Service | Port(s) on localhost | Starts without credentials? |
|---|---|---|
| `postgres` | 5432 (user, password and database all `blotto`) | yes |
| `indexer` | 8080 (webhook receiver) · **8081 (read API — the app's data source)** | yes, once the webhook secret is set |
| `packet` (entry service) | 8082 | no — see below |
| `review` | 8083 | no — needs the settlement keypair |
| `daemon` (settlement) | 8084 (health only) | no — needs key custody, an upload wallet and the settlement keypair |

A service that is missing a credential refuses to start with a message naming what is missing. That
is the fail-closed design, not a broken compose file.

### 1. Create the root `.env`

```bash
cp backend/.env.example .env
```

Then edit `.env` and set at least:

- **`BLOTTO_HELIUS_WEBHOOK_SECRET`** — any non-empty string. The compose file declares it
  `${BLOTTO_HELIUS_WEBHOOK_SECRET:?set in .env}`, and `:?` rejects an empty value as well as a
  missing one. The copied example leaves it blank, so without this step *every* `docker compose`
  command — even `up postgres` — stops with `required variable BLOTTO_HELIUS_WEBHOOK_SECRET is
  missing a value`. Locally the value only has to match between sender and receiver; no real
  webhook provider is involved.
- **`BLOTTO_API_CORS_ORIGINS=http://localhost:3000`** — the read API and the entry service answer
  browsers only from origins on this list. Unset means no CORS headers at all (the right default for
  a deployment), and a browser on `localhost:3000` cannot read `localhost:8081`. Server-rendered
  reads do not need it.
- Optionally **`BLOTTO_RPC_URL`** — defaults to the public devnet endpoint, which rate-limits; a
  dedicated devnet RPC URL makes the indexer's catch-up faster.

**Which file is read by what.** Three files, three readers:

| File | Read by | Notes |
|---|---|---|
| `.env` at the repository root | `docker compose` | Interpolated into `docker-compose.yml`'s `environment:` blocks. Only variables that file names reach a container. |
| `app/.env.local` | `next dev` / `next build` | The app's own variables; start from `app/.env.example`. |
| `backend/.env` | **nothing** | No service loads a dotenv file; every service reads its process environment only. To run one outside Docker, export the variables first (`set -a; . ./.env; set +a`). |

`BLOTTO_CLUSTER` is not passed by the compose file, so every container runs against devnet
(`backend/_shared/src/cluster.ts`) — what a local stack wants.

### 2. Start the read path

```bash
docker compose up --build postgres indexer
```

The indexer's container command is `src/index.ts sync`: it applies the database migrations itself,
catches up from devnet, and then serves. There is no separate migrate step. Check it with
`curl http://localhost:8081/health`.

### 3. Point the app at it

Create `app/.env.local`:

```
NEXT_PUBLIC_INDEXER_URL=http://localhost:8081
```

and restart `npm run dev`. `NEXT_PUBLIC_*` values are read when the app starts or builds, so a
change needs a restart. The app now shows the live devnet pools the indexer has seen instead of
fixtures.

### The entry service (`packet`)

The entry service needs three things before it will start, and refuses without each:

| Seam | Development option | Production option |
|---|---|---|
| Entry signer | `ENTRY_SIGNER_SEED_HEX` (32 bytes as hex) **plus** `ALLOW_DEV_ENTRY_SIGNER=1` | the `TURNKEY_*` and `ENTRY_SIGNER_*` set |
| Location check | `GEO_STUB_COUNTRY` **plus** `ALLOW_STUB_GEO=1` (use a country not on `config/territories.json`'s block list) | `GEO_VENDOR_URL` + `GEO_VENDOR_API_KEY` |
| Sanctions screening | `SANCTIONS_OFAC_SDN=1` (the public OFAC list, downloaded at start — needs network; the compose default) or, offline, `SANCTIONS_OFAC_SDN=0` with `SANCTIONS_STUB_LISTED=` + `ALLOW_STUB_SANCTIONS=1` | vendor keys |

**Known limitation:** `docker-compose.yml` does not pass `ALLOW_DEV_ENTRY_SIGNER` into the `packet`
container, so the container starts only with the Turnkey signer. To use the development signer, run
the entry service outside Docker against the compose Postgres:

```bash
cd backend/packet
BLOTTO_DATABASE_URL=postgres://blotto:blotto@localhost:5432/blotto \
BLOTTO_API_CORS_ORIGINS=http://localhost:3000 \
ENTRY_SIGNER_SEED_HEX=$(openssl rand -hex 32) ALLOW_DEV_ENTRY_SIGNER=1 \
GEO_STUB_COUNTRY=<code> ALLOW_STUB_GEO=1 \
SANCTIONS_OFAC_SDN=1 \
npx ts-node --transpile-only src/main.ts          # listens on :8082
```

Keep the seed you use: `npm run check-signer` in `backend/packet`, given the same variables, signs a
test payload and prints the signer's Solana address.

---

## Path 3 — enter a devnet pool from a local app

Entering a pool is a real devnet transaction, so every part of the chain has to line up.

**What must be running**

- **An indexer** (path 2) — the app reads open pools from it, and the entry service resolves pools
  from the database it fills.
- **An entry service whose signing key the program recognises.** The program accepts an entry only
  with a packet signed by the key stored in its on-chain config (`Config.entry_signer`). On the
  project's shared devnet deployment that key is the operator's; a local entry service with your
  own seed produces packets the program rejects. The operator's hosted services only accept requests
  from the operator's own app origin, so a local app cannot use them either. For an end-to-end entry
  from your own machine you therefore need **your own deployment of the program on devnet**,
  initialised with your entry service's address as the entry signer, plus a settlement daemon that
  opens pools. [Operating manual §3](OPERATING-MANUAL.md) ("Bringing it up from nothing") and
  [Devnet rehearsal](DEVNET-REHEARSAL.md) walk through the deploy, `init-config`, treasury funding
  and opening tiers.
- **A sign-in app.** Sign-in uses Privy. Create your own Privy app, allow `http://localhost:3000` as
  an origin in its settings, and put its id in `app/.env.local`. Without it the app logs
  `[auth] NEXT_PUBLIC_PRIVY_APP_ID is not set — sign-in is disabled`.
- **A wallet with devnet SOL** — at least the 0.1 SOL entry plus transaction fees. Devnet SOL is free
  from the Solana faucet; setting `NEXT_PUBLIC_DEVNET_FAUCET=1` shows a link to it on the balance
  screen.

**`app/.env.local` for path 3** (names from `app/.env.example`):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_INDEXER_URL` | `http://localhost:8081` |
| `NEXT_PUBLIC_ENTRY_API_URL` | `http://localhost:8082` |
| `NEXT_PUBLIC_PROGRAM_ID` | the program id you deployed (the project's devnet id is `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`) |
| `NEXT_PUBLIC_PRIVY_APP_ID` | your Privy app id (`NEXT_PUBLIC_PRIVY_CLIENT_ID` optional) |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | optional — defaults to public devnet |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | leave unset (devnet) |
| `NEXT_PUBLIC_DEVNET_FAUCET` | `1`, optional |

The indexer and the entry service must be pointed at the same program id (`BLOTTO_PROGRAM_ID` in the
root `.env`; it defaults to the project's devnet id).

---

**On a phone.** The same deployed site, in an Android emulator's Chrome or inside the Android
package: start at [`mobile/README.md`](../../mobile/README.md) (install the package someone built,
or build it), then [`MOBILE.md` §5](MOBILE.md#5-testing-on-an-emulator-or-a-phone). Building the
package needs the Android SDK and Node 24, which nothing else here does.

## Building and testing the program

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace                     # program unit tests + the 10,000-case vault fuzz

anchor build --ignore-keys                 # builds target/deploy/blotto_cup.so
cd tests/litesvm && cargo test --locked --no-fail-fast   # integration suite against that artifact
```

- **`--ignore-keys`**: without a program keypair on disk (and you should not have the project's),
  Anchor generates a throwaway one whose address cannot match `declare_id!`. The flag skips that one
  check; the artifact still compiles with the source's declared id, which is what the LiteSVM suite
  drives. The deploy script keeps the strict check.
- **LiteSVM** runs the compiled program in-process with no validator. It needs `anchor build` first;
  without `target/deploy/blotto_cup.so` it cannot start. `anchor test` at the root runs the same
  suite (`Anchor.toml` `[scripts] test`).
- CI runs the build and this suite in the separate `on-chain` workflow, which triggers on changes to
  on-chain code. The always-on `ci-fast` workflow does not build SBF, so a change under `programs/`
  or `tests/litesvm/` is not verified by `ci-fast` alone.

---

## What CI runs

`ci-fast` runs on every change, in six jobs.

| Job | What it does |
|---|---|
| `rust` | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace` on Rust 1.95.0 |
| `node` | `npm run typecheck && npm test` in every backend package; the offline twenty-pool settlement rehearsal (`tests/rehearsal`); the app's `lint`, `typecheck`, `test` and `build` |
| `postgres` | every migration applied to an empty Postgres 16, and every Postgres-backed store driven against it (`tests/postgres`) |
| `journey` | the Playwright browser journey over a fixture-mode production build, at 375px and 1280px |
| `gitleaks` | secret scan of the working tree and the git history |
| `standing-rules` | the fifteen checks below |

To reproduce the app and journey jobs locally:

```bash
cd app && npm run lint && npm run typecheck && npm test && npm run build
cd app && npx playwright install chromium && NEXT_PUBLIC_FIXTURE_DATA=1 npm run build && npm run journey
```

### The fifteen standing-rules checks

In CI order. None of them needs `npm run setup`; the `tsx` ones fetch `tsx` on first use.

| # | Command | Refuses a change that… |
|---|---|---|
| 1 | `./scripts/check-language.sh` | uses a word from the project's forbidden-vocabulary list, anywhere in the tree |
| 2 | `./scripts/check-standing-rules.sh` | adds a way for money to leave the prize vault beyond the fixed set, lets the class reach the scoring path, or breaks the other structural rules |
| 3 | `npx --yes tsx@4.20.3 scripts/check-territories.ts` | puts a territory code in `config/territories.json` that the entry service cannot enforce |
| 4 | `npx --yes tsx@4.20.3 scripts/check-operator-identity.ts` | breaks the schema of the operator identity the terms and privacy pages render |
| 5 | `npx --yes tsx@4.20.3 scripts/check-blocked-wallets.ts` | blocks a wallet without a recorded ground from the terms |
| 6 | `npx --yes tsx@4.20.3 scripts/check-published-numbers.ts` | leaves a player-facing number out of step with the program's constants |
| 7 | `npx --yes tsx@4.20.3 scripts/check-dead-files.ts` | leaves an app source file that no route reaches |
| 8 | `npx --yes tsx@4.20.3 scripts/sim/fill-replay.ts --self-test` | lets the fill simulation drift from the seal/refund rule the program enforces |
| 9 | `npx --yes tsx@4.20.3 scripts/drain-verdict.ts --self-test` | weakens the pre-flight that stops a program upgrade while a pool is taking entries |
| 10 | `./scripts/check-env-examples.sh` | reads an environment variable that `backend/.env.example` or `app/.env.example` does not list |
| 11 | `./scripts/check-container-user.sh` | lets a service image run as root |
| 12 | `./scripts/check-fixtures.sh` | changes a Python oracle or its committed test vectors so they no longer agree |
| 13 | `python3 scripts/check-mirrors.py` | lets a constant or event layout mirrored between Rust and TypeScript disagree |
| 14 | `./scripts/ci-gate.sh --self-test` | breaks the deploy gate's decision logic |
| 15 | `./scripts/deploy-devnet.sh --self-test` | breaks the program deploy script's cluster handling |

Run all fifteen and the `standing-rules` job cannot surprise you.

### The Postgres suite

`tests/postgres` applies every migration to an empty database and drives each Postgres-backed store
against it. It needs a database URL; without one every case is reported **pending** (never passing):

```bash
cd tests/postgres && npm ci
BLOTTO_TEST_DATABASE_URL=postgres://blotto:blotto@localhost:5432/blotto_test npm test
```

**It drops the `public` schema of the database it is given**, so it refuses to run unless the
database name contains `test`, `scratch`, `ci` or `tmp` (`tests/postgres/src/db.ts`). With the
compose Postgres running, create one with
`docker compose exec postgres createdb -U blotto blotto_test`. CI fails the job if any case comes
back pending.

---

## Environment variables

Names only; `backend/.env.example` and `app/.env.example` describe each one, and CI check 10 keeps
them complete. Production values live in the hosting provider's secret store, never in the
repository.

| Variable | File | Path 1 | Path 2 | Path 3 | Tests |
|---|---|---|---|---|---|
| `BLOTTO_HELIUS_WEBHOOK_SECRET` | root `.env` | — | **required** (any value) | **required** | — |
| `BLOTTO_API_CORS_ORIGINS` | root `.env` / shell | — | required for browser reads | **required** | — |
| `BLOTTO_RPC_URL` | root `.env` | — | optional | optional | — |
| `BLOTTO_PROGRAM_ID` | root `.env` | — | optional | your program id | — |
| `BLOTTO_DATABASE_URL` | shell (services outside Docker) | — | set by compose | **required** for a service run outside Docker | — |
| `ENTRY_SIGNER_SEED_HEX`, `ALLOW_DEV_ENTRY_SIGNER` | shell | — | — | **required** (or the Turnkey set) | — |
| `GEO_STUB_COUNTRY`, `ALLOW_STUB_GEO` | shell | — | — | **required** (or the vendor pair) | — |
| `SANCTIONS_OFAC_SDN` (or `SANCTIONS_STUB_LISTED` + `ALLOW_STUB_SANCTIONS`) | shell | — | — | **required** | — |
| `NEXT_PUBLIC_INDEXER_URL` | `app/.env.local` | leave unset | **required** | **required** | — |
| `NEXT_PUBLIC_ENTRY_API_URL` | `app/.env.local` | — | — | **required** | — |
| `NEXT_PUBLIC_PROGRAM_ID` | `app/.env.local` | — | — | **required** | — |
| `NEXT_PUBLIC_PRIVY_APP_ID` | `app/.env.local` | — | — | **required** | — |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID`, `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_DEVNET_FAUCET` | `app/.env.local` | — | — | optional | — |
| `NEXT_PUBLIC_FIXTURE_DATA` | build command | — | — | — | `1` for the journey build only |
| `BLOTTO_TEST_DATABASE_URL` | shell | — | — | — | the Postgres suite |

Never give a secret a `NEXT_PUBLIC_` name: those values are compiled into the browser bundle.

---

## Common errors

| Symptom | Cause and fix |
|---|---|
| `Module not found: Can't resolve '@turnkey/crypto'` (or another package) from `next dev` | The backend packages are not installed. Run `npm run setup` at the root. |
| `yarn.lock` shows as modified, or a `package-lock.json` appears at the root | `npm install` was run at the root. `git checkout -- yarn.lock && rm package-lock.json`. |
| `required variable BLOTTO_HELIUS_WEBHOOK_SECRET is missing a value` | Give it any non-empty value in the root `.env`. It is needed even for `up postgres`. |
| Every page says live data is unavailable | A production build without `NEXT_PUBLIC_INDEXER_URL`, or the indexer is not reachable at that URL. For development use `npm run dev`. |
| The browser console shows CORS errors against `localhost:8081` or `:8082` | Set `BLOTTO_API_CORS_ORIGINS=http://localhost:3000` in the root `.env` (or the entry service's shell) and restart the service. |
| A change to `app/.env.local` has no effect | `NEXT_PUBLIC_*` values are read at start/build. Restart `npm run dev` or rebuild. |
| `BLOTTO_DATABASE_URL is not set — refusing to start` | A service run outside Docker needs the variable exported; for the compose Postgres use `postgres://blotto:blotto@localhost:5432/blotto`. |
| `ENTRY_SIGNER_SEED_HEX is set but ENTRY_SIGNER_KEY_ID is not…` | Add `ALLOW_DEV_ENTRY_SIGNER=1` to use the development signer. The stub location check needs `ALLOW_STUB_GEO=1` the same way, and the stub sanctions list `ALLOW_STUB_SANCTIONS=1`. |
| `[auth] NEXT_PUBLIC_PRIVY_APP_ID is not set — sign-in is disabled` | Sign-in needs a Privy app id in `app/.env.local` (path 3). |
| The review service or daemon container exits at start | Expected without the settlement keypair, key custody and upload wallet. Path 2 needs only `postgres` and `indexer`. |
| `BLOTTO_MONITOR_SINK` refused | Only `logging`, `silent` or `prometheus` are accepted; leave it unset locally. |
| The Postgres suite reports every case pending | `BLOTTO_TEST_DATABASE_URL` is not set. |
| The Postgres suite refuses the database | The database name must contain `test`, `scratch`, `ci` or `tmp`. |
| `anchor build` complains the program keypair does not match `declare_id` | Use `anchor build --ignore-keys` for a local build. |
| The LiteSVM suite cannot find `blotto_cup.so` | Run `anchor build --ignore-keys` first. |

---

Next: [Contributing](../../CONTRIBUTING.md) for the change rules, [Hosting](HOSTING.md) for deploying
the services, [Operating manual](OPERATING-MANUAL.md) for running a live deployment.
