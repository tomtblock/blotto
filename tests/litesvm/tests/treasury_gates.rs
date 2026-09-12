//! D-A1 (revised, master prompt v2 2026-08-27) acceptance against the
//! compiled artifact: the SEQUENTIAL rule (a tier's next pool opens only
//! after the previous is Paid or Refunded), the treasury policy gate, the
//! withdraw floor (minimum + idle-tier reserve + refundable entries), and
//! the tier ladder's unlock thresholds from a 4 SOL bootstrap (D-E1).
//!
//! The lifecycle suite covers the other v2-named cases in situ: the pot is
//! locked in the vault before the first register, and the refund fork
//! returns the untouched pot to the treasury.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer;

fn fill_reveal_commit_pay(env: &mut Env, pool_id: u64) {
    let mut players = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(pool_id).unwrap());
    }
    let settlement = env.settlement.insecure_clone();
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), pool_id, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).expect("reveal");
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&winner_payout(TIER_POTS[0])));
    let ix = settle_ix(&settlement.pubkey(), pool_id, "commit_results", &args);
    env.send(&[ix], &[&settlement]).expect("commit");
    // D-E2: one committed seat — the winner.
    let (p, e) = &players[0];
    let ix = pay_prizes_ix(&settlement.pubkey(), pool_id, &[0], &[(p.pubkey(), *e)]);
    env.send(&[ix], &[&settlement]).expect("pay");
    assert_eq!(read_pool(&env.svm, &pool_pda(pool_id)).state, 3, "Paid");
}

#[test]
fn open_blocked_while_the_tiers_prior_pool_is_unpaid() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    env.open_ready_pool(1, 0);

    // A SEALED pool is not enough (this is where R14 used to free the slot):
    // fill to 64 and the tier must still refuse a second pool.
    let mut players = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 1, "Sealed");
    let ix = open_pool_ix(&settlement.pubkey(), 2, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6008") || err.contains("TierAlreadyHasOpenPool"),
        "sealed-but-unpaid must still hold the slot: {err}"
    );

    // Scored is not enough either.
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).unwrap();
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&winner_payout(TIER_POTS[0])));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &args);
    env.send(&[ix], &[&settlement]).unwrap();
    let ix = open_pool_ix(&settlement.pubkey(), 2, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6008"), "scored-but-unpaid: {err}");

    // Paid frees it: settling the winner unlocks the next open.
    let (p, e) = &players[0];
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0], &[(p.pubkey(), *e)]);
    env.send(&[ix], &[&settlement]).unwrap();
    assert_eq!(read_config(&env.svm).active_pool_by_tier[0], 0);
    // ...after the cooldown (prompt v2 §B.6) — `keeper_and_timing.rs` pins
    // the cooldown itself; here it is just waited out.
    env.advance_time(5 * 60);
    let ix = open_pool_ix(&settlement.pubkey(), 2, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement])
        .expect("Paid unlocks the tier's next pool");
}

#[test]
fn open_blocked_when_the_policy_floor_is_unmet() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();

    // Enable tiers 0 and 1. Policy: reserve_pots = 1, min = 1 SOL.
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 0, 0, 0, 0, 0])],
        &[],
    )
    .unwrap();
    let ix = set_treasury_policy_ix(&admin, 1, 1_000_000_000);
    env.send(&[ix], &[]).unwrap();

    // Opening tier 0 needs: pot(4) + its vault's rent cushion + min(1) +
    // tier 1's idle pot (20) with ITS cushion — a reserved pot is an openable
    // pot — ≈ 25.0018 SOL (D-E1). One lamport short → TreasuryShortfall,
    // nothing moves.
    let needed =
        (TIER_POTS[0] + VAULT_RENT_CUSHION) + 1_000_000_000 + (TIER_POTS[1] + VAULT_RENT_CUSHION);
    env.fund_platform(needed - 1);
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    let err = env
        .send(std::slice::from_ref(&ix), &[&settlement])
        .unwrap_err();
    assert!(
        err.contains("6049") || err.contains("TreasuryShortfall"),
        "{err}"
    );
    assert_eq!(
        env.balance(&vault_pda(1)),
        0,
        "no partial pot: the open reverted entirely"
    );

    // The exact lamport clears it, and exactly the pot moves.
    env.fund_platform(1);
    let platform_before = env.balance(&platform_pda());
    env.send(&[ix], &[&settlement]).expect("open at the floor");
    assert_eq!(
        env.balance(&vault_pda(1)),
        TIER_POTS[0] + VAULT_RENT_CUSHION
    );
    assert_eq!(
        platform_before - env.balance(&platform_pda()),
        TIER_POTS[0] + VAULT_RENT_CUSHION,
        "the treasury funded the pot and the rent cushion"
    );
}

#[test]
fn withdraw_blocked_below_the_floor_including_refundable_entries() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let dest = Pubkey::new_unique();

    // Policy: min = 1 SOL. Only tier 0 enabled and idle → floor also holds
    // one further tier-0 POOL (reserve_pots = 1): its pot and the rent
    // cushion its vault is funded with.
    let ix = set_treasury_policy_ix(&admin, 1, 1_000_000_000);
    env.send(&[ix], &[]).unwrap();
    let floor = 1_000_000_000 + TIER_POTS[0] + VAULT_RENT_CUSHION;
    env.fund_platform(floor + 500_000_000);

    // One lamport past the surplus → refused, nothing moves.
    let ix = withdraw_platform_ix(&admin, &dest, 500_000_001);
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(
        err.contains("6048") || err.contains("WithdrawBelowFloor"),
        "{err}"
    );
    assert_eq!(env.balance(&dest), 0);

    // Exactly the surplus clears.
    let ix = withdraw_platform_ix(&admin, &dest, 500_000_000);
    env.send(&[ix], &[]).expect("withdraw at the floor");
    assert_eq!(env.balance(&dest), 500_000_000);

    // Open a pool and take three entries: the three entry payments are
    // REFUNDABLE and raise the floor by exactly 0.3 SOL — the operator
    // cannot withdraw the players' money while the pool can still refund.
    env.open_ready_pool(1, 0); // tops the treasury up generously
    for _ in 0..3 {
        env.register_player(1).unwrap();
    }
    assert_eq!(read_config(&env.svm).platform_refundable, 300_000_000);
    let balance = env.balance(&platform_pda());
    // The tier is live, so the idle reserve is zero; floor = min + refundable.
    let surplus = balance - 1_000_000_000 - 300_000_000;
    let ix = withdraw_platform_ix(&admin, &dest, surplus + 1);
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(
        err.contains("6048") || err.contains("WithdrawBelowFloor"),
        "refundable entries must be unwithdrawable: {err}"
    );
    let ix = withdraw_platform_ix(&admin, &dest, surplus);
    env.send(&[ix], &[])
        .expect("surplus above refundable clears");
}

/// The seven-tier ladder from the founder's 4 SOL bootstrap (D-E1): with
/// every tier enabled and `reserve_pots = 1`, each tier's unlock threshold
/// is its own pot plus one pot of every other idle tier — asserted here to
/// the lamport by funding one lamport under (blocked) and at (opens) each
/// rung. The revenue GRIND that walks the treasury up this ladder for real
/// (64 entries per pool, +2.4 SOL net per tier-0 pool) is the Phase 5
/// rehearsal's 20-pool run — this test pins the gate arithmetic the ladder
/// climbs against.
#[test]
fn seven_tier_ladder_unlocks_at_exact_thresholds_from_bootstrap() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 1, 1, 1, 1, 1])],
        &[],
    )
    .unwrap();

    // The bootstrap: exactly one tier-0 pool's funding — its pot and its
    // vault's rent cushion. With six other ENABLED idle tiers each demanding
    // a reserve pool, tier 0 cannot open yet — the founder's launch posture
    // is all-tiers-enabled only once the treasury can carry them; at one
    // pool's funding only a tier-0-only config opens.
    env.fund_platform(TIER_POTS[0] + VAULT_RENT_CUSHION);
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(err.contains("6049"), "{err}");

    // Tier-0-only: one pool's funding is EXACTLY the tier-0 threshold.
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 0, 0, 0, 0, 0, 0])],
        &[],
    )
    .unwrap();
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement])
        .expect("the one-pot bootstrap opens the first tier-0 pool");
    let pool1 = 1u64;

    // Re-enable everything and climb: with tier 0 LIVE, tier t's threshold
    // is (pot(t) + cushion) + Σ (pot(u) + cushion) for every other idle
    // enabled tier u — funding one lamport under blocks, the exact threshold
    // opens. The cushion rides on every pot because a reserved pot is an
    // openable pot (treasury.rs, 2026-09-12).
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 1, 1, 1, 1, 1])],
        &[],
    )
    .unwrap();
    let mut next_pool = 2u64;
    for tier in 1u8..7 {
        // Idle enabled tiers right now: tiers > `tier` (lower ones are live).
        let idle_reserve: u64 = (1..7)
            .filter(|&t| t != tier as usize && read_config(&env.svm).active_pool_by_tier[t] == 0)
            .map(|t| TIER_POTS[t] + VAULT_RENT_CUSHION)
            .sum();
        let threshold = TIER_POTS[tier as usize] + VAULT_RENT_CUSHION + idle_reserve;
        let balance = env.balance(&platform_pda());
        let ix = open_pool_ix(
            &settlement.pubkey(),
            next_pool,
            tier,
            [9; 32],
            env.sealing_secret_hash,
        );
        if balance < threshold {
            // Fund to one lamport UNDER the threshold: blocked.
            env.fund_platform(threshold - balance - 1);
            let err = env
                .send(std::slice::from_ref(&ix), &[&settlement])
                .unwrap_err();
            assert!(err.contains("6049"), "tier {tier} rung short: {err}");
            // The exact lamport unlocks the rung.
            env.fund_platform(1);
        } else {
            // The RESERVE property: opening the previous rung at its exact
            // threshold leaves the treasury holding precisely this rung's
            // threshold (its pot was in the previous rung's idle reserve) —
            // and the withdraw floor pins every lamport of it, so the
            // operator cannot drain the ladder out from under the tiers.
            assert_eq!(
                balance, threshold,
                "tier {tier} rung should be exactly pre-funded by the reserve"
            );
            let wd = withdraw_platform_ix(&admin, &Pubkey::new_unique(), 1);
            let err = env.send(&[wd], &[]).unwrap_err();
            assert!(
                err.contains("6048") || err.contains("WithdrawBelowFloor"),
                "the reserve must be unwithdrawable: {err}"
            );
        }
        env.send(&[ix], &[&settlement])
            .unwrap_or_else(|e| panic!("tier {tier} rung at threshold: {e}"));
        next_pool += 1;
    }
    // All seven live at once — the ladder is fully unlocked.
    let cfg = read_config(&env.svm);
    for t in 0..7 {
        assert_ne!(cfg.active_pool_by_tier[t], 0, "tier {t} live");
    }
    let _ = pool1;
}

/// The tier-0 revenue loop end-to-end: a full pool nets the treasury
/// +2.4 SOL (6.4 SOL of entries in, the 4 SOL D-E1 pot out and paid), and
/// the tier reopens after its cooldown from its own retained economics.
#[test]
fn a_paid_pool_grows_the_treasury_by_its_net_margin() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    env.fund_platform(TIER_POTS[0] + VAULT_RENT_CUSHION);
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement]).expect("open");
    patch_vrf_seed(&mut env.svm, &pool_pda(1), [5u8; 32]);
    let ix = create_pass_collection_ix(&settlement.pubkey(), 1);
    env.send(&[ix], &[&settlement]).unwrap();

    fill_reveal_commit_pay(&mut env, 1);

    // Treasury: one pool's funding in, the same out to the vault (pot and
    // cushion), + 6.4 SOL of entries = 6.4 SOL; the margin over the bootstrap
    // is 64 × 0.0375 = 2.4 SOL (D-E1), and the tier can fund its next pool
    // from the balance alone.
    assert_eq!(env.balance(&platform_pda()), 64 * TIER_PRICES[0]);
    env.advance_time(5 * 60); // the tier's cooldown
    let ix = open_pool_ix(&settlement.pubkey(), 2, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement])
        .expect("the tier funds its own next pot from revenue");
}
