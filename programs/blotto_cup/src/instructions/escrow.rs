//! `release_escrow` / `forfeit_escrow` / `pay_next_place` — settling
//! shares that `pay_prizes` held back. Redesigned 2026-09-07 (prompt v2 §E,
//! founder ruling 4): **forfeited money never reaches the operator.**
//!
//! The vault pays out in this order and no other (the founder's ruling,
//! recorded in the register): (i) first place; (ii) if first place is not
//! eligible, the next eligible highest place; (iii) refund to all players
//! when the minimum field is not met. So:
//!
//!   - `release_escrow` pays a held share to its player. Two paths: the
//!     settlement signer after review clears the concern (with a KYC packet
//!     when the switch applies, R3/4.5); or ANY signer once
//!     `ESCROW_AUTO_RELEASE_SECS` have passed since the share was escrowed —
//!     inaction pays the player.
//!   - `forfeit_escrow` (ADMIN-signed — a hot key may pause a prize, only a
//!     deliberate multi-party act may take one) records that review upheld
//!     the flag. NO LAMPORTS MOVE: the share stays in the vault, marked
//!     `forfeited`, and can only ever leave by next-place payout.
//!   - `pay_next_place` pays a forfeited share to the next eligible
//!     place: a member of the tied first-place group who is not flagged (the
//!     committed payout list IS that group under one paid place), or — when
//!     no tied member is eligible — a player at the next competition rank,
//!     proven against `Pool.results_root` by a Merkle proof. One target per
//!     call, the whole share, so every step is verifiable and small.
//!
//! # What the program verifies, and what it cannot
//!
//! The committed payout list gives the program every first-place seat, so
//! it verifies that a first-place target is the LOWEST-seat eligible tied
//! member (every lower tied seat is passed as an Entry account and shown to
//! be the forfeiter, flagged or forfeited), and that a next-rank target is
//! reached only when EVERY tied member is ineligible. Within the next-rank
//! group the program cannot verify "lowest seat" — those seats are not
//! on-chain — so the settlement signer picks a member of that rank, proven
//! by the Merkle proof to hold exactly that rank; the published rule is the
//! lowest eligible seat, the bundle makes any deviation visible, and the
//! signer cannot route the money to itself or the operator (the four-key
//! ban in `register`, and no treasury destination exists here).
//!
//! # Forfeit destination (history)
//!
//! Roadmap 1.5 forwarded forfeits to the next pool's vault; Phase 1 sent
//! them to the platform treasury because a successor vault would strand
//! them. Both are superseded: the money now stays in ITS OWN pool's vault
//! and pays the next place of the same competition — nothing is stranded
//! (the next-place payout exit is always reachable while a forfeited share exists)
//! and nothing is the operator's.

use anchor_lang::prelude::*;

use crate::constants::ESCROW_AUTO_RELEASE_SECS;
use crate::entry_packet::verify_entry_packet;
use crate::error::ErrorCode;
use crate::events::{EscrowForfeited, EscrowReleased, NextPlacePaid};
use crate::merkle::{leaf_bytes, verify_proof, ProofStep};
use crate::state::{Config, Entry, Pool, PoolState, CONFIG_SEED, POOL_SEED, VAULT_SEED};

// ---------------------------------------------------------------------------
// release_escrow
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct ReleaseEscrow<'info> {
    /// The settlement signer (the reviewed path) — or, once the auto-release
    /// window has passed, anyone at all. Which path applies is decided in
    /// the handler by comparing against `Config.settlement_signer`.
    pub signer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: Prize-vault PDA, derivation-checked.
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(mut, constraint = entry.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub entry: Box<Account<'info, Entry>>,

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
    // An upheld flag closes this door for good: the share can only be
    // paid onward (ruling 4 — never back to the flagged player, never to us).
    require!(!ctx.accounts.entry.forfeited, ErrorCode::EscrowForfeitedAlready);

    let now = Clock::get()?.unix_timestamp;
    let reviewed_path = ctx.accounts.signer.key() == ctx.accounts.config.settlement_signer;
    if reviewed_path {
        // R3 / roadmap 4.5: with the switch on, a share above the threshold
        // needs a KYC-cleared packet (kyc_tier ≥ 1) for THIS wallet and pool,
        // presented as an Ed25519 instruction in this transaction.
        let kyc_above = ctx.accounts.config.kyc_required_above_lamports;
        if kyc_above > 0 && amount > kyc_above {
            verify_entry_packet(
                &ctx.accounts.instructions_sysvar,
                &ctx.accounts.config.entry_signer,
                &ctx.accounts.entry.player,
                &ctx.accounts.pool.key(),
                now,
                1,
            )?;
        }
    } else {
        // Prompt v2 §E.3: the auto-release. Anyone may land it once the
        // window has passed; the player is paid by the passage of time, not
        // by anyone's decision. §13 interaction, recorded: this path presents
        // a KYC packet to nobody. With the switch at 0 (D-E5) that is inert; turning
        // the switch on must revisit this path first.
        let due = ctx
            .accounts
            .entry
            .escrowed_at
            .checked_add(ESCROW_AUTO_RELEASE_SECS)
            .ok_or(ErrorCode::Overflow)?;
        require!(
            ctx.accounts.entry.escrowed_at > 0 && now >= due,
            ErrorCode::AutoReleaseNotDue
        );
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

// ---------------------------------------------------------------------------
// forfeit_escrow — admin-signed, moves nothing
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct ForfeitEscrow<'info> {
    /// The admin (Squads vault) — `has_one` on Config enforces it. Prompt v2
    /// §E.2: taking a prize away is a deliberate multi-party act.
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: Prize-vault PDA, derivation-checked. Listed (read-only) so
    /// the event can name where the share remains; no lamport moves here.
    #[account(seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(mut, constraint = entry.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub entry: Box<Account<'info, Entry>>,
}

pub fn handle_forfeit_escrow(ctx: Context<ForfeitEscrow>, _pool_id: u64) -> Result<()> {
    let amount = ctx.accounts.entry.escrow_lamports;
    require!(amount > 0, ErrorCode::NoEscrow);
    // Forfeiting an UNFLAGGED entry's escrow would let the operator seize a
    // share that is merely waiting on KYC. Only an upheld flag forfeits.
    require!(ctx.accounts.entry.flagged, ErrorCode::ForfeitRequiresFlag);
    require!(!ctx.accounts.entry.forfeited, ErrorCode::EscrowForfeitedAlready);

    // The share stays in the vault, on this Entry, until paid onward. This is
    // the whole effect: a flag becomes a forfeit; no lamport moves.
    ctx.accounts.entry.forfeited = true;

    emit!(EscrowForfeited {
        pool: ctx.accounts.pool.key(),
        player: ctx.accounts.entry.player,
        amount,
        // Where the money is: still the pool's own vault, awaiting next-place payout.
        destination: ctx.accounts.vault.key(),
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// pay_next_place
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct PayNextPlace<'info> {
    pub settlement_signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = settlement_signer,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: Prize-vault PDA, derivation-checked — the forfeited share's
    /// source.
    #[account(mut, seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    /// The forfeited entry (`forfeited`, `escrow_lamports > 0`).
    #[account(mut, constraint = from.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub from: Box<Account<'info, Entry>>,

    /// The entry being paid — the next eligible place.
    #[account(
        mut,
        constraint = to.pool == pool.key() @ ErrorCode::EntryMismatch,
        constraint = to.key() != from.key() @ ErrorCode::NextPlaceIneligible,
    )]
    pub to: Box<Account<'info, Entry>>,

    /// CHECK: The paid player's wallet, pinned to the Entry.
    #[account(mut, address = to.player)]
    pub to_player: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: the Entry accounts that PROVE `to` is the next
    // eligible place — see `ineligibility_witnesses` for exactly which seats,
    // in ascending seat order.
}

/// A flag that review has not yet resolved: the entry is flagged and not
/// forfeited, and either never settled (a next-rank seat, flagged before or
/// after commit) or settled with its share still held. Once the share is
/// released the flag is history — review cleared it (`flags.rs` refuses to
/// clear the bit after settlement, so the escrow is the only record).
fn review_pending(entry: &Entry) -> bool {
    entry.flagged && !entry.forfeited && (!entry.settled || entry.escrow_lamports > 0)
}

/// Which committed (first-place) seats must be shown ineligible for `to`
/// to be the next eligible place: every committed seat below `to`'s own
/// when `to` is itself a tied first-place member; every committed seat when
/// `to` sits at the next rank. The forfeiter is excluded (it is known
/// ineligible — it is the `from` account).
fn ineligibility_witnesses(pool: &Pool, from_index: u16, to_index: u16, to_is_first: bool) -> Vec<u16> {
    let len = pool.payouts_len as usize;
    pool.payouts[..len]
        .iter()
        .map(|p| p.entry_index)
        .filter(|&s| s != from_index)
        .filter(|&s| !to_is_first || s < to_index)
        .collect()
}

pub fn handle_pay_next_place<'info>(
    ctx: Context<'info, PayNextPlace<'info>>,
    _pool_id: u64,
    rank: u8,
    amount: u64,
    proof: Vec<ProofStep>,
) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let from = &ctx.accounts.from;
    let to = &ctx.accounts.to;
    let pool_key = pool.key();

    // Only a Paid pool pays onward: every committed seat is settled, so each
    // first-place member's standing (paid / held / forfeited) is final
    // enough to rank against, and `pay_prizes` (which refuses a settled
    // Entry) can never be locked out by this instruction marking a seat settled
    // before its own share landed.
    require!(pool.state == PoolState::Paid, ErrorCode::ResultsNotCommitted);
    require!(from.forfeited, ErrorCode::EscrowNotForfeited);
    let share = from.escrow_lamports;
    require!(share > 0, ErrorCode::NoEscrow);
    // The target must be eligible: not refunded, not forfeited, and not
    // under a live review. A flag is a live concern while the entry is
    // unsettled, or settled with its share still held; a flagged entry whose
    // share was RELEASED was cleared by review (the flag bit cannot be
    // cleared after settlement — `flags.rs`) and is eligible again.
    require!(
        !to.refunded && !to.forfeited,
        ErrorCode::NextPlaceIneligible
    );
    require!(!review_pending(to), ErrorCode::NextPlaceReviewPending);

    // ---- The rank the target holds, proven against the committed root ----
    // The leaf is verified AS COMMITTED (rank and amount as published — under
    // one paid place a next-rank leaf carries amount 0); what is PAID is the
    // forfeited share, never the leaf's amount.
    let leaf = leaf_bytes(&to.player, rank, amount);
    require!(
        verify_proof(&leaf, &proof, &pool.results_root),
        ErrorCode::InvalidMerkleProof
    );

    // ---- Next eligible place (ruling 4 (ii)) ------------------------------
    let len = pool.payouts_len as usize;
    let committed: &[crate::state::Payout] = &pool.payouts[..len];
    let to_in_committed = committed.iter().any(|p| p.entry_index == to.index);
    let to_is_first = rank == 1;
    if to_is_first {
        // A tied first-place member: must be in the committed list.
        require!(to_in_committed, ErrorCode::NextPlaceRankInvalid);
    } else {
        // The next competition rank after a k-way tie for first is 1 + k,
        // and the committed list is exactly that group under one paid place.
        require!(
            !to_in_committed && (rank as usize) == 1 + len,
            ErrorCode::NextPlaceRankInvalid
        );
    }

    // Every committed seat that would outrank the target must be proven
    // ineligible: the forfeiter itself (known), or an Entry passed as a
    // remaining account that is flagged or forfeited. Owner + discriminator
    // are checked by `Account::try_from`; only this program creates Entry
    // accounts, and each is bound to this pool and to the expected seat.
    let witnesses = ineligibility_witnesses(pool, from.index, to.index, to_is_first);
    require!(
        ctx.remaining_accounts.len() == witnesses.len(),
        ErrorCode::NextPlaceIneligible
    );
    for (seat, info) in witnesses.iter().zip(ctx.remaining_accounts.iter()) {
        let witness: Account<'info, Entry> = Account::try_from(info)?;
        require!(witness.pool == pool_key, ErrorCode::EntryMismatch);
        require!(witness.index == *seat, ErrorCode::EntryMismatch);
        // Ineligible means FORFEITED — review upheld the flag. A seat whose
        // review is still open is neither eligible nor ineligible: the
        // payout waits (a review must never be skipped by paying past
        // it), and a released seat is eligible and would have to be
        // the target itself.
        require!(!review_pending(&witness), ErrorCode::NextPlaceReviewPending);
        require!(witness.forfeited, ErrorCode::NextPlaceIneligible);
    }

    // ---- Pay the whole forfeited share to the next eligible player -------
    // Paid to the wallet directly, like the auto-release: this path presents
    // a KYC packet to nobody. §13 interaction recorded — inert while the
    // switch is at 0 (D-E5); turning it on must revisit this path too.
    crate::vault::vault_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.to_player.to_account_info(),
        pool.id,
        pool.vault_bump,
        share,
    )?;
    let from = &mut ctx.accounts.from;
    from.escrow_lamports = 0;
    let to = &mut ctx.accounts.to;
    to.next_place_lamports = to
        .next_place_lamports
        .checked_add(share)
        .ok_or(ErrorCode::Overflow)?;
    // A seat paid this way outside the committed list has no `paid_mask` bit;
    // `settled` is its record (and closes the flag window, as for any paid
    // seat).
    to.settled = true;

    emit!(NextPlacePaid {
        pool: pool_key,
        from: from.player,
        to: to.player,
        rank,
        amount: share,
    });

    Ok(())
}
