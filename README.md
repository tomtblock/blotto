# Blotto Cup

A paid-entry tournament on Solana, built on the Colonel Blotto game: the result is decided by the players' decisions, with no chance in the scoring.

Up to 64 players enter a pool. Each one places points across **seven sealed battles** of five
stats — Strength, Speed, Heart, Wit, Durability — on a board, against one three-minute clock. When
the pool closes, every allocation is revealed and each player's seven battles are scored against the
matching battle of **every other player** (441 comparisons per player, 14,112 in a full pool). No
pairings, no bracket, no chance in the mechanism: everyone faces the identical field. The player
ranked first is paid the pool's whole fixed prize pool (players tied for first share it equally).

Each entrant also receives a non-transferable character pass whose class is drawn with verifiable
on-chain randomness. **The class is cosmetic** — nothing in scoring, payout or ranking reads it.

> **Status: devnet only.** The program has never been deployed to mainnet and no real money has
> entered it. Mainnet is gated on an external security audit and an independent legal review.
> Program ID (devnet): `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`.

## Two modes

| | Easy | Hard |
|---|---|---|
| What you place | 100 points in **each** of the seven battles | 700 points **anywhere** across all 35 cells |
| How a battle is won | the larger number wins a stat; three stats of five win the battle; otherwise a draw | identical |
| Clock | one three-minute clock for the whole board, starting at the first point placed | identical |

Each mode runs its own pools with its own entry and prize pool. The rules live in
[`backend/scoring/src/allocation.ts`](backend/scoring/src/allocation.ts) and
[`backend/scoring/src/engine.ts`](backend/scoring/src/engine.ts); the one scoring module is run
unchanged by the settlement service and by the browser, so any player can recompute the result.

## How the money moves

1. **The prize is funded before anyone can enter.** Opening a pool moves that tier's fixed pot from
   the platform treasury into the pool's own vault. The pot is a constant per tier, not a share of
   entries, so it is the same whether 40 players enter or 64.
2. **Entries go to the treasury.** An entry never touches the prize vault.
3. **The pool either plays or refunds.** Entries close 12 hours after opening. With 40 or more seats
   filled (or all 64) the pool seals and plays. Below 40, every entry is refunded in full from the
   treasury and the untouched pot returns to the treasury. The floor is written onto each pool when
   it opens, so a later change cannot move it under players who already entered.
4. **Once a pool plays, its prize is only ever paid to players.** The prize leaves the vault through
   `pay_prizes`, `release_escrow` or `pay_next_place`. A share held back by an upheld review is not
   returned to the operator — it passes to the next eligible place. There is no withdraw
   instruction on a vault and no admin escape hatch;
   [`scripts/check-standing-rules.sh`](scripts/check-standing-rules.sh) asserts the exact exit set on
   every change.

Seven entry tiers exist, from 0.1 SOL to 7.5 SOL, on the same ladder for both modes; the prices, pots and which tiers are open live in
[`programs/blotto_cup/src/constants.rs`](programs/blotto_cup/src/constants.rs) and on-chain in
`Config`. [`docs/compliance/PRODUCT-FACTS.md`](docs/compliance/PRODUCT-FACTS.md) lists every value
with its source.

## Documentation

| I want to… | Read |
|---|---|
| Understand the game and the money, without code | [How it works](docs/guide/HOW-IT-WORKS.md) |
| Run it locally, build it, test it | [Getting started](docs/guide/GETTING-STARTED.md) |
| Know what is actually built | [Architecture](docs/architecture/ARCHITECTURE.md) · [Diagrams](docs/architecture/DIAGRAMS.md) |
| Know why it is built that way | [Decision log](docs/architecture/DECISIONS.md) · [Design records](docs/architecture/adr/) |
| See the devnet test results | [Testing report](docs/testing/TESTING-REPORT.md) |
| Check the fairness and accountability safeguards | [Safeguards](docs/compliance/SAFEGUARDS.md) · [Product facts](docs/compliance/PRODUCT-FACTS.md) · [Data inventory](docs/compliance/DATA-INVENTORY.md) |
| Review security | [Security review](docs/security/SECURITY-REVIEW.md) · [Reporting a vulnerability](SECURITY.md) |
| Deploy or operate it | [Hosting](docs/guide/HOSTING.md) · [Operating manual](docs/guide/OPERATING-MANUAL.md) |
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

Apache-2.0. See [`LICENSE`](LICENSE).
