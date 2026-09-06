# Blotto Cup

A paid-entry skill competition on Solana.

64 players pay a fixed entry (0.1 or 0.5 SOL) into a pool. Each receives a non-transferable
character pass whose class is drawn by verifiable on-chain randomness — **cosmetic only, read by
nothing in scoring** — and immediately plays seven sealed battles. A battle is a pentagon of five
stats (Strength, Speed, Heart, Wit, Durability) distributed as free integers summing to exactly 100.
About ninety seconds, then nothing more to do.

When the 64th entry lands, every battle is revealed and scored against the corresponding battle of
every other player: 441 comparisons per person, 14,112 in total. No pairing, no bracket, no clock, no
chance in the mechanism — every player faces the identical field, and the only variable between them
is the quality of their seven decisions. The player ranked first is paid the whole fixed prize
pool, funded before entries open; a pool runs with anywhere from 52 to 64 players.

## Start here

1. [`CLAUDE.md`](CLAUDE.md) — the hard rules.
2. [`docs/INDEX.md`](docs/INDEX.md) — which document is canonical for which subject.
3. [`docs/PID_Blotto-Cup_v0.5.md`](docs/PID_Blotto-Cup_v0.5.md) — what the product is and why.
4. [`docs/TECH-ARCHITECTURE_Blotto-Cup_v0.2.md`](docs/TECH-ARCHITECTURE_Blotto-Cup_v0.2.md) — how it
   is built.
5. [`CONTRIBUTING.md`](CONTRIBUTING.md) — process, the pre-commit hook, and the language gate.

## Running it locally

```
npm run setup
```

Then `cd app && npm run dev`.

**`setup` is not optional and not a convenience.** The app imports the backend packages'
*sources* directly, and those files resolve their own vendor dependencies from each backend
package's own `node_modules` — so `next dev` fails with `Module not found: Can't resolve
'@turnkey/crypto'` (or similar) until every backend package is installed, no matter how many
times `app` alone is installed. The same requirement bit CI on 2026-09-06, where the app build
lane installed only `app` and failed for a reason unrelated to what it was testing.

The root uses **yarn** (`yarn.lock`); every package under `backend/` and `app/` uses **npm**
(`package-lock.json`). Running `npm install` at the root rewrites `yarn.lock` and leaves a
competing `package-lock.json` — if that has happened, `git checkout -- yarn.lock` and delete the
stray file. `npm run setup` only *runs* a script and is safe at the root.

## Where the code is

This repository is at **Phase 0**: the skeleton exists, a small number of components were carried
across from a predecessor project, and most directories are placeholders with a README explaining
what belongs there. Read [`EXTRACTION-REPORT.md`](EXTRACTION-REPORT.md) before assuming anything is
implemented.

| Path | State |
|---|---|
| `crates/blotto-randomness/` | **Carried and working** — class randomness digest and the class draw |
| `crates/blotto-merkle/` | Placeholder — nothing existed to carry |
| `crates/blotto-scoring/` | Placeholder — new work, Phase 2 |
| `programs/blotto_cup/` | Anchor scaffold with two carried instructions: the VRF seed commit and the pass mint |
| `backend/_shared/`, `backend/indexer/` | **Carried** — config, database, monitoring and the webhook→Postgres event-ledger shape |
| `backend/{packet,sealing,detection,reveal}/` | Placeholders |
| `app/src/{wallet,tx,reveal}/` | **Carried** — wallet connect, transaction orchestration, class-reveal animation |
| `app/src/{battle,verify,rules,leaderboard,claim}/` | Placeholders |

## Reports

- [`EXTRACTION-REPORT.md`](EXTRACTION-REPORT.md) — what was carried from the old repository, what
  turned out not to exist, and what is left for Phase 1.
- [`TRANSITION-REPORT.md`](TRANSITION-REPORT.md) — the fresh-repository decision, keys, and the
  infrastructure still to be provisioned.

## Licence

Apache-2.0. See [`LICENSE`](LICENSE).
