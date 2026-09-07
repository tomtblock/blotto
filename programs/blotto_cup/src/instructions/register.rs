//! `register` (roadmap 1.3) — pay the entry, submit the sealed battles hash;
//! the cosmetic class comes from the bag, the pass is minted frozen, and the
//! 64th entry seals the pool.
//!
//! Order of operations in the handler (each step names its test):
//!
//!   1. gates — paused, state, deadline, capacity, VRF seed present, and the
//!      belt-and-braces check that the prize vault already holds the pot
//!      (D-A1 revised: pots are pre-funded at `open_pool`; an entry NEVER
//!      touches a prize vault);
//!   2. entry packet — Ed25519-verified compliance packet from the
//!      instructions sysvar (`entry_packet.rs`); real verification, not the
//!      1.3 stub: the module was built Phase-1-early because it is on-chain
//!      code, and only the ISSUING service is Phase 4 work;
//!   3. the entry payment — 100% of the price `credit_from_signer` to the
//!      platform treasury PDA, tracked in `Config.platform_refundable` so
//!      `withdraw_platform`'s floor keeps it program-held while the pool can
//!      still refund (R7);
//!   4. class draw — delayed slot hash + committed VRF seed + entry index +
//!      pool + player through `blotto_randomness` (cosmetic; read by nothing
//!      in the scoring path, PID §8.4);
//!   5. pass mint — bare member of the frozen Collection (`pass.rs`);
//!   6. state writes + `EntryRegistered`;
//!   7. the 64th entry seals via `seal_pool` — refunds are now impossible,
//!      so the pool's entry payments leave `platform_refundable` and become
//!      withdrawable revenue. The tier slot is NOT freed here: pools per
//!      tier are SEQUENTIAL (D-A1 revised supersedes R14) and the slot
//!      clears only when the pool reaches `Paid` or `Closed`. `seal_pool` is
//!      shared with `seal_at_deadline` (`seal.rs`), the second seal path
//!      (D-E4 option A, founder ruling 2026-09-07: seal at 64, or at the
//!      deadline with at least `MIN_SEATS`; nothing in between — the
//!      go-timer of §11.3 option B was removed).
//!
//! One entry per wallet per pool is structural: the Entry PDA is keyed
//! `[b"entry", pool, player]`, so a second `register` fails at `init`.
//! Entries per wallet are uncapped ACROSS pools (ratified; the rules page
//! says so). The four service keys — admin, keeper, entry signer,
//! settlement signer — can never enter (prompt v2 §A.4): they are all in
//! Config, so the ban is four comparisons and publicly checkable.
//!
//! The three deserialized accounts are `Box`ed: `Pool` alone is ~750 bytes
//! (the committed winners are 512), and unboxed the generated `try_accounts`
//! frame overruns the 4 KB SBF stack — a hard error surfaced by
//! `cargo build-sbf`, not a style choice.

use anchor_lang::prelude::*;

use blotto_randomness::{derive_class_randomness, weighted_class_draw};

use crate::constants::CAPACITY;
use crate::entry_packet::verify_entry_packet;
use crate::error::ErrorCode;
use crate::events::{EntryRegistered, PoolSealed};
use crate::pass::{mint_pass_cpi, MPL_CORE_ID};
use crate::slot_hashes::{delayed_slot_hash, SLOT_HASHES_SYSVAR_ID};
use crate::state::{
    Config, Entry, Pool, PoolState, CONFIG_SEED, ENTRY_SEED, PASS_COLLECTION_SEED, PLATFORM_SEED,
    POOL_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct Register<'info> {
    /// The entrant. Pays the entry price, the Entry account's rent and the
    /// pass asset's rent.
    #[account(mut)]
    pub player: Signer<'info>,

    /// `mut`: every entry moves its price through `platform_refundable`
    /// (and the 64th entry releases the pool's 64 prices from it at seal).
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: Prize-vault PDA — READ ONLY here (D-A1 revised: entries never
    /// touch a prize vault). Passed so the handler can assert the pre-funded
    /// pot is actually present before taking the player's money.
    #[account(seeds = [VAULT_SEED, &pool_id.to_le_bytes()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: The platform treasury PDA — receives 100% of the entry price.
    /// Derivation-checked against the bump captured at `init_config`.
    #[account(mut, seeds = [PLATFORM_SEED], bump = config.platform_bump)]
    pub platform: UncheckedAccount<'info>,

    #[account(
        init,
        payer = player,
        space = Entry::SPACE,
        seeds = [ENTRY_SEED, pool.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub entry: Box<Account<'info, Entry>>,

    /// CHECK: The pool's pass Collection (created by `create_pass_collection`;
    /// the mint CPI fails if it does not exist yet). Derivation-checked.
    #[account(mut, seeds = [PASS_COLLECTION_SEED, pool.key().as_ref()], bump)]
    pub pass_collection: UncheckedAccount<'info>,

    /// CHECK: The new pass asset — a fresh keypair generated by the client,
    /// initialized by the mpl-core CPI. Must sign (Core requires the asset
    /// account's signature at `CreateV2`).
    #[account(mut)]
    pub pass_asset: Signer<'info>,

    /// CHECK: Metaplex Core, pinned by address.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    /// CHECK: Instructions sysvar — the entry packet's Ed25519 instruction is
    /// read from here, never from caller-supplied data (TECH-ARCH §8).
    #[account(address = crate::entry_packet::INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    /// CHECK: SlotHashes sysvar, read raw (`slot_hashes.rs`), pinned by
    /// address.
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_register(
    ctx: Context<Register>,
    _pool_id: u64,
    battles_hash: [u8; 32],
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // ---- 1. Gates -------------------------------------------------------
    require!(!ctx.accounts.config.paused, ErrorCode::Paused);
    // Prompt v2 §A.4: the operator's own keys never enter. Published as an
    // on-chain fact; the list is exactly Config's four service keys.
    {
        let cfg = &ctx.accounts.config;
        let player = ctx.accounts.player.key();
        require!(
            player != cfg.admin
                && player != cfg.keeper
                && player != cfg.entry_signer
                && player != cfg.settlement_signer,
            ErrorCode::ServiceKeyCannotEnter
        );
    }
    require!(
        ctx.accounts.pool.state == PoolState::Open,
        ErrorCode::PoolNotOpen
    );
    require!(
        now <= ctx.accounts.pool.fill_deadline,
        ErrorCode::DeadlinePassed
    );
    require!(ctx.accounts.pool.entrants < CAPACITY, ErrorCode::PoolFull);
    // The class digest needs the committed seed; entries before the commit
    // would have to draw from nothing.
    require!(
        ctx.accounts.pool.vrf_seed != [0u8; 32],
        ErrorCode::VrfSeedNotCommitted
    );
    // Belt-and-braces (D-A1 revised): the pot was moved into the prize vault
    // at `open_pool`, before any entry. No reachable state violates this —
    // the vault has no exit until settlement — but a player's money must
    // never be taken against a vault that cannot pay, so assert it anyway.
    require!(
        ctx.accounts.vault.lamports() >= ctx.accounts.pool.pot_lamports,
        ErrorCode::TreasuryShortfall
    );

    // ---- 2. Entry packet (compliance gate, TECH-ARCH §8) ----------------
    // KYC tier 0 suffices at entry (R3); the at-claim switch bites at
    // `release_escrow`, not here.
    let packet = verify_entry_packet(
        &ctx.accounts.instructions_sysvar,
        &ctx.accounts.config.entry_signer,
        &ctx.accounts.player.key(),
        &ctx.accounts.pool.key(),
        now,
        0,
    )?;

    // ---- 3. The entry payment (D-A1 revised: 100% to the treasury) ------
    let entry_lamports = ctx.accounts.pool.entry_lamports;
    crate::vault::credit_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.player,
        &ctx.accounts.platform.to_account_info(),
        entry_lamports,
    )?;
    // Track it as refundable until seal: `withdraw_platform`'s floor holds
    // this sum in the treasury so R7's 100% refund is program-held money,
    // not an operator promise.
    ctx.accounts.config.platform_refundable = ctx
        .accounts
        .config
        .platform_refundable
        .checked_add(entry_lamports)
        .ok_or(ErrorCode::Overflow)?;

    // ---- 4. Class draw (cosmetic — PID §3, §8.4) ------------------------
    let index = ctx.accounts.pool.entrants;
    let pool_key = ctx.accounts.pool.key();
    let player_key = ctx.accounts.player.key();
    let slot_hash = delayed_slot_hash(&ctx.accounts.slot_hashes.try_borrow_data()?, clock.slot)?;
    let digest = derive_class_randomness(
        &ctx.accounts.pool.vrf_seed,
        &slot_hash,
        index,
        &pool_key.to_bytes(),
        &player_key.to_bytes(),
    );
    let class_idx = weighted_class_draw(&digest, &ctx.accounts.pool.class_counters);
    // The caller decrements — the crate's contract. Bag sum: 64 at open,
    // exactly 0 at seal.
    ctx.accounts.pool.class_counters[class_idx] -= 1;

    // ---- 5. Pass mint (frozen by Collection inheritance — pass.rs) ------
    let name = format!("BLOTTO PASS #{}-{}", ctx.accounts.pool.id, index);
    mint_pass_cpi(
        &ctx.accounts.mpl_core_program.to_account_info(),
        &ctx.accounts.pass_asset.to_account_info(),
        &ctx.accounts.pass_collection.to_account_info(),
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.player.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.accounts.pool.id,
        ctx.accounts.pool.bump,
        name,
    )?;

    // ---- 6. State writes + event ----------------------------------------
    let entry = &mut ctx.accounts.entry;
    entry.pool = pool_key;
    entry.player = player_key;
    entry.index = index;
    entry.battles_hash = battles_hash;
    entry.class = class_idx as u8;
    entry.pass_asset = ctx.accounts.pass_asset.key();
    entry.entered_at = now;
    entry.slot_hash = slot_hash;
    entry.flagged = false;
    entry.settled = false;
    entry.refunded = false;
    entry.escrow_lamports = 0;
    entry.bump = ctx.bumps.entry;
    entry.escrowed_at = 0;
    entry.forfeited = false;
    entry.next_place_lamports = 0;

    let pool = &mut ctx.accounts.pool;
    pool.entrants += 1;

    emit!(EntryRegistered {
        pool: pool_key,
        player: player_key,
        index,
        battles_hash,
        class: class_idx as u8,
        slot_hash,
        pass_asset: ctx.accounts.pass_asset.key(),
        terms_version: packet.terms_version,
    });

    // ---- 7. The 64th entry seals ----------------------------------------
    // (Option A, founder ruling 2026-09-07: no go-timer — the deadline set
    // at open is never rewritten; `seal_at_deadline` handles 52..63 there.)
    if pool.entrants == CAPACITY {
        debug_assert_eq!(
            pool.class_counters.iter().map(|&c| c as u32).sum::<u32>(),
            0,
            "a full pool must have an empty bag"
        );
        seal_pool(pool, &mut ctx.accounts.config, pool_key)?;
    }

    Ok(())
}

/// Close a pool to entries: `Open → Sealed`, its entry payments leave the
/// refundable floor and become platform revenue, `PoolSealed` carries the
/// field it plays with. Shared by the 64th `register` and `seal_at_deadline`
/// (D-E4) so the two seal paths cannot drift; the accounting uses the REAL
/// field (`entrants`), never `CAPACITY` — at 64 they are equal, below 64
/// only the former is correct (subtracting 64 prices from a 52-seat pool
/// would underflow the floor and leave the pool unable to seal OR refund).
///
/// No lamport moves — the money is already in the treasury PDA. The tier
/// slot does NOT free here: pools per tier are SEQUENTIAL (D-A1 revised
/// supersedes R14's seal-time handover) — the slot clears only when this
/// pool reaches `Paid` or `Closed`.
pub(crate) fn seal_pool(pool: &mut Pool, config: &mut Config, pool_key: Pubkey) -> Result<()> {
    pool.state = PoolState::Sealed;
    let pool_entries_total = pool
        .entry_lamports
        .checked_mul(pool.entrants as u64)
        .ok_or(ErrorCode::Overflow)?;
    config.platform_refundable = config
        .platform_refundable
        .checked_sub(pool_entries_total)
        .ok_or(ErrorCode::Overflow)?;
    emit!(PoolSealed {
        pool: pool_key,
        entrants: pool.entrants,
    });
    Ok(())
}
