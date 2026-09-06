//! D1/D2/D3-B/D-E2 acceptance against the compiled artifact: a 0.75 SOL
//! and a 7.5 SOL pool fill and settle with the winner taking the exact pot
//! (vault drained to zero), and a tie-case pool settles a split-pot payout
//! list — a three-way tie for first, with the visible one-lamport remainder
//! going to the tied group's lowest seat, and nobody else paid.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

/// Pay every committed seat in one batch and return the per-seat lamport
/// deltas, asserting the vault ends at exactly zero and the pool lands in
/// `Paid`.
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
fn tier_2_and_tier_6_pools_pay_the_winner_the_exact_pot() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 0, 1, 0, 0, 0, 1])],
        &[],
    )
    .unwrap();

    // ---- tier 2: 0.75 SOL entry, 30 SOL pot (D-E1) ----
    env.open_ready_pool(1, 2);
    let players = fill_and_reveal(&mut env, 1);
    let payouts = winner_payout(TIER_POTS[2]);
    assert_eq!(payouts, vec![(0, 30_000_000_000)], "1st: 30 SOL, the pot");
    commit(&mut env, 1, &payouts);
    let deltas = pay_all_and_measure(&mut env, 1, &players, &payouts);
    assert_eq!(deltas, vec![30_000_000_000]);

    // ---- tier 6: 7.5 SOL entry, 300 SOL pot (D-E1) ----
    // register_player's 10 SOL airdrop covers the entry; the pot is exactly
    // 10× the tier-2 pot (7.5 = 10 × 0.75).
    env.open_ready_pool(2, 6);
    let players = fill_and_reveal(&mut env, 2);
    let payouts = winner_payout(TIER_POTS[6]);
    assert_eq!(payouts, vec![(0, 300_000_000_000)], "1st: 300 SOL, the pot");
    commit(&mut env, 2, &payouts);
    let deltas = pay_all_and_measure(&mut env, 2, &players, &payouts);
    assert_eq!(deltas, vec![300_000_000_000]);
}

#[test]
fn tie_for_first_splits_the_pot_and_pays_nobody_else() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let players = fill_and_reveal(&mut env, 1);

    // Tier 0 pot = 4 SOL (D-E1). Ranking fixture: seats 0..2 tied for first
    // — 4_000_000_000 / 3 = 1_333_333_333 remainder 1, the lamport to the
    // tied group's lowest seat (D3-B's remainder rule under D-E2, proposal
    // E1 §2.4); every other seat ranks below the paid line and is not in
    // the committed list at all.
    let payouts = tied_first_payouts(4_000_000_000, 3);
    assert_eq!(
        payouts,
        vec![(0, 1_333_333_334), (1, 1_333_333_333), (2, 1_333_333_333)]
    );
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
    assert_eq!(pv.paid_mask, 0b111, "bits 0..2 set");

    // Seat 3 (second place) is outside the paid set.
    let settlement = env.settlement.insecure_clone();
    let (p, e) = &players[3];
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[3], &[(p.pubkey(), *e)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    // The pool is already Paid, so the state gate fires first.
    assert!(
        err.contains("6027") || err.contains("6045"),
        "seat 3 must not be payable: {err}"
    );
}

/// The everyone-tied shape: 64 ways, exact at every tier (pot = price × 40
/// and every price is a whole number of hundredths of a SOL).
#[test]
fn a_sixty_four_way_tie_splits_the_pot_with_zero_remainder() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let players = fill_and_reveal(&mut env, 1);
    let payouts = tied_first_payouts(TIER_POTS[0], 64);
    assert!(
        payouts.iter().all(|&(_, a)| a == 62_500_000),
        "4 SOL / 64 each"
    );
    commit(&mut env, 1, &payouts);
    let deltas = pay_all_and_measure(&mut env, 1, &players, &payouts);
    assert!(deltas.iter().all(|&d| d == 62_500_000));
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).paid_mask,
        u64::MAX,
        "all 64 bits"
    );
}
