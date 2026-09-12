//! The single chokepoint for every lamport movement in this program.
//!
//! **No other file may call `system_program::transfer`.** The standing-rules CI
//! check (`scripts/check-standing-rules.sh`, roadmap §3 rule 6) asserts it, and
//! the vault-invariant suite leans on it: if every debit goes through
//! [`vault_debit`], then auditing the vault's exits means auditing this file's
//! call sites — which the CI check pins to exactly `pay_prizes.rs`, `escrow.rs`
//! and `refund.rs`.
//!
//! The PRIZE-VAULT exit set is `pay_prizes`, `release_escrow`,
//! `pay_next_place` (both in `escrow.rs`) and `refund` (the pot returning to
//! the treasury at `trigger_refund` — same file). **`forfeit_escrow` is not
//! an exit**: since the founder ruling of 2026-09-07 it moves no lamports at
//! all, and a forfeited share leaves the vault only by `pay_next_place`,
//! which pays players. There is no admin escape hatch and no
//! recover-stuck-funds path (CLAUDE.md hard rule). D-A1 v2 adds the
//! PLATFORM TREASURY PDA — a separate account, not a fifth vault exit —
//! whose debit call sites are exactly `open_pool.rs` (pot funding),
//! `refund.rs` (returning entry payments) and `treasury.rs`
//! (`withdraw_platform`, Squads-gated and floor-guarded); the standing-rules
//! check pins both sets.
//!
//! Both PDAs here are zero-data, system-owned accounts, so lamports leave them
//! only via a System Program transfer CPI signed with the PDA's seeds —
//! `invoke_signed` through the helpers below. Credits (player → PDA) need no
//! PDA signature and go through [`credit_from_signer`].

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::error::ErrorCode;
use crate::state::{PLATFORM_SEED, VAULT_SEED};

/// The rent-exempt minimum for a zero-data account, read from the sysvar so
/// it tracks any protocol change rather than being pinned to today's number.
///
/// # Why every PDA here keeps this much back
///
/// Both PDAs are zero-data and System-owned, and the runtime refuses any
/// transaction whose post-state moves a writable account from rent-exempt to
/// RENT-PAYING — a non-zero balance below this minimum. Zero is the only
/// other permitted end state.
///
/// Until 2026-09-12 the design drained a prize vault to exactly zero: the pot
/// went in at `open_pool` and the same figure came out at settlement. That is
/// legal on its own, but it left one lamport between the vault and a dead
/// pool. Anyone could send a vault a single lamport — the address is
/// derivable from the public pool id — and the final payment would then try
/// to leave a balance of 1, which the runtime rejects. The pot froze, the
/// entrants went unpaid, and because the tier slot is freed only by
/// `pay_prizes` or the two refund paths, that tier could never open another
/// pool. `docs/internal-review.md` IR-3 had considered unsolicited donations
/// and accepted them as harmless: true of this program's own logic, and not
/// true of the runtime's.
///
/// The fix is a cushion rather than a sweep. `open_pool` funds a vault with
/// the pot PLUS this minimum, so after every lamport of the pot has left, the
/// account still holds at least this much and stays rent-exempt — whatever
/// anyone donated on top. It costs one rent deposit per pool and needs no
/// caller to know which debit is the last, which a sweep would have.
pub fn rent_floor() -> Result<u64> {
    Ok(Rent::get()?.minimum_balance(0))
}

/// Would this debit leave the account rent-paying?
///
/// The guard is separate from the cushion on purpose. The cushion means this
/// can no longer trigger on any reachable path; the guard means that if a
/// later change removes or under-funds the cushion, the program refuses with
/// a named error instead of failing deep in the runtime with one that says
/// nothing about which account or why.
fn assert_rent_safe(account: &AccountInfo, lamports: u64) -> Result<()> {
    let post = account
        .lamports()
        .checked_sub(lamports)
        .ok_or(ErrorCode::Overflow)?;
    require!(
        rent_safe(post, rent_floor()?),
        ErrorCode::WouldStrandRentBalance
    );
    Ok(())
}

/// The rule itself, as a pure function so it can be tested without a runtime:
/// a zero-data account may end a transaction empty or rent-exempt, and
/// nothing in between.
pub fn rent_safe(post_balance: u64, floor: u64) -> bool {
    post_balance == 0 || post_balance >= floor
}

/// Credit a program PDA (or any account) from a transaction signer.
/// Used by `register` (the full price into the treasury) and
/// `fund_platform_wallet`. A transfer to a fresh PDA address creates it as a
/// system-owned account, which is exactly what the treasury and vault are.
pub fn credit_from_signer<'info>(
    system_program: &Program<'info, System>,
    from: &Signer<'info>,
    to: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            system_program.key(),
            Transfer {
                from: from.to_account_info(),
                to: to.clone(),
            },
        ),
        lamports,
    )
}

/// Debit the prize vault PDA `["vault", pool_id]`.
///
/// THE vault exit. Every call site is enumerated by the standing-rules check;
/// adding one is a change to the program's money model and needs the same
/// scrutiny as a new withdraw instruction — because it is one.
pub fn vault_debit<'info>(
    system_program: &Program<'info, System>,
    vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    pool_id: u64,
    vault_bump: u8,
    lamports: u64,
) -> Result<()> {
    assert_rent_safe(vault, lamports)?;
    let id_bytes = pool_id.to_le_bytes();
    let seeds: &[&[u8]] = &[VAULT_SEED, &id_bytes, &[vault_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: vault.clone(),
                to: to.clone(),
            },
            &[seeds],
        ),
        lamports,
    )
}

/// Debit the platform treasury PDA `["platform"]` (D-A1 v2).
///
/// Call sites are exactly three, each pinned by the standing-rules check:
/// `open_pool` (funding the new pool's pot — locked before any pass sells),
/// `refund` (returning a player's full entry payment — R7), and
/// `withdraw_platform` (Squads-only, floor-guarded). Adding one is a change
/// to the program's money model and needs the same scrutiny as a new
/// withdraw instruction — because it is one.
pub fn platform_debit<'info>(
    system_program: &Program<'info, System>,
    platform: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    platform_bump: u8,
    lamports: u64,
) -> Result<()> {
    assert_rent_safe(platform, lamports)?;
    let seeds: &[&[u8]] = &[PLATFORM_SEED, &[platform_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: platform.clone(),
                to: to.clone(),
            },
            &[seeds],
        ),
        lamports,
    )
}

#[cfg(test)]
mod tests {
    use super::rent_safe;

    /// The rent-exempt minimum for a zero-data account at the time of
    /// writing. The program reads the live value from the sysvar; this is
    /// only a realistic number to reason with here.
    const FLOOR: u64 = 890_880;

    #[test]
    fn empty_and_rent_exempt_are_both_allowed() {
        assert!(
            rent_safe(0, FLOOR),
            "an account drained to zero is reaped, which is fine"
        );
        assert!(rent_safe(FLOOR, FLOOR), "exactly rent-exempt is fine");
        assert!(rent_safe(FLOOR + 1, FLOOR));
        assert!(rent_safe(u64::MAX, FLOOR));
    }

    #[test]
    fn the_rent_paying_band_is_refused() {
        // This band is the whole finding: one lamport left behind by a
        // stranger's donation used to make the final payout unlandable.
        assert!(
            !rent_safe(1, FLOOR),
            "one lamport left behind is the attack"
        );
        assert!(!rent_safe(FLOOR - 1, FLOOR));
        for post in [2u64, 5_000, 100_000, 890_879] {
            assert!(
                !rent_safe(post, FLOOR),
                "post-balance {post} is rent-paying"
            );
        }
    }

    /// The cushion is what keeps the program out of that band on every
    /// reachable path: fund with pot + floor, pay out the pot, and whatever
    /// a donor added is still sitting on top of a rent-exempt balance.
    #[test]
    fn the_cushion_survives_any_donation() {
        let pot: u64 = 4_000_000_000;
        for donation in [0u64, 1, 2, 890_879, 890_880, 1_000_000_000] {
            let funded = pot + FLOOR + donation;
            let after_paying_the_pot = funded - pot;
            assert!(
                rent_safe(after_paying_the_pot, FLOOR),
                "a donation of {donation} lamports must not be able to strand the pot"
            );
        }
    }

    /// Without the cushion the same donations are fatal — this is what the
    /// code did before 2026-09-12, and why the fix is the funding change
    /// rather than the guard.
    #[test]
    fn without_the_cushion_a_single_lamport_is_fatal() {
        let pot: u64 = 4_000_000_000;
        assert!(
            rent_safe(pot - pot, FLOOR),
            "the undisturbed vault reached zero and was fine"
        );
        for donation in [1u64, 2, 890_879] {
            let funded = pot + donation;
            assert!(
                !rent_safe(funded - pot, FLOOR),
                "a donation of {donation} lamports would have frozen the pot"
            );
        }
    }
}
