//! The Ladder's two migrations (D-E19) against the compiled artifact.
//!
//!   - `migrate_pool` grows a pre-Ladder (850-byte) pool to 869 bytes and
//!     records what its players entered under: 64 seats, ONE paid place, and
//!     its prize pool in whole entries — `[40]` at 4 SOL / 0.1 SOL — keeping
//!     its floor and its mode; a migrated pool then plays, seals and settles
//!     winner-takes-all by that record;
//!   - a pool whose prize pool is NOT a whole number of entries (devnet pool
//!     #1, 5.12 SOL) can be recorded only if it never played: Closed or
//!     Refunding get no table (`paid_places = 0`); Open — it could still
//!     play — and Sealed are refused (`MigrationUnrepresentable`), as is a
//!     prize pool of more than 255 entries;
//!   - `migrate_config` grows the Phase B (603-byte) Config to 605, writing
//!     `enabled_pool_types = 0`, admin-only, once.

use blotto_litesvm_tests::*;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const ENTRY: u64 = 100_000_000; // tier 0
const POT: u64 = 4_000_000_000; // 40 entries
/// Devnet pool #1's prize pool, from before D-E1: not a whole number of
/// 0.1 SOL entries.
const ODD_POT: u64 = 5_120_000_000;

fn one_place(multiple: u8) -> [u8; 16] {
    let mut t = [0u8; 16];
    t[0] = multiple;
    t
}

fn rando(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    k
}

#[test]
fn migrate_pool_records_a_pre_ladder_pool_as_64_seats_one_place_and_its_pot_in_entries() {
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
    // An easy pool and a HARD one (Phase B pools could be either), both at
    // the pre-Ladder 850 bytes, rent-exempt only for 850.
    env.open_ready_pool(1, 0);
    env.open_ready_pool_mode(2, 0, MODE_HARD);
    patch_min_seats(&mut env.svm, &pool_pda(2), 45); // a floor to keep
    let payer = rando(&mut env);
    for id in [1u64, 2] {
        shrink_pool_to_v3(&mut env.svm, &pool_pda(id));
        assert_eq!(
            env.svm.get_account(&pool_pda(id)).unwrap().data.len(),
            POOL_SPACE_V3
        );
        // Dead until migrated: the program cannot read a short pool.
        let err = env.register_player(id).unwrap_err();
        assert!(
            err.contains("3003") || err.contains("AccountDidNotDeserialize"),
            "{err}"
        );
    }
    let payer_before = env.balance(&payer.pubkey());
    for id in [1u64, 2] {
        env.send(&[migrate_pool_ix(&payer.pubkey(), id)], &[&payer])
            .expect("anyone may migrate a pool");
        let acct = env.svm.get_account(&pool_pda(id)).unwrap();
        assert_eq!(acct.data.len(), POOL_SPACE);
        assert!(acct.lamports >= env.svm.minimum_balance_for_rent_exemption(POOL_SPACE));
    }
    assert!(
        env.balance(&payer.pubkey()) < payer_before,
        "the caller paid the top-up"
    );

    let easy = read_pool(&env.svm, &pool_pda(1));
    assert_eq!(
        (
            easy.capacity,
            easy.paid_places,
            easy.prize_table,
            easy.min_seats,
            easy.mode
        ),
        (64, 1, one_place(40), 40, MODE_EASY)
    );
    let hard = read_pool(&env.svm, &pool_pda(2));
    assert_eq!(
        (
            hard.capacity,
            hard.paid_places,
            hard.prize_table,
            hard.min_seats,
            hard.mode
        ),
        (64, 1, one_place(40), 45, MODE_HARD),
        "the floor and the mode it carried are KEPT"
    );
    // Everything ahead of the tail is untouched.
    assert_eq!((easy.state, easy.entrants, easy.pot_lamports), (0, 0, POT));

    // Once only.
    assert_refused(
        env.send(&[migrate_pool_ix(&payer.pubkey(), 1)], &[&payer]),
        "6072",
        "PoolAlreadyMigrated",
    );
}

/// A pre-Ladder pool caught mid-play — Sealed, its players seated under
/// winner-takes-all — is migrated and then settles exactly as they entered:
/// the whole prize pool to one seat, which `commit_results`' first-prize
/// bound (`[40] × 0.1 SOL = 4 SOL`) admits, and one place only.
#[test]
fn a_migrated_sealed_pool_settles_winner_takes_all() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let players = env.register_n(1, 64);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 1, "Sealed");
    shrink_pool_to_v3(&mut env.svm, &pool_pda(1));
    let payer = rando(&mut env);
    env.send(&[migrate_pool_ix(&payer.pubkey(), 1)], &[&payer])
        .expect("a Sealed pool with a whole-entry pot migrates");
    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!((pv.state, pv.paid_places, pv.prize_table[0]), (1, 1, 40));

    env.reveal(1);
    // First place here IS the whole prize pool (`[40]` × 0.1 SOL), so the
    // single winner's row sits exactly at `commit_results`' first-prize
    // bound — the bound that refuses the same row in every Ladder pool.
    // (Which seats a list pays is the published rule's business, recomputed
    // off chain: the program bounds amounts and the total, it does not rank.)
    env.commit(1, [1u8; 32], &winner_payout(POT))
        .expect("winner takes all");
    let deltas = env.pay_all(1, &players, &winner_payout(POT));
    assert_eq!(deltas, vec![POT]);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
    assert_eq!(env.balance(&vault_pda(1)), VAULT_RENT_CUSHION);
    // And its pool type's slot — held, because this harness opened the pool
    // under the Ladder — is freed.
    assert_eq!(
        read_pool_type(&env.svm, &env.pool_type_of(1)).active_pool,
        0
    );
}

#[test]
fn migrate_pool_refuses_a_pool_that_could_play_with_a_pot_that_is_not_whole_entries() {
    let Some(mut env) = Env::new() else { return };
    let payer = rando(&mut env);
    let migrate =
        |env: &mut Env, id: u64| env.send(&[migrate_pool_ix(&payer.pubkey(), id)], &[&payer]);

    // Open (it could still play), 5.12 SOL: refused, left exactly as it was.
    env.open_ready_pool(1, 0);
    patch_pool_bytes(&mut env.svm, &pool_pda(1), 25, &ODD_POT.to_le_bytes());
    shrink_pool_to_v3(&mut env.svm, &pool_pda(1));
    let before = env.svm.get_account(&pool_pda(1)).unwrap();
    assert_refused(migrate(&mut env, 1), "6088", "MigrationUnrepresentable");
    assert_eq!(
        env.svm.get_account(&pool_pda(1)).unwrap(),
        before,
        "nothing written"
    );

    // More than 255 entries' worth cannot be a u8 multiple either.
    patch_pool_bytes(&mut env.svm, &pool_pda(1), 25, &(256 * ENTRY).to_le_bytes());
    assert_refused(migrate(&mut env, 1), "6088", "MigrationUnrepresentable");
    // 255 entries can.
    patch_pool_bytes(&mut env.svm, &pool_pda(1), 25, &(255 * ENTRY).to_le_bytes());
    migrate(&mut env, 1).expect("255 entries is a u8 multiple");
    assert_eq!(
        read_pool(&env.svm, &pool_pda(1)).prize_table,
        one_place(255)
    );
}

#[test]
fn migrate_pool_refuses_a_sealed_pool_with_a_pot_that_is_not_whole_entries() {
    let Some(mut env) = Env::new() else { return };
    let payer = rando(&mut env);
    env.open_ready_pool(1, 0);
    env.register_n(1, 64);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 1, "Sealed");
    patch_pool_bytes(&mut env.svm, &pool_pda(1), 25, &ODD_POT.to_le_bytes());
    shrink_pool_to_v3(&mut env.svm, &pool_pda(1));
    assert_refused(
        env.send(&[migrate_pool_ix(&payer.pubkey(), 1)], &[&payer]),
        "6088",
        "MigrationUnrepresentable",
    );
    assert_eq!(
        env.svm.get_account(&pool_pda(1)).unwrap().data.len(),
        POOL_SPACE_V3
    );
}

/// Devnet pool #1's case: a pool that NEVER PLAYED — refunded, or still
/// refunding — has nothing to recompute, so it is recorded with no table
/// rather than refused (and so cannot block the runbook's migrate-every-pool
/// step).
#[test]
fn a_pool_that_never_played_is_recorded_with_no_table() {
    let Some(mut env) = Env::new() else { return };
    let payer = rando(&mut env);
    let settlement = env.settlement.insecure_clone();
    // Pool 1: empty, past its deadline → Closed. Pool 2 (another size, so
    // its own slot): two entries → Refunding.
    env.open_ready_pool(1, 0);
    env.open_ready_pool_sized(2, 0, MODE_EASY, 16);
    env.register_n(2, 2);
    env.advance_time(12 * 3600 + 1);
    for id in [1u64, 2] {
        let ix = env.trigger_refund_ix(&settlement.pubkey(), id);
        env.send(&[ix], &[&settlement]).unwrap();
    }
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 5, "Closed");
    assert_eq!(read_pool(&env.svm, &pool_pda(2)).state, 4, "Refunding");

    for id in [1u64, 2] {
        patch_pool_bytes(&mut env.svm, &pool_pda(id), 25, &ODD_POT.to_le_bytes());
        shrink_pool_to_v3(&mut env.svm, &pool_pda(id));
        env.send(&[migrate_pool_ix(&payer.pubkey(), id)], &[&payer])
            .unwrap_or_else(|e| panic!("pool {id}: {e}"));
        let pv = read_pool(&env.svm, &pool_pda(id));
        assert_eq!(
            (pv.capacity, pv.paid_places, pv.prize_table),
            (64, 0, [0u8; 16]),
            "pool {id}: 64 seats, no table"
        );
        assert_eq!(
            pv.pot_lamports, ODD_POT,
            "pool {id}: the prize pool is untouched"
        );
    }
}

#[test]
fn migrate_config_grows_a_603_byte_config_with_no_enabled_types_admin_only_once() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    // Devnet's Config when the Ladder upgrade lands: Phase B's 603 bytes.
    env.advance_time(3600);
    downgrade_config_to_v3(&mut env.svm);
    let old_bytes = env.svm.get_account(&config_pda()).unwrap().data;
    assert_eq!(old_bytes.len(), CONFIG_SPACE_V3);

    // Every instruction that reads Config is dead until it runs — pool-type
    // creation included.
    let err = env.send(&[fund_platform_ix(&admin, 1)], &[]).unwrap_err();
    assert!(
        err.contains("3003") || err.contains("AccountDidNotDeserialize"),
        "{err}"
    );
    let err = env.init_pool_type(MODE_EASY, 0, 64).unwrap_err();
    assert!(
        err.contains("3003") || err.contains("AccountDidNotDeserialize"),
        "{err}"
    );

    // Admin only — the admin recorded IN the old bytes.
    let stranger = rando(&mut env);
    assert_refused(
        env.send(&[migrate_config_ix(&stranger.pubkey())], &[&stranger]),
        "6063",
        "ConfigNotMigratable",
    );
    let settlement = env.settlement.insecure_clone();
    assert_refused(
        env.send(&[migrate_config_ix(&settlement.pubkey())], &[&settlement]),
        "6063",
        "ConfigNotMigratable",
    );

    let admin_before = env.balance(&admin);
    env.send(&[migrate_config_ix(&admin)], &[])
        .expect("migrate_config");
    let acct = env.svm.get_account(&config_pda()).unwrap();
    assert_eq!(acct.data.len(), CONFIG_SPACE);
    assert_eq!(
        &acct.data[..CONFIG_SPACE_V3],
        &old_bytes[..],
        "the old bytes untouched"
    );
    assert_eq!(
        &acct.data[CONFIG_SPACE_V3..],
        &[0, 0],
        "enabled_pool_types = 0"
    );
    assert!(acct.lamports >= env.svm.minimum_balance_for_rent_exemption(CONFIG_SPACE));
    assert!(
        env.balance(&admin) < admin_before,
        "the admin paid the top-up"
    );
    assert_eq!(read_config(&env.svm).enabled_pool_types, 0);
    // The Phase B path's event is not emitted on this one: its tail was
    // already there and is not rewritten.
    let logs = env.captured_logs.last().unwrap().join("\n");
    assert!(
        !logs.contains("Program data: "),
        "no event on the 603 → 605 path: {logs}"
    );

    // Once only.
    assert_refused(
        env.send(&[migrate_config_ix(&admin)], &[]),
        "6062",
        "ConfigAlreadyMigrated",
    );

    // And the program is alive: pool types can be created and enabled — the
    // count starting from the zero just written — and a pool opens.
    env.open_ready_pool_sized(1, 0, MODE_EASY, 8);
    assert_eq!(read_config(&env.svm).enabled_pool_types, 1);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).capacity, 8);
}
