# Step report — skill evidence (`step/a2-skill-evidence`, D-A2)

**Status: delivered.** First item of the 2026-08-27 master build prompt
(§3 A2), executed on `main` after PR #3. This PR also records the master
prompt's ratified decisions (D-A1, D-A2, D-B3, D-B4, D-B6, D-B7, D-C) as
register rows in `docs/BUILD-ROADMAP_v1.0.md` §1.2 — recorded once here, so
later steps point at the register instead of restating.

## What was built

- **The strategy ladder** (`tests/rehearsal/src/ladder.ts`, documented in
  `tests/rehearsal/strategies/README.md`): `uniform` (the untouched
  pentagon), `random` (valid free-integer allocations), `heuristic`
  (three-stat concentration, steep 38/31/21 split over 6/4), `optimised`
  (one-upped 39/32/22 over 4/3, per-entrant trio rotation over all ten
  trios, wider seeded jitter). All classes emit only valid allocations and
  are deterministic per (class, seed) — sha256 streams, no clock, no
  `Math.random`.
- **The study runner** (`tests/rehearsal/src/skill-evidence.ts` +
  `skill-evidence-run.ts`, `npm run skill-evidence`): 200 pools × 64
  entrants (16 per class, seat order seeded-shuffled per pool) through the
  REAL settlement crank over `FakeChain`, full D3-B split-pot settlement.
  Conservation asserted on every pool. All statistics computed in bigint and
  formatted to fixed-decimal strings at the end — no float touches a lamport
  or a derived share.
- **Published artifacts**: `docs/skill-evidence/results.csv` +
  `docs/skill-evidence/REPORT.md`, generated (never hand-edited), with the
  base seed (20260827) and reproduction command inside.
- **Nightly CI lane** (`.github/workflows/skill-evidence.yml`, cron + manual
  dispatch, NOT per push): re-runs the full study with
  `SKILL_EVIDENCE_CHECK=1` and fails if a fresh run no longer reproduces the
  committed artifacts byte for byte — an engine change that shifts outcomes
  must land with regenerated evidence.
- **Specs** (`tests/rehearsal/test/skill-evidence.spec.ts`, in the per-push
  suite): ladder validity + determinism, population composition, study
  determinism on a 6-pool sample, conservation, and the one ordering robust
  at small sample size (optimised over uniform).

## The measured result (200 pools, base seed 20260827)

| Class | Rank-1 rate | Paid-seat rate | Eliminated | Mean payout share of pot |
|---|---|---|---|---|
| uniform | 0.000% | 0.00% | 100.00% | 0.0000% |
| random | 0.000% | 0.21% | 99.78% | 0.0064% |
| heuristic | 1.125% | 34.43% | 65.56% | 1.6633% |
| optimised | 5.125% | 65.34% | 34.65% | 4.5802% |

Monotone across the ladder on every metric; the pot conserved exactly in
all 200 pools (1,024,000,000,000 lamports assigned in total). The report
itself makes no claim beyond its measured table.

## File changes

- `tests/rehearsal/src/ladder.ts` — new.
- `tests/rehearsal/src/skill-evidence.ts`, `src/skill-evidence-run.ts` — new.
- `tests/rehearsal/strategies/README.md` — new (ladder rationale).
- `tests/rehearsal/src/strategies.ts` — `GeneratedEntrant.strategy` widened
  from the rehearsal union to `string` (ladder classes reuse the type; no
  external consumer read the union).
- `tests/rehearsal/src/orchestrator.ts` — `runOfflinePool(poolSeed,
  options?)` gains `{ population?, detect? }`; defaults preserve the
  existing rehearsal behaviour exactly.
- `tests/rehearsal/test/skill-evidence.spec.ts` — new.
- `.github/workflows/skill-evidence.yml` — new nightly lane.
- `docs/skill-evidence/` — generated artifacts, committed.
- `docs/BUILD-ROADMAP_v1.0.md` — register rows D-A1…D-C appended (one-time).
- `docs/INDEX.md` — skill-evidence row (generated, never hand-edited).

## Judgement calls

1. **Detection is OFF for study runs** (an explicit `detect: false` option
   on the orchestrator, defaulting on). Sixteen uniform entrants have
   identical battle sets by construction; the duplicate-set hard block would
   escrow them and distort the statistics being measured. The rehearsal
   suite proper keeps detection on.
2. **The ladder is separate from the 5.1 rehearsal strategies.** Those
   population shapes exist to exercise detection signals; mixing the two
   purposes in one module would blur both. Both live in `tests/rehearsal`.
3. **"Optimised" means tuned against this study's field**, stated plainly in
   the README — allocation games of this shape are non-transitive and the
   report claims nothing beyond its measured table.
4. **The nightly lane checks reproduction, not just completion.** A drift
   between a fresh run and the committed CSV is the useful signal; a green
   "it ran" would catch nothing.
5. **CSV over any JSON array format** for the committed data — rows are
   unbracketed by construction, so the artifacts can never collide with the
   gitleaks 64-integer keypair-shape rule (asserted in the spec).
6. **D-A1 marker:** this step reads pot arithmetic (`potLamports`) but does
   not touch it, so no `FOUNDER-A1` marker was added anywhere — the marker
   accompanies the first change that edits pot arithmetic, per the decision.

## For the founder

Nothing here needs a decision. The published table is the first evidence
artifact for counsel: outcome distributions under the published scoring rule
differ sharply and monotonically by how deliberately the entrant allocated —
measured, reproducible from a seed, and recomputable by anyone from the same
public engine.
