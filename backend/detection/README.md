# backend/detection

**Status: not implemented. Placeholder created in Phase 0.**

## Why it is empty

New work. Nothing in `anarchy-fun` did abuse detection of this kind.

## What Phase 4 must build here

The five signals from TECH-ARCH §9, run over revealed data after a pool closes. **Seven battles per
player is a thin sample — weight signals accordingly and require two independent signals before a
flag.**

- **Allocation entropy** across the seven battles — reuse patterns, round-number clustering,
  symmetric splits.
- **Per-battle timing**, captured client-side and carried inside the sealed payload, so it is
  revealed at close and cannot be edited after the fact. Human sessions show a slower first battle
  and occasional long pauses; scripts are uniform.
- **Duplicate and near-duplicate battle sets** across entries. Exact duplicates across 35 bytes are
  near-impossible for independent humans, so this is the strongest single signal for collusion or
  multi-accounting.
- **Device and IP correlation** within a pool.
- **Population-relative score** — far outside the field distribution.

Flag → escrow → 24-hour human review → clear or forfeit. The criteria are published (PID §8.6), and
the review page shows the flagged battles, the timings, the correlated entries and a decision log.

The false-positive rate is watched from the first mainnet pool (TECH-ARCH §12, Phase 7): a flag
withholds someone's prize money, so a wrong flag is expensive in a way a missed one is not.
