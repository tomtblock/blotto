//! The full pool lifecycle against the compiled artifact: 64 entries, seal,
//! reveal, commit, payout — every lamport accounted for at the end.
//! (Roadmap 1.3–1.5 gates, run for real instead of asserted on a model.)
//! Under D-E2 the committed list is one seat — the winner — taking the pot.

use blotto_litesvm_tests::*;
use sha2::{Digest, Sha256};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const ENTRY: u64 = 100_000_000; // tier 0: 0.1 SOL
const POT: u64 = 4_000_000_000; // tier 0's FIXED pot (D-E1)

#[test]
fn full_lifecycle_pays_the_pot_to_the_lamport() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let pool = pool_pda(1);

    // ---- pot locked at open, BEFORE any entry (D-A1 revised) ----
    assert_eq!(env.balance(&vault_pda(1)), POT, "pot pre-funded at open");
    assert_eq!(read_pool(&env.svm, &pool).pot_lamports, POT);
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.platform_reserved, POT, "pot recorded as locked");
    assert_eq!(cfg.active_pool_by_tier[0], 1, "tier slot taken");
    let platform_at_open = env.balance(&platform_pda());
    let opened_deadline = read_pool(&env.svm, &pool).fill_deadline;

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

    // ---- sealed exactly at 64, bag empty, entries all in the treasury ----
    let pv = read_pool(&env.svm, &pool);
    assert_eq!(pv.entrants, 64);
    assert_eq!(pv.state, 1, "Sealed");
    assert_eq!(pv.class_counters, [0u16; 5], "bag empties exactly at seal");
    // D-E4: the 52nd seat started the go-timer — the deadline moved EARLIER
    // (the clock does not advance between registers in LiteSVM, so the
    // shortened value is exactly open-time + GO_TIMER_SECS) and never later.
    assert!(
        pv.fill_deadline < opened_deadline,
        "the go-timer shortened the deadline at the 52nd seat"
    );
    assert_eq!(
        env.balance(&vault_pda(1)),
        POT,
        "vault still holds the pot exactly"
    );
    assert_eq!(
        env.balance(&platform_pda()) - platform_at_open,
        64 * ENTRY,
        "treasury got 100% of every entry"
    );
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.platform_refundable, 0, "entries became revenue at seal");
    // SEQUENTIAL pools (D-A1 revised): sealing does NOT free the tier slot.
    assert_eq!(cfg.active_pool_by_tier[0], 1, "slot still held after seal");

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
    // D-E2: the committed payout list — seat 0 is this pool's ranking's
    // first place and takes the whole pot (no ties).
    let payouts = winner_payout(POT);
    let mut commit_args = [1u8; 32].to_vec();
    commit_args.extend_from_slice(&encode_payouts(&payouts));
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
    let pv = read_pool(&env.svm, &pool);
    assert_eq!(pv.state, 2, "Scored");
    assert_eq!(pv.payouts, payouts, "one committed seat, the whole pot");

    // ---- pay the winner ----
    let (winner, winner_entry) = &players[0];
    let before = env.balance(&winner.pubkey());
    let ix = pay_prizes_ix(
        &settlement.pubkey(),
        1,
        &[0],
        &[(winner.pubkey(), *winner_entry)],
    );
    env.send(&[ix], &[&settlement]).expect("pay the winner");

    // ---- the pot to the lamport, vault reaped to zero, state Paid ----
    assert_eq!(
        env.balance(&winner.pubkey()) - before,
        POT,
        "winner takes all"
    );
    let pv = read_pool(&env.svm, &pool);
    assert_eq!(pv.state, 3, "Paid");
    assert_eq!(pv.paid_mask, 0b1, "one bit: the winner's seat");
    assert_eq!(
        env.balance(&vault_pda(1)),
        0,
        "vault drained to exactly zero"
    );
    // Paid frees the tier slot and releases the pot from the book-keeping.
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.active_pool_by_tier[0], 0, "slot freed at Paid");
    assert_eq!(cfg.platform_reserved, 0, "pot released from reserved");

    // ---- second place is not in the paid set; double pay rejected ----
    let (p, e) = &players[1];
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[1], &[(p.pubkey(), *e)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    // Pool is Paid, so the state gate fires first.
    assert!(
        err.contains("6027") || err.contains("ResultsNotCommitted"),
        "{err}"
    );
}

/// Escrow under D-E2 is all-or-nothing per paid seat (proposal E1 §12): the
/// fixture uses a two-way tie for first so BOTH escrow paths — release and
/// forfeit — run against real paid seats in one pool.
#[test]
fn flagged_winners_escrow_then_release_and_forfeit() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let settlement = env.settlement.insecure_clone();

    // Flag both tied winners before payout.
    for (_, entry) in players.iter().take(2) {
        let ix = flag_ix(&settlement.pubkey(), 1, entry, "flag_entry");
        env.send(&[ix], &[&settlement]).expect("flag");
    }

    // Reveal + commit a two-way tie for first: seats 0 and 1, pot / 2 each.
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).unwrap();
    let payouts = tied_first_payouts(POT, 2);
    assert_eq!(payouts, vec![(0, POT / 2), (1, POT / 2)]);
    let mut commit_args = [1u8; 32].to_vec();
    commit_args.extend_from_slice(&encode_payouts(&payouts));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    env.send(&[ix], &[&settlement]).unwrap();

    // Pay both seats in one batch.
    let metas: Vec<(Pubkey, Pubkey)> = players[..2].iter().map(|(p, e)| (p.pubkey(), *e)).collect();
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0, 1], &metas);
    env.send(&[ix], &[&settlement]).expect("pay");

    // Both escrowed; their lamports still in the vault; the pool is Paid.
    let e1 = read_entry(&env.svm, &players[0].1);
    let e2 = read_entry(&env.svm, &players[1].1);
    assert_eq!(e1.escrow_lamports, POT / 2);
    assert_eq!(e2.escrow_lamports, POT / 2);
    assert_eq!(env.balance(&vault_pda(1)), POT);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");

    // Forfeiting an unflagged (no-escrow) entry: rejected.
    let ix = forfeit_escrow_ix(&settlement.pubkey(), 1, &players[2].1);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6036") || err.contains("NoEscrow"), "{err}");

    // Release seat 0's share to its player.
    let before = env.balance(&players[0].0.pubkey());
    let ix = release_escrow_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        &players[0].0.pubkey(),
    );
    env.send(&[ix], &[&settlement]).expect("release");
    assert_eq!(env.balance(&players[0].0.pubkey()) - before, POT / 2);

    // Forfeit seat 1's share (still flagged) to the platform treasury.
    let before = env.balance(&platform_pda());
    let ix = forfeit_escrow_ix(&settlement.pubkey(), 1, &players[1].1);
    env.send(&[ix], &[&settlement]).expect("forfeit");
    assert_eq!(env.balance(&platform_pda()) - before, POT / 2);

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
    let platform_before = env.balance(&platform_pda());
    let ix = trigger_refund_ix(&rando.pubkey(), 1);
    env.send(&[ix], &[&rando]).expect("trigger_refund");
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 4, "Refunding");
    // The untouched pot returned to the treasury; the vault reaped.
    assert_eq!(env.balance(&vault_pda(1)), 0, "pot returned at trigger");
    assert_eq!(
        env.balance(&platform_pda()) - platform_before,
        POT,
        "treasury got the pot back"
    );
    assert_eq!(read_config(&env.svm).platform_reserved, 0);

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
    let cfg = read_config(&env.svm);
    assert_eq!(
        cfg.platform_refundable, 0,
        "every refundable lamport repaid"
    );
    assert_eq!(cfg.active_pool_by_tier[0], 0, "slot freed at Closed");
}
