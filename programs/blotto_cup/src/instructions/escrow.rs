//! `release_escrow` / `forfeit_escrow` (roadmap 1.5) — settling shares that
//! `pay_prizes` held back.
//!
//! Escrowed lamports never left the vault; these two instructions are the
//! vault exits that finish the story. Release pays the player (after review
//! clears the flag concern, and — when the KYC-at-claim switch is on and the
//! share is above it — after a `kyc_tier ≥ 1` entry packet is presented in
//! the same transaction, roadmap 4.5). Forfeit moves the share out of the
//! player's reach after review upholds the flag.
//!
//! # Forfeit destination (PHASE-1-REVIEW)
//!
//! Roadmap 1.5 says forfeited escrow moves "to the next open pool's vault of
//! the same tier, or platform wallet if none." Implemented: **platform wallet
//! always.** Lamports parked in a successor pool's vault would be permanently
//! stranded: that vault's only exits pay amounts derived from its OWN entries
//! (band table × its pot, or its refunds), so nothing could ever move the
//! extra out again — the roadmap's forwarding silently burns the money.
//! Correctness of vault flows outranks fidelity to the flawed prose
//! (tradeoff order #1). If the founder wants forfeitures to boost a later
//! pool's prizes, that needs a designed mechanism (a published bonus pot with
//! augmented, recomputable prize amounts) — raised in the Phase 1 report, not
//! invented here.

use anchor_lang::prelude::*;

use crate::entry_packet::verify_entry_packet;
use crate::error::ErrorCode;
use crate::events::{EscrowForfeited, EscrowReleased};
use crate::state::{Config, Entry, Pool, CONFIG_SEED, POOL_SEED, VAULT_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct ReleaseEscrow<'info> {
    pub settlement_signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = settlement_signer,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: Prize-vault PDA, derivation-checked.
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(mut, constraint = entry.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub entry: Account<'info, Entry>,

    /// CHECK: The escrowed player's wallet, pinned to the Entry.
    #[account(mut, address = entry.player)]
    pub player: UncheckedAccount<'info>,

    /// CHECK: Instructions sysvar — read only when the KYC gate applies.
    #[account(address = crate::entry_packet::INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_release_escrow(ctx: Context<ReleaseEscrow>, _pool_id: u64) -> Result<()> {
    let amount = ctx.accounts.entry.escrow_lamports;
    require!(amount > 0, ErrorCode::NoEscrow);

    // R3 / roadmap 4.5: with the switch on, a share above the threshold needs
    // a KYC-cleared packet (kyc_tier ≥ 1) for THIS wallet and pool, presented
    // as an Ed25519 instruction in this transaction.
    let kyc_above = ctx.accounts.config.kyc_required_above_lamports;
    if kyc_above > 0 && amount > kyc_above {
        let now = Clock::get()?.unix_timestamp;
        verify_entry_packet(
            &ctx.accounts.instructions_sysvar,
            &ctx.accounts.config.entry_signer,
            &ctx.accounts.entry.player,
            &ctx.accounts.pool.key(),
            now,
            1,
        )?;
    }

    crate::vault::vault_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.player.to_account_info(),
        ctx.accounts.pool.id,
        ctx.accounts.pool.vault_bump,
        amount,
    )?;
    ctx.accounts.entry.escrow_lamports = 0;

    emit!(EscrowReleased {
        pool: ctx.accounts.pool.key(),
        player: ctx.accounts.entry.player,
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct ForfeitEscrow<'info> {
    pub settlement_signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = settlement_signer,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: Prize-vault PDA, derivation-checked.
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(mut, constraint = entry.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub entry: Account<'info, Entry>,

    /// CHECK: The platform wallet, pinned to Config (see the module doc on
    /// why the destination is never another pool's vault).
    #[account(mut, address = config.platform_wallet @ ErrorCode::BadForfeitDestination)]
    pub platform_wallet: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_forfeit_escrow(ctx: Context<ForfeitEscrow>, _pool_id: u64) -> Result<()> {
    let amount = ctx.accounts.entry.escrow_lamports;
    require!(amount > 0, ErrorCode::NoEscrow);
    // Forfeiting an UNFLAGGED entry's escrow would let the operator seize a
    // share that is merely waiting on KYC. Only an upheld flag forfeits.
    require!(ctx.accounts.entry.flagged, ErrorCode::ForfeitRequiresFlag);

    crate::vault::vault_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.platform_wallet.to_account_info(),
        ctx.accounts.pool.id,
        ctx.accounts.pool.vault_bump,
        amount,
    )?;
    ctx.accounts.entry.escrow_lamports = 0;

    emit!(EscrowForfeited {
        pool: ctx.accounts.pool.key(),
        player: ctx.accounts.entry.player,
        amount,
        destination: ctx.accounts.platform_wallet.key(),
    });

    Ok(())
}
