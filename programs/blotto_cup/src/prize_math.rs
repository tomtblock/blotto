//! Pure prize arithmetic: the band amount for a rank, and the split of a tie
//! group's combined prize.
//!
//! # Who calls this, and who does not (corrected 2026-09-12, audit A-14/B-42)
//!
//! **No instruction handler calls either function, and nothing on chain
//! checks a payout against the band table.** The previous header said
//! "Handlers call these", which was never true of this program. What is
//! true:
//!
//!   - **The amounts are computed OFF CHAIN**, by the settlement crank, in
//!     `backend/scoring/src/prizes.ts` (`amountForRank`) and
//!     `backend/scoring/src/engine.ts` (`assignPrizes`) — the same TypeScript
//!     module the verify page runs in the browser (R20), so a player
//!     recomputes every amount from the published bundle.
//!   - **What the program enforces is the SHAPE and the TOTAL, not the
//!     split.** `commit_results` refuses a payout list that is empty or
//!     longer than `CAPACITY`, that names a seat outside the field, that is
//!     not strictly seat-ascending (sorted and duplicate-free in one check),
//!     or whose amounts do not sum to EXACTLY `Pool.pot_lamports`.
//!     `pay_prizes` then pays the committed list and nothing else. So the
//!     settlement signer cannot change the total, cannot pay a stranger and
//!     cannot pay a seat twice — but the program does not know that rank 1
//!     takes 1024/1024, and a list that gave the pot to the wrong seat would
//!     land. What catches that is recomputation: the published bundle plus
//!     the on-chain results root and payout list.
//!   - **`pay_next_place` does its own division** (equal shares, the
//!     indivisible remainder to the lowest seat) inline in
//!     `instructions/escrow.rs`; it does not call `split_group` either.
//!
//! These functions and the tables they read (`PAID_RANKS`,
//! `PRIZE_BANDS_1024`) are therefore reachable only from tests: the unit
//! tests below, which pin the published figures, and the vault-invariant
//! fuzz suite (`tests/vault_model.rs`), which drives `split_group` through
//! 10k random instruction sequences so the model and the on-chain payout
//! paths cannot drift apart on arithmetic. The module is kept — deliberately
//! — because it is the Rust-side statement of the published rule and the
//! oracle the fuzz model scores against; whether the band table should be
//! enforced on chain is a program-upgrade question, not a documentation one.
//!
//! Integer-only, `u128` intermediates where a product can grow (threat-tm-403).

use crate::constants::{PAID_RANKS, PRIZE_BANDS_1024};

// D-A1 (revised, 2026-08-27): pots are FIXED constants funded from the
// platform treasury at `open_pool`. The former `vault_share`/`fee_share`/
// `pot(entry)` derivations are deliberately GONE — nothing in this program
// computes a pot from entries or balances (standing-rules grep).

/// The prize for `rank` (1-based, 1..=PAID_RANKS): `pot × band / 1024`.
/// Under D-E2 (winner takes all) the only band is rank 1 = 1024/1024 = the
/// whole pot, exact for any pot.
///
/// For every configured tier the pot is a multiple of 1024 lamports, so this
/// divides exactly and the bands sum the pot with zero residual — asserted in
/// the tests below and re-asserted at runtime by the vault invariant.
pub fn band_amount(pot_lamports: u64, rank: u8) -> u64 {
    debug_assert!((1..=PAID_RANKS as u8).contains(&rank));
    ((pot_lamports as u128) * (PRIZE_BANDS_1024[(rank - 1) as usize] as u128) / 1024) as u64
}

/// Split-pot arithmetic for a tie group (decision D3-B, 2026-08-27):
/// a group of `group_size` players tied from 1-based position `first_rank`
/// occupies positions `first_rank .. first_rank + group_size - 1`; its
/// combined prize is the sum of those positions' band amounts (positions
/// beyond `PAID_RANKS` contribute zero). Returns `(each, remainder)`: every
/// tied player receives `each = combined / group_size`, and the `remainder`
/// lamports go to the tied player with the lowest entry index — entry index
/// places the remainder, never decides who is paid. Integer-only; shared by
/// the scoring engine's oracle-pinned twin, the vault model and the tests
/// so the arithmetic exists in exactly one on-chain-adjacent place.
///
/// Under D-E2 this is the sharp edge (proposal E1 §2.4): a tie for first
/// splits the ENTIRE pot k ways and nobody else is paid — `split_group(pot,
/// 1, k) = (pot / k, pot % k)`, `split_group(pot, 2, k) = (0, 0)`. Unchanged
/// code; the tests below pin the new shapes.
pub fn split_group(pot_lamports: u64, first_rank: u16, group_size: u16) -> (u64, u64) {
    assert!(group_size > 0, "a tie group has at least one member");
    let mut combined: u128 = 0;
    for offset in 0..group_size {
        let rank = first_rank + offset;
        if rank >= 1 && rank <= PAID_RANKS as u16 {
            combined += band_amount(pot_lamports, rank as u8) as u128;
        }
    }
    (
        (combined / group_size as u128) as u64,
        (combined % group_size as u128) as u64,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{CAPACITY, MIN_SEATS, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS};

    /// The bands must partition the pot exactly: Σ bands = 1024 — true of
    /// the single D-E2 band as it was of the sixteen before it.
    #[test]
    fn bands_sum_to_1024() {
        assert_eq!(PRIZE_BANDS_1024.iter().sum::<u64>(), 1024);
        assert_eq!(PAID_RANKS, 1, "D-E2: one paid place");
    }

    /// The published figure for the 0.1 tier under D-E2: the pot is 4 SOL
    /// (D-E1) and the player ranked first receives all of it; every other
    /// rank receives nothing. This replaces the top-16 pin wholesale — it
    /// exists so the code cannot drift from the figure PID §6 (reissue,
    /// counsel gate — proposal E1 §8.1) publishes.
    #[test]
    fn winner_takes_the_whole_pot_at_the_entry_tier() {
        let pot = TIER_POT_LAMPORTS[0];
        assert_eq!(pot, 4_000_000_000, "tier-0 pot must be 4 SOL (D-E1)");
        assert_eq!(band_amount(pot, 1), 4_000_000_000, "rank 1 takes the pot");
        // Ranks 2+ are outside the paid places: a group starting there is
        // worth exactly nothing, however large.
        for k in 1..=CAPACITY {
            assert_eq!(split_group(pot, 2, k), (0, 0), "rank 2+ (group of {k})");
        }
        assert_eq!(split_group(pot, 17, 5), (0, 0));
    }

    /// For every configured tier: the pot constant divides by 1024 with zero
    /// remainder (invariant kept under D-E2 — constants.rs) and the paid
    /// places sum to the pot exactly — no residue, nothing stranded in the
    /// vault.
    ///
    /// It also pins the pot's published relationship WITHOUT the program
    /// ever computing one: since R7-b (founder instruction 2026-09-12) that
    /// relationship is `pot == MIN_SEATS × price`, which at `MIN_SEATS = 40`
    /// is the same figure the D-E1 derivation gave (62.5% of price × 64).
    /// The pots did not move; what moved is the minimum field, from 52 down
    /// onto the break-even point itself.
    #[test]
    fn every_tier_pot_divides_exactly_with_zero_residual() {
        for (t, &pot) in TIER_POT_LAMPORTS.iter().enumerate() {
            assert_eq!(pot % 1024, 0, "tier {t} pot not a multiple of 1024");
            let paid: u64 = (1..=PAID_RANKS as u8).map(|r| band_amount(pot, r)).sum();
            assert_eq!(paid, pot, "prizes must sum to the pot exactly");
            // THE PUBLISHED RELATIONSHIP, since R7-b (founder instruction
            // 2026-09-12): the pot is exactly the minimum field's intake.
            //
            // This replaces the D-E1 derivation assert (`pot == price / 8 * 5
            // * 64`, 62.5% of a full field), which the instruction asked to
            // delete. The two agree at these constants — 62.5% of 64 IS 40 —
            // so nothing about the pots changed; what changed is which
            // relationship the program pins, and this is the one the fill
            // rule depends on. The pot stays a table entry; nothing here
            // computes it at runtime.
            assert_eq!(
                pot,
                MIN_SEATS as u64 * TIER_ENTRY_LAMPORTS[t],
                "tier {t}: pot must equal MIN_SEATS × price (R7-b)"
            );
            // The same comparison `set_tier_economics` enforces on the live
            // values. `<=` since R7-b: the minimum field must COVER the pot,
            // and at exactly 40 seats it covers it exactly — break-even,
            // accepted by the founder's ruling of 2026-09-13 on the ground
            // that the pot is pre-funded from the treasury. A pot LARGER
            // than the floor's intake is still refused.
            assert!(
                pot <= MIN_SEATS as u64 * TIER_ENTRY_LAMPORTS[t],
                "tier {t}: MIN_SEATS × price must cover the pot"
            );
            assert_eq!(
                pot / TIER_ENTRY_LAMPORTS[t],
                MIN_SEATS as u64,
                "tier {t}: the pot is exactly the minimum field's intake"
            );
        }
    }

    /// D3-B split groups under D-E2 (proposal E1 §2.4 — the required tie
    /// shapes, at every tier): a solo winner takes the pot; a two-way tie
    /// for first halves it (pots are even); a three-way tie at tier 0 is
    /// 1_333_333_333 each with ONE lamport to the lowest seat; a 64-way tie
    /// splits with zero remainder at every tier (pot = price × 40 and every
    /// price is a whole number of hundredths of a SOL, so pot / 64 is exact);
    /// and a tie for SECOND pays nothing to anyone in it. Each × size +
    /// remainder reconstructs the pot exactly in every case.
    #[test]
    fn split_groups_conserve_lamports_exactly() {
        for (t, &pot) in TIER_POT_LAMPORTS.iter().enumerate() {
            // Solo winner.
            assert_eq!(split_group(pot, 1, 1), (pot, 0), "tier {t} solo");
            // Two-way tie for first.
            let (each, rem) = split_group(pot, 1, 2);
            assert_eq!(each, pot / 2, "tier {t} two-way");
            assert_eq!(rem, 0, "tier {t}: every pot is even");
            // Sixty-four-way tie: exact at every tier.
            let (each, rem) = split_group(pot, 1, 64);
            assert_eq!(each, pot / 64, "tier {t} 64-way");
            assert_eq!(rem, 0, "tier {t}: pot / 64 is exact");
            assert_eq!(each as u128 * 64, pot as u128);
            // Tie for second: nobody in it is paid.
            assert_eq!(split_group(pot, 2, 2), (0, 0), "tier {t} tie for second");
            // Every k-way tie for first reconstructs the pot exactly.
            for k in 1..=CAPACITY {
                let (each, rem) = split_group(pot, 1, k);
                assert_eq!(
                    each as u128 * k as u128 + rem as u128,
                    pot as u128,
                    "tier {t}: {k}-way tie must conserve the pot"
                );
                assert!(rem < k as u64, "remainder is a proper residue");
            }
        }
        // The visible-remainder case: tier 0, three-way tie for first.
        let pot = TIER_POT_LAMPORTS[0];
        let (each, rem) = split_group(pot, 1, 3);
        assert_eq!(each, 1_333_333_333);
        assert_eq!(rem, 1, "one indivisible lamport to the lowest seat");
        assert_eq!(4_000_000_000u64, 1_333_333_333 * 3 + 1);
    }

    /// PID §6's rounded percentage column sums to 100.02% — the reason bands
    /// were NOT expressed in bps under top-16, and the reason the 1024ths
    /// form is kept under D-E2 (a return to a multi-place table is a
    /// constants edit, not a re-derivation). Kept so nobody "fixes" a future
    /// table back to rounded percentages.
    #[test]
    fn the_rounded_bps_table_would_misallocate() {
        let bps: [u64; 16] = [
            2637, 1543, 996, 762, 488, 488, 488, 488, 264, 264, 264, 264, 264, 264, 264, 264,
        ];
        assert_eq!(bps.iter().sum::<u64>(), 10_002, "rounded bps over-allocate");
    }
}
