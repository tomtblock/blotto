//! `trigger_refund` + `refund` (roadmap 1.6, R7) — full 64 or full refund.
//!
//! `trigger_refund` is permissionless: any signer may flip a pool that missed
//! its 72h deadline into `Refunding`, so a vanished operator cannot strand
//! entries. `refund` is likewise permissionless per entry and pays the FULL
//! entry price: the 80% share back from the vault and the 20% share back from
//! the fees PDA.
//!
//! # Where the 20% comes from (PHASE-1-REVIEW)
//!
//! Roadmap 1.6 sources the 20% from "the platform wallet's pre-funded refund
//! reserve." Implemented instead: the fees PDA holds every entry's 20% until
//! the pool SEALS (see `state.rs::FEES_SEED`), so the full refund is
//! trustless — it cannot depend on the operator keeping a reserve topped up,
//! because the program cannot debit the founder's wallet and an empty
//! reserve would turn R7's guarantee into a promise. Same money, same
//! destination, custody moved from the operator to the program for the only
//! window where refunds are possible. Recorded in the Phase 1 report.

use anchor_lang::prelude::*;

use crate::constants::CAPACITY;
use crate::error::ErrorCode;
use crate::events::{RefundTriggered, Refunded};
use crate::prize_math::{fee_share, vault_share};
use crate::state::{Config, Entry, Pool, PoolState, CONFIG_SEED, FEES_SEED, POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct TriggerRefund<'info> {
    /// Permissionless — anyone may start the refund once the deadline passes.
    pub signer: Signer<'info>,

    /// `mut`: the tier's active-pool slot frees so a new pool can open (R14).
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,
}

pub fn handle_trigger_refund(ctx: Context<TriggerRefund>, _pool_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;

    // Only an Open pool refunds: a Sealed pool filled, and every later state
    // descends from Sealed. (`entrants < 64` is therefore implied — a full
    // pool is never Open — but asserted anyway as defense in depth.)
    require!(pool.state == PoolState::Open, ErrorCode::PoolNotOpen);
    require!(now > pool.fill_deadline, ErrorCode::DeadlineNotPassed);
    require!(pool.entrants < CAPACITY, ErrorCode::PoolFull);

    // A pool that never got an entry has nothing to refund — close it now so
    // it does not sit in `Refunding` forever.
    pool.state = if pool.entrants == 0 {
        PoolState::Closed
    } else {
        PoolState::Refunding
    };

    let tier_idx = pool.tier as usize;
    if ctx.accounts.config.active_pool_by_tier[tier_idx] == pool.id {
        ctx.accounts.config.active_pool_by_tier[tier_idx] = 0;
    }

    emit!(RefundTriggered {
        pool: pool.key(),
        entrants: pool.entrants,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct Refund<'info> {
    /// Permissionless — anyone may land any entrant's refund (the settlement
    /// crank does; a player can self-serve if the crank is gone).
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: Prize-vault PDA — refunds the 80% share.
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: Fees PDA — refunds the 20% share (module doc).
    #[account(mut, seeds = [FEES_SEED, &pool_id.to_le_bytes()], bump = pool.fees_bump)]
    pub fees: UncheckedAccount<'info>,

    #[account(mut, constraint = entry.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub entry: Account<'info, Entry>,

    /// CHECK: The refunded player's wallet, pinned to the Entry.
    #[account(mut, address = entry.player)]
    pub player: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_refund(ctx: Context<Refund>, _pool_id: u64) -> Result<()> {
    require!(
        ctx.accounts.pool.state == PoolState::Refunding,
        ErrorCode::PoolNotRefunding
    );
    require!(!ctx.accounts.entry.refunded, ErrorCode::AlreadyRefunded);

    let entry_lamports = ctx.accounts.pool.entry_lamports;
    let pool_id = ctx.accounts.pool.id;

    // The two halves retrace the exact credits `register` made, so the last
    // refund leaves both PDAs at zero and they reap.
    crate::vault::vault_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.player.to_account_info(),
        pool_id,
        ctx.accounts.pool.vault_bump,
        vault_share(entry_lamports),
    )?;
    crate::vault::fees_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.fees.to_account_info(),
        &ctx.accounts.player.to_account_info(),
        pool_id,
        ctx.accounts.pool.fees_bump,
        fee_share(entry_lamports),
    )?;

    ctx.accounts.entry.refunded = true;
    let pool = &mut ctx.accounts.pool;
    pool.refunded_count += 1;
    if pool.refunded_count == pool.entrants {
        pool.state = PoolState::Closed;
    }

    emit!(Refunded {
        pool: pool.key(),
        player: ctx.accounts.entry.player,
        amount: entry_lamports,
    });

    Ok(())
}
