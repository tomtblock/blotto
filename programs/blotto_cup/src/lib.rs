//! Blotto Cup on-chain program.
//!
//! Phase 1 (roadmap Phase 1): the full pool lifecycle. Everything the vault
//! does is here; nothing else holds money.
//!
//! # Two invariants that outrank any instruction added later
//!
//! **The prize vault has no withdraw instruction.** The only lamport exits
//! are `pay_prizes`, `release_escrow`, `refund` and `forfeit_escrow`
//! (roadmap §1.4; the fourth is its own design's forfeit path — see
//! `vault.rs`). There is no admin path, no escape hatch, no
//! recover-stuck-funds instruction. Every transfer goes through `vault.rs`,
//! and the standing-rules CI check pins that file's call sites.
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

use crate::constants::PAID_RANKS;

// Devnet program identity, generated fresh during Phase 0 extraction. The
// predecessor's program ID (57goj6dM…) is NOT reused — see TRANSITION-REPORT.md,
// which also records where this keypair's private half lives (outside this
// repository, and never in it).
declare_id!("4pspHqtbdgqKTvSxvKFT2ycEU28u3EWdxjmj3xsTHD3Y");

#[program]
pub mod blotto_cup {
    use super::*;

    // ---- Admin (Squads vault only) --------------------------------------

    /// One-time global setup. Signer becomes admin; launch policy per the
    /// decision register (only the 0.1 tier open, every switch off).
    pub fn init_config(
        ctx: Context<InitConfig>,
        entry_signer: Pubkey,
        settlement_signer: Pubkey,
        platform_wallet: Pubkey,
        vault_ceiling_lamports: u64,
    ) -> Result<()> {
        instructions::handle_init_config(
            ctx,
            entry_signer,
            settlement_signer,
            platform_wallet,
            vault_ceiling_lamports,
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

    /// Which tiers may open pools (R6).
    pub fn set_open_tiers(ctx: Context<AdminOnly>, open_tiers: [bool; 4]) -> Result<()> {
        instructions::handle_set_open_tiers(ctx, open_tiers)
    }

    /// Per-pool gross-intake ceiling (R6).
    pub fn set_vault_ceiling(ctx: Context<AdminOnly>, ceiling_lamports: u64) -> Result<()> {
        instructions::handle_set_vault_ceiling(ctx, ceiling_lamports)
    }

    /// KYC-at-claim switch (R3): 0 = off.
    pub fn set_kyc_threshold(ctx: Context<AdminOnly>, above_lamports: u64) -> Result<()> {
        instructions::handle_set_kyc_threshold(ctx, above_lamports)
    }

    /// R11's full-escrow-tier switch, published on-chain.
    pub fn set_detection_hard_block(ctx: Context<AdminOnly>, on: bool) -> Result<()> {
        instructions::handle_set_detection_hard_block(ctx, on)
    }

    // ---- Pool lifecycle -------------------------------------------------

    /// Open a pool in a tier (settlement signer; R6/R14 checks inside).
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
    pub fn create_pass_collection(
        ctx: Context<CreatePassCollection>,
        pool_id: u64,
        name: String,
        uri: String,
    ) -> Result<()> {
        pass::handle_create_pass_collection(ctx, pool_id, name, uri)
    }

    /// Enter a pool: pay, submit the sealed battles hash, receive the class
    /// and the frozen pass. The 64th entry seals the pool.
    pub fn register(ctx: Context<Register>, pool_id: u64, battles_hash: [u8; 32]) -> Result<()> {
        instructions::handle_register(ctx, pool_id, battles_hash)
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

    /// Commit the full-ranking Merkle root and the 16 winners in rank order.
    pub fn commit_results(
        ctx: Context<SettlePool>,
        pool_id: u64,
        root: [u8; 32],
        winners: [Pubkey; PAID_RANKS],
    ) -> Result<()> {
        instructions::handle_commit_results(ctx, pool_id, root, winners)
    }

    /// Pay (or escrow) a batch of committed ranks. Idempotent via
    /// `Pool.paid_mask`; all 16 settled → `Paid`.
    pub fn pay_prizes<'info>(
        ctx: Context<'info, PayPrizes<'info>>,
        pool_id: u64,
        ranks: Vec<u8>,
    ) -> Result<()> {
        instructions::handle_pay_prizes(ctx, pool_id, ranks)
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

    /// Move an upheld flag's escrowed share to the platform wallet.
    pub fn forfeit_escrow(ctx: Context<ForfeitEscrow>, pool_id: u64) -> Result<()> {
        instructions::handle_forfeit_escrow(ctx, pool_id)
    }

    // ---- Refund fork (R7) -----------------------------------------------

    /// Anyone: flip a pool past its deadline and below 64 into `Refunding`.
    pub fn trigger_refund(ctx: Context<TriggerRefund>, pool_id: u64) -> Result<()> {
        instructions::handle_trigger_refund(ctx, pool_id)
    }

    /// Anyone: refund one entry in full (80% from the vault + 20% from the
    /// fees PDA).
    pub fn refund(ctx: Context<Refund>, pool_id: u64) -> Result<()> {
        instructions::handle_refund(ctx, pool_id)
    }
}
