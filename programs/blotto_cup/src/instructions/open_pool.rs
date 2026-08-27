//! `open_pool` (roadmap 1.2) — one new pool per call, settlement-signed.
//!
//! The pool id is `Config.next_pool_id`, passed as an argument (Anchor PDA
//! seeds must be derivable from instruction inputs) and checked against the
//! counter so ids stay gapless and monotonic.
//!
//! The vault and fees PDAs are NOT created here. Both are zero-data,
//! system-owned accounts that spring into existence when the first `register`
//! credits them (0.08 / 0.02 SOL at the smallest tier — comfortably
//! rent-exempt), and are reaped when their last lamport leaves at payout or
//! refund. No prefunding, no stranded rent, and an empty pool that refunds
//! leaves no residue on-chain. Their bumps are derived and stored on `Pool`
//! now so every later instruction validates the same addresses cheaply.

use anchor_lang::prelude::*;

use crate::constants::{
    CAPACITY, FILL_DEADLINE_SECS, LAUNCH_CLASS_COUNTERS, TIER_ENTRY_LAMPORTS, TIMER_SECONDS,
};
use crate::error::ErrorCode;
use crate::events::PoolOpened;
use crate::state::{Config, Pool, PoolState, CONFIG_SEED, FEES_SEED, POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct OpenPool<'info> {
    /// The settlement signer pays the Pool account's rent.
    #[account(mut)]
    pub settlement_signer: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = settlement_signer,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = settlement_signer,
        space = Pool::SPACE,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump,
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: The prize-vault PDA. Uninitialized until the first entry credits
    /// it; only its derivation (and bump) is fixed here.
    #[account(
        seeds = [VAULT_SEED, &pool_id.to_le_bytes()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: The fees PDA — same lazy-creation story as the vault.
    #[account(
        seeds = [FEES_SEED, &pool_id.to_le_bytes()],
        bump,
    )]
    pub fees: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_open_pool(
    ctx: Context<OpenPool>,
    pool_id: u64,
    tier: u8,
    sealing_pubkey: [u8; 32],
    sealing_secret_hash: [u8; 32],
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    // Gapless ids: the argument exists only because PDA seeds need it.
    require!(pool_id == config.next_pool_id, ErrorCode::WrongPoolId);

    let tier_idx = tier as usize;
    require!(tier_idx < TIER_ENTRY_LAMPORTS.len(), ErrorCode::UnknownTier);
    // R6: a tier must be opened by the founder before pools exist in it.
    require!(config.open_tiers[tier_idx], ErrorCode::TierNotOpen);
    // R14: at most one Open pool per tier, program-enforced.
    require!(
        config.active_pool_by_tier[tier_idx] == 0,
        ErrorCode::TierAlreadyHasOpenPool
    );

    let entry_lamports = TIER_ENTRY_LAMPORTS[tier_idx];
    // R6/§7.1: the ceiling caps a pool's GROSS intake (entry × 64).
    let gross = (entry_lamports as u128) * (CAPACITY as u128);
    require!(
        gross <= config.vault_ceiling_lamports as u128,
        ErrorCode::VaultCeilingExceeded
    );

    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    pool.id = pool_id;
    pool.tier = tier;
    pool.entry_lamports = entry_lamports;
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
    pool.winners = [Pubkey::default(); crate::constants::PAID_RANKS];
    pool.paid_mask = 0;
    pool.refunded_count = 0;
    // R9: recorded per pool so the value players entered under is on-chain.
    pool.timer_seconds = TIMER_SECONDS;
    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;
    pool.fees_bump = ctx.bumps.fees;

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
        fill_deadline: pool.fill_deadline,
        timer_seconds: pool.timer_seconds,
        sealing_pubkey,
        sealing_secret_hash,
    });

    Ok(())
}
