//! `migrate_config` — the one-shot Config growth for the Phase B upgrade
//! (hard mode, 2026-09-24): the V2 → V3 migration.
//!
//! Config gains the hard ladder — `hard_open_tiers`, `hard_active_pool_by_tier`
//! and `hard_tier_next_open_at`, `Config::HARD_TAIL_LEN` bytes appended AFTER
//! `tier_next_open_at` (`state.rs`). The live devnet account sits at
//! `Config::SPACE_V2` (484 bytes, where the 2026-09-07 migration left it), and
//! Anchor's `Account<Config>` refuses to deserialise a short account, so
//! between the program upgrade and this transaction EVERY instruction that
//! touches Config fails — including `set_paused(false)`. The runbook
//! therefore runs this immediately after `deploy-devnet.sh`, before anything
//! else.
//!
//! # History: the V1 → V2 path this replaces
//!
//! Until 2026-09-24 this instruction grew a 380-byte Config to 484, writing
//! `keeper`, the two timing fields and `tier_next_open_at` (the 2026-09-07
//! upgrade — prompt v2 §G). Its stated retirement condition — every
//! deployment's Config at `SPACE_V2` — was met on devnet on 2026-09-13, and
//! mainnet is initialised at the current layout, so that path is gone: an
//! account at `SPACE_V1` is now refused (`ConfigNotMigratable`) rather than
//! grown. The `keeper` argument left with it; nothing this migration writes
//! is deployment-specific.
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
//! allocates `Config::SPACE`, and the length check refuses anything that
//! size. Every test fixture and every local validator therefore starts past
//! it (the LiteSVM harness shrinks a fresh Config back to `SPACE_V2` to
//! exercise it), and reachability analysis reads it as dead code (audit
//! 2026-09-11, A-15 — recorded KEEP). It is not dead: the DEPLOYED devnet
//! Config is at `Config::SPACE_V2` and this is the only instruction that can
//! grow it. Deleting it would strand that account — every instruction
//! touching Config would keep failing to deserialise, with no path back, and
//! `set_paused(false)` among them.
//!
//! RETIREMENT CONDITION, so this does not sit here forever: once every
//! deployment's Config account is at `Config::SPACE` (the devnet one after
//! the Phase B runbook's post-upgrade transaction; mainnet is initialised at
//! the new layout and never needs it), this instruction can go, or be
//! replaced by the next layout's migration the way this one replaced the
//! last. `ConfigNotMigratable` / `ConfigAlreadyMigrated` stay either way —
//! removing an error variant renumbers every later code (header of
//! `error.rs`).

use anchor_lang::prelude::*;
use anchor_lang::Discriminator;

use crate::constants::N_TIERS;
use crate::error::ErrorCode;
use crate::events::HardLadderAdded;
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

pub fn handle_migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
    let config_info = ctx.accounts.config.to_account_info();

    // ---- 1. Prove this is the V2 Config and the caller is its admin ------
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
        // Exactly V2: a V1 account (380 bytes) has no path any more — see
        // the module header. Refusing it is the safe failure; growing it
        // would leave the V2 tail zeroed, and a zero keeper is the outage
        // audit A7 refuses elsewhere.
        require!(
            data.len() == Config::SPACE_V2,
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
    // `hard_open_tiers` all false and `hard_active_pool_by_tier` all zero
    // ARE the zeroed bytes `resize` leaves, and both are the values wanted:
    // no hard tier is enabled until `set_hard_open_tiers` says so, and none
    // has a live pool. Only the cooldown clocks need a write — every hard
    // tier's stamp starts at the migration, not at the epoch, for the same
    // reason the easy ones did in 2026-09-07's migration: `open_pool`
    // requires `now >= next_open_at`, and while a zero would be harmless
    // today (the tier is disabled, and enabling it restamps), the field's
    // meaning is "the earliest this tier may open" and the epoch is not that.
    let now = Clock::get()?.unix_timestamp;
    {
        let mut data = config_info.try_borrow_mut_data()?;
        let mut off = Config::SPACE_V2;
        // hard_open_tiers: N_TIERS × false (already zero — written anyway so
        // the offsets below are explicit rather than assumed).
        for _ in 0..N_TIERS {
            data[off] = 0;
            off += 1;
        }
        // hard_active_pool_by_tier: N_TIERS × 0u64.
        for _ in 0..N_TIERS {
            data[off..off + 8].copy_from_slice(&0u64.to_le_bytes());
            off += 8;
        }
        // hard_tier_next_open_at: N_TIERS × now.
        for _ in 0..N_TIERS {
            data[off..off + 8].copy_from_slice(&now.to_le_bytes());
            off += 8;
        }
        debug_assert_eq!(off, Config::SPACE);
    }

    emit!(HardLadderAdded { migrated_at: now });
    Ok(())
}

// ---------------------------------------------------------------------------
// `migrate_pool` — the Pool account migration, now covering two old layouts.
// ---------------------------------------------------------------------------
//
// Two appended fields have grown `Pool` since launch, and a devnet pool can
// be at either old size:
//
//  - `Pool::SPACE_V1` (847): pre-R7-b, before `min_seats: u16` (2026-09-13).
//    Grown to the current size and written `MIN_SEATS_V1` (52) — the floor
//    its players actually entered under, never the new 40 — then `mode`.
//  - `Pool::SPACE_V2` (849): post-R7-b, before `mode: u8` (Phase B,
//    2026-09-24). Grown by one byte and written `mode`; its `min_seats` is
//    left exactly as it is.
//
// `mode` is always `MODE_EASY`: every pool that predates the field played
// easy, because hard did not exist. (It is also the zero `resize` leaves, so
// the write is belt-and-braces; the debug assertion pins the offset.)
//
// Anchor's `Account<Pool>` refuses a short account, so between the program
// upgrade and this transaction every instruction touching an old pool fails
// — including `pay_next_place` and `release_escrow`, which run on pools that
// are already `Paid`. The runbook runs it for every pool on the deployment.
//
// Same shape as `migrate_config` above, and the same reasons for each part:
// the account arrives as an `UncheckedAccount` whose address is PDA-checked
// by Anchor, because it cannot be deserialised as `Pool` until it has grown;
// its owner, discriminator and size are checked by hand; the old bytes are
// never touched; and an account already at the new size is refused, so a
// repeated transaction is a clean no-op failure rather than a second write.
//
// PERMISSIONLESS, unlike `migrate_config`. It writes known constants into one
// PDA-checked account and refuses every account that is not an un-migrated
// pool, so there is nothing for an admin signature to protect; and there are
// dozens of these to run against live pools some of which hold money, so a
// path that does not depend on the multisig being available is the safer
// one. The admin pays nothing either — rent comes from whoever sends it.
//
// RETIREMENT CONDITION: once every deployment's pools are at `Pool::SPACE`,
// this instruction, `MIN_SEATS_V1`, `Pool::LEN_V1`, `Pool::LEN_V2` and the
// two error variants can go together. Removing the error variants renumbers
// every later code — see the header of `error.rs`.

use crate::constants::{MIN_SEATS_V1, MODE_EASY};
use crate::events::PoolMigrated;
use crate::state::{Pool, POOL_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct MigratePool<'info> {
    /// Permissionless — pays the rent top-up for the extra bytes.
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
    let from_v1 = {
        let data = pool_info.try_borrow_data()?;
        if data.len() >= Pool::SPACE {
            return Err(ErrorCode::PoolAlreadyMigrated.into());
        }
        let from_v1 = match data.len() {
            Pool::SPACE_V1 => true,
            Pool::SPACE_V2 => false,
            _ => return Err(ErrorCode::PoolNotMigratable.into()),
        };
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
        from_v1
    };

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

    // ---- 3. Grow, then write the tail at the pinned offsets ---------------
    // The new bytes are zeroed by `resize`, and a zero `min_seats` would let
    // ANY field seal — so the V1 write is not optional, and the debug
    // assertion pins that the last byte written is the end of the account.
    pool_info.resize(Pool::SPACE)?;
    let min_seats = {
        let mut data = pool_info.try_borrow_mut_data()?;
        let min_seats = if from_v1 {
            let off = Pool::SPACE_V1;
            data[off..off + 2].copy_from_slice(&MIN_SEATS_V1.to_le_bytes());
            MIN_SEATS_V1
        } else {
            // Report the floor the pool already carries, so the event reads
            // the same for both paths.
            u16::from_le_bytes(
                data[Pool::SPACE_V1..Pool::SPACE_V1 + 2]
                    .try_into()
                    .map_err(|_| ErrorCode::PoolNotMigratable)?,
            )
        };
        let off = Pool::SPACE_V2;
        data[off] = MODE_EASY;
        debug_assert_eq!(off + 1, Pool::SPACE);
        min_seats
    };

    emit!(PoolMigrated {
        pool: pool_info.key(),
        min_seats,
        mode: MODE_EASY,
    });
    Ok(())
}
