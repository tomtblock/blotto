# Blotto Cup — documentation index and source-of-truth map

Read this before anything else. **If two documents disagree, the one marked canonical for that
subject wins and the other is wrong — fix the other.** No document restates a fact another document
owns; everywhere else a fact appears, it appears as a pointer.

## Source-of-truth table

| Subject | Canonical document | Update rule |
|---|---|---|
| **What the system actually is — services, program, money model, and what is not built** | `AS-BUILT.md` | Architect-owned. Written from the code; re-verified against a green suite whenever it changes. **Where it and TECH-ARCH v0.2 disagree, this file is right about what exists** and TECH-ARCH is right about what was intended |
| Running it — deploys, admin transactions, incidents, keys | `OPERATING-MANUAL.md` | Architect-owned; the founder owns the standing rules inside it |
| Going live on devnet — the founder's ordered checklist (Helius, GitHub, Vercel, Privy, Squads, testers, pausing) | `go-live-devnet.md` | Founder-facing; `deploy-backend.md` and `hosting.md` hold the detail it points at |
| **Open items, amber warnings, attack vectors, and the Road to Mainnet checklist** | `AUDIT-2026-09-07.md` | Architect-owned. Dated by design: a later audit gets its own file and this one becomes history. The Open Items and Road to Mainnet sections are the live lists until then |
| **Phase order, step scope, gates, and the ratified decision register (R1–R21, D-A…D-E)** | `BUILD-ROADMAP_v1.0.md` | Founder-ratified 2026-08-26. **Where it and TECH-ARCH v0.2 disagree, the roadmap wins** — the deltas are its §1.3/§1.4. The register rows are current; the phase step tables are the plan as ratified and are not updated as the build moves past them |
| Product intent, game design, prizes, legal characterisation | `PID_Blotto-Cup_v0.5.md` | Founder-owned. Superseded only by a later PID version. **Materially behind the build since 2026-09-06 — see the conflict list below** |
| The allocation interaction (pentagon radar, live normalisation, "Even split") | `PID_Blotto-Cup_v0.5.md` §4 | Founder-owned. **Overrides** TECH-ARCH §10 — see the conflict note below |
| Forbidden and preferred language | `PID_Blotto-Cup_v0.5.md` §8.7, as amended by register row D-B7 (full list in `../CONTRIBUTING.md` → "The language gate") | Founder + counsel. Enforced by the CI word grep |
| System architecture, accounts, instructions, events, constants | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` | Architect-owned |
| Scoring algorithm and ranking | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §6 | Architect-owned |
| Sealing lifecycle and failure modes | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §5 | Architect-owned |
| Detection signals | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §9 | Architect-owned |
| Roadmap and phase scope | `BUILD-ROADMAP_v1.0.md` (replaces TECH-ARCH §12 per its §1.4) | A phase flips only with the work that passes its gate |
| Acceptance criteria | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §13 | Architect-owned |
| What was carried from the old repo and what was not | `REPO-EXTRACTION-BRIEF_v1.1.md` (intent) · `../EXTRACTION-REPORT.md` (what actually happened) | The report wins on facts; the brief wins on intent |
| **Architecture diagrams: trust boundaries, the entry path, the pool's life, settlement, the money model, keys, where the data lives, deploying** | `ARCHITECTURE-DIAGRAMS.md` | Architect-owned. Annotated Mermaid views drawn from the code; canonical for nothing, and `AS-BUILT.md` wins wherever a figure and it disagree |
| **Infrastructure map: every vendor, what each does, what talks to what, and the monthly cost forecast** | `INFRASTRUCTURE.md` | Architect-owned. Prices dated (read from the vendors 2026-09-11) and on-chain costs measured on devnet the same day; `hosting.md` keeps the ports, health checks and webhook settings, `go-live-devnet.md` the founder's dashboard settings |
| Keys, custody, infrastructure provisioning | `OPERATING-MANUAL.md` §8 (who holds what today) · `hosting.md` (the topology) · `REPO-TRANSITION-PLAYBOOK.md` (intent) · `../TRANSITION-REPORT.md` (**the Phase 0 record only — it predates every deployment**) | The manual wins on current state; the report wins on what was carried and decommissioned |
| Territory availability schedule (allowed + blocked lists) | `../config/territories.json` | FOUNDER-OWNED contents (R2/D-B3); schema + fail-closed semantics in `backend/packet/src/territories.ts`. Never edit the lists without a founder instruction |
| Terms / attestation version (the D-B4 clickwrap) | `../config/terms.json` | FOUNDER-OWNED. Bumping `version` re-prompts every wallet and invalidates old attestation records at packet issuance; any wording change to the clickwrap is a new version by definition |
| Reviewer wallets (the C10 review service's member list) | `../config/reviewers.json` | FOUNDER-OWNED. The operating multisig's member keys. Shipped empty; the devnet reviewer was ratified 2026-09-06 (the founder's wallet). No decision verifies while the list is empty, and the review service says so at startup. Log row format: `backend/detection/src/review.ts` |
| Custody disclosure (the C13 page's values) | `../config/custody.json` | FOUNDER-OWNED. Upgrade authority, n-of-m, timelock, key holders; null renders "not yet set" — the page never invents a number |
| Prize treasury: fixed pots, sequential pools, policy floor, the one treasury exit | Register row **D-A1 (revised)** in `BUILD-ROADMAP_v1.0.md` (design) · `../programs/blotto_cup/src/constants.rs` (the launch price/pot tables) · `phase-reports/step-treasury.md` (judgement calls) | Prices/pots are founder-owned numbers, changed only via `set_tier_economics`; the treasury report replays from published events (`GET /treasury`) |
| Agent role and hard rules | `../CLAUDE.md` | Points here for everything it does not own |
| Contribution process, hooks, the word grep | `../CONTRIBUTING.md` | Canonical for process |
| Skill-evidence study: strategy ladder, parameters, published outcome statistics | `skill-evidence/REPORT.md` (results) · `../tests/rehearsal/strategies/README.md` (ladder rationale) | GENERATED — regenerate with `npm run skill-evidence` in `tests/rehearsal`; the nightly CI lane fails on drift. Never edit by hand |

## Reading order

1. `../CLAUDE.md` — role, hard rules, tradeoff order.
2. **This file** — find the canonical document for the subject at hand.
3. `PID_Blotto-Cup_v0.5.md` — what the product is and why. Read §1, §3, §4 and §8 in full before
   touching game or pass code; §8.4 and §8.7 are load-bearing for the legal position.
4. `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` — how it is built.
5. **The code on the branch.** Docs say what the project intends; the branch says what it is.

## Known conflicts between the canon documents

The build roadmap's §1.3/§1.4 is the authoritative list of everything it changes in
TECH-ARCH v0.2 (payout model, Config/Pool fields, TypeScript scoring, no partial
fill, §12 replaced). Those are ratified decisions, not open conflicts — TECH-ARCH
v0.3 absorbs them.

### The PID is behind the build (recorded 2026-09-07; founder-owned to fix)

The E1 decisions of 2026-09-06 and the founder rulings of 2026-09-07 changed the
prize structure, the prize amounts, the fill deadline and the minimum field.
`PID_Blotto-Cup_v0.5.md` has not been reissued since, so the founder's own
product document — and the one counsel reads — now describes a materially
different competition from the one that is built. **Nobody may edit the PID but
the founder**, so every divergence is listed here instead, for a single v0.6
pass. `AS-BUILT.md` §5 carries the same table with the code-side detail.

| PID location | Says | The build, since |
|---|---|---|
| §1 summary, §6 heading and table, §2 table, §7 flow diagram | Top 16 paid; the prize pool is 80% of entries; the platform retains 20% | **One paid place** (D-E2, 2026-09-06). Pots are fixed constants funded from the treasury before entries open; the operator's margin is entries minus the pot |
| §2 table | Prize pools 5.12 / 25.60 SOL | **4 / 20 / 30 / 40 / 100 / 200 / 300 SOL** across seven tiers (D-E1, 2026-09-06) |
| §2 pool-cadence paragraph | Fill deadline 72 hours; 32–63 entrants run at reduced size; fewer than 32 refunds | **12 hours** (D-E6); **52–63 run**, fewer than 52 refunds (D-E4) |
| §5 | Prose implies entry order can affect ranking | Entry order decides only the indivisible remainder and the published leaf order. Rank comes from battles won then stats won (D3-B) |
| §8.3 evidence table | "Paid 16 who are genuinely top-16" | One paid place. The skill evidence needs restating as a rank-1 rate |
| §1 summary | "Unflagged winners claim immediately" | There is no claim step; prizes are pushed (R10) |

### TECH-ARCH v0.2 is behind the build

It has not been reissued since August 2026. Read it for intent, and `AS-BUILT.md`
for what exists. The divergences that would mislead a reader:

- **§10 describes "five steppers with quick-set chips 0/25/50/75/100".** Stale and
  overridden by PID v0.5 §4: the allocation interaction is a draggable pentagon
  with live normalisation, no chips, no presets, and "Even split" as the only
  button. PID §4.3 explains why — any prominent discrete target clusters the
  population and drives the draw rate up.
- **The instruction table says `register` splits 80/20 between vault and
  platform.** It credits 100% to the treasury; the pot was moved into the vault at
  `open_pool`, before any entry, and `register` cannot touch a vault at all.
- **§3.2 and §13 describe a `claim` instruction and a claim step.** Neither
  exists; prizes are pushed.

## Where history lives

- **`reference/`** — decision records exported from the predecessor repository, for design context
  only. Each carries a header marking it as an export, superseded by Blotto Cup docs where they
  conflict. **Nothing here is authoritative.** Never cite a reference export as the
  reason for a decision — cite the PID or the architecture doc.
- **`archive/`** — superseded Blotto Cup documents kept as evidence. Nothing here is authoritative
  either. See `archive/README.md`.
- **`phase-reports/`** — one report per completed step: what was built, the
  judgement calls made under uncertainty, and the numbers as they stood *that
  day*. They are a record of decisions, **not a description of the current
  build**, and several carry superseded tables (the top-sixteen prize bands and
  the 80% pot in `step-tiers-and-ties.md`, the paid-seat rates in
  `step-skill-evidence.md`). Cite one for *why* something was done; never for
  *what the system does now* — that is `AS-BUILT.md`.
- **`design/flows/`** — the founder's screen mockups, one per surface.

`reference/` and `archive/` are excluded from the CI word grep precisely because they are
historical. Every other directory in this repository is live and must pass it.

## What is in `reference/`

| File | What it is | Why it was carried |
|---|---|---|
| `adr-002-solana-skill-knowledge-source.md` | The Solana Foundation dev skill as the canonical current-idiom source; framework choice deferred per component | The "skill wins at execution time" posture is carried into `CLAUDE.md` |
| `adr-003-metaplex-core.md` | Metaplex Core as the NFT standard | The character pass is a Core asset |
| `adr-021-bag-without-replacement-draw.md` | Bag-without-replacement weighted draw | The class draw is this algorithm, over five classes instead of six tiers |
| `adr-026-multi-source-randomness.md` | Multi-source randomness digest | The class digest is this, plus `player_pubkey` as a fifth input |
| `adr-027-collection-freeze-propagation.md` | **Partial export.** Collection-level freeze propagates to member assets | The pass is non-transferable by this mechanism. The "single-CPI unfreeze" half of the original ADR is deliberately **not** carried |
| `q-016-verification-note.md` | The devnet run behind ADR-027, including the `0x9` error signature | `tests/pass.ts` asserts against this signature |
| `threat-tm-401.md` | PDA seed collision | Distinct seed prefix per PDA type |
| `threat-tm-402.md` | Missing signer check on privileged instructions | Signer + constraint discipline |
| `threat-tm-403.md` | Numerical overflow/underflow | Integer-only math, `u128` intermediates, `overflow-checks = true` |
| `threat-tm-502.md` | VRF callback failure or compromise | The VRF commit path carries this residual risk verbatim |

Nothing else from the old repo's `docs/` was exported. The old PRD, roadmap, glossary, non-goals and
everything under its `frontend/`, `qa/` and `changelog/` directories describe a different product
and were deliberately left behind.

## How to add a new document

1. **One subject, one owner.** If the subject already has a canonical home, add to that document.
2. **List it in this file, in the same change.** An unlisted document has no authority and will drift.
3. **Carry no status another document owns.** Point at it instead.
4. **It must pass the word grep** unless it lives in `reference/` or `archive/`.
