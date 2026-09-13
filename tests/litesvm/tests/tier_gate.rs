//! The launch tier gate (founder instruction 2026-09-12 §2).
//!
//! Only tier 0 — the 0.1 SOL entry — may open a pool at launch (R6 as
//! amended by D1). `gates.rs` already proves the two ends of that: a closed
//! tier is refused, and a non-admin cannot call `set_open_tiers`. What was
//! never covered is the middle, which is the case the founder will actually
//! run: opening ONE tier and leaving the rest shut.
//!
//! That matters because of the gate's ORDER. `open_pool` checks the tier
//! bitmap third, before the cooldown, the keeper and the ceiling, and a test
//! that opens every tier at once (as `gates.rs` does, to reach the ceiling
//! assertions) cannot tell a per-tier check from a global one. If
//! `open_tiers` were ever read as "any tier is open", every one of these
//! would still pass there and fail here.
//!
//! The stakes are not hypothetical. The pre-flight of 2026-09-13 read the
//! devnet config and found six tiers still carrying their pre-D-E1 pots:
//! tier 1 says 25.6 SOL where the ratified table says 20. `open_pool` funds
//! a vault from the treasury at whatever `Config` holds, so this bitmap is
//! the only thing between that config and a pool that publishes a prize we
//! did not intend. `scripts/admin.ts set-open-tiers` refuses such a tier
//! before it is opened; these tests cover the program half.

use blotto_litesvm_tests::*;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

/// Every tier but 0 is shut at `init_config`, one at a time.
///
/// `gates.rs` asserts this for tier 1 alone. Tiers 2-6 were never checked,
/// and they are the ones carrying the wrong pots.
#[test]
fn every_tier_but_the_launch_tier_is_shut_at_init() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    // Fund past the treasury gate so a refusal here is about the TIER and
    // not about the money — the gate order puts the tier check first, but a
    // funded treasury keeps the assertion honest either way.
    env.fund_platform(4_000_000_000_000);

    for tier in 1u8..7 {
        let ix = open_pool_ix(&settlement.pubkey(), 1, tier, [9; 32], env.sealing_secret_hash);
        let err = env.send(&[ix], &[&settlement]).unwrap_err();
        assert!(
            err.contains("6006") || err.contains("TierNotOpen"),
            "tier {tier} must be shut at launch: {err}"
        );
    }

    // And tier 0 opens, so the loop above is proving a closed gate rather
    // than a broken environment.
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement])
        .expect("the launch tier opens");
}

/// Opening ONE tier opens exactly that tier.
///
/// The founder's runbook step is `--tiers 1,1,0,0,0,0,0`: tier 1 joins tier
/// 0 and nothing else moves. This is the assertion that the bitmap is read
/// per index.
#[test]
fn opening_one_tier_opens_exactly_that_tier() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();
    env.fund_platform(4_000_000_000_000);

    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 0, 0, 0, 0, 0])],
        &[],
    )
    .expect("set_open_tiers");

    // Tier 1 now opens.
    let ix = open_pool_ix(&settlement.pubkey(), 1, 1, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement])
        .expect("tier 1 opens once enabled");

    // Tier 2 — the very next index — is still refused. An off-by-one in the
    // bitmap read shows up exactly here.
    let ix = open_pool_ix(&settlement.pubkey(), 2, 2, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6006") || err.contains("TierNotOpen"),
        "tier 2 must stay shut: {err}"
    );

    // So is tier 6, at the far end of the array.
    let ix = open_pool_ix(&settlement.pubkey(), 2, 6, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6006") || err.contains("TierNotOpen"),
        "tier 6 must stay shut: {err}"
    );
}

/// Closing a tier stops the NEXT pool and never touches the open one.
///
/// The same shape as the vault ceiling's rule (D2, `gates.rs`), and the
/// reason the landing page still lists a tier holding an Open pool even
/// when the founder has shut it: `register` never reads `open_tiers`, so
/// players already seated are unaffected.
#[test]
fn closing_a_tier_blocks_the_next_open_not_the_open_pool() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();
    env.fund_platform(4_000_000_000_000);

    env.open_ready_pool(1, 0);
    env.register_player(1).expect("entries work before the close");

    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[0, 0, 0, 0, 0, 0, 0])],
        &[],
    )
    .expect("close every tier");

    // The pool that is already Open keeps taking entries: the bitmap gates
    // `open_pool` and nothing else.
    env.register_player(1)
        .expect("a seated pool keeps taking entries after its tier closes");

    // But no new pool opens anywhere.
    for tier in 0u8..7 {
        let ix = open_pool_ix(&settlement.pubkey(), 2, tier, [9; 32], env.sealing_secret_hash);
        let err = env.send(&[ix], &[&settlement]).unwrap_err();
        assert!(
            err.contains("6006") || err.contains("TierNotOpen"),
            "tier {tier} must be shut after closing all: {err}"
        );
    }
}

/// A stranger cannot open a tier — restated here because this bitmap is the
/// launch gate, and `gates.rs` proves it inside a loop over nine
/// instructions where a regression would be easy to misread.
#[test]
fn only_the_admin_moves_the_bitmap() {
    let Some(mut env) = Env::new() else { return };
    let mallory = Keypair::new();
    env.svm.airdrop(&mallory.pubkey(), 1_000_000_000).unwrap();

    let ix = admin_ix(&mallory.pubkey(), "set_open_tiers", &[1, 1, 1, 1, 1, 1, 1]);
    let err = env.send(&[ix], &[&mallory]).unwrap_err();
    // Anchor ConstraintHasOne = 2001.
    assert!(
        err.contains("2001"),
        "only the admin (the Squads vault) may open a tier: {err}"
    );

    // The bitmap is unchanged: tier 1 is still refused.
    let settlement = env.settlement.insecure_clone();
    env.fund_platform(4_000_000_000_000);
    let ix = open_pool_ix(&settlement.pubkey(), 1, 1, [9; 32], env.sealing_secret_hash);
    let err = env.send(&[ix], &[&settlement]).unwrap_err();
    assert!(
        err.contains("6006") || err.contains("TierNotOpen"),
        "a refused set_open_tiers must leave the bitmap alone: {err}"
    );
}
