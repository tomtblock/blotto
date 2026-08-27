//! The full pool lifecycle against the compiled artifact: 64 entries, seal,
//! reveal, commit, batched payout — every lamport accounted for at the end.
//! (Roadmap 1.3–1.5 gates, run for real instead of asserted on a model.)

use blotto_litesvm_tests::*;
use sha2::{Digest, Sha256};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const ENTRY: u64 = 100_000_000; // tier 0: 0.1 SOL
const POT: u64 = 5_120_000_000; // 64 × 80%
const BANDS: [u64; 16] = [
    1_350_000_000,
    790_000_000,
    510_000_000,
    390_000_000,
    250_000_000,
    250_000_000,
    250_000_000,
    250_000_000,
    135_000_000,
    135_000_000,
    135_000_000,
    135_000_000,
    135_000_000,
    135_000_000,
    135_000_000,
    135_000_000,
];

#[test]
fn full_lifecycle_pays_the_pot_to_the_lamport() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let pool = pool_pda(1);

    // ---- 64 entries ----
    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for i in 0..64u16 {
        let (player, entry) = env
            .register_player(1)
            .unwrap_or_else(|e| panic!("register #{i} failed: {e}"));
        let view = read_entry(&env.svm, &entry);
        assert_eq!(view.index, i, "seat order");
        assert!(view.class < 5, "class index in range");
        players.push((player, entry));
    }

    // ---- sealed exactly at 64, bag empty, fees swept ----
    let pv = read_pool(&env.svm, &pool);
    assert_eq!(pv.entrants, 64);
    assert_eq!(pv.state, 1, "Sealed");
    assert_eq!(pv.class_counters, [0u16; 5], "bag empties exactly at seal");
    assert_eq!(env.balance(&vault_pda(1)), POT, "vault holds the 80% pot");
    assert_eq!(env.balance(&fees_pda(1)), 0, "fees PDA swept and reaped");
    assert_eq!(
        env.balance(&env.platform_wallet.clone()),
        64 * (ENTRY - ENTRY / 10 * 8),
        "platform got the 20%"
    );

    // ---- 65th entry rejected ----
    let err = env.register_player(1).unwrap_err();
    assert!(err.contains("6000") || err.contains("PoolNotOpen"), "{err}");

    // ---- the class distribution consumed the whole bag ----
    let mut counts = [0u16; 5];
    for (_, entry) in &players {
        counts[read_entry(&env.svm, entry).class as usize] += 1;
    }
    assert_eq!(counts, [38, 15, 7, 3, 1], "bag-without-replacement totals");

    // ---- commit before reveal is rejected ----
    let settlement = env.settlement.insecure_clone();
    let winners: Vec<Pubkey> = players.iter().take(16).map(|(p, _)| p.pubkey()).collect();
    let mut commit_args = [1u8; 32].to_vec();
    for w in &winners {
        commit_args.extend_from_slice(w.as_ref());
    }
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6025") || err.contains("SecretNotRevealed"),
        "{err}"
    );

    // ---- wrong secret rejected; right secret lands ----
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &[13u8; 32]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6023") || err.contains("WrongPoolSecret"),
        "{err}"
    );
    let secret = env.pool_secret;
    assert_eq!(
        <[u8; 32]>::from(Sha256::digest(secret)),
        env.sealing_secret_hash
    );
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).expect("reveal");

    // ---- commit results ----
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    env.send(&[ix], &[&settlement]).expect("commit_results");
    assert_eq!(read_pool(&env.svm, &pool).state, 2, "Scored");

    // ---- pay in four batches of four ----
    let before: Vec<u64> = winners.iter().map(|w| env.balance(w)).collect();
    for batch in 0u8..4 {
        let ranks: Vec<u8> = (1..=4u8).map(|r| batch * 4 + r).collect();
        let metas: Vec<(Pubkey, Pubkey)> = ranks
            .iter()
            .map(|&r| {
                let (p, e) = &players[(r - 1) as usize];
                (p.pubkey(), *e)
            })
            .collect();
        let ix = pay_prizes_ix(&settlement.pubkey(), 1, &ranks, &metas);
        env.send(&[ix], &[&settlement]).expect("pay batch");
    }

    // ---- every band exact, vault reaped to zero, state Paid ----
    for (i, w) in winners.iter().enumerate() {
        assert_eq!(
            env.balance(w) - before[i],
            BANDS[i],
            "rank {} band amount",
            i + 1
        );
    }
    let pv = read_pool(&env.svm, &pool);
    assert_eq!(pv.state, 3, "Paid");
    assert_eq!(pv.paid_mask, 0xFFFF);
    assert_eq!(
        env.balance(&vault_pda(1)),
        0,
        "vault drained to exactly zero"
    );

    // ---- double pay rejected ----
    let (p, e) = &players[0];
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[1], &[(p.pubkey(), *e)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    // Pool is Paid, so the state gate fires first.
    assert!(
        err.contains("6027") || err.contains("ResultsNotCommitted"),
        "{err}"
    );
}

#[test]
fn flagged_winner_escrows_then_releases_and_forfeits() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let settlement = env.settlement.insecure_clone();

    // Flag ranks 1 and 2 before payout.
    for (_, entry) in players.iter().take(2) {
        let ix = flag_ix(&settlement.pubkey(), 1, entry, "flag_entry");
        env.send(&[ix], &[&settlement]).expect("flag");
    }

    // Reveal + commit with players[0..16] as winners.
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).unwrap();
    let winners: Vec<Pubkey> = players.iter().take(16).map(|(p, _)| p.pubkey()).collect();
    let mut commit_args = [1u8; 32].to_vec();
    for w in &winners {
        commit_args.extend_from_slice(w.as_ref());
    }
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    env.send(&[ix], &[&settlement]).unwrap();

    // Pay all 16 in two batches.
    for half in 0u8..2 {
        let ranks: Vec<u8> = (1..=8u8).map(|r| half * 8 + r).collect();
        let metas: Vec<(Pubkey, Pubkey)> = ranks
            .iter()
            .map(|&r| {
                let (p, e) = &players[(r - 1) as usize];
                (p.pubkey(), *e)
            })
            .collect();
        let ix = pay_prizes_ix(&settlement.pubkey(), 1, &ranks, &metas);
        env.send(&[ix], &[&settlement]).expect("pay");
    }

    // Ranks 1 and 2 escrowed; their lamports still in the vault.
    let e1 = read_entry(&env.svm, &players[0].1);
    let e2 = read_entry(&env.svm, &players[1].1);
    assert_eq!(e1.escrow_lamports, BANDS[0]);
    assert_eq!(e2.escrow_lamports, BANDS[1]);
    assert_eq!(env.balance(&vault_pda(1)), BANDS[0] + BANDS[1]);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");

    // Forfeiting an unflagged (no-escrow) entry: rejected.
    let ix = forfeit_escrow_ix(&settlement.pubkey(), 1, &players[2].1, &env.platform_wallet);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6036") || err.contains("NoEscrow"), "{err}");

    // Release rank 1 to its player.
    let before = env.balance(&players[0].0.pubkey());
    let ix = release_escrow_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        &players[0].0.pubkey(),
    );
    env.send(&[ix], &[&settlement]).expect("release");
    assert_eq!(env.balance(&players[0].0.pubkey()) - before, BANDS[0]);

    // Forfeit rank 2 (still flagged) to the platform wallet.
    let before = env.balance(&env.platform_wallet.clone());
    let ix = forfeit_escrow_ix(&settlement.pubkey(), 1, &players[1].1, &env.platform_wallet);
    env.send(&[ix], &[&settlement]).expect("forfeit");
    assert_eq!(env.balance(&env.platform_wallet.clone()) - before, BANDS[1]);

    assert_eq!(env.balance(&vault_pda(1)), 0, "vault ends at exactly zero");
}

#[test]
fn refund_fork_returns_the_full_entry() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);

    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..3 {
        players.push(env.register_player(1).unwrap());
    }

    // Before the deadline: trigger rejected.
    let settlement = env.settlement.insecure_clone();
    let ix = trigger_refund_ix(&settlement.pubkey(), 1);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6012") || err.contains("DeadlineNotPassed"),
        "{err}"
    );

    // Past the deadline: registers reject, trigger lands (any signer).
    env.advance_time(72 * 3600 + 1);
    let err = env.register_player(1).unwrap_err();
    assert!(
        err.contains("6011") || err.contains("DeadlinePassed"),
        "{err}"
    );
    let rando = Keypair::new();
    env.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    let ix = trigger_refund_ix(&rando.pubkey(), 1);
    env.send(&[ix], &[&rando]).expect("trigger_refund");
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 4, "Refunding");

    // Refund all three — each gets the FULL 0.1 SOL back.
    for (player, entry) in &players {
        let before = env.balance(&player.pubkey());
        let ix = refund_ix(&rando.pubkey(), 1, entry, &player.pubkey());
        env.send(&[ix], &[&rando]).expect("refund");
        assert_eq!(
            env.balance(&player.pubkey()) - before,
            ENTRY,
            "R7 full refund"
        );
        // Second refund of the same entry rejected — AlreadyRefunded while
        // the pool is still Refunding; PoolNotRefunding once the last refund
        // closed it (the state gate fires first).
        let ix = refund_ix(&rando.pubkey(), 1, entry, &player.pubkey());
        let err = env.send(&[ix], &[&rando]).unwrap_err();
        assert!(err.contains("6035") || err.contains("6034"), "{err}");
    }

    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!(pv.state, 5, "Closed");
    assert_eq!(env.balance(&vault_pda(1)), 0);
    assert_eq!(env.balance(&fees_pda(1)), 0);
}
