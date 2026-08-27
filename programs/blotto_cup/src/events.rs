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

#[event]
pub struct PoolSealed {
    pub pool: Pubkey,
    pub entrants: u16,
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

#[event]
pub struct EscrowForfeited {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
    /// Where the forfeit went: the platform wallet (see the PHASE-1-REVIEW
    /// note in `instructions/escrow.rs` — the roadmap's forward-to-successor-vault design would
    /// strand the lamports). Emitted rather than implied so the destination
    /// policy is auditable per event.
    pub destination: Pubkey,
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

#[event]
pub struct Refunded {
    pub pool: Pubkey,
    pub player: Pubkey,
    /// The FULL entry (vault share + platform share) — R7.
    pub amount: u64,
}
