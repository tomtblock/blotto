//! D1/D2/D3-B acceptance under the Ladder (D-E19) against the compiled
//! artifact: a 0.75 SOL and a 7.5 SOL pool fill and settle with every paid
//! place receiving exactly its table amount (vault drained to its cushion),
//! and tie-case pools settle split payout lists — a three-way tie for first,
//! a tie STRADDLING the paid line with the visible indivisible remainder
//! going to the group's lowest seat, and the everyone-tied shape — with
//! nobody past the line paid.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

/// Pay every committed seat and return the per-seat lamport deltas,
/// asserting the vault ends at exactly its cushion and the pool lands in
/// `Paid`.
fn pay_all_and_measure(
    env: &mut Env,
    pool_id: u64,
    players: &[(Keypair, Pubkey)],
    payouts: &[(u16, u64)],
) -> Vec<u64> {
    let deltas = env.pay_all(pool_id, players, payouts);
    let pv = read_pool(&env.svm, &pool_pda(pool_id));
    assert_eq!(pv.state, 3, "Paid");
    assert_eq!(
        env.balance(&vault_pda(pool_id)),
        VAULT_RENT_CUSHION,
        "the pot has fully left; the rent cushion stays behind"
    );
    deltas
}

fn fill_and_reveal(env: &mut Env, pool_id: u64, capacity: u16) -> Vec<(Keypair, Pubkey)> {
    let players = env.register_n(pool_id, capacity);
    assert_eq!(
        read_pool(&env.svm, &pool_pda(pool_id)).state,
        1,
        "Sealed at capacity"
    );
    env.reveal(pool_id);
    players
}

#[test]
fn tier_2_and_tier_6_pools_pay_the_table_exactly() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 0, 1, 0, 0, 0, 1])],
        &[],
    )
    .unwrap();

    // ---- tier 2: 0.75 SOL entry, a 30 SOL prize pool (40 entries) ----
    env.open_ready_pool(1, 2);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).pot_lamports, TIER_POTS[2]);
    let players = fill_and_reveal(&mut env, 1, 64);
    let payouts = straight_payouts(&LADDER_TABLES[3], TIER_PRICES[2]);
    assert_eq!(payouts[0], (0, 9_000_000_000), "1st: 12 entries, 9 SOL");
    assert_eq!(payouts[15], (15, 750_000_000), "16th: one entry back");
    assert_eq!(payouts.iter().map(|&(_, a)| a).sum::<u64>(), TIER_POTS[2]);
    env.commit(1, [1u8; 32], &payouts).expect("commit");
    let deltas = pay_all_and_measure(&mut env, 1, &players, &payouts);
    assert_eq!(deltas, payouts.iter().map(|&(_, a)| a).collect::<Vec<_>>());

    // ---- tier 6: 7.5 SOL entry, a 300 SOL prize pool ----
    // register_player's 10 SOL airdrop covers the entry; every amount is
    // exactly 10× its tier-2 counterpart (7.5 = 10 × 0.75).
    env.open_ready_pool(2, 6);
    let players = fill_and_reveal(&mut env, 2, 64);
    let payouts = straight_payouts(&LADDER_TABLES[3], TIER_PRICES[6]);
    assert_eq!(
        payouts[0],
        (0, 90_000_000_000),
        "1st: 90 SOL, the largest prize in the grid"
    );
    assert_eq!(payouts.iter().map(|&(_, a)| a).sum::<u64>(), TIER_POTS[6]);
    env.commit(2, [1u8; 32], &payouts).expect("commit");
    let deltas = pay_all_and_measure(&mut env, 2, &players, &payouts);
    assert_eq!(deltas, payouts.iter().map(|&(_, a)| a).collect::<Vec<_>>());
}

/// Two tie shapes in one 64-player pool at 0.1 SOL:
///
///   - seats 0..2 tied for first share 1st–3rd (12 + 6 + 3 entries = 2.1
///     SOL), 0.7 SOL each, nothing left over;
///   - seats 14..16 tied across 15th–17th STRADDLE the paid line: they share
///     15th and 16th (one entry each) and the unpaid 17th — 0.2 SOL over
///     three, 66_666_666 each and the two indivisible lamports to seat 14,
///     the group's lowest entry index (D3-B, unchanged by D-E19);
///
/// and seat 17, ranked 18th, is outside the committed list altogether.
#[test]
fn ties_split_the_positions_they_occupy_and_pay_nobody_past_the_line() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let players = fill_and_reveal(&mut env, 1, 64);
    let entry = TIER_PRICES[0];

    let mut groups = vec![3u16];
    groups.extend(std::iter::repeat_n(1u16, 11)); // ranks 4..14
    groups.push(3); // ranks 15..17
    let payouts = ladder_payouts(&LADDER_TABLES[3], entry, &groups);
    assert_eq!(
        payouts.len(),
        17,
        "fourteen places plus the straddling three"
    );
    assert_eq!(
        &payouts[..3],
        &[(0, 700_000_000), (1, 700_000_000), (2, 700_000_000)]
    );
    assert_eq!(
        &payouts[14..],
        &[(14, 66_666_668), (15, 66_666_666), (16, 66_666_666)],
        "the remainder to the lowest seat of the straddling group"
    );
    assert_eq!(
        payouts.iter().map(|&(_, a)| a).sum::<u64>(),
        TIER_POTS[0],
        "the split list conserves the prize pool exactly"
    );
    env.commit(1, [1u8; 32], &payouts).expect("commit_results");
    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!(pv.payouts, payouts, "committed list readable on-chain");

    // Seat 17 (18th place) is outside the paid set — refused while the pool
    // is still Scored, so it is the list that says no, not the state gate.
    let settlement = env.settlement.insecure_clone();
    let (p, e) = &players[17];
    let ix = env.pay_ix(1, &[17], &[(p.pubkey(), *e)]);
    assert_refused(env.send(&[ix], &[&settlement]), "6045", "SeatNotInPayouts");

    let deltas = pay_all_and_measure(&mut env, 1, &players, &payouts);
    assert_eq!(
        deltas,
        payouts.iter().map(|&(_, a)| a).collect::<Vec<u64>>()
    );
    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!(pv.paid_mask, (1u64 << 17) - 1, "bits 0..16 set");
}

/// The spec's small-pool example: three tied for first of 8 at 0.1 SOL share
/// 1st and 2nd and the unpaid 3rd — (3 + 2 + 0) entries = 0.5 SOL over
/// three — 166_666_666 each, two lamports to the lowest seat.
#[test]
fn an_eight_player_three_way_tie_for_first_shares_the_whole_table() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool_sized(1, 0, MODE_EASY, 8);
    let players = fill_and_reveal(&mut env, 1, 8);
    let payouts = ladder_payouts(&LADDER_TABLES[0], TIER_PRICES[0], &[3]);
    assert_eq!(
        payouts,
        vec![(0, 166_666_668), (1, 166_666_666), (2, 166_666_666)]
    );
    env.commit(1, [1u8; 32], &payouts).expect("commit_results");
    let deltas = pay_all_and_measure(&mut env, 1, &players, &payouts);
    assert_eq!(deltas.iter().sum::<u64>(), 500_000_000);
}

/// The everyone-tied shape: 64 ways, exact at every tier (a 64-player prize
/// pool is 40 entries, and 40 × price / 64 is a whole number of lamports at
/// every launch price).
#[test]
fn a_sixty_four_way_tie_splits_the_pot_with_zero_remainder() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let players = fill_and_reveal(&mut env, 1, 64);
    let payouts = ladder_payouts(&LADDER_TABLES[3], TIER_PRICES[0], &[64]);
    assert_eq!(
        payouts.len(),
        64,
        "a tie across the whole field pays the whole field"
    );
    assert!(
        payouts.iter().all(|&(_, a)| a == 62_500_000),
        "4 SOL / 64 each"
    );
    env.commit(1, [1u8; 32], &payouts).expect("commit_results");
    let deltas = pay_all_and_measure(&mut env, 1, &players, &payouts);
    assert!(deltas.iter().all(|&d| d == 62_500_000));
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).paid_mask,
        u64::MAX,
        "all 64 bits"
    );
}
