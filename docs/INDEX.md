# Blotto Cup — documentation index and source-of-truth map

Read this before anything else. **If two documents disagree, the one marked canonical for that
subject wins and the other is wrong — fix the other.** No document restates a fact another document
owns; everywhere else a fact appears, it appears as a pointer.

## Source-of-truth table

| Subject | Canonical document | Update rule |
|---|---|---|
| **What the system actually is — services, program, money model, and what is not built** | `AS-BUILT.md` | Architect-owned. Written from the code; re-verified against a green suite whenever it changes. **Where it and TECH-ARCH v0.2 disagree, this file is right about what exists** and TECH-ARCH is right about what was intended |
| **Every fact about the product, with the line of code or the ratified row it comes from** | `../01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md` | Architect-owned, written for counsel and auditors. Restates only facts whose numbers live in code or a ratified register, each citing its source. **Its maintenance rule binds: when a source changes, this file changes in the same change set or the claim comes out** |
| **The brief for counsel — the game, the mechanism, every guardrail with its enforcing file, the law as the client reads it, the prior desk studies, the entity question, and what is not yet in place** | `counsel-brief/COUNSEL-BRIEF_Blotto-Cup_v1.md` | Architect-owned, written for a lawyer instructed to opine. **Dated by design** — it reads one commit (`02a036c`) and a later brief gets its own file. It is the one live document that uses the §8.7 vocabulary, because a brief on the statutory tests cannot avoid them; `scripts/check-language.sh` excludes the directory for that stated reason, and nothing in it may be quoted on a player-facing surface. Where it and `../01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md` disagree on a fact, the product-facts file is right and this one is stale |
| The mechanism explained without code, one page | `HOW-IT-WORKS.md` | Architect-owned, written to the §8.7 language rules so it is safe to hand to counsel, an investor or a candidate. States what happens; it makes no claim about what the product legally is, and must not start |
| Running it — deploys, admin transactions, incidents, keys | `OPERATING-MANUAL.md` | Architect-owned; the founder owns the standing rules inside it |
| Opening an entry tier — the preconditions, the order, and the two refusals that stand in the way | `RUNBOOK_open-tier.md` | Founder-facing. `set-open-tiers` is the only thing that changes `Config.open_tiers`; the runbook owns the sequence around it, not the tier table (`../programs/blotto_cup/src/constants.rs`) or the R6 preconditions (the roadmap) |
| Deploying the fill-rule change — the upgrade, the per-pool migration, and the order they go in | `RUNBOOK_r7b-upgrade.md` | Founder-facing. One-off, retired once every deployment's pools are at the current layout; the rule itself is register row R7-b |
| How often a pool actually runs under the 40-at-12h rule | `CHANGE-2026-09-12_sim-report.md` | GENERATED — re-run `scripts/sim/fill-replay.ts --write`. Never edit by hand; its self-test runs in CI |
| Going live on devnet — the founder's ordered checklist (Helius, GitHub, Vercel, Privy, Squads, testers, pausing) | `go-live-devnet.md` | Founder-facing; `deploy-backend.md`, `hosting.md` and `deploy-vercel.md` hold the detail it points at |
| Deploying the app itself — why "Root Directory = app" fails, and what the build actually needs | `deploy-vercel.md` | Architect-owned. `hosting.md` owns the topology and the ports; this owns the app build alone |
| The credentialed devnet rehearsal — order of operations, the role split, the verification | `devnet-rehearsal-runbook.md` | Founder-facing and **part record**: sections describing a run that happened are dated in place rather than rewritten. `devnet-rehearsal.md` stays canonical for the admin CLI's worked examples and the OFFLINE rehearsal CI runs |
| The offline rehearsal and the admin CLI's worked examples | `devnet-rehearsal.md` | Architect-owned |
| The pre-mainnet program review (roadmap 5.5, the R5 substitute) | `internal-review.md` | Architect-owned and **dated by design**: it reviews one branch head. A later review gets its own file |
| The live skill statistics served from real tournaments | `skill-evidence/LIVE-ENDPOINTS.md` | Architect-owned. The committed study (`skill-evidence/REPORT.md`) is the simulated exhibit; these three endpoints are its live counterpart and update without curation |
| What the branch and the chain held before the 2026-09-12 instruction | `CHANGE-2026-09-12_preflight.md` | **HISTORICAL.** A snapshot taken to plan that change, kept so the four changes can be read against what they found. Never updated |
| The 2026-09-13 UI change — what was asked, the two sealing leaks it found, the dial-lock rule with worked examples, and the decisions the founder still owns | `CHANGE-2026-09-13_ui.md` | **HISTORICAL.** A change report written from the branch it describes, kept so the surfaces can be read against the brief. Its copy is a proposal until the founder ratifies it (`PHASE-N-REVIEW` in `app/src/copy/index.ts`). Never updated |
| The 2026-09-14 `www` origin block and the welcome note's re-voicing | `CHANGE-2026-09-14_geo-and-welcome.md` | **HISTORICAL**, with one live instruction: §3 is the founder action that fixes the block and is not applied until they run it. The territory copy it discusses stays owned by founder instruction 2026-09-12 §3.3.1 |
| The 2026-09-15 removal of the reveal, and the rarity ladder shown on the profile only | `CHANGE-2026-09-15_reveal-and-rarity.md` | **HISTORICAL.** A change report written from the branch it describes: the founder's instructions with their dates, the Common→Mythic mapping onto the unchanged on-chain bag, the §8.4 ruling on the caveat wording, and the tests deleted with their modules, named. PID v0.5 §3 still carries the creature names until the founder reissues it |
| The 2026-09-16 data-minimisation change — the inventory of what the platform holds, the four rulings, the cheap set that shipped, and what was designed and deferred | `CHANGE-2026-09-16_data-minimisation.md` | **HISTORICAL**, with two live lists: §7 (copy proposals and the D-E16 register row, pending the founder) and §8 (the privacy notice and retention periods with counsel; the private appeal grounds and the two-box key split, designed and deferred). The sealed boxes have no public reader from this change on |
| The 2026-09-16 UI uplift — the back pages on the pink field with marquee headings, the homepage lock, the pool card's Blott, the pool page's conveyor rails, and the blender seal stage; the Higgsfield assets and the Figma frames behind them | `CHANGE-2026-09-16_ui-uplift.md` | **HISTORICAL** once merged, with one live list: §A14's decisions and every `PHASE-N-REVIEW` string it names are proposals until the founder ratifies them. §A is the approved plan, §B the report written from the branch |
| The 2026-09-19 terms of service, privacy notice and complaints route — the named reviewer out of the player-facing product, and the two mechanisms the new clauses stand on | `CHANGE-2026-09-19_terms-privacy-complaints.md` | **HISTORICAL** once merged, with three live lists: §5 (what is NOT built — the operator's write path for a complaint's status, and the unenforced "someone other than" undertaking, both also in `PRODUCT-FACTS` §9), §6 (the founder's decisions, `config/operator.json` first and blocking) and the draft status of every string in `app/src/copy/terms.ts` and `privacy.ts`. The documents are in the repository and the pages render; the draft caveat lives in the report, never on the page |
| **Open items, amber warnings, attack vectors, and the Road to Mainnet checklist** | `AUDIT-2026-09-07.md` | Architect-owned. Dated by design: a later audit gets its own file and this one becomes history. The Open Items and Road to Mainnet sections are the live lists until then |
| **The 2026-09-11 cold-read audit, what was changed in answer to it, and the plan to green** | `../AUDIT_2026-09-11.md` (the findings) · `../AUDIT_2026-09-11_RESPONSE.md` (PR #106's side-by-side, the appraisal, one addendum per wave) · `../AUDIT_2026-09-11_PLAN.md` (blockers, founder decisions, the batched backlog, sequencing, verification) | Architect-owned. The audit is frozen as written; the response is the running ledger; the plan is founder-approved 2026-09-12 and its waves close in the response's addenda |
| **The 2026-09-16 review of the code against every document that makes a legal claim** | `COMPLIANCE-REVIEW-2026-09-16.md` | Architect-owned. **Dated by design** — it reviews one branch head (`3cd0ec7`) and is canonical for nothing but its own findings; a later review gets its own file. Scoped to the legal position, the published claims and what a player can recompute. **It is NOT the live open-items list** — `AUDIT-2026-09-07.md` keeps that, and this review points at its rows rather than restating them. Written to the §8.7 lexicon like every other live document, so where it would name a legal category it points at PID §8 |
| **Phase order, step scope, gates, and the ratified decision register (R1–R21, D-A…D-E)** | `BUILD-ROADMAP_v1.0.md` | Founder-ratified 2026-08-26. **Where it and TECH-ARCH v0.2 disagree, the roadmap wins** — the deltas are its §1.3/§1.4. The register rows are current; the phase step tables are the plan as ratified and are not updated as the build moves past them |
| Product intent, game design, prizes, legal characterisation | `PID_Blotto-Cup_v0.5.md` | Founder-owned. Superseded only by a later PID version. **Materially behind the build since 2026-09-06 — see the conflict list below**, and read its 2026-09-13 appendix with it |
| A PROPOSED v0.6 of the above | `PID_Blotto-Cup_v0.6-DRAFT.md` | **A draft, canonical for nothing.** Architect-prepared 2026-09-13 so the founder can adopt, amend or reject three months of decisions in one pass. §8 is carried from v0.5 verbatim and is expressly NOT proposed — it is founder-and-counsel-owned, and the two places it is behind the build are flagged in the draft. v0.5 remains the PID until the founder says otherwise |
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
| Territory availability schedule (allowed + blocked lists) | `../config/territories.json` (the schedule) · `../config/territories.README.md` (one row per code: the PID §9 line it implements, and what is still held and why) | FOUNDER-OWNED contents (R2/D-B3); schema + fail-closed semantics in `backend/packet/src/territories.ts`, and `scripts/check-territories.ts` fails CI when the two files disagree or the schedule is not enforceable. Never edit the lists without a founder instruction |
| Terms / attestation version (the D-B4 clickwrap) | `../config/terms.json` | FOUNDER-OWNED. Bumping `version` re-prompts every wallet and invalidates old attestation records at packet issuance; any wording change to the clickwrap is a new version by definition |
| Reviewer wallets (the C10 review service's member list) | `../config/reviewers.json` | FOUNDER-OWNED. The operating multisig's member keys. Shipped empty; the devnet reviewer was ratified 2026-09-06 (the founder's wallet). No decision verifies while the list is empty, and the review service says so at startup. Log row format: `backend/detection/src/review.ts` |
| Wallet blocklist (the addresses refused an entry) | `../config/blocked-wallets.json` (the list) · `../config/blocked-wallets.README.md` (one row per address: the enumerated ground relied on and the date) | FOUNDER-OWNED contents; the mechanism behind the terms clause "Refusing entry and withholding a prize". Schema + fail-closed semantics in `backend/packet/src/blocked-wallets.ts` (the only parser); `scripts/check-blocked-wallets.ts` fails CI when an address has no recorded ground or a row cites a ground the terms do not enumerate. Shipped empty. Never edit the list without a founder instruction |
| Operator identity — the entity, its addresses, the governing law and the supervisory authority | `../config/operator.json` | FOUNDER-OWNED. Named by the terms of service and the privacy notice; every key ships `null` and both pages render "not yet set", exactly as the custody page does for its timelock. `scripts/check-operator-identity.ts` requires the schema on every cluster and **refuses a mainnet deploy while any value is null**. Filling it in is a one-file founder action once the operating entity exists |
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

**A founder-authorised appendix was added to the PID on 2026-09-13** and already
annotates the first three rows below. It does not touch §1, §5, §7, §8 or §9, so
the body a reader meets first is still the old product — the appendix narrows
this table, it does not close it. The ✓ column says which rows it covers.

| ✓ | PID location | Says | The build, since |
|---|---|---|---|
| ✓ | §2 table, §6 heading and table | Top 16 paid; the prize pool is 80% of entries; the platform retains 20% | **One paid place** (D-E2, 2026-09-06). Pots are fixed constants funded from the treasury before entries open; the operator's margin is entries minus the pot |
| ✓ | §2 table | Prize pools 5.12 / 25.60 SOL | **4 / 20 / 30 / 40 / 100 / 200 / 300 SOL** across seven tiers (D-E1, 2026-09-06) |
| ✓ | §2 pool-cadence paragraph | Fill deadline 72 hours; 32–63 entrants run at reduced size; fewer than 32 refunds | **12 hours** (D-E6); **40–63 run**, fewer than 40 refunds (D-E4 as amended by R7-b, 2026-09-12) |
| | §1 summary, §7 flow diagram | Top 16, the 80/20 split, "unflagged winners claim immediately", and a `<32 → refund` branch — four errors in the opening paragraph and the money diagram | As above, and there is **no claim step**: prizes are pushed (R10) |
| | §4.6 | "The program rejects anything else" of a bad allocation | The program never sees an allocation. The client and the scoring engine are the two enforcement points |
| | §5 | Prose implies entry order can affect ranking | Entry order decides only the indivisible remainder and the published leaf order. Rank comes from battles won then stats won (D3-B) |
| | §4.5 evidence table (cited by §8.3) | "Paid 16 who are genuinely top-16" | One paid place. The skill evidence needs restating as a rank-1 rate |
| | §8.1, §8.5 | "the operator retains 20%" — §8.5 is headed "The 20%" | Margin is entries minus the fixed pot: `1 − 40/seats` of intake, nil at the 40-seat floor and 37.5% at a full 64. **This is the section counsel reads** |
| | §9 | A blocked list including the US states and sanctioned jurisdictions | `config/territories.json` carries fifteen country codes. **`US` is blocked at country level** (D-B3-3, 2026-09-21) — wider than §9’s twelve states, because the twelve are not enforceable; the sanctions row is still held, for the separate reason in `config/territories.README.md` |
| | §10 C5, C8; §11 D4 | "Merkle claim", "KYC at claim", "claim window (30d)" | No claim step exists, so none of the three has a referent. The KYC switch is off at launch |
| | §10 C9 | "staffed 24h review" | The published window is **12 hours**; the program's permissionless safeguard is **7 days** and is never published as the deadline |

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
- **§3.2 names the vault's exits as `claim`, `refund`, `sweep_unclaimed`.** Two
  of those three do not exist and all four real ones are missing. The exit set
  is `pay_prizes`, `release_escrow`, `pay_next_place`, `refund`, and
  `scripts/check-standing-rules.sh` asserts exactly that on every change. This
  is the most dangerous line in the document.
- **§2 declares `MIN_FILL = 32` and `POT_BPS = 8000`.** The minimum field is
  **40** and is carried per pool; there is no bps constant at all, because a pot
  is never a proportion of anything — CI greps for that arithmetic and fails on
  it.
- **§6 specifies a shared Rust crate with a WASM build.** The scoring engine and
  the results tree are TypeScript (`backend/scoring/`), run unchanged by the
  crank and the browser. No WASM exists anywhere in the repository (R20).
- **§11 says a flag goes to 24-hour human review.** The published window is 12
  hours; the on-chain permissionless safeguard is 7 days.
- **§9 requires two independent signals before a flag.** Detection is advisory:
  the daemon flags nothing, and a flag is only ever a named reviewer's signed
  decision.

`INDEX.md` cannot carry the whole list — the document's own dated appendix does,
at the end of `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md`.

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
| `q-016-verification-note.md` | The devnet run behind ADR-027, including the `0x9` error signature | `tests/litesvm/tests/vrf_and_freeze.rs` asserts against this signature (it was `tests/pass.ts` when the note was written) |
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
