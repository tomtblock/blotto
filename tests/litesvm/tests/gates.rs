//! Gate tests: admin authority, the pause switch, pool-opening rules
//! (R6/R14/ceiling), the VRF precondition, packet rejection cases, and
//! settlement-signer binding. (Roadmap 1.1–1.3 acceptance criteria.)

use blotto_litesvm_tests::*;
use solana_sdk::clock::Clock;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

#[test]
fn non_admin_reverts_on_every_admin_instruction() {
    let Some(mut env) = Env::new() else { return };
    let mallory = Keypair::new();
    env.svm.airdrop(&mallory.pubkey(), 1_000_000_000).unwrap();
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("set_paused", vec![1]),
        (
            "rotate_entry_signer",
            Pubkey::new_unique().as_ref().to_vec(),
        ),
        (
            "set_settlement_signer",
            Pubkey::new_unique().as_ref().to_vec(),
        ),
        ("set_open_tiers", vec![1, 1, 1, 1]),
        ("set_vault_ceiling", 1u64.to_le_bytes().to_vec()),
        ("set_kyc_threshold", 1u64.to_le_bytes().to_vec()),
        ("set_detection_hard_block", vec![1]),
    ];
    for (name, args) in cases {
        let ix = admin_ix(&mallory.pubkey(), name, &args);
        let err = env.send(&[ix], &[&mallory]).unwrap_err();
        // Anchor ConstraintHasOne = 2001.
        assert!(
            err.contains("2001"),
            "{name} must reject a non-admin: {err}"
        );
        // And the admin itself succeeds (reverting the change where needed).
        let ix = admin_ix(&env.admin.pubkey(), name, &args);
        env.send(&[ix], &[])
            .unwrap_or_else(|e| panic!("{name} as admin: {e}"));
    }
    // Undo what the loop set so later assertions aren't surprised.
    let admin = env.admin.pubkey();
    env.send(&[admin_ix(&admin, "set_paused", &[0])], &[])
        .unwrap();
}

#[test]
fn pause_blocks_register_and_only_register() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let admin = env.admin.pubkey();
    env.send(&[admin_ix(&admin, "set_paused", &[1])], &[])
        .unwrap();
    let err = env.register_player(1).unwrap_err();
    assert!(err.contains("6005") || err.contains("Paused"), "{err}");
    env.send(&[admin_ix(&admin, "set_paused", &[0])], &[])
        .unwrap();
    env.register_player(1).expect("unpaused register");
}

#[test]
fn pool_opening_gates_hold() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();

    // A non-settlement signer cannot open a pool.
    let mallory = Keypair::new();
    env.svm.airdrop(&mallory.pubkey(), 10_000_000_000).unwrap();
    let ix = open_pool_ix(&mallory.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&mallory]).unwrap_err();
    assert!(err.contains("2001"), "{err}");

    // A closed tier (1 = 0.5 SOL, closed at launch per R6) rejects.
    let ix = open_pool_ix(&settlement.pubkey(), 1, 1, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6006") || err.contains("TierNotOpen"), "{err}");

    // An unknown tier rejects.
    let ix = open_pool_ix(&settlement.pubkey(), 1, 9, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6007") || err.contains("UnknownTier"), "{err}");

    // A pool id that skips the counter rejects.
    let ix = open_pool_ix(&settlement.pubkey(), 7, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6041") || err.contains("WrongPoolId"), "{err}");

    // Open pool 1 on tier 0; a second tier-0 pool violates R14.
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement]).expect("open pool 1");
    let ix = open_pool_ix(&settlement.pubkey(), 2, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6008") || err.contains("TierAlreadyHasOpenPool"),
        "{err}"
    );

    // Open the 5 SOL tier, then hit the 6.4 SOL gross ceiling (5 × 64 = 320).
    let admin = env.admin.pubkey();
    env.send(&[admin_ix(&admin, "set_open_tiers", &[1, 1, 1, 1])], &[])
        .unwrap();
    let ix = open_pool_ix(&settlement.pubkey(), 2, 3, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6009") || err.contains("VaultCeilingExceeded"),
        "{err}"
    );
}

#[test]
fn register_requires_a_committed_vrf_seed() {
    let Some(mut env) = Env::new() else { return };
    // Open WITHOUT patching a VRF seed (and without a pass collection —
    // the VRF gate fires before the mint is reached).
    let settlement = env.settlement.insecure_clone();
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement]).unwrap();
    let err = env.register_player(1).unwrap_err();
    assert!(
        err.contains("6004") || err.contains("VrfSeedNotCommitted"),
        "{err}"
    );
}

#[test]
fn bad_entry_packets_are_rejected() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let pool = pool_pda(1);
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;

    let attempt = |env: &mut Env, packet: Option<Vec<u8>>, signer: &ed25519_dalek::SigningKey| {
        let player = Keypair::new();
        env.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        let pass_asset = Keypair::new();
        let reg = register_ix(
            &player.pubkey(),
            1,
            &env.platform_wallet,
            &pass_asset.pubkey(),
            [3u8; 32],
        );
        let ixs = match &packet {
            Some(m) => vec![ed25519_ix(signer, m), reg],
            None => vec![reg],
        };
        env.send(&ixs, &[&player, &pass_asset]).unwrap_err()
    };

    // No packet at all.
    let signer = env.entry_signer.clone();
    let err = attempt(&mut env, None, &signer);
    assert!(
        err.contains("6013") || err.contains("PacketMissing"),
        "{err}"
    );

    // Signed by the wrong key.
    let wrong = ed25519_dalek::SigningKey::from_bytes(&[8u8; 32]);
    let m = encode_packet(&Pubkey::new_unique(), &pool, 1, 1, 1, 0, now);
    let err = attempt(&mut env, Some(m), &wrong);
    assert!(
        err.contains("6015") || err.contains("PacketWrongSigner"),
        "{err}"
    );

    // Bound to a different wallet.
    let m = encode_packet(&Pubkey::new_unique(), &pool, 1, 1, 1, 0, now);
    let err = attempt(&mut env, Some(m.clone()), &signer);
    assert!(
        err.contains("6016") || err.contains("PacketWrongWallet"),
        "{err}"
    );

    // Stale packet (61 seconds old) — needs the right wallet, so build inline.
    {
        let player = Keypair::new();
        env.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        let pass_asset = Keypair::new();
        let m = encode_packet(&player.pubkey(), &pool, 1, 1, 1, 0, now - 61);
        let ixs = vec![
            ed25519_ix(&signer, &m),
            register_ix(
                &player.pubkey(),
                1,
                &env.platform_wallet,
                &pass_asset.pubkey(),
                [3; 32],
            ),
        ];
        let err = env.send(&ixs, &[&player, &pass_asset]).unwrap_err();
        assert!(err.contains("6019") || err.contains("PacketStale"), "{err}");
    }

    // Geo not cleared.
    {
        let player = Keypair::new();
        env.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        let pass_asset = Keypair::new();
        let m = encode_packet(&player.pubkey(), &pool, 1, 0, 1, 0, now);
        let ixs = vec![
            ed25519_ix(&signer, &m),
            register_ix(
                &player.pubkey(),
                1,
                &env.platform_wallet,
                &pass_asset.pubkey(),
                [3; 32],
            ),
        ];
        let err = env.send(&ixs, &[&player, &pass_asset]).unwrap_err();
        assert!(
            err.contains("6018") || err.contains("PacketNotCleared"),
            "{err}"
        );
    }

    // One entry per wallet: the same player twice fails at the Entry PDA init.
    {
        let player = Keypair::new();
        env.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        env.register_as(1, &player).expect("first entry");
        let err = env.register_as(1, &player).unwrap_err();
        // Anchor `init` on an existing account → the system program refuses;
        // surfaced as "already in use" (SystemError 0).
        assert!(!err.is_empty(), "second entry must fail: {err}");
    }
}

#[test]
fn settlement_instructions_bind_to_the_settlement_signer() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let mallory = Keypair::new();
    env.svm.airdrop(&mallory.pubkey(), 1_000_000_000).unwrap();
    let secret = env.pool_secret;
    let ix = settle_ix(&mallory.pubkey(), 1, "reveal_pool_secret", &secret);
    let err = env.send(&[ix], &[&mallory]).unwrap_err();
    assert!(err.contains("2001"), "{err}");
}

#[test]
fn winner_mismatch_and_bad_ranks_reject() {
    let Some(mut env) = Env::new() else { return };
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

    // Duplicate winners reject at commit.
    let mut dup_args = [1u8; 32].to_vec();
    for _ in 0..16 {
        dup_args.extend_from_slice(players[0].0.pubkey().as_ref());
    }
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &dup_args);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6028") || err.contains("WinnersNotDistinct"),
        "{err}"
    );

    // Commit a proper set.
    let mut args = [1u8; 32].to_vec();
    for (p, _) in players.iter().take(16) {
        args.extend_from_slice(p.pubkey().as_ref());
    }
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &args);
    env.send(&[ix], &[&settlement]).unwrap();

    // Paying rank 1 with the wrong wallet account rejects.
    let (p2, e2) = &players[1];
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[1], &[(p2.pubkey(), *e2)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6031") || err.contains("WinnerMismatch"),
        "{err}"
    );

    // Rank 0 and rank 17 reject.
    let (p1, e1) = &players[0];
    for bad in [0u8, 17u8] {
        let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[bad], &[(p1.pubkey(), *e1)]);
        let err = env.send(&[ix], &[&settlement]).unwrap_err();
        assert!(err.contains("6029") || err.contains("InvalidRank"), "{err}");
    }
}
