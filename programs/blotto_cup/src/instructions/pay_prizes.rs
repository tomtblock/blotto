//! `pay_prizes` (roadmap 1.5, R10) — push payout, batched by rank.
//!
//! # Why batched, and why no Merkle proofs here (PHASE-1-REVIEW)
//!
//! The roadmap writes `pay_prizes(pool, payouts: Vec<(Pubkey, u64)>, proofs)`
//! as one transaction. Sixteen `(pubkey, amount)` pairs plus sixteen Merkle
//! proofs (~6 × 32 bytes each at depth 6) plus 32+ account metas does not fit
//! Solana's 1232-byte packet. So the trust structure is rearranged, not
//! weakened: `commit_results` commits the 16 winners in rank order ON the
//! Pool (one write, fits easily), amounts are derived on-chain from the band
//! table, and this instruction pays any subset of ranks against that
//! commitment. The settlement signer chooses only the BATCHING; who gets paid
//! and how much was fixed at commit and is player-recomputable (band table ×
//! published pot). The full-ranking Merkle root is still committed for the
//! verify page. Recorded in `docs/phase-reports/phase-1-program.md`.
//!
//! # Idempotency
//!
//! `Pool.paid_mask` bit `r-1` records rank `r` settled. Re-sending a batch
//! reverts on the first already-settled rank; a crashed crank resumes by
//! sending the unset ranks. All 16 bits set → state `Paid`.
//!
//! # Escrow at payout
//!
//! A rank's share is escrowed (left in the vault, recorded on the Entry)
//! rather than paid when the entry is flagged (R11) or when the KYC-at-claim
//! switch is on and the share exceeds it (R3, roadmap 4.5).

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{PayoutRecord, PrizesPaid};
use crate::prize_math::{band_amount, pot};
use crate::state::{Config, Entry, Pool, PoolState, CONFIG_SEED, POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct PayPrizes<'info> {
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

    /// CHECK: Prize-vault PDA, derivation-checked against the stored bump.
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: for each rank in `ranks`, IN ORDER:
    //   [winner wallet (mut), winner's Entry account (mut)]
}

pub fn handle_pay_prizes<'info>(
    ctx: Context<'info, PayPrizes<'info>>,
    _pool_id: u64,
    ranks: Vec<u8>,
) -> Result<()> {
    require!(
        ctx.accounts.pool.state == PoolState::Scored,
        ErrorCode::ResultsNotCommitted
    );
    require!(!ranks.is_empty(), ErrorCode::PayoutAccountsMalformed);
    require!(
        ctx.remaining_accounts.len() == ranks.len() * 2,
        ErrorCode::PayoutAccountsMalformed
    );

    let pool_key = ctx.accounts.pool.key();
    let pot_lamports = pot(ctx.accounts.pool.entry_lamports);
    let kyc_above = ctx.accounts.config.kyc_required_above_lamports;

    let mut payouts: Vec<PayoutRecord> = Vec::with_capacity(ranks.len());

    for (i, &rank) in ranks.iter().enumerate() {
        require!((1..=16).contains(&rank), ErrorCode::InvalidRank);
        let bit: u16 = 1 << (rank - 1);
        require!(
            ctx.accounts.pool.paid_mask & bit == 0,
            ErrorCode::RankAlreadySettled
        );

        let winner = ctx.accounts.pool.winners[(rank - 1) as usize];
        let wallet_info = &ctx.remaining_accounts[i * 2];
        let entry_info = &ctx.remaining_accounts[i * 2 + 1];
        require_keys_eq!(*wallet_info.key, winner, ErrorCode::WinnerMismatch);

        // Owner + discriminator checked by `try_from`; then bound to this
        // pool and this winner.
        let mut entry: Account<'info, Entry> = Account::try_from(entry_info)?;
        require!(entry.pool == pool_key, ErrorCode::EntryMismatch);
        require!(entry.player == winner, ErrorCode::EntryMismatch);
        require!(!entry.settled, ErrorCode::EntryAlreadySettled);

        let amount = band_amount(pot_lamports, rank);

        // Escrow: detection flag (R11) or KYC-at-claim switch (R3/4.5).
        let escrowed = entry.flagged || (kyc_above > 0 && amount > kyc_above);
        if escrowed {
            // The lamports stay in the vault; the claim on them is recorded
            // on the Entry and settled later by release/forfeit.
            entry.escrow_lamports = entry
                .escrow_lamports
                .checked_add(amount)
                .ok_or(ErrorCode::Overflow)?;
        } else {
            crate::vault::vault_debit(
                &ctx.accounts.system_program,
                &ctx.accounts.vault.to_account_info(),
                wallet_info,
                ctx.accounts.pool.id,
                ctx.accounts.pool.vault_bump,
                amount,
            )?;
        }

        entry.settled = true;
        // Remaining-accounts Entries are not auto-persisted — write back.
        entry.exit(&crate::ID)?;

        ctx.accounts.pool.paid_mask |= bit;
        payouts.push(PayoutRecord {
            player: winner,
            rank,
            amount,
            escrowed,
        });
    }

    if ctx.accounts.pool.paid_mask == 0xFFFF {
        ctx.accounts.pool.state = PoolState::Paid;
    }

    emit!(PrizesPaid {
        pool: pool_key,
        payouts,
        paid_mask: ctx.accounts.pool.paid_mask,
    });

    Ok(())
}
