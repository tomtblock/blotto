//! Program events — TECH-ARCH §3.3 as amended by roadmap 1.8: `Claimed` is
//! replaced by `PrizesPaid`, plus `EscrowReleased` / `EscrowForfeited`.
//!
//! **Every recomputation input reaches the log** (TECH-ARCH §3.3). A player
//! who does not trust the operator reconstructs the whole pool from this
//! stream: `PoolOpened` carries the sealing key and secret hash,
//! `EntryRegistered` carries the battles hash, class, and the delayed slot
//! hash the class digest consumed, `PoolSecretRevealed` carries the secret
//! itself, and `ResultsCommitted` carries the root and winners. The off-chain
//! decoders in `backend/_shared/src/blotto-events.ts` mirror these structs
//! field-for-field — there is no committed IDL, so THESE STRUCTS ARE THE WIRE
//! CONTRACT. Change one and you must change the decoder in the same commit.

use anchor_lang::prelude::*;

#[event]
pub struct PoolOpened {
    pub pool: Pubkey,
    pub id: u64,
    pub tier: u8,
    pub entry_lamports: u64,
    /// The FIXED pot (D-A1 revised), moved from the platform treasury into
    /// the pool's prize vault in this same transaction — before any entry.
    pub pot_lamports: u64,
    pub fill_deadline: i64,
    pub timer_seconds: u8,
    pub sealing_pubkey: [u8; 32],
    pub sealing_secret_hash: [u8; 32],
}

// `PoolVrfSeeded` and `PassCollectionCreated` are declared beside their
// instructions (vrf.rs, pass.rs), carried from Phase 0.

#[event]
pub struct EntryRegistered {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub index: u16,
    pub battles_hash: [u8; 32],
    /// Cosmetic class (PID §3). Emitted for display and audit replay of the
    /// draw; read by nothing in the scoring path (PID §8.4).
    pub class: u8,
    /// The delayed slot hash the class digest consumed — with the seed from
    /// `PoolVrfSeeded` and the index above, anyone replays the draw.
    pub slot_hash: [u8; 32],
    pub pass_asset: Pubkey,
    /// Terms/attestation version from the verified entry packet (D-B4) —
    /// the durable record tying this entry to an accepted version.
    pub terms_version: u16,
}

/// The pool closed to entries — at the 64th seat (`register`) or at its
/// deadline with at least `MIN_SEATS` seats (`seal_at_deadline`, D-E4).
/// `entrants` is the field the pool plays with; below 64 it is the record a
/// holder reads their class draw and the winner's competition against.
#[event]
pub struct PoolSealed {
    pub pool: Pubkey,
    pub entrants: u16,
}

/// A tier's slot freed (its pool reached `Paid` or `Closed`) and its
/// cooldown started: the next pool in the tier may open at `next_open_at`
/// (prompt v2 §B.6). The app's "next pool in" countdown reads this, not a
/// client guess.
#[event]
pub struct TierSlotFreed {
    pub tier: u8,
    pub pool_id: u64,
    pub next_open_at: i64,
}

#[event]
pub struct PoolSecretRevealed {
    pub pool: Pubkey,
    /// The X25519 secret. Publishing it here is the design: from this moment
    /// anyone can decrypt every sealed entry and recompute the result
    /// (TECH-ARCH §5).
    pub secret: [u8; 32],
}

#[event]
pub struct ResultsCommitted {
    pub pool: Pubkey,
    /// Merkle root of the full 64-place ranking `(player, rank, amount)`,
    /// leaves ordered (rank asc, entry index asc) — ranks repeat under
    /// D3-B's shared competition ranks, entry index breaks the order.
    pub root: [u8; 32],
    /// The committed payout list (seat, lamports), sorted by seat — the
    /// exact set `pay_prizes` will settle. Amount sum equals the pot,
    /// validated on-chain; the ranking behind it is player-recomputable
    /// from the published bundle (the verify page's job).
    pub payouts: Vec<crate::state::Payout>,
}

/// One settled seat inside a `PrizesPaid` batch (D3-B: the paid set is the
/// committed payout list, keyed by seat, amounts fixed at commit).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PayoutRecord {
    pub player: Pubkey,
    /// Seat (entry index), 0-based.
    pub entry_index: u16,
    pub amount: u64,
    /// True when the share went to escrow (flag or KYC threshold) instead of
    /// being transferred.
    pub escrowed: bool,
}

#[event]
pub struct PrizesPaid {
    pub pool: Pubkey,
    pub payouts: Vec<PayoutRecord>,
    /// Seats settled so far, as a bitmask (bit = entry_index). Every
    /// committed payout's bit set = done.
    pub paid_mask: u64,
}

#[event]
pub struct EntryFlagged {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub flagged: bool,
}

#[event]
pub struct EscrowReleased {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
}

/// Review upheld a flag (admin-signed `forfeit_escrow`). Since 2026-09-07
/// (founder ruling 4) NO LAMPORT MOVES here: the share stays in the pool's
/// own vault, marked forfeited on the Entry, until `pay_next_place`
/// pays it to the next eligible place. `destination` is therefore the vault
/// itself — kept on the wire so the destination policy stays auditable per
/// event and old decoders keep decoding.
#[event]
pub struct EscrowForfeited {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
    pub destination: Pubkey,
}

/// A forfeited share paid to the next eligible place (`pay_next_place`,
/// founder ruling 4 (ii)): `rank` is the paid player's committed
/// competition rank (1 for a tied first-place member, 1 + k for the next
/// rank after a k-way tie), proven against `Pool.results_root`; `amount` is
/// the forfeited share paid, the whole of it.
#[event]
pub struct NextPlacePaid {
    pub pool: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub rank: u8,
    pub amount: u64,
}

/// `set_keeper`: the key allowed to open pools before the liveness fallback.
#[event]
pub struct KeeperSet {
    pub keeper: Pubkey,
}

/// `set_pool_timing`: the fill deadline applied to pools opened from now on
/// and the per-tier cooldown. Never touches an open pool.
#[event]
pub struct PoolTimingSet {
    pub fill_deadline_seconds: i64,
    pub cooldown_seconds: i64,
}

/// `migrate_config`: the one-shot growth of the Config account for the
/// 2026-09-07 layout, with the values it seeded.
#[event]
pub struct ConfigMigrated {
    pub keeper: Pubkey,
    pub fill_deadline_seconds: i64,
    pub cooldown_seconds: i64,
}

#[event]
pub struct RefundTriggered {
    pub pool: Pubkey,
    pub entrants: u16,
}

// --- Platform treasury (D-A1 revised, master prompt v2 2026-08-27) ---

#[event]
pub struct PlatformFunded {
    pub funder: Pubkey,
    pub amount: u64,
    /// Treasury balance AFTER the deposit — every treasury event carries the
    /// resulting balance so the /treasury report replays from the log alone.
    pub platform_balance: u64,
}

#[event]
pub struct PlatformWithdrawn {
    pub destination: Pubkey,
    pub amount: u64,
    /// Treasury balance AFTER the withdrawal.
    pub platform_balance: u64,
}

#[event]
pub struct TierEconomicsSet {
    pub tier: u8,
    pub price_lamports: u64,
    pub pot_lamports: u64,
}

#[event]
pub struct TreasuryPolicySet {
    pub reserve_pots: u8,
    pub min_platform_lamports: u64,
}

/// Tier enablement (`set_open_tiers`), emitted so the events ledger can tell
/// an enabled-idle tier from a disabled one. Before this the treasury report
/// had to treat every configured tier as enabled and could only OVERSTATE
/// the policy floor (the PHASE-A1-REVIEW note in
/// `backend/indexer/src/treasury-report.ts`); the keeper was never affected
/// — `nextOpenable` reads live Config.
#[event]
pub struct TiersOpened {
    pub open_tiers: [bool; crate::constants::N_TIERS],
}

#[event]
pub struct Refunded {
    pub pool: Pubkey,
    pub player: Pubkey,
    /// The FULL entry (vault share + platform share) — R7.
    pub amount: u64,
}
