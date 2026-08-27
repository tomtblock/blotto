//! `flag_entry` / `clear_flag` (roadmap 1.5, R11) — the detection layer's
//! on-chain lever. A flagged entry's prize share is escrowed at `pay_prizes`
//! instead of paid; review then releases or forfeits it (`escrow.rs`).
//!
//! Flags are settlement-signed (the detection pipeline drives the settlement
//! crank) and only meaningful before the entry settles — flagging after the
//! money moved is a no-op the program rejects rather than silently accepts.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::EntryFlagged;
use crate::state::{Config, Entry, Pool, CONFIG_SEED, POOL_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct FlagEntry<'info> {
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

    /// The entry being flagged. Owner + discriminator checked by `Account`;
    /// bound to THIS pool by constraint.
    #[account(mut, constraint = entry.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub entry: Account<'info, Entry>,
}

fn set_flag(ctx: Context<FlagEntry>, flagged: bool) -> Result<()> {
    let entry = &mut ctx.accounts.entry;
    // After settlement the flag has no effect; reject so the operator sees
    // the miss instead of believing the entry was blocked.
    require!(!entry.settled, ErrorCode::EntryAlreadySettled);
    require!(entry.flagged != flagged, ErrorCode::FlagUnchanged);
    entry.flagged = flagged;

    emit!(EntryFlagged {
        pool: entry.pool,
        player: entry.player,
        flagged,
    });
    Ok(())
}

pub fn handle_flag_entry(ctx: Context<FlagEntry>, _pool_id: u64) -> Result<()> {
    set_flag(ctx, true)
}

pub fn handle_clear_flag(ctx: Context<FlagEntry>, _pool_id: u64) -> Result<()> {
    set_flag(ctx, false)
}
