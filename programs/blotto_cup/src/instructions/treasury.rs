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
//! + reserve_pots × Σ (pot[t] + vault cushion)   for every ENABLED tier t
//!                                                with no live pool
//! + platform_refundable       (entry payments of pools that can still refund)
//! ```
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

use crate::constants::{MIN_SEATS, N_TIERS};
use crate::error::ErrorCode;
use crate::events::{PlatformFunded, PlatformWithdrawn, TierEconomicsSet, TreasuryPolicySet};
use crate::state::{Config, CONFIG_SEED, PLATFORM_SEED};

/// The policy reserve for tiers with no live pool: `reserve_pots` further
/// pots of every enabled tier whose `active_pool_by_tier` slot is empty,
/// optionally excluding one tier (the one being opened right now).
///
/// Each reserved pot carries `vault_cushion` — the rent-exempt minimum
/// `open_pool` funds the vault with alongside the pot — because the reserve
/// exists so the treasury can OPEN those pools, and an open costs the pot
/// plus the cushion. Counting the pot alone (as this did until 2026-09-12)
/// left the reserve one cushion short per pot: after opening one tier at its
/// exact threshold the treasury held exactly the next tier's pot, and could
/// not open it. The ladder test in `tests/litesvm/tests/treasury_gates.rs`
/// pins the corrected property to the lamport.
///
/// The sum is accumulated in `u128` because it is a product that can grow
/// (`threat-tm-403`), and saturates rather than truncating on the way back to
/// `u64`. That direction matters: this value is a FLOOR, so overstating it
/// blocks a withdrawal that might have been fine, while understating it — which
/// is what a wrapping `as u64` would do — would release money the policy is
/// meant to hold. The sum is unreachable at any configured tier (seven tiers of
/// 300 SOL at the maximum reserve is a rounding error against `u64::MAX`); the
/// saturation is here so the direction of failure is chosen rather than left to
/// a cast.
pub fn idle_tier_reserve(config: &Config, exclude_tier: Option<usize>, vault_cushion: u64) -> u64 {
    let mut reserve: u128 = 0;
    for t in 0..N_TIERS {
        if Some(t) == exclude_tier {
            continue;
        }
        if config.open_tiers[t] && config.active_pool_by_tier[t] == 0 {
            let per_pool = (config.tier_pot_lamports[t] as u128) + (vault_cushion as u128);
            reserve = reserve.saturating_add(per_pool * (config.treasury_reserve_pots as u128));
        }
    }
    u64::try_from(reserve).unwrap_or(u64::MAX)
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

pub fn handle_withdraw_platform(ctx: Context<WithdrawPlatform>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    let config = &ctx.accounts.config;
    let balance = ctx.accounts.platform.lamports();
    let cushion = crate::vault::rent_floor()?;
    let floor = (config.treasury_min_platform_lamports as u128)
        + (idle_tier_reserve(config, None, cushion) as u128)
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
    // The band table divides in 1024ths; a pot off the grid would strand a
    // residue in the vault (prize_math's zero-residual property). Kept under
    // D-E2's single band on purpose (constants.rs).
    require!(
        pot_lamports > 0 && pot_lamports.is_multiple_of(1024),
        ErrorCode::PotNotDivisible
    );
    // The minimum field must COVER the pot: a pot larger than the floor's
    // intake means every pool that plays at the floor pays out more than it
    // took in, at the operator's expense, for ever. A comparison against the
    // live values — the pot itself is never derived from them
    // (standing-rules check (g)).
    //
    // `<=`, not `<`, since R7-b (founder ruling 2026-09-13). D-E4 required
    // the floor to EXCEED the pot, which at the D-E1 pots put the minimum
    // field at 41 or above; the founder set it at exactly 40, which is
    // exactly break-even, on the ground that the pot is pre-funded from the
    // treasury (D-A1) and so a pool's ability to pay never depended on its
    // own entries. This admits that case and nothing worse.
    let min_field_entries = (MIN_SEATS as u64)
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
