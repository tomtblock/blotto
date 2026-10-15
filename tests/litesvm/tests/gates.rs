//! Gate tests: admin authority, the pause switch, pool-opening rules
//! (R6/R14/ceiling), registering without a VRF seed (R22), packet rejection
//! cases, and settlement-signer binding. (Roadmap 1.1–1.3 acceptance criteria.)

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
    // set_vault_ceiling: tier (u8) + ceiling (u64 LE) — restated at tier 0's
    // launch value so the admin success call is a no-op.
    let mut ceiling_args = vec![0u8];
    ceiling_args.extend_from_slice(&6_400_000_000u64.to_le_bytes());
    // set_tier_economics: restated at tier 0's launch values (no-op).
    let mut econ_args = vec![0u8];
    econ_args.extend_from_slice(&TIER_PRICES[0].to_le_bytes());
    econ_args.extend_from_slice(&TIER_POTS[0].to_le_bytes());
    // set_treasury_policy: restated at the launch defaults (no-op).
    let mut policy_args = vec![1u8];
    policy_args.extend_from_slice(&0u64.to_le_bytes());
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
        ("set_open_tiers", vec![1, 1, 1, 1, 1, 1, 1]),
        ("set_vault_ceiling", ceiling_args),
        ("set_kyc_threshold", 1u64.to_le_bytes().to_vec()),
        ("set_detection_hard_block", vec![1]),
        ("set_tier_economics", econ_args),
        ("set_treasury_policy", policy_args),
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
    // `withdraw_platform` has its own account shape — same has_one gate.
    let ix = withdraw_platform_ix(&mallory.pubkey(), &mallory.pubkey(), 1);
    let err = env.send(&[ix], &[&mallory]).unwrap_err();
    assert!(
        err.contains("2001"),
        "withdraw must reject a non-admin: {err}"
    );

    // Undo what the loop set so later assertions aren't surprised.
    let admin = env.admin.pubkey();
    env.send(&[admin_ix(&admin, "set_paused", &[0])], &[])
        .unwrap();
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 0, 0, 0, 0, 0, 0])],
        &[],
    )
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

    // With an EMPTY treasury, even the enabled tier cannot open: the pot
    // must be fundable first (D-A1 revised policy gate).
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6049") || err.contains("TreasuryShortfall"),
        "{err}"
    );

    // Fund enough for every check below (the gate order puts tier/id checks
    // before the treasury check, but a funded treasury keeps them isolated).
    env.fund_platform(2_000_000_000_000);

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

    // KEEPER-GATED since 2026-09-07 (prompt v2 §A): a stranger is refused
    // until the tier's liveness fallback holds. This assertion used to read
    // "permissionless — any funded signer opens pool 1", carried from the
    // D-A1 posture; it kept passing after the keeper role landed only because
    // `tier_next_open_at` was seeded to zero, which put the fallback window
    // decades in the past. That was the hole the 2026-09-07 fix closed, and
    // this is the test that should have caught it.
    let mallory = Keypair::new();
    env.svm.airdrop(&mallory.pubkey(), 10_000_000_000).unwrap();
    let ix = open_pool_ix(&mallory.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&mallory]).unwrap_err();
    assert!(
        err.contains("6054") || err.contains("NotKeeper"),
        "a stranger cannot open a fresh tier's pool: {err}"
    );
    // The keeper (the init default is the settlement signer) opens it, and a
    // second tier-0 pool then violates the sequential rule.
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement]).expect("the keeper opens");
    let ix = open_pool_ix(&settlement.pubkey(), 2, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6008") || err.contains("TierAlreadyHasOpenPool"),
        "{err}"
    );

    // Open the 5 SOL tier (index 5) but lower its ceiling one lamport below
    // its own gross pass sales (5 × 64 = 320 SOL): the next open in that
    // tier rejects.
    let admin = env.admin.pubkey();
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 1, 1, 1, 1, 1])],
        &[],
    )
    .unwrap();
    let mut args = vec![5u8];
    args.extend_from_slice(&(320_000_000_000u64 - 1).to_le_bytes());
    env.send(&[admin_ix(&admin, "set_vault_ceiling", &args)], &[])
        .unwrap();
    let ix = open_pool_ix(&settlement.pubkey(), 2, 5, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6009") || err.contains("VaultCeilingExceeded"),
        "{err}"
    );
}

#[test]
fn seven_tiers_open_concurrently_and_the_eighth_open_rejects() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();

    // Tier 6 (7.5 SOL) is gated until the founder's switch opens it (D1/R6).
    let ix = open_pool_ix(&settlement.pubkey(), 1, 6, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6006") || err.contains("TierNotOpen"), "{err}");

    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 1, 1, 1, 1, 1])],
        &[],
    )
    .unwrap();

    // Enough treasury for all seven pots plus the shrinking idle-tier
    // reserve at each step (Σ pots = 888.32 SOL; the first open needs
    // pot + the other six pots in reserve).
    env.fund_platform(1_800_000_000_000);

    // One pool per tier — all seven Open at the same time (the sequential
    // rule is per-tier; the launch ceilings admit every tier's own gross
    // pass sales, tier 6's 480 SOL included).
    for tier in 0u8..7 {
        let pool_id = tier as u64 + 1;
        let ix = open_pool_ix(
            &settlement.pubkey(),
            pool_id,
            tier,
            [9; 32],
            env.sealing_secret_hash,
        );
        env.send(&[ix], &[&settlement])
            .unwrap_or_else(|e| panic!("open tier {tier}: {e}"));
    }
    for tier in 0u64..7 {
        assert_eq!(read_pool(&env.svm, &pool_pda(tier + 1)).state, 0, "Open");
    }

    // An eighth pool must land in a tier that already has one: rejected.
    let ix = open_pool_ix(&settlement.pubkey(), 8, 3, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6008") || err.contains("TierAlreadyHasOpenPool"),
        "{err}"
    );
}

#[test]
fn lowering_a_ceiling_blocks_the_next_open_not_the_open_pool() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();

    // Pool 1 opens on tier 0 at the launch ceiling (6.4 SOL = its own gross).
    // Two opens happen on this funding: the refund below returns the pot to
    // the treasury but each open leaves a rent cushion behind in its vault.
    env.fund_platform(TIER_POTS[0] + 2 * VAULT_RENT_CUSHION);
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement]).unwrap();

    // Lower tier 0's ceiling below the gross. The ceiling is checked at
    // `open_pool` only (D2): the already-open pool is untouched.
    let mut args = vec![0u8];
    args.extend_from_slice(&(6_400_000_000u64 - 1).to_le_bytes());
    env.send(&[admin_ix(&admin, "set_vault_ceiling", &args)], &[])
        .unwrap();
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).state,
        0,
        "pool 1 stays Open"
    );

    // Free the tier slot via the refund fork, then try the NEXT open: the
    // lowered ceiling is what blocks it.
    env.advance_time(12 * 3600 + 1);
    let ix = trigger_refund_ix(&settlement.pubkey(), 1);
    env.send(&[ix], &[&settlement]).unwrap();
    // Closed stamps the tier's cooldown (prompt v2 §B.6); wait it out so the
    // ceiling — not the cooldown — is what the next open trips on.
    env.advance_time(5 * 60);
    let ix = open_pool_ix(&settlement.pubkey(), 2, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6009") || err.contains("VaultCeilingExceeded"),
        "{err}"
    );

    // Restored to the launch value, the open lands again.
    let mut args = vec![0u8];
    args.extend_from_slice(&6_400_000_000u64.to_le_bytes());
    env.send(&[admin_ix(&admin, "set_vault_ceiling", &args)], &[])
        .unwrap();
    let ix = open_pool_ix(&settlement.pubkey(), 2, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement])
        .expect("reopen after restore");
}

#[test]
fn register_draws_from_the_other_four_inputs_without_a_seed() {
    let Some(mut env) = Env::new() else { return };
    // Open WITHOUT patching a VRF seed — the state of every devnet pool from
    // 90 on, after Switchboard's oracles stopped (R22). The pass
    // collection is still created: `register` mints into it.
    let settlement = env.settlement.insecure_clone();
    env.fund_platform(TIER_POTS[0] + VAULT_RENT_CUSHION);
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement]).unwrap();
    let ix = create_pass_collection_ix(&settlement.pubkey(), 1);
    env.send(&[ix], &[&settlement])
        .expect("create_pass_collection");

    let pool = pool_pda(1);
    let seed = |env: &Env| env.svm.get_account(&pool).unwrap().data[116..148].to_vec();
    assert_eq!(seed(&env), vec![0u8; 32], "opens without a seed");
    let before = read_pool(&env.svm, &pool);

    let (_player, entry) = env
        .register_player(1)
        .expect("an unseeded pool takes entries (R22)");

    let after = read_pool(&env.svm, &pool);
    assert_eq!(after.entrants, 1);
    // Exactly one class left the bag, and it is the one the entry carries.
    let class = read_entry(&env.svm, &entry).class as usize;
    for i in 0..5 {
        let expected = before.class_counters[i] - u16::from(i == class);
        assert_eq!(after.class_counters[i], expected, "counter {i}");
    }
    assert_eq!(seed(&env), vec![0u8; 32], "register never writes the seed");
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
        let reg = register_ix(&player.pubkey(), 1, &pass_asset.pubkey(), [3u8; 32]);
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
            register_ix(&player.pubkey(), 1, &pass_asset.pubkey(), [3; 32]),
        ];
        let err = env.send(&ixs, &[&player, &pass_asset]).unwrap_err();
        assert!(err.contains("6019") || err.contains("PacketStale"), "{err}");
    }

    // Terms version 0 — never attested (D-B4).
    {
        let player = Keypair::new();
        env.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        let pass_asset = Keypair::new();
        let m = encode_packet_with_terms(&player.pubkey(), &pool, 1, 1, 1, 0, now, 0);
        let ixs = vec![
            ed25519_ix(&signer, &m),
            register_ix(&player.pubkey(), 1, &pass_asset.pubkey(), [3; 32]),
        ];
        let err = env.send(&ixs, &[&player, &pass_asset]).unwrap_err();
        assert!(
            err.contains("6046") || err.contains("PacketTermsVersionMissing"),
            "{err}"
        );
    }

    // Geo not cleared.
    {
        let player = Keypair::new();
        env.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        let pass_asset = Keypair::new();
        let m = encode_packet(&player.pubkey(), &pool, 1, 0, 1, 0, now);
        let ixs = vec![
            ed25519_ix(&signer, &m),
            register_ix(&player.pubkey(), 1, &pass_asset.pubkey(), [3; 32]),
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
fn malformed_payout_lists_and_wrong_recipients_reject() {
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

    // D-E2: a two-way tie for first — two rows, so the ordering and
    // duplicate checks have something to trip on.
    let good = tied_first_payouts(TIER_POTS[0], 2);

    // A duplicate seat rejects at commit (strict-ascending check).
    let mut dup = good.clone();
    dup[1].0 = dup[0].0;
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&dup));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &args);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6043") || err.contains("PayoutListMalformed"),
        "{err}"
    );

    // An unsorted list rejects the same way.
    let mut unsorted = good.clone();
    unsorted.swap(0, 1);
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&unsorted));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &args);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6043") || err.contains("PayoutListMalformed"),
        "{err}"
    );

    // Amounts one lamport off the pot reject.
    let mut off = good.clone();
    off[1].1 += 1;
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&off));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &args);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6044") || err.contains("PayoutSumMismatch"),
        "{err}"
    );

    // Commit the proper list.
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&good));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &args);
    env.send(&[ix], &[&settlement]).unwrap();

    // Paying seat 0 with a DIFFERENT player's wallet rejects: the Entry
    // account is the on-chain seat→player map.
    let (p2, _) = &players[1];
    let (_, e1) = &players[0];
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0], &[(p2.pubkey(), *e1)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6031") || err.contains("WinnerMismatch"),
        "{err}"
    );

    // A seat outside the committed list rejects (second place, under D-E2).
    let (p17, e17) = &players[2];
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[2], &[(p17.pubkey(), *e17)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6045") || err.contains("SeatNotInPayouts"),
        "{err}"
    );
}
