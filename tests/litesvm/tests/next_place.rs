//! Founder ruling 4 (2026-09-07) against the compiled artifact: the vault
//! pays (i) first place, (ii) if first place is not eligible, the next
//! eligible highest place, (iii) refunds below the minimum field — and a
//! forfeited share never reaches the operator.
//!
//!   - promotion waits for Paid, needs a forfeited source, and pays the
//!     WHOLE share to one target proven against the committed results root;
//!   - a first-place target must be a committed seat; a next-rank target
//!     must hold rank `1 + k` and every tied seat must be shown forfeited —
//!     a pending review blocks the promotion rather than being skipped;
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

/// A 64-seat pool with a two-way tie for first (seats 0 and 1), both tied
/// seats flagged before payout so both shares escrow; committed under a
/// real results root; `pay` says whether to pay both seats (→ Paid).
fn tied_pool_with_flagged_winners(env: &mut Env, pay: &[u16]) -> Scene {
    env.open_ready_pool(1, 0);
    let players: Vec<(Keypair, Pubkey)> = (0..64).map(|_| env.register_player(1).unwrap()).collect();
    let settlement = env.settlement.insecure_clone();
    for (_, entry) in players.iter().take(2) {
        let ix = flag_ix(&settlement.pubkey(), 1, entry, "flag_entry");
        env.send(&[ix], &[&settlement]).unwrap();
    }
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).unwrap();
    let payouts = tied_first_payouts(POT, 2);
    let wallets: Vec<Pubkey> = players.iter().map(|(p, _)| p.pubkey()).collect();
    let (leaves, ranks) = results_leaves(&wallets, &payouts);
    assert_eq!(&ranks[..4], &[1, 1, 3, 4], "next competition rank after a 2-way tie is 3");
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
    Scene { players, leaves, payouts }
}

fn forfeit(env: &mut Env, entry: &Pubkey) {
    let admin = env.admin.pubkey();
    env.send(&[forfeit_escrow_ix(&admin, 1, entry)], &[]).expect("forfeit");
}

#[allow(clippy::too_many_arguments)]
fn promote(
    env: &mut Env,
    scene: &Scene,
    from: usize,
    to: usize,
    rank: u8,
    amount: u64,
    proof: &[ProofStep],
    witnesses: &[usize],
) -> Result<(), String> {
    let settlement = env.settlement.insecure_clone();
    let w: Vec<Pubkey> = witnesses.iter().map(|&i| scene.players[i].1).collect();
    let ix = promote_on_forfeit_ix(
        &settlement.pubkey(),
        1,
        &scene.players[from].1,
        &scene.players[to].1,
        &scene.players[to].0.pubkey(),
        rank,
        amount,
        proof,
        &w,
    );
    env.send(&[ix], &[&settlement])
}

#[test]
fn both_tied_winners_forfeit_and_the_next_rank_is_paid_in_full() {
    let Some(mut env) = Env::new() else { return };
    let scene = tied_pool_with_flagged_winners(&mut env, &[0, 1]);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
    let platform_before = env.balance(&platform_pda());
    let proof_2 = merkle_proof(&scene.leaves, 2);

    // Forfeit seat 0. Seat 1's review is still open (flagged, held): seat 2
    // cannot be promoted past it — the pending review must resolve first.
    forfeit(&mut env, &scene.players[0].1);
    let err = promote(&mut env, &scene, 0, 2, 3, 0, &proof_2, &[1]).unwrap_err();
    assert!(err.contains("6066") || err.contains("PromotionReviewPending"), "{err}");
    // Nor can seat 0's share go to seat 1 (its review is pending).
    let proof_1 = merkle_proof(&scene.leaves, 1);
    let err = promote(&mut env, &scene, 0, 1, 1, POT / 2, &proof_1, &[]).unwrap_err();
    assert!(err.contains("6066"), "{err}");

    // Review upholds seat 1's flag too. Now seat 2 (rank 3, the next
    // competition rank) is the next eligible place for BOTH shares.
    forfeit(&mut env, &scene.players[1].1);
    let before = env.balance(&scene.players[2].0.pubkey());
    // Witness list must be exactly the OTHER tied seat, and it must be the
    // right account: an empty list, or the wrong seat, is refused.
    let err = promote(&mut env, &scene, 0, 2, 3, 0, &proof_2, &[]).unwrap_err();
    assert!(err.contains("6060") || err.contains("PromotionTargetIneligible"), "{err}");
    let err = promote(&mut env, &scene, 0, 2, 3, 0, &proof_2, &[3]).unwrap_err();
    assert!(err.contains("6030") || err.contains("EntryMismatch"), "{err}");
    promote(&mut env, &scene, 0, 2, 3, 0, &proof_2, &[1]).expect("seat 0's share → rank 3");
    promote(&mut env, &scene, 1, 2, 3, 0, &proof_2, &[0]).expect("seat 1's share → rank 3");
    assert_eq!(
        env.balance(&scene.players[2].0.pubkey()) - before,
        POT,
        "the next eligible place received the whole pot"
    );
    let e2 = read_entry(&env.svm, &scene.players[2].1);
    assert_eq!(e2.promoted_lamports, POT);
    assert!(e2.settled, "a promoted seat is settled (its flag window closes)");
    assert_eq!(env.balance(&vault_pda(1)), 0, "the vault reaps");
    assert_eq!(env.balance(&platform_pda()), platform_before, "the operator got nothing");
    // The forfeited players' shares are gone from their entries.
    assert_eq!(read_entry(&env.svm, &scene.players[0].1).escrow_lamports, 0);
    assert_eq!(read_entry(&env.svm, &scene.players[1].1).escrow_lamports, 0);
}

#[test]
fn promotion_refuses_a_wrong_rank_a_forged_proof_and_a_flagged_target() {
    let Some(mut env) = Env::new() else { return };
    let scene = tied_pool_with_flagged_winners(&mut env, &[0, 1]);
    let settlement = env.settlement.insecure_clone();
    forfeit(&mut env, &scene.players[0].1);
    forfeit(&mut env, &scene.players[1].1);

    // Seat 3 holds rank 4: not first, not the next rank (3) — refused even
    // with a valid proof of ITS rank.
    let proof_3 = merkle_proof(&scene.leaves, 3);
    let err = promote(&mut env, &scene, 0, 3, 4, 0, &proof_3, &[1]).unwrap_err();
    assert!(err.contains("6059") || err.contains("PromotionRankInvalid"), "{err}");
    // Claiming rank 3 for seat 3 fails the proof.
    let err = promote(&mut env, &scene, 0, 3, 3, 0, &proof_3, &[1]).unwrap_err();
    assert!(err.contains("6061") || err.contains("InvalidMerkleProof"), "{err}");
    // Seat 2 with a tampered proof (one side bit flipped) fails.
    let mut forged = merkle_proof(&scene.leaves, 2);
    forged[0].1 = !forged[0].1;
    let err = promote(&mut env, &scene, 0, 2, 3, 0, &forged, &[1]).unwrap_err();
    assert!(err.contains("6061"), "{err}");
    // Seat 2 with the wrong amount in the leaf fails (the leaf is verified
    // as committed; the paid amount is the share, never the leaf).
    let proof_2 = merkle_proof(&scene.leaves, 2);
    let err = promote(&mut env, &scene, 0, 2, 3, 1, &proof_2, &[1]).unwrap_err();
    assert!(err.contains("6061"), "{err}");
    // A stranger cannot promote.
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ix = promote_on_forfeit_ix(
        &stranger.pubkey(), 1, &scene.players[0].1, &scene.players[2].1,
        &scene.players[2].0.pubkey(), 3, 0, &proof_2, &[scene.players[1].1],
    );
    let err = env.send(&[ix], &[&stranger]).unwrap_err();
    assert!(err.contains("2001") || err.contains("ConstraintHasOne"), "{err}");
    // A flagged (unsettled) target is under review: refused.
    let ix = flag_ix(&settlement.pubkey(), 1, &scene.players[2].1, "flag_entry");
    env.send(&[ix], &[&settlement]).unwrap();
    let err = promote(&mut env, &scene, 0, 2, 3, 0, &proof_2, &[1]).unwrap_err();
    assert!(err.contains("6066") || err.contains("PromotionReviewPending"), "{err}");
    // Cleared, it is eligible again.
    let ix = flag_ix(&settlement.pubkey(), 1, &scene.players[2].1, "clear_flag");
    env.send(&[ix], &[&settlement]).unwrap();
    promote(&mut env, &scene, 0, 2, 3, 0, &proof_2, &[1]).expect("cleared target");
    // The source must be forfeited: seat 1 IS; seat 2 (no escrow) is not.
    let proof_3 = merkle_proof(&scene.leaves, 3);
    let err = promote(&mut env, &scene, 2, 3, 4, 0, &proof_3, &[0, 1]).unwrap_err();
    assert!(err.contains("6058") || err.contains("EscrowNotForfeited"), "{err}");
    let _ = &scene.payouts;
}

#[test]
fn promotion_waits_for_paid() {
    let Some(mut env) = Env::new() else { return };
    // Pay seat 0 only: the pool stays Scored (seat 1 unpaid).
    let scene = tied_pool_with_flagged_winners(&mut env, &[0]);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 2, "Scored");
    forfeit(&mut env, &scene.players[0].1);
    let proof_1 = merkle_proof(&scene.leaves, 1);
    let err = promote(&mut env, &scene, 0, 1, 1, POT / 2, &proof_1, &[]).unwrap_err();
    assert!(err.contains("6027") || err.contains("ResultsNotCommitted"), "{err}");
    // Paying seat 1 (its own share escrows) reaches Paid; seat 1's review
    // is pending, so the forfeited share still waits.
    let settlement = env.settlement.insecure_clone();
    let ix = pay_prizes_ix(
        &settlement.pubkey(), 1, &[1], &[(scene.players[1].0.pubkey(), scene.players[1].1)],
    );
    env.send(&[ix], &[&settlement]).unwrap();
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
    let err = promote(&mut env, &scene, 0, 1, 1, POT / 2, &proof_1, &[]).unwrap_err();
    assert!(err.contains("6066"), "{err}");
    // Release clears seat 1 (a settled, released flag is history): it takes
    // seat 0's share as the cleared tied member.
    let ix = release_escrow_ix(&settlement.pubkey(), 1, &scene.players[1].1, &scene.players[1].0.pubkey());
    env.send(&[ix], &[&settlement]).unwrap();
    let before = env.balance(&scene.players[1].0.pubkey());
    promote(&mut env, &scene, 0, 1, 1, POT / 2, &proof_1, &[]).expect("cleared tied member");
    assert_eq!(env.balance(&scene.players[1].0.pubkey()) - before, POT / 2);
    assert_eq!(env.balance(&vault_pda(1)), 0);
}

#[test]
fn a_held_share_auto_releases_to_its_player_after_seven_days_unless_forfeited() {
    let Some(mut env) = Env::new() else { return };
    let scene = tied_pool_with_flagged_winners(&mut env, &[0, 1]);
    let paid_at = env.svm.get_sysvar::<Clock>().unix_timestamp;
    assert_eq!(read_entry(&env.svm, &scene.players[0].1).escrowed_at, paid_at);
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let release_by = |env: &mut Env, signer: &Keypair, seat: usize| {
        let ix = release_escrow_ix(&signer.pubkey(), 1, &scene.players[seat].1, &scene.players[seat].0.pubkey());
        env.send(&[ix], &[signer])
    };

    // Before the window: a stranger is refused; the settlement signer is
    // the reviewed path and may release at any time.
    let err = release_by(&mut env, &stranger, 0).unwrap_err();
    assert!(err.contains("6064") || err.contains("AutoReleaseNotDue"), "{err}");
    env.advance_time(AUTO_RELEASE_SECS - 1);
    let err = release_by(&mut env, &stranger, 0).unwrap_err();
    assert!(err.contains("6064"), "one second early: {err}");

    // Forfeit seat 1 inside the window: the auto-release can never reach it.
    forfeit(&mut env, &scene.players[1].1);

    // The window passes: the stranger releases seat 0's share to seat 0's
    // wallet (never to the stranger); seat 1's forfeited share stays put.
    env.advance_time(1);
    let stranger_before = env.balance(&stranger.pubkey());
    let player_before = env.balance(&scene.players[0].0.pubkey());
    release_by(&mut env, &stranger, 0).expect("auto-release by anyone after seven days");
    assert_eq!(env.balance(&scene.players[0].0.pubkey()) - player_before, POT / 2);
    assert!(env.balance(&stranger.pubkey()) < stranger_before, "the stranger only paid the fee");
    let err = release_by(&mut env, &stranger, 1).unwrap_err();
    assert!(err.contains("6057") || err.contains("EscrowForfeitedAlready"), "{err}");
    let settlement = env.settlement.insecure_clone();
    let err = release_by(&mut env, &settlement, 1).unwrap_err();
    assert!(err.contains("6057"), "not even the reviewed path: {err}");
    assert_eq!(env.balance(&vault_pda(1)), POT / 2, "the forfeited share awaits promotion");
    // ...to seat 0, the cleared tied member, with no witnesses (seat 0 is
    // the lower seat).
    let proof_0 = merkle_proof(&scene.leaves, 0);
    promote(&mut env, &scene, 1, 0, 1, POT / 2, &proof_0, &[]).expect("promote");
    assert_eq!(env.balance(&vault_pda(1)), 0);
}
