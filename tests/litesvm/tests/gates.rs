//! Gate tests: admin authority, the pause switch, pool-opening rules
//! (R6/R14/ceiling, per pool type since D-E19), registering without a VRF
//! seed (R22), packet rejection cases, settlement-signer binding, and the
//! committed payout list's refusals — including D-E19's two new bounds, a
//! zero amount and an amount above first place. (Roadmap 1.1–1.3 acceptance
//! criteria; the pool-type instructions' own gates are in `pool_types.rs`.)

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
    let ix = withdraw_platform_ix(&mallory.pubkey(), &mallory.pubkey(), 1, &[]);
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
    // The 64-player types of tiers 0 and 1, configured and enabled — tier 1's
    // TIER stays closed (R6), so its type is ready but must not open.
    env.ensure_pool_type(MODE_EASY, 0, 64);
    env.ensure_pool_type(MODE_EASY, 1, 64);
    // Both enabled types are on the tier-0 open's remaining-accounts list;
    // tier 1's reserves nothing while its tier is closed.

    // With an EMPTY treasury, even the enabled tier cannot open: the pot
    // must be fundable first (D-A1 revised policy gate).
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 64);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6049") || err.contains("TreasuryShortfall"),
        "{err}"
    );

    // Fund enough for every check below (the gate order puts tier/id checks
    // before the treasury check, but a funded treasury keeps them isolated).
    env.fund_platform(2_000_000_000_000);

    // A closed tier (1 = 0.5 SOL, closed at launch per R6) rejects, though
    // its pool type is enabled: the tier switch still governs.
    let ix = env.open_ix(&settlement.pubkey(), 1, 1, MODE_EASY, 64);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6006") || err.contains("TierNotOpen"), "{err}");

    // An unknown tier can have no pool type — `init_pool_type` refuses it
    // by name — so an open naming it finds no account to open.
    let err = env.init_pool_type(MODE_EASY, 9, 64).unwrap_err();
    assert!(err.contains("6007") || err.contains("UnknownTier"), "{err}");
    let ix = env.open_ix(&settlement.pubkey(), 1, 9, MODE_EASY, 64);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("3012") || err.contains("AccountNotInitialized"),
        "{err}"
    );

    // A pool id that skips the counter rejects.
    let ix = env.open_ix(&settlement.pubkey(), 7, 0, MODE_EASY, 64);
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
    let ix = env.open_ix(&mallory.pubkey(), 1, 0, MODE_EASY, 64);
    let err = env.send(&[ix], &[&mallory]).unwrap_err();
    assert!(
        err.contains("6054") || err.contains("NotKeeper"),
        "a stranger cannot open a fresh tier's pool: {err}"
    );
    // The keeper (the init default is the settlement signer) opens it, and a
    // second pool of the type then violates the sequential rule.
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 64);
    env.send(&[ix], &[&settlement]).expect("the keeper opens");
    let ix = env.open_ix(&settlement.pubkey(), 2, 0, MODE_EASY, 64);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6008") || err.contains("TierAlreadyHasOpenPool"),
        "{err}"
    );

    // Open the 5 SOL tier (index 5) but lower its ceiling one lamport below
    // a 64-player pool's gross pass sales (5 × 64 = 320 SOL): the next
    // 64-player open in that tier rejects.
    let admin = env.admin.pubkey();
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 1, 1, 1, 1, 1])],
        &[],
    )
    .unwrap();
    env.ensure_pool_type(MODE_EASY, 5, 64);
    let mut args = vec![5u8];
    args.extend_from_slice(&(320_000_000_000u64 - 1).to_le_bytes());
    env.send(&[admin_ix(&admin, "set_vault_ceiling", &args)], &[])
        .unwrap();
    let ix = env.open_ix(&settlement.pubkey(), 2, 5, MODE_EASY, 64);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6009") || err.contains("VaultCeilingExceeded"),
        "{err}"
    );
    // The ceiling caps price × the type's OWN capacity (D-E19): a 32-player
    // pool's gross (160 SOL) fits under the same ceiling.
    env.ensure_pool_type(MODE_EASY, 5, 32);
    env.fund_platform(env.open_funding_bound(MODE_EASY, 5, 32));
    let ix = env.open_ix(&settlement.pubkey(), 2, 5, MODE_EASY, 32);
    env.send(&[ix], &[&settlement])
        .expect("a smaller pool type fits under the same ceiling");
}

#[test]
fn seven_tiers_open_concurrently_and_the_eighth_open_rejects() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();

    // The 64-player type of every tier, configured and enabled.
    for tier in 0u8..7 {
        env.ensure_pool_type(MODE_EASY, tier, 64);
    }

    // Tier 6 (7.5 SOL) is gated until the founder's switch opens it (D1/R6).
    let ix = env.open_ix(&settlement.pubkey(), 1, 6, MODE_EASY, 64);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6006") || err.contains("TierNotOpen"), "{err}");

    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 1, 1, 1, 1, 1])],
        &[],
    )
    .unwrap();

    // Enough treasury for all seven prize pools plus the shrinking idle
    // reserve at each step (Σ = 694 SOL; the first open needs its pool plus
    // the other six in reserve).
    env.fund_platform(1_800_000_000_000);

    // One pool per tier — all seven Open at the same time (the sequential
    // rule is per pool type; the launch ceilings admit every tier's own
    // 64-player gross pass sales, tier 6's 480 SOL included).
    for tier in 0u8..7 {
        let pool_id = tier as u64 + 1;
        let ix = env.open_ix(&settlement.pubkey(), pool_id, tier, MODE_EASY, 64);
        env.send(&[ix], &[&settlement])
            .unwrap_or_else(|e| panic!("open tier {tier}: {e}"));
    }
    for tier in 0u64..7 {
        assert_eq!(read_pool(&env.svm, &pool_pda(tier + 1)).state, 0, "Open");
    }

    // An eighth pool must land in a type that already has one: rejected.
    let ix = env.open_ix(&settlement.pubkey(), 8, 3, MODE_EASY, 64);
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
    env.ensure_pool_type(MODE_EASY, 0, 64);
    env.fund_platform(TIER_POTS[0] + 2 * VAULT_RENT_CUSHION);
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 64);
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

    // Free the type's slot via the refund fork, then try the NEXT open: the
    // lowered ceiling is what blocks it.
    env.advance_time(12 * 3600 + 1);
    let ix = env.trigger_refund_ix(&settlement.pubkey(), 1);
    env.send(&[ix], &[&settlement]).unwrap();
    // Closed stamps the type's cooldown (prompt v2 §B.6); wait it out so the
    // ceiling — not the cooldown — is what the next open trips on.
    env.advance_time(5 * 60);
    let ix = env.open_ix(&settlement.pubkey(), 2, 0, MODE_EASY, 64);
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
    let ix = env.open_ix(&settlement.pubkey(), 2, 0, MODE_EASY, 64);
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
    env.ensure_pool_type(MODE_EASY, 0, 64);
    env.fund_platform(TIER_POTS[0] + VAULT_RENT_CUSHION);
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 64);
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
    let players = env.register_n(1, 64);
    let settlement = env.settlement.insecure_clone();
    env.reveal(1);
    let entry = TIER_PRICES[0];

    // The 64-player table with no ties: sixteen rows, so the ordering,
    // duplicate and bound checks all have something to trip on.
    let good = straight_payouts(&LADDER_TABLES[3], entry);
    let first_prize = 12 * entry;
    assert_eq!(good[0].1, first_prize);

    // A duplicate seat rejects at commit (strict-ascending check).
    let mut dup = good.clone();
    dup[1].0 = dup[0].0;
    assert_refused(env.commit(1, [1u8; 32], &dup), "6043", "PayoutListMalformed");

    // An unsorted list rejects the same way.
    let mut unsorted = good.clone();
    unsorted.swap(0, 1);
    assert_refused(env.commit(1, [1u8; 32], &unsorted), "6043", "PayoutListMalformed");

    // A seat outside the field rejects.
    let mut outside = good.clone();
    outside[15].0 = 64;
    assert_refused(env.commit(1, [1u8; 32], &outside), "6043", "PayoutListMalformed");

    // Amounts one lamport off the prize pool reject.
    let mut off = good.clone();
    off[15].1 += 1;
    assert_refused(env.commit(1, [1u8; 32], &off), "6044", "PayoutSumMismatch");

    // D-E19 §7.6: no seat may be owed more than first place — even when the
    // list still sums to the prize pool (first place takes one lamport too
    // many, second one too few).
    let mut above = good.clone();
    above[0].1 += 1;
    above[1].1 -= 1;
    assert_eq!(above.iter().map(|&(_, a)| a).sum::<u64>(), TIER_POTS[0]);
    assert_refused(env.commit(1, [1u8; 32], &above), "6085", "PayoutAboveFirstPrize");
    // The old winner-takes-all row — the whole prize pool to one seat — is
    // exactly that refusal under the Ladder.
    assert_refused(
        env.commit(1, [1u8; 32], &winner_payout(TIER_POTS[0])),
        "6085",
        "PayoutAboveFirstPrize",
    );

    // And a zero amount is not a payout, wherever it sits.
    let mut zero = good.clone();
    zero.push((16, 0));
    assert_refused(env.commit(1, [1u8; 32], &zero), "6086", "PayoutZero");

    // Nothing landed: the pool is still Sealed and committable.
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 1, "Sealed");

    // Commit the proper list.
    env.commit(1, [1u8; 32], &good).unwrap();

    // Paying seat 0 with a DIFFERENT player's wallet rejects: the Entry
    // account is the on-chain seat→player map.
    let (p2, _) = &players[1];
    let (_, e1) = &players[0];
    let ix = env.pay_ix(1, &[0], &[(p2.pubkey(), *e1)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6031") || err.contains("WinnerMismatch"),
        "{err}"
    );

    // A seat outside the committed list rejects (17th place).
    let (p17, e17) = &players[16];
    let ix = env.pay_ix(1, &[16], &[(p17.pubkey(), *e17)]);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6045") || err.contains("SeatNotInPayouts"),
        "{err}"
    );
}
