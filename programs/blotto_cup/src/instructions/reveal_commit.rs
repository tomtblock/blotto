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

use crate::constants::PAID_RANKS;
use crate::error::ErrorCode;
use crate::events::{PoolSecretRevealed, ResultsCommitted};
use crate::state::{Config, Pool, PoolState, CONFIG_SEED, POOL_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct SettlePool<'info> {
    pub settlement_signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = settlement_signer,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,
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

/// Commit the results root and the 16 winners. `Sealed` + revealed only —
/// results for a refunding pool are meaningless.
pub fn handle_commit_results(
    ctx: Context<SettlePool>,
    _pool_id: u64,
    root: [u8; 32],
    winners: [Pubkey; PAID_RANKS],
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require!(pool.state == PoolState::Sealed, ErrorCode::PoolNotSealed);
    require!(pool.secret_revealed, ErrorCode::SecretNotRevealed);
    require!(!pool.results_committed, ErrorCode::ResultsAlreadyCommitted);

    // Distinct winners: a duplicated pubkey would let one wallet take two
    // ranks' prizes and is never a legitimate ranking (one entry per wallet
    // is a PDA invariant).
    for i in 0..PAID_RANKS {
        for j in (i + 1)..PAID_RANKS {
            require!(winners[i] != winners[j], ErrorCode::WinnersNotDistinct);
        }
    }

    pool.results_root = root;
    pool.winners = winners;
    pool.results_committed = true;
    pool.state = PoolState::Scored;

    emit!(ResultsCommitted {
        pool: pool.key(),
        root,
        winners: winners.to_vec(),
    });

    Ok(())
}
