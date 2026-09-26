# Blotto Cup documentation

Every document in this repository, grouped by what you want to do. Where two documents touch the
same subject, the one listed as **canonical** wins; the others point at it rather than restating it.
Where any document and the code disagree, the code is right and the document is a bug.

## Start here

| Document | For |
|---|---|
| [`../README.md`](../README.md) | What Blotto Cup is, the two modes, how the money moves, the quick start |
| [`guide/HOW-IT-WORKS.md`](guide/HOW-IT-WORKS.md) | The whole mechanism in plain language, no code — for players, judges and reviewers |

## Guides — using and running it

| Document | Canonical for |
|---|---|
| [`guide/GETTING-STARTED.md`](guide/GETTING-STARTED.md) | Prerequisites, running the app and the backend locally, building the program, every CI check |
| [`guide/HOSTING.md`](guide/HOSTING.md) | The deployment topology, ports and health checks; deploying the backend and the app; sign-in configuration; the vendor map |
| [`guide/OPERATING-MANUAL.md`](guide/OPERATING-MANUAL.md) | Operating a deployment: roles and keys, the admin CLI, opening tiers, program upgrades, the daemon, reviews, incidents |
| [`guide/DEVNET-REHEARSAL.md`](guide/DEVNET-REHEARSAL.md) | The offline settlement rehearsal CI runs, and worked examples of the admin CLI against devnet |

## Architecture — what is built and why

| Document | Canonical for |
|---|---|
| [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | **What exists**: services, the program's instructions and accounts, the money model, sealing, scoring, both modes, detection, what is not built |
| [`architecture/DIAGRAMS.md`](architecture/DIAGRAMS.md) | Annotated diagrams of the same — canonical for nothing; `ARCHITECTURE.md` wins on any disagreement |
| [`architecture/DECISIONS.md`](architecture/DECISIONS.md) | Every product and design decision, by ID (`R1`–`R21`, `D-A1`…`D-E17`), with its status and where it is enforced |
| [`architecture/adr/`](architecture/adr/) | Design records for the class draw, the randomness digest, the pass standard and its non-transferability, and the program's threat mitigations |

## Testing — the evidence

| Document | Canonical for |
|---|---|
| [`testing/TESTING-REPORT.md`](testing/TESTING-REPORT.md) | **The consolidated test report**: automated suites, CI lanes, the devnet trial's results, findings and their status |
| [`skill-evidence/REPORT.md`](skill-evidence/REPORT.md) · [`skill-evidence/hard/REPORT.md`](skill-evidence/hard/REPORT.md) | The skill-evidence study for each mode — how often each strategy finishes first. **Generated** by `npm run skill-evidence` in `tests/rehearsal`; a nightly CI lane fails on drift. Never edit by hand |
| [`testing/FILL-SIMULATION.md`](testing/FILL-SIMULATION.md) | How often a pool fills under the 40-seat, 12-hour rule. **Generated** by `scripts/sim/fill-replay.ts --write` |
| [`testing/LIVE-SKILL-ENDPOINTS.md`](testing/LIVE-SKILL-ENDPOINTS.md) | The live read-API endpoints that publish the same statistics from real tournaments |
| [`../battle-test/`](../battle-test/) | The devnet trial's tooling, frozen predictions and raw on-chain evidence |

## Compliance — safeguards and facts

| Document | Canonical for |
|---|---|
| [`compliance/SAFEGUARDS.md`](compliance/SAFEGUARDS.md) | Every fairness and accountability safeguard, the file that enforces it and the check that proves it. States mechanisms; makes no claim about legal status |
| [`compliance/PRODUCT-FACTS.md`](compliance/PRODUCT-FACTS.md) | Every product fact, each with the line of code or decision it comes from. When a source changes, this file changes in the same change |
| [`compliance/DATA-INVENTORY.md`](compliance/DATA-INVENTORY.md) | What personal data the platform holds, where, why, and for how long. Cited as proof by the privacy claims test |
| [`../config/territories.README.md`](../config/territories.README.md) · [`../config/blocked-wallets.README.md`](../config/blocked-wallets.README.md) | The territory schedule and wallet blocklist, one row per entry with its ground. Parsed by CI |

## Security

| Document | Canonical for |
|---|---|
| [`security/SECURITY-REVIEW.md`](security/SECURITY-REVIEW.md) | The reviews performed, the threat model, the on-chain invariants, findings fixed and items still open |
| [`../SECURITY.md`](../SECURITY.md) | How to report a vulnerability |

## Process

| Document | Canonical for |
|---|---|
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Keys and secrets, the language gate, the standing-rules checks, commits and branches, CI |
| [`../CLAUDE.md`](../CLAUDE.md) | The rules AI coding agents working in this repository follow — the same hard rules, stated for an agent |
| [`design/`](design/) | UI screenshots from 2026-09-16, taken before the battle board replaced the battle screens |

## Settings the operator owns

These files are data, not documents, but they decide published behaviour. Each is changed only
deliberately, in its own commit.

| File | What it sets |
|---|---|
| [`../config/territories.json`](../config/territories.json) | Where entries are refused (fail-closed) |
| [`../config/terms.json`](../config/terms.json) | The terms version; a bump re-prompts every wallet |
| [`../config/reviewers.json`](../config/reviewers.json) | The public keys whose signed review decisions count |
| [`../config/blocked-wallets.json`](../config/blocked-wallets.json) | Wallets refused an entry, each with an enumerated ground |
| [`../config/operator.json`](../config/operator.json) | The operating entity named by the terms; a mainnet deploy is refused while any value is unset |
| [`../config/custody.json`](../config/custody.json) | The custody disclosure page: upgrade authority, signers, timelock |
| [`../programs/blotto_cup/src/constants.rs`](../programs/blotto_cup/src/constants.rs) | Tier prices and pots, the seat floor and ceiling, the fill deadline |

## Citations in code comments

Code comments cite decisions by ID (`R7-b`, `D-E6`) — [`architecture/DECISIONS.md`](architecture/DECISIONS.md)
resolves every one. Some also cite sections of the original design documents as `PID §x` or
`TECH-ARCH §x`; those documents are not published, and
[`architecture/DECISIONS.md`](architecture/DECISIONS.md#reading-citations-in-code-comments) maps the
cited sections to the public document that now carries each one.

## Adding a document

1. **One subject, one home.** If the subject has a canonical document, add to it.
2. **List it here in the same change.** An unlisted document drifts.
3. **Point, don't restate.** A number or rule that lives in code or another document is linked, not copied.
4. **It must pass `./scripts/check-language.sh`.**
