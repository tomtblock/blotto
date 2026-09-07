//! `pay_prizes` (roadmap 1.5, R10; amended by D3-B, 2026-08-27) — push
//! payout, batched by SEAT over the committed payout list.
//!
//! # The trust structure (unchanged from the winners-array design)
//!
//! `commit_results` commits the whole settled payout list on the Pool —
//! seat-sorted, duplicate-free, amounts summing to exactly the pot, all
//! validated on-chain — and this instruction settles any subset of those
//! seats. The settlement signer chooses only the BATCHING; who is paid and
//! how much was fixed at commit, and the published bundle + verify page make
//! a wrong list detectable (the split-pot amounts are player-recomputable
//! from the published rule). The full-ranking Merkle root is still
//! committed, leaves ordered (rank asc, entry index asc).
//!
//! # Idempotency
//!
//! `Pool.paid_mask` bit `entry_index` records that seat settled. Re-sending
//! a batch reverts on the first already-settled seat; a crashed crank
//! resumes by sending the unset seats. Every committed seat's bit set →
//! state `Paid`.
//!
//! # Escrow at payout
//!
//! A seat's share is escrowed (left in the vault, recorded on the Entry)
//! rather than paid when the entry is flagged (R11), when a sanctions hold
//! stands against it (Phase 2 Stage F), or when the KYC-at-claim switch is
//! on and the share exceeds it (R3, roadmap 4.5).
//!
//! The hold's clause is load-bearing, not decorative. A hold is checked by
//! `release_escrow` and by `pay_next_place`'s eligibility test — both of
//! which only ever see money that is ALREADY in escrow. Without this clause
//! a held seat would be paid straight out of the vault here and the hold
//! would guard an empty escrow: it must divert the share, not merely refuse
//! to let it out afterwards.
//!
//! Note what this does NOT do: it does not refuse the batch. Refusing would
//! revert every seat in it, leave the pool short of `Paid` forever, and so
//! strand the tier's slot and the treasury's reserved pot on one held
//! wallet. Escrowing settles the seat, reaches `Paid`, and leaves exactly
//! one wallet's share unmoved.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{PayoutRecord, PrizesPaid};
use crate::state::{Config, Entry, Pool, PoolState, CONFIG_SEED, POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct PayPrizes<'info> {
    pub settlement_signer: Signer<'info>,

    /// `mut` for the final batch only: reaching `Paid` frees the tier's
    /// active-pool slot (sequential pools, D-A1 revised) and releases the
    /// pot from `platform_reserved`.
    #[account(
        mut,
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

    /// CHECK: Prize-vault PDA, derivation-checked against the stored bump.
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: for each seat in `seats`, IN ORDER:
    //   [that seat's wallet (mut), that seat's Entry account (mut)]
}

pub fn handle_pay_prizes<'info>(
    ctx: Context<'info, PayPrizes<'info>>,
    _pool_id: u64,
    seats: Vec<u16>,
) -> Result<()> {
    require!(
        ctx.accounts.pool.state == PoolState::Scored,
        ErrorCode::ResultsNotCommitted
    );
    require!(!seats.is_empty(), ErrorCode::PayoutAccountsMalformed);
    require!(
        ctx.remaining_accounts.len() == seats.len() * 2,
        ErrorCode::PayoutAccountsMalformed
    );

    let pool_key = ctx.accounts.pool.key();
    let kyc_above = ctx.accounts.config.kyc_required_above_lamports;
    let now = Clock::get()?.unix_timestamp;

    let mut payouts: Vec<PayoutRecord> = Vec::with_capacity(seats.len());

    for (i, &seat) in seats.iter().enumerate() {
        // The committed list is seat-sorted, so a binary search finds the
        // payout (or proves the seat is not in the paid set).
        let len = ctx.accounts.pool.payouts_len as usize;
        let committed = ctx.accounts.pool.payouts[..len]
            .binary_search_by_key(&seat, |p| p.entry_index)
            .map_err(|_| ErrorCode::SeatNotInPayouts)?;
        let amount = ctx.accounts.pool.payouts[committed].amount;

        require!(seat < 64, ErrorCode::InvalidRank);
        let bit: u64 = 1u64 << seat;
        require!(
            ctx.accounts.pool.paid_mask & bit == 0,
            ErrorCode::RankAlreadySettled
        );

        let wallet_info = &ctx.remaining_accounts[i * 2];
        let entry_info = &ctx.remaining_accounts[i * 2 + 1];

        // Owner + discriminator checked by `try_from`; then bound to this
        // pool, this seat, and the wallet that entered it. The Entry account
        // is the on-chain seat→player map (`entry.index` was fixed at
        // register), so the recipient cannot be substituted.
        let mut entry: Account<'info, Entry> = Account::try_from(entry_info)?;
        require!(entry.pool == pool_key, ErrorCode::EntryMismatch);
        require!(entry.index == seat, ErrorCode::EntryMismatch);
        require_keys_eq!(*wallet_info.key, entry.player, ErrorCode::WinnerMismatch);
        require!(!entry.settled, ErrorCode::EntryAlreadySettled);

        // Escrow: detection flag (R11), sanctions hold (Stage F), or the
        // KYC-at-claim switch (R3/4.5). See the module doc on why a held
        // seat is escrowed here rather than refused.
        let escrowed =
            entry.flagged || entry.sanctions_hold || (kyc_above > 0 && amount > kyc_above);
        if escrowed {
            // The lamports stay in the vault; the claim on them is recorded
            // on the Entry and settled later by release/forfeit.
            entry.escrow_lamports = entry
                .escrow_lamports
                .checked_add(amount)
                .ok_or(ErrorCode::Overflow)?;
            // Starts the auto-release clock (prompt v2 §E.3): inaction pays
            // the player `ESCROW_AUTO_RELEASE_SECS` from now.
            entry.escrowed_at = now;
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
        let player = entry.player;
        entry.exit(&crate::ID)?;

        ctx.accounts.pool.paid_mask |= bit;
        payouts.push(PayoutRecord {
            player,
            entry_index: seat,
            amount,
            escrowed,
        });
    }

    // Done when every COMMITTED seat's bit is set.
    let len = ctx.accounts.pool.payouts_len as usize;
    let all_settled = ctx.accounts.pool.payouts[..len]
        .iter()
        .all(|p| ctx.accounts.pool.paid_mask & (1u64 << p.entry_index) != 0);
    if all_settled {
        ctx.accounts.pool.state = PoolState::Paid;
        // The pot is fully settled (paid out or escrowed on Entries): it is
        // no longer locked capacity in the treasury's book-keeping, and the
        // tier may open its next pool (sequential pools, D-A1 revised).
        ctx.accounts.config.platform_reserved = ctx
            .accounts
            .config
            .platform_reserved
            .checked_sub(ctx.accounts.pool.pot_lamports)
            .ok_or(ErrorCode::Overflow)?;
        let tier_idx = ctx.accounts.pool.tier as usize;
        let pool_id = ctx.accounts.pool.id;
        crate::instructions::slot::free_tier_slot(
            &mut ctx.accounts.config,
            tier_idx,
            pool_id,
            now,
        )?;
    }

    emit!(PrizesPaid {
        pool: pool_key,
        payouts,
        paid_mask: ctx.accounts.pool.paid_mask,
    });

    Ok(())
}
