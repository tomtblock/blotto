//! `trigger_refund` + `refund` (roadmap 1.6, R7, D-A1 revised, threshold
//! moved by D-E4) — reach the minimum field or refund in full.
//!
//! `trigger_refund` is permissionless: any signer may flip a pool that missed
//! its deadline BELOW `MIN_SEATS` into `Refunding`, so a vanished operator
//! cannot strand entries (a pool at or above the minimum seals instead —
//! `seal.rs`; the two are separate instructions with one guard each). It
//! also returns the pool's UNTOUCHED pot from the prize vault to
//! the platform treasury (the pot was pre-funded at `open_pool`; entries
//! never touch a prize vault, so on the refund fork the vault holds exactly
//! the pot and nothing else). `refund` is likewise permissionless per entry
//! and pays the FULL entry price back from the platform treasury — where
//! `register` put 100% of it, tracked in `Config.platform_refundable` so
//! `withdraw_platform`'s floor keeps the sum program-held until every entry
//! is repaid. Refunds cannot depend on the operator keeping a reserve topped
//! up (R7's guarantee is the program's, not a promise).
//!
//! The tier's `active_pool_by_tier` slot clears only when the pool reaches
//! `Closed` (D-A1 revised: pools per tier are SEQUENTIAL — the next pool
//! opens only after this one is fully Paid or Refunded).

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{RefundTriggered, Refunded};
use crate::state::{
    Config, Entry, Pool, PoolState, CONFIG_SEED, PLATFORM_SEED, POOL_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct TriggerRefund<'info> {
    /// Permissionless — anyone may start the refund once the deadline passes.
    pub signer: Signer<'info>,

    /// `mut`: `platform_reserved` releases the pot; on the empty-pool path
    /// the tier's active-pool slot also frees (the pool goes straight to
    /// `Closed`).
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: Prize-vault PDA — holds exactly the untouched pot, returned to
    /// the treasury here (the vault reaps).
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: The platform treasury PDA, receiving the pot back.
    #[account(mut, seeds = [PLATFORM_SEED], bump = config.platform_bump)]
    pub platform: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_trigger_refund(ctx: Context<TriggerRefund>, _pool_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;

    // Only an Open pool refunds: a Sealed pool closed to entries, and every
    // later state descends from Sealed. Past the deadline the field decides
    // the fork (D-E4): below `MIN_SEATS` refunds here, at or above it seals
    // via `seal_at_deadline` — so a 52-seat pool can never be refunded out
    // from under its entrants by anyone racing the seal.
    require!(pool.state == PoolState::Open, ErrorCode::PoolNotOpen);
    require!(now > pool.fill_deadline, ErrorCode::DeadlineNotPassed);
    // The pool's OWN floor, copied at open (R7-b) — the mirror image of
    // `seal_at_deadline`'s guard, read from the same field so the two can
    // never disagree about where the fork is.
    require!(pool.entrants < pool.min_seats, ErrorCode::FieldReached);

    // A pool that never got an entry has nothing to refund — close it now so
    // it does not sit in `Refunding` forever.
    pool.state = if pool.entrants == 0 {
        PoolState::Closed
    } else {
        PoolState::Refunding
    };

    // Return the untouched pot to the treasury (D-A1 revised). Entries never
    // touch a prize vault, so the vault holds the pot and nothing else that
    // is spendable — but it does NOT end empty. Since 2026-09-12 `open_pool`
    // funds it with the pot PLUS one rent cushion (`vault::rent_floor()`,
    // the runtime's rent-exempt minimum for an empty account), and only the
    // pot is returned here. The cushion stays, which is what keeps the vault
    // account alive rather than swept by the runtime mid-refund — the B-03
    // defect. It is the documented never-recovered cost of opening a pool.
    let pot = pool.pot_lamports;
    if pot > 0 {
        crate::vault::vault_debit(
            &ctx.accounts.system_program,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.platform.to_account_info(),
            pool.id,
            pool.vault_bump,
            pot,
        )?;
    }
    ctx.accounts.config.platform_reserved = ctx
        .accounts
        .config
        .platform_reserved
        .checked_sub(pot)
        .ok_or(ErrorCode::Overflow)?;

    // The tier slot frees only when the pool is fully settled (sequential
    // pools, D-A1 revised): here on the straight-to-Closed empty path, else
    // when the last `refund` closes the pool. Freeing stamps the cooldown.
    if pool.state == PoolState::Closed {
        let tier_idx = pool.tier as usize;
        let pool_id = pool.id;
        let mode = pool.mode;
        crate::instructions::slot::free_tier_slot(
            &mut ctx.accounts.config,
            mode,
            tier_idx,
            pool_id,
            now,
        )?;
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

    /// `mut`: each refund shrinks `platform_refundable`; the last one frees
    /// the tier's active-pool slot (the pool closes).
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: The platform treasury PDA — refunds the FULL entry price (100%
    /// of every entry landed here at `register`).
    #[account(mut, seeds = [PLATFORM_SEED], bump = config.platform_bump)]
    pub platform: UncheckedAccount<'info>,

    #[account(mut, constraint = entry.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub entry: Box<Account<'info, Entry>>,

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

    // The full price back from the treasury — retracing the exact credit
    // `register` made (D-A1 revised: entries never touched the prize vault).
    crate::vault::platform_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.platform.to_account_info(),
        &ctx.accounts.player.to_account_info(),
        ctx.accounts.config.platform_bump,
        entry_lamports,
    )?;
    ctx.accounts.config.platform_refundable = ctx
        .accounts
        .config
        .platform_refundable
        .checked_sub(entry_lamports)
        .ok_or(ErrorCode::Overflow)?;

    ctx.accounts.entry.refunded = true;
    let pool = &mut ctx.accounts.pool;
    pool.refunded_count += 1;
    if pool.refunded_count == pool.entrants {
        pool.state = PoolState::Closed;
        // Fully refunded — the tier's slot frees and its cooldown starts
        // (sequential pools; prompt v2 §B.6).
        let now = Clock::get()?.unix_timestamp;
        let tier_idx = pool.tier as usize;
        let pool_id = pool.id;
        let mode = pool.mode;
        crate::instructions::slot::free_tier_slot(
            &mut ctx.accounts.config,
            mode,
            tier_idx,
            pool_id,
            now,
        )?;
    }

    emit!(Refunded {
        pool: pool.key(),
        player: ctx.accounts.entry.player,
        amount: entry_lamports,
    });

    Ok(())
}
