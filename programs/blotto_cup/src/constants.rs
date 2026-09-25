//! Program constants.
//!
//! Every value here traces to the PID, TECH-ARCH, or the ratified decision
//! register in `docs/BUILD-ROADMAP_v1.0.md` (CLAUDE.md: never invent values).
//! The one derived table — the prize bands — shows its derivation inline.

/// Seats per pool (PID §2, TECH-ARCH §2).
pub const CAPACITY: u16 = 64;

// The battle shape — seven battles of five stats summing to 100 — is
// deliberately NOT a constant here. This program never sees an allocation:
// `register` takes only `battles_hash`, and the plaintext appears after the
// pool secret is revealed. The shape is enforced where it can be, by the
// client at submission and by the scoring engine at reveal, and both read
// `STATS` / `BATTLES` / `ALLOCATION_SUM` from `backend/scoring/src/allocation.ts`.
// Unused mirrors of them lived here until 2026-09-07 and implied an on-chain
// check that does not exist.

/// The fill deadline seeded into `Config.fill_deadline_seconds` at
/// `init_config` / `migrate_config`: 12 hours (founder ruling 2026-09-07,
/// implementation prompt v2 — supersedes R7's 72 hours). The LIVE value is
/// Config state, copied onto each Pool at `open_pool`, so a later change
/// never touches a pool players already entered; this constant is only the
/// seed and the tests' reference. `set_pool_timing` changes the live value.
pub const DEFAULT_FILL_DEADLINE_SECS: i64 = 12 * 60 * 60;

/// The cooldown between a tier's pool settling (`Paid` / `Closed`) and its
/// next `open_pool`, seeded into `Config.cooldown_seconds`: 5 minutes
/// (implementation prompt v2 §B.5). Stamped as `Config.tier_next_open_at`
/// when the slot frees, so the "next pool opens in" countdown is on-chain
/// state, not a client guess.
pub const DEFAULT_COOLDOWN_SECS: i64 = 5 * 60;

// The keeper liveness fallback that used to live here (prompt v2 §A.3) was
// REMOVED by the founder ruling of 2026-09-07 (audit O9b/A5b). It let any
// signer open a tier idle for 24 hours, so that a dead daemon could not
// freeze it — but the opener also chooses the pool's sealing key, and a pool
// sealed to a key our custody does not hold can never be revealed, therefore
// never settled, and past `MIN_SEATS` it can no longer refund either. A
// frozen tier strands nothing; that pool would strand everything. See
// `open_pool.rs` for the full reasoning.

/// Escrow auto-release (prompt v2 §E.3): once a share has sat in escrow
/// this long without review, ANY signer may release it to the player.
/// Inaction pays the player, never the operator.
pub const ESCROW_AUTO_RELEASE_SECS: i64 = 7 * 24 * 60 * 60;

/// Minimum field for a pool to play (R7-b, founder instruction 2026-09-12;
/// was 52 under D-E4, 2026-09-06). A pool seals at the 64th entry, or at its
/// deadline when it holds at least this many seats (`seal_at_deadline`);
/// below it, every entry refunds in full. Nothing in between.
///
/// Expressed ONLY as a seat count, never as a percentage, anywhere in the
/// program, the engine or the copy.
///
/// THIS IS EXACTLY BREAK-EVEN, BY DECISION. At the D-E1 pots the pot is
/// forty entries' worth at every tier (`pot = price / 8 * 5 * 64 = price ×
/// 40`), so a pool sealing at this floor takes in precisely what it pays
/// out. D-E4's rule was that the minimum field must EXCEED the pot, which
/// bought a 12-seat buffer; the founder's ruling of 2026-09-13 spends that
/// buffer deliberately:
///
///   "We are keeping the size at 4 SOL. We accept that some pools will
///    break even. We are pre-funding the prize pool from the treasury
///    beforehand so the amount of money we take in is not relevant to the
///    number of players."
///
/// That is right about the mechanism: under D-A1 the pot is moved from the
/// treasury into the vault at `open_pool`, before any pass sells, so a
/// pool's ability to pay never depended on its own entries. The comparison
/// in `prize_math` and in `set_tier_economics` is therefore `pot <= MIN_SEATS
/// × price`, which admits exactly break-even and still refuses any pot
/// LARGER than the minimum field's intake. Margin is `1 − 40/seats` of
/// intake: nil at 40, 37.5% at a full 64.
pub const MIN_SEATS: u16 = 40;

/// The minimum field pools opened BEFORE R7-b played at (D-E4, 2026-09-06 —
/// 52 seats). `migrate_pool` writes this into every pool that predates
/// the per-pool `Pool.min_seats` field, because 52 is the number the players
/// in those pools actually entered under and the whole point of the field is
/// that a published value does not move beneath them.
///
/// RETIREMENT: goes with `migrate_pool`, once every deployment's pools are
/// at `Pool::SPACE`.
pub const MIN_SEATS_V1: u16 = 52;

/// Per-screen timer, seconds (roadmap R9: 15s visible, lock-current on timeout).
/// Stored on each `Pool` so a later founder change to Config does not silently
/// alter a pool that players already entered under the published value.
pub const TIMER_SECONDS: u8 = 15;

/// Number of CONFIGURED tiers (decision D1, 2026-08-27). Configured is not
/// open: `Config.open_tiers` starts 0.1-only (R6) and the founder opens the
/// rest with `set_open_tiers` when R6's conditions are met.
pub const N_TIERS: usize = 7;

/// The two placing rules a pool can play by (founder rulings 2026-09-24,
/// register D-E17). The program never sees an allocation, so it does not
/// enforce either rule; it RECORDS which one a pool plays by (`Pool.mode`)
/// so the crank scores with it and a player can recompute. Each mode has
/// its own per-tier slot, enable switch and cooldown on `Config`, and the
/// same price, pot and ceiling per tier (the founder's "same ladder").
///
/// Easy: seven battles of 100 points each — the rule every pool played
/// before 2026-09-24, so every pool that predates the field is mode 0.
pub const MODE_EASY: u8 = 0;
/// Hard: 700 points placed anywhere across the thirty-five cells.
pub const MODE_HARD: u8 = 1;
/// The number of modes; `open_pool` refuses anything at or above it.
pub const N_MODES: u8 = 2;

/// Configured tiers' INITIAL entry prices (roadmap R6 as amended by D1,
/// 2026-08-27): 0.1 / 0.5 / 0.75 / 1 / 2.5 / 5 / 7.5 SOL. Index = tier.
/// Since D-A1 (revised, master prompt v2 2026-08-27) prices live on `Config`
/// (founder-changeable via `set_tier_economics`); these constants seed
/// `init_config` and never touch an open pool.
pub const TIER_ENTRY_LAMPORTS: [u64; N_TIERS] = [
    100_000_000,
    500_000_000,
    750_000_000,
    1_000_000_000,
    2_500_000_000,
    5_000_000_000,
    7_500_000_000,
];

/// Configured tiers' INITIAL pots (D-A1 revised; amounts re-ratified by
/// D-E1, 2026-09-06): FIXED constants — 4 / 20 / 30 / 40 / 100 / 200 /
/// 300 SOL — funded from the platform treasury at `open_pool`, BEFORE any
/// pass is sold. The founder's stated derivation for these values is
/// 62.5% of price × 64 (equivalently price / 8 × 5 × 64, exact in integer
/// arithmetic at every tier); the derivation is history, the constant is
/// the law — on-chain a pot is a constant, never arithmetic over entries
/// or balances (the standing-rules grep asserts exactly that). Every value
/// is a multiple of 1024 lamports so the band table divides with zero
/// residue (prize_math tests assert per tier).
pub const TIER_POT_LAMPORTS: [u64; N_TIERS] = [
    4_000_000_000,
    20_000_000_000,
    30_000_000_000,
    40_000_000_000,
    100_000_000_000,
    200_000_000_000,
    300_000_000_000,
];

/// Number of paid places (D-E2, founder decision 2026-09-06: winner takes
/// all — PID §6 reissue pending counsel). Was 16 under PID §6 v0.5.
pub const PAID_RANKS: usize = 1;

/// Prize bands in 1024ths of the pot, rank 1 → rank `PAID_RANKS`.
///
/// D-E2 (2026-09-06): the player ranked first receives the entire pot —
/// `1024/1024`, exact for any pot. Ties for first split it through
/// `prize_math::split_group` (each = pot / k, the indivisible remainder to
/// the tied player with the lowest entry index); every rank below the
/// paid line receives zero, and ranks 2+ appear in the committed ranking
/// with amount 0.
///
/// The 1024ths form and the "pot is a multiple of 1024" invariant are kept
/// on purpose even though a single band no longer needs them: they cost
/// nothing, keep tie splits well-conditioned, and make a return to a
/// multi-place table a constants edit rather than a re-derivation. The
/// previous table (270/158/102/78/50×4/27×8, PID §6 v0.5) lives in git
/// history and in the revert branch prepared for the D-E2 upgrade.
pub const PRIZE_BANDS_1024: [u64; PAID_RANKS] = [1024];

/// Entry-packet freshness window, seconds (roadmap 4.1: "issued_at within 60s").
pub const PACKET_MAX_AGE_SECS: i64 = 60;

/// Forward clock-skew tolerance on `issued_at`. The packet service and the
/// cluster clock are different machines; a packet stamped marginally "in the
/// future" by drift must not be rejected. Five seconds is well under the
/// freshness window and does not extend it.
pub const PACKET_MAX_FUTURE_SKEW_SECS: i64 = 5;

/// Class counters at pool open (PID §3): Goblin, Knight, Wizard, Dragon, Titan.
/// Sum = 64 = CAPACITY, so a FULL pool empties the bag exactly. Under D-E4 a
/// pool may seal at `MIN_SEATS..CAPACITY`, in which case the bag is drawn
/// down but not emptied — the draw stays unbiased (uniform over the
/// remaining bag), the published rarity statement describes the bag rather
/// than the outcome (PID §3 reissue, founder-owned). Class is cosmetic and
/// read by nothing in the scoring path (PID §8.4).
/// The bag exists in three copies, and each one is now checked (2026-09-12,
/// audit A-17 — until then this line claimed an assertion that existed
/// nowhere):
///
///   - `blotto_randomness::LAUNCH_CLASS_COUNTERS`, the draw crate's own
///     copy — asserted equal by `class_counter_mirrors_hold` below;
///   - `crates/blotto-randomness/fixtures/vectors.json`, the Python oracle
///     the draw vectors are generated from — asserted equal by the same
///     test, so this constant is pinned to the oracle and not only to our
///     own Rust;
///   - `backend/class-digest/src/digest.ts`, the verify page's replay —
///     checked against THIS constant by `scripts/check-mirrors.py`, a CI
///     lane, because no Rust test can read a TypeScript module.
pub const LAUNCH_CLASS_COUNTERS: [u16; 5] = [38, 15, 7, 3, 1];

/// The class digest reads the slot hash from at least this many slots back
/// (TECH-ARCH §4: `slot_hash_{N-5}`). The delay is finalized before the
/// executing slot runs, so the executing validator has no influence over it.
pub const SLOT_HASH_DELAY: u64 = 5;

#[cfg(test)]
mod tests {
    use super::*;

    /// The Python oracle the class-draw vectors are generated from. Read as
    /// text and matched with whitespace removed: the program crate carries no
    /// JSON parser and cannot gain one (a dependency added for a test still
    /// enters the on-chain crate's tree), and the generator writes plain
    /// integers, so a textual match is exact. `#[cfg(test)]` keeps this out
    /// of the SBF artifact entirely.
    const DRAW_VECTORS_JSON: &str =
        include_str!("../../../crates/blotto-randomness/fixtures/vectors.json");

    /// The class bag is mirrored in three places (see `LAUNCH_CLASS_COUNTERS`).
    /// Two of them are Rust and are asserted here; the third is TypeScript and
    /// is checked by `scripts/check-mirrors.py` in CI.
    ///
    /// Why it matters that this holds: `open_pool` seeds every pool's bag from
    /// THIS constant, while the draw itself — `weighted_class_draw` — lives in
    /// `blotto-randomness` and is validated by that crate's property tests
    /// against ITS constant. If the two drifted, the published rarity statement
    /// and the tests proving the draw is unbiased would be describing a
    /// different bag from the one every pool actually uses, and nothing would
    /// have failed. The class is cosmetic (PID §8.4), so this is a published
    /// -claim correctness matter, never a scoring or money one.
    #[test]
    fn class_counter_mirrors_hold() {
        assert_eq!(
            LAUNCH_CLASS_COUNTERS,
            blotto_randomness::LAUNCH_CLASS_COUNTERS,
            "the pool's class bag and the draw crate's must be the same bag"
        );
        assert_eq!(
            CAPACITY,
            blotto_randomness::CAPACITY,
            "seats per pool must agree with the crate that draws one class per seat"
        );

        // A FULL pool empties the bag exactly (PID §3). Below capacity the bag
        // is drawn down but not emptied, which is D-E4's accepted consequence.
        let total: u32 = LAUNCH_CLASS_COUNTERS.iter().map(|&c| c as u32).sum();
        assert_eq!(
            total, CAPACITY as u32,
            "the class counters must sum to the pool capacity"
        );

        // And pinned to the oracle, so a hand-edit on the Rust side that also
        // "fixed" the crate's copy still fails.
        let compact: String = DRAW_VECTORS_JSON
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        let expected = format!(
            "\"class_counters\":[{}]",
            LAUNCH_CLASS_COUNTERS
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        assert!(
            compact.contains(&expected),
            "the published vectors must be generated from this bag; expected {expected} in \
             crates/blotto-randomness/fixtures/vectors.json — regenerate it with \
             `python3 fixtures/gen_vectors.py --write` if the bag legitimately changed"
        );
        assert!(
            compact.contains(&format!("\"capacity\":{}", CAPACITY)),
            "the published vectors must carry this capacity"
        );
    }
}
