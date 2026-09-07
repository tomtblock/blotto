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
    // Option A (2026-09-07): the deadline set at open is never rewritten —
    // not by the 52nd seat (the go-timer is gone), not by the 64th.
    assert_eq!(
        pv.fill_deadline, opened_deadline,
        "the fill deadline is set once at open and never moves"
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
/// fixture uses a two-way tie for first so the three escrow paths — release,
/// forfeit and next-place payout — run against real paid seats in one pool. Since
/// 2026-09-07 (founder ruling 4) a forfeit moves NOTHING and the share is
/// paid to the next eligible place; the treasury never sees it.
#[test]
fn flagged_winners_escrow_then_release_forfeit_and_next_place() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();

    // Flag both tied winners before payout.
    for (_, entry) in players.iter().take(2) {
        let ix = flag_ix(&settlement.pubkey(), 1, entry, "flag_entry");
        env.send(&[ix], &[&settlement]).expect("flag");
    }

    // Reveal + commit a two-way tie for first: seats 0 and 1, pot / 2 each,
    // under a REAL results root (next-place payout verifies against it).
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).unwrap();
    let payouts = tied_first_payouts(POT, 2);
    assert_eq!(payouts, vec![(0, POT / 2), (1, POT / 2)]);
    let wallets: Vec<Pubkey> = players.iter().map(|(p, _)| p.pubkey()).collect();
    let (leaves, ranks) = results_leaves(&wallets, &payouts);
    let mut commit_args = merkle_root(&leaves).to_vec();
    commit_args.extend_from_slice(&encode_payouts(&payouts));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    env.send(&[ix], &[&settlement]).unwrap();

    // Pay both seats in one batch.
    let metas: Vec<(Pubkey, Pubkey)> = players[..2].iter().map(|(p, e)| (p.pubkey(), *e)).collect();
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0, 1], &metas);
    let paid_at = env
        .svm
        .get_sysvar::<solana_sdk::clock::Clock>()
        .unix_timestamp;
    env.send(&[ix], &[&settlement]).expect("pay");

    // Both escrowed; their lamports still in the vault; the pool is Paid;
    // the auto-release clock started.
    let e1 = read_entry(&env.svm, &players[0].1);
    let e2 = read_entry(&env.svm, &players[1].1);
    assert_eq!(e1.escrow_lamports, POT / 2);
    assert_eq!(e2.escrow_lamports, POT / 2);
    assert_eq!(e1.escrowed_at, paid_at, "escrowed_at stamped at pay");
    assert!(!e1.forfeited && !e2.forfeited);
    assert_eq!(env.balance(&vault_pda(1)), POT);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");

    // Forfeiting an unflagged (no-escrow) entry: rejected.
    let ix = forfeit_escrow_ix(&admin, 1, &players[2].1);
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(err.contains("6036") || err.contains("NoEscrow"), "{err}");
    // The settlement signer cannot forfeit — admin only (prompt v2 §E.2).
    let ix = forfeit_escrow_ix(&settlement.pubkey(), 1, &players[1].1);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("2001") || err.contains("ConstraintHasOne"),
        "{err}"
    );

    // Release seat 0's share to its player (review cleared it).
    let before = env.balance(&players[0].0.pubkey());
    let ix = release_escrow_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        &players[0].0.pubkey(),
    );
    env.send(&[ix], &[&settlement]).expect("release");
    assert_eq!(env.balance(&players[0].0.pubkey()) - before, POT / 2);

    // Forfeit seat 1's share (still flagged): NOTHING moves — not to the
    // treasury, not anywhere. The entry is marked; the vault keeps the share.
    let platform_before = env.balance(&platform_pda());
    let ix = forfeit_escrow_ix(&admin, 1, &players[1].1);
    env.send(&[ix], &[]).expect("forfeit");
    assert_eq!(
        env.balance(&platform_pda()),
        platform_before,
        "no lamport reaches the operator"
    );
    assert_eq!(
        env.balance(&vault_pda(1)),
        POT / 2,
        "the share stays in the vault"
    );
    let e2 = read_entry(&env.svm, &players[1].1);
    assert!(e2.forfeited);
    assert_eq!(e2.escrow_lamports, POT / 2, "the claim is still recorded");
    // A forfeited share can no longer be released — by anyone, ever.
    let ix = release_escrow_ix(
        &settlement.pubkey(),
        1,
        &players[1].1,
        &players[1].0.pubkey(),
    );
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6057") || err.contains("EscrowForfeitedAlready"),
        "{err}"
    );
    let ix = forfeit_escrow_ix(&admin, 1, &players[1].1);
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(err.contains("6057"), "a second forfeit is refused: {err}");

    // Seat 1's share passes to the remaining eligible first-place player:
    // seat 0, whose review cleared (released). A group of ONE — the whole
    // share, seat 0 the lowest entry number — proven against the committed
    // root; no other committed seats exist to pass as peers.
    let proof = merkle_proof(&leaves, 0);
    assert_eq!(ranks[0], 1);
    let before = env.balance(&players[0].0.pubkey());
    let ix = pay_next_place_ix(
        &settlement.pubkey(),
        1,
        &players[1].1,
        &players[0].1,
        &players[0].0.pubkey(),
        1,
        POT / 2,
        &proof,
        1,
        true,
        &[],
    );
    env.send(&[ix], &[&settlement])
        .expect("pay onward to the cleared tied member");
    assert_eq!(
        env.balance(&players[0].0.pubkey()) - before,
        POT / 2,
        "the whole share"
    );
    let e1 = read_entry(&env.svm, &players[0].1);
    assert_eq!(e1.next_place_lamports, POT / 2);
    let e2 = read_entry(&env.svm, &players[1].1);
    assert_eq!(e2.escrow_lamports, 0);
    assert_eq!(
        (e2.split_total, e2.split_group_size, e2.split_paid_mask),
        (POT / 2, 1, 1)
    );
    assert!(e2.split_remainder_paid);
    assert_eq!(env.balance(&vault_pda(1)), 0, "vault ends at exactly zero");
    assert_eq!(
        env.balance(&platform_pda()),
        platform_before,
        "still nothing to the operator"
    );
    // And the same share cannot be paid onward twice.
    let ix = pay_next_place_ix(
        &settlement.pubkey(),
        1,
        &players[1].1,
        &players[0].1,
        &players[0].0.pubkey(),
        1,
        POT / 2,
        &proof,
        1,
        true,
        &[],
    );
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6036") || err.contains("NoEscrow"), "{err}");
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

    // Past the deadline (12 h at launch — `Config.fill_deadline_seconds`):
    // registers reject, trigger lands (any signer).
    env.advance_time(12 * 3600 + 1);
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

/// PHASE 2 STAGE F — a sanctions hold blocks every route to the money.
///
/// The published sentence is that we check the WINNING wallet against
/// published sanctions lists during resolving. What that needs on-chain is a
/// hold that survives the two things an integrity flag does not survive: the
/// seven-day permissionless release, and the next-place split. This test is
/// that property, end to end, against the real program.
#[test]
fn a_sanctions_hold_blocks_both_release_paths_and_the_next_place_split() {
    const AUTO_RELEASE_SECS: i64 = 7 * 24 * 60 * 60;
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();

    // A two-way tie for first, so the split has somewhere to go — seat 0 is
    // the wallet that will match a list, seat 1 its co-winner.
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).unwrap();
    let payouts = tied_first_payouts(POT, 2);
    let wallets: Vec<Pubkey> = players.iter().map(|(p, _)| p.pubkey()).collect();
    let (leaves, _ranks) = results_leaves(&wallets, &payouts);
    let mut commit_args = merkle_root(&leaves).to_vec();
    commit_args.extend_from_slice(&encode_payouts(&payouts));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    env.send(&[ix], &[&settlement]).unwrap();

    // Flag BOTH tied winners so their shares are ESCROWED at payout. Here
    // the flags are the mechanism because this test is about what a hold
    // does to a share ALREADY in escrow; that a hold escrows a share by
    // itself is the next test's property.
    for (_, entry) in players.iter().take(2) {
        let ix = flag_ix(&settlement.pubkey(), 1, entry, "flag_entry");
        env.send(&[ix], &[&settlement]).expect("flag");
    }
    let metas: Vec<(Pubkey, Pubkey)> = players[..2].iter().map(|(p, e)| (p.pubkey(), *e)).collect();
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0, 1], &metas);
    env.send(&[ix], &[&settlement]).expect("pay");
    assert_eq!(read_entry(&env.svm, &players[0].1).escrow_lamports, POT / 2);

    // The screening comes back a match: place the hold. Settlement-signed,
    // and allowed AFTER settlement — unlike `flag_entry`.
    let ix = sanctions_hold_ix(&admin, 1, &players[0].1, "place_sanctions_hold");
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(
        err.contains("2001") || err.contains("ConstraintHasOne"),
        "placing is the settlement signer's, not the admin's: {err}"
    );
    let ix = sanctions_hold_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        "place_sanctions_hold",
    );
    env.send(&[ix], &[&settlement])
        .expect("place_sanctions_hold");
    assert!(read_entry(&env.svm, &players[0].1).sanctions_hold);
    // Twice is refused, so a double placement is visible rather than silent.
    let ix = sanctions_hold_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        "place_sanctions_hold",
    );
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6065") || err.contains("SanctionsHoldActive"),
        "{err}"
    );

    // ---- Route 1: the reviewed release. Refused. -------------------------
    let ix = release_escrow_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        &players[0].0.pubkey(),
    );
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6065") || err.contains("SanctionsHoldActive"),
        "{err}"
    );

    // ---- Route 2: the seven-day permissionless release. Also refused. ----
    // This is the one an integrity flag does NOT survive, and the reason the
    // hold could not simply reuse `flag_entry`.
    env.advance_time(AUTO_RELEASE_SECS + 1);
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    let ix = release_escrow_ix(&stranger.pubkey(), 1, &players[0].1, &players[0].0.pubkey());
    let err = env.send(&[ix], &[&stranger]).unwrap_err();
    assert!(
        err.contains("6065") || err.contains("SanctionsHoldActive"),
        "the auto-release must not pay a listed wallet: {err}"
    );
    assert_eq!(
        read_entry(&env.svm, &players[0].1).escrow_lamports,
        POT / 2,
        "the share is still in the vault"
    );

    // ---- Route 3: as a RECIPIENT of someone else's forfeited share. ------
    // Seat 1's flag is upheld, so its half is divided among the eligible
    // players ranked first. Seat 0 is the only other first-place seat and is
    // not forfeited, so without the sanctions clause in `eligible()` it would
    // be the recipient — the split would pay a listed wallet.
    let ix = forfeit_escrow_ix(&admin, 1, &players[1].1);
    env.send(&[ix], &[]).expect("forfeit seat 1");
    let peers: Vec<Pubkey> = vec![];
    let ix = pay_next_place_ix(
        &settlement.pubkey(),
        1,
        &players[1].1,
        &players[0].1,
        &players[0].0.pubkey(),
        1,
        POT / 2,
        &merkle_proof(&leaves, 0),
        1,
        true,
        &peers,
    );
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6058") || err.contains("NextPlaceIneligible"),
        "a held wallet must not receive a forfeited share: {err}"
    );

    // ---- The lift: admin only, and it restores the ordinary path. --------
    let ix = sanctions_hold_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        "lift_sanctions_hold",
    );
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("2001") || err.contains("ConstraintHasOne"),
        "lifting is the admin's: {err}"
    );
    let ix = sanctions_hold_ix(&admin, 1, &players[0].1, "lift_sanctions_hold");
    env.send(&[ix], &[]).expect("lift_sanctions_hold");
    assert!(!read_entry(&env.svm, &players[0].1).sanctions_hold);
    // Lifting twice is refused.
    let ix = sanctions_hold_ix(&admin, 1, &players[0].1, "lift_sanctions_hold");
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(
        err.contains("6066") || err.contains("NoSanctionsHold"),
        "{err}"
    );

    // With the hold gone the seven-day safeguard works again, and the player
    // is paid — a false positive costs the player time, never the prize.
    let before = env.balance(&players[0].0.pubkey());
    let ix = release_escrow_ix(&stranger.pubkey(), 1, &players[0].1, &players[0].0.pubkey());
    env.send(&[ix], &[&stranger])
        .expect("release after the lift");
    assert_eq!(env.balance(&players[0].0.pubkey()) - before, POT / 2);
    assert_eq!(read_entry(&env.svm, &players[0].1).escrow_lamports, 0);
}


/// A hold placed BEFORE payment diverts the share into escrow on its own.
///
/// This is the clause that makes every other check in the previous test
/// reachable. `release_escrow` and `pay_next_place` both only ever see money
/// that is already escrowed, so without `pay_prizes` escrowing on the hold a
/// screened-and-matched winner would simply be paid out of the vault and the
/// hold would guard nothing. The unheld co-winner in the same batch is paid
/// normally, which is the other half of the property: one wallet is held, the
/// pool still settles.
#[test]
fn a_sanctions_hold_escrows_the_share_at_payout_without_any_flag() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let settlement = env.settlement.insecure_clone();

    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).unwrap();
    let payouts = tied_first_payouts(POT, 2);
    let wallets: Vec<Pubkey> = players.iter().map(|(p, _)| p.pubkey()).collect();
    let (leaves, _ranks) = results_leaves(&wallets, &payouts);
    let mut commit_args = merkle_root(&leaves).to_vec();
    commit_args.extend_from_slice(&encode_payouts(&payouts));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    env.send(&[ix], &[&settlement]).unwrap();

    // Seat 0 matched a list during resolving. The crank places the hold in
    // the same pass that scored the pool — before it pays. No flag: nothing
    // about a list membership is a finding against the competition.
    let ix = sanctions_hold_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        "place_sanctions_hold",
    );
    env.send(&[ix], &[&settlement])
        .expect("place_sanctions_hold");
    assert!(!read_entry(&env.svm, &players[0].1).flagged);

    let held_before = env.balance(&players[0].0.pubkey());
    let free_before = env.balance(&players[1].0.pubkey());
    let metas: Vec<(Pubkey, Pubkey)> = players[..2].iter().map(|(p, e)| (p.pubkey(), *e)).collect();
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0, 1], &metas);
    env.send(&[ix], &[&settlement]).expect("pay");

    // The held seat: settled, escrowed, not a lamport moved.
    let held = read_entry(&env.svm, &players[0].1);
    assert!(held.settled, "the seat settles — the batch must not revert");
    assert_eq!(held.escrow_lamports, POT / 2, "the share is escrowed");
    assert_eq!(
        env.balance(&players[0].0.pubkey()),
        held_before,
        "a held wallet receives nothing at payout"
    );

    // The co-winner: paid in the same batch, unaffected.
    assert_eq!(
        env.balance(&players[1].0.pubkey()) - free_before,
        POT / 2,
        "the unheld co-winner is paid normally"
    );
    assert_eq!(read_entry(&env.svm, &players[1].1).escrow_lamports, 0);

    // And the pool reached Paid, so the tier's slot is freed and the pot
    // leaves `platform_reserved`: one held wallet must not strand a tier.
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
}
