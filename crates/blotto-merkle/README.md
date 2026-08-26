# blotto-merkle

**Status: not implemented. This crate is a placeholder created in Phase 0 so Phase 1/2 has a home.**
There is no code here yet beyond a `lib.rs` that compiles to nothing.

## Why it is empty rather than carried

The extraction brief (§2) expected to find a slot-table Merkle module in `anarchy-fun` — shuffle,
root, per-slot proofs, plus an encryption step for a table stored on Irys — and to carry it here.

**No such module exists in the old repository.** The old product resolved rarity with a
bag-without-replacement draw over live counters held on the collection account, and its own decision
record explicitly rejected a Merkle pre-mint approach. There was nothing to carry. This is recorded
in `EXTRACTION-REPORT.md` under "Component: Merkle slot-table commitment".

## What Phase 1/2 must build here

Two trees, sharing one implementation:

1. **The class table** (TECH-ARCH §4). A 64-entry table of cosmetic classes, shuffled from
   `CLASS_COUNTERS = [38, 15, 7, 3, 1]` (Goblin, Knight, Wizard, Dragon, Titan; sum 64) using the
   pool's VRF seed. Its root is committed to `Pool.class_root` at `open_pool`; the full table is
   published at close so anyone can verify their own class was not chosen after the fact.
2. **The results tree** (TECH-ARCH §7). Leaves are `sha256(player ‖ rank ‖ amount_lamports)`. The
   root is committed by `commit_results`; `claim` verifies a player's proof against it.

Decisions the implementation must make explicitly and document, because the on-chain verifier and
the off-chain builder have to agree byte for byte:

- The hash function and the leaf encoding.
- Whether proofs are sorted-pair or ordered.
- How an odd node count at a level is handled (duplicate the last node, or promote it).
- Domain separation between the two trees, so a class-table proof can never be replayed as a results
  proof.

A known-vector test generated in Python — not captured from this crate's own output — is required
for both trees before either is wired into the program. See `crates/blotto-randomness/fixtures/` for
the pattern.
