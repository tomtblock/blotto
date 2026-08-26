# blotto-scoring

**Status: not implemented. This crate is a placeholder created in Phase 0 so Phase 2 has a home.**
There is no code here yet beyond a `lib.rs` that compiles to nothing.

## Why it is empty

This crate is new work. Nothing in the predecessor repository scored anything — the old product had no
competition, no allocations and no ranking — so there was nothing to carry. The extraction brief
lists it under §8, "New — not in the old repo".

## What Phase 2 must build here

Per TECH-ARCH §6 and PID §4–§5:

- **Allocation encoding.** Five `u8` summing to exactly 100, in the fixed stat order Strength,
  Speed, Heart, Wit, Durability. A seven-battle set encodes to exactly 35 bytes, battle order fixed.
  Anything else is rejected — this invariant is what makes the 7% draw rate real (PID §4.6).
- **All-vs-all scoring.** For every pair of players and every battle index 1..7: a stat is won by the
  larger number, a battle by three or more stats; tied stats go to neither; 2–2 with a tie is a draw
  worth half a win each. 441 comparisons per player, 14,112 per pool.
- **Ranking.** By score descending, then total stats won descending, then earlier entry.
- **Merkle leaves.** `sha256(player ‖ rank ‖ amount_lamports)`, built with `blotto-merkle`.
- **A WASM build**, so the verify page recomputes results in the player's own browser rather than
  trusting the operator's published numbers.

Two constraints that are not negotiable:

- **No floats.** "Half a win" is carried in integer half-point units — never `0.5f64`. A float in a
  ranking path is a divergence between the native and WASM builds waiting to happen, and it violates
  the workspace's hard rule.
- **Python-precomputed known vectors**, committed with their generator, following the pattern in
  `crates/blotto-randomness/fixtures/`. A vector captured from this crate's own output proves only
  that the crate agrees with itself.

Two acceptance criteria from TECH-ARCH §13 land here: the scoring known-vector test must match the
Python fixture, the WASM build must equal the native one, and the draw rate on random integer
allocations must come out at roughly 7%.
