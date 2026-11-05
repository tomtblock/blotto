# Blotto Cup

> Reviewing this for a hackathon or an audit? Start at [`REVIEWERS.md`](REVIEWERS.md).

A paid-entry tournament on Solana, built on the Colonel Blotto game: the result is decided by the players' decisions, with no chance in the scoring.

A pool holds 8, 16, 32 or 64 players. Each one places points across **seven sealed battles** of
five stats — Strength, Speed, Heart, Wit, Durability — on a board, against one three-minute clock.
When the pool closes, every allocation is revealed and each player's seven battles are scored
against the matching battle of **every other player** (441 comparisons per player in a full
64-player pool, 49 in a full 8-player pool). No pairings, no bracket, no chance in the mechanism:
everyone faces the identical field. The top quarter of the pool's size is paid, from a prize table
that is fixed for each size before anyone enters. For a 0.1 SOL entry:

| Pool size | Places paid | Prizes |
|---|---|---|
| 8 players | 2 | 1st 0.3 SOL, 2nd 0.2 SOL |
| 16 players | 4 | 1st 0.5 SOL, 2nd 0.3 SOL, 3rd and 4th 0.1 SOL each |
| 32 players | 8 | 1st 0.8 SOL, 2nd 0.4 SOL, 3rd and 4th 0.2 SOL each, 5th to 8th 0.1 SOL each |
| 64 players | 16 | 1st 1.2 SOL, 2nd 0.6 SOL, 3rd and 4th 0.3 SOL each, 5th to 8th 0.2 SOL each, 9th to 16th 0.1 SOL each |

Players level on the ranking share the prizes of the places they occupy equally. The tables live
in [`programs/blotto_cup/src/constants.rs`](programs/blotto_cup/src/constants.rs) (`LADDER_TABLES`)
and decision `D-E19`; the product requirements for pools and prizes are in
[`docs/product/PRD.md` §6](docs/product/PRD.md#6-pools-tiers-and-prizes).

Each entrant also receives a non-transferable character pass whose class is drawn with verifiable
on-chain randomness. **The class is cosmetic** — nothing in scoring, payout or ranking reads it.

> **Status: devnet only.** The program has never been deployed to mainnet and no real money has
> entered it. Mainnet is gated on independent legal review and the checklist in
> [`docs/ROADMAP.md`](docs/ROADMAP.md). Under decision `R5`, an internal program review stands in for a
> formal audit before launch, and an independent audit follows after ten settled mainnet pools.
> Program ID (devnet): `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`.

## Two modes

| | Easy | Hard |
|---|---|---|
| What you place | 100 points in **each** of the seven battles | 700 points **anywhere** across all 35 cells |
| How a battle is won | the larger number wins a stat; three stats of five win the battle; otherwise a draw | identical |
| Clock | one three-minute clock for the whole board, starting at the first point placed | identical |

Each mode runs its own pools, at every size, with the same entry prices and prize tables. The rules
live in [`backend/scoring/src/allocation.ts`](backend/scoring/src/allocation.ts) and
[`backend/scoring/src/engine.ts`](backend/scoring/src/engine.ts); the one scoring module is run
unchanged by the settlement service and by the browser, so any player can recompute the result.

## How the money moves

1. **The prize is funded before anyone can enter.** Opening a pool moves its whole prize pool from
   the platform treasury into the pool's own vault. The prize pool is fixed for the pool's size and
   entry price, not a share of entries, so it is the same however many players enter.
2. **Entries go to the treasury.** An entry never touches the prize vault.
3. **The pool either plays or refunds.** Entries close 12 hours after opening, or as soon as the
   pool is full. Each size has a minimum field — 5, 10, 20 or 40 players for 8, 16, 32 or 64. At
   or above it the pool plays; below it, every entry is refunded in full from the treasury and the
   untouched prize returns to the treasury. The minimum field is written onto each pool when it
   opens, so a later change cannot move it under players who already entered.
4. **Once a pool plays, its prize is only ever paid to players.** The prize leaves the vault through
   `pay_prizes`, `release_escrow` or `pay_next_place`. A share held back by an upheld review is
   never returned to the operator: in a pool that pays several places it stays in the vault until
   the payout that moves the rest of the field up is built (decision `D-E19`). There is no withdraw
   instruction on a vault and no admin escape hatch;
   [`scripts/check-standing-rules.sh`](scripts/check-standing-rules.sh) asserts the exact exit set on
   every change.

Seven entry tiers exist, from 0.1 SOL to 7.5 SOL, the same for both modes and every size; only
0.1 SOL is open. The prices, the prize tables and the minimum fields live in
[`programs/blotto_cup/src/constants.rs`](programs/blotto_cup/src/constants.rs) and on-chain in
`Config` and one `PoolType` account per mode, tier and size; which of them are open is set there
too. [`docs/compliance/PRODUCT-FACTS.md`](docs/compliance/PRODUCT-FACTS.md) lists every value with
its source.

## Documentation

| I want to… | Read |
|---|---|
| Understand the game and the money, without code | [How it works](docs/guide/HOW-IT-WORKS.md) |
| Read the product requirements | [Product requirements (PRD)](docs/product/PRD.md) |
| See where the project is and what stands before mainnet | [Roadmap](docs/ROADMAP.md) |
| Run it locally, build it, test it | [Getting started](docs/guide/GETTING-STARTED.md) |
| Know what is actually built | [Architecture, as built](docs/architecture/ARCHITECTURE.md) · [Diagrams](docs/architecture/DIAGRAMS.md) |
| Know why it is built that way | [Decision log](docs/architecture/DECISIONS.md) · [Design records](docs/architecture/adr/) |
| See the devnet test results | [Testing report](docs/testing/TESTING-REPORT.md) |
| Check the fairness and accountability safeguards | [Safeguards](docs/compliance/SAFEGUARDS.md) · [Product facts](docs/compliance/PRODUCT-FACTS.md) · [Data inventory](docs/compliance/DATA-INVENTORY.md) |
| Review security | [Security review](docs/security/SECURITY-REVIEW.md) · [Reporting a vulnerability](SECURITY.md) |
| Deploy or operate it | [Hosting](docs/guide/HOSTING.md) · [Operating manual](docs/guide/OPERATING-MANUAL.md) |
| Run or ship the Android app (Solana dApp Store) | [`mobile/README.md`](mobile/README.md) — the short way in · [The mobile channel](docs/guide/MOBILE.md) — the manual |
| Contribute | [Contributing](CONTRIBUTING.md) |

The full map is [`docs/README.md`](docs/README.md).

## Quick start

The app on fixture data — no credentials, database or Docker needed:

```bash
git config core.hooksPath .githooks   # enables the keypair pre-commit hook
npm run setup                          # installs every package (required — see Getting started)
cd app && npm run dev                  # http://localhost:3000
```

The backend stack, the program build and every CI check are in
[Getting started](docs/guide/GETTING-STARTED.md).

## Repository layout

| Path | What is there |
|---|---|
| `programs/blotto_cup/` | The Anchor program: pools, entries, treasury, settlement, escrow |
| `crates/blotto-randomness/` | The class-randomness digest and the bag-without-replacement draw |
| `backend/scoring/` | The scoring engine, prize maths and results tree — one module, run by the settlement service and the browser |
| `backend/sealing/` | The sealed-allocation payload format and pool-key custody |
| `backend/class-digest/` | The class draw replayed in TypeScript, kept apart from scoring |
| `backend/sanctions/` | Published-list screening used by the entry gate and at payout |
| `backend/reveal/` | The daemon: keeper, settlement, bundle publishing, treasury reporting |
| `backend/indexer/` | Event ingest, Postgres projections and the public read API |
| `backend/packet/` | The entry gate: age attestation, territory check, signed entry packets |
| `backend/detection/` | Integrity signals and the reviewers' signed decision log |
| `backend/_shared/` | Config, Postgres, monitoring and event decoders |
| `app/` | The Next.js frontend: play, pools, results, verify, profile, rules |
| `tests/` | `litesvm/` (program integration), `rehearsal/` (offline settlement and skill evidence), `postgres/` (SQL) |
| `battle-test/` | The devnet trial's tooling and raw on-chain evidence |
| `config/` | Operator-owned settings: territories, terms version, reviewers, custody, operator identity |
| `deploy/` | Service Dockerfiles and Fly.io definitions |
| `scripts/` | The admin CLI, deploy scripts and the standing-rules checks CI runs |
| `docs/` | Everything above, mapped by [`docs/README.md`](docs/README.md) |

## Licence

Apache-2.0. See [`LICENSE`](LICENSE). One dependency of the on-chain program, Metaplex Core, has
a licence of its own; see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
