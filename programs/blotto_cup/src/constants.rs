//! Program constants.
//!
//! Every value here traces to the PID, TECH-ARCH, or the ratified decision
//! register in `docs/architecture/DECISIONS.md` (CLAUDE.md: never invent values).
//! The one derived table — the prize bands — shows its derivation inline.

/// The LARGEST pool, and the size every fixed array is dimensioned by:
/// `Pool.payouts`, the `paid_mask` bit field (a `u64` — one bit per seat),
/// the class bag (`LAUNCH_CLASS_COUNTERS` sums to it). Since D-E19 (the
/// Ladder, founder ruling 2026-11-04) a pool's own size is `Pool.capacity`,
/// one of `POOL_CAPACITIES`; nothing gates a pool on this constant any more.
pub const CAPACITY: u16 = 64;

/// The four pool sizes (D-E19), smallest first. `init_pool_type` refuses
/// any other. Index into `LADDER_TABLES` / `LADDER_MIN_SEATS` by position.
pub const POOL_CAPACITIES: [u16; 4] = [8, 16, 32, 64];

/// The widest prize table: a 64-player pool pays its top quarter, 16 places.
/// `PoolType.prize_table` and `Pool.prize_table` are `[u8; MAX_PAID_PLACES]`.
pub const MAX_PAID_PLACES: usize = 16;

/// The published prize tables (D-E19), in whole multiples of the entry
/// price, rank 1 first, zero-padded to `MAX_PAID_PLACES`, one row per
/// `POOL_CAPACITIES` entry. Prize for rank r = `table[r-1] × entry_lamports`,
/// exact in integers at every tier. Every rank past the table is paid zero.
///
/// These are the LAUNCH values — what the admin configures each `PoolType`
/// with through `set_pool_type_economics` and what the rules page shows. The
/// program does not require a pool type to carry exactly these numbers; it
/// enforces their SHAPE (top quarter paid, never increasing, no zero inside
/// the paid places, the prize pool equal to the table at the price, the
/// prize pool no larger than the minimum field's entries). Mirrored in
/// `backend/scoring/src/prizes.ts` and the Python oracle; pinned together by
/// `scripts/check-mirrors.py` and the scoring vector suite.
pub const LADDER_TABLES: [[u8; MAX_PAID_PLACES]; 4] = [
    [3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [5, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [8, 4, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [12, 6, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
];

/// The minimum field per capacity (D-E19; generalises R7-b's 40 at 64): the
/// break-even field, where entries equal the prize pool (each table sums to
/// exactly its minimum field). A pool seals at its capacity, or at its
/// deadline with at least its minimum field; below it every entry refunds
/// in full. A seat count, never a percentage. The live value of a pool is
/// `Pool.min_seats`, copied from its `PoolType` at open.
pub const LADDER_MIN_SEATS: [u16; 4] = [5, 10, 20, 40];

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

// `MIN_SEATS` (40, R7-b) was the one minimum field while every pool held 64.
// Since D-E19 each pool type carries its own (`LADDER_MIN_SEATS`, copied onto
// `PoolType.min_seats` and then onto every pool at open). The rule it
// encoded is unchanged and now holds per size: the minimum field is exactly
// break-even — the prize pool equals its entries — so a pool sealing at its
// floor takes in precisely what it pays out (the founder's ruling of
// 2026-09-13: the prize pool is pre-funded from the treasury, D-A1, so a
// pool's ability to pay never depended on its own entries).

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
/// D-E1, 2026-09-06): 4 / 20 / 30 / 40 / 100 / 200 / 300 SOL — the prize
/// pool of a 64-player pool at each tier. Seeds `Config.tier_pot_lamports`.
///
/// Since D-E19 NO POOL IS FUNDED FROM THIS. Each pool type carries its own
/// fixed prize pool (`PoolType.pot_lamports`), and `open_pool` moves that.
/// The tier pot stays in Config's layout (offsets are load-bearing) as the
/// 64-player reference figure `set_tier_economics` records alongside the
/// price; it equals `LADDER_TABLES[3]`'s sum (40) times the tier's price.
pub const TIER_POT_LAMPORTS: [u64; N_TIERS] = [
    4_000_000_000,
    20_000_000_000,
    30_000_000_000,
    40_000_000_000,
    100_000_000_000,
    200_000_000_000,
    300_000_000_000,
];

// `PAID_RANKS` (1) and `PRIZE_BANDS_1024` ([1024]) — D-E2's winner-takes-all
// table in 1024ths of the pot — were retired by D-E19 together with the rule
// that every pot be a multiple of 1024 lamports. Under the Ladder a prize is
// `multiple × entry_lamports`, exact at every tier with no division at all,
// so the 1024ths grid has nothing left to guarantee (most 8- and 16-player
// prize pools are not multiples of 1024 lamports: 0.5 SOL is not).

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
