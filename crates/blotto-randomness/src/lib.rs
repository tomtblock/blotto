//! Blotto Cup per-entry class randomness and cosmetic class draw.
//!
//! Implements the two-step class resolution specified in PID §3 and TECH-ARCH §4:
//!
//! 1. **Per-entry randomness derivation (TECH-ARCH §4).** Each entry derives a
//!    32-byte digest from the pool's committed Switchboard VRF seed, a delayed
//!    slot hash (from the `SlotHashes` sysvar at execution time), the monotonic
//!    `entry_index`, the pool pubkey, and the player's own pubkey. Combining a
//!    submission-time-unknown input (the delayed slot hash) with the
//!    pool-committed VRF seed means outcomes are neither predictable at
//!    submission nor manipulable by the executing validator; including
//!    `player_pubkey` means two entries landing in the same slot at the same
//!    index — impossible on-chain, but cheap to rule out — cannot collide.
//!
//! 2. **Weighted class draw (PID §3).** A bag-without-replacement draw over five
//!    cosmetic classes initialized to `[38, 15, 7, 3, 1]` at pool open (sum = 64,
//!    one per seat). The caller decrements the chosen counter after the draw,
//!    preserving the invariant that the counter sum decreases by exactly one per
//!    entry and reaches zero when the pool fills.
//!
//! # Class is cosmetic
//!
//! **The value this crate produces is read by nothing in the scoring path.** A
//! Titan's Strength is worth exactly what a Goblin's is. The class is written to
//! the character pass and to `Entry.class` for display, and that is the whole of
//! its effect. This is the load-bearing rule for the product's legal position
//! (PID §8.4): the draw is the only chance element anywhere near the product, and
//! it must confer nothing of value and nothing competitive. Any change here that
//! lets a class influence a battle, a pool, a prize or a ranking tiebreak is a
//! legal-position change, not a feature.
//!
//! Framework-agnostic: no `solana-program` dependency, no float arithmetic, all
//! intermediate work in `[u8; 32]`, `u32` or `u64`. The on-chain caller converts
//! `Pubkey::to_bytes()` at the boundary.
//!
//! # Public API
//!
//! - [`derive_class_randomness`] — multi-source per-entry digest, TECH-ARCH §4.
//! - [`weighted_class_draw`] — bag-without-replacement class selection, PID §3.
//! - [`CLASS_NAMES`], [`LAUNCH_CLASS_COUNTERS`], [`CAPACITY`] — the pool geometry.

use sha2::{Digest, Sha256};

/// Cosmetic character classes, in the fixed order [`weighted_class_draw`]'s
/// `class_counters` argument uses (PID §3).
///
/// Names are placeholders for art direction (PID D2); the five-way structure and
/// the counts in [`LAUNCH_CLASS_COUNTERS`] are fixed.
pub const CLASS_NAMES: [&str; 5] = ["Goblin", "Knight", "Wizard", "Dragon", "Titan"];

/// Class counters at pool open (PID §3, TECH-ARCH §2). Sum = 64 = [`CAPACITY`],
/// so a full pool draws the bag exactly empty: every pool contains exactly one
/// Titan, exactly three Dragons, and so on.
pub const LAUNCH_CLASS_COUNTERS: [u16; 5] = [38, 15, 7, 3, 1];

/// Seats per pool (TECH-ARCH §2). The last seat is index `CAPACITY - 1`.
pub const CAPACITY: u16 = 64;

/// Derives the 32-byte per-entry class randomness digest per TECH-ARCH §4.
///
/// Combines five inputs into a single SHA-256 digest, mixed in this exact order:
/// 1. `vrf_seed` (32 bytes) — Switchboard On-Demand result committed at pool open.
/// 2. `slot_hash` (32 bytes) — blockhash from `SlotHashes` at a delayed slot. The
///    delay is finalized before the executing slot runs, so the executing
///    validator has no influence over it.
/// 3. `entry_index` (2 bytes, **little-endian** — see the endianness note below) —
///    monotonic seat counter (`u16`, max [`CAPACITY`] per pool).
/// 4. `pool_pubkey` (32 bytes) — disambiguates pools sharing the same
///    `(vrf_seed, slot_hash, entry_index)` tuple.
/// 5. `player_pubkey` (32 bytes) — binds the digest to the entrant.
///
/// Total bytes hashed: 32 + 32 + 2 + 32 + 32 = **130**.
///
/// **Endianness.** `entry_index` is serialized via `u16::to_le_bytes()`. On-chain
/// callers must match this exactly when re-deriving for audit. Little-endian is
/// chosen to match Borsh's default integer encoding — the Anchor/Solana account
/// serialization convention — so on-chain code stays consistent with its own
/// `Entry.index` byte layout without a separate big-endian conversion step.
///
/// Deterministic and replayable: the same inputs always produce the same output.
/// Audit path: anyone with the on-chain seed, the entry index, the two pubkeys and
/// a historical `SlotHashes` entry can re-derive any historical class draw.
pub fn derive_class_randomness(
    vrf_seed: &[u8; 32],
    slot_hash: &[u8; 32],
    entry_index: u16,
    pool_pubkey: &[u8; 32],
    player_pubkey: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(vrf_seed);
    hasher.update(slot_hash);
    // Little-endian per Borsh / Solana convention. On-chain callers must pass the
    // typed `u16` and let this function encode it — never hand-roll the bytes.
    hasher.update(entry_index.to_le_bytes());
    hasher.update(pool_pubkey);
    hasher.update(player_pubkey);
    hasher.finalize().into()
}

/// Draws a cosmetic class index in `0..5` weighted by the remaining counters, per
/// PID §3 (bag-without-replacement).
///
/// `class_counters` is interpreted as `[Goblin, Knight, Wizard, Dragon, Titan]`
/// (see [`CLASS_NAMES`]), initialized at pool open to `[38, 15, 7, 3, 1]` (see
/// [`LAUNCH_CLASS_COUNTERS`], sum = 64). The returned index identifies the drawn
/// class; **the caller decrements that counter** to preserve the invariant that
/// the counter sum decreases by exactly one per entry (64 at open, 0 at a full
/// pool). This function reads `class_counters` but does not mutate it — the
/// decrement happens at the call site, alongside the other state writes.
///
/// The argument is named `class_counters`, never `odds` or `weights` (PID §8.7).
///
/// **Algorithm.** Take the first 8 bytes of `rng_bytes` as a little-endian `u64`,
/// modulo by the counter sum to land in `[0, total)`, then walk the counters as a
/// cumulative distribution. Little-endian matches
/// [`derive_class_randomness`]'s `entry_index` encoding, keeping the crate's
/// byte-interpretation convention uniform.
///
/// **Modulo bias.** With `total ≤ 64` and a `u64` input space of `2^64`, the bias
/// toward residues below `2^64 mod total` is on the order of 1 in 2^58 —
/// even more negligible than in the predecessor crate, whose bag held 420. It is
/// **accepted** here in exchange for single-pass determinism: rejection sampling
/// would complicate audit replay, since an auditor re-deriving an old entry would
/// have to replay the loop with the same retry count, for no economically or
/// competitively meaningful gain. The class confers nothing (PID §8.4), so even a
/// measurable bias would move nothing a player could cash.
///
/// Determinism: identical `(rng_bytes, class_counters)` always yields the same
/// class. Over many draws against a fixed distribution (without decrement), the
/// empirical frequency converges to the counter ratios.
///
/// # Panics
///
/// Panics if `class_counters.iter().sum::<u32>() == 0` — the empty-bag state with
/// no remaining seats. The caller's contract is "non-empty bag in". In the
/// on-chain protocol this case is unreachable: once the bag empties at the 64th
/// entry the pool transitions to `Sealed` and every subsequent `register` call is
/// rejected before reaching this function. The panic is a defense-in-depth
/// invariant check, not a recoverable error path.
pub fn weighted_class_draw(rng_bytes: &[u8; 32], class_counters: &[u16; 5]) -> usize {
    let total: u32 = class_counters.iter().map(|&c| c as u32).sum();
    assert!(
        total > 0,
        "weighted_class_draw called with empty bag: counter sum is 0. \
         Caller must prevent the empty-bag state per this function's contract."
    );

    // Take the first 8 bytes of rng_bytes as a little-endian u64. Little-endian
    // matches derive_class_randomness's entry_index encoding (Borsh / Solana
    // convention), so the whole crate has one byte-ordering rule.
    let mut head = [0u8; 8];
    head.copy_from_slice(&rng_bytes[..8]);
    let n = u64::from_le_bytes(head);

    // Modulo bias is ~1 in 2^58 at our scale — accepted. See the doc comment.
    let r = n % total as u64;

    // Cumulative walk. u64 throughout to avoid any narrowing cast; the widest
    // value is total ≤ 5 × u16::MAX, so this never approaches overflow.
    let mut cumulative: u64 = 0;
    for (i, &c) in class_counters.iter().enumerate() {
        cumulative += c as u64;
        if r < cumulative {
            return i;
        }
    }

    // Unreachable: r < total = sum(class_counters), so the cumulative walk must
    // cross r before the loop exits.
    unreachable!("weighted_class_draw cumulative walk fell through: r = {r}, total = {total}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_vectors::{derive_vectors, draw_vectors};
    use proptest::prelude::*;

    /// Hamming distance between two 32-byte digests, measured in bit flips.
    fn hamming_bits(a: &[u8; 32], b: &[u8; 32]) -> u32 {
        a.iter()
            .zip(b.iter())
            .map(|(x, y)| (x ^ y).count_ones())
            .sum()
    }

    // ---------- Known vectors (loaded from fixtures/vectors.json) ----------
    //
    // The expected digests are computed by Python `hashlib` in
    // `fixtures/gen_vectors.py` and committed to `fixtures/vectors.json`. They are
    // NOT captured from this implementation — a vector taken from our own output
    // would prove only that the crate agrees with itself, and would happily lock in
    // a byte order that is wrong everywhere else. A refactor that silently changes
    // endianness, input order, input count or hash algorithm fails these tests.

    #[test]
    fn known_vectors_derive_class_randomness() {
        let vectors = derive_vectors();
        assert_eq!(
            vectors.len(),
            3,
            "expected the three fixture shapes; regenerate fixtures/vectors.json"
        );
        for v in vectors {
            let actual = derive_class_randomness(
                &v.vrf_seed,
                &v.slot_hash,
                v.entry_index,
                &v.pool_pubkey,
                &v.player_pubkey,
            );
            assert_eq!(
                actual,
                v.expected,
                "known vector '{}' mismatched\n  expected {}\n  actual   {}",
                v.name,
                hex(&v.expected),
                hex(&actual),
            );
        }
    }

    #[test]
    fn known_vectors_weighted_class_draw() {
        let vectors = draw_vectors();
        assert_eq!(
            vectors.len(),
            5,
            "expected one fixture per class; regenerate fixtures/vectors.json"
        );
        for v in &vectors {
            let actual = weighted_class_draw(&v.rng_bytes, &LAUNCH_CLASS_COUNTERS);
            assert_eq!(
                actual, v.expected_index,
                "draw vector '{}' expected class {} ({}), got {} ({})",
                v.name, v.expected_index, v.expected_class, actual, CLASS_NAMES[actual],
            );
        }

        // Every class is pinned by exactly one vector. A fixture regeneration that
        // silently dropped one would otherwise weaken this suite without failing it.
        let mut covered: Vec<usize> = vectors.iter().map(|v| v.expected_index).collect();
        covered.sort_unstable();
        assert_eq!(
            covered,
            (0..CLASS_NAMES.len()).collect::<Vec<_>>(),
            "draw vectors must pin every class exactly once",
        );
    }

    fn hex(bytes: &[u8; 32]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// The canonical stream is 130 bytes. This test recomputes the digest from a
    /// hand-built stream rather than calling the function, so a change to the input
    /// order or to the index encoding inside `derive_class_randomness` cannot pass
    /// unnoticed even if the fixtures were regenerated to match the change.
    #[test]
    fn canonical_stream_is_130_bytes_in_the_documented_order() {
        let vrf_seed = [0x11u8; 32];
        let slot_hash = [0x22u8; 32];
        let pool_pubkey = [0x33u8; 32];
        let player_pubkey = [0x44u8; 32];
        let entry_index: u16 = 0x0102;

        let mut stream = Vec::new();
        stream.extend_from_slice(&vrf_seed);
        stream.extend_from_slice(&slot_hash);
        stream.extend_from_slice(&entry_index.to_le_bytes());
        stream.extend_from_slice(&pool_pubkey);
        stream.extend_from_slice(&player_pubkey);
        assert_eq!(
            stream.len(),
            130,
            "canonical stream must be exactly 130 bytes"
        );

        let expected: [u8; 32] = Sha256::digest(&stream).into();
        assert_eq!(
            derive_class_randomness(
                &vrf_seed,
                &slot_hash,
                entry_index,
                &pool_pubkey,
                &player_pubkey
            ),
            expected,
        );
    }

    // ---------- Determinism ----------

    #[test]
    fn determinism_repeated_calls_match() {
        let vrf_seed = [0x42u8; 32];
        let slot_hash = [0x37u8; 32];
        let pool_pubkey = [0x11u8; 32];
        let player_pubkey = [0x99u8; 32];
        let entry_index: u16 = 37;

        let first = derive_class_randomness(
            &vrf_seed,
            &slot_hash,
            entry_index,
            &pool_pubkey,
            &player_pubkey,
        );
        for _ in 0..16 {
            let again = derive_class_randomness(
                &vrf_seed,
                &slot_hash,
                entry_index,
                &pool_pubkey,
                &player_pubkey,
            );
            assert_eq!(first, again, "derive_class_randomness must be pure");
        }
    }

    // ---------- Avalanche / sensitivity ----------
    //
    // For SHA-256 the expected Hamming distance from a single-bit input
    // perturbation is ~128 bits (half the digest). We assert > 96 — a loose bound
    // that catches any catastrophic input-mixing bug while staying well clear of
    // statistical flakiness. Each of the FIVE inputs is perturbed independently, so
    // a bug that ignores any one of them is caught. The player_pubkey case is new
    // in this crate: it is the input the predecessor did not have, and an
    // implementation that forgot to mix it would pass every other test here.

    const AVALANCHE_MIN_BIT_FLIPS: u32 = 96;

    /// Baseline inputs shared by the avalanche tests.
    fn avalanche_baseline() -> ([u8; 32], [u8; 32], u16, [u8; 32], [u8; 32]) {
        (
            [0x55u8; 32],
            [0x66u8; 32],
            42u16,
            [0x77u8; 32],
            [0x88u8; 32],
        )
    }

    fn assert_avalanche(label: &str, baseline: &[u8; 32], perturbed: &[u8; 32]) {
        let flips = hamming_bits(baseline, perturbed);
        assert!(
            flips > AVALANCHE_MIN_BIT_FLIPS,
            "{label} bit flip produced only {flips} digest bit flips (expected > {AVALANCHE_MIN_BIT_FLIPS})",
        );
    }

    #[test]
    fn avalanche_flip_vrf_seed_bit() {
        let (seed, slot, idx, pool, player) = avalanche_baseline();
        let baseline = derive_class_randomness(&seed, &slot, idx, &pool, &player);
        let mut perturbed_seed = seed;
        perturbed_seed[0] ^= 0x01;
        let perturbed = derive_class_randomness(&perturbed_seed, &slot, idx, &pool, &player);
        assert_avalanche("vrf_seed", &baseline, &perturbed);
    }

    #[test]
    fn avalanche_flip_slot_hash_bit() {
        let (seed, slot, idx, pool, player) = avalanche_baseline();
        let baseline = derive_class_randomness(&seed, &slot, idx, &pool, &player);
        let mut perturbed_slot = slot;
        perturbed_slot[15] ^= 0x80;
        let perturbed = derive_class_randomness(&seed, &perturbed_slot, idx, &pool, &player);
        assert_avalanche("slot_hash", &baseline, &perturbed);
    }

    #[test]
    fn avalanche_flip_entry_index_bit() {
        let (seed, slot, idx, pool, player) = avalanche_baseline();
        let baseline = derive_class_randomness(&seed, &slot, idx, &pool, &player);
        let perturbed = derive_class_randomness(&seed, &slot, idx ^ 0x0001, &pool, &player);
        assert_avalanche("entry_index", &baseline, &perturbed);
    }

    #[test]
    fn avalanche_flip_pool_pubkey_bit() {
        let (seed, slot, idx, pool, player) = avalanche_baseline();
        let baseline = derive_class_randomness(&seed, &slot, idx, &pool, &player);
        let mut perturbed_pool = pool;
        perturbed_pool[31] ^= 0x40;
        let perturbed = derive_class_randomness(&seed, &slot, idx, &perturbed_pool, &player);
        assert_avalanche("pool_pubkey", &baseline, &perturbed);
    }

    /// The input the predecessor crate did not have. An implementation that
    /// forgot to mix `player_pubkey` would pass every other test in this module.
    #[test]
    fn avalanche_flip_player_pubkey_bit() {
        let (seed, slot, idx, pool, player) = avalanche_baseline();
        let baseline = derive_class_randomness(&seed, &slot, idx, &pool, &player);
        let mut perturbed_player = player;
        perturbed_player[7] ^= 0x20;
        let perturbed = derive_class_randomness(&seed, &slot, idx, &pool, &perturbed_player);
        assert_avalanche("player_pubkey", &baseline, &perturbed);
    }

    /// Two players at the same seat index in the same pool and slot get different
    /// digests. This is the property `player_pubkey` was added for, stated
    /// directly rather than as a bit-flip bound.
    #[test]
    fn two_players_at_the_same_index_differ() {
        let (seed, slot, idx, pool, player_a) = avalanche_baseline();
        let mut player_b = player_a;
        player_b[0] ^= 0xff;
        assert_ne!(
            derive_class_randomness(&seed, &slot, idx, &pool, &player_a),
            derive_class_randomness(&seed, &slot, idx, &pool, &player_b),
        );
    }

    // ---------- weighted_class_draw — determinism and edge cases ----------

    fn rng_with_first_u64_le(n: u64) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&n.to_le_bytes());
        bytes
    }

    #[test]
    fn launch_counters_sum_to_capacity() {
        // A full pool must draw the bag exactly empty — one seat, one class.
        let total: u16 = LAUNCH_CLASS_COUNTERS.iter().sum();
        assert_eq!(
            total, CAPACITY,
            "launch class counters must sum to the pool capacity (PID §3)",
        );
    }

    #[test]
    fn weighted_class_draw_determinism_repeated_calls() {
        let rng = rng_with_first_u64_le(0x0123_4567_89ab_cdef);
        let first = weighted_class_draw(&rng, &LAUNCH_CLASS_COUNTERS);
        for _ in 0..16 {
            let again = weighted_class_draw(&rng, &LAUNCH_CLASS_COUNTERS);
            assert_eq!(first, again, "weighted_class_draw must be pure");
        }
    }

    /// Lone-Titan bag: one seat left, in the last slot. Any `rng_bytes` must land
    /// on index 4.
    #[test]
    fn weighted_class_draw_lone_titan_returns_index_4() {
        let counters = [0u16, 0, 0, 0, 1];
        for rng in [[0x00u8; 32], [0xfe; 32], rng_with_first_u64_le(0x1234_5678)] {
            assert_eq!(weighted_class_draw(&rng, &counters), 4);
        }
    }

    /// Lone-Goblin bag: one seat left, in the first slot. Any `rng_bytes` must
    /// land on index 0.
    #[test]
    fn weighted_class_draw_lone_goblin_returns_index_0() {
        let counters = [1u16, 0, 0, 0, 0];
        for rng in [[0x00u8; 32], [0x99; 32], rng_with_first_u64_le(0xabcd_ef01)] {
            assert_eq!(weighted_class_draw(&rng, &counters), 0);
        }
    }

    #[test]
    #[should_panic(expected = "empty bag")]
    fn weighted_class_draw_empty_bag_panics() {
        let counters = [0u16; 5];
        let rng = [0u8; 32];
        let _ = weighted_class_draw(&rng, &counters);
    }

    // ---------- weighted_class_draw — property tests ----------

    proptest! {
        /// On any valid `(rng_bytes, class_counters)` pair:
        ///   1. The returned index is in `0..5`.
        ///   2. The returned index points to a counter that was > 0 — the function
        ///      never draws a class the bag has run out of.
        ///   3. `class_counters` is unchanged across the call. Defense in depth:
        ///      the `&[u16; 5]` signature already prevents mutation, but a future
        ///      refactor to `&mut` would silently break the caller's contract that
        ///      the decrement happens at the call site.
        ///
        /// Counters range over `0..=CAPACITY`: a Blotto Cup bag never holds more
        /// than 64 of anything, so the strategy covers the real domain rather than
        /// the predecessor's arbitrary 0..1000.
        #[test]
        fn proptest_weighted_class_draw_invariants(
            c0 in 0u16..=CAPACITY,
            c1 in 0u16..=CAPACITY,
            c2 in 0u16..=CAPACITY,
            c3 in 0u16..=CAPACITY,
            c4 in 0u16..=CAPACITY,
            rng_bytes in any::<[u8; 32]>(),
        ) {
            let class_counters = [c0, c1, c2, c3, c4];
            prop_assume!(class_counters.iter().any(|&c| c > 0));

            let counters_before = class_counters;
            let idx = weighted_class_draw(&rng_bytes, &class_counters);

            prop_assert!(idx < 5, "index {} out of range [0, 5)", idx);
            prop_assert!(
                class_counters[idx] > 0,
                "drew class {} but its counter was 0 (class_counters = {:?})",
                idx, class_counters,
            );
            prop_assert_eq!(class_counters, counters_before);
        }
    }
}

/// Fixture loading for the unit tests.
///
/// `vectors.json` is embedded at compile time with `include_str!`, so the tests
/// have no runtime file dependency and no working-directory assumption. The
/// integration suite in `tests/properties.rs` does not use these vectors — it
/// asserts distribution and lifecycle properties, not fixed digests.
#[cfg(test)]
pub(crate) mod test_vectors {
    /// One `derive_class_randomness` known vector.
    pub(crate) struct DeriveVector {
        pub name: String,
        pub vrf_seed: [u8; 32],
        pub slot_hash: [u8; 32],
        pub entry_index: u16,
        pub pool_pubkey: [u8; 32],
        pub player_pubkey: [u8; 32],
        pub expected: [u8; 32],
    }

    /// One `weighted_class_draw` known vector.
    pub(crate) struct DrawVector {
        pub name: String,
        pub rng_bytes: [u8; 32],
        pub expected_index: usize,
        pub expected_class: String,
    }

    const VECTORS_JSON: &str = include_str!("../fixtures/vectors.json");

    /// A deliberately tiny JSON reader.
    ///
    /// The fixture file is generated by a script in this repository, so its shape
    /// is fixed and known. Pulling in `serde_json` to read three objects would add
    /// a dependency — and therefore an audit surface and a version to pin — to a
    /// crate whose entire point is to have almost none. This reads the two field
    /// types the fixture actually contains (quoted strings and bare integers) and
    /// panics loudly on anything unexpected, which in a test fixture is the
    /// correct failure mode.
    fn field(block: &str, key: &str) -> String {
        let needle = format!("\"{key}\":");
        let start = block
            .find(&needle)
            .unwrap_or_else(|| panic!("fixture block is missing key '{key}':\n{block}"))
            + needle.len();
        let rest = block[start..].trim_start();
        if let Some(stripped) = rest.strip_prefix('"') {
            let end = stripped
                .find('"')
                .unwrap_or_else(|| panic!("unterminated string for key '{key}'"));
            stripped[..end].to_string()
        } else {
            let end = rest
                .find([',', '\n', '}'])
                .unwrap_or_else(|| panic!("unterminated value for key '{key}'"));
            rest[..end].trim().to_string()
        }
    }

    fn bytes32(block: &str, key: &str) -> [u8; 32] {
        let hex = field(block, key);
        assert_eq!(
            hex.len(),
            64,
            "key '{key}' must be 64 hex characters (32 bytes), got {}",
            hex.len()
        );
        let mut out = [0u8; 32];
        for (i, slot) in out.iter_mut().enumerate() {
            *slot = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
                .unwrap_or_else(|_| panic!("key '{key}' is not valid hex: {hex}"));
        }
        out
    }

    /// Split the array that follows `"<name>": [` into its top-level `{ … }` blocks.
    fn blocks(section: &str) -> Vec<String> {
        let needle = format!("\"{section}\": [");
        let start = VECTORS_JSON
            .find(&needle)
            .unwrap_or_else(|| panic!("fixtures/vectors.json has no '{section}' array"))
            + needle.len();

        let mut out = Vec::new();
        let mut depth = 0usize;
        let mut current = String::new();
        for ch in VECTORS_JSON[start..].chars() {
            match ch {
                '{' => {
                    depth += 1;
                    current.push(ch);
                }
                '}' => {
                    depth -= 1;
                    current.push(ch);
                    if depth == 0 {
                        out.push(std::mem::take(&mut current));
                    }
                }
                ']' if depth == 0 => break,
                _ if depth > 0 => current.push(ch),
                _ => {}
            }
        }
        out
    }

    pub(crate) fn derive_vectors() -> Vec<DeriveVector> {
        blocks("derive")
            .iter()
            .map(|b| DeriveVector {
                name: field(b, "name"),
                vrf_seed: bytes32(b, "vrf_seed"),
                slot_hash: bytes32(b, "slot_hash"),
                entry_index: field(b, "entry_index")
                    .parse()
                    .expect("entry_index must be a u16"),
                pool_pubkey: bytes32(b, "pool_pubkey"),
                player_pubkey: bytes32(b, "player_pubkey"),
                expected: bytes32(b, "expected"),
            })
            .collect()
    }

    pub(crate) fn draw_vectors() -> Vec<DrawVector> {
        blocks("draw")
            .iter()
            .map(|b| DrawVector {
                name: field(b, "name"),
                rng_bytes: bytes32(b, "rng_bytes"),
                expected_index: field(b, "expected_index")
                    .parse()
                    .expect("expected_index must be a usize"),
                expected_class: field(b, "expected_class"),
            })
            .collect()
    }
}
