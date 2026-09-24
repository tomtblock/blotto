//! Phase B (founder rulings 2026-09-24): the HARD ladder against the
//! compiled artifact.
//!
//! One program, two ladders. Every tier now has an easy slot and a hard
//! slot, each with its own enablement switch, live-pool slot and cooldown
//! clock, sharing the tier's price, pot and ceiling. `open_pool` takes the
//! mode as an appended argument and records it on the pool; nothing after
//! the open reads it on-chain — the placing rule is the scoring engine's
//! business, and a hard pool registers, seals, settles and pays exactly as
//! an easy one does.
//!
//!   - the hard ladder starts fully disabled, whatever the easy ladder says,
//!     and only `set_hard_open_tiers` (admin) enables a hard tier; an
//!     unknown mode byte is refused outright;
//!   - an easy and a hard pool run side by side on ONE tier — separate
//!     slots, separate cooldowns, neither blocking the other;
//!   - an idle enabled hard tier reserves a pot in the treasury policy,
//!     exactly as an idle enabled easy tier does;
//!   - a full hard pool settles to Paid and frees the HARD slot;
//!   - `migrate_pool` grows a pre-Phase-B (849-byte) pool by the one byte
//!     it is missing, keeps its floor, and marks it easy.

use blotto_litesvm_tests::*;
use solana_sdk::clock::Clock;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const FILL_DEADLINE_SECS: i64 = 12 * 60 * 60; // DEFAULT_FILL_DEADLINE_SECS
const COOLDOWN_SECS: i64 = 5 * 60; // DEFAULT_COOLDOWN_SECS

fn now(env: &Env) -> i64 {
    env.svm.get_sysvar::<Clock>().unix_timestamp
}

/// Open pool `id` on tier 0 in `mode`, signed by the keeper (the settlement
/// signer at init). No VRF / collection — enough to exercise the gates.
fn open_mode(env: &mut Env, id: u64, mode: u8) -> Result<(), String> {
    let settlement = env.settlement.insecure_clone();
    let ix = open_pool_mode_ix(
        &settlement.pubkey(),
        id,
        0,
        [9; 32],
        env.sealing_secret_hash,
        mode,
    );
    env.send(&[ix], &[&settlement])
}

/// Take pool `id` (Open, 0 entrants) to Closed via the empty refund fork —
/// the cheapest way to free a slot and stamp its cooldown.
fn close_empty(env: &mut Env, id: u64) {
    env.advance_time(FILL_DEADLINE_SECS + 1);
    let settlement = env.settlement.insecure_clone();
    let ix = trigger_refund_ix(&settlement.pubkey(), id);
    env.send(&[ix], &[&settlement])
        .expect("trigger_refund on an empty pool");
    assert_eq!(read_pool(&env.svm, &pool_pda(id)).state, 5, "Closed");
}

#[test]
fn the_hard_ladder_starts_disabled_and_has_its_own_switch() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let settlement = env.settlement.insecure_clone();
    env.fund_platform(TIER_POTS.iter().sum::<u64>() * 3);

    // Launch posture: easy tier 0 enabled, NO hard tier enabled, and the
    // hard clocks stamped at init like the easy ones.
    let deployed_at = now(&env);
    let cfg = read_config(&env.svm);
    assert_eq!(
        cfg.open_tiers,
        [true, false, false, false, false, false, false]
    );
    assert_eq!(cfg.hard_open_tiers, [false; 7]);
    assert_eq!(cfg.hard_active_pool_by_tier, [0; 7]);
    assert_eq!(cfg.hard_tier_next_open_at, [deployed_at; 7]);

    // An easy tier being open says nothing about its hard twin.
    let err = open_mode(&mut env, 1, MODE_HARD).unwrap_err();
    assert!(
        err.contains("6006") || err.contains("TierNotOpen"),
        "hard tier 0 is disabled at launch: {err}"
    );
    // An unknown mode byte is refused before any per-mode read — it can
    // never alias the easy ladder.
    let err = open_mode(&mut env, 1, 2).unwrap_err();
    assert!(err.contains("6074") || err.contains("UnknownMode"), "{err}");
    let err = open_mode(&mut env, 1, 255).unwrap_err();
    assert!(err.contains("6074"), "{err}");
    assert_eq!(read_config(&env.svm).next_pool_id, 1, "nothing opened");

    // Admin only, like `set_open_tiers`.
    let err = env
        .send(
            &[set_hard_open_tiers_ix(
                &settlement.pubkey(),
                [true, false, false, false, false, false, false],
            )],
            &[&settlement],
        )
        .unwrap_err();
    assert!(
        err.contains("2001") || err.contains("ConstraintHasOne"),
        "{err}"
    );

    // Months later the founder enables hard tier 0: the HARD clock is
    // restamped on the edge, the easy ladder is untouched in every field.
    env.advance_time(30 * 24 * 60 * 60);
    env.send(
        &[set_hard_open_tiers_ix(
            &admin,
            [true, false, false, false, false, false, false],
        )],
        &[],
    )
    .expect("set_hard_open_tiers");
    let enabled_at = now(&env);
    let cfg = read_config(&env.svm);
    assert_eq!(
        cfg.hard_open_tiers,
        [true, false, false, false, false, false, false]
    );
    assert_eq!(
        cfg.hard_tier_next_open_at[0], enabled_at,
        "restamped on the edge"
    );
    assert_eq!(
        cfg.hard_tier_next_open_at[1], deployed_at,
        "a tier left disabled keeps its stamp"
    );
    assert_eq!(
        cfg.open_tiers,
        [true, false, false, false, false, false, false]
    );
    assert_eq!(
        cfg.tier_next_open_at, [deployed_at; 7],
        "the easy clocks did not move"
    );

    // And the hard tier opens for the keeper at once. `mode` is recorded on
    // the pool.
    open_mode(&mut env, 1, MODE_HARD).expect("the keeper opens the first hard pool");
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).mode, MODE_HARD);
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.hard_active_pool_by_tier[0], 1);
    assert_eq!(cfg.active_pool_by_tier[0], 0, "the easy slot is still free");

    // Disabling the hard tier does not touch its live pool, and re-enabling
    // it mid-cooldown never shortens the cooldown (the `max` rule).
    close_empty(&mut env, 1);
    let freed_at = read_config(&env.svm).hard_tier_next_open_at[0];
    assert_eq!(
        freed_at,
        now(&env) + COOLDOWN_SECS,
        "the hard slot stamps its cooldown"
    );
    env.send(&[set_hard_open_tiers_ix(&admin, [false; 7])], &[])
        .expect("disable");
    env.send(
        &[set_hard_open_tiers_ix(
            &admin,
            [true, false, false, false, false, false, false],
        )],
        &[],
    )
    .expect("re-enable");
    assert_eq!(
        read_config(&env.svm).hard_tier_next_open_at[0],
        freed_at,
        "a running cooldown is never shortened by a re-enable"
    );
}

#[test]
fn easy_and_hard_pools_run_side_by_side_on_one_tier() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    env.send(
        &[set_hard_open_tiers_ix(
            &admin,
            [true, false, false, false, false, false, false],
        )],
        &[],
    )
    .unwrap();
    env.fund_platform(TIER_POTS.iter().sum::<u64>() * 3);

    // Easy pool 1 and hard pool 2, both tier 0, both live: two slots.
    open_mode(&mut env, 1, MODE_EASY).expect("easy opens");
    open_mode(&mut env, 2, MODE_HARD).expect("hard opens beside it");
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).mode, MODE_EASY);
    assert_eq!(read_pool(&env.svm, &pool_pda(2)).mode, MODE_HARD);
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.active_pool_by_tier[0], 1);
    assert_eq!(cfg.hard_active_pool_by_tier[0], 2);
    assert_eq!(cfg.next_pool_id, 3, "one id sequence across both ladders");
    // Each pool has its own vault, funded with its own pot.
    assert_eq!(
        env.balance(&vault_pda(1)),
        TIER_POTS[0] + VAULT_RENT_CUSHION
    );
    assert_eq!(
        env.balance(&vault_pda(2)),
        TIER_POTS[0] + VAULT_RENT_CUSHION
    );

    // The SEQUENTIAL rule holds per ladder: a second pool of either mode is
    // refused while that ladder's pool is live.
    let err = open_mode(&mut env, 3, MODE_EASY).unwrap_err();
    assert!(
        err.contains("6008") || err.contains("TierAlreadyHasOpenPool"),
        "{err}"
    );
    let err = open_mode(&mut env, 3, MODE_HARD).unwrap_err();
    assert!(err.contains("6008"), "{err}");

    // Close the HARD pool: the hard slot frees and stamps ITS cooldown; the
    // easy pool and the easy clock are untouched.
    let easy_stamp_before = read_config(&env.svm).tier_next_open_at[0];
    close_empty(&mut env, 2);
    let closed_at = now(&env);
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.hard_active_pool_by_tier[0], 0, "hard slot freed");
    assert_eq!(cfg.hard_tier_next_open_at[0], closed_at + COOLDOWN_SECS);
    assert_eq!(cfg.active_pool_by_tier[0], 1, "the easy pool is still live");
    assert_eq!(
        cfg.tier_next_open_at[0], easy_stamp_before,
        "the easy clock did not move"
    );
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).state,
        0,
        "easy pool still Open"
    );

    // Inside the hard cooldown nobody opens a hard pool; the easy ladder is
    // still held by its own live pool, for its own reason.
    let err = open_mode(&mut env, 3, MODE_HARD).unwrap_err();
    assert!(
        err.contains("6055") || err.contains("TierCoolingDown"),
        "{err}"
    );
    let err = open_mode(&mut env, 3, MODE_EASY).unwrap_err();
    assert!(err.contains("6008"), "{err}");
    env.advance_time(COOLDOWN_SECS);
    open_mode(&mut env, 3, MODE_HARD).expect("past its cooldown the hard ladder opens again");
    assert_eq!(read_config(&env.svm).hard_active_pool_by_tier[0], 3);

    // Pool 1 was opened while pool 2's clock ran; the easy pool's own
    // deadline is untouched by anything the hard ladder did. Close it and
    // the EASY slot frees, leaving the hard pool live.
    // (Its deadline passed during `close_empty(2)` — 12 h + 1 s.)
    let settlement = env.settlement.insecure_clone();
    let ix = trigger_refund_ix(&settlement.pubkey(), 1);
    env.send(&[ix], &[&settlement])
        .expect("easy pool refunds empty");
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.active_pool_by_tier[0], 0);
    assert_eq!(
        cfg.hard_active_pool_by_tier[0], 3,
        "the hard pool is untouched"
    );
}

/// The treasury policy sees two ladders: an idle ENABLED hard tier reserves
/// `reserve_pots` further pots exactly as an idle enabled easy tier does,
/// at the tier's shared pot. Pinned to the lamport, both at `open_pool`'s
/// gate and at `withdraw_platform`'s floor.
#[test]
fn an_idle_enabled_hard_tier_reserves_a_pot() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let settlement = env.settlement.insecure_clone();
    // reserve_pots = 1, min = 0; easy tier 0 (launch) and hard tier 0.
    env.send(&[set_treasury_policy_ix(&admin, 1, 0)], &[])
        .unwrap();
    env.send(
        &[set_hard_open_tiers_ix(
            &admin,
            [true, false, false, false, false, false, false],
        )],
        &[],
    )
    .unwrap();

    // Opening EASY tier 0 needs its own funding plus one reserved pool for
    // the idle hard tier 0: 2 × (pot + cushion). One lamport short blocks.
    let per_pool = TIER_POTS[0] + VAULT_RENT_CUSHION;
    env.fund_platform(2 * per_pool - 1);
    let err = open_mode(&mut env, 1, MODE_EASY).unwrap_err();
    assert!(
        err.contains("6049") || err.contains("TreasuryShortfall"),
        "the idle hard tier must be reserved for: {err}"
    );
    env.fund_platform(1);
    open_mode(&mut env, 1, MODE_EASY).expect("the exact lamport opens it");
    assert_eq!(
        env.balance(&platform_pda()),
        per_pool,
        "exactly one reserved pool remains"
    );

    // The withdraw floor counts the same idle hard pool: with easy tier 0
    // live, the floor is one pool's funding, so not one lamport leaves.
    let dest = solana_sdk::pubkey::Pubkey::new_unique();
    let ix = withdraw_platform_ix(&admin, &dest, 1);
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(
        err.contains("6048") || err.contains("WithdrawBelowFloor"),
        "{err}"
    );
    // Disable the hard tier and the reserve is gone: the lamport leaves.
    env.send(&[set_hard_open_tiers_ix(&admin, [false; 7])], &[])
        .unwrap();
    let ix = withdraw_platform_ix(&admin, &dest, per_pool);
    env.send(&[ix], &[])
        .expect("nothing idle and enabled: the whole balance is surplus");
    assert_eq!(env.balance(&dest), per_pool);

    // And the mirror image: the hard open reserves for the idle easy tier.
    // Free the easy slot (empty refund fork), re-enable hard, and hard tier
    // 0's threshold is again 2 × (pot + cushion) — the easy tier is idle.
    close_empty(&mut env, 1);
    env.send(
        &[set_hard_open_tiers_ix(
            &admin,
            [true, false, false, false, false, false, false],
        )],
        &[],
    )
    .unwrap();
    let balance = env.balance(&platform_pda());
    // The refund fork returned pool 1's untouched pot; top up to one under.
    env.fund_platform(2 * per_pool - 1 - balance);
    let err = open_mode(&mut env, 2, MODE_HARD).unwrap_err();
    assert!(
        err.contains("6049"),
        "the idle easy tier must be reserved for: {err}"
    );
    env.fund_platform(1);
    open_mode(&mut env, 2, MODE_HARD).expect("the exact lamport opens the hard pool");
    let _ = settlement;
}

/// Nothing after `open_pool` reads `mode` on-chain: a hard pool takes
/// entries, seals at the 64th seat, reveals, commits and pays exactly as an
/// easy one, and reaching Paid frees the HARD slot.
#[test]
fn a_full_hard_pool_settles_like_an_easy_one_and_frees_the_hard_slot() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    env.send(
        &[set_hard_open_tiers_ix(
            &admin,
            [true, false, false, false, false, false, false],
        )],
        &[],
    )
    .unwrap();
    env.open_ready_pool_mode(1, 0, MODE_HARD);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).mode, MODE_HARD);

    let mut players: Vec<(Keypair, solana_sdk::pubkey::Pubkey)> = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!(pv.state, 1, "Sealed at the 64th seat");
    assert_eq!(pv.entrants, 64);
    assert_eq!(pv.mode, MODE_HARD, "the mode survives the seal");

    let settlement = env.settlement.insecure_clone();
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).expect("reveal");
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&winner_payout(TIER_POTS[0])));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &args);
    env.send(&[ix], &[&settlement]).expect("commit");
    let (p, e) = &players[0];
    let before = env.balance(&p.pubkey());
    let ix = pay_prizes_ix(&settlement.pubkey(), 1, &[0], &[(p.pubkey(), *e)]);
    env.send(&[ix], &[&settlement]).expect("pay");
    assert_eq!(
        env.balance(&p.pubkey()) - before,
        TIER_POTS[0],
        "winner takes the pot"
    );
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");

    let cfg = read_config(&env.svm);
    assert_eq!(cfg.hard_active_pool_by_tier[0], 0, "the HARD slot freed");
    assert_eq!(cfg.hard_tier_next_open_at[0], now(&env) + COOLDOWN_SECS);
    assert_eq!(
        cfg.active_pool_by_tier[0], 0,
        "the easy slot was never taken"
    );
}

/// `migrate_pool` on a pool devnet opened between R7-b and Phase B: 849
/// bytes, floor present, `mode` absent. Grown by one byte, floor KEPT (not
/// rewritten to `MIN_SEATS_V1`), `mode` = easy.
#[test]
fn migrate_pool_grows_a_pre_phase_b_pool_by_one_byte_and_marks_it_easy() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let pool = pool_pda(1);
    // Give it a floor that is neither constant, so the test can tell
    // "kept" from "rewritten": 45 is not 40 and not 52.
    patch_min_seats(&mut env.svm, &pool, 45);
    shrink_pool_to_v2(&mut env.svm, &pool);
    assert_eq!(
        env.svm.get_account(&pool).unwrap().data.len(),
        POOL_SPACE_V2
    );

    let rando = Keypair::new();
    env.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    env.send(&[migrate_pool_ix(&rando.pubkey(), 1)], &[&rando])
        .expect("anyone may migrate a pool");

    assert_eq!(
        env.svm.get_account(&pool).unwrap().data.len(),
        POOL_SPACE,
        "the account grew by one byte"
    );
    assert_eq!(
        read_min_seats(&env.svm, &pool),
        45,
        "the floor it carried is kept"
    );
    let pv = read_pool(&env.svm, &pool);
    assert_eq!(
        pv.mode, MODE_EASY,
        "a pool that predates the field played easy"
    );
    assert_eq!(pv.state, 0, "still Open");
    assert_eq!(pv.pot_lamports, TIER_POTS[0]);

    // Refused a second time.
    let err = env
        .send(&[migrate_pool_ix(&rando.pubkey(), 1)], &[&rando])
        .unwrap_err();
    assert!(
        err.contains("6072") || err.contains("PoolAlreadyMigrated"),
        "{err}"
    );

    // And the migrated pool plays by the floor it kept: 44 seats is below
    // 45, so the deadline refunds rather than seals.
    for _ in 0..44 {
        env.register_player(1).unwrap();
    }
    env.advance_time(FILL_DEADLINE_SECS + 1);
    let settlement = env.settlement.insecure_clone();
    let err = env
        .send(
            &[seal_at_deadline_ix(&settlement.pubkey(), 1)],
            &[&settlement],
        )
        .unwrap_err();
    assert!(
        err.contains("6051") || err.contains("FieldBelowMinimum"),
        "44 is below the kept floor of 45: {err}"
    );
}
