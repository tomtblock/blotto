//! `seal_at_deadline` (D-E4, founder decision 2026-09-06; option A per the
//! ruling of 2026-09-07) — the second seal path. The first is the 64th
//! `register`; this one closes a pool that reached the minimum field but
//! not capacity when its deadline passes (`Pool.fill_deadline`, set once at
//! open from `Config.fill_deadline_seconds` — 12 h at launch — and never
//! rewritten).
//!
//! PERMISSIONLESS AND PURE, by design and by test. Under winner-takes-all,
//! field size is the winner's competition: a 52-seat pool and a 64-seat pool
//! pay the same prize against different fields. If the operator could
//! CHOOSE when to seal, the operator would be choosing that, and no amount
//! of good faith fixes how it reads (proposal E1 §11.3). So the seal is a
//! function of on-chain state and the clock and nothing else: any signer,
//! no privileged path, guards that any reader can evaluate. The settlement
//! signer calls it in practice (the daemon's SETTLE sweep); a player can if
//! the daemon is gone.
//!
//! Deliberately separate from `trigger_refund`: one instruction, one job,
//! one guard. Past the deadline the field decides the fork — `entrants <
//! MIN_SEATS` refunds there, `entrants >= MIN_SEATS` seals here — and each
//! instruction rejects the other's case, so neither can be raced.

use anchor_lang::prelude::*;

use crate::constants::{CAPACITY, MIN_SEATS};
use crate::error::ErrorCode;
use crate::instructions::register::seal_pool;
use crate::state::{Config, Pool, PoolState, CONFIG_SEED, POOL_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct SealAtDeadline<'info> {
    /// Permissionless — anyone may close a pool whose deadline has passed at
    /// or above the minimum field. No `has_one`, no role: the guards below
    /// are the whole policy.
    pub signer: Signer<'info>,

    /// `mut`: the pool's entry payments leave `platform_refundable` at seal
    /// (they become revenue — refunds are impossible from here).
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,
}

pub fn handle_seal_at_deadline(ctx: Context<SealAtDeadline>, _pool_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;

    require!(pool.state == PoolState::Open, ErrorCode::PoolNotOpen);
    // Strictly past — the same boundary `trigger_refund` uses and the
    // complement of `register`'s `now <= fill_deadline`: no instant where a
    // pool can both take an entry and be sealed.
    require!(now > pool.fill_deadline, ErrorCode::DeadlineNotPassed);
    require!(pool.entrants >= MIN_SEATS, ErrorCode::FieldBelowMinimum);
    // A full pool sealed itself at the 64th `register`; it is never Open.
    // Defense in depth, like `trigger_refund`'s mirror-image check was.
    require!(pool.entrants < CAPACITY, ErrorCode::PoolFull);

    let pool_key = pool.key();
    seal_pool(pool, &mut ctx.accounts.config, pool_key)
}
