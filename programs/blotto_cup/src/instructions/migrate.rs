//! `migrate_config` — the one-shot Config growth after a layout-changing
//! upgrade. Two source layouts are accepted, and both end at `Config::SPACE`:
//!
//!   - `Config::SPACE_V3` (603 bytes, Phase B → the Ladder, D-E19): grown by
//!     `LADDER_TAIL_LEN` and written `enabled_pool_types = 0`. Every pool
//!     type starts disabled, so zero is exact, and `set_pool_type_enabled`
//!     keeps it exact from there. Devnet's Config is here today.
//!   - `Config::SPACE_V2` (484 bytes, before Phase B): grown through BOTH
//!     tails — the hard ladder (`hard_open_tiers` all off,
//!     `hard_active_pool_by_tier` all zero, `hard_tier_next_open_at` stamped
//!     now) and the Ladder count.
//!
//! Anchor's `Account<Config>` refuses to deserialise a short account, so
//! between the program upgrade and this transaction EVERY instruction that
//! touches Config fails — including `set_paused(false)`. The runbook
//! therefore runs this immediately after the upgrade, before anything else.
//!
//! # History: the V1 → V2 path
//!
//! Until 2026-09-24 this instruction grew a 380-byte Config to 484, writing
//! `keeper`, the two timing fields and `tier_next_open_at` (the 2026-09-07
//! upgrade — prompt v2 §G). Its stated retirement condition — every
//! deployment's Config at `SPACE_V2` — was met on devnet on 2026-09-13, and
//! mainnet is initialised at the current layout, so that path is gone: an
//! account at `SPACE_V1` is refused (`ConfigNotMigratable`) rather than grown.
//!
//! Why by hand: the account cannot be an `Account<Config>` here (it is the
//! old layout), so it arrives as an `UncheckedAccount` whose address is
//! PDA-checked by Anchor (`seeds` + `bump`), and whose owner, discriminator,
//! size and admin field are checked below before anything is written. The
//! old bytes are never touched; each tail is written at the exact offsets the
//! `config_len_matches_serialized_size` test pins.
//!
//! RETIREMENT CONDITION: once every deployment's Config account is at
//! `Config::SPACE` (mainnet is initialised at the new layout and never needs
//! it), this instruction can go, or be replaced by the next layout's
//! migration. `ConfigNotMigratable` / `ConfigAlreadyMigrated` stay either
//! way — removing an error variant renumbers every later code (header of
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

    // ---- 1. Prove this is an old Config and the caller is its admin ------
    require_keys_eq!(
        *config_info.owner,
        crate::ID,
        ErrorCode::ConfigNotMigratable
    );
    let from_v2 = {
        let data = config_info.try_borrow_data()?;
        if data.len() >= Config::SPACE {
            return Err(ErrorCode::ConfigAlreadyMigrated.into());
        }
        // V2 or V3 only: a V1 account (380 bytes) has no path any more — see
        // the module header. Refusing it is the safe failure; growing it
        // would leave the V2 tail zeroed, and a zero keeper is the outage
        // audit A7 refuses elsewhere.
        let from_v2 = match data.len() {
            Config::SPACE_V2 => true,
            Config::SPACE_V3 => false,
            _ => return Err(ErrorCode::ConfigNotMigratable.into()),
        };
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
        from_v2
    };

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

    // ---- 3. Grow, then write each missing tail at the pinned offsets -----
    // PHASE-E1-REVIEW: Solana 3.x names the in-place grow `resize`
    // (`realloc` is the deprecated spelling); the new bytes are zeroed.
    config_info.resize(Config::SPACE)?;
    let now = Clock::get()?.unix_timestamp;
    {
        let mut data = config_info.try_borrow_mut_data()?;
        if from_v2 {
            // The Phase B tail. `hard_open_tiers` all false and
            // `hard_active_pool_by_tier` all zero ARE the zeroed bytes
            // `resize` leaves; only the cooldown clocks need a value — every
            // hard tier's stamp starts at the migration, not the epoch,
            // because the field means "the earliest this tier may open".
            let mut off = Config::SPACE_V2;
            for _ in 0..N_TIERS {
                data[off] = 0;
                off += 1;
            }
            for _ in 0..N_TIERS {
                data[off..off + 8].copy_from_slice(&0u64.to_le_bytes());
                off += 8;
            }
            for _ in 0..N_TIERS {
                data[off..off + 8].copy_from_slice(&now.to_le_bytes());
                off += 8;
            }
            debug_assert_eq!(off, Config::SPACE_V3);
        }
        // The Ladder tail (D-E19): `enabled_pool_types = 0`. Every pool type
        // is created disabled, so zero is exact, and only
        // `set_pool_type_enabled` moves it from here.
        let off = Config::SPACE_V3;
        data[off..off + 2].copy_from_slice(&0u16.to_le_bytes());
        debug_assert_eq!(off + Config::LADDER_TAIL_LEN, Config::SPACE);
    }

    if from_v2 {
        emit!(HardLadderAdded { migrated_at: now });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// `migrate_pool` — the Pool account migration, covering three old layouts.
// ---------------------------------------------------------------------------
//
// Three appended groups of fields have grown `Pool` since launch, and a
// devnet pool can be at any of the old sizes:
//
//  - `Pool::SPACE_V1` (847): pre-R7-b, before `min_seats: u16` (2026-09-13).
//    Written `MIN_SEATS_V1` (52) — the floor its players actually entered
//    under — then `mode`, then the Ladder tail.
//  - `Pool::SPACE_V2` (849): post-R7-b, before `mode: u8` (Phase B,
//    2026-09-24). Written `mode`, then the Ladder tail; its `min_seats` is
//    left exactly as it is.
//  - `Pool::SPACE_V3` (850): Phase B, before the Ladder (D-E19). Written the
//    Ladder tail only. Every devnet pool today.
//
// `mode` is always `MODE_EASY` when it is written: every pool that predates
// the field played easy, because hard did not exist.
//
// THE LADDER TAIL records what the pool's players entered under: 64 seats
// and ONE paid place — the winner takes the whole prize pool (D-E2). The
// table is the prize pool in whole entries, `[pot / entry]`, which is 40 for
// every devnet pool that played (4 SOL at 0.1 SOL). The spec proposed
// writing `[40]` everywhere; this writes what each pool's own figures say,
// because one devnet pool (#1, Closed, refunded, from before D-E1) holds a
// 5.12 SOL prize pool that is not a whole number of entries.
// PHASE-N-REVIEW: that refinement is the agent's, recorded rather than buried.
//
//   - prize pool divisible by the entry, quotient in 1..=255 →
//     `paid_places = 1`, `prize_table = [pot / entry, 0, …]`. Exact: rank 1
//     is owed the whole prize pool.
//   - otherwise, a pool that NEVER PLAYED (`Refunding` or `Closed`) →
//     `paid_places = 0`, an all-zero table: there is nothing to recompute.
//   - otherwise → refused (`MigrationUnrepresentable`). A pool that played,
//     or could still play, must carry a table its prize pool can be checked
//     against; none exists on devnet, and mainnet starts at the new layout.
//
// Anchor's `Account<Pool>` refuses a short account, so between the program
// upgrade and this transaction every instruction touching an old pool fails
// — including `release_escrow` on pools that are already `Paid`. The runbook
// runs it for every pool on the deployment.
//
// The account arrives as an `UncheckedAccount` whose address is PDA-checked
// by Anchor; its owner, discriminator, id and size are checked by hand; the
// old bytes are never touched; and an account already at the new size is
// refused, so a repeated transaction is a clean no-op failure.
//
// PERMISSIONLESS, unlike `migrate_config`: it writes values determined by
// the pool's own bytes into one PDA-checked account and refuses everything
// else, so there is nothing for an admin signature to protect, and a path
// that does not depend on the multisig being available is the safer one.
// Rent comes from whoever sends it.
//
// RETIREMENT CONDITION: once every deployment's pools are at `Pool::SPACE`,
// this instruction, `MIN_SEATS_V1` and the `LEN_V*` constants can go
// together. Removing an error variant renumbers every later code — see the
// header of `error.rs`.

use crate::constants::{CAPACITY, MAX_PAID_PLACES, MIN_SEATS_V1, MODE_EASY};
use crate::events::PoolMigrated;
use crate::state::{Pool, PoolState, POOL_SEED};

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct MigratePool<'info> {
    /// Anyone — pays the rent top-up.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: An old-layout Pool, PDA-checked by these seeds; owner,
    /// discriminator, stored id and size are checked in the handler.
    #[account(mut, seeds = [POOL_SEED, &pool_id.to_le_bytes()], bump)]
    pub pool: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// The Ladder tail for a pre-Ladder pool, from its own entry price, prize
/// pool and state (see the section comment). Pure, so it is unit-tested.
pub(crate) fn pre_ladder_table(
    entry_lamports: u64,
    pot_lamports: u64,
    state_byte: u8,
) -> Result<(u8, [u8; MAX_PAID_PLACES])> {
    let mut table = [0u8; MAX_PAID_PLACES];
    if entry_lamports > 0 && pot_lamports.is_multiple_of(entry_lamports) {
        let multiple = pot_lamports / entry_lamports;
        if (1..=255).contains(&multiple) {
            table[0] = multiple as u8;
            return Ok((1, table));
        }
    }
    let never_played =
        state_byte == PoolState::Refunding as u8 || state_byte == PoolState::Closed as u8;
    require!(never_played, ErrorCode::MigrationUnrepresentable);
    Ok((0, table))
}

pub fn handle_migrate_pool(ctx: Context<MigratePool>, pool_id: u64) -> Result<()> {
    let pool_info = ctx.accounts.pool.to_account_info();

    require_keys_eq!(*pool_info.owner, crate::ID, ErrorCode::PoolNotMigratable);
    let (from_len, entry_lamports, pot_lamports, state_byte) = {
        let data = pool_info.try_borrow_data()?;
        if data.len() >= Pool::SPACE {
            return Err(ErrorCode::PoolAlreadyMigrated.into());
        }
        let from_len = match data.len() {
            Pool::SPACE_V1 | Pool::SPACE_V2 | Pool::SPACE_V3 => data.len(),
            _ => return Err(ErrorCode::PoolNotMigratable.into()),
        };
        require!(
            data[..8] == *Pool::DISCRIMINATOR,
            ErrorCode::PoolNotMigratable
        );
        let read_u64 = |at: usize| -> Result<u64> {
            Ok(u64::from_le_bytes(
                data[at..at + 8]
                    .try_into()
                    .map_err(|_| ErrorCode::PoolNotMigratable)?,
            ))
        };
        // Offsets pinned by every reader of the Pool head (state.rs): id at
        // 8, entry_lamports at 17, pot_lamports at 25, state at 51.
        require!(read_u64(8)? == pool_id, ErrorCode::PoolNotMigratable);
        (from_len, read_u64(17)?, read_u64(25)?, data[51])
    };
    let (paid_places, prize_table) = pre_ladder_table(entry_lamports, pot_lamports, state_byte)?;

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

    pool_info.resize(Pool::SPACE)?;
    let (min_seats, mode) = {
        let mut data = pool_info.try_borrow_mut_data()?;
        let min_seats = if from_len == Pool::SPACE_V1 {
            let off = Pool::SPACE_V1;
            data[off..off + 2].copy_from_slice(&MIN_SEATS_V1.to_le_bytes());
            MIN_SEATS_V1
        } else {
            u16::from_le_bytes(
                data[Pool::SPACE_V1..Pool::SPACE_V1 + 2]
                    .try_into()
                    .map_err(|_| ErrorCode::PoolNotMigratable)?,
            )
        };
        if from_len < Pool::SPACE_V3 {
            data[Pool::SPACE_V2] = MODE_EASY;
        }
        let mode = data[Pool::SPACE_V2];
        // The Ladder tail: capacity, paid_places, prize_table.
        let mut off = Pool::SPACE_V3;
        data[off..off + 2].copy_from_slice(&CAPACITY.to_le_bytes());
        off += 2;
        data[off] = paid_places;
        off += 1;
        data[off..off + MAX_PAID_PLACES].copy_from_slice(&prize_table);
        off += MAX_PAID_PLACES;
        debug_assert_eq!(off, Pool::SPACE);
        (min_seats, mode)
    };

    emit!(PoolMigrated {
        pool: pool_info.key(),
        min_seats,
        mode,
        capacity: CAPACITY,
        paid_places,
        prize_table,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_played_pool_records_its_prize_pool_in_whole_entries() {
        // Every devnet pool that played: 4 SOL at 0.1 SOL → [40].
        let (paid, t) =
            pre_ladder_table(100_000_000, 4_000_000_000, PoolState::Paid as u8).unwrap();
        assert_eq!(paid, 1);
        assert_eq!(t[0], 40);
        assert!(t[1..].iter().all(|&m| m == 0));
    }

    #[test]
    fn a_pool_that_never_played_may_carry_no_table() {
        // Pool #1 on devnet: 5.12 SOL at 0.1 SOL, Closed.
        let (paid, t) =
            pre_ladder_table(100_000_000, 5_120_000_000, PoolState::Closed as u8).unwrap();
        assert_eq!(paid, 0);
        assert!(t.iter().all(|&m| m == 0));
        assert!(pre_ladder_table(100_000_000, 5_120_000_000, PoolState::Refunding as u8).is_ok());
    }

    #[test]
    fn a_pool_that_played_or_could_play_must_be_representable() {
        for st in [
            PoolState::Open,
            PoolState::Sealed,
            PoolState::Scored,
            PoolState::Paid,
        ] {
            assert!(
                pre_ladder_table(100_000_000, 5_120_000_000, st as u8).is_err(),
                "{st:?}"
            );
        }
        // More than 255 entries' worth cannot be a u8 multiple.
        assert!(pre_ladder_table(1, 256, PoolState::Paid as u8).is_err());
    }
}
