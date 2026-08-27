# The skill-evidence strategy ladder (D-A2)

Four strategy classes of increasing deliberateness, implemented in
`../src/ladder.ts` and run at scale by `../src/skill-evidence.ts`. The study's
output lives in `docs/skill-evidence/` at the repository root. These classes
are separate from the detection-oriented population shapes in
`../src/strategies.ts` (roadmap 5.1), which exist to exercise the detection
signals, not to measure outcomes.

Every class emits only valid allocations (five non-negative integers summing
to exactly 100 per battle, seven battles) — the same client invariant a human
entry passes through. Every class is deterministic per (class, seed): sha256
streams only, no clock, no `Math.random`. A study run is reproducible from
its base seed alone.

## The classes

### `uniform` — the zero-thought baseline

`20 / 20 / 20 / 20 / 20`, every battle. This is exactly what the battle
screen locks if a player never touches the pentagon (R9 lock-current). It is
the floor of deliberateness: no decision is made at all. Against any opponent
who concentrated on three stats, uniform loses those three stats and with
them the battle; against another uniform it draws everything.

### `random` — valid but unconsidered

Free-integer allocations from the deterministic divider construction (the
same construction the scoring oracle uses as a spread sanity stream). This
represents a player who moves the pentagon arbitrarily: the entry is valid,
the shape carries no plan.

### `heuristic` — a considered plan

Implements the first real insight of the format: **a battle is won by taking
three of its five stats**, so two stats can be sacrificed to overweight
three. Per battle the class picks a trio of stats (seeded, varying between
battles), splits steeply across it (base `38 / 31 / 21`, ±2 seeded jitter
moved between trio members so the sum holds), and leaves small nonzero
amounts (`6 / 4`) on the other two. This is the profile of a player who read
the scoring rule and played to it.

### `optimised` — the same family, tuned

Three refinements over `heuristic`, each with a stated reason:

1. **One-upped trio values funded from the off-stats** (`39 / 32 / 22` over
   `4 / 3`): a stat is won by the strictly larger number, so edging each trio
   stat by one beats the heuristic's exact family in the trio while still
   keeping the off-stats nonzero (a 3 beats any zeroed stat).
2. **Per-entrant rotation over all ten trios** across the seven battles:
   varying which stats are concentrated denies any fixed counter-shape a
   free win and spreads stat coverage across the field.
3. **Wider seeded jitter** (±3): mirror matchups between optimised entrants
   break asymmetrically instead of tying stat-for-stat.

Allocation games of this shape are non-transitive — no single allocation
beats all others, and "optimised" here means tuned against this study's
field, not universally dominant. The published report makes no stronger
claim than its own measured table.

## Population mix and fairness of the measurement

Each study pool holds 16 entrants of each class, and the seat order is
shuffled by a seeded Fisher–Yates per pool. Seat index never decides who is
paid (D3-B), but it does place the indivisible lamport remainder of a tie
split and the published leaf order — the shuffle removes even that residual
correlation between class and seat.

## Within-class uniqueness (master prompt v2 amendment)

No two entrants of one class in one pool share the identical seven-battle
allocation set. The jitter model is documented at its site
(`concentrated()` in `src/ladder.ts`): one seeded transfer of up to
`jitterMax` points between two trio stats, keeping the sum at exactly 100.
Jitter alone cannot GUARANTEE distinct full sets, so
`ensureUniqueWithinClass` repairs any residual collision deterministically:
the later entrant regenerates with a bumped salt until its set is fresh.
The **uniform class is exempt** — `20/20/20/20/20` every battle is the
class's definition; jittering it would destroy the structural property the
report's appendix documents (a flat split loses every battle 3–2 to any
three-stat concentration).

## Homogeneous-field runs (master prompt v2 amendment)

Alongside the mixed run, the study runs 200 pools per class in which ALL 64
entrants play the same class (random / heuristic / optimised — a
homogeneous uniform pool would be a single 64-way tie and is refused by
construction). These are the "equally-skilled entrants" controls: within a
class no entrant holds an edge, so the measured mean payout share sits at
the everyone-equal baseline of 1/64 of the pot, and rank-1 lands at ≈ 1/64
of entrants. The report leads with the mixed random-vs-optimised
comparison; the homogeneous tables are the evidence that the spread between
classes is skill, not structure.

Detection is off for study runs: 16 uniform entrants have identical sets by
construction, and flag-escrowing them as duplicates would distort the
outcome statistics being measured. (The rehearsal suite proper keeps
detection on; this switch exists only on `runOfflinePool`'s options.)

## Reproduce

```bash
cd tests/rehearsal && npm ci && npm run skill-evidence
# parameters: SKILL_EVIDENCE_POOLS (default 200), SKILL_EVIDENCE_SEED (default 20260827)
```

The nightly CI job re-runs the full study with `SKILL_EVIDENCE_CHECK=1` and
fails if a fresh run no longer reproduces the committed
`docs/skill-evidence/results.csv` + `REPORT.md` — an engine change that
shifts outcomes must land together with regenerated evidence.
