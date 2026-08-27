//! The single chokepoint for every lamport movement in this program.
//!
//! **No other file may call `system_program::transfer`.** The standing-rules CI
//! check (`scripts/check-standing-rules.sh`, roadmap §3 rule 6) asserts it, and
//! the vault-invariant suite leans on it: if every debit goes through
//! [`vault_debit`], then auditing the vault's exits means auditing this file's
//! call sites — which the CI check pins to exactly `pay_prizes.rs`, `escrow.rs`
//! and `refund.rs`.
//!
//! The PRIZE-VAULT exit set is `pay_prizes`, `release_escrow`, `refund`
//! (the pot returning to the treasury at `trigger_refund` — same file), and
//! `forfeit_escrow`. There is no admin escape hatch and no
//! recover-stuck-funds path (CLAUDE.md hard rule). D-A1 v2 adds the
//! PLATFORM TREASURY PDA — a separate account, not a fifth vault exit —
//! whose debit call sites are exactly `open_pool.rs` (pot funding),
//! `refund.rs` (returning entry payments) and `treasury.rs`
//! (`withdraw_platform`, Squads-gated and floor-guarded); the standing-rules
//! check pins both sets.
//!
//! Both PDAs here are zero-data, system-owned accounts, so lamports leave them
//! only via a System Program transfer CPI signed with the PDA's seeds —
//! `invoke_signed` through the helpers below. Credits (player → PDA) need no
//! PDA signature and go through [`credit_from_signer`].

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::state::{PLATFORM_SEED, VAULT_SEED};

/// Credit a program PDA (or any account) from a transaction signer.
/// Used by `register` (the full price into the treasury) and
/// `fund_platform_wallet`. A transfer to a fresh PDA address creates it as a
/// system-owned account, which is exactly what the treasury and vault are.
pub fn credit_from_signer<'info>(
    system_program: &Program<'info, System>,
    from: &Signer<'info>,
    to: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            system_program.key(),
            Transfer {
                from: from.to_account_info(),
                to: to.clone(),
            },
        ),
        lamports,
    )
}

/// Debit the prize vault PDA `["vault", pool_id]`.
///
/// THE vault exit. Every call site is enumerated by the standing-rules check;
/// adding one is a change to the program's money model and needs the same
/// scrutiny as a new withdraw instruction — because it is one.
pub fn vault_debit<'info>(
    system_program: &Program<'info, System>,
    vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    pool_id: u64,
    vault_bump: u8,
    lamports: u64,
) -> Result<()> {
    let id_bytes = pool_id.to_le_bytes();
    let seeds: &[&[u8]] = &[VAULT_SEED, &id_bytes, &[vault_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: vault.clone(),
                to: to.clone(),
            },
            &[seeds],
        ),
        lamports,
    )
}

/// Debit the platform treasury PDA `["platform"]` (D-A1 v2).
///
/// Call sites are exactly three, each pinned by the standing-rules check:
/// `open_pool` (funding the new pool's pot — locked before any pass sells),
/// `refund` (returning a player's full entry payment — R7), and
/// `withdraw_platform` (Squads-only, floor-guarded). Adding one is a change
/// to the program's money model and needs the same scrutiny as a new
/// withdraw instruction — because it is one.
pub fn platform_debit<'info>(
    system_program: &Program<'info, System>,
    platform: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    platform_bump: u8,
    lamports: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[PLATFORM_SEED, &[platform_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: platform.clone(),
                to: to.clone(),
            },
            &[seeds],
        ),
        lamports,
    )
}
