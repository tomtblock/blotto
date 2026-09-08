# Blotto Cup

A paid-entry skill competition on Solana.

A pool has 64 seats and runs with at least 52. Each player pays a fixed entry,
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

## Start here

| Read this | For |
|---|---|
| [`docs/AS-BUILT.md`](docs/AS-BUILT.md) | **What exists today** — the services, the program, the money model, and what is not built yet. Start here if you are going to change something. |
| [`CLAUDE.md`](CLAUDE.md) | The hard rules. Short, and none of them bend. |
| [`docs/INDEX.md`](docs/INDEX.md) | Which document is canonical for which subject. |
| [`docs/OPERATING-MANUAL.md`](docs/OPERATING-MANUAL.md) | Running it: deploys, admin transactions, the daemon, what to do when something breaks. |
| [`docs/PID_Blotto-Cup_v0.5.md`](docs/PID_Blotto-Cup_v0.5.md) | What the product is and why. Founder-owned, and materially **behind** the build since 2026-09-06 — `AS-BUILT.md` §5 lists every divergence. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Process, the pre-commit hook, and the language gate. |

## Running it locally

```
npm run setup
cd app && npm run dev
```

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

A local Postgres for the indexer and review service comes from
`docker-compose.yml`.

## Layout

| Path | What is there |
|---|---|
| `programs/blotto_cup/` | The Anchor program: pools, entries, the treasury, settlement, escrow and the forfeited-share split |
| `crates/blotto-randomness/` | The class-randomness digest and the bag-without-replacement draw |
| `backend/scoring/` | The scoring engine, prize maths and the results tree — one module, run by the crank and by the browser |
| `backend/sealing/` | The sealed-box payload format and pool-key custody (Turnkey) |
| `backend/reveal/` | The daemon: keeper, crank, bundle publishing, treasury reporting |
| `backend/indexer/` | Event ingest, the Postgres projections, and the public read API |
| `backend/packet/` | The entry gate: age attestation, territory check, signed entry packets |
| `backend/detection/` | The five integrity signals and the review desk's signed decision log |
| `backend/_shared/` | Config loading, Postgres, monitoring, the program's event decoders |
| `app/` | The Next.js frontend — play, pools, results, verify, profile, rules, admin |
| `tests/litesvm/` | The integration suite that drives the compiled program |
| `tests/rehearsal/` | The offline settlement rehearsal and the skill-evidence study |
| `scripts/` | Deploy, the admin CLI, and the three CI gates |

## Verifying a change

```
cargo test --workspace                          # program units + the vault fuzz
anchor build --ignore-keys                      # the SBF artifact
cd tests/litesvm && cargo test                  # integration, against that artifact
cd app && npm run lint && npm run typecheck && npm test && npm run build
./scripts/check-language.sh                     # the PID §8.7 lexicon
./scripts/check-standing-rules.sh               # the vault's exits; class out of scoring
./scripts/check-env-examples.sh                 # every env var a service reads is documented
```

Every backend package has `npm run typecheck` and `npm test`. CI runs all of it;
`docs/AS-BUILT.md` §7 has the full sequence.

## Reports

- [`docs/AUDIT-2026-09-07.md`](docs/AUDIT-2026-09-07.md) — the repository audit:
  what was found and fixed, the open items, and the road to mainnet.
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
