//! Program constants.
//!
//! Every value here traces to the PID, TECH-ARCH, or the ratified decision
//! register in `docs/BUILD-ROADMAP_v1.0.md` (CLAUDE.md: never invent values).
//! The one derived table — the prize bands — shows its derivation inline.

/// Seats per pool (PID §2, TECH-ARCH §2).
pub const CAPACITY: u16 = 64;

/// Stats per battle (TECH-ARCH §2): Strength, Speed, Heart, Wit, Durability.
pub const STATS: usize = 5;

/// Battles per entry (PID §4.5, TECH-ARCH §2).
pub const BATTLES: usize = 7;

/// Fill deadline: 72 hours (PID §2, roadmap R7).
pub const FILL_DEADLINE_SECS: i64 = 72 * 60 * 60;

/// Per-screen timer, seconds (roadmap R9: 15s visible, lock-current on timeout).
/// Stored on each `Pool` so a later founder change to Config does not silently
/// alter a pool that players already entered under the published value.
pub const TIMER_SECONDS: u8 = 15;

/// Number of CONFIGURED tiers (decision D1, 2026-08-27). Configured is not
/// open: `Config.open_tiers` starts 0.1-only (R6) and the founder opens the
/// rest with `set_open_tiers` when R6's conditions are met.
pub const N_TIERS: usize = 7;

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

/// Number of paid places (PID §6: top 16).
pub const PAID_RANKS: usize = 16;

/// Prize bands in 1024ths of the pot, rank 1 → rank 16.
///
/// # Derivation (PID §6 — shown, not asserted)
///
/// The 1024ths are unchanged by D-E1; only the pot they divide moved.
/// At the D-E1 tier-0 pot (62.5% × 6.4 = 4 SOL) the published amounts
/// become (PID §6 reissue pending — the founder document still shows the
/// pre-D-E1 5.12-pot amounts until counsel signs the reissue):
///
/// | Place  | SOL        | fraction of 4    | ×1024 |
/// |--------|------------|------------------|-------|
/// | 1st    | 1.0546875  | 135/512          | 270   |
/// | 2nd    | 0.6171875  |  79/512          | 158   |
/// | 3rd    | 0.3984375  |  51/512          | 102   |
/// | 4th    | 0.3046875  |  39/512          |  78   |
/// | 5–8th  | 0.1953125  |  25/512 each     |  50   |
/// | 9–16th | 0.10546875 |  27/1024 each    |  27   |
///
/// 270 + 158 + 102 + 78 + 4×50 + 8×27 = **1024 exactly**, so the pot divides
/// with zero residual for every tier (each tier's pot is a multiple of 1024
/// lamports — see `prize_math` tests).
///
/// The PID's *percentage* column (26.37% …) is rounded for display and sums to
/// 100.02%; a bps table built from it would misallocate. The SOL amounts are
/// the exact founder-published values, and this table is their exact form.
/// Recorded in `docs/phase-reports/phase-1-program.md`.
pub const PRIZE_BANDS_1024: [u64; PAID_RANKS] = [
    270, 158, 102, 78, 50, 50, 50, 50, 27, 27, 27, 27, 27, 27, 27, 27,
];

/// Entry-packet freshness window, seconds (roadmap 4.1: "issued_at within 60s").
pub const PACKET_MAX_AGE_SECS: i64 = 60;

/// Forward clock-skew tolerance on `issued_at`. The packet service and the
/// cluster clock are different machines; a packet stamped marginally "in the
/// future" by drift must not be rejected. Five seconds is well under the
/// freshness window and does not extend it.
pub const PACKET_MAX_FUTURE_SKEW_SECS: i64 = 5;

/// Class counters at pool open (PID §3): Goblin, Knight, Wizard, Dragon, Titan.
/// Sum = 64 = CAPACITY, so a full pool empties the bag exactly.
/// Mirrors `blotto_randomness::LAUNCH_CLASS_COUNTERS`; asserted equal in tests.
pub const LAUNCH_CLASS_COUNTERS: [u16; 5] = [38, 15, 7, 3, 1];

/// The class digest reads the slot hash from at least this many slots back
/// (TECH-ARCH §4: `slot_hash_{N-5}`). The delay is finalized before the
/// executing slot runs, so the executing validator has no influence over it.
pub const SLOT_HASH_DELAY: u64 = 5;
