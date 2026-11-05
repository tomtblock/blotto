//! Pool types (D-E19, the Ladder — founder ruling 2026-11-04): one account
//! per (mode, tier, capacity), carrying that combination's published
//! economics and its one-pool-at-a-time slot.
//!
//! Three admin instructions, all signed by `Config.admin` (the Squads vault,
//! threat-tm-402):
//!
//!   - `init_pool_type(mode, tier, capacity)` creates the account, disabled
//!     and with no table. It refuses any capacity other than 8, 16, 32, 64.
//!   - `set_pool_type_economics(…, min_seats, prize_table, pot_lamports)`
//!     records the table, the minimum field and the prize pool the NEXT pool
//!     of this type opens with. The checks are the published rule's shape —
//!     never a derivation: the prize pool is an argument the admin states
//!     and the program COMPARES with the table at the tier's price (standing
//!     rule (g): a pot is never arithmetic over entries or balances).
//!   - `set_pool_type_enabled(…, enabled)` switches the type on or off and
//!     keeps `Config.enabled_pool_types` exact, which is what lets
//!     `open_pool` and `withdraw_platform` prove they were shown every
//!     enabled type when they compute the treasury reserve.
//!
//! Nothing here touches an open pool: every pool copies its table, floor and
//! prize pool at open. Nothing here moves lamports, apart from the rent the
//! admin pays to create the account.

use anchor_lang::prelude::*;

use crate::constants::{
    MAX_PAID_PLACES, MIN_TABLE_ENTRY_LAMPORTS, N_MODES, N_TIERS, POOL_CAPACITIES,
};
use crate::error::ErrorCode;
use crate::events::{PoolTypeEconomicsSet, PoolTypeEnabledSet, PoolTypeInitialized};
use crate::state::{Config, PoolType, CONFIG_SEED, POOL_TYPE_SEED};

/// The three arguments every pool-type instruction is addressed by, checked
/// before any account is read: a capacity that is not one of the four, a
/// tier past the table or an unknown mode is refused by name rather than as
/// a seeds mismatch.
fn check_coordinates(mode: u8, tier: u8, capacity: u16) -> Result<()> {
    require!(mode < N_MODES, ErrorCode::UnknownMode);
    require!((tier as usize) < N_TIERS, ErrorCode::UnknownTier);
    require!(
        POOL_CAPACITIES.contains(&capacity),
        ErrorCode::UnknownCapacity
    );
    Ok(())
}

/// The published rule's SHAPE for a table (D-E19 §7.2): exactly `paid_places`
/// leading non-zero multiples, zeros after them, never increasing.
/// Returns the number of places paid.
pub(crate) fn check_prize_table(prize_table: &[u8; MAX_PAID_PLACES], capacity: u16) -> Result<u8> {
    // The top quarter of the capacity is paid — no more, no fewer.
    let paid = (capacity / 4) as usize;
    require!(
        (1..=MAX_PAID_PLACES).contains(&paid),
        ErrorCode::PrizeTableMalformed
    );
    for (i, &m) in prize_table.iter().enumerate() {
        if i < paid {
            // No zero inside the paid places.
            require!(m > 0, ErrorCode::PrizeTableMalformed);
            // Never increasing down the table.
            if i > 0 {
                require!(m <= prize_table[i - 1], ErrorCode::PrizeTableMalformed);
            }
        } else {
            require!(m == 0, ErrorCode::PrizeTableMalformed);
        }
    }
    Ok(paid as u8)
}

// ---------------------------------------------------------------------------
// init_pool_type
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(mode: u8, tier: u8, capacity: u16)]
pub struct InitPoolType<'info> {
    /// `Config.admin` — the Squads vault. Pays the account's rent.
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = admin,
        space = PoolType::SPACE,
        seeds = [POOL_TYPE_SEED, &[mode], &[tier], &capacity.to_le_bytes()],
        bump,
    )]
    pub pool_type: Box<Account<'info, PoolType>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_pool_type(
    ctx: Context<InitPoolType>,
    mode: u8,
    tier: u8,
    capacity: u16,
) -> Result<()> {
    check_coordinates(mode, tier, capacity)?;
    let t = &mut ctx.accounts.pool_type;
    t.mode = mode;
    t.tier = tier;
    t.capacity = capacity;
    t.min_seats = 0;
    t.paid_places = 0;
    t.prize_table = [0u8; MAX_PAID_PLACES];
    t.pot_lamports = 0;
    t.enabled = false;
    t.active_pool = 0;
    t.next_open_at = 0;
    t.bump = ctx.bumps.pool_type;
    emit!(PoolTypeInitialized {
        pool_type: t.key(),
        mode,
        tier,
        capacity,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// set_pool_type_economics / set_pool_type_enabled
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(mode: u8, tier: u8, capacity: u16)]
pub struct AdminPoolType<'info> {
    /// `Config.admin` — the Squads vault.
    pub admin: Signer<'info>,

    /// `mut`: `set_pool_type_enabled` keeps `enabled_pool_types` exact.
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [POOL_TYPE_SEED, &[mode], &[tier], &capacity.to_le_bytes()],
        bump = pool_type.bump,
    )]
    pub pool_type: Box<Account<'info, PoolType>>,
}

/// Record the economics the next pool of this type opens with. Refuses
/// unless (D-E19 §7.2):
///
///   1. the table pays exactly the top quarter of the capacity, never
///      increases, and holds no zero inside the paid places;
///   2. the minimum field exceeds the places paid (so a pool that plays can
///      always fill every paid place) and does not exceed the capacity;
///   3. `Σ table × price == pot_lamports` at the tier's CURRENT price — a
///      comparison the admin's stated prize pool must pass, never a value
///      the program derives and stores;
///   4. `pot_lamports <= min_seats × price` — the minimum field covers the
///      prize pool (break-even at most, R7-b's rule at every size);
///   5. the tier's price is at least `MIN_TABLE_ENTRY_LAMPORTS` (4,096
///      lamports), below which `commit_results`' first-place bound could
///      refuse a legitimate tie split.
pub fn handle_set_pool_type_economics(
    ctx: Context<AdminPoolType>,
    mode: u8,
    tier: u8,
    capacity: u16,
    min_seats: u16,
    prize_table: [u8; MAX_PAID_PLACES],
    pot_lamports: u64,
) -> Result<()> {
    check_coordinates(mode, tier, capacity)?;
    let paid = check_prize_table(&prize_table, capacity)?;
    require!(
        min_seats > paid as u16 && min_seats <= capacity,
        ErrorCode::MinimumFieldInvalid
    );
    require!(pot_lamports > 0, ErrorCode::ZeroAmount);
    let price = ctx.accounts.config.tier_price_lamports[tier as usize];
    require!(price > 0, ErrorCode::ZeroAmount);
    // The floor under which commit_results' first-place bound could refuse
    // the rule's own tie split (constants.rs, MIN_TABLE_ENTRY_LAMPORTS).
    require!(
        price >= MIN_TABLE_ENTRY_LAMPORTS,
        ErrorCode::EntryPriceTooSmall
    );
    require!(
        PoolType::table_value(&prize_table, price) == pot_lamports as u128,
        ErrorCode::PrizePoolMismatch
    );
    let min_field_entries = (min_seats as u128) * (price as u128);
    require!(
        (pot_lamports as u128) <= min_field_entries,
        ErrorCode::PotExceedsMinimumField
    );

    let t = &mut ctx.accounts.pool_type;
    t.min_seats = min_seats;
    t.paid_places = paid;
    t.prize_table = prize_table;
    t.pot_lamports = pot_lamports;
    emit!(PoolTypeEconomicsSet {
        pool_type: t.key(),
        mode,
        tier,
        capacity,
        min_seats,
        paid_places: paid,
        prize_table,
        pot_lamports,
    });
    Ok(())
}

/// Switch a pool type on or off. On requires its economics to be set. Off
/// stops the NEXT pool of this type and never touches one already taking
/// entries (`register` does not read this switch). `Config.enabled_pool_types`
/// changes only on an actual change of state, so a repeated call is a no-op
/// for the count.
pub fn handle_set_pool_type_enabled(
    ctx: Context<AdminPoolType>,
    mode: u8,
    tier: u8,
    capacity: u16,
    enabled: bool,
) -> Result<()> {
    check_coordinates(mode, tier, capacity)?;
    let t = &mut ctx.accounts.pool_type;
    if enabled {
        require!(
            t.paid_places > 0 && t.pot_lamports > 0 && t.min_seats > 0,
            ErrorCode::PoolTypeEconomicsUnset
        );
    }
    let config = &mut ctx.accounts.config;
    if enabled && !t.enabled {
        config.enabled_pool_types = config
            .enabled_pool_types
            .checked_add(1)
            .ok_or(ErrorCode::Overflow)?;
    } else if !enabled && t.enabled {
        config.enabled_pool_types = config
            .enabled_pool_types
            .checked_sub(1)
            .ok_or(ErrorCode::Overflow)?;
    }
    t.enabled = enabled;
    emit!(PoolTypeEnabledSet {
        pool_type: t.key(),
        mode,
        tier,
        capacity,
        enabled,
        enabled_count: config.enabled_pool_types,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{LADDER_MIN_SEATS, LADDER_TABLES};

    #[test]
    fn every_launch_table_has_the_published_shape() {
        for (k, table) in LADDER_TABLES.iter().enumerate() {
            let cap = POOL_CAPACITIES[k];
            let paid = check_prize_table(table, cap).expect("launch table must pass");
            assert_eq!(paid as u16, cap / 4, "top quarter paid");
            let sum: u16 = table.iter().map(|&m| m as u16).sum();
            assert_eq!(sum, LADDER_MIN_SEATS[k], "minimum field is break-even");
            assert!(LADDER_MIN_SEATS[k] > paid as u16 && LADDER_MIN_SEATS[k] <= cap);
        }
    }

    #[test]
    fn malformed_tables_are_refused() {
        let ok = LADDER_TABLES[1]; // 16: [5,3,1,1]
                                   // Increasing.
        let mut t = ok;
        t[1] = 6;
        assert!(check_prize_table(&t, 16).is_err());
        // A zero inside the paid places.
        let mut t = ok;
        t[2] = 0;
        assert!(check_prize_table(&t, 16).is_err());
        // A non-zero past the paid places (pays a fifth place of 16).
        let mut t = ok;
        t[4] = 1;
        assert!(check_prize_table(&t, 16).is_err());
        // The right table for the wrong capacity.
        assert!(check_prize_table(&ok, 8).is_err());
        assert!(check_prize_table(&ok, 32).is_err());
    }

    #[test]
    fn coordinates_are_refused_by_name() {
        assert!(check_coordinates(0, 0, 8).is_ok());
        assert!(check_coordinates(1, 6, 64).is_ok());
        assert!(check_coordinates(2, 0, 8).is_err());
        assert!(check_coordinates(0, 7, 8).is_err());
        for bad in [0u16, 4, 12, 24, 48, 65, 128] {
            assert!(check_coordinates(0, 0, bad).is_err(), "{bad}");
        }
    }
}
