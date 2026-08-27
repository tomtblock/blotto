//! `open_pool` (roadmap 1.2 as revised by D-A1 v2, 2026-08-27) —
//! PERMISSIONLESS: any signer may open the next pool of a tier once the
//! program's own gates pass. The daemon has no discretion; the checks here
//! ARE the policy:
//!
//!   1. the tier is enabled (R6 switch);
//!   2. the tier's previous pool reached `Paid` or `Closed` (SEQUENTIAL
//!      pools per tier — the `active_pool_by_tier` slot clears only there);
//!   3. the D2 ceiling caps the pool's pass sales (price × 64);
//!   4. the treasury policy holds: after funding this pot, the treasury
//!      still has `min` + `reserve_pots` further pots of every OTHER
//!      enabled tier with no live pool — computed over the treasury's
//!      balance EXCLUDING refundable entry payments, which are players'
//!      money in transit, never pot funding.
//!
//! On success EXACTLY `tier.pot` moves from the platform treasury into the
//! new pool's prize vault, before any pass is sold. No partial pots; a pot
//! never scales with entries or balances.
//!
//! The pool id is `Config.next_pool_id`, passed as an argument (Anchor PDA
//! seeds must be derivable from instruction inputs) and checked against the
//! counter so ids stay gapless and monotonic.

use anchor_lang::prelude::*;

use crate::constants::{CAPACITY, FILL_DEADLINE_SECS, LAUNCH_CLASS_COUNTERS, TIMER_SECONDS};
use crate::error::ErrorCode;
use crate::events::PoolOpened;
use crate::instructions::treasury::idle_tier_reserve;
use crate::state::{Config, Pool, PoolState, CONFIG_SEED, PLATFORM_SEED, POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct OpenPool<'info> {
    /// Permissionless — pays the Pool account's rent. The program's own
    /// gates (module doc) decide whether a pool opens, not the signer.
    #[account(mut)]
    pub opener: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = opener,
        space = Pool::SPACE,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: The prize-vault PDA. Created here by the pot transfer from
    /// the treasury — the pot is locked before any pass is sold.
    #[account(
        mut,
        seeds = [VAULT_SEED, &pool_id.to_le_bytes()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: The platform treasury PDA (D-A1 v2), the pot's source.
    #[account(mut, seeds = [PLATFORM_SEED], bump = config.platform_bump)]
    pub platform: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_open_pool(
    ctx: Context<OpenPool>,
    pool_id: u64,
    tier: u8,
    sealing_pubkey: [u8; 32],
    sealing_secret_hash: [u8; 32],
) -> Result<()> {
    // Gapless ids: the argument exists only because PDA seeds need it.
    require!(
        pool_id == ctx.accounts.config.next_pool_id,
        ErrorCode::WrongPoolId
    );

    let tier_idx = tier as usize;
    require!(tier_idx < crate::constants::N_TIERS, ErrorCode::UnknownTier);
    // R6: a tier must be opened by the founder before pools exist in it.
    require!(
        ctx.accounts.config.open_tiers[tier_idx],
        ErrorCode::TierNotOpen
    );
    // D-A1 v2: SEQUENTIAL pools per tier — the slot clears only when the
    // previous pool reaches Paid or Closed.
    require!(
        ctx.accounts.config.active_pool_by_tier[tier_idx] == 0,
        ErrorCode::TierAlreadyHasOpenPool
    );

    let entry_lamports = ctx.accounts.config.tier_price_lamports[tier_idx];
    let pot_lamports = ctx.accounts.config.tier_pot_lamports[tier_idx];
    // D2 (re-scoped by v2): the ceiling caps the pool's PASS SALES.
    let gross = (entry_lamports as u128) * (CAPACITY as u128);
    require!(
        gross <= ctx.accounts.config.vault_ceiling_lamports[tier_idx] as u128,
        ErrorCode::VaultCeilingExceeded
    );

    // The treasury policy (module doc): available = balance minus the
    // refundable entry payments; after funding this pot the remainder must
    // cover the floor plus the idle-tier reserve (this tier excluded — it
    // is live once this open succeeds).
    let balance = ctx.accounts.platform.lamports() as u128;
    let refundable = ctx.accounts.config.platform_refundable as u128;
    let available = balance.saturating_sub(refundable);
    let needed = (pot_lamports as u128)
        + (ctx.accounts.config.treasury_min_platform_lamports as u128)
        + (idle_tier_reserve(&ctx.accounts.config, Some(tier_idx)) as u128);
    require!(available >= needed, ErrorCode::TreasuryShortfall);

    // Fund the pot: treasury → this pool's prize vault, exactly tier.pot,
    // locked before any pass is sold.
    crate::vault::platform_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.platform.to_account_info(),
        &ctx.accounts.vault.to_account_info(),
        ctx.accounts.config.platform_bump,
        pot_lamports,
    )?;

    let config = &mut ctx.accounts.config;
    config.platform_reserved = config
        .platform_reserved
        .checked_add(pot_lamports)
        .ok_or(ErrorCode::Overflow)?;

    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    pool.id = pool_id;
    pool.tier = tier;
    pool.entry_lamports = entry_lamports;
    pool.pot_lamports = pot_lamports;
    pool.entrants = 0;
    pool.opened_at = now;
    pool.fill_deadline = now + FILL_DEADLINE_SECS; // R7: 72h
    pool.state = PoolState::Open;
    pool.sealing_pubkey = sealing_pubkey;
    pool.sealing_secret_hash = sealing_secret_hash;
    pool.vrf_seed = [0u8; 32]; // uncommitted sentinel; `commit_vrf_seed` fills it
    pool.class_counters = LAUNCH_CLASS_COUNTERS;
    pool.secret_revealed = false;
    pool.results_root = [0u8; 32];
    pool.results_committed = false;
    pool.payouts_len = 0;
    pool.payouts = [crate::state::Payout::default(); crate::constants::CAPACITY as usize];
    pool.paid_mask = 0;
    pool.refunded_count = 0;
    // R9: recorded per pool so the value players entered under is on-chain.
    pool.timer_seconds = TIMER_SECONDS;
    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;

    config.next_pool_id = config
        .next_pool_id
        .checked_add(1)
        .ok_or(ErrorCode::Overflow)?;
    config.active_pool_by_tier[tier_idx] = pool_id;

    emit!(PoolOpened {
        pool: pool.key(),
        id: pool_id,
        tier,
        entry_lamports,
        pot_lamports,
        fill_deadline: pool.fill_deadline,
        timer_seconds: pool.timer_seconds,
        sealing_pubkey,
        sealing_secret_hash,
    });

    Ok(())
}
