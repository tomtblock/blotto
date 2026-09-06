//! D1/D2/D3-B acceptance against the compiled artifact: a 0.75 SOL and a
//! 7.5 SOL pool fill and settle with the step report's exact band amounts
//! (vault drained to zero), and a tie-case pool settles a split-pot payout
//! list — an 18-seat paid set straddling position 17, with a visible
//! integer-division remainder going to the tied group's lowest seat.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

/// Pay every committed seat in batches of six and return the per-seat
/// lamport deltas, asserting the vault ends at exactly zero and the pool
/// lands in `Paid`.
fn pay_all_and_measure(
    env: &mut Env,
    pool_id: u64,
    players: &[(Keypair, Pubkey)],
    payouts: &[(u16, u64)],
) -> Vec<u64> {
    let settlement = env.settlement.insecure_clone();
    let before: Vec<u64> = payouts
        .iter()
        .map(|&(seat, _)| env.balance(&players[seat as usize].0.pubkey()))
        .collect();
    for chunk in payouts.chunks(6) {
        let seats: Vec<u16> = chunk.iter().map(|&(s, _)| s).collect();
        let metas: Vec<(Pubkey, Pubkey)> = chunk
            .iter()
            .map(|&(seat, _)| {
                let (p, e) = &players[seat as usize];
                (p.pubkey(), *e)
            })
            .collect();
        let ix = pay_prizes_ix(&settlement.pubkey(), pool_id, &seats, &metas);
        env.send(&[ix], &[&settlement]).expect("pay batch");
    }
    let pv = read_pool(&env.svm, &pool_pda(pool_id));
    assert_eq!(pv.state, 3, "Paid");
    assert_eq!(env.balance(&vault_pda(pool_id)), 0, "vault exactly zero");
    payouts
        .iter()
        .enumerate()
        .map(|(i, &(seat, _))| env.balance(&players[seat as usize].0.pubkey()) - before[i])
        .collect()
}

fn fill_and_reveal(env: &mut Env, pool_id: u64) -> Vec<(Keypair, Pubkey)> {
    let mut players = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(pool_id).unwrap());
    }
    let settlement = env.settlement.insecure_clone();
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), pool_id, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).expect("reveal");
    players
}

fn commit(env: &mut Env, pool_id: u64, payouts: &[(u16, u64)]) {
    let settlement = env.settlement.insecure_clone();
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(payouts));
    let ix = settle_ix(&settlement.pubkey(), pool_id, "commit_results", &args);
    env.send(&[ix], &[&settlement]).expect("commit_results");
}

#[test]
fn tier_2_and_tier_6_pools_settle_with_the_report_table_amounts() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 0, 1, 0, 0, 0, 1])],
        &[],
    )
    .unwrap();

    // ---- tier 2: 0.75 SOL entry, 38.4 SOL pot ----
    env.open_ready_pool(1, 2);
    let players = fill_and_reveal(&mut env, 1);
    let payouts = band_payouts(TIER_POTS[2]); // 38.4 SOL fixed pot
                                              // The step report's tier-2 prize table, to the lamport.
    let expected_t2: [u64; 16] = [
        10_125_000_000, // 1st: 10.125 SOL
        5_925_000_000,
        3_825_000_000,
        2_925_000_000,
        1_875_000_000,
        1_875_000_000,
        1_875_000_000,
        1_875_000_000,
        1_012_500_000,
        1_012_500_000,
        1_012_500_000,
        1_012_500_000,
        1_012_500_000,
        1_012_500_000,
        1_012_500_000,
        1_012_500_000,
    ];
    assert_eq!(payouts.iter().map(|&(_, a)| a).sum::<u64>(), 38_400_000_000);
    for (i, &(seat, amount)) in payouts.iter().enumerate() {
        assert_eq!((seat, amount), (i as u16, expected_t2[i]));
    }
    commit(&mut env, 1, &payouts);
    let deltas = pay_all_and_measure(&mut env, 1, &players, &payouts);
    assert_eq!(deltas, expected_t2.to_vec());

    // ---- tier 6: 7.5 SOL entry, 384 SOL pot ----
    // register_player's 10 SOL airdrop covers the entry; the pot maths scale
    // by exactly 10× the tier-2 numbers (7.5 = 10 × 0.75).
    env.open_ready_pool(2, 6);
    let players = fill_and_reveal(&mut env, 2);
    let payouts = band_payouts(TIER_POTS[6]); // 384 SOL fixed pot
    assert_eq!(
        payouts.iter().map(|&(_, a)| a).sum::<u64>(),
        384_000_000_000
    );
    let expected_t6: Vec<u64> = expected_t2.iter().map(|a| a * 10).collect();
    assert_eq!(payouts[0].1, 101_250_000_000, "1st: 101.25 SOL");
    for (i, &(seat, amount)) in payouts.iter().enumerate() {
        assert_eq!((seat, amount), (i as u16, expected_t6[i]));
    }
    commit(&mut env, 2, &payouts);
    let deltas = pay_all_and_measure(&mut env, 2, &players, &payouts);
    assert_eq!(deltas, expected_t6);
}

#[test]
fn tie_case_splits_the_pot_and_pays_a_paid_set_past_sixteen() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let players = fill_and_reveal(&mut env, 1);

    // Tier 0 pot = 4 SOL (D-E1), band unit = pot/1024 = 3_906_250 lamports.
    // Ranking fixture: seats 0..2 solo at ranks 1–3; seats 3–5 tied at
    // rank 4 (occupying positions 4–6, combined 78+50+50 = 178 units,
    // 695_312_500 / 3 = 231_770_833 rem 1 → the remainder goes to the tied
    // group's lowest seat); seats 6..14 solo at ranks 7–15; seats 15–17
    // tied at rank 16 (positions 16–18 — only position 16 is a paid band,
    // so the combined prize is 27 units split three ways). The paid set is
    // 18 seats: D3-B pays every tied member, past the 16-place table.
    let payouts: Vec<(u16, u64)> = vec![
        (0, 1_054_687_500),
        (1, 617_187_500),
        (2, 398_437_500),
        (3, 231_770_834), // tied 4th, +1 lamport remainder (lowest seat)
        (4, 231_770_833), // tied 4th
        (5, 231_770_833), // tied 4th
        (6, 195_312_500),
        (7, 195_312_500),
        (8, 105_468_750),
        (9, 105_468_750),
        (10, 105_468_750),
        (11, 105_468_750),
        (12, 105_468_750),
        (13, 105_468_750),
        (14, 105_468_750),
        (15, 35_156_250), // tied 16th: 105_468_750 / 3
        (16, 35_156_250), // tied 16th — position 17, still paid
        (17, 35_156_250), // tied 16th — position 18, still paid
    ];
    assert_eq!(
        payouts.iter().map(|&(_, a)| a).sum::<u64>(),
        4_000_000_000,
        "split-pot list conserves the pot exactly"
    );
    commit(&mut env, 1, &payouts);

    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!(pv.payouts, payouts, "committed list readable on-chain");

    let deltas = pay_all_and_measure(&mut env, 1, &players, &payouts);
    assert_eq!(
        deltas,
        payouts.iter().map(|&(_, a)| a).collect::<Vec<u64>>()
    );
    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!(pv.paid_mask, (1u64 << 18) - 1, "bits 0..17 set");

    // Seat 18 (position 19) is outside the paid set.
    let settlement = env.settlement.insecure_clone();
    let (p, e) = &players[18];
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[18], &[(p.pubkey(), *e)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    // The pool is already Paid, so the state gate fires first.
    assert!(
        err.contains("6027") || err.contains("6045"),
        "seat 18 must not be payable: {err}"
    );
}
