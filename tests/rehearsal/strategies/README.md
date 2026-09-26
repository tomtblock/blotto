# The skill-evidence strategy ladder (D-A2)

Four strategy classes of increasing deliberateness, implemented in `../src/ladder.ts` and run at
scale by `../src/skill-evidence.ts`. The study's output lives in
[`docs/skill-evidence/`](../../../docs/skill-evidence/) (generated — never hand-edited). These
classes are separate from the population shapes in `../src/strategies.ts`, which exist to exercise
the detection signals, not to measure outcomes.

Every class emits only valid allocations — the same invariant a human entry passes through. Every
class is deterministic per (class, seed): sha256 streams only, no clock, no `Math.random`. A study
run is reproducible from its base seed alone.

## The classes (easy mode: 100 points per battle)

### `uniform` — the zero-thought baseline

`20 / 20 / 20 / 20 / 20` in every battle. This is exactly what the board produces for a player who
places nothing: at submission, unplaced points are spread evenly across the stats of every unlocked
battle (`app/src/battle/board/spread.ts`). Against any opponent who concentrated on three stats,
uniform loses those three stats and with them the battle; against another uniform it draws
everything.

### `random` — valid but unconsidered

Free-integer allocations from a deterministic divider construction (the same construction the
Python scoring oracle uses as a sanity stream). A player who places points arbitrarily: the entry
is valid, the shape carries no plan.

### `heuristic` — a considered plan

The first real insight of the format: **a battle is won by taking three of its five stats**, so two
stats can be sacrificed to overweight three. Per battle the class picks a trio of stats (seeded,
varying between battles), splits steeply across it (base `38 / 31 / 21`, ±2 seeded jitter moved
between trio members so the sum holds), and leaves small non-zero amounts (`6 / 4`) on the other
two. This is a player who read the scoring rule and played to it.

### `optimised` — the same family, tuned

Three refinements over `heuristic`:

1. **One-upped trio values funded from the off-stats** (`39 / 32 / 22` over `4 / 3`): a stat is won
   by the strictly larger number, so edging each trio stat by one beats the heuristic shape in the
   trio while keeping the off-stats non-zero (a 3 beats any zeroed stat).
2. **Per-entrant rotation over all ten trios** across the seven battles, so no fixed counter-shape
   wins for free.
3. **Wider seeded jitter** (±3), so mirror matchups between optimised entrants break
   asymmetrically instead of tying stat for stat.

Allocation contests of this shape are non-transitive — no single allocation beats all others — and
"optimised" means tuned against this study's field, not universally dominant. The published report
claims no more than its own measured table.

## The hard-mode ladder (700 points anywhere)

In hard mode a player places **700 points anywhere** across the seven battles
(`backend/scoring/src/allocation.ts`, `HARD_TOTAL`); a battle may hold nothing.
`generateLadderEntrant(cls, seed, salt, 'hard')` emits the same four classes under that rule, and a
run with `SKILL_EVIDENCE_MODE=hard` writes `docs/skill-evidence/hard/`.

- **`uniform`** — 20 in every stat of every battle, which is again what the board produces for a
  player who places nothing (700 / 35 = 20).
- **`random`** — 700 over the 35 cells by 34 sorted dividers, the Python oracle's hard-mode stream.
- **`heuristic`** — a battle holding nothing loses 5–0 to any battle holding anything, and a battle
  is won by three stats; so the class **concedes two battles outright** (seeded per entrant) and
  stacks the other five at 140 each, split steeply across a per-battle trio (`53 / 44 / 31`) with
  small non-zero off-stats (`7 / 5`).
- **`optimised`** — the same family, tuned as in easy mode: one-upped trio values funded from the
  off-stats (`55 / 46 / 33` over `4 / 2`), per-entrant rotation over the ten trios, ±3 jitter.

The stacked-five shape is a reading of the rule, not a measured optimum (flagged as a review point
in `ladder.ts`); the hard report measures what it does against the other classes and claims no
more. The hard report also prints the **draw rate** per run, since two conceded battles meeting is a
draw and a stacked battle meeting a conceded one never is.

## Population mix and fairness of the measurement

Each mixed study pool holds an equal number of entrants of each class (16 each in a 64-seat pool),
and seat order is shuffled by a seeded Fisher–Yates per pool. Seat index never decides who is paid
(D3-B), but it does place the indivisible lamport remainder of a tie split and the published leaf
order; the shuffle removes even that residual correlation between class and seat.

## Within-class uniqueness

No two entrants of one class in one pool share an identical seven-battle allocation set. The jitter
model is documented at `concentrated()` in `../src/ladder.ts`: one seeded transfer of up to
`jitterMax` points between two trio stats, keeping the sum fixed. Jitter alone cannot guarantee
distinct sets, so `ensureUniqueWithinClass` repairs any residual collision deterministically: the
later entrant regenerates with a bumped salt until its set is fresh. The **uniform class is exempt**
— a flat split in every battle is the class's definition, and jittering it would destroy the
property the report's appendix documents (a flat split loses every battle 3–2 to any three-stat
concentration).

## Homogeneous-field runs

Alongside the mixed run, the study runs 200 pools per class in which all 64 entrants play the same
class (random, heuristic, optimised — a homogeneous uniform pool would be a single 64-way tie and is
refused by construction). These are the equally-skilled controls: within a class no entrant holds an
edge, so the mean payout share sits at 1/64 of the prize pool and rank 1 lands on about 1/64 of
entrants. The report leads with the mixed random-vs-optimised comparison; the homogeneous tables
show that the spread between classes comes from the allocations, not from the structure.

Detection is off for study runs (`runOfflinePool(…, { detect: false })`): the uniform entrants have
identical sets by construction, and escrowing them as duplicates would distort the outcomes being
measured. The rehearsal suite proper keeps detection on.

## Reproduce

```bash
cd tests/rehearsal && npm ci && npm run skill-evidence
# parameters: SKILL_EVIDENCE_POOLS (default 200), SKILL_EVIDENCE_SEED (default 20260827),
#             SKILL_EVIDENCE_MODE=hard for the hard-mode study
```

The nightly `skill-evidence` workflow re-runs both studies with `SKILL_EVIDENCE_CHECK=1` and fails
if a fresh run no longer reproduces the committed `docs/skill-evidence/results.csv` + `REPORT.md`
(and `docs/skill-evidence/hard/`). An engine change that shifts outcomes must land together with
regenerated evidence.
