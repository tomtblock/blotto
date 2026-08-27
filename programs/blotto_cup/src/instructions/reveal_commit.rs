//! `reveal_pool_secret` + `commit_results` (roadmap 1.4) — the two
//! settlement-signed steps between seal and payout.
//!
//! Reveal publishes the pool's X25519 secret ON-CHAIN (in the event log), so
//! any player can decrypt every sealed payload and re-run scoring — the
//! verifiability spine (TECH-ARCH §5; tradeoff order #3). The hash committed
//! at `open_pool` makes the reveal checkable: a wrong secret cannot land.
//!
//! Commit stores the Merkle root of the full 64-place ranking AND the 16
//! winners in rank order (R10 as amended — see the Phase 1 report: the
//! roadmap's single-transaction `pay_prizes(payouts[16], proofs)` cannot fit
//! Solana's 1232-byte transaction limit, so the winners commit here, once,
//! and `pay_prizes` batches against them with amounts derived on-chain).

use anchor_lang::prelude::*;
use solana_sha256_hasher::hash as sha256;

use crate::constants::CAPACITY;
use crate::error::ErrorCode;
use crate::events::{PoolSecretRevealed, ResultsCommitted};
use crate::prize_math::pot;
use crate::state::{Config, Payout, Pool, PoolState, CONFIG_SEED, POOL_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct SettlePool<'info> {
    pub settlement_signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = settlement_signer,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,
}

/// Reveal the pool secret. Roadmap 1.4: allowed once the pool is `Sealed`, or
/// past the fill deadline (a `Refunding` pool's entrants can then verify no
/// one — operator included — could have read allocations before the refund).
pub fn handle_reveal_pool_secret(
    ctx: Context<SettlePool>,
    _pool_id: u64,
    secret: [u8; 32],
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require!(!pool.secret_revealed, ErrorCode::SecretAlreadyRevealed);

    let now = Clock::get()?.unix_timestamp;
    let past_deadline = now > pool.fill_deadline;
    require!(
        pool.state != PoolState::Open || past_deadline,
        ErrorCode::PoolNotSealed
    );

    require!(
        sha256(&secret).to_bytes() == pool.sealing_secret_hash,
        ErrorCode::WrongPoolSecret
    );

    pool.secret_revealed = true;

    emit!(PoolSecretRevealed {
        pool: pool.key(),
        secret,
    });

    Ok(())
}

/// Commit the results root and the settled payout list (D3-B). `Sealed` +
/// revealed only — results for a refunding pool are meaningless.
///
/// Four checks make a malformed list unlandable: bounded by capacity,
/// sorted strictly by seat (which also proves no duplicates), every seat in
/// range, and the amounts summing to EXACTLY the pot — the settlement
/// signer chooses the split the published rule dictates, never the total.
/// (Worst case on the wire: 64 payouts × 10 bytes + the root ≈ 700 bytes —
/// one transaction, comfortably.)
pub fn handle_commit_results(
    ctx: Context<SettlePool>,
    _pool_id: u64,
    root: [u8; 32],
    payouts: Vec<Payout>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require!(pool.state == PoolState::Sealed, ErrorCode::PoolNotSealed);
    require!(pool.secret_revealed, ErrorCode::SecretNotRevealed);
    require!(!pool.results_committed, ErrorCode::ResultsAlreadyCommitted);

    require!(
        !payouts.is_empty() && payouts.len() <= CAPACITY as usize,
        ErrorCode::PayoutListMalformed
    );
    let mut total: u128 = 0;
    for (i, p) in payouts.iter().enumerate() {
        require!(
            p.entry_index < pool.entrants,
            ErrorCode::PayoutListMalformed
        );
        if i > 0 {
            // Strictly ascending seats: sorted AND duplicate-free in one check.
            require!(
                p.entry_index > payouts[i - 1].entry_index,
                ErrorCode::PayoutListMalformed
            );
        }
        total += p.amount as u128;
    }
    require!(
        total == pot(pool.entry_lamports) as u128,
        ErrorCode::PayoutSumMismatch
    );

    pool.results_root = root;
    pool.payouts_len = payouts.len() as u16;
    for (i, p) in payouts.iter().enumerate() {
        pool.payouts[i] = *p;
    }
    pool.results_committed = true;
    pool.state = PoolState::Scored;

    emit!(ResultsCommitted {
        pool: pool.key(),
        root,
        payouts,
    });

    Ok(())
}
