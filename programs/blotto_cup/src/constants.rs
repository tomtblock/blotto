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

/// Keeper liveness fallback (prompt v2 §A.3): `open_pool` is gated on
/// `Config.keeper`, but a tier whose slot has been free for this long may be
/// opened by ANY signer — a dead daemon must not freeze a tier permanently.
/// Measured from the tier's `tier_next_open_at` (the moment its cooldown
/// ended); a tier that never had a pool (`0`) is open to any signer.
pub const LIVENESS_FALLBACK_SECS: i64 = 24 * 60 * 60;

/// Escrow auto-release (prompt v2 §E.3): once a share has sat in escrow
/// this long without review, ANY signer may release it to the player.
/// Inaction pays the player, never the operator.
pub const ESCROW_AUTO_RELEASE_SECS: i64 = 7 * 24 * 60 * 60;

/// Minimum field for a pool to play (D-E4, founder decision 2026-09-06;
/// option A per the founder's ruling of 2026-09-07 — the go-timer was
/// removed). A pool seals at the 64th entry, or at its deadline when it
/// holds at least this many seats (`seal_at_deadline`); below it, every
/// entry refunds in full (R7 unchanged, threshold moved from 64). Nothing in
/// between. 52/64 is the first integer at or above the founder's 80% —
/// expressed ONLY as a seat count, never as a percentage, anywhere in the
/// program, the engine or the copy.
///
/// Must clear break-even at every tier: `MIN_SEATS × price > pot`. At the
/// D-E1 pots break-even is 40 seats (pot = price × 40 by derivation), so 52
/// carries a 12-seat buffer — asserted in `prize_math` tests against the
/// constants and enforced at `set_tier_economics` against the live values.
pub const MIN_SEATS: u16 = 52;

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
/// Mirrors `blotto_randomness::LAUNCH_CLASS_COUNTERS`; asserted equal in tests.
pub const LAUNCH_CLASS_COUNTERS: [u16; 5] = [38, 15, 7, 3, 1];

/// The class digest reads the slot hash from at least this many slots back
/// (TECH-ARCH §4: `slot_hash_{N-5}`). The delay is finalized before the
/// executing slot runs, so the executing validator has no influence over it.
pub const SLOT_HASH_DELAY: u64 = 5;
