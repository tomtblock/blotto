# Blotto Cup — documentation index and source-of-truth map

Read this before anything else. **If two documents disagree, the one marked canonical for that
subject wins and the other is wrong — fix the other.** No document restates a fact another document
owns; everywhere else a fact appears, it appears as a pointer.

## Source-of-truth table

| Subject | Canonical document | Update rule |
|---|---|---|
| **Phase order, step scope, gates, and the ratified decision register (R1–R21)** | `BUILD-ROADMAP_v1.0.md` | Founder-ratified 2026-08-26. **Where it and TECH-ARCH v0.2 disagree, the roadmap wins** — the deltas are its §1.3/§1.4, to be absorbed into TECH-ARCH v0.3 |
| Product intent, game design, prizes, legal characterisation | `PID_Blotto-Cup_v0.5.md` | Founder-owned. Superseded only by a later PID version |
| The allocation interaction (pentagon radar, live normalisation, "Even split") | `PID_Blotto-Cup_v0.5.md` §4 | Founder-owned. **Overrides** TECH-ARCH §10 — see the conflict note below |
| Forbidden and preferred language | `PID_Blotto-Cup_v0.5.md` §8.7, as amended by register row D-B7 (full list in `../CONTRIBUTING.md` → "The language gate") | Founder + counsel. Enforced by the CI word grep |
| System architecture, accounts, instructions, events, constants | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` | Architect-owned |
| Scoring algorithm and ranking | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §6 | Architect-owned |
| Sealing lifecycle and failure modes | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §5 | Architect-owned |
| Detection signals | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §9 | Architect-owned |
| Roadmap and phase scope | `BUILD-ROADMAP_v1.0.md` (replaces TECH-ARCH §12 per its §1.4) | A phase flips only with the work that passes its gate |
| Acceptance criteria | `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §13 | Architect-owned |
| What was carried from the old repo and what was not | `REPO-EXTRACTION-BRIEF_v1.1.md` (intent) · `../EXTRACTION-REPORT.md` (what actually happened) | The report wins on facts; the brief wins on intent |
| Keys, custody, infrastructure provisioning | `REPO-TRANSITION-PLAYBOOK.md` (intent) · `../TRANSITION-REPORT.md` (state) | The report wins on facts |
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
v0.3 absorbs them. One older conflict remains recorded here so nobody resolves it
the wrong way:

- **TECH-ARCH §10 still describes "five steppers with quick-set chips 0/25/50/75/100".**
  That sentence is **stale and overridden by PID v0.5 §4**: the allocation interaction is a
  draggable pentagon radar with live normalisation, no quick-set chips, no presets, and "Even split"
  as the only button. PID §4.3 explains why — any prominent discrete target clusters the population
  and drives the draw rate up. Build to the PID. TECH-ARCH §10 should be corrected in its next
  revision.

## Where history lives

- **`reference/`** — decision records exported from the predecessor repository, for design context
  only. Each carries a header marking it as an export, superseded by Blotto Cup docs where they
  conflict. **Nothing here is authoritative.** Never cite a reference export as the
  reason for a decision — cite the PID or the architecture doc.
- **`archive/`** — superseded Blotto Cup documents kept as evidence. Nothing here is authoritative
  either. See `archive/README.md`.

Both directories are excluded from the CI word grep precisely because they are historical. Every
other directory in this repository is live and must pass it.

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
