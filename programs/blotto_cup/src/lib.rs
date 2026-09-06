//! Blotto Cup on-chain program.
//!
//! Phase 1 (roadmap Phase 1): the full pool lifecycle. Money lives in
//! exactly two places — the per-pool prize vaults and the platform treasury
//! PDA (D-A1 revised) — and every transfer goes through `vault.rs`.
//!
//! # Two invariants that outrank any instruction added later
//!
//! **The prize vault has no withdraw instruction.** Its only lamport exits
//! are `pay_prizes`, `release_escrow`, `trigger_refund`'s pot return and
//! `forfeit_escrow` (D-A1 revised: `refund` repays entries from the
//! TREASURY, and the refund fork returns the untouched pot treasury-ward).
//! The platform treasury is a separate account with its own single gated
//! exit, `withdraw_platform` — a new account, not a fifth exit on the prize
//! vault. There is no escape hatch and no recover-stuck-funds instruction;
//! the standing-rules CI check pins `vault.rs`'s call sites.
//!
//! **There is no instruction that can thaw a character pass.** See `pass.rs`.
//!
//! See `docs/INDEX.md` for the source-of-truth map and `CLAUDE.md` for the
//! full hard-rule list.

// `clippy::diverging_sub_expression` fires on the entry-point glue emitted by
// Anchor 1.0's `#[program]` proc macro. The diagnostic is internal to generated
// code and out of our hands; suppressed at the crate level rather than
// workspace-wide.
#![allow(clippy::diverging_sub_expression)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod entry_packet;
pub mod error;
pub mod events;
pub mod instructions;
pub mod pass;
pub mod prize_math;
pub mod slot_hashes;
pub mod state;
pub mod vault;
pub mod vrf;

pub use instructions::*;
pub use pass::*;
pub use vrf::*;

use crate::constants::N_TIERS;
use crate::state::Payout;

// Devnet program identity, generated fresh during Phase 0 extraction. The
// predecessor's program ID (57goj6dM…) is NOT reused — see TRANSITION-REPORT.md,
// which also records where this keypair's private half lives (outside this
// repository, and never in it).
declare_id!("5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17");

#[program]
pub mod blotto_cup {
    use super::*;

    // ---- Admin (Squads vault only) --------------------------------------

    /// One-time global setup. Signer becomes admin; launch policy per the
    /// decision register (only the 0.1 tier open, every switch off; tier
    /// prices and pots seeded from the launch constants — D-A1 revised).
    pub fn init_config(
        ctx: Context<InitConfig>,
        entry_signer: Pubkey,
        settlement_signer: Pubkey,
        vault_ceiling_lamports: [u64; N_TIERS],
        treasury_min_platform_lamports: u64,
    ) -> Result<()> {
        instructions::handle_init_config(
            ctx,
            entry_signer,
            settlement_signer,
            vault_ceiling_lamports,
            treasury_min_platform_lamports,
        )
    }

    /// Kill switch: blocks `register` only — settlement and refunds keep
    /// working so pausing never strands funds.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::handle_set_paused(ctx, paused)
    }

    /// Rotate the entry-packet signer (TECH-ARCH §8).
    pub fn rotate_entry_signer(ctx: Context<AdminOnly>, new_signer: Pubkey) -> Result<()> {
        instructions::handle_rotate_entry_signer(ctx, new_signer)
    }

    /// Rotate the settlement signer.
    pub fn set_settlement_signer(ctx: Context<AdminOnly>, new_signer: Pubkey) -> Result<()> {
        instructions::handle_set_settlement_signer(ctx, new_signer)
    }

    /// Which tiers may open pools (R6, D1).
    pub fn set_open_tiers(ctx: Context<AdminOnly>, open_tiers: [bool; N_TIERS]) -> Result<()> {
        instructions::handle_set_open_tiers(ctx, open_tiers)
    }

    /// Per-tier gross-intake ceiling (D2), one tier per call.
    pub fn set_vault_ceiling(
        ctx: Context<AdminOnly>,
        tier: u8,
        ceiling_lamports: u64,
    ) -> Result<()> {
        instructions::handle_set_vault_ceiling(ctx, tier, ceiling_lamports)
    }

    /// KYC-at-claim switch (R3): 0 = off.
    pub fn set_kyc_threshold(ctx: Context<AdminOnly>, above_lamports: u64) -> Result<()> {
        instructions::handle_set_kyc_threshold(ctx, above_lamports)
    }

    /// R11's full-escrow-tier switch, published on-chain.
    pub fn set_detection_hard_block(ctx: Context<AdminOnly>, on: bool) -> Result<()> {
        instructions::handle_set_detection_hard_block(ctx, on)
    }

    /// One tier's price and pot (D-A1 revised; founder-owned numbers).
    /// Never touches an open pool — every pool copies both at open.
    pub fn set_tier_economics(
        ctx: Context<AdminTreasury>,
        tier: u8,
        price_lamports: u64,
        pot_lamports: u64,
    ) -> Result<()> {
        instructions::handle_set_tier_economics(ctx, tier, price_lamports, pot_lamports)
    }

    /// The treasury policy: `reserve_pots` further pots per idle enabled
    /// tier plus a minimum balance, both held back from `withdraw_platform`
    /// and required before `open_pool` funds a pot.
    pub fn set_treasury_policy(
        ctx: Context<AdminTreasury>,
        reserve_pots: u8,
        min_platform_lamports: u64,
    ) -> Result<()> {
        instructions::handle_set_treasury_policy(ctx, reserve_pots, min_platform_lamports)
    }

    // ---- Platform treasury (D-A1 revised) -------------------------------

    /// Anyone: deposit lamports into the platform treasury (the founder's
    /// bootstrap path, and where every pass sale lands).
    pub fn fund_platform_wallet(ctx: Context<FundPlatformWallet>, amount: u64) -> Result<()> {
        instructions::handle_fund_platform_wallet(ctx, amount)
    }

    /// Admin (Squads): the ONE treasury exit, blocked below the policy
    /// floor (minimum balance + idle-tier pot reserve + refundable entries).
    pub fn withdraw_platform(ctx: Context<WithdrawPlatform>, amount: u64) -> Result<()> {
        instructions::handle_withdraw_platform(ctx, amount)
    }

    // ---- Pool lifecycle -------------------------------------------------

    /// Anyone: open a pool in a tier (D-A1 revised — permissionless; the
    /// gates are the tier's enablement, the SEQUENTIAL rule, and the
    /// treasury policy; the pot funds from the treasury before any entry).
    pub fn open_pool(
        ctx: Context<OpenPool>,
        pool_id: u64,
        tier: u8,
        sealing_pubkey: [u8; 32],
        sealing_secret_hash: [u8; 32],
    ) -> Result<()> {
        instructions::handle_open_pool(ctx, pool_id, tier, sealing_pubkey, sealing_secret_hash)
    }

    /// Commit the pool's Switchboard On-Demand VRF seed. Write-once,
    /// permissionless, bundled with the Switchboard reveal (see `vrf.rs`).
    pub fn commit_vrf_seed(ctx: Context<CommitVrfSeed>, pool_id: u64) -> Result<()> {
        vrf::handle_commit_vrf_seed(ctx, pool_id)
    }

    /// Create the Metaplex Core Collection that groups a pool's character
    /// passes, with transfer permanently frozen at the Collection level.
    /// Metadata is derived on-chain (permissionless caller, so no caller
    /// input reaches the Collection — internal review IR-1).
    pub fn create_pass_collection(ctx: Context<CreatePassCollection>, pool_id: u64) -> Result<()> {
        pass::handle_create_pass_collection(ctx, pool_id)
    }

    /// Enter a pool: pay, submit the sealed battles hash, receive the class
    /// and the frozen pass. The 64th entry seals the pool; the entry that
    /// reaches the minimum field starts the go-timer (D-E4).
    pub fn register(ctx: Context<Register>, pool_id: u64, battles_hash: [u8; 32]) -> Result<()> {
        instructions::handle_register(ctx, pool_id, battles_hash)
    }

    /// Anyone: close a pool whose deadline has passed at or above the
    /// minimum field (D-E4). A pure function of state and time — the
    /// operator has no say in when a pool seals.
    pub fn seal_at_deadline(ctx: Context<SealAtDeadline>, pool_id: u64) -> Result<()> {
        instructions::handle_seal_at_deadline(ctx, pool_id)
    }

    // ---- Settlement -----------------------------------------------------

    /// Publish the pool's sealing secret (hash-checked against the value
    /// committed at open).
    pub fn reveal_pool_secret(
        ctx: Context<SettlePool>,
        pool_id: u64,
        secret: [u8; 32],
    ) -> Result<()> {
        instructions::handle_reveal_pool_secret(ctx, pool_id, secret)
    }

    /// Commit the full-ranking Merkle root and the settled payout list
    /// (D3-B: seat-sorted, duplicate-free, amounts summing to the pot —
    /// validated on-chain).
    pub fn commit_results(
        ctx: Context<SettlePool>,
        pool_id: u64,
        root: [u8; 32],
        payouts: Vec<Payout>,
    ) -> Result<()> {
        instructions::handle_commit_results(ctx, pool_id, root, payouts)
    }

    /// Pay (or escrow) a batch of committed seats. Idempotent via
    /// `Pool.paid_mask`; every committed seat settled → `Paid`.
    pub fn pay_prizes<'info>(
        ctx: Context<'info, PayPrizes<'info>>,
        pool_id: u64,
        seats: Vec<u16>,
    ) -> Result<()> {
        instructions::handle_pay_prizes(ctx, pool_id, seats)
    }

    // ---- Detection flags + escrow settlement ----------------------------

    /// Flag an entry (detection layer, R11): its prize share escrows at
    /// `pay_prizes` instead of paying.
    pub fn flag_entry(ctx: Context<FlagEntry>, pool_id: u64) -> Result<()> {
        instructions::handle_flag_entry(ctx, pool_id)
    }

    /// Clear an entry's flag before payout.
    pub fn clear_flag(ctx: Context<FlagEntry>, pool_id: u64) -> Result<()> {
        instructions::handle_clear_flag(ctx, pool_id)
    }

    /// Pay an escrowed share to its player (KYC packet required above the
    /// switch's threshold).
    pub fn release_escrow(ctx: Context<ReleaseEscrow>, pool_id: u64) -> Result<()> {
        instructions::handle_release_escrow(ctx, pool_id)
    }

    /// Move an upheld flag's escrowed share to the platform treasury.
    pub fn forfeit_escrow(ctx: Context<ForfeitEscrow>, pool_id: u64) -> Result<()> {
        instructions::handle_forfeit_escrow(ctx, pool_id)
    }

    // ---- Refund fork (R7) -----------------------------------------------

    /// Anyone: flip a pool past its deadline and below the minimum field
    /// into `Refunding` (at or above it, `seal_at_deadline` applies).
    pub fn trigger_refund(ctx: Context<TriggerRefund>, pool_id: u64) -> Result<()> {
        instructions::handle_trigger_refund(ctx, pool_id)
    }

    /// Anyone: refund one entry in full from the platform treasury (where
    /// 100% of the entry price landed at `register` — D-A1 revised).
    pub fn refund(ctx: Context<Refund>, pool_id: u64) -> Result<()> {
        instructions::handle_refund(ctx, pool_id)
    }
}
