//! Roadmap 4.5's acceptance test, against the compiled artifact: with the
//! KYC-at-claim switch on, a share above the threshold escrows instead of
//! paying; a `kyc_tier >= 1` packet presented at `release_escrow` releases
//! it, a tier-0 packet does not; with the switch off, the share pays
//! directly. D-E5 keeps the switch at 0; these tests keep the branch honest
//! for whoever flips it — under D-E2 the winner's share IS the pot, so a
//! threshold below the smallest pot escrows every payout (§13's warning),
//! and only a tie for first can produce a share under it.

use blotto_litesvm_tests::*;
use solana_sdk::clock::Clock;
use solana_sdk::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const POT: u64 = 4_000_000_000; // tier 0 (D-E1); the winner's share (D-E2)

fn fill_and_commit(env: &mut Env, payouts: &[(u16, u64)]) -> Vec<(Keypair, Pubkey)> {
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
    args.extend_from_slice(&encode_payouts(payouts));
    env.send(
        &[settle_ix(&settlement.pubkey(), 1, "commit_results", &args)],
        &[&settlement],
    )
    .unwrap();
    players
}

fn pay_seats(env: &mut Env, players: &[(Keypair, Pubkey)], seats: &[u16]) {
    let settlement = env.settlement.insecure_clone();
    let metas: Vec<(Pubkey, Pubkey)> = seats
        .iter()
        .map(|&s| {
            let (p, e) = &players[s as usize];
            (p.pubkey(), *e)
        })
        .collect();
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, seats, &metas);
    env.send(&[ix], &[&settlement]).expect("pay");
}

fn set_kyc_threshold(env: &mut Env, lamports: u64) {
    let admin = env.admin.pubkey();
    let ix = admin_ix(&admin, "set_kyc_threshold", &lamports.to_le_bytes());
    env.send(&[ix], &[]).unwrap();
}

#[test]
fn switch_off_pays_the_winner_directly() {
    let Some(mut env) = Env::new() else { return };
    let players = fill_and_commit(&mut env, &winner_payout(POT));
    let before = env.balance(&players[0].0.pubkey());
    pay_seats(&mut env, &players, &[0]);
    assert_eq!(env.balance(&players[0].0.pubkey()) - before, POT);
    assert_eq!(read_entry(&env.svm, &players[0].1).escrow_lamports, 0);
}

#[test]
fn switch_on_escrows_the_winner_and_a_kyc_packet_releases_it() {
    let Some(mut env) = Env::new() else { return };
    // Any threshold below the pot escrows the winner's whole share (§13):
    // under winner-takes-all this is an all-or-nothing gate at every tier.
    set_kyc_threshold(&mut env, 1_000_000_000);
    let players = fill_and_commit(&mut env, &winner_payout(POT));
    let before = env.balance(&players[0].0.pubkey());
    pay_seats(&mut env, &players, &[0]);
    // Escrowed, not paid — the whole pot sits in the vault on the Entry.
    assert_eq!(env.balance(&players[0].0.pubkey()), before);
    assert_eq!(read_entry(&env.svm, &players[0].1).escrow_lamports, POT);
    assert_eq!(env.balance(&vault_pda(1)), POT + VAULT_RENT_CUSHION);
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).state,
        3,
        "Paid (escrowed)"
    );

    // Release without any packet: rejected (PacketMissing).
    let settlement = env.settlement.insecure_clone();
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

    // Release with a tier-1 packet: the pot lands.
    let tier1 = encode_packet(&players[0].0.pubkey(), &pool, 8, 1, 1, 1, now);
    let sig_ix = ed25519_ix(&signer, &tier1);
    env.send(&[sig_ix, ix], &[&settlement])
        .expect("release with KYC");
    assert_eq!(env.balance(&players[0].0.pubkey()) - before, POT);
    assert_eq!(read_entry(&env.svm, &players[0].1).escrow_lamports, 0);
    assert_eq!(env.balance(&vault_pda(1)), VAULT_RENT_CUSHION);
}

/// The gate is a threshold on the SHARE, not the pot: a tie for first whose
/// per-player share falls under it pays directly even with the switch on.
#[test]
fn switch_on_pays_tied_shares_under_the_threshold_directly() {
    let Some(mut env) = Env::new() else { return };
    set_kyc_threshold(&mut env, 3_000_000_000);
    let payouts = tied_first_payouts(POT, 2); // 2 SOL each, under 3 SOL
    let players = fill_and_commit(&mut env, &payouts);
    let before: Vec<u64> = players[..2]
        .iter()
        .map(|(p, _)| env.balance(&p.pubkey()))
        .collect();
    pay_seats(&mut env, &players, &[0, 1]);
    for (i, (p, e)) in players[..2].iter().enumerate() {
        assert_eq!(
            env.balance(&p.pubkey()) - before[i],
            POT / 2,
            "seat {i} paid direct"
        );
        assert_eq!(read_entry(&env.svm, e).escrow_lamports, 0);
    }
    assert_eq!(
        env.balance(&vault_pda(1)),
        VAULT_RENT_CUSHION,
        "vault drained to its rent cushion"
    );
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
}
