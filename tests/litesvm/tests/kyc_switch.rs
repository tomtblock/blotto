//! Roadmap 4.5's acceptance test, against the compiled artifact: with the
//! KYC-at-claim switch on, a 1st-place share escrows instead of paying; a
//! `kyc_tier >= 1` packet presented at `release_escrow` releases it, a
//! tier-0 packet does not; with the switch off, the share pays directly.

use blotto_litesvm_tests::*;
use solana_sdk::clock::Clock;
use solana_sdk::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const FIRST_PLACE: u64 = 1_054_687_500; // tier-0 rank 1 at the D-E1 pot

fn fill_and_commit(env: &mut Env) -> Vec<(Keypair, Pubkey)> {
    env.open_ready_pool(1, 0);
    let mut players = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let settlement = env.settlement.insecure_clone();
    let secret = env.pool_secret;
    env.send(
        &[settle_ix(
            &settlement.pubkey(),
            1,
            "reveal_pool_secret",
            &secret,
        )],
        &[&settlement],
    )
    .unwrap();
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&band_payouts(TIER_POTS[0])));
    env.send(
        &[settle_ix(&settlement.pubkey(), 1, "commit_results", &args)],
        &[&settlement],
    )
    .unwrap();
    players
}

fn pay_rank_one(env: &mut Env, players: &[(Keypair, Pubkey)]) {
    let settlement = env.settlement.insecure_clone();
    let (p, e) = &players[0]; // seat 0 = rank 1 under the band payout list
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0], &[(p.pubkey(), *e)]);
    env.send(&[ix], &[&settlement]).expect("pay rank 1");
}

fn set_kyc_threshold(env: &mut Env, lamports: u64) {
    let admin = env.admin.pubkey();
    let ix = admin_ix(&admin, "set_kyc_threshold", &lamports.to_le_bytes());
    env.send(&[ix], &[]).unwrap();
}

#[test]
fn switch_off_pays_first_place_directly() {
    let Some(mut env) = Env::new() else { return };
    let players = fill_and_commit(&mut env);
    let before = env.balance(&players[0].0.pubkey());
    pay_rank_one(&mut env, &players);
    assert_eq!(env.balance(&players[0].0.pubkey()) - before, FIRST_PLACE);
    assert_eq!(read_entry(&env.svm, &players[0].1).escrow_lamports, 0);
}

#[test]
fn switch_on_escrows_first_place_and_kyc_packet_releases_it() {
    let Some(mut env) = Env::new() else { return };
    // Threshold below 1st place, above 9th–16th: only the big shares escrow.
    set_kyc_threshold(&mut env, 1_000_000_000);
    let players = fill_and_commit(&mut env);
    let before = env.balance(&players[0].0.pubkey());
    pay_rank_one(&mut env, &players);
    // Escrowed, not paid.
    assert_eq!(env.balance(&players[0].0.pubkey()), before);
    assert_eq!(
        read_entry(&env.svm, &players[0].1).escrow_lamports,
        FIRST_PLACE
    );

    // A small share stays direct even with the switch on.
    let settlement = env.settlement.insecure_clone();
    let (p9, e9) = &players[8]; // seat 8 = rank 9
    let b9 = env.balance(&p9.pubkey());
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[8], &[(p9.pubkey(), *e9)]);
    env.send(&[ix], &[&settlement]).unwrap();
    assert_eq!(env.balance(&p9.pubkey()) - b9, 135_000_000);

    // Release without any packet: rejected (PacketMissing).
    let ix = release_escrow_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        &players[0].0.pubkey(),
    );
    let err = env
        .send(std::slice::from_ref(&ix), &[&settlement])
        .unwrap_err();
    assert!(err.contains("6013"), "{err}");

    // Release with a TIER-0 packet: rejected (PacketKycInsufficient).
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let pool = pool_pda(1);
    let tier0 = encode_packet(&players[0].0.pubkey(), &pool, 7, 1, 1, 0, now);
    let signer = env.entry_signer.clone();
    let sig_ix: Instruction = ed25519_ix(&signer, &tier0);
    let err = env.send(&[sig_ix, ix.clone()], &[&settlement]).unwrap_err();
    assert!(err.contains("6020"), "{err}");

    // Release with a tier-1 packet: the share lands.
    let tier1 = encode_packet(&players[0].0.pubkey(), &pool, 8, 1, 1, 1, now);
    let sig_ix = ed25519_ix(&signer, &tier1);
    env.send(&[sig_ix, ix], &[&settlement])
        .expect("release with KYC");
    assert_eq!(env.balance(&players[0].0.pubkey()) - before, FIRST_PLACE);
    assert_eq!(read_entry(&env.svm, &players[0].1).escrow_lamports, 0);
}
