//! Pure prize arithmetic — the ONE place split and band amounts are computed.
//!
//! Handlers call these; the vault-invariant fuzz suite (`tests/vault_model.rs`)
//! drives the SAME functions through 10k random instruction sequences, so the
//! model and the program cannot drift apart on arithmetic.
//!
//! Integer-only, `u128` intermediates where a product can grow (threat-tm-403).

use crate::constants::{BPS_DENOM, CAPACITY, PAID_RANKS, PRIZE_BANDS_1024, VAULT_BPS};

/// The 80% prize-pool share of one entry (PID §2).
pub fn vault_share(entry_lamports: u64) -> u64 {
    ((entry_lamports as u128) * (VAULT_BPS as u128) / (BPS_DENOM as u128)) as u64
}

/// The 20% platform share of one entry — defined as the remainder so the two
/// shares always sum to exactly the entry, whatever the rounding.
pub fn fee_share(entry_lamports: u64) -> u64 {
    entry_lamports - vault_share(entry_lamports)
}

/// The full pot of a sealed pool: 64 vault shares.
pub fn pot(entry_lamports: u64) -> u64 {
    vault_share(entry_lamports) * (CAPACITY as u64)
}

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
    use crate::constants::TIER_ENTRY_LAMPORTS;

    /// The bands must partition the pot exactly: Σ bands = 1024.
    #[test]
    fn bands_sum_to_1024() {
        assert_eq!(PRIZE_BANDS_1024.iter().sum::<u64>(), 1024);
    }

    /// PID §6 publishes exact SOL amounts for the 0.1 tier. The band table must
    /// reproduce them to the lamport — this pins the derivation in
    /// `constants.rs` against the founder's published numbers.
    #[test]
    fn bands_reproduce_pid_section_6_amounts_for_the_entry_tier() {
        let entry = 100_000_000u64; // 0.1 SOL
        let pot = pot(entry);
        assert_eq!(pot, 5_120_000_000, "pot must be 5.12 SOL");
        let expected: [u64; 16] = [
            1_350_000_000, // 1st  — 1.350 SOL
            790_000_000,   // 2nd  — 0.790
            510_000_000,   // 3rd  — 0.510
            390_000_000,   // 4th  — 0.390
            250_000_000,
            250_000_000,
            250_000_000,
            250_000_000, // 5th–8th
            135_000_000,
            135_000_000,
            135_000_000,
            135_000_000, // 9th–16th
            135_000_000,
            135_000_000,
            135_000_000,
            135_000_000,
        ];
        for r in 1..=16u8 {
            assert_eq!(
                band_amount(pot, r),
                expected[(r - 1) as usize],
                "rank {r} amount diverges from PID §6",
            );
        }
    }

    /// For every configured tier: the split is exact, the pot divides by 1024
    /// with zero remainder, and the 16 prizes sum to the pot exactly — no
    /// residual, nothing stranded in the vault.
    #[test]
    fn every_tier_divides_exactly_with_zero_residual() {
        for &entry in TIER_ENTRY_LAMPORTS.iter() {
            assert_eq!(vault_share(entry) + fee_share(entry), entry);
            // 80% of these entries is exact (all are multiples of 10 lamports).
            assert_eq!(vault_share(entry), entry / 10 * 8);
            let pot = pot(entry);
            assert_eq!(
                pot % 1024,
                0,
                "pot for entry {entry} not a multiple of 1024"
            );
            let paid: u64 = (1..=16u8).map(|r| band_amount(pot, r)).sum();
            assert_eq!(paid, pot, "prizes must sum to the pot exactly");
        }
    }

    /// D3-B split groups: a solo "group" is the plain band; a group covers
    /// its whole span; positions past 16 contribute zero; each × size +
    /// remainder reconstructs the combined prize exactly; and a full-pool
    /// 64-way tie splits the whole pot with zero remainder at the 0.1 tier.
    #[test]
    fn split_groups_conserve_lamports_exactly() {
        let pot = pot(100_000_000); // 5.12 SOL
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
        assert_eq!(each, 80_000_000);
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
