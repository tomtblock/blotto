//! `seal_at_deadline` (D-E4, founder decision 2026-09-06; option A per the
//! ruling of 2026-09-07) — the second seal path. The first is the
//! `register` that fills the pool to its capacity; this one closes a pool that reached the minimum field but
//! not capacity when its deadline passes (`Pool.fill_deadline`, set once at
//! open from `Config.fill_deadline_seconds` — 12 h at launch — and never
//! rewritten).
//!
//! PERMISSIONLESS AND PURE, by design and by test. Field size is every
//! paid player's competition: a pool at its minimum field and a full pool
//! pay the same fixed table (D-E19) against different fields. If the operator could
//! CHOOSE when to seal, the operator would be choosing that, and no amount
//! of good faith fixes how it reads (proposal E1 §11.3). So the seal is a
//! function of on-chain state and the clock and nothing else: any signer,
//! no privileged path, guards that any reader can evaluate. The settlement
//! signer calls it in practice (the daemon's SETTLE sweep); a player can if
//! the daemon is gone.
//!
//! Deliberately separate from `trigger_refund`: one instruction, one job,
//! one guard. Past the deadline the field decides the fork — `entrants <
//! min_seats` refunds there, `entrants >= min_seats` seals here (the pool's
//! own floor) — and each
//! instruction rejects the other's case, so neither can be raced.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::SealReason;
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
    // The pool's OWN floor, copied at open (R7-b) — never the constant, so
    // an upgrade that moves `MIN_SEATS` cannot reach a pool already taking
    // entries.
    require!(
        pool.entrants >= pool.min_seats,
        ErrorCode::FieldBelowMinimum
    );
    // A full pool sealed itself at the `register` that filled it; it is
    // never Open. Defense in depth, against the pool's OWN capacity.
    require!(pool.entrants < pool.capacity, ErrorCode::PoolFull);

    let pool_key = pool.key();
    seal_pool(
        pool,
        &mut ctx.accounts.config,
        pool_key,
        SealReason::DeadlineMinFill,
    )
}
