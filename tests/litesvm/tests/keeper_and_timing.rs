//! The 2026-09-07 upgrade's operational half against the compiled artifact
//! (prompt v2 §A, §B.6, §G; founder rulings 1 and 2):
//!
//!   - `migrate_config` grows a PRE-upgrade Config (380 bytes) to the new
//!     layout in place, admin-only, once; every other instruction is dead
//!     between the upgrade and that transaction, and alive after it;
//!   - the keeper opens pools; a tier idle for 24 h past its cooldown opens
//!     for anyone (the liveness fallback). Since the security fix of
//!     2026-09-07 a tier that has never settled a pool is NOT open to anyone:
//!     `init_config`, `migrate_config` and `set_open_tiers` all stamp
//!     `tier_next_open_at`, because at zero the fallback window sits decades
//!     in the past and the opener chooses the pool's sealing key;
//!   - the four service keys cannot enter a pool;
//!   - a settled tier cools down for `cooldown_seconds` before its next
//!     pool, stamped in `tier_next_open_at`;
//!   - `set_pool_timing` changes the deadline for pools opened from now on
//!     and never moves a pool players already entered; zero is refused.

use blotto_litesvm_tests::*;
use solana_sdk::clock::Clock;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const FILL_DEADLINE_SECS: i64 = 12 * 60 * 60; // DEFAULT_FILL_DEADLINE_SECS
const COOLDOWN_SECS: i64 = 5 * 60; // DEFAULT_COOLDOWN_SECS
const LIVENESS_FALLBACK_SECS: i64 = 24 * 60 * 60;

fn now(env: &Env) -> i64 {
    env.svm.get_sysvar::<Clock>().unix_timestamp
}

fn funded_keypair(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 100_000_000_000).unwrap();
    k
}

/// Open pool `id` on tier 0 as `opener` (no VRF / collection — enough to
/// exercise the open gates).
fn open_as(env: &mut Env, opener: &Keypair, id: u64) -> Result<(), String> {
    let ix = open_pool_ix(&opener.pubkey(), id, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[opener])
}

/// Take pool `id` (Open, 0 entrants) to Closed via the refund fork — the
/// cheapest way to free a tier slot and stamp its cooldown.
fn close_empty(env: &mut Env, id: u64) {
    env.advance_time(FILL_DEADLINE_SECS + 1);
    let settlement = env.settlement.insecure_clone();
    let ix = trigger_refund_ix(&settlement.pubkey(), id);
    env.send(&[ix], &[&settlement])
        .expect("trigger_refund on an empty pool");
    assert_eq!(read_pool(&env.svm, &pool_pda(id)).state, 5, "Closed");
}

#[test]
fn migrate_config_grows_the_old_account_once_and_revives_every_instruction() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let keeper = Pubkey::new_unique();

    // The migrated layout is what `init_config` writes today; a fresh
    // deployment never migrates.
    let fresh = read_config(&env.svm);
    assert_eq!(fresh.keeper, env.settlement.pubkey());
    let ix = migrate_config_ix(&admin, &keeper);
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(
        err.contains("6062") || err.contains("ConfigAlreadyMigrated"),
        "{err}"
    );

    // Devnet's situation after the upgrade: the account is the OLD size.
    downgrade_config_to_v1(&mut env.svm);
    let old_bytes = env.svm.get_account(&config_pda()).unwrap().data;
    assert_eq!(old_bytes.len(), CONFIG_SPACE_V1);
    // Every instruction that deserialises Config is dead — even a deposit.
    let ix = fund_platform_ix(&admin, 1_000_000_000);
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(
        err.contains("3003") || err.contains("AccountDidNotDeserialize"),
        "an old-layout Config must fail to deserialise: {err}"
    );

    // Only the admin recorded IN the old bytes may migrate.
    let stranger = funded_keypair(&mut env);
    let ix = migrate_config_ix(&stranger.pubkey(), &keeper);
    let err = env.send(&[ix], &[&stranger]).unwrap_err();
    assert!(
        err.contains("6063") || err.contains("ConfigNotMigratable"),
        "{err}"
    );

    // The migration: grows to 484, tops up rent from the admin, writes the
    // tail, touches nothing before it.
    let admin_before = env.balance(&admin);
    let ix = migrate_config_ix(&admin, &keeper);
    env.send(&[ix], &[]).expect("migrate_config");
    let migrated_at = now(&env);
    let acct = env.svm.get_account(&config_pda()).unwrap();
    assert_eq!(acct.data.len(), CONFIG_SPACE);
    assert_eq!(
        &acct.data[..CONFIG_SPACE_V1],
        &old_bytes[..],
        "old bytes untouched"
    );
    assert!(
        acct.lamports >= env.svm.minimum_balance_for_rent_exemption(CONFIG_SPACE),
        "rent-exempt at the new size"
    );
    assert!(
        env.balance(&admin) < admin_before,
        "the admin paid the top-up"
    );
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.keeper, keeper);
    assert_eq!(cfg.fill_deadline_seconds, FILL_DEADLINE_SECS);
    assert_eq!(cfg.cooldown_seconds, COOLDOWN_SECS);
    // Every tier's liveness clock starts at the migration, never at the
    // epoch: a zero would put `open_pool`'s fallback window decades in the
    // past and let any signer open a tier's first pool — choosing its
    // sealing key with it. Security fix of 2026-09-07.
    assert_eq!(cfg.tier_next_open_at, [migrated_at; 7]);
    assert_eq!(cfg.next_pool_id, fresh.next_pool_id, "counter preserved");

    // Self-disabling: a second run is a clean failure, not a second write.
    let ix = migrate_config_ix(&admin, &Pubkey::new_unique());
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(err.contains("6062"), "{err}");
    assert_eq!(
        read_config(&env.svm).keeper,
        keeper,
        "the tail was not rewritten"
    );

    // And the program is alive again: a deposit lands, an admin instruction
    // lands (the keeper rotates back to the settlement signer, the devnet
    // posture), and the keeper opens a pool.
    let ix = fund_platform_ix(&admin, 1_000_000_000);
    env.send(&[ix], &[])
        .expect("a deposit lands after migration");
    env.send(&[set_keeper_ix(&admin, &env.settlement.pubkey())], &[])
        .expect("set_keeper lands after migration");
    env.open_ready_pool(1, 0);
}

#[test]
fn the_keeper_opens_pools_and_a_stale_tier_opens_for_anyone() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let settlement = env.settlement.insecure_clone();
    let keeper = funded_keypair(&mut env);
    env.fund_platform(TIER_POTS[0] * 4);

    // Rotate the keeper away from the settlement signer (the init default).
    env.send(&[set_keeper_ix(&admin, &keeper.pubkey())], &[])
        .expect("set_keeper");
    assert_eq!(read_config(&env.svm).keeper, keeper.pubkey());
    let err = env
        .send(
            &[set_keeper_ix(&settlement.pubkey(), &settlement.pubkey())],
            &[&settlement],
        )
        .unwrap_err();
    assert!(
        err.contains("2001") || err.contains("ConstraintHasOne"),
        "admin only: {err}"
    );

    // A tier that has never settled a pool is NOT open to strangers.
    //
    // Until 2026-09-07 `tier_next_open_at` was seeded to zero, which put the
    // fallback window (`0 + LIVENESS_FALLBACK_SECS`) decades in the past and
    // let any signer open a tier's first pool. That mattered because the
    // opener supplies `sealing_pubkey` and `sealing_secret_hash`: a pool
    // carrying a stranger's sealing key can never be revealed by us, so it
    // can never be settled — and once it seals with `MIN_SEATS` it can no
    // longer refund either, stranding the pot AND every entry. `init_config`
    // now stamps `now`, so the keeper opens immediately and a stranger waits
    // a full fallback window.
    let seeded_at = read_config(&env.svm).tier_next_open_at[0];
    assert!(seeded_at > 0, "init_config stamps the liveness clock");
    let err = open_as(&mut env, &settlement, 1).unwrap_err();
    assert!(
        err.contains("6054") || err.contains("NotKeeper"),
        "a never-settled tier is the keeper's to open: {err}"
    );
    open_as(&mut env, &keeper, 1).expect("the keeper opens the tier's first pool");

    // Settle it (Closed via the empty refund fork): the slot frees and the
    // cooldown is stamped at exactly now + cooldown_seconds.
    close_empty(&mut env, 1);
    let closed_at = now(&env);
    let cfg = read_config(&env.svm);
    assert_eq!(cfg.active_pool_by_tier[0], 0);
    assert_eq!(
        cfg.tier_next_open_at[0],
        closed_at + COOLDOWN_SECS,
        "cooldown stamped"
    );

    // Inside the cooldown nobody opens — not even the keeper.
    let err = open_as(&mut env, &keeper, 2).unwrap_err();
    assert!(
        err.contains("6055") || err.contains("TierCoolingDown"),
        "{err}"
    );
    env.advance_time(COOLDOWN_SECS - 1);
    let err = open_as(&mut env, &keeper, 2).unwrap_err();
    assert!(err.contains("6055"), "one second early: {err}");
    env.advance_time(1);

    // Past the cooldown: the keeper only. The settlement signer (no longer
    // the keeper) and the admin are refused.
    let err = open_as(&mut env, &settlement, 2).unwrap_err();
    assert!(err.contains("6054") || err.contains("NotKeeper"), "{err}");
    let admin_kp = env.admin.insecure_clone();
    let err = open_as(&mut env, &admin_kp, 2).unwrap_err();
    assert!(
        err.contains("6054"),
        "the admin is not the keeper either: {err}"
    );
    open_as(&mut env, &keeper, 2).expect("the keeper opens");

    // The liveness fallback: settle again, then leave the tier idle for the
    // cooldown plus 24 h — a stranger opens it.
    close_empty(&mut env, 2);
    let next_open_at = read_config(&env.svm).tier_next_open_at[0];
    env.advance_time(COOLDOWN_SECS + LIVENESS_FALLBACK_SECS - 1);
    let stranger = funded_keypair(&mut env);
    let err = open_as(&mut env, &stranger, 3).unwrap_err();
    assert!(
        err.contains("6054"),
        "one second before the fallback: {err}"
    );
    env.advance_time(1);
    assert_eq!(now(&env), next_open_at + LIVENESS_FALLBACK_SECS);
    open_as(&mut env, &stranger, 3).expect("a stale tier opens for anyone (liveness)");
}

#[test]
fn the_four_service_keys_cannot_enter() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let keeper = funded_keypair(&mut env);
    env.send(&[set_keeper_ix(&admin, &keeper.pubkey())], &[])
        .unwrap();
    env.open_ready_pool_as(&keeper, 1, 0);

    // The entry signer as a Solana keypair (same ed25519 seed as the
    // harness's signing key, so the same public key).
    let entry_signer = Keypair::new_from_array([7u8; 32]);
    assert_eq!(
        Pubkey::new_from_array(env.entry_signer.verifying_key().to_bytes()),
        entry_signer.pubkey()
    );
    env.svm
        .airdrop(&entry_signer.pubkey(), 10_000_000_000)
        .unwrap();
    let admin_kp = env.admin.insecure_clone();
    let settlement = env.settlement.insecure_clone();

    for (name, key) in [
        ("admin", admin_kp),
        ("settlement signer", settlement),
        ("keeper", keeper),
        ("entry signer", entry_signer),
    ] {
        let err = env.register_as(1, &key).unwrap_err();
        assert!(
            err.contains("6056") || err.contains("ServiceKeyCannotEnter"),
            "{name} must be refused: {err}"
        );
    }
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).entrants, 0);
    // An ordinary wallet still enters.
    env.register_player(1).expect("a player enters");
}

#[test]
fn set_pool_timing_applies_to_future_pools_only() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let settlement = env.settlement.insecure_clone();
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 0, 0, 0, 0, 0])],
        &[],
    )
    .unwrap();
    env.fund_platform(TIER_POTS[0] + TIER_POTS[1] * 2);

    // Pool 1 on tier 0 under the launch timing.
    let t0 = now(&env);
    open_as(&mut env, &settlement, 1).unwrap();
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).fill_deadline,
        t0 + FILL_DEADLINE_SECS
    );

    // Zero is refused on either field; the timing is unchanged.
    for (fd, cd) in [(0i64, COOLDOWN_SECS), (FILL_DEADLINE_SECS, 0i64), (-1, 1)] {
        let err = env
            .send(&[set_pool_timing_ix(&admin, fd, cd)], &[])
            .unwrap_err();
        assert!(
            err.contains("6065") || err.contains("InvalidTiming"),
            "{err}"
        );
    }
    let cfg = read_config(&env.svm);
    assert_eq!(
        (cfg.fill_deadline_seconds, cfg.cooldown_seconds),
        (FILL_DEADLINE_SECS, COOLDOWN_SECS)
    );
    // Admin only.
    let err = env
        .send(
            &[set_pool_timing_ix(&settlement.pubkey(), 3600, 60)],
            &[&settlement],
        )
        .unwrap_err();
    assert!(err.contains("2001"), "{err}");

    // A new timing: one hour, one minute.
    env.send(&[set_pool_timing_ix(&admin, 3600, 60)], &[])
        .expect("set_pool_timing");
    let cfg = read_config(&env.svm);
    assert_eq!(
        (cfg.fill_deadline_seconds, cfg.cooldown_seconds),
        (3600, 60)
    );
    // Pool 1's deadline did not move — players entered under 12 h.
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).fill_deadline,
        t0 + FILL_DEADLINE_SECS
    );
    // Pool 2 (tier 1) opens under the new deadline.
    let ix = open_pool_ix(&settlement.pubkey(), 2, 1, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement]).unwrap();
    assert_eq!(read_pool(&env.svm, &pool_pda(2)).fill_deadline, t0 + 3600);

    // Pool 1 still needs the full 12 h before its fork opens.
    env.advance_time(3601);
    let err = env
        .send(
            &[trigger_refund_ix(&settlement.pubkey(), 1)],
            &[&settlement],
        )
        .unwrap_err();
    assert!(err.contains("6012"), "{err}");
    // Pool 2's hour has passed: it refunds, and its tier's cooldown is the
    // NEW one minute.
    env.send(
        &[trigger_refund_ix(&settlement.pubkey(), 2)],
        &[&settlement],
    )
    .expect("pool 2 past its one-hour deadline");
    assert_eq!(read_config(&env.svm).tier_next_open_at[1], now(&env) + 60);
}

/// Enabling a tier restarts its liveness clock — the 2026-09-07 security fix.
///
/// `open_pool`'s fallback is measured from `tier_next_open_at`. `init_config`
/// stamps every tier at deployment, but a tier can stay disabled for months,
/// so by the time it is switched on that stamp is already a full fallback
/// window old and the FIRST pool of the tier could be opened by any signer
/// watching for `TiersOpened`. The opener chooses `sealing_pubkey` and
/// `sealing_secret_hash`, so a stranger's pool carries a secret our custody
/// does not hold: `reveal_pool_secret` can never land, `commit_results` is
/// blocked behind it, and a pool that reaches `MIN_SEATS` can no longer
/// refund either — the pot and every entry stranded with no instruction able
/// to move them.
///
/// So enabling a tier stamps `now`: the keeper opens immediately (`open_pool`
/// requires `now >= tier_next_open_at`, and `now >= now` holds) and a stranger
/// waits a full fallback window from the moment of enablement.
#[test]
fn enabling_a_tier_starts_its_liveness_clock() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let settlement = env.settlement.insecure_clone();
    let keeper = funded_keypair(&mut env);
    env.send(&[set_keeper_ix(&admin, &keeper.pubkey())], &[])
        .expect("set_keeper");
    env.fund_platform(TIER_POTS.iter().sum::<u64>() * 2);

    // Tier 1 is disabled at launch and carries the deployment stamp.
    let deployed_at = now(&env);
    assert!(!read_config(&env.svm).open_tiers[1]);
    assert_eq!(read_config(&env.svm).tier_next_open_at[1], deployed_at);

    // Leave it disabled for well over a fallback window. Nobody can open a
    // disabled tier, keeper included.
    env.advance_time(LIVENESS_FALLBACK_SECS * 30);
    let stranger = funded_keypair(&mut env);
    let open_tier1 = |env: &mut Env, opener: &Keypair, id: u64| -> Result<(), String> {
        let ix = open_pool_ix(&opener.pubkey(), id, 1, [9; 32], env.sealing_secret_hash);
        env.send(&[ix], &[opener])
    };
    let err = open_tier1(&mut env, &stranger, 1).unwrap_err();
    assert!(
        err.contains("6006") || err.contains("TierNotOpen"),
        "a disabled tier opens for nobody: {err}"
    );
    let err = open_tier1(&mut env, &keeper, 1).unwrap_err();
    assert!(err.contains("6006") || err.contains("TierNotOpen"), "{err}");

    // Enable it. The stamp moves to the moment of enablement — had it stayed
    // at `deployed_at`, the fallback window would already be a month past.
    env.send(
        &[admin_ix(&admin, "set_open_tiers", &[1, 1, 0, 0, 0, 0, 0])],
        &[],
    )
    .expect("set_open_tiers");
    let enabled_at = now(&env);
    assert!(enabled_at > deployed_at + LIVENESS_FALLBACK_SECS);
    let cfg = read_config(&env.svm);
    assert!(cfg.open_tiers[1]);
    assert_eq!(cfg.tier_next_open_at[1], enabled_at, "clock restarts here");
    // Tier 0 was already enabled and is left alone.
    assert_eq!(
        cfg.tier_next_open_at[0], deployed_at,
        "an enabled tier is not restamped"
    );

    // A stranger cannot open the tier's first pool — this is the hole.
    let err = open_tier1(&mut env, &stranger, 1).unwrap_err();
    assert!(
        err.contains("6054") || err.contains("NotKeeper"),
        "a newly enabled tier is the keeper's to open first: {err}"
    );
    // Nor can the settlement signer, which is no longer the keeper.
    let err = open_tier1(&mut env, &settlement, 1).unwrap_err();
    assert!(err.contains("6054"), "{err}");

    // The keeper can, immediately: the stamp is `now`, not `now + cooldown`.
    open_tier1(&mut env, &keeper, 1).expect("the keeper opens at once");

    // And the fallback still works, measured from the stamp: freeing the slot
    // stamps `now + cooldown`, and the window runs from THAT, so a stranger
    // waits the cooldown and then a full window.
    close_empty_tier(&mut env, 1);
    let freed_at = read_config(&env.svm).tier_next_open_at[1];
    assert_eq!(
        freed_at,
        now(&env) + COOLDOWN_SECS,
        "the slot stamps its cooldown"
    );
    let window_opens_in = freed_at - now(&env) + LIVENESS_FALLBACK_SECS;
    env.advance_time(window_opens_in - 1);
    let err = open_tier1(&mut env, &stranger, 2).unwrap_err();
    assert!(err.contains("6054"), "one second early: {err}");
    env.advance_time(1);
    assert_eq!(now(&env), freed_at + LIVENESS_FALLBACK_SECS);
    open_tier1(&mut env, &stranger, 2).expect("the liveness fallback still holds");
}

/// `close_empty` for a pool on any tier: advance past the deadline and take
/// the empty refund fork, which frees the slot and stamps the cooldown.
fn close_empty_tier(env: &mut Env, id: u64) {
    env.advance_time(FILL_DEADLINE_SECS + 1);
    let settlement = env.settlement.insecure_clone();
    let ix = trigger_refund_ix(&settlement.pubkey(), id);
    env.send(&[ix], &[&settlement])
        .expect("trigger_refund on an empty pool");
}
