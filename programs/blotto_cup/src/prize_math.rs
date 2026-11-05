//! Pure prize arithmetic under the Ladder (D-E19, founder ruling 2026-11-04):
//! what a position is worth, and the split of a tie group's combined prize.
//!
//! # Who calls this, and who does not (corrected 2026-09-12, audit A-14/B-42)
//!
//! **No instruction handler calls either function, and nothing on chain
//! checks a payout against the prize table seat by seat.** What is true:
//!
//!   - **The amounts are computed OFF CHAIN**, by the settlement crank, in
//!     `backend/scoring/src/prizes.ts` (`amountForRank`) and
//!     `backend/scoring/src/engine.ts` (`assignPrizes`) — the same TypeScript
//!     module the verify page runs in the browser (R20), so a player
//!     recomputes every amount from the published bundle.
//!   - **What the program enforces is the SHAPE, the BOUNDS and the TOTAL,
//!     not the split.** `commit_results` refuses a payout list that is empty
//!     or longer than `CAPACITY`, that names a seat outside the field, that
//!     is not strictly seat-ascending, that holds a zero amount or one above
//!     the pool's first prize (`prize_table[0] × entry`, D-E19 §7.6), or
//!     whose amounts do not sum to EXACTLY `Pool.pot_lamports`. The program
//!     does not rank (D-E19 decision 6), so a list that paid the right
//!     amounts to the wrong seats would land; what catches that is
//!     recomputation from the published bundle and the on-chain root.
//!   - **`pay_next_place` does its own division** inline in
//!     `instructions/escrow.rs`, and since D-E19 only for pools paying one
//!     place (those opened before the Ladder).
//!
//! These functions are therefore reachable only from tests: the unit tests
//! below, which pin the published figures, and the vault-invariant fuzz
//! suite (`tests/vault_model.rs`), which drives `split_group` through
//! random instruction sequences so the model and the on-chain payout paths
//! cannot drift apart on arithmetic. The module is kept — deliberately — as
//! the Rust-side statement of the published rule.
//!
//! Integer-only, `u128` intermediates where a product can grow (threat-tm-403).
//! There is no division in a position's worth: it is `multiple × entry`,
//! exact at every tier. The only division is the tie split.

use crate::constants::MAX_PAID_PLACES;

/// What position `rank` (1-based) is worth in a pool paying `prize_table`
/// at `entry_lamports`: `prize_table[rank-1] × entry_lamports`, zero past
/// the paid places (and zero for the table's zero padding). Saturates
/// rather than wraps: unreachable at any configured tier (255 × 7.5 SOL is
/// far below `u64::MAX`), and a saturated amount fails the exact-sum check
/// instead of paying a wrapped one.
pub fn place_amount(prize_table: &[u8; MAX_PAID_PLACES], entry_lamports: u64, rank: u16) -> u64 {
    if rank == 0 || rank as usize > MAX_PAID_PLACES {
        return 0;
    }
    let v = (prize_table[(rank - 1) as usize] as u128) * (entry_lamports as u128);
    u64::try_from(v).unwrap_or(u64::MAX)
}

/// Split-pot arithmetic for a tie group (decision D3-B, 2026-08-27,
/// unchanged by D-E19): a group of `group_size` players tied from 1-based
/// position `first_rank` occupies positions `first_rank ..= first_rank +
/// group_size - 1`; its combined prize is the sum of those positions'
/// worth, with positions past the paid places contributing zero — so a group
/// can straddle the paid line (four tied across 15th–18th of 64 share 15th
/// and 16th). Returns `(each, remainder)`: every tied player receives
/// `each = combined / group_size`, and the `remainder` lamports go to the
/// tied player with the lowest entry index — entry index places the
/// remainder, never decides who is paid.
pub fn split_group(
    prize_table: &[u8; MAX_PAID_PLACES],
    entry_lamports: u64,
    first_rank: u16,
    group_size: u16,
) -> (u64, u64) {
    assert!(group_size > 0, "a tie group has at least one member");
    let mut combined: u128 = 0;
    for offset in 0..group_size {
        let rank = first_rank.saturating_add(offset);
        combined += place_amount(prize_table, entry_lamports, rank) as u128;
    }
    (
        (combined / group_size as u128) as u64,
        (combined % group_size as u128) as u64,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{
        LADDER_MIN_SEATS, LADDER_TABLES, POOL_CAPACITIES, TIER_ENTRY_LAMPORTS, TIER_POT_LAMPORTS,
    };

    fn prize_pool(table: &[u8; MAX_PAID_PLACES], entry: u64) -> u64 {
        (1..=MAX_PAID_PLACES as u16)
            .map(|r| place_amount(table, entry, r))
            .sum()
    }

    /// The spec's "prize pool by tier" grid (D-E19 §4), every cell: 5, 10,
    /// 20 and 40 entries at every tier, so 0.5 / 1 / 2 / 4 SOL at 0.1 SOL
    /// and 37.5 / 75 / 150 / 300 SOL at 7.5 SOL. The 64 column is the D-E1
    /// tier pot, unchanged.
    #[test]
    fn prize_pools_are_the_published_grid() {
        let entries_worth = [5u64, 10, 20, 40];
        for (t, &entry) in TIER_ENTRY_LAMPORTS.iter().enumerate() {
            for (k, table) in LADDER_TABLES.iter().enumerate() {
                assert_eq!(
                    prize_pool(table, entry),
                    entries_worth[k] * entry,
                    "tier {t}, {} players",
                    POOL_CAPACITIES[k]
                );
            }
            assert_eq!(
                prize_pool(&LADDER_TABLES[3], entry),
                TIER_POT_LAMPORTS[t],
                "tier {t}: the 64 column is the D-E1 tier pot"
            );
        }
        // Spot-check the spec's own figures at 0.1 SOL.
        let e = TIER_ENTRY_LAMPORTS[0];
        assert_eq!(place_amount(&LADDER_TABLES[0], e, 1), 300_000_000); // 0.3 SOL
        assert_eq!(place_amount(&LADDER_TABLES[1], e, 1), 500_000_000); // 0.5 SOL
        assert_eq!(place_amount(&LADDER_TABLES[2], e, 1), 800_000_000); // 0.8 SOL
        assert_eq!(place_amount(&LADDER_TABLES[3], e, 1), 1_200_000_000); // 1.2 SOL
        // The largest single prize anywhere in the grid: 1st of a 7.5 SOL
        // 64-player pool, 90 SOL.
        assert_eq!(place_amount(&LADDER_TABLES[3], TIER_ENTRY_LAMPORTS[6], 1), 90_000_000_000);
    }

    /// Every untied prize is a whole multiple of the entry, every rank past
    /// the paid line is worth zero, and the minimum field covers the prize
    /// pool exactly (break-even) at every size and tier.
    #[test]
    fn untied_prizes_are_whole_multiples_and_the_floor_is_break_even() {
        for &entry in TIER_ENTRY_LAMPORTS.iter() {
            for (k, table) in LADDER_TABLES.iter().enumerate() {
                let cap = POOL_CAPACITIES[k];
                let paid = cap / 4;
                for r in 1..=cap {
                    let a = place_amount(table, entry, r);
                    assert_eq!(a % entry, 0);
                    assert_eq!(a == 0, r > paid, "{cap}: rank {r}");
                }
                assert_eq!(
                    prize_pool(table, entry),
                    LADDER_MIN_SEATS[k] as u64 * entry,
                    "{cap}: the minimum field's entries equal the prize pool"
                );
            }
        }
    }

    /// D3-B split groups under the Ladder: the shapes the spec names, at
    /// every size and tier. Each × size + remainder reconstructs the group's
    /// combined worth exactly, and every k-way tie for first at every size
    /// conserves.
    #[test]
    fn split_groups_conserve_lamports_exactly() {
        for &entry in TIER_ENTRY_LAMPORTS.iter() {
            for (k, table) in LADDER_TABLES.iter().enumerate() {
                let cap = POOL_CAPACITIES[k];
                let paid = cap / 4;
                // Solo first.
                assert_eq!(split_group(table, entry, 1, 1), (table[0] as u64 * entry, 0));
                // Everyone tied: the whole prize pool, split.
                let (each, rem) = split_group(table, entry, 1, cap);
                assert_eq!(each as u128 * cap as u128 + rem as u128, prize_pool(table, entry) as u128);
                // A group entirely below the paid line is worth nothing.
                assert_eq!(split_group(table, entry, paid + 1, cap - paid), (0, 0));
                // Every k-way tie for first conserves 1st..kth.
                for g in 1..=cap {
                    let (each, rem) = split_group(table, entry, 1, g);
                    let want: u128 = (1..=g).map(|r| place_amount(table, entry, r) as u128).sum();
                    assert_eq!(each as u128 * g as u128 + rem as u128, want, "{cap}: {g}-way");
                    assert!(rem < g as u64);
                }
            }
        }
        // The spec's example: four tied across 15th–18th of 64 share 15th
        // and 16th (one entry each) — half an entry apiece, exactly.
        let e = TIER_ENTRY_LAMPORTS[0];
        assert_eq!(split_group(&LADDER_TABLES[3], e, 15, 4), (e / 2, 0));
        // A three-way tie for first of 8 at 0.1 SOL: (3 + 2 + 0) entries =
        // 0.5 SOL over three, two indivisible lamports to the lowest seat.
        assert_eq!(split_group(&LADDER_TABLES[0], e, 1, 3), (166_666_666, 2));
    }

    #[test]
    fn rank_zero_and_past_the_table_are_worth_nothing() {
        let t = LADDER_TABLES[3];
        assert_eq!(place_amount(&t, 1, 0), 0);
        assert_eq!(place_amount(&t, 1, 17), 0);
        assert_eq!(place_amount(&t, 1, u16::MAX), 0);
    }
}
