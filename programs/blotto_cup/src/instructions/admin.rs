//! Admin instructions (roadmap 1.1). Admin = the Squads vault (R21) — every
//! instruction here requires its signature via `has_one = admin`, so a
//! non-admin signer fails Anchor's `ConstraintHasOne` before any handler runs.
//!
//! Since D-A1 (revised) the revenue and forfeit destination is the
//! program-held platform treasury PDA, not an operator wallet — so there is
//! nothing to re-point and no `set_platform_wallet` exists. The treasury's
//! own admin setters (`set_tier_economics`, `set_treasury_policy`,
//! `withdraw_platform`) live in `instructions/treasury.rs`.

use anchor_lang::prelude::*;

use crate::constants::{N_TIERS, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS};
use crate::error::ErrorCode;
use crate::state::{Config, CONFIG_SEED, PLATFORM_SEED};

// ---------------------------------------------------------------------------
// init_config
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitConfig<'info> {
    /// Becomes `Config.admin`. Deployed with the devnet Squads vault signing
    /// (roadmap 1.1), so admin is the multisig from the first transaction.
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Config::SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: The platform treasury PDA — passed so its canonical bump is
    /// derived and captured once, here. The account itself stays a
    /// zero-data system account funded lazily by the first deposit.
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// One-time global setup. `init` makes it write-once: a second call finds the
/// PDA initialized and reverts.
///
/// Launch policy baked in rather than parameterized (each traces to a register
/// row): only the 0.1 SOL tier open (R6), not paused, detection full-escrow
/// switch off (R11), KYC-at-claim switch off (R3), tier prices and pots from
/// the published launch constants (D-A1 revised: founder-changeable later via
/// `set_tier_economics`), treasury reserve of ONE further pot per idle enabled
/// tier (v2 default). The founder-owned numbers that may legitimately differ
/// per deploy — signers, ceilings, the treasury's minimum balance — are
/// arguments.
pub fn handle_init_config(
    ctx: Context<InitConfig>,
    entry_signer: Pubkey,
    settlement_signer: Pubkey,
    vault_ceiling_lamports: [u64; N_TIERS],
    treasury_min_platform_lamports: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.entry_signer = entry_signer;
    config.settlement_signer = settlement_signer;
    config.paused = false;
    // R6 as amended by D1: seven tiers configured; open at launch: 0.1
    // ONLY. Written out, not computed, so the launch policy is readable.
    config.open_tiers = [true, false, false, false, false, false, false];
    config.vault_ceiling_lamports = vault_ceiling_lamports;
    // D-A1 revised: prices and pots are Config state, seeded from the launch
    // constants; `set_tier_economics` changes them later (never an open pool).
    config.tier_price_lamports = TIER_ENTRY_LAMPORTS;
    config.tier_pot_lamports = TIER_POT_LAMPORTS;
    // Treasury policy defaults (v2): one further pot per idle enabled tier.
    config.treasury_reserve_pots = 1;
    config.treasury_min_platform_lamports = treasury_min_platform_lamports;
    config.platform_reserved = 0;
    config.platform_refundable = 0;
    // R3: the KYC-at-claim switch starts off at launch (0 = off).
    config.kyc_required_above_lamports = 0;
    // R11: full escrow tier behind an admin switch, off at launch. The
    // baseline hard blocks (exact-duplicate sets, same-device multi-entry)
    // are `flag_entry` calls by the detection layer, not this switch.
    config.detection_hard_block = false;
    // Pool ids start at 1: 0 is `active_pool_by_tier`'s "none" sentinel.
    config.next_pool_id = 1;
    config.active_pool_by_tier = [0; N_TIERS];
    config.bump = ctx.bumps.config;
    config.platform_bump = ctx.bumps.platform;
    Ok(())
}

// ---------------------------------------------------------------------------
// The shared admin-only context
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    /// Must equal `Config.admin` (the Squads vault) — `has_one` enforces it.
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin,
    )]
    pub config: Box<Account<'info, Config>>,
}

/// Kill switch: blocks `register` (and only `register` — reveal, payout and
/// refund keep working so paused never strands funds).
pub fn handle_set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

/// Rotate the Turnkey-custodied packet signer (TECH-ARCH §8). Old packets die
/// instantly: `register` binds against the CURRENT value.
pub fn handle_rotate_entry_signer(ctx: Context<AdminOnly>, new_signer: Pubkey) -> Result<()> {
    ctx.accounts.config.entry_signer = new_signer;
    Ok(())
}

/// Rotate the settlement signer (open/reveal/commit/pay/flag/escrow signer).
pub fn handle_set_settlement_signer(ctx: Context<AdminOnly>, new_signer: Pubkey) -> Result<()> {
    ctx.accounts.config.settlement_signer = new_signer;
    Ok(())
}

/// Which tiers may open pools (R6: 0.5 opens only after audit + one counsel
/// opinion; higher tiers only by explicit founder decision).
pub fn handle_set_open_tiers(ctx: Context<AdminOnly>, open_tiers: [bool; N_TIERS]) -> Result<()> {
    ctx.accounts.config.open_tiers = open_tiers;
    Ok(())
}

/// Per-TIER gross ceiling (D2), one tier per call — so a Squads proposal
/// reads as "raise tier 2's ceiling", never "replace the whole table".
/// Checked at `open_pool` only: lowering a ceiling never affects a pool
/// already open, it blocks the NEXT open in that tier.
pub fn handle_set_vault_ceiling(
    ctx: Context<AdminOnly>,
    tier: u8,
    ceiling_lamports: u64,
) -> Result<()> {
    require!((tier as usize) < N_TIERS, ErrorCode::UnknownTier);
    ctx.accounts.config.vault_ceiling_lamports[tier as usize] = ceiling_lamports;
    Ok(())
}

/// KYC-at-claim switch (R3, roadmap 4.5). 0 = off. When non-zero,
/// `pay_prizes` escrows any share above it and `release_escrow` demands a
/// `kyc_tier ≥ 1` packet.
pub fn handle_set_kyc_threshold(ctx: Context<AdminOnly>, above_lamports: u64) -> Result<()> {
    ctx.accounts.config.kyc_required_above_lamports = above_lamports;
    Ok(())
}

/// R11's full-escrow-tier switch, published on-chain so the operative
/// detection policy is public. Read by the off-chain detection layer.
pub fn handle_set_detection_hard_block(ctx: Context<AdminOnly>, on: bool) -> Result<()> {
    ctx.accounts.config.detection_hard_block = on;
    Ok(())
}
