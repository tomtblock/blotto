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
//!   - `pay_next_place` divides a forfeited share EQUALLY among the
//!     eligible players at the rank it passes to (addendum ruling 3,
//!     2026-09-07): the remaining eligible members of the tied first-place
//!     group (the committed payout list IS that group under one paid
//!     place), or — when none of them is eligible — the eligible players at
//!     the next competition rank, each proven against `Pool.results_root`
//!     by a Merkle proof. One member per call, the indivisible remainder to
//!     the lowest entry number; the handler's doc explains what is verified
//!     on-chain (everything, at first place) and what is asserted by the
//!     settlement signer and disclosed (the group's completeness at the
//!     next rank).
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
    require!(
        !ctx.accounts.entry.forfeited,
        ErrorCode::EscrowForfeitedAlready
    );

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
    require!(
        !ctx.accounts.entry.forfeited,
        ErrorCode::EscrowForfeitedAlready
    );

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

    /// The forfeited entry (`forfeited`, `escrow_lamports > 0`). Carries the
    /// split's book-keeping (`split_*`, state.rs).
    #[account(mut, constraint = from.pool == pool.key() @ ErrorCode::EntryMismatch)]
    pub from: Box<Account<'info, Entry>>,

    /// The member being paid this call.
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
    // remaining_accounts: EVERY committed (first-place) seat's Entry except
    // `from` and `to`, in ascending seat order — see `committed_peers`. At
    // first place they classify the group (eligible / forfeited / pending);
    // at the next rank every one of them must be forfeited.
}

/// A flag that review has not yet resolved: the entry is flagged and not
/// forfeited, and either never settled (a next-rank seat, flagged before or
/// after commit) or settled with its share still held. Once the share is
/// released the flag is history — review cleared it (`flags.rs` refuses to
/// clear the bit after settlement, so the escrow is the only record).
fn review_pending(entry: &Entry) -> bool {
    entry.flagged && !entry.forfeited && (!entry.settled || entry.escrow_lamports > 0)
}

/// Eligible to receive a passed-on share: not refunded, not forfeited, no
/// review pending. Applied to `to` and to every committed peer.
fn eligible(entry: &Entry) -> bool {
    !entry.refunded && !entry.forfeited && !review_pending(entry)
}

/// The committed seats other than `from` and `to`, ascending — the exact
/// remaining-accounts list this instruction demands.
fn committed_peers(pool: &Pool, from_index: u16, to_index: u16) -> Vec<u16> {
    let len = pool.payouts_len as usize;
    pool.payouts[..len]
        .iter()
        .map(|p| p.entry_index)
        .filter(|&s| s != from_index && s != to_index)
        .collect()
}

/// `pay_next_place` — one member's portion of a forfeited share.
///
/// # The split (addendum ruling 3, 2026-09-07)
///
/// A forfeited first-place share is divided EQUALLY among the remaining
/// eligible players ranked first; if none is eligible, the whole share
/// passes to the next competition rank and is divided equally among the
/// eligible players there. The indivisible remainder goes to the eligible
/// player with the lowest entry number (the same rule `split_group` applies
/// to a tie). One call pays one member: `portion = split_total / n`, plus
/// the remainder when `takes_remainder`. The forfeiter's Entry fixes `n`
/// (`split_group_size`) and the dividend (`split_total`) at the first
/// payment and records each paid seat (`split_paid_mask`), so the calls are
/// idempotent per member and the n portions sum to the share exactly —
/// batching the way `pay_prizes` batches, not one transaction for all.
///
/// # What is verified where
///
/// At FIRST PLACE the group is on-chain: the committed payout list IS the
/// rank-1 group under one paid place, so every member's Entry is passed and
/// the program computes the eligible set, its size and its lowest seat
/// itself; `group_size` and `takes_remainder` must match or the call fails
/// (`NextPlaceSplitMismatch`). Eligibility of a settled committed seat is
/// FINAL once no review is pending among them (a released share cannot be
/// forfeited, a settled entry cannot be flagged), so `n` cannot drift
/// between calls. A pending review blocks the split rather than being paid
/// past.
///
/// At the NEXT RANK the group is not on-chain. Each claimed member is proven
/// to hold rank `1 + k` by a Merkle proof against `results_root`; what the
/// program cannot prove is that the presented group is COMPLETE — the
/// settlement signer asserts `group_size` (fixed at the first payment and
/// checked against every later one) and which member takes the remainder
/// (exactly once, and before the share runs out). Under-presenting members
/// would inflate the presented members' portions; this is the disclosed
/// residual (addendum ruling 4): the published bundle names the whole
/// group, so any deviation is visible, and the signer cannot route money to
/// itself or the operator (the four-key ban; no treasury path here).
pub fn handle_pay_next_place<'info>(
    ctx: Context<'info, PayNextPlace<'info>>,
    _pool_id: u64,
    rank: u8,
    amount: u64,
    proof: Vec<ProofStep>,
    group_size: u16,
    takes_remainder: bool,
) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let from = &ctx.accounts.from;
    let to = &ctx.accounts.to;
    let pool_key = pool.key();

    // Only a Paid pool pays onward: every committed seat is settled, so each
    // first-place member's standing (paid / held / forfeited) is final
    // enough to divide against, and `pay_prizes` (which refuses a settled
    // Entry) can never be locked out by this instruction marking a seat
    // settled before its own share landed.
    require!(
        pool.state == PoolState::Paid,
        ErrorCode::ResultsNotCommitted
    );
    require!(from.forfeited, ErrorCode::EscrowNotForfeited);
    let remaining = from.escrow_lamports;
    require!(remaining > 0, ErrorCode::NoEscrow);
    // The member must be eligible (a released flag is history — see
    // `review_pending`) and not yet paid from THIS share.
    require!(
        !to.refunded && !to.forfeited,
        ErrorCode::NextPlaceIneligible
    );
    require!(!review_pending(to), ErrorCode::NextPlaceReviewPending);
    require!(to.index < 64, ErrorCode::InvalidRank);
    let to_bit = 1u64 << to.index;
    require!(
        from.split_paid_mask & to_bit == 0,
        ErrorCode::RankAlreadySettled
    );
    require!(group_size >= 1, ErrorCode::NextPlaceSplitMismatch);

    // ---- The rank the member holds, proven against the committed root ----
    // The leaf is verified AS COMMITTED (rank and amount as published — a
    // next-rank leaf carries amount 0); what is PAID is a portion of the
    // forfeited share, never the leaf's amount.
    let leaf = leaf_bytes(&to.player, rank, amount);
    require!(
        verify_proof(&leaf, &proof, &pool.results_root),
        ErrorCode::InvalidMerkleProof
    );

    // ---- Which rank the share passes to -----------------------------------
    let len = pool.payouts_len as usize;
    let committed: &[crate::state::Payout] = &pool.payouts[..len];
    let to_in_committed = committed.iter().any(|p| p.entry_index == to.index);
    let to_is_first = rank == 1;
    if to_is_first {
        require!(to_in_committed, ErrorCode::NextPlaceRankInvalid);
    } else {
        // The next competition rank after a k-way tie for first is 1 + k.
        require!(
            !to_in_committed && (rank as usize) == 1 + len,
            ErrorCode::NextPlaceRankInvalid
        );
    }

    // ---- Every other committed seat, classified ---------------------------
    // Owner + discriminator are checked by `Account::try_from`; only this
    // program creates Entry accounts, and each is bound to this pool and to
    // the expected seat. A pending review anywhere in the group blocks the
    // split: a review is never paid past.
    let peers = committed_peers(pool, from.index, to.index);
    require!(
        ctx.remaining_accounts.len() == peers.len(),
        ErrorCode::NextPlaceIneligible
    );
    // The eligible first-place group, `to` included when it is a member.
    let mut eligible_count: u16 = if to_is_first { 1 } else { 0 };
    let mut lowest_eligible: u16 = if to_is_first { to.index } else { u16::MAX };
    for (seat, info) in peers.iter().zip(ctx.remaining_accounts.iter()) {
        let peer: Account<'info, Entry> = Account::try_from(info)?;
        require!(peer.pool == pool_key, ErrorCode::EntryMismatch);
        require!(peer.index == *seat, ErrorCode::EntryMismatch);
        require!(!review_pending(&peer), ErrorCode::NextPlaceReviewPending);
        if eligible(&peer) {
            eligible_count += 1;
            lowest_eligible = lowest_eligible.min(peer.index);
        } else {
            // Ineligible means FORFEITED (a settled committed seat is never
            // refunded, and pending was excluded above).
            require!(peer.forfeited, ErrorCode::NextPlaceIneligible);
        }
    }

    // ---- The group size and the remainder recipient ------------------------
    if to_is_first {
        // On-chain arithmetic: the arguments must agree with the group.
        require!(
            group_size == eligible_count,
            ErrorCode::NextPlaceSplitMismatch
        );
        require!(
            takes_remainder == (to.index == lowest_eligible),
            ErrorCode::NextPlaceSplitMismatch
        );
    } else {
        // The next rank is reached only when NO first-place member is
        // eligible (every peer forfeited — proven above).
        require!(eligible_count == 0, ErrorCode::NextPlaceIneligible);
    }
    // Fixed by the first payment of this share, checked by every later one.
    if from.split_group_size == 0 {
        // First payment: the dividend is the whole share as it stands.
    } else {
        require!(
            from.split_group_size == group_size,
            ErrorCode::NextPlaceSplitMismatch
        );
    }
    if takes_remainder {
        require!(
            !from.split_remainder_paid,
            ErrorCode::NextPlaceSplitMismatch
        );
    }
    let paid_so_far = from.split_paid_mask.count_ones() as u16;
    require!(paid_so_far < group_size, ErrorCode::NextPlaceSplitMismatch);

    // ---- The portion --------------------------------------------------------
    let total = if from.split_group_size == 0 {
        remaining
    } else {
        from.split_total
    };
    let n = group_size as u64;
    let per = total / n;
    let rem = total % n;
    let portion = if takes_remainder {
        per.checked_add(rem).ok_or(ErrorCode::Overflow)?
    } else {
        per
    };
    require!(portion > 0, ErrorCode::NextPlaceSplitMismatch);
    require!(portion <= remaining, ErrorCode::NextPlaceSplitMismatch);
    // The last member's payment must empty the share exactly: an unpaid
    // remainder would otherwise be stranded in the vault.
    let is_last = paid_so_far + 1 == group_size;
    if is_last {
        require!(portion == remaining, ErrorCode::NextPlaceSplitMismatch);
    }

    // ---- Pay this member's portion ------------------------------------------
    // Paid to the wallet directly, like the auto-release: this path presents
    // a KYC packet to nobody. §13 interaction recorded — inert while the
    // switch is at 0 (D-E5); turning it on must revisit this path too.
    crate::vault::vault_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.to_player.to_account_info(),
        pool.id,
        pool.vault_bump,
        portion,
    )?;
    let from = &mut ctx.accounts.from;
    if from.split_group_size == 0 {
        from.split_group_size = group_size;
        from.split_total = total;
    }
    from.split_paid_mask |= to_bit;
    if takes_remainder {
        from.split_remainder_paid = true;
    }
    from.escrow_lamports = remaining.checked_sub(portion).ok_or(ErrorCode::Overflow)?;
    let to = &mut ctx.accounts.to;
    to.next_place_lamports = to
        .next_place_lamports
        .checked_add(portion)
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
        amount: portion,
        group_size,
    });

    Ok(())
}
