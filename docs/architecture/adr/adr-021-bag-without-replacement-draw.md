# ADR-021: The class draw is bag-without-replacement over `class_counters`

**Status:** Accepted · in force
**Enforced in:** `crates/blotto-randomness/src/lib.rs` (`weighted_class_draw`),
`programs/blotto_cup/src/instructions/register.rs`, `programs/blotto_cup/src/constants.rs`
(`LAUNCH_CLASS_COUNTERS`), `backend/class-digest/src/digest.ts` (the browser replay)

## Context

Each pass carries one of five cosmetic classes. The class is the only random element in the
product, and it is kept away from anything a player can win: it affects no stat, no battle, no
pool, no prize and no ranking tiebreak. The draw still has to be fair and checkable, because its
published description ("one Mythic in every 64") is a statement to players. That needs:

- a fixed, published composition per pool, not an independent chance per entry;
- replay from public data by anyone, with no hidden table;
- integer-only arithmetic, identical in Rust (on-chain) and TypeScript (the verify page).

## Decision

**A bag without replacement.** Each pool opens with `class_counters = [38, 15, 7, 3, 1]`
(sum 64, one per seat), written by `open_pool` from `LAUNCH_CLASS_COUNTERS`. The five indices are
shown to players as **Common, Uncommon, Rare, Epic, Mythic**, in the profile's collection only.

For each entry, inside `register`:

1. Derive a 32-byte digest from five sources
   ([ADR-026](adr-026-multi-source-randomness.md)).
2. `weighted_class_draw(digest, class_counters)`: read the digest's first 8 bytes as a
   little-endian `u64`, reduce it modulo the remaining total, and walk the counters as a cumulative
   distribution to pick an index in `0..5`. The function reads the counters and does not change
   them.
3. The caller decrements the chosen counter, so the bag total falls by exactly one per entry and
   reaches zero at the 64th. The class index is written to `Entry.class` and emitted in
   `EntryRegistered`.

The argument and field are named `class_counters`. No variable in the draw is named after chance
or weighting, by project rule.

## Consequences

- **The composition is fixed per pool, not per entry.** A full pool contains exactly one Mythic,
  three Epic, seven Rare, fifteen Uncommon and thirty-eight Common. A pool that seals between 40
  and 63 seats (R7-b) draws the bag down without emptying it; each draw is still uniform over what
  remains, and the published statement describes the bag.
- **Replayable from events.** The on-chain bag replaces the original design's committed, shuffled
  class table: with the seed (`PoolVrfSeeded`), each entry's slot hash and index
  (`EntryRegistered`) and the two public keys, anyone can replay every draw in order.
- **Three copies, all checked.** The bag exists in the program (`constants.rs`), the draw crate, and
  the TypeScript replay. A program test asserts the first two equal the Python-generated fixture
  (`crates/blotto-randomness/fixtures/vectors.json`, from `gen_vectors.py`); `scripts/check-mirrors.py`
  checks the TypeScript copy in CI.
- **Class stays out of scoring by construction.** The replay lives in its own package
  (`backend/class-digest`), separate from `backend/scoring`, and `scripts/check-standing-rules.sh`
  fails CI if the scoring path mentions `class`.
- **Modulo bias is accepted.** With at most 64 items against a 2^64 input space the bias is on the
  order of 1 in 2^58. Rejection sampling would make an audit replay depend on a retry count, for no
  effect on anything a player can win.
- **The empty bag is unreachable.** The 64th entry seals the pool before another `register` can
  run; the function panics on an empty bag as a defence-in-depth check.

## Alternatives considered

- **An independent weighted draw per entry (with replacement).** Rejected: a pool could hold zero or
  several Mythics, so the published composition would be a tendency rather than a fact.
- **A shuffled class table committed by Merkle root at open and published at close** (the original
  design). Superseded: it needs an off-chain table and a publication step; the on-chain bag replays
  from events alone.
- **Any class-linked reward or effect.** Rejected as a rule, not a design choice. A proposed class
  reward must answer no to both questions: would anyone pay money for it, and does it improve the
  chance of winning?
