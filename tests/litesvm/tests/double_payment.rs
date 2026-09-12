//! `pay_prizes`' double-payment guards, fired against the COMPILED PROGRAM
//! (audit 2026-09-11, G-19 / G-07).
//!
//! # Why this file exists
//!
//! `pay_prizes.rs` carries two guards against paying one seat twice:
//!
//! ```ignore
//! require!(ctx.accounts.pool.paid_mask & bit == 0, ErrorCode::RankAlreadySettled);
//! require!(!entry.settled,                          ErrorCode::EntryAlreadySettled);
//! ```
//!
//! Neither had ever been reached by a test. The integration suite's two
//! second-payment attempts (`lifecycle.rs`, `min_field.rs`) both run against
//! a pool that has already reached `Paid`, where the FIRST line of the
//! handler — `pool.state == PoolState::Scored` — rejects them, and both
//! assertions accept `ResultsNotCommitted` accordingly. The only assertion in
//! the repository that names `RankAlreadySettled` is in `next_place.rs` and
//! exercises the *escrow* split's mask, in a different file, in a different
//! instruction.
//!
//! So the guards were present, correct by reading, and unexercised. The
//! money at stake is the whole pot: the seat's `amount` comes from the
//! committed list, and a second debit for the same seat drains a vault that
//! has no withdraw instruction and no way back.
//!
//! # How the guard is reached
//!
//! A pool with a TWO-WAY tie for first has two committed seats, so paying
//! one of them leaves the pool in `Scored` — the state gate opens, and the
//! mask guard is the next thing in the way. Two attempts are made in that
//! window:
//!
//!   1. a second batch naming the seat that was already paid;
//!   2. a single batch naming one seat TWICE, which is the shape a
//!      mis-built batch takes and which the mask must also refuse — the bit
//!      is set inside the loop, so the second element of the same batch sees
//!      it.
//!
//! Both must revert with `RankAlreadySettled` (6030), both must leave the
//! vault and the wallet untouched, and the pool must still be payable
//! afterwards by its remaining seat. That last part matters: a guard that
//! reverted the batch and also wedged the pool would strand the tier slot
//! and the reserved pot.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const POT: u64 = 4_000_000_000; // tier 0's FIXED pot (D-E1)

#[test]
fn a_seat_cannot_be_paid_twice_while_the_pool_is_still_payable() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let pool = pool_pda(1);

    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let settlement = env.settlement.insecure_clone();

    // A two-way tie for first: seats 0 and 1, half the pot each. Two
    // committed seats is what keeps the pool in `Scored` after the first
    // payment, which is the whole point — it is the window in which the
    // mask guard, rather than the state gate, is the thing saying no.
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).expect("reveal");

    let payouts = tied_first_payouts(POT, 2);
    assert_eq!(payouts, vec![(0, POT / 2), (1, POT / 2)]);
    let wallets: Vec<Pubkey> = players.iter().map(|(p, _)| p.pubkey()).collect();
    let (leaves, _ranks) = results_leaves(&wallets, &payouts);
    let root = merkle_root(&leaves);
    let mut commit_args = root.to_vec();
    commit_args.extend_from_slice(&encode_payouts(&payouts));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    env.send(&[ix], &[&settlement]).expect("commit_results");
    assert_eq!(read_pool(&env.svm, &pool).state, 2, "Scored");

    // ---- seat 0 is paid once ----
    let (w0, e0) = (&players[0].0, players[0].1);
    let (w1, e1) = (&players[1].0, players[1].1);
    let w0_before = env.balance(&w0.pubkey());
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0], &[(w0.pubkey(), e0)]);
    env.send(&[ix], &[&settlement]).expect("pay seat 0");
    assert_eq!(
        env.balance(&w0.pubkey()) - w0_before,
        POT / 2,
        "seat 0 takes its half"
    );

    let pv = read_pool(&env.svm, &pool);
    assert_eq!(pv.state, 2, "still Scored — seat 1 is unpaid");
    assert_eq!(pv.paid_mask, 0b01, "only seat 0's bit is set");
    let vault_after_first = env.balance(&vault_pda(1));
    let w0_after_first = env.balance(&w0.pubkey());

    // ---- THE GUARD, attempt 1: a second batch for the same seat ----
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0], &[(w0.pubkey(), e0)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6030") || err.contains("RankAlreadySettled"),
        "the state gate must NOT be what refuses this — the pool is Scored: {err}"
    );
    assert!(
        !err.contains("6027") && !err.contains("ResultsNotCommitted"),
        "this is the mis-attribution G-19 names: {err}"
    );
    assert_eq!(
        env.balance(&w0.pubkey()),
        w0_after_first,
        "not one lamport moved to the already-paid wallet"
    );
    assert_eq!(
        env.balance(&vault_pda(1)),
        vault_after_first,
        "not one lamport left the vault"
    );
    assert_eq!(read_pool(&env.svm, &pool).paid_mask, 0b01, "mask unchanged");

    // ---- THE GUARD, attempt 2: one batch naming the seat twice ----
    // The bit is set inside the loop, so the second element of the SAME
    // batch meets it. A guard that only compared against the mask as it
    // stood when the instruction started would pay this seat twice in one
    // transaction.
    let ix = pay_prizes_ix(
        &settlement.pubkey(),
        1,
        &[1, 1],
        &[(w1.pubkey(), e1), (w1.pubkey(), e1)],
    );
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6030") || err.contains("RankAlreadySettled"),
        "a seat repeated within one batch must be refused: {err}"
    );
    assert_eq!(
        read_pool(&env.svm, &pool).paid_mask,
        0b01,
        "the whole batch reverted; seat 1 is still unpaid"
    );
    assert!(
        !read_entry(&env.svm, &e1).settled,
        "seat 1's entry must not carry a settled flag from a reverted batch"
    );

    // ---- and the pool is still payable by its remaining seat ----
    // A guard that wedged the pool would strand the tier slot and the
    // reserved pot as surely as a double payment would drain the vault.
    let w1_before = env.balance(&w1.pubkey());
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[1], &[(w1.pubkey(), e1)]);
    env.send(&[ix], &[&settlement]).expect("pay seat 1");
    assert_eq!(env.balance(&w1.pubkey()) - w1_before, POT / 2);

    let pv = read_pool(&env.svm, &pool);
    assert_eq!(pv.state, 3, "Paid");
    assert_eq!(
        pv.paid_mask, 0b11,
        "both committed seats settled, once each"
    );
    assert_eq!(
        env.balance(&vault_pda(1)),
        VAULT_RENT_CUSHION,
        "the pot left exactly once; the rent cushion stays behind"
    );
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.active_pool_by_tier[0], 0, "slot freed at Paid");
    assert_eq!(cfg.platform_reserved, 0, "pot released from reserved");
}

/// The seat→wallet binding, in the same window. `pay_prizes` resolves the
/// recipient from the `Entry` account rather than from the batch, so a batch
/// that names the right seat with the wrong wallet must revert — not pay the
/// wrong person. Checked here rather than after `Paid`, for the same reason
/// as above: after `Paid` the state gate answers first and the binding is
/// never tested.
#[test]
fn a_batch_cannot_redirect_a_committed_seat_to_another_wallet() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);

    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let settlement = env.settlement.insecure_clone();

    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).expect("reveal");
    let payouts = tied_first_payouts(POT, 2);
    let wallets: Vec<Pubkey> = players.iter().map(|(p, _)| p.pubkey()).collect();
    let (leaves, _ranks) = results_leaves(&wallets, &payouts);
    let root = merkle_root(&leaves);
    let mut commit_args = root.to_vec();
    commit_args.extend_from_slice(&encode_payouts(&payouts));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    env.send(&[ix], &[&settlement]).expect("commit_results");

    let (w0, e0) = (&players[0].0, players[0].1);
    let stranger = &players[7].0;
    let stranger_before = env.balance(&stranger.pubkey());

    // Seat 0's Entry with seat 7's wallet: the program compares the wallet
    // against `entry.player`.
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0], &[(stranger.pubkey(), e0)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6031") || err.contains("WinnerMismatch"),
        "{err}"
    );
    assert_eq!(
        env.balance(&stranger.pubkey()),
        stranger_before,
        "nothing reached the substituted wallet"
    );

    // Seat 0's wallet with seat 1's Entry: the program compares
    // `entry.index` against the seat asked for.
    let e1 = players[1].1;
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0], &[(w0.pubkey(), e1)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6031")
            || err.contains("WinnerMismatch")
            || err.contains("6032")
            || err.contains("EntryMismatch"),
        "{err}"
    );
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).paid_mask,
        0,
        "nothing settled"
    );
}
