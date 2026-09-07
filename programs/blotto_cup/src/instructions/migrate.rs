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
    // Every tier's liveness clock starts at the migration, not at the epoch.
    // A zero there puts `open_pool`'s fallback window (`0 + LIVENESS_FALLBACK_SECS`)
    // decades in the past, so ANY signer could open a tier's first pool after
    // the upgrade — and the opener chooses the pool's sealing key, which our
    // custody would then not hold. `now` costs the keeper nothing (`open_pool`
    // requires `now >= tier_next_open_at`) and holds a stranger off for a full
    // fallback window. Same reasoning as `handle_set_open_tiers`.
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
