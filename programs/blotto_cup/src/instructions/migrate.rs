//! `migrate_config` — the one-shot account migration for the 2026-09-07
//! upgrade (prompt v2 §G "Config layout warning", founder rulings).
//!
//! Config gains `keeper`, `fill_deadline_seconds`, `cooldown_seconds` and
//! `tier_next_open_at` — 104 bytes appended AFTER `bump` (`state.rs`). The
//! live account was allocated at the old 380 bytes, and Anchor's
//! `Account<Config>` refuses to deserialise a short account, so between the
//! program upgrade and this transaction EVERY instruction that touches
//! Config fails — including `set_paused(false)`. The runbook therefore runs
//! this immediately after `deploy-devnet.sh`, before anything else.
//!
//! Why by hand: the account cannot be an `Account<Config>` here (it is the
//! old layout), so it arrives as an `UncheckedAccount` whose address is
//! PDA-checked by Anchor (`seeds` + `bump`), and whose owner, discriminator,
//! size and admin field are checked below before anything is written. The
//! old bytes are never touched; the tail is written at the exact offsets the
//! `config_len_matches_serialized_size` test pins.
//!
//! Self-disabling: an account already at the new size is refused
//! (`ConfigAlreadyMigrated`), so a repeated transaction is a clean no-op
//! failure, never a second write. A fresh deployment never calls this —
//! `init_config` writes the whole new layout.
//!
//! # Why this is here at all, when nothing reaches it
//!
//! It is UNREACHABLE ON A FRESH DEPLOYMENT, by construction: `init_config`
//! allocates `Config::SPACE`, and the length check above refuses anything
//! that size. Every test fixture and every local validator therefore starts
//! past it, and reachability analysis reads it as dead code (audit
//! 2026-09-11, A-15 — recorded KEEP). It is not dead: the DEPLOYED devnet
//! Config was allocated at `Config::SPACE_V1` and this is the only
//! instruction that can grow it. Deleting it would strand that account —
//! every instruction touching Config would keep failing to deserialise, with
//! no path back, and `set_paused(false)` among them.
//!
//! RETIREMENT CONDITION, so this does not sit here forever: once every
//! deployment's Config account is at `Config::SPACE` (the devnet one after
//! the runbook's post-upgrade transaction; mainnet is initialised at the new
//! layout and never needs it), this instruction and `ConfigNotMigratable` /
//! `ConfigAlreadyMigrated` can go together. Removing the error variants
//! renumbers every later code — see the header of `error.rs`.

use anchor_lang::prelude::*;
use anchor_lang::Discriminator;

use crate::constants::{DEFAULT_COOLDOWN_SECS, DEFAULT_FILL_DEADLINE_SECS, N_TIERS};
use crate::error::ErrorCode;
use crate::events::ConfigMigrated;
use crate::state::{Config, CONFIG_SEED};

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    /// Must equal the `admin` field stored in the OLD Config bytes (checked
    /// in the handler — `has_one` needs a deserialised account). Pays the
    /// rent top-up for the larger account.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: The Config PDA at its pre-migration size. Address enforced by
    /// the seeds; owner, discriminator, size and admin enforced by hand in
    /// the handler because the account cannot be deserialised as `Config`
    /// until it has grown.
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_migrate_config(ctx: Context<MigrateConfig>, keeper: Pubkey) -> Result<()> {
    // The zero key is refused here too (audit A7): this instruction runs
    // once, against a live deployment, and writes the keeper into raw bytes
    // — a typo would leave every tier unopenable with no self-heal behind it.
    require!(keeper != Pubkey::default(), ErrorCode::KeeperMustNotBeZero);
    let config_info = ctx.accounts.config.to_account_info();

    // ---- 1. Prove this is the old Config and the caller is its admin -----
    require_keys_eq!(
        *config_info.owner,
        crate::ID,
        ErrorCode::ConfigNotMigratable
    );
    {
        let data = config_info.try_borrow_data()?;
        if data.len() >= Config::SPACE {
            return Err(ErrorCode::ConfigAlreadyMigrated.into());
        }
        require!(
            data.len() == Config::SPACE_V1,
            ErrorCode::ConfigNotMigratable
        );
        require!(
            data[..8] == *Config::DISCRIMINATOR,
            ErrorCode::ConfigNotMigratable
        );
        // `admin` is the first field after the discriminator (state.rs).
        let stored_admin =
            Pubkey::try_from(&data[8..40]).map_err(|_| ErrorCode::ConfigNotMigratable)?;
        require_keys_eq!(
            stored_admin,
            ctx.accounts.admin.key(),
            ErrorCode::ConfigNotMigratable
        );
    }

    // ---- 2. Rent for the larger account, paid by the admin ---------------
    // Through the vault chokepoint like every other credit (standing rule 6:
    // the System Program transfer CPI lives in `vault.rs` and nowhere else).
    let required = Rent::get()?.minimum_balance(Config::SPACE);
    let held = config_info.lamports();
    if held < required {
        crate::vault::credit_from_signer(
            &ctx.accounts.system_program,
            &ctx.accounts.admin,
            &config_info,
            required - held,
        )?;
    }

    // ---- 3. Grow, then write the tail at the pinned offsets --------------
    // PHASE-E1-REVIEW: Solana 3.x names the in-place grow `resize`
    // (`realloc` is the deprecated spelling); the new bytes are zeroed.
    config_info.resize(Config::SPACE)?;
    // Every tier's cooldown stamp starts at the migration, not at the epoch:
    // `open_pool` requires `now >= tier_next_open_at`, and a zero would let
    // the keeper open every tier the instant the upgrade landed rather than
    // after its cooldown. (Before 2026-09-07 this field was also the origin
    // of a liveness fallback, and a zero there was the far worse bug — see
    // `open_pool.rs` for why that fallback no longer exists.)
    let now = Clock::get()?.unix_timestamp;
    {
        let mut data = config_info.try_borrow_mut_data()?;
        let mut off = Config::SPACE_V1;
        data[off..off + 32].copy_from_slice(keeper.as_ref());
        off += 32;
        data[off..off + 8].copy_from_slice(&DEFAULT_FILL_DEADLINE_SECS.to_le_bytes());
        off += 8;
        data[off..off + 8].copy_from_slice(&DEFAULT_COOLDOWN_SECS.to_le_bytes());
        off += 8;
        for _ in 0..N_TIERS {
            data[off..off + 8].copy_from_slice(&now.to_le_bytes());
            off += 8;
        }
        debug_assert_eq!(off, Config::SPACE);
    }

    emit!(ConfigMigrated {
        keeper,
        fill_deadline_seconds: DEFAULT_FILL_DEADLINE_SECS,
        cooldown_seconds: DEFAULT_COOLDOWN_SECS,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// `migrate_pool` — the R7-b account migration (founder instruction
// 2026-09-12).
// ---------------------------------------------------------------------------
//
// `Pool` gains `min_seats: u16`, two bytes appended AFTER `vault_bump`
// (`state.rs`). Nine pools on devnet were allocated at the old 847 bytes, and
// Anchor's `Account<Pool>` refuses a short account, so between the program
// upgrade and this transaction every instruction touching one of them fails —
// including `pay_next_place` and `release_escrow`, which run on pools that
// are already `Paid`.
//
// Same shape as `migrate_config` above, and the same reasons for each part:
// the account arrives as an `UncheckedAccount` whose address is PDA-checked
// by Anchor, because it cannot be deserialised as `Pool` until it has grown;
// its owner, discriminator and size are checked by hand; the old bytes are
// never touched; and an account already at the new size is refused, so a
// repeated transaction is a clean no-op failure rather than a second write.
//
// WHAT IT WRITES, and why it is not `MIN_SEATS`: every migrated pool gets
// `MIN_SEATS_V1` (52), the floor its players actually entered under. Writing
// the new 40 would move the rule beneath people already seated, which is the
// exact thing the field was added to prevent — a migration that defeated its
// own field would be worse than no field at all.
//
// PERMISSIONLESS, unlike `migrate_config`. It writes one known constant into
// one PDA-checked account and refuses every account that is not an
// un-migrated pool, so there is nothing for an admin signature to protect;
// and there are nine of these to run against live pools some of which hold
// money, so a path that does not depend on the multisig being available is
// the safer one. The admin pays nothing either — rent comes from whoever
// sends it.
//
// RETIREMENT CONDITION: once every deployment's pools are at `Pool::SPACE`,
// this instruction, `MIN_SEATS_V1`, `Pool::LEN_V1` and the two error variants
// can go together. Removing the error variants renumbers every later code —
// see the header of `error.rs`.

use crate::constants::MIN_SEATS_V1;
use crate::events::PoolMigrated;
use crate::state::{Pool, POOL_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct MigratePool<'info> {
    /// Permissionless — pays the rent top-up for the two extra bytes.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The Pool PDA at its pre-migration size. Address enforced by the
    /// seeds; owner, discriminator and size enforced by hand in the handler
    /// because the account cannot be deserialised as `Pool` until it has
    /// grown.
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump)]
    pub pool: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_migrate_pool(ctx: Context<MigratePool>, pool_id: u64) -> Result<()> {
    let pool_info = ctx.accounts.pool.to_account_info();

    // ---- 1. Prove this is an un-migrated pool of ours ---------------------
    require_keys_eq!(*pool_info.owner, crate::ID, ErrorCode::PoolNotMigratable);
    {
        let data = pool_info.try_borrow_data()?;
        if data.len() >= Pool::SPACE {
            return Err(ErrorCode::PoolAlreadyMigrated.into());
        }
        require!(data.len() == Pool::SPACE_V1, ErrorCode::PoolNotMigratable);
        require!(
            data[..8] == *Pool::DISCRIMINATOR,
            ErrorCode::PoolNotMigratable
        );
        // `id` is the first field after the discriminator (state.rs). The
        // seeds already bind the address to `pool_id`; this catches a PDA
        // that somehow holds a different pool's bytes.
        let stored_id = u64::from_le_bytes(
            data[8..16]
                .try_into()
                .map_err(|_| ErrorCode::PoolNotMigratable)?,
        );
        require!(stored_id == pool_id, ErrorCode::PoolNotMigratable);
    }

    // ---- 2. Rent for the larger account ----------------------------------
    // Through the vault chokepoint like every other credit (standing rule 6).
    let required = Rent::get()?.minimum_balance(Pool::SPACE);
    let held = pool_info.lamports();
    if held < required {
        crate::vault::credit_from_signer(
            &ctx.accounts.system_program,
            &ctx.accounts.payer,
            &pool_info,
            required - held,
        )?;
    }

    // ---- 3. Grow, then write the tail at the pinned offset ----------------
    // The new bytes are zeroed by `resize`, and a zero `min_seats` would let
    // ANY field seal — so this write is not optional and the debug assertion
    // below pins that the offset is the end of the account.
    pool_info.resize(Pool::SPACE)?;
    {
        let mut data = pool_info.try_borrow_mut_data()?;
        let off = Pool::SPACE_V1;
        data[off..off + 2].copy_from_slice(&MIN_SEATS_V1.to_le_bytes());
        debug_assert_eq!(off + 2, Pool::SPACE);
    }

    emit!(PoolMigrated {
        pool: pool_info.key(),
        min_seats: MIN_SEATS_V1,
    });
    Ok(())
}
