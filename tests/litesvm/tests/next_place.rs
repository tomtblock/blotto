//! Founder ruling 4 (2026-09-07) and addendum ruling 3 against the compiled
//! artifact: the vault pays (i) first place, (ii) if first place is not
//! eligible, the next eligible place, (iii) refunds below the minimum field
//! — a forfeited share never reaches the operator, and it is divided
//! EQUALLY among the eligible players at the rank it passes to, with the
//! indivisible remainder to the lowest entry number.
//!
//!   - the payout waits for Paid, needs a forfeited source, and pays one
//!     member per call, idempotent per member, summing to the share exactly;
//!   - at first place the group is on-chain: the program computes the
//!     eligible set, its size and its lowest seat from the committed seats'
//!     Entries and refuses arguments that disagree; a pending review blocks
//!     the split rather than being paid past;
//!   - at the next rank each member is proven by a Merkle proof; the group
//!     size is the settlement signer's assertion, fixed by the first payment
//!     and checked by every later one, and the remainder cannot be stranded;
//!   - a wrong rank, a forged proof, a flagged target and a stranger's
//!     signature are refused;
//!   - the seven-day auto-release: a random keypair pays an un-forfeited
//!     hold once the window passes, never before, never once forfeited.

use blotto_litesvm_tests::*;
use solana_sdk::clock::Clock;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const POT: u64 = 4_000_000_000; // tier 0 (D-E1)
const AUTO_RELEASE_SECS: i64 = 7 * 24 * 60 * 60; // ESCROW_AUTO_RELEASE_SECS

struct Scene {
    players: Vec<(Keypair, Pubkey)>,
    leaves: Vec<Vec<u8>>,
    payouts: Vec<(u16, u64)>,
}

/// A 64-seat pool with a k-way tie for first (seats 0..k), every tied seat
/// flagged before payout so every share escrows; committed under a real
/// results root whose unpaid seats hold ranks `1 + k, 2 + k, …` in seat
/// order, EXCEPT that the seats in `next_rank_group` all share rank
/// `1 + k` (a tie at the next competition rank). `pay` lists the seats to
/// settle (→ Paid when it is the whole group).
fn tied_pool(env: &mut Env, k: u16, next_rank_group: &[u16], pay: &[u16]) -> Scene {
    env.open_ready_pool(1, 0);
    let players: Vec<(Keypair, Pubkey)> =
        (0..64).map(|_| env.register_player(1).unwrap()).collect();
    let settlement = env.settlement.insecure_clone();
    for (_, entry) in players.iter().take(k as usize) {
        let ix = flag_ix(&settlement.pubkey(), 1, entry, "flag_entry");
        env.send(&[ix], &[&settlement]).unwrap();
    }
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).unwrap();
    let payouts = tied_first_payouts(POT, k);
    // Leaves: the tie for first, then the next-rank group at rank 1 + k,
    // then the rest one rank each.
    let mut next_rank = 1 + k as usize + usize::from(!next_rank_group.is_empty());
    let leaves: Vec<Vec<u8>> = players
        .iter()
        .enumerate()
        .map(|(seat, (p, _))| {
            if (seat as u16) < k {
                leaf_bytes(&p.pubkey(), 1, payouts[seat].1)
            } else if next_rank_group.contains(&(seat as u16)) {
                leaf_bytes(&p.pubkey(), 1 + k as u8, 0)
            } else {
                let r = next_rank as u8;
                next_rank += 1;
                leaf_bytes(&p.pubkey(), r, 0)
            }
        })
        .collect();
    let mut args = merkle_root(&leaves).to_vec();
    args.extend_from_slice(&encode_payouts(&payouts));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &args);
    env.send(&[ix], &[&settlement]).unwrap();
    if !pay.is_empty() {
        let metas: Vec<(Pubkey, Pubkey)> = pay
            .iter()
            .map(|&s| (players[s as usize].0.pubkey(), players[s as usize].1))
            .collect();
        let ix = pay_prizes_ix(&settlement.pubkey(), 1, pay, &metas);
        env.send(&[ix], &[&settlement]).unwrap();
    }
    Scene {
        players,
        leaves,
        payouts,
    }
}

fn forfeit(env: &mut Env, scene: &Scene, seat: usize) {
    let admin = env.admin.pubkey();
    env.send(&[forfeit_escrow_ix(&admin, 1, &scene.players[seat].1)], &[])
        .expect("forfeit");
}

fn release(env: &mut Env, scene: &Scene, seat: usize) {
    let settlement = env.settlement.insecure_clone();
    let (p, e) = &scene.players[seat];
    env.send(
        &[release_escrow_ix(&settlement.pubkey(), 1, e, &p.pubkey())],
        &[&settlement],
    )
    .expect("release");
}

/// Every committed seat except `from` and `to`, ascending — the peers the
/// instruction demands.
fn peers(scene: &Scene, from: usize, to: usize) -> Vec<Pubkey> {
    scene
        .payouts
        .iter()
        .map(|&(s, _)| s as usize)
        .filter(|&s| s != from && s != to)
        .map(|s| scene.players[s].1)
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn pay(
    env: &mut Env,
    scene: &Scene,
    from: usize,
    to: usize,
    rank: u8,
    amount: u64,
    group_size: u16,
    takes_remainder: bool,
) -> Result<u64, String> {
    let settlement = env.settlement.insecure_clone();
    let proof = merkle_proof(&scene.leaves, to);
    let before = env.balance(&scene.players[to].0.pubkey());
    let ix = pay_next_place_ix(
        &settlement.pubkey(),
        1,
        &scene.players[from].1,
        &scene.players[to].1,
        &scene.players[to].0.pubkey(),
        rank,
        amount,
        &proof,
        group_size,
        takes_remainder,
        &peers(scene, from, to),
    );
    env.send(&[ix], &[&settlement])?;
    Ok(env.balance(&scene.players[to].0.pubkey()) - before)
}

fn assert_err(r: Result<u64, String>, code: &str, name: &str) {
    let err = r.expect_err(name);
    assert!(
        err.contains(code) || err.contains(name),
        "expected {name}: {err}"
    );
}

#[test]
fn a_forfeited_first_place_share_splits_equally_among_the_eligible_tied_players() {
    let Some(mut env) = Env::new() else { return };
    // Three tied for first: seat 0 committed 1_333_333_334 (the remainder),
    // seats 1 and 2 committed 1_333_333_333 each.
    let scene = tied_pool(&mut env, 3, &[], &[0, 1, 2]);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
    assert_eq!(
        scene.payouts,
        vec![(0, 1_333_333_334), (1, 1_333_333_333), (2, 1_333_333_333)]
    );
    let platform_before = env.balance(&platform_pda());

    // Review: seat 1 upheld (forfeited); seats 0 and 2 still under review —
    // the split waits for them.
    forfeit(&mut env, &scene, 1);
    assert_err(
        pay(&mut env, &scene, 1, 0, 1, 1_333_333_334, 2, true),
        "6066",
        "NextPlaceReviewPending",
    );
    release(&mut env, &scene, 0);
    assert_err(
        pay(&mut env, &scene, 1, 0, 1, 1_333_333_334, 2, true),
        "6066",
        "NextPlaceReviewPending",
    );
    release(&mut env, &scene, 2);

    // Both cleared: the eligible first-place group is {0, 2}, n = 2, the
    // remainder to seat 0. Arguments that disagree with the group fail.
    let share = 1_333_333_333u64;
    assert_err(
        pay(&mut env, &scene, 1, 0, 1, 1_333_333_334, 1, true),
        "6067",
        "NextPlaceSplitMismatch",
    );
    assert_err(
        pay(&mut env, &scene, 1, 0, 1, 1_333_333_334, 3, true),
        "6067",
        "NextPlaceSplitMismatch",
    );
    assert_err(
        pay(&mut env, &scene, 1, 0, 1, 1_333_333_334, 2, false),
        "6067",
        "NextPlaceSplitMismatch",
    );
    assert_err(
        pay(&mut env, &scene, 1, 2, 1, 1_333_333_333, 2, true),
        "6067",
        "NextPlaceSplitMismatch",
    );
    // Seat 0 takes its portion plus the one-lamport remainder.
    let got0 = pay(&mut env, &scene, 1, 0, 1, 1_333_333_334, 2, true).expect("seat 0's portion");
    assert_eq!(got0, share / 2 + 1);
    let e1 = read_entry(&env.svm, &scene.players[1].1);
    assert_eq!(e1.split_total, share);
    assert_eq!(e1.split_group_size, 2);
    assert_eq!(e1.split_paid_mask, 1 << 0);
    assert!(e1.split_remainder_paid);
    assert_eq!(e1.escrow_lamports, share - got0);
    // Paying seat 0 again is refused; the group size cannot change now.
    assert_err(
        pay(&mut env, &scene, 1, 0, 1, 1_333_333_334, 2, true),
        "6030",
        "RankAlreadySettled",
    );
    assert_err(
        pay(&mut env, &scene, 1, 2, 1, 1_333_333_333, 2, true),
        "6067",
        "NextPlaceSplitMismatch",
    );
    // Seat 2 takes the other half; the share is exhausted to the lamport.
    let got2 = pay(&mut env, &scene, 1, 2, 1, 1_333_333_333, 2, false).expect("seat 2's portion");
    assert_eq!(got2, share / 2);
    assert_eq!(got0 + got2, share, "the portions sum to the share exactly");
    let e1 = read_entry(&env.svm, &scene.players[1].1);
    assert_eq!(e1.escrow_lamports, 0);
    assert_eq!(e1.split_paid_mask, 0b101);
    assert_eq!(
        read_entry(&env.svm, &scene.players[0].1).next_place_lamports,
        got0
    );
    assert_eq!(
        read_entry(&env.svm, &scene.players[2].1).next_place_lamports,
        got2
    );
    assert_eq!(env.balance(&vault_pda(1)), 0, "the vault reaps");
    assert_eq!(
        env.balance(&platform_pda()),
        platform_before,
        "the operator got nothing"
    );
    assert_err(
        pay(&mut env, &scene, 1, 2, 1, 1_333_333_333, 2, false),
        "6036",
        "NoEscrow",
    );
}

#[test]
fn when_no_first_place_player_is_eligible_the_share_splits_at_the_next_rank() {
    let Some(mut env) = Env::new() else { return };
    // Three tied for first, all to be forfeited; seats 3 and 4 tie at the
    // next competition rank (4).
    let scene = tied_pool(&mut env, 3, &[3, 4], &[0, 1, 2]);
    let platform_before = env.balance(&platform_pda());
    forfeit(&mut env, &scene, 0);
    // Seats 1 and 2 still under review: the next rank is not reached yet.
    assert_err(
        pay(&mut env, &scene, 0, 3, 4, 0, 2, true),
        "6066",
        "NextPlaceReviewPending",
    );
    forfeit(&mut env, &scene, 1);
    forfeit(&mut env, &scene, 2);

    // Seat 1's share (1_333_333_333) → the rank-4 group of two: per
    // 666_666_666, remainder 1 to the lowest entry number (seat 3, the
    // signer's assertion at this rank — disclosed).
    let share = 1_333_333_333u64;
    // A first-place rank for a next-rank seat, or the wrong next rank, fails
    // the proof; a rank-1 claim for a committed seat that is forfeited fails
    // eligibility.
    assert_err(
        pay(&mut env, &scene, 1, 3, 1, 0, 2, true),
        "6061",
        "InvalidMerkleProof",
    );
    assert_err(
        pay(&mut env, &scene, 1, 3, 5, 0, 2, true),
        "6061",
        "InvalidMerkleProof",
    );
    assert_err(
        pay(&mut env, &scene, 1, 2, 1, 1_333_333_333, 1, true),
        "6060",
        "NextPlaceIneligible",
    );
    // Seat 4 first, without the remainder: a plain portion.
    let got4 = pay(&mut env, &scene, 1, 4, 4, 0, 2, false).expect("seat 4's portion");
    assert_eq!(got4, share / 2);
    // The group size is now fixed for this share, and the remainder cannot
    // be left stranded: the LAST member's payment must empty the share, so
    // seat 3 without the remainder flag is refused.
    assert_err(
        pay(&mut env, &scene, 1, 3, 4, 0, 3, true),
        "6067",
        "NextPlaceSplitMismatch",
    );
    assert_err(
        pay(&mut env, &scene, 1, 3, 4, 0, 2, false),
        "6067",
        "NextPlaceSplitMismatch",
    );
    let got3 = pay(&mut env, &scene, 1, 3, 4, 0, 2, true).expect("seat 3's portion + remainder");
    assert_eq!(got3, share / 2 + 1);
    assert_eq!(got3 + got4, share);
    // The remainder was spent: nothing more can claim it.
    assert_err(
        pay(&mut env, &scene, 1, 3, 4, 0, 2, true),
        "6036",
        "NoEscrow",
    );
    assert_eq!(read_entry(&env.svm, &scene.players[1].1).escrow_lamports, 0);

    // Seat 0's share (1_333_333_334, remainder 0 over two): the last member's
    // payment must empty the share — paying seat 4 first without the
    // remainder flag is fine, then seat 3 closes it.
    let share0 = 1_333_333_334u64;
    let a = pay(&mut env, &scene, 0, 4, 4, 0, 2, false).expect("seat 4 first");
    assert_eq!(a, share0 / 2);
    let b = pay(&mut env, &scene, 0, 3, 4, 0, 2, true).expect("seat 3 closes the share");
    assert_eq!(a + b, share0);
    // Seat 2's share: a signer asserting a group of ONE pays it whole to one
    // member — the under-presentation the addendum discloses. On-chain it
    // is a valid call; the published bundle is what makes it visible.
    let whole = pay(&mut env, &scene, 2, 3, 4, 0, 1, true).expect("asserted group of one");
    assert_eq!(whole, share);

    assert_eq!(env.balance(&vault_pda(1)), 0, "the vault reaps");
    assert_eq!(
        env.balance(&platform_pda()),
        platform_before,
        "the operator got nothing"
    );
    let e3 = read_entry(&env.svm, &scene.players[3].1);
    assert!(
        e3.settled,
        "a paid next-rank seat is settled (its flag window closes)"
    );
    assert_eq!(e3.next_place_lamports, got3 + b + whole);
    assert_eq!(
        read_entry(&env.svm, &scene.players[4].1).next_place_lamports,
        got4 + a
    );
}

#[test]
fn the_payout_refuses_a_flagged_target_a_stranger_and_a_forged_proof() {
    let Some(mut env) = Env::new() else { return };
    let scene = tied_pool(&mut env, 2, &[], &[0, 1]);
    let settlement = env.settlement.insecure_clone();
    forfeit(&mut env, &scene, 0);
    forfeit(&mut env, &scene, 1);

    // Seat 3 holds rank 4: not first, not the next rank (3) — refused with a
    // valid proof of ITS rank.
    assert_err(
        pay(&mut env, &scene, 0, 3, 4, 0, 1, true),
        "6059",
        "NextPlaceRankInvalid",
    );
    // A tampered proof (one side bit flipped) fails.
    let mut forged = merkle_proof(&scene.leaves, 2);
    forged[0].1 = !forged[0].1;
    let ix = pay_next_place_ix(
        &settlement.pubkey(),
        1,
        &scene.players[0].1,
        &scene.players[2].1,
        &scene.players[2].0.pubkey(),
        3,
        0,
        &forged,
        1,
        true,
        &peers(&scene, 0, 2),
    );
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6061"), "{err}");
    // The wrong amount in the leaf fails (the leaf is verified as committed;
    // the paid amount is the portion, never the leaf).
    assert_err(
        pay(&mut env, &scene, 0, 2, 3, 1, 1, true),
        "6061",
        "InvalidMerkleProof",
    );
    // A stranger cannot pay the next place.
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ix = pay_next_place_ix(
        &stranger.pubkey(),
        1,
        &scene.players[0].1,
        &scene.players[2].1,
        &scene.players[2].0.pubkey(),
        3,
        0,
        &merkle_proof(&scene.leaves, 2),
        1,
        true,
        &peers(&scene, 0, 2),
    );
    let err = env.send(&[ix], &[&stranger]).unwrap_err();
    assert!(
        err.contains("2001") || err.contains("ConstraintHasOne"),
        "{err}"
    );
    // A flagged (unsettled) target is under review: refused. Cleared, it is
    // eligible again.
    let ix = flag_ix(&settlement.pubkey(), 1, &scene.players[2].1, "flag_entry");
    env.send(&[ix], &[&settlement]).unwrap();
    assert_err(
        pay(&mut env, &scene, 0, 2, 3, 0, 1, true),
        "6066",
        "NextPlaceReviewPending",
    );
    let ix = flag_ix(&settlement.pubkey(), 1, &scene.players[2].1, "clear_flag");
    env.send(&[ix], &[&settlement]).unwrap();
    let got = pay(&mut env, &scene, 0, 2, 3, 0, 1, true).expect("cleared target");
    assert_eq!(got, POT / 2);
    // The source must be forfeited: seat 2 (no escrow, not forfeited) is not.
    assert_err(
        pay(&mut env, &scene, 2, 3, 4, 0, 1, true),
        "6058",
        "EscrowNotForfeited",
    );
}

#[test]
fn the_payout_waits_for_paid() {
    let Some(mut env) = Env::new() else { return };
    // Pay seat 0 only: the pool stays Scored (seat 1 unpaid).
    let scene = tied_pool(&mut env, 2, &[], &[0]);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 2, "Scored");
    forfeit(&mut env, &scene, 0);
    assert_err(
        pay(&mut env, &scene, 0, 1, 1, POT / 2, 1, true),
        "6027",
        "ResultsNotCommitted",
    );
    // Paying seat 1 (its own share escrows) reaches Paid; seat 1's review
    // is pending, so the forfeited share still waits.
    let settlement = env.settlement.insecure_clone();
    let ix = pay_prizes_ix(
        &settlement.pubkey(),
        1,
        &[1],
        &[(scene.players[1].0.pubkey(), scene.players[1].1)],
    );
    env.send(&[ix], &[&settlement]).unwrap();
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
    assert_err(
        pay(&mut env, &scene, 0, 1, 1, POT / 2, 1, true),
        "6066",
        "NextPlaceReviewPending",
    );
    // Release clears seat 1 (a settled, released flag is history): it takes
    // seat 0's share as the only eligible tied member.
    release(&mut env, &scene, 1);
    let got = pay(&mut env, &scene, 0, 1, 1, POT / 2, 1, true).expect("cleared tied member");
    assert_eq!(got, POT / 2);
    assert_eq!(env.balance(&vault_pda(1)), 0);
}

#[test]
fn a_held_share_auto_releases_to_its_player_after_seven_days_unless_forfeited() {
    let Some(mut env) = Env::new() else { return };
    let scene = tied_pool(&mut env, 2, &[], &[0, 1]);
    let paid_at = env.svm.get_sysvar::<Clock>().unix_timestamp;
    assert_eq!(
        read_entry(&env.svm, &scene.players[0].1).escrowed_at,
        paid_at
    );
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let release_by = |env: &mut Env, signer: &Keypair, seat: usize| {
        let ix = release_escrow_ix(
            &signer.pubkey(),
            1,
            &scene.players[seat].1,
            &scene.players[seat].0.pubkey(),
        );
        env.send(&[ix], &[signer])
    };

    // Before the window: a stranger is refused; the settlement signer is
    // the reviewed path and may release at any time.
    let err = release_by(&mut env, &stranger, 0).unwrap_err();
    assert!(
        err.contains("6064") || err.contains("AutoReleaseNotDue"),
        "{err}"
    );
    env.advance_time(AUTO_RELEASE_SECS - 1);
    let err = release_by(&mut env, &stranger, 0).unwrap_err();
    assert!(err.contains("6064"), "one second early: {err}");

    // Forfeit seat 1 inside the window: the auto-release can never reach it.
    forfeit(&mut env, &scene, 1);

    // The window passes: the stranger releases seat 0's share to seat 0's
    // wallet (never to the stranger); seat 1's forfeited share stays put.
    env.advance_time(1);
    let stranger_before = env.balance(&stranger.pubkey());
    let player_before = env.balance(&scene.players[0].0.pubkey());
    release_by(&mut env, &stranger, 0).expect("auto-release by anyone after seven days");
    assert_eq!(
        env.balance(&scene.players[0].0.pubkey()) - player_before,
        POT / 2
    );
    assert!(
        env.balance(&stranger.pubkey()) < stranger_before,
        "the stranger only paid the fee"
    );
    let err = release_by(&mut env, &stranger, 1).unwrap_err();
    assert!(
        err.contains("6057") || err.contains("EscrowForfeitedAlready"),
        "{err}"
    );
    let settlement = env.settlement.insecure_clone();
    let err = release_by(&mut env, &settlement, 1).unwrap_err();
    assert!(err.contains("6057"), "not even the reviewed path: {err}");
    assert_eq!(
        env.balance(&vault_pda(1)),
        POT / 2,
        "the forfeited share awaits its next-place payout"
    );
    // ...to seat 0, the cleared tied member — the whole share, a group of one.
    let got = pay(&mut env, &scene, 1, 0, 1, POT / 2, 1, true).expect("pay the next place");
    assert_eq!(got, POT / 2);
    assert_eq!(env.balance(&vault_pda(1)), 0);
}
