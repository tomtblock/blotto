//! Program events — TECH-ARCH §3.3 as amended by roadmap 1.8: `Claimed` is
//! replaced by `PrizesPaid`, plus `EscrowReleased` / `EscrowForfeited`.
//!
//! **Every recomputation input reaches the log** (TECH-ARCH §3.3). A player
//! who does not trust the operator reconstructs the whole pool from this
//! stream: `PoolOpened` carries the sealing key and secret hash,
//! `EntryRegistered` carries the battles hash, class, and the delayed slot
//! hash the class digest consumed, `PoolSecretRevealed` carries the secret
//! itself, and `ResultsCommitted` carries the root and winners. The off-chain
//! decoders in `backend/_shared/src/events.ts` mirror these structs
//! field-for-field — there is no committed IDL, so THESE STRUCTS ARE THE WIRE
//! CONTRACT. Change one and you must change the decoder in the same commit.

use anchor_lang::prelude::*;

#[event]
pub struct PoolOpened {
    pub pool: Pubkey,
    pub id: u64,
    pub tier: u8,
    pub entry_lamports: u64,
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
    /// Merkle root of the full 64-place ranking `(player, rank, amount)`.
    pub root: [u8; 32],
    /// Top 16, rank order — the players `pay_prizes` will pay.
    pub winners: Vec<Pubkey>,
}

/// One settled rank inside a `PrizesPaid` batch.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PayoutRecord {
    pub player: Pubkey,
    pub rank: u8,
    pub amount: u64,
    /// True when the share went to escrow (flag or KYC threshold) instead of
    /// being transferred.
    pub escrowed: bool,
}

#[event]
pub struct PrizesPaid {
    pub pool: Pubkey,
    pub payouts: Vec<PayoutRecord>,
    /// Ranks settled so far, as a bitmask (bit r-1 = rank r). 0xFFFF = done.
    pub paid_mask: u16,
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
    /// Where the forfeit went: the next open pool's vault of the same tier,
    /// or the platform wallet if none (roadmap §1.4).
    pub destination: Pubkey,
}

#[event]
pub struct RefundTriggered {
    pub pool: Pubkey,
    pub entrants: u16,
}

#[event]
pub struct Refunded {
    pub pool: Pubkey,
    pub player: Pubkey,
    /// The FULL entry (vault share + platform share) — R7.
    pub amount: u64,
}
