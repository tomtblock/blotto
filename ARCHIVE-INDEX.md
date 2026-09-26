# Internal document archive — PRIVATE, never publish

This branch (`archive/internal-docs`) is a frozen snapshot of the repository as it stood on
2026-09-26, just before the public-release cleanup (commit `8dcf77d`). It keeps every internal
document that was removed from the public docs, exactly as it was. **Nothing on this branch is
maintained**: the current, public documents live on `main` under `docs/`.

Do not merge this branch, and do not copy it into the public submission repository. Several
documents here contain legal strategy, entity and personal details, key locations and costs.

## Legal and compliance (most sensitive)

| Document | What it is |
|---|---|
| [Counsel brief](docs/counsel-brief/COUNSEL-BRIEF_Blotto-Cup_v1.md) | The brief written to instruct a lawyer: the mechanism, every guardrail, the law as read, the entity question |
| [Compliance review, 2026-09-16](docs/COMPLIANCE-REVIEW-2026-09-16.md) | The code checked against every document that makes a legal claim; the legal-readiness gap list |
| [Product facts (as of the snapshot)](01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md) | The fact sheet for counsel and auditors, before its public rewrite |

## Product and plans

| Document | What it is |
|---|---|
| [PID v0.5](docs/PID_Blotto-Cup_v0.5.md) | The original product design document, including §8 (legal characterisation) and §9 (entity and territories) |
| [PID v0.6 DRAFT](docs/PID_Blotto-Cup_v0.6-DRAFT.md) | The proposed update folding in the build's decisions; awaiting your decision |
| [PID v0.3 (Word)](docs/archive/PID_Blotto-Cup_v0.3.docx) | An earlier version |
| [Build roadmap v1.0](docs/BUILD-ROADMAP_v1.0.md) | Phases 0–6, step tables, gates and the full decision register, including the entity row |
| [Tech architecture v0.2](docs/TECH-ARCHITECTURE_Blotto-Cup_v0.2.md) | The architecture as designed in August, with its later appendix |
| [As-built (as of the snapshot)](docs/AS-BUILT.md) | What existed on 2026-09-26 before the public rewrite |
| [Docs index (as of the snapshot)](docs/INDEX.md) | The old source-of-truth map, including the PID divergence table |
| [Handover, 2026-08-27](docs/archive/HANDOVER_2026-08-27.md) | An early handover note |

## Audits and reviews

| Document | What it is |
|---|---|
| [Cold-read audit, 2026-09-11](AUDIT_2026-09-11.md) | The full findings (every severity) |
| [Audit response ledger](AUDIT_2026-09-11_RESPONSE.md) | What was changed in answer to it, wave by wave |
| [Audit plan](AUDIT_2026-09-11_PLAN.md) | The approved plan to green, with your decisions |
| [Repository audit, 2026-09-07](docs/AUDIT-2026-09-07.md) | The first audit: open items, amber warnings, attack vectors, road to mainnet |
| [Pre-mainnet program review](docs/internal-review.md) | The IR-1 to IR-4 program review |

## Operations, keys and infrastructure

| Document | What it is |
|---|---|
| [Operating manual (as of the snapshot)](docs/OPERATING-MANUAL.md) | Including who holds which key |
| [Credentialed devnet rehearsal runbook](docs/devnet-rehearsal-runbook.md) | The key register, recovery notes and the stage-by-stage devnet setup |
| [Go-live checklist (devnet)](docs/go-live-devnet.md) | Your dashboard-by-dashboard setup: RPC provider, GitHub, Vercel, Privy, Squads |
| [Infrastructure and costs](docs/INFRASTRUCTURE.md) | Every vendor and the monthly cost forecast |
| [Hosting](docs/hosting.md) · [Backend deploy](docs/deploy-backend.md) · [App deploy](docs/deploy-vercel.md) | The original deploy guides |
| [Runbook: opening a tier](docs/RUNBOOK_open-tier.md) · [R7-b upgrade](docs/RUNBOOK_r7b-upgrade.md) · [Phase B window](docs/RUNBOOK_phase-b-window.md) | One-off and standing runbooks |
| [Offline rehearsal and admin CLI](docs/devnet-rehearsal.md) | Before its public rewrite |
| [Transition report](TRANSITION-REPORT.md) · [Extraction report](EXTRACTION-REPORT.md) | Phase 0: the fresh repository, keys, and what was carried from the predecessor |
| [Extraction brief](docs/REPO-EXTRACTION-BRIEF_v1.1.md) · [Transition playbook](docs/REPO-TRANSITION-PLAYBOOK.md) | The Phase 0 instructions |

## The devnet battle test

| Document | What it is |
|---|---|
| [Manual](battle-test/MANUAL.md) | The trial's plan and procedures |
| [Drift log](battle-test/DRIFT.md) | Every finding, §A–G (manual vs code) and §H1–H28 (execution) |
| [Run log](battle-test/LOG.md) | The timestamped record of the whole trial |
| [Your action list](battle-test/FOUNDER-ACTIONS.md) | Every step and ruling the trial needed from you |
| [State snapshot](battle-test/STATE.md) · [Report](battle-test/REPORT.md) · [Results](battle-test/RESULTS.md) | Where the trial stood, before the public rewrite |
| [Seal-lockout fix](battle-test/docs/FIX-seal-lockout.md) | The fix specification and its as-shipped notes |

## Change reports (why each change was made)

| Date | Report |
|---|---|
| 2026-09-12 | [Preflight snapshot](docs/CHANGE-2026-09-12_preflight.md) · [Fill simulation](docs/CHANGE-2026-09-12_sim-report.md) |
| 2026-09-13 | [UI change](docs/CHANGE-2026-09-13_ui.md) |
| 2026-09-14 | [Geo block and welcome note](docs/CHANGE-2026-09-14_geo-and-welcome.md) |
| 2026-09-15 | [Reveal removed, rarity ladder](docs/CHANGE-2026-09-15_reveal-and-rarity.md) |
| 2026-09-16 | [Data minimisation](docs/CHANGE-2026-09-16_data-minimisation.md) · [UI uplift](docs/CHANGE-2026-09-16_ui-uplift.md) |
| 2026-09-19 | [Terms, privacy notice, complaints](docs/CHANGE-2026-09-19_terms-privacy-complaints.md) |
| 2026-09-22 | [Complaint answers and database TLS](docs/CHANGE-2026-09-22_complaint-answers-and-db-tls.md) |
| 2026-09-24 | [Battle board and hard mode](docs/CHANGE-2026-09-24_battle-board.md) · [Database-URL preflight](docs/CHANGE-2026-09-24_database-url-preflight.md) · [Sign-in review](docs/CHANGE-2026-09-24_signin-review.md) |

## Phase and step reports

One report per build step, with the judgement calls made at the time:
[`docs/phase-reports/`](docs/phase-reports/).

## Design records (predecessor exports, before their rewrite)

[`docs/reference/`](docs/reference/)
