//! `place_sanctions_hold` / `lift_sanctions_hold` (Phase 2 Stage F) — the
//! on-chain half of the published sentence "during resolving we check the
//! winning wallet against published sanctions lists, as we are required to".
//!
//! # Why this is not the integrity flag
//!
//! It would have been cheaper to reuse `flag_entry`. It is wrong twice over,
//! and the separation is deliberate at every level — a separate field, a
//! separate instruction, separate events, and no shared code path:
//!
//!   - **`release_escrow`'s permissionless path ignores `flagged`.** Seven
//!     days after settlement anyone at all may release a flagged share to its
//!     player, which is exactly the safeguard players are promised. A
//!     sanctions hold must survive that, so it is checked in BOTH paths.
//!   - **An upheld flag pays the share to other players** (`pay_next_place`).
//!     A sanctions match is not a finding against the competition and must
//!     not enrich anyone; the share stays where it is.
//!
//! A hold also carries no published criterion and no reviewer: it is a
//! membership test against a published list, not a judgement about play.
//!
//! # Where the money goes
//!
//! Nowhere. There is deliberately no instruction here that moves a lamport.
//! A held share sits in its pool's vault, unreachable by the settlement
//! signer, by the seven-day auto-release, by the next-place split and by the
//! operator alike. What ultimately becomes of blocked property is counsel's
//! answer, not this program's, and until it is given the safest place for
//! the money is one no instruction can reach.
//!
//! The one exit is `lift_sanctions_hold`, for a match review establishes was
//! a false positive: it is ADMIN-signed, like `forfeit_escrow`, because
//! taking a hold OFF a wallet that a list matched is a multi-party act.
//! Lifting returns the entry to the ordinary path — the share is released to
//! the player by review or by the seven-day safeguard.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{SanctionsHoldLifted, SanctionsHoldPlaced};
use crate::state::{Config, Entry, Pool, CONFIG_SEED, POOL_SEED};

/// Placing a hold is SETTLEMENT-signed: the crank screens the winner during
/// resolving and places it in the same pass that scores the pool. Nothing
/// about placing a hold moves money, so it does not need the admin — and
/// making it fast matters, because a hold placed late is a payment made.
#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct PlaceSanctionsHold<'info> {
    pub settlement_signer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = settlement_signer)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut, constraint = entry.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub entry: Box<Account<'info, Entry>>,
}

/// Lifting is ADMIN-signed — see the module doc. On mainnet that is a Squads
/// proposal, so a false-positive clearance is recorded and multi-party.
#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct LiftSanctionsHold<'info> {
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut, constraint = entry.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub entry: Box<Account<'info, Entry>>,
}

/// Place a hold. Idempotent in effect but not in call: a second placement is
/// refused so the operator sees a double-placement rather than believing a
/// fresh screening happened.
///
/// Unlike `flag_entry` this is ALLOWED after settlement. That is the whole
/// point: the winner is screened at resolving, when the share may already sit
/// in escrow, and a hold placed then must still stop the seven-day release.
pub fn handle_place_sanctions_hold(ctx: Context<PlaceSanctionsHold>, _pool_id: u64) -> Result<()> {
    let entry = &mut ctx.accounts.entry;
    require!(!entry.sanctions_hold, ErrorCode::SanctionsHoldActive);
    entry.sanctions_hold = true;
    emit!(SanctionsHoldPlaced {
        pool: ctx.accounts.pool.key(),
        player: entry.player,
        placed_at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

/// Lift a hold placed on a match review establishes was a false positive.
/// The entry returns to the ordinary path; nothing is paid here.
pub fn handle_lift_sanctions_hold(ctx: Context<LiftSanctionsHold>, _pool_id: u64) -> Result<()> {
    let entry = &mut ctx.accounts.entry;
    require!(entry.sanctions_hold, ErrorCode::NoSanctionsHold);
    entry.sanctions_hold = false;
    emit!(SanctionsHoldLifted {
        pool: ctx.accounts.pool.key(),
        player: entry.player,
        lifted_at: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
