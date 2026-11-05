//! The platform treasury's instructions (D-A1 revised, master prompt v2
//! 2026-08-27): permissionless funding in, one Squads-gated exit out, and
//! the founder's tier-economics / treasury-policy setters.
//!
//! # The floor (`withdraw_platform`)
//!
//! A withdrawal may never reduce the treasury below
//!
//! ```text
//!   min_platform_lamports
//! + reserve_pots × Σ (prize pool + vault cushion)  for every ENABLED pool
//!                                                   type, on an open tier,
//!                                                   with no live pool
//! + platform_refundable       (entry payments of pools that can still refund)
//! ```
//!
//! Since D-E19 the reserve is computed over `PoolType` accounts, which the
//! caller passes as remaining accounts — one per enabled pool type, in
//! ascending address order. `Config.enabled_pool_types` is the count they
//! must match, so a caller who leaves one out (and so shrinks the reserve)
//! is refused rather than believed.
//!
//! The vault cushion is the rent-exempt minimum `open_pool` funds every prize
//! vault with on top of its pot (2026-09-12, `vault::rent_floor`). A reserved
//! pot is an OPENABLE pot, so the reserve counts what an open actually costs.
//!
//! The first two terms are the founder's policy (v2). The third is a
//! correctness addition recorded in the step report: entries are paid into
//! the treasury at `register` and refunded FROM it if the pool misses its
//! deadline, so the refundable sum is the players' money in transit — R7's
//! 100% refund must be program-held, never a promise that survives only if
//! nobody withdrew. Money-correctness outranks the prose (CLAUDE.md
//! tradeoff order #1).

use anchor_lang::prelude::*;

use crate::constants::{LADDER_MIN_SEATS, N_TIERS};
use crate::error::ErrorCode;
use crate::events::{PlatformFunded, PlatformWithdrawn, TierEconomicsSet, TreasuryPolicySet};
use crate::state::{Config, PoolType, CONFIG_SEED, PLATFORM_SEED};

/// The policy reserve for pool types with no live pool (D-A1's reserve,
/// per pool type since D-E19): `reserve_pots` further prize pools — each
/// with its vault cushion — of every ENABLED pool type whose tier is open
/// and whose slot is empty, optionally excluding one (the type being opened
/// right now, which the caller passes separately).
///
/// The pool types arrive as `remaining` accounts and are believed only if
/// they are EXACTLY the enabled set: every account owned by this program
/// and deserialising as a `PoolType` (the discriminator), every one enabled,
/// strictly ascending by address (sorted and duplicate-free in one check),
/// none equal to `exclude`, and as many as `Config.enabled_pool_types`
/// (minus one when `exclude` is given). A pool type can only exist at its
/// own PDA — `init_pool_type` is the only creator — so owner + discriminator
/// is proof of a genuine one, and the count proves none was left out.
///
/// Each reserved prize pool carries `vault_cushion` — the rent-exempt
/// minimum `open_pool` funds the vault with alongside it — because the
/// reserve exists so the treasury can OPEN those pools, and an open costs
/// the prize pool plus the cushion (the ladder test in
/// `tests/litesvm/tests/treasury_gates.rs` pins this to the lamport).
///
/// The sum is accumulated in `u128` (`threat-tm-403`) and saturates rather
/// than truncating on the way back to `u64`: this value is a FLOOR, so
/// overstating it blocks a withdrawal that might have been fine, while
/// understating it would release money the policy is meant to hold.
pub fn idle_pool_type_reserve<'info>(
    config: &Config,
    remaining: &'info [AccountInfo<'info>],
    exclude: Option<Pubkey>,
    vault_cushion: u64,
) -> Result<u64> {
    let expected = if exclude.is_some() {
        (config.enabled_pool_types as usize)
            .checked_sub(1)
            .ok_or(ErrorCode::PoolTypeListIncomplete)?
    } else {
        config.enabled_pool_types as usize
    };
    require!(
        remaining.len() == expected,
        ErrorCode::PoolTypeListIncomplete
    );
    let mut reserve: u128 = 0;
    let mut previous: Option<Pubkey> = None;
    for info in remaining.iter() {
        require_keys_eq!(*info.owner, crate::ID, ErrorCode::PoolTypeAccountInvalid);
        if let Some(prev) = previous {
            require!(*info.key > prev, ErrorCode::PoolTypeListIncomplete);
        }
        require!(Some(*info.key) != exclude, ErrorCode::PoolTypeListIncomplete);
        let t: Account<'info, PoolType> =
            Account::try_from(info).map_err(|_| ErrorCode::PoolTypeAccountInvalid)?;
        require!(t.enabled, ErrorCode::PoolTypeListIncomplete);
        let tier = t.tier as usize;
        require!(tier < N_TIERS, ErrorCode::PoolTypeAccountInvalid);
        if config.open_tiers_for(t.mode)[tier] && t.active_pool == 0 {
            let per_pool = (t.pot_lamports as u128) + (vault_cushion as u128);
            reserve = reserve.saturating_add(per_pool * (config.treasury_reserve_pots as u128));
        }
        previous = Some(*info.key);
    }
    Ok(u64::try_from(reserve).unwrap_or(u64::MAX))
}

// ---------------------------------------------------------------------------
// fund_platform_wallet — permissionless deposit
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FundPlatformWallet<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: The platform treasury PDA, derivation-checked against the
    /// bump captured at `init_config`.
    #[account(mut, seeds = [PLATFORM_SEED], bump = config.platform_bump)]
    pub platform: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_fund_platform_wallet(ctx: Context<FundPlatformWallet>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    crate::vault::credit_from_signer(
        &ctx.accounts.system_program,
        &ctx.accounts.funder,
        &ctx.accounts.platform.to_account_info(),
        amount,
    )?;
    emit!(PlatformFunded {
        funder: ctx.accounts.funder.key(),
        amount,
        platform_balance: ctx.accounts.platform.lamports(),
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// withdraw_platform — the ONE treasury exit, Squads-gated + floor-guarded
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct WithdrawPlatform<'info> {
    /// The Squads vault — `has_one = admin` is the gate.
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: The platform treasury PDA.
    #[account(mut, seeds = [PLATFORM_SEED], bump = config.platform_bump)]
    pub platform: UncheckedAccount<'info>,

    /// CHECK: The admin-chosen destination; any account the Squads vault
    /// signs for. Recorded in the event so every withdrawal is auditable.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Remaining accounts: every enabled `PoolType`, ascending by address
/// (`idle_pool_type_reserve`). Leaving one out is refused, not believed.
pub fn handle_withdraw_platform<'info>(
    ctx: Context<'info, WithdrawPlatform<'info>>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    let config = &ctx.accounts.config;
    let balance = ctx.accounts.platform.lamports();
    let cushion = crate::vault::rent_floor()?;
    let reserve = idle_pool_type_reserve(config, ctx.remaining_accounts, None, cushion)?;
    let floor = (config.treasury_min_platform_lamports as u128)
        + (reserve as u128)
        + (config.platform_refundable as u128);
    require!(
        (balance as u128) >= (amount as u128) + floor,
        ErrorCode::WithdrawBelowFloor
    );
    crate::vault::platform_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.platform.to_account_info(),
        &ctx.accounts.destination.to_account_info(),
        config.platform_bump,
        amount,
    )?;
    emit!(PlatformWithdrawn {
        destination: ctx.accounts.destination.key(),
        amount,
        platform_balance: ctx.accounts.platform.lamports(),
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// set_tier_economics / set_treasury_policy — founder-owned numbers
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AdminTreasury<'info> {
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,
}

/// One tier per call (Squads proposal readability, the D2 precedent).
/// Never touches an open pool: every pool copies its price and pot at open.
pub fn handle_set_tier_economics(
    ctx: Context<AdminTreasury>,
    tier: u8,
    price_lamports: u64,
    pot_lamports: u64,
) -> Result<()> {
    let t = tier as usize;
    require!(t < N_TIERS, ErrorCode::UnknownTier);
    require!(price_lamports > 0, ErrorCode::ZeroAmount);
    // D-E19 retired the 1024-lamport grid (`PotNotDivisible` is no longer
    // raised): prizes are `multiple × entry`, exact with no division.
    require!(pot_lamports > 0, ErrorCode::ZeroAmount);
    // Since D-E19 the tier pot funds NO pool — every pool type carries its
    // own prize pool (`set_pool_type_economics`). It is kept as the
    // 64-player reference figure, and checked as one: no larger than the
    // 64-player pool's minimum field's entries (R7-b's break-even rule).
    //
    // A PRICE change here makes every pool type of this tier stale: its
    // stored prize pool no longer equals its table at the new price, and
    // `open_pool` refuses it (`PoolTypeEconomicsStale`) until
    // `set_pool_type_economics` restates it. A published prize can never
    // move silently with a price.
    let min_field_entries = (LADDER_MIN_SEATS[3] as u64)
        .checked_mul(price_lamports)
        .ok_or(ErrorCode::Overflow)?;
    require!(
        pot_lamports <= min_field_entries,
        ErrorCode::PotExceedsMinimumField
    );
    let config = &mut ctx.accounts.config;
    config.tier_price_lamports[t] = price_lamports;
    config.tier_pot_lamports[t] = pot_lamports;
    emit!(TierEconomicsSet {
        tier,
        price_lamports,
        pot_lamports,
    });
    Ok(())
}

pub fn handle_set_treasury_policy(
    ctx: Context<AdminTreasury>,
    reserve_pots: u8,
    min_platform_lamports: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.treasury_reserve_pots = reserve_pots;
    config.treasury_min_platform_lamports = min_platform_lamports;
    emit!(TreasuryPolicySet {
        reserve_pots,
        min_platform_lamports,
    });
    Ok(())
}
