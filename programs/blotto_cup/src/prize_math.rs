//! Pure prize arithmetic — the ONE place split and band amounts are computed.
//!
//! Handlers call these; the vault-invariant fuzz suite (`tests/vault_model.rs`)
//! drives the SAME functions through 10k random instruction sequences, so the
//! model and the program cannot drift apart on arithmetic.
//!
//! Integer-only, `u128` intermediates where a product can grow (threat-tm-403).

use crate::constants::{PAID_RANKS, PRIZE_BANDS_1024};

// D-A1 (revised, 2026-08-27): pots are FIXED constants funded from the
// platform treasury at `open_pool`. The former `vault_share`/`fee_share`/
// `pot(entry)` derivations are deliberately GONE — nothing in this program
// computes a pot from entries or balances (standing-rules grep).

/// The prize for `rank` (1-based, 1..=16): `pot × band / 1024`.
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
/// beyond 16 contribute zero). Returns `(each, remainder)`: every tied
/// player receives `each = combined / group_size`, and the `remainder`
/// lamports go to the tied player with the lowest entry index — entry index
/// places the remainder, never decides who is paid. Integer-only; shared by
/// the scoring engine's oracle-pinned twin, the vault model and the tests
/// so the arithmetic exists in exactly one on-chain-adjacent place.
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
    use crate::constants::{TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS};

    /// The bands must partition the pot exactly: Σ bands = 1024.
    #[test]
    fn bands_sum_to_1024() {
        assert_eq!(PRIZE_BANDS_1024.iter().sum::<u64>(), 1024);
    }

    /// The published amounts for the 0.1 tier at the D-E1 pot (4 SOL).
    /// PID §6's reissue is pending (counsel gate, proposal E1 §8.1); this
    /// pins the INTERMEDIATE state — D-E1 pots under the unchanged top-16
    /// bands — and is replaced wholesale by D-E2's single-figure pin. The
    /// band table must reproduce the amounts to the lamport.
    #[test]
    fn bands_reproduce_pid_section_6_amounts_for_the_entry_tier() {
        let pot = TIER_POT_LAMPORTS[0];
        assert_eq!(pot, 4_000_000_000, "tier-0 pot must be 4 SOL (D-E1)");
        let expected: [u64; 16] = [
            1_054_687_500, // 1st  — 1.0546875 SOL
            617_187_500,   // 2nd  — 0.6171875
            398_437_500,   // 3rd  — 0.3984375
            304_687_500,   // 4th  — 0.3046875
            195_312_500,
            195_312_500,
            195_312_500,
            195_312_500, // 5th–8th
            105_468_750,
            105_468_750,
            105_468_750,
            105_468_750, // 9th–16th
            105_468_750,
            105_468_750,
            105_468_750,
            105_468_750,
        ];
        for r in 1..=16u8 {
            assert_eq!(
                band_amount(pot, r),
                expected[(r - 1) as usize],
                "rank {r} amount diverges from the D-E1 published table",
            );
        }
    }

    /// For every configured tier: the pot constant divides by 1024 with zero
    /// remainder and the 16 prizes sum to the pot exactly — no residue,
    /// nothing stranded in the vault. Also pins the founder's stated initial
    /// derivation (pot = 80% of price × 64) WITHOUT the program ever
    /// computing it: the constants must agree at init time.
    #[test]
    fn every_tier_pot_divides_exactly_with_zero_residual() {
        for (t, &pot) in TIER_POT_LAMPORTS.iter().enumerate() {
            assert_eq!(pot % 1024, 0, "tier {t} pot not a multiple of 1024");
            let paid: u64 = (1..=16u8).map(|r| band_amount(pot, r)).sum();
            assert_eq!(paid, pot, "prizes must sum to the pot exactly");
            // The initial constants' published relationship (v2 D-A1).
            assert_eq!(
                pot,
                TIER_ENTRY_LAMPORTS[t] / 8 * 5 * 64,
                "tier {t}: initial pot must be 62.5% of price × 64 (D-E1)"
            );
        }
    }

    /// D3-B split groups: a solo "group" is the plain band; a group covers
    /// its whole span; positions past 16 contribute zero; each × size +
    /// remainder reconstructs the combined prize exactly; and a full-pool
    /// 64-way tie splits the whole pot with zero remainder at tier 0.
    #[test]
    fn split_groups_conserve_lamports_exactly() {
        let pot = TIER_POT_LAMPORTS[0]; // 4 SOL (D-E1)
        for r in 1..=16u16 {
            let (each, rem) = split_group(pot, r, 1);
            assert_eq!(each, band_amount(pot, r as u8));
            assert_eq!(rem, 0);
        }
        // Three-way tie spanning 4th–6th: bands 78+50+50 = 178/1024ths.
        let (each, rem) = split_group(pot, 4, 3);
        let combined = pot / 1024 * 178;
        assert_eq!(each as u128 * 3 + rem as u128, combined as u128);
        assert_eq!(rem, combined % 3, "remainder is the exact residue");
        assert!(rem > 0, "this case exists to make the remainder visible");
        // Straddling 16th/17th: 27 + 0, split two ways, both paid.
        let (each, rem) = split_group(pot, 16, 2);
        assert_eq!(each, pot / 1024 * 27 / 2);
        assert_eq!(rem, 0);
        // Fully below the paid places: zero.
        assert_eq!(split_group(pot, 17, 5), (0, 0));
        // Everyone tied: the whole pot, 64 ways, exact at this tier.
        let (each, rem) = split_group(pot, 1, 64);
        assert_eq!(each, 62_500_000); // 4 SOL / 64 (D-E1)
        assert_eq!(rem, 0);
    }

    /// PID §6's rounded percentage column sums to 100.02% — the reason bands
    /// are NOT expressed in bps. Kept as a test so nobody "fixes" the table
    /// back to the rounded percentages.
    #[test]
    fn the_rounded_bps_table_would_misallocate() {
        let bps: [u64; 16] = [
            2637, 1543, 996, 762, 488, 488, 488, 488, 264, 264, 264, 264, 264, 264, 264, 264,
        ];
        assert_eq!(bps.iter().sum::<u64>(), 10_002, "rounded bps over-allocate");
    }
}
