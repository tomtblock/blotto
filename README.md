# Blotto Cup

A paid-entry skill competition on Solana.

A pool has 64 seats and runs with at least 40. Each player pays a fixed entry,
receives a non-transferable character pass whose class is drawn by verifiable
on-chain randomness — **cosmetic, read by nothing in scoring** — and immediately
plays seven sealed battles. A battle is a pentagon of five stats (Strength,
Speed, Heart, Wit, Durability) distributed as free integers summing to exactly
100. About ninety seconds, then nothing more to do.

When the pool closes, every battle is revealed and scored against the
corresponding battle of every other player: 441 comparisons per person, 14,112
in a full pool. No pairing, no bracket, no clock, no chance in the mechanism —
every player faces the identical field, and the only variable between them is
the quality of their seven decisions. The player ranked first is paid the whole
fixed prize pool, funded from the treasury before entries opened.

## How the money moves

Four facts, in the order they happen. Every figure below lives in exactly one
place — `programs/blotto_cup/src/constants.rs` — and is quoted here only as
shape, never as a table to keep in step.

1. **The prize is funded before anyone can enter.** Opening a pool moves that
   tier's fixed pot from the platform treasury into the pool's own vault. The
   prize is a founder-set constant per tier, not a share of what comes in, so
   it is the same whether 40 players enter or 64.
2. **Entries go to the treasury, not to the prize.** The pot is already in the
   vault, so an entry adds nothing to it. The operator's margin is what the
   entries came to minus that fixed pot — `1 − 40/seats` of intake, which is
   **nothing at all at the 40-seat floor** and 37.5% in a full pool. Breaking
   even on a thin pool is the deliberate shape, not an accident of the
   numbers.
3. **The pool either plays or refunds, and a clock decides which.** Entries
   close 12 hours after opening. At 40 seats or more the pool seals and plays;
   below 40 every entry refunds in full. The floor is written onto the pool
   when it opens, so a later change to the constant cannot move it under
   players who already entered.
4. **Money leaves a vault four ways, and none of them reaches the operator.**
   `pay_prizes`, `release_escrow`, `pay_next_place` and `refund`. There is no
   withdraw instruction, no admin escape hatch and no "recover stuck funds"
   path, and a share forfeited after a review passes to other players rather
   than back to us. `scripts/check-standing-rules.sh` asserts that exit set on
   every change.

Seven entry tiers exist; **one is open at launch**. The prices, the pots and
which tiers are open are in `constants.rs` and `Config.open_tiers` — see
[`01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md`](01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md)
for the values with their sources.

## Start here

| Read this | For |
|---|---|
| [`docs/AS-BUILT.md`](docs/AS-BUILT.md) | **What exists today** — the services, the program, the money model, and what is not built yet. Start here if you are going to change something. |
| [`CLAUDE.md`](CLAUDE.md) | The hard rules. Short, and none of them bend. |
| [`docs/INDEX.md`](docs/INDEX.md) | Which document is canonical for which subject. |
| [`docs/OPERATING-MANUAL.md`](docs/OPERATING-MANUAL.md) | Running it: deploys, admin transactions, the daemon, what to do when something breaks. |
| [`docs/PID_Blotto-Cup_v0.5.md`](docs/PID_Blotto-Cup_v0.5.md) | What the product is and why. Founder-owned, and materially **behind** the build since 2026-09-06 — `AS-BUILT.md` §5 lists every divergence. |
| [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) | The same mechanism without the code, one page. For counsel, an investor, or a candidate. |
| [`01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md`](01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md) | Every fact about the product with the line of code or the ratified decision it comes from. Written for counsel and auditors; the fastest way to check a claim. |
| [`docs/BUILD-ROADMAP_v1.0.md`](docs/BUILD-ROADMAP_v1.0.md) | The ratified decision register (R1–R21, D-A…D-E). **Every constant in the program cites a row here**; nothing is chosen without one. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Process, the pre-commit hook, and the language gate. |

## Running it locally

Two paths. The first puts the site on screen in two commands and needs no
credentials, no database and no Docker. The second adds the backend.

### 1. The app alone, on fixtures

```
npm run setup
cd app && npm run dev          # http://localhost:3000
```

That is the whole of it: no `.env` file is required. With
`NEXT_PUBLIC_INDEXER_URL` unset, a **development** build serves every read from
the deterministic fixture catalogue (`app/src/data/fixture.ts`, built from
`scenarios.ts`), so every page
renders without a live tournament; the fixture pool ids watermark the data. A
**production** build with that variable unset serves nothing instead — every
read fails on purpose, because "we cannot reach the indexer" must never render
as "no tournament is open" (`app/src/data/api.ts`). That is the default and the
only state a deploy can reach by forgetting something.

What the fixture path cannot do: enter a pool. Entering needs the packet
service, a wallet and a funded devnet account — path 2, then `app/.env.local`.

**`setup` is not optional and not a convenience.** The app imports the backend
packages' *sources* directly, and those files resolve their own vendor
dependencies from each backend package's own `node_modules` — so `next dev`
fails with `Module not found: Can't resolve '@turnkey/crypto'` (or similar)
until every backend package is installed, no matter how many times `app` alone
is installed.

The root uses **yarn** (`yarn.lock`); every package under `backend/` and `app/`
uses **npm** (`package-lock.json`). Running `npm install` at the root rewrites
`yarn.lock` and leaves a competing `package-lock.json` — if that has happened,
`git checkout -- yarn.lock` and delete the stray file. `npm run setup` only
*runs* a script and is safe at the root.

### 2. The backend, on Docker

`docker-compose.yml` builds the four service images plus a Postgres. It needs a
running Docker daemon, and it reads **`.env` at the repository root**:

```
cp backend/.env.example .env    # then fill what you have
docker compose up --build postgres indexer packet   # the read path
docker compose up --build                           # everything
```

**The copied file will not start as-is.** `BLOTTO_HELIUS_WEBHOOK_SECRET` is
declared `${...:?set in .env}` in the compose file, and `:?` rejects an empty
value as well as a missing one — so the example's blank line stops the stack
with `required variable BLOTTO_HELIUS_WEBHOOK_SECRET is missing a value` before
a container starts. Any non-empty string does locally: the indexer only
compares an incoming webhook's `Authorization` header against it byte for byte,
so it needs a value, not a real Helius secret.

The indexer container runs `src/index.ts sync`, which applies the migrations
itself before it serves, so there is no separate migrate step for this stack.
The daemon and review services need credentialed seams (Turnkey, Irys, the
settlement keypair) and will exit at startup without them — that refusal is the
fail-closed design, not a broken compose file.

**Where environment variables actually live** — three files, three different
readers, and only one of them is a service's own:

| File | Read by | What it does |
|---|---|---|
| `.env` at the repository root | `docker compose` | Interpolated into the `environment:` blocks of `docker-compose.yml`. Only variables that file *names* reach a container. |
| `app/.env.local` | `next dev` / `next build` | The app's own variables; copy `app/.env.example` and fill. |
| `backend/.env` | **nothing** | No service loads a dotenv file — every one reads `process.env` only. To run a service outside Docker, export the variables into the shell first (`set -a; . ./.env; set +a`) and then, for example, `npm --prefix backend/indexer run sync`. |

Two limits of the compose stack as it stands, so they are not discovered the
hard way:

- **Set a CORS allowlist or the browser cannot read the containers.** The read
  API and the packet service take their allowlist from
  `BLOTTO_API_CORS_ORIGINS`; unset means no CORS headers at all, which is the
  right default for a deployment and means a browser on `http://localhost:3000`
  cannot read `http://localhost:8081` directly. `docker-compose.yml` passes the
  variable through as of 2026-09-12, so put
  `BLOTTO_API_CORS_ORIGINS=http://localhost:3000` in the root `.env` before
  `docker compose up`. Server-rendered reads never needed it.
- **No cluster variable.** `BLOTTO_CLUSTER` is not in the compose file; every
  service therefore defaults to devnet (`backend/_shared/src/cluster.ts`), which
  is what a local stack wants. `BLOTTO_RPC_URL` defaults to the public devnet
  endpoint and is worth overriding with a Helius URL in `.env`, which the
  compose file does read.

## Layout

| Path | What is there |
|---|---|
| `programs/blotto_cup/` | The Anchor program: pools, entries, the treasury, settlement, escrow and the forfeited-share split |
| `crates/blotto-randomness/` | The class-randomness digest and the bag-without-replacement draw |
| `backend/scoring/` | The scoring engine, prize maths and the results tree — one module, run by the crank and by the browser |
| `backend/sealing/` | The sealed-box payload format and pool-key custody (Turnkey) |
| `backend/sanctions/` | The published-list screening both the entry gate and the crank use |
| `backend/class-digest/` | The class draw replayed in TypeScript — its own package so the scoring path can never mention "class" |
| `backend/reveal/` | The daemon: keeper, crank, bundle publishing, treasury reporting |
| `backend/indexer/` | Event ingest, the Postgres projections, and the public read API |
| `backend/packet/` | The entry gate: age attestation, territory check, signed entry packets |
| `backend/detection/` | The five integrity signals and the review desk's signed decision log |
| `backend/_shared/` | Config loading, Postgres, monitoring, the program's event decoders |
| `app/` | The Next.js frontend — play, pools, results, verify, profile, rules, admin |
| `tests/litesvm/` | The integration suite that drives the compiled program |
| `tests/rehearsal/` | The offline settlement rehearsal and the skill-evidence study |
| `tests/postgres/` | The only suite that executes SQL: the migrations from an empty database, then every Postgres-backed store against the schema they build |
| `config/` | **Founder-owned JSON**: the territory schedule, the terms version, the reviewer registry, the custody policy. Changed only on a founder instruction, each in its own commit |
| `scripts/` | Deploy, the admin CLI, and the ten checks CI's `standing-rules` lane runs |
| `scripts/sim/` | The arrival simulation behind the fill rule — it re-implements the seal/refund boundary to measure how often a pool runs, and self-tests against the program's numbers in CI |

## Verifying a change

```
cargo test --workspace                          # program units + the vault fuzz
anchor build --ignore-keys                      # the SBF artifact (Solana toolchain)
cd tests/litesvm && cargo test                  # integration, against that artifact
cd app && npm run lint && npm run typecheck && npm test && npm run build
cd app && NEXT_PUBLIC_FIXTURE_DATA=1 npm run build && npm run journey   # the browser journey
./scripts/check-language.sh                     # the PID §8.7 lexicon
./scripts/check-standing-rules.sh               # the vault's exits; class out of scoring
npx tsx scripts/check-territories.ts            # the founder's schedule is enforceable
npx tsx scripts/sim/fill-replay.ts --self-test  # the simulation still models the fill rule
./scripts/check-env-examples.sh                 # every env var a service reads is documented
./scripts/check-container-user.sh               # no service image runs as root
./scripts/check-fixtures.sh                     # the Python oracles reproduce their vectors
python3 scripts/check-mirrors.py                # Rust and TypeScript constants agree
./scripts/ci-gate.sh --self-test                # the deploy gate still judges correctly
./scripts/deploy-devnet.sh --self-test          # the program deploy still reads a cluster
```

Those ten are the whole of CI's `standing-rules` lane, in its order — run them
and that lane cannot surprise you. `ci-fast` has five more jobs: `rust`, `node`,
`postgres`, `journey` and `gitleaks`.

Every backend package has `npm run typecheck` and `npm test`. CI runs all of it;
`docs/AS-BUILT.md` §7 has the full sequence and what each step depends on.

The SQL suite needs a scratch database and is gated on its URL — without one
every case is reported PENDING rather than passing:

```
cd tests/postgres && BLOTTO_TEST_DATABASE_URL=postgres://…/blotto_test npm test
```

It DROPS the `public` schema of whatever it is pointed at, so the database name
has to contain `test`, `scratch`, `ci` or `tmp` before it will run at all. CI
gives it a service container (`ci-fast`'s `postgres` job) and fails the lane if
any case came back pending.

## Reports

- [`AUDIT_2026-09-11.md`](AUDIT_2026-09-11.md) — the cold-read audit, frozen as
  written. [`AUDIT_2026-09-11_RESPONSE.md`](AUDIT_2026-09-11_RESPONSE.md) is the
  running ledger of what was changed in answer to it, and
  [`AUDIT_2026-09-11_PLAN.md`](AUDIT_2026-09-11_PLAN.md) the founder-approved
  plan it runs on. **These three are the live list**; the one below is the
  earlier pass.
- [`docs/AUDIT-2026-09-07.md`](docs/AUDIT-2026-09-07.md) — the first repository
  audit: what was found and fixed, the open items, and the road to mainnet.
- [`EXTRACTION-REPORT.md`](EXTRACTION-REPORT.md) — what was carried from the
  predecessor repository and what turned out not to exist. **Historical**: it
  describes the state at the end of Phase 0.
- [`TRANSITION-REPORT.md`](TRANSITION-REPORT.md) — the fresh-repository
  decision, keys, and infrastructure.

## Status

Deployed to **devnet only**. The program has never been deployed to mainnet and
no real money has ever entered it. Mainnet is gated on counsel sign-off and on
the checklist at the end of the audit report.

## Licence

Apache-2.0. See [`LICENSE`](LICENSE).
