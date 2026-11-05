//! Roadmap 4.5's acceptance test, against the compiled artifact: with the
//! KYC-at-claim switch on, a share above the threshold escrows instead of
//! paying; a `kyc_tier >= 1` packet presented at `release_escrow` releases
//! it, a tier-0 packet does not; with the switch off, the share pays
//! directly. D-E5 keeps the switch at 0; these tests keep the branch honest
//! for whoever flips it. Under the Ladder (D-E19) the shares differ by
//! place — a 64-player pool at 0.1 SOL pays 1.2 SOL first, 0.6 second, down
//! to 0.1 — so a threshold of 1 SOL escrows first place alone and pays every
//! other place directly; the gate is per SHARE, never per pool.

use blotto_litesvm_tests::*;
use solana_sdk::clock::Clock;
use solana_sdk::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const ENTRY: u64 = 100_000_000; // tier 0
const FIRST: u64 = 12 * ENTRY; // first place of 64: 1.2 SOL

fn fill_and_commit(env: &mut Env, payouts: &[(u16, u64)]) -> Vec<(Keypair, Pubkey)> {
    env.open_ready_pool(1, 0);
    let players = env.register_n(1, 64);
    env.reveal(1);
    env.commit(1, [1u8; 32], payouts).unwrap();
    players
}

fn set_kyc_threshold(env: &mut Env, lamports: u64) {
    let admin = env.admin.pubkey();
    let ix = admin_ix(&admin, "set_kyc_threshold", &lamports.to_le_bytes());
    env.send(&[ix], &[]).unwrap();
}

#[test]
fn switch_off_pays_every_place_directly() {
    let Some(mut env) = Env::new() else { return };
    let payouts = straight_payouts(&LADDER_TABLES[3], ENTRY);
    let players = fill_and_commit(&mut env, &payouts);
    let deltas = env.pay_all(1, &players, &payouts);
    assert_eq!(deltas, payouts.iter().map(|&(_, a)| a).collect::<Vec<_>>());
    for &(seat, _) in &payouts {
        assert_eq!(read_entry(&env.svm, &players[seat as usize].1).escrow_lamports, 0);
    }
}

#[test]
fn switch_on_escrows_first_place_and_a_kyc_packet_releases_it() {
    let Some(mut env) = Env::new() else { return };
    // A 1 SOL threshold sits between first place (1.2 SOL) and second
    // (0.6): first place escrows, every other place pays directly.
    set_kyc_threshold(&mut env, 1_000_000_000);
    let payouts = straight_payouts(&LADDER_TABLES[3], ENTRY);
    let players = fill_and_commit(&mut env, &payouts);
    let before = env.balance(&players[0].0.pubkey());
    let deltas = env.pay_all(1, &players, &payouts);
    // Escrowed, not paid — first place's share sits in the vault on the Entry.
    assert_eq!(deltas[0], 0);
    assert_eq!(env.balance(&players[0].0.pubkey()), before);
    assert_eq!(read_entry(&env.svm, &players[0].1).escrow_lamports, FIRST);
    assert_eq!(
        &deltas[1..],
        &payouts[1..].iter().map(|&(_, a)| a).collect::<Vec<_>>()[..],
        "every place under the threshold is paid directly"
    );
    assert_eq!(env.balance(&vault_pda(1)), FIRST + VAULT_RENT_CUSHION);
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).state,
        3,
        "Paid (first place escrowed)"
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

    // Release with a tier-1 packet: first place's share lands.
    let tier1 = encode_packet(&players[0].0.pubkey(), &pool, 8, 1, 1, 1, now);
    let sig_ix = ed25519_ix(&signer, &tier1);
    env.send(&[sig_ix, ix], &[&settlement])
        .expect("release with KYC");
    assert_eq!(env.balance(&players[0].0.pubkey()) - before, FIRST);
    assert_eq!(read_entry(&env.svm, &players[0].1).escrow_lamports, 0);
    assert_eq!(env.balance(&vault_pda(1)), VAULT_RENT_CUSHION);
}

/// The gate is a threshold on the SHARE, not the place: a tie for first
/// whose per-player share falls under it pays directly even with the switch
/// on — two tied for first share 1st and 2nd, 0.9 SOL each, under 1 SOL.
#[test]
fn switch_on_pays_tied_shares_under_the_threshold_directly() {
    let Some(mut env) = Env::new() else { return };
    set_kyc_threshold(&mut env, 1_000_000_000);
    let mut groups = vec![2u16];
    groups.extend(std::iter::repeat_n(1u16, 14));
    let payouts = ladder_payouts(&LADDER_TABLES[3], ENTRY, &groups);
    assert_eq!(&payouts[..2], &[(0, 900_000_000), (1, 900_000_000)]);
    let players = fill_and_commit(&mut env, &payouts);
    let deltas = env.pay_all(1, &players, &payouts);
    for (i, &(seat, amount)) in payouts.iter().enumerate() {
        assert_eq!(deltas[i], amount, "seat {seat} paid direct");
        assert_eq!(read_entry(&env.svm, &players[seat as usize].1).escrow_lamports, 0);
    }
    assert_eq!(
        env.balance(&vault_pda(1)),
        VAULT_RENT_CUSHION,
        "vault drained to its rent cushion"
    );
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
}
