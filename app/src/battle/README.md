# app/src/battle

**Status: empty scaffold created in Phase 0. New work — nothing was carried here.**

## What Phase 3 must build here

The seven-battle flow, per **PID v0.5 §4**. Read that section in full before writing anything; the
interaction design is the product, and several of its rules exist for reasons that are not obvious
from the shape of the UI.

Each battle is one screen: a pentagon with a draggable vertex per stat.

- **Opens at an even split** — 20 on every stat. Players nudge from a balanced shape rather than
  building from zero.
- **Drag a vertex** outward or inward along its axis. The other four are untouched by the drag
  itself.
- **Live normalisation.** After every movement the five raw values are rescaled to sum to 100,
  rounded to integers, with any rounding remainder placed on the largest stat. The displayed
  integers are always the real allocation. The player never does arithmetic and never sees a "points
  remaining" counter.
- **Integers are shown under the pentagon as feedback, not as targets.**
- **One button: "Even split."** It resets to 20-20-20-20-20.
- **Lock in** commits the battle and advances. Seven screens, then a review, then one transaction.
- **Per-screen timing is captured** and travels inside the sealed payload — the detection layer
  reads it after close.
- Ten seconds per screen is a UX default, not a rule. There is no opponent waiting.

### Two things that will be proposed and must be refused

**No presets, no quick-set chips, no named shapes.** PID §4.3 is explicit and quantified: any
prominent discrete target clusters the population, and clustering causes draws. Chips at
0/25/50/75/100 collapse the effective option space from 4,598,126 to something near 126, and the
random-vs-random draw rate from 7% to 86%. A dragged vertex lands on 37, 22, 41 — the spread the
game needs — without the player thinking about granularity at all.

**Note that `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §10 still says "five steppers with quick-set chips
0/25/50/75/100". That sentence is stale and is overridden by PID v0.5 §4.** `docs/INDEX.md` records
the conflict. Build to the PID.

### The client invariant

The client must be **unable** to submit anything other than five non-negative integers summing to
exactly 100, in the fixed stat order (PID §4.6). The program rejects anything else, and so must the
client — this invariant is what makes the 7% draw rate real rather than aspirational.
