//! Integration property tests for the public randomness API.
//!
//! Exercises only the public surface (`derive_class_randomness`,
//! `weighted_class_draw`) — internal modules are not visible from this binary, by
//! design.
//!
//! Two tests:
//!
//! - **Distribution convergence.** Generates 100,000 deterministic `rng_bytes` by
//!   sweeping the `entry_index` domain — with an epoch byte mixed into `vrf_seed`
//!   so all 100,000 inputs stay distinct — through `derive_class_randomness`, then
//!   draws against the launch counter distribution `[38, 15, 7, 3, 1]`. Empirical
//!   class frequencies must land within ±2 percentage points (absolute) of the
//!   expected ratios. Exercises both public functions together, mirroring the
//!   on-chain caller's flow.
//! - **Full-pool invariant.** Simulates `register`'s draw→decrement loop across a
//!   whole 64-seat pool, asserting the bag-without-replacement invariants and the
//!   PID's fixed class structure (exactly one Titan, exactly three Dragons) at the
//!   terminal state.
//!
//! All test inputs are integer-only and deterministic — no randomness, no
//! flakiness, same output every run.

use blotto_randomness::{derive_class_randomness, weighted_class_draw, CAPACITY};

/// Launch class counters (PID §3): Goblin, Knight, Wizard, Dragon, Titan.
const LAUNCH_CLASS_COUNTERS: [u16; 5] = [38, 15, 7, 3, 1];

/// Sum of `LAUNCH_CLASS_COUNTERS`. Written as a `const` so the tests assert
/// against the documented invariant — one seat, one class, 64 of each per pool —
/// rather than against `counters.iter().sum()`, which would agree with a wrong
/// array as readily as a right one.
const TOTAL_COUNTERS: u32 = 64;

/// Number of draws in the convergence test.
///
/// `entry_index` is a `u16` (max 65,535), so a single incrementing sweep cannot
/// reach 100,000 distinct values on that input alone. The loop splits the
/// iteration counter into an `(epoch, entry_index)` pair: the low 16 bits drive
/// `entry_index` across its full natural domain, and the epoch (high bits) is
/// mixed into `vrf_seed` so each epoch's sweep yields a fresh digest stream. Every
/// one of the N draws is therefore a distinct, non-aliased input.
///
/// At N = 100,000 the 95% binomial CI for the rarest class (Titan, p = 1/64 ≈
/// 0.0156) is ≈ ±0.0008 absolute — well inside the ±0.02 tolerance window.
const N: usize = 100_000;

/// ±2 percentage points absolute tolerance, expressed in count units.
/// `N / 50` because `N * 0.02 = N / 50` — and integer math throughout, since the
/// workspace forbids floats even in tests.
const TOLERANCE: usize = N / 50;

/// The class counters must sum to the pool capacity. Asserted here as well as in
/// the unit suite because both files hardcode the array, and a divergence between
/// them would otherwise be silent.
#[test]
fn launch_counters_sum_to_capacity() {
    let total: u32 = LAUNCH_CLASS_COUNTERS.iter().map(|&c| c as u32).sum();
    assert_eq!(total, TOTAL_COUNTERS);
    assert_eq!(total, CAPACITY as u32);
}

/// Distribution convergence against the launch class counters.
///
/// Builds a deterministic stream of 100,000 distinct digests by sweeping
/// `entry_index` across its full `u16` domain through `derive_class_randomness`,
/// with the iteration's epoch folded into `vrf_seed` so no input aliases another
/// (`slot_hash`, `pool_pubkey` and `player_pubkey` fixed). For each digest, draws a
/// class against the fixed counter array — no decrement, because this measures the
/// raw weighting, not the bag-without-replacement lifecycle, which is the next
/// test's job.
///
/// **Tolerance reasoning.** ±2 pp absolute is a gross-bias detector, not a tight
/// statistical bound. For Goblin (expected 59.4%) it is a tight ~3% relative
/// window. For Titan (expected 1.56%) the same window admits anything in
/// [0%, 3.56%] — deliberately wide. A bug that pushes Titan to 10% fails loudly;
/// statistical fluctuation at the tail does not.
///
/// **Reproducibility.** No randomness anywhere — fixed seeds and a counter loop.
/// Same bytes in, same observation counts out, every run.
#[test]
fn distribution_convergence_100k_draws() {
    let vrf_seed = [0x77u8; 32];
    let slot_hash = [0x88u8; 32];
    let pool_pubkey = [0x99u8; 32];
    let player_pubkey = [0xaau8; 32];

    let mut observed = [0usize; 5];

    for i in 0..N {
        // Split `i` into (epoch, entry_index): the low 16 bits sweep entry_index
        // across its full domain, and the epoch is XOR-mixed into vrf_seed[0] so
        // each epoch's sweep is a fresh digest stream. Without this, iterations
        // 65_536.. would wrap onto entry_index 0.. and re-derive digests already
        // drawn, collapsing the effective sample to ~65k. With N = 100_000 the
        // epoch is {0, 1}, so one byte suffices and the two epoch-seeds differ in
        // byte 0 — no epoch-0 input can collide with an epoch-1 input.
        let entry_index = (i % 65_536) as u16;
        let epoch = (i / 65_536) as u8;
        let mut vrf_seed_i = vrf_seed;
        vrf_seed_i[0] ^= epoch;

        let rng_bytes = derive_class_randomness(
            &vrf_seed_i,
            &slot_hash,
            entry_index,
            &pool_pubkey,
            &player_pubkey,
        );
        let class = weighted_class_draw(&rng_bytes, &LAUNCH_CLASS_COUNTERS);
        observed[class] += 1;
    }

    let total_observed: usize = observed.iter().sum();
    assert_eq!(
        total_observed, N,
        "every draw must classify into exactly one class (got {total_observed}, expected {N})",
    );

    let mut failures = Vec::new();
    for (i, (&obs, &count)) in observed
        .iter()
        .zip(LAUNCH_CLASS_COUNTERS.iter())
        .enumerate()
    {
        // Integer math throughout: expected = floor(N * counters[i] / total). The
        // floor's 1-count error is dwarfed by TOLERANCE (= N / 50 = 2_000).
        let expected = N * count as usize / TOTAL_COUNTERS as usize;
        let diff = obs.abs_diff(expected);
        if diff > TOLERANCE {
            failures.push(format!(
                "class {i}: observed {obs}, expected ~{expected}, diff {diff} > tolerance {TOLERANCE}"
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "distribution convergence failed at N = {N}, tolerance ±{TOLERANCE} (±2 pp):\n  {}",
        failures.join("\n  "),
    );
}

/// Full-pool invariant: 64 draws exhaust the bag, with the fixed class structure.
///
/// Simulates the exact draw→decrement loop `register` will run from pool open to
/// the 64th entry. For `entry_index = 0..64`, derives `rng_bytes`, draws a class,
/// then decrements that class's counter — the same sequence the on-chain handler
/// must follow.
///
/// **Invariants checked across the pool.**
/// - Every draw returns an index whose counter was `> 0` at the moment of the draw.
/// - After iteration `i`, the counter sum equals `64 - (i + 1)`: the sum decreases
///   by exactly one per entry.
/// - After 64 iterations every counter is exactly `0`.
/// - Draws per class match the launch distribution **exactly**: 38 Goblins, 15
///   Knights, 7 Wizards, 3 Dragons, 1 Titan. This is the strongest form of the
///   PID's fixed-structure promise — every full pool contains exactly one Titan,
///   no more and no fewer, and no seat can influence which one it lands on.
/// - After the bag is empty, a further `weighted_class_draw` call panics per the
///   function's documented contract. Verified via `catch_unwind` so the expected
///   panic does not abort this test. On-chain this branch is unreachable: the pool
///   transitions to `Sealed` at the 64th entry and `register` is rejected before
///   reaching the draw.
///
/// **Player pubkeys vary per seat**, unlike the fixed pubkey in the convergence
/// test above — 64 seats in a real pool are 64 different wallets, and this is the
/// input the predecessor's equivalent test did not have.
///
/// **Fixed inputs are deliberately distinct** from the convergence test's
/// `0x77/0x88/0x99`, so a bug correlated to a particular byte pattern surfaces in
/// at least one of the two.
#[test]
fn full_pool_invariant_64_draws_exhausts_bag() {
    let vrf_seed = [0x11u8; 32];
    let slot_hash = [0x22u8; 32];
    let pool_pubkey = [0x33u8; 32];

    let mut class_counters = LAUNCH_CLASS_COUNTERS;
    let mut draws_per_class = [0u16; 5];

    let total = TOTAL_COUNTERS as usize;
    for i in 0..total {
        // safe: i < 64 < u16::MAX.
        let entry_index = i as u16;
        // A distinct player per seat, as in a real pool.
        let player_pubkey = [i as u8; 32];

        let rng_bytes = derive_class_randomness(
            &vrf_seed,
            &slot_hash,
            entry_index,
            &pool_pubkey,
            &player_pubkey,
        );
        let class = weighted_class_draw(&rng_bytes, &class_counters);

        assert!(
            class_counters[class] > 0,
            "seat {i}: drew class {class} but its counter was already 0 (counters = {class_counters:?})",
        );

        class_counters[class] -= 1;
        draws_per_class[class] += 1;

        let remaining: usize = class_counters.iter().map(|&c| c as usize).sum();
        let expected_remaining = total - (i + 1);
        assert_eq!(
            remaining, expected_remaining,
            "seat {i}: counter sum {remaining} should be {expected_remaining} (= total - (i + 1))",
        );
    }

    assert_eq!(
        class_counters, [0u16; 5],
        "bag must be empty after {total} draws (got {class_counters:?})",
    );

    // Bag-without-replacement means draws-per-class equals the launch counters
    // exactly. The array equality subsumes the two named checks below, but both
    // are asserted so the PID's fixed structure is explicit at the failure site.
    assert_eq!(
        draws_per_class, LAUNCH_CLASS_COUNTERS,
        "draws-per-class must equal the launch distribution exactly (got {draws_per_class:?})",
    );
    assert_eq!(
        draws_per_class[4], 1,
        "PID §3: exactly one Titan per full pool",
    );
    assert_eq!(
        draws_per_class[3], 3,
        "PID §3: exactly three Dragons per full pool",
    );

    // Post-fill panic check. Per the documented contract, draws against an empty
    // bag panic. Verified via catch_unwind so the expected panic does not abort
    // the test process.
    //
    // No panic hook is installed to silence the stderr noise: panic hooks are
    // process-global and cargo runs tests in parallel, so silencing here would
    // swallow legitimate panics in concurrent tests. One line of expected panic
    // output is the accepted cost.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        weighted_class_draw(&[0xffu8; 32], &class_counters)
    }));
    assert!(
        result.is_err(),
        "weighted_class_draw on an empty bag must panic per its # Panics contract",
    );
}
