# blotto-randomness

Per-entry class randomness derivation and the weighted cosmetic class draw for Blotto Cup.
Framework-agnostic Rust — no `solana-program` dependency, no float arithmetic, no allocations beyond
the SHA-256 hasher's internal block buffer. Every draw is a pure deterministic function of its
inputs and is replayable for audit from on-chain state alone.

**Carried from `anarchy-fun`'s `crates/randomness`.** See `EXTRACTION-REPORT.md` for what changed.

## The one thing to understand before reading the code

**The class this crate produces is cosmetic. It is read by nothing in the scoring path.** A Titan's
Strength is worth exactly what a Goblin's is. The drawn class is written to the character pass and to
`Entry.class` for display; that is the entirety of its effect.

This is not a stylistic note. The class draw is the only chance element anywhere near Blotto Cup, and
the product's legal characterisation (PID §8.2, §8.4) rests on it conferring nothing of value and
nothing competitive. Any change that lets a class influence a battle, a pool, a prize or a ranking
tiebreak is a legal-position change requiring counsel sign-off, not a feature.

## What this crate is

Class resolution happens in two steps: derive a 32-byte digest from on-chain inputs, then draw a
class from the remaining counter bag. Both are here, callable from on-chain code via byte-array
conversion at the boundary (`Pubkey::to_bytes()`).

```rust
pub fn derive_class_randomness(
    vrf_seed: &[u8; 32],
    slot_hash: &[u8; 32],
    entry_index: u16,
    pool_pubkey: &[u8; 32],
    player_pubkey: &[u8; 32],
) -> [u8; 32]
```

SHA-256 over the five inputs concatenated in fixed order — **130 bytes** per entry:

```
vrf_seed(32) ‖ slot_hash(32) ‖ entry_index(2, LE) ‖ pool_pubkey(32) ‖ player_pubkey(32)
```

`vrf_seed` is the Switchboard On-Demand result committed at `open_pool`; `slot_hash` is a delayed
`SlotHashes` entry, delayed so the executing validator has no influence over it; `entry_index` is the
monotonic seat counter; `pool_pubkey` disambiguates pools; `player_pubkey` binds the digest to the
entrant. See TECH-ARCH §4.

```rust
pub fn weighted_class_draw(rng_bytes: &[u8; 32], class_counters: &[u16; 5]) -> usize
```

Bag-without-replacement draw over the five classes `[Goblin, Knight, Wizard, Dragon, Titan]`,
initialised at pool open to `[38, 15, 7, 3, 1]` (sum = 64 = one pool's seats). The first 8 bytes of
`rng_bytes` decode as a little-endian `u64`, modulo the counter sum to land in `[0, total)`, then a
cumulative walk returns the class index. Counters are read but never mutated — the caller decrements
at the call site.

The argument is named `class_counters`, never `odds` or `weights` (PID §8.7).

## Changes from the predecessor

| | `anarchy-randomness` | `blotto-randomness` |
|---|---|---|
| Digest function | `derive_open_randomness` | `derive_class_randomness` |
| Inputs | 4 — 98 bytes | **5 — 130 bytes**, adding `player_pubkey` last |
| Renamed parameters | `collection_pubkey`, `open_index` | `pool_pubkey`, `entry_index` |
| Draw function | `weighted_tier_draw` | `weighted_class_draw` |
| Bag | 6 tiers, `[250, 100, 50, 15, 4, 1]`, sum 420 | **5 classes, `[38, 15, 7, 3, 1]`, sum 64** |
| Draw argument name | `counters` | `class_counters` |
| Known vectors | Inlined bytes; **generator never committed** | `fixtures/vectors.json` + `fixtures/gen_vectors.py`, both committed |
| Dependency versions | `sha2 = "0.10"`, `proptest = "1.5"` (caret) | `sha2 = "=0.10.9"`, `proptest = "=1.11.0"` (exact, from the old lockfile) |

Everything else — the SHA-256 choice, the little-endian convention, the read-only counter contract,
the empty-bag panic, the avalanche and determinism tests — is carried unchanged.

## Design properties

### One endianness rule

Both functions use little-endian throughout: `u16::to_le_bytes()` for `entry_index` mixed into the
hasher, and the first 8 bytes of `rng_bytes` interpreted as a little-endian `u64`. One byte-ordering
rule for the whole crate, matching Borsh's default integer encoding — the Anchor/Solana
account-serialization convention. **The `register` instruction must pass the typed `u16` and let this
crate encode it; never hand-roll the bytes at the call site.**

### Modulo bias is accepted

`u64 % total` biases toward residues below `2^64 mod total`. With `total ≤ 64`, that bias is on the
order of 1 in 2^58 — smaller still than in the predecessor, whose bag held 420. **Accepted**, for two
reasons. First, rejection sampling complicates audit replay: an auditor re-deriving an old entry
would have to replay the loop with the same retry count. Second, the class confers nothing (PID
§8.4), so even a measurable bias would move nothing a player could cash. Single-pass determinism wins
the tradeoff.

### Mutation contract: state and math are separated

`weighted_class_draw` reads `class_counters` through a shared reference and never mutates. The
caller — `register` — owns the decrement, alongside the other state writes that seat-filling triggers
(`entrants += 1`, the transition to `Sealed` at 64). Keeping the math pure makes it trivially
testable, replayable for audit, and reusable from any handler.

### No floats, no allocations

All intermediates are fixed-size byte arrays, `u16`, `u32` or `u64`. This holds in the tests too —
the convergence tolerance is expressed in count units, not as a float ratio.

## Test vectors are generated by Python, and the generator is committed

`fixtures/vectors.json` holds three `derive` vectors and five `draw` vectors — one per class. Every
expected digest is computed by `fixtures/gen_vectors.py` using Python's `hashlib`, **not** by this
crate. A vector captured from our own Rust output would prove only that the crate agrees with itself,
and would happily lock in a byte order that is wrong everywhere else.

The predecessor understood this and computed its vectors in Python too — but inlined the resulting
bytes into the test file and **never committed the generator**, so nobody afterwards could regenerate
them, check their provenance, or extend the set. That gap is why `gen_vectors.py` exists here.

```bash
python3 fixtures/gen_vectors.py --write    # regenerate fixtures/vectors.json
python3 fixtures/gen_vectors.py            # print to stdout, to diff against the committed file
```

The script uses only the Python standard library — no dependency, no environment, no version drift.
The Rust side embeds the JSON with `include_str!`, so the tests have no runtime file dependency and
no working-directory assumption.

## Test coverage

**19 tests, all deterministic — no randomness, no flakiness, same result every run.**

Unit tests (16, in `src/lib.rs`):

- *Known vectors* — all three `derive` fixtures and all five `draw` fixtures, plus an assertion that
  the draw fixtures pin every class exactly once (so a fixture regeneration that silently dropped one
  fails rather than quietly weakening the suite).
- *Canonical stream* — rebuilds the 130-byte input by hand and hashes it directly, so a change to
  input order or index encoding inside the function cannot pass even if the fixtures were regenerated
  to match the change.
- *Determinism* — 16 repeated calls against fixed inputs must match exactly.
- *Avalanche* — a single-bit flip in **each of the five** inputs produces > 96 of 256 digest bit
  flips (a loose bound; SHA-256 expects ~128). `avalanche_flip_player_pubkey_bit` is the new one: an
  implementation that forgot to mix `player_pubkey` would pass every other test here.
- *Two players, same seat* — the property `player_pubkey` was added for, stated directly.
- *Counters sum to capacity* — 38 + 15 + 7 + 3 + 1 = 64.
- *Edge cases* — lone-Titan bag returns index 4; lone-Goblin bag returns index 0; empty bag panics.
- *Proptest invariants* — over random `(class_counters, rng_bytes)` pairs with counters ranging over
  the real `0..=64` domain: index in `0..5`, drawn counter > 0, counters unchanged across the call.

Integration tests (3, in `tests/properties.rs`):

- *Counters sum to capacity* — asserted here as well, because both files hardcode the array and a
  divergence between them would otherwise be silent.
- *Distribution convergence* — 100,000 deterministic draws through both functions, asserting per-class
  empirical frequencies within ±2 percentage points absolute of the counter ratios.
- *Full-pool invariant* — 64 simulated entries with draw → decrement and a distinct player pubkey per
  seat, asserting the sum falls by exactly one per entry, terminal counters are `[0; 5]`,
  draws-per-class equals the launch distribution exactly (**exactly one Titan, exactly three
  Dragons**), and a post-fill draw panics under `catch_unwind`.

## Testing

```bash
cargo test -p blotto-randomness
cargo clippy -p blotto-randomness --all-targets -- -D warnings
cargo fmt -p blotto-randomness -- --check
```

The full run completes in about 1.5 seconds; the 100,000-draw convergence test dominates.

## How `register` will wire this up (Phase 1)

```rust
let rng_bytes = derive_class_randomness(
    &pool.vrf_seed,
    &slot_hash_delayed,
    pool.entrants,                  // the seat this entry takes
    &pool.key().to_bytes(),
    &ctx.accounts.player.key().to_bytes(),
);
let class = weighted_class_draw(&rng_bytes, &pool.class_counters);
pool.class_counters[class] -= 1;    // the decrement is the caller's contract
```

Then write `class` to `Entry.class` and to the pass, emit it in `EntryRegistered`, **and read it
nowhere else.** A call-site known-vector test with a precomputed expected digest should lock the
wire-up, particularly the endianness of `entry_index`.

## References

- `docs/PID_Blotto-Cup_v0.5.md` — §3 (the character pass and the class table), §8.4 (the rule that
  cannot bend), §8.7 (language).
- `docs/TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` — §2 (constants), §4 (the class draw).
- `docs/reference/adr-021-bag-without-replacement-draw.md`,
  `docs/reference/adr-026-multi-source-randomness.md` — the predecessor's reasoning, for context only.
- `docs/reference/threat-tm-502.md` — VRF callback failure or compromise.
