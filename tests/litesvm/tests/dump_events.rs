//! Cross-language event fixture: run a compressed but complete lifecycle
//! against the REAL artifact and dump every successful transaction's logs.
//! The indexer's decode suite replays these exact `Program data:` payloads,
//! so the Rust `#[event]` structs and the TypeScript decoders are checked
//! against each other rather than against copies of themselves.
//!
//! Regenerate the committed fixture with:
//!   DUMP_EVENT_FIXTURE=1 cargo test --test dump_events
//! (writes ../../backend/indexer/test/fixtures/lifecycle-logs.json)
//!
//! # What the fixture holds (since the Ladder, D-E19), in order
//!
//!  1. ONE transaction (tx 0) — the upgrade as the runbook orders it, the
//!     way a single proposal would carry it: a real `migrate_config` of a
//!     pre-Phase-B (484-byte) Config to the current 605 bytes
//!     (`HardLadderAdded`), then — reading the grown Config — the pool
//!     types (`PoolTypeInitialized`, `PoolTypeEconomicsSet`,
//!     `PoolTypeEnabledSet`): easy 64 and easy 16 at tier 0 created,
//!     configured and enabled, hard 8 created and configured but never
//!     enabled; then the treasury deposit for pool 1 (`PlatformFunded`).
//!     Kept to one transaction so the fixture's head is the shape
//!     `replay-order.spec.ts` indexes: tx 1 is pool 1's `PoolOpened`, tx 2
//!     its `PassCollectionCreated`, tx 3 onward its registrations.
//!  2. Pool 1 — easy, 64 seats, the Ladder table: 64 entries (seal at
//!     capacity), seats 0 and 1 flagged (seat 0 cleared and re-flagged), a
//!     two-way tie for first sharing 1st and 2nd (0.9 SOL each) and seats
//!     2..15 at ranks 3..16, sixteen places paid in three batches (the two
//!     flagged seats escrowed), seat 0's escrow released, seat 1's forfeited
//!     — and HELD: `pay_next_place` refuses a Ladder pool, so no
//!     `NextPlacePaid` comes from this pool.
//!  3. The admin and treasury setters, restated at their launch values, and
//!     easy 16 switched off and on again (an `enabled: false` event, count
//!     1, then count 2).
//!  4. Pool 2 — easy, 64 seats: the refund fork, its VRF seed committed for
//!     real (`PoolVrfSeeded`), two entries refunded, then migrated through
//!     all three old shapes `migrate_pool` grows — 850, 849 and 847 bytes —
//!     so three `PoolMigrated` events carry the Ladder tail.
//!  5. Pool 3 — a ONE-PLACE pool (opened as easy 64, shrunk to the
//!     pre-Ladder 850 bytes and migrated: the fourth `PoolMigrated`): 40
//!     entries sealed at the deadline, a two-way tie for first (2 SOL each)
//!     under a real results root, seat 1 flagged, forfeited and paid onward
//!     to seat 0 (`NextPlacePaid`) — the path that serves only pre-Ladder
//!     pools now.
//!  6. Pool 4 — easy, 16 seats: 12 entries (two above its minimum field of
//!     10), the 12 h deadline passes, `seal_at_deadline`, reveal, commit
//!     `[5, 3, 1, 1]` entries, one payment batch. Its four settlement
//!     transactions are the fixture's LAST FOUR (`projection.spec.ts` slices
//!     on that). 64 + 2 + 40 + 12 = 118 entries in all, the count the
//!     pre-Ladder fixture carried.

use blotto_litesvm_tests::*;
use solana_sdk::account::Account;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer;
use std::str::FromStr;

/// Craft a revealed Switchboard Randomness account and commit it for real,
/// so the fixture carries a genuine `PoolVrfSeeded` event (the lifecycle
/// helper's `patch_vrf_seed` writes account bytes directly and emits none).
fn commit_vrf_for_real(env: &mut Env, pool_id: u64) {
    let sb = Pubkey::from_str("SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv").unwrap();
    let rand = Pubkey::new_unique();
    let mut data = vec![0u8; 8 + 400];
    data[..8].copy_from_slice(&[10, 66, 229, 135, 220, 239, 217, 114]);
    data[8 + 136..8 + 144].copy_from_slice(&100u64.to_le_bytes()); // reveal_slot
    data[8 + 144..8 + 176].copy_from_slice(&[77u8; 32]); // value
    env.svm
        .set_account(
            rand,
            Account {
                lamports: 10_000_000,
                data,
                owner: sb,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let mut ix_data = disc("commit_vrf_seed").to_vec();
    ix_data.extend_from_slice(&pool_id.to_le_bytes());
    let settlement = env.settlement.insecure_clone();
    let ix = Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(pool_pda(pool_id), false),
            AccountMeta::new_readonly(rand, false),
            AccountMeta::new_readonly(settlement.pubkey(), true),
        ],
        data: ix_data,
    };
    env.send(&[ix], &[&settlement]).expect("commit_vrf_seed");
}

#[test]
fn lifecycle_log_fixture() {
    let Some(mut env) = Env::new() else { return };
    let settlement = env.settlement.insecure_clone();
    let admin = env.admin.pubkey();
    let entry = TIER_PRICES[0];

    // ---- 1. The upgrade, in one transaction: HardLadderAdded from a real
    // V2 → current migration (every instruction that reads Config is dead
    // until it lands, so it comes first), then the pool types — the
    // instructions after it in the same transaction read the grown Config —
    // then the deposit pool 1's open needs.
    downgrade_config_to_v2(&mut env.svm);
    let launch = |mode: u8, cap: u16| {
        let t = ladder_table(cap);
        set_pool_type_economics_ix(
            &admin,
            mode,
            0,
            cap,
            ladder_min_seats(cap),
            t,
            table_value(&t, entry),
        )
    };
    let upgrade = [
        migrate_config_ix(&admin),
        init_pool_type_ix(&admin, MODE_EASY, 0, 64),
        launch(MODE_EASY, 64),
        set_pool_type_enabled_ix(&admin, MODE_EASY, 0, 64, true),
        init_pool_type_ix(&admin, MODE_EASY, 0, 16),
        launch(MODE_EASY, 16),
        set_pool_type_enabled_ix(&admin, MODE_EASY, 0, 16, true),
        init_pool_type_ix(&admin, MODE_HARD, 0, 8),
        launch(MODE_HARD, 8),
        // Pool 1's funding plus one further 16-player pool in reserve.
        fund_platform_ix(&admin, TIER_POTS[0] + 10 * entry + 2 * VAULT_RENT_CUSHION),
    ];
    env.send(&upgrade, &[]).expect("the upgrade transaction");
    for (mode, cap) in [(MODE_EASY, 64), (MODE_EASY, 16), (MODE_HARD, 8)] {
        env.pool_types.push(pool_type_pda(mode, 0, cap));
    }
    assert_eq!(read_config(&env.svm).enabled_pool_types, 2);

    // ---- 2. Pool 1: a full Ladder pool with escrow, release and a held
    // forfeit. Opened by hand so tx 1 is its PoolOpened alone.
    let ix = env.open_ix(&settlement.pubkey(), 1, 0, MODE_EASY, 64);
    env.send(&[ix], &[&settlement]).expect("open pool 1");
    patch_vrf_seed(&mut env.svm, &pool_pda(1), [5u8; 32]);
    let ix = create_pass_collection_ix(&settlement.pubkey(), 1);
    env.send(&[ix], &[&settlement]).unwrap();
    let players = env.register_n(1, 64);
    for (_, entry) in players.iter().take(2) {
        let ix = flag_ix(&settlement.pubkey(), 1, entry, "flag_entry");
        env.send(&[ix], &[&settlement]).unwrap();
    }
    // Unflag one again so the fixture carries both flag directions.
    let ix = flag_ix(&settlement.pubkey(), 1, &players[0].1, "clear_flag");
    env.send(&[ix], &[&settlement]).unwrap();
    let ix = flag_ix(&settlement.pubkey(), 1, &players[0].1, "flag_entry");
    env.send(&[ix], &[&settlement]).unwrap();
    env.reveal(1);
    let mut groups = vec![2u16];
    groups.extend(std::iter::repeat_n(1u16, 14));
    let payouts = ladder_payouts(&LADDER_TABLES[3], entry, &groups);
    assert_eq!(payouts.len(), 16);
    let wallets: Vec<Pubkey> = players.iter().map(|(p, _)| p.pubkey()).collect();
    let leaves: Vec<Vec<u8>> = wallets
        .iter()
        .enumerate()
        .map(|(seat, w)| {
            let rank = if seat < 2 { 1 } else { seat as u8 + 1 };
            let amount = payouts
                .iter()
                .find(|&&(s, _)| s as usize == seat)
                .map_or(0, |&(_, a)| a);
            leaf_bytes(w, rank, amount)
        })
        .collect();
    env.commit(1, merkle_root(&leaves), &payouts).unwrap();
    env.pay_all(1, &players, &payouts);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
    let ix = release_escrow_ix(
        &settlement.pubkey(),
        1,
        &players[0].1,
        &players[0].0.pubkey(),
    );
    env.send(&[ix], &[&settlement]).unwrap();
    // Admin forfeit (EscrowForfeited, destination = the pool's vault). The
    // share is HELD: no next-place payout exists for a Ladder pool.
    let ix = forfeit_escrow_ix(&admin, 1, &players[1].1);
    env.send(&[ix], &[]).unwrap();
    let ix = pay_next_place_ix(
        &settlement.pubkey(),
        1,
        &players[1].1,
        &players[0].1,
        &players[0].0.pubkey(),
        1,
        900_000_000,
        &merkle_proof(&leaves, 0),
        1,
        true,
        &[],
    );
    assert_refused(
        env.send(&[ix], &[&settlement]),
        "6087",
        "NextPlaceUnsupported",
    );

    // ---- 3. A round of the treasury and admin instructions (D-A1 v2, the
    // 2026-09-07 / Phase B setters, and a pool type switched off and on),
    // restated at their launch values.
    env.fund_platform(TIER_POTS[0] + 1_000_000_000);
    let dest = Pubkey::new_unique();
    let ix = env.withdraw_ix(&dest, 500_000_000);
    env.send(&[ix], &[]).unwrap();
    let ix = set_tier_economics_ix(&admin, 0, TIER_PRICES[0], TIER_POTS[0]);
    env.send(&[ix], &[]).unwrap();
    let ix = set_treasury_policy_ix(&admin, 1, 0);
    env.send(&[ix], &[]).unwrap();
    let ix = admin_ix(&admin, "set_open_tiers", &[1, 0, 0, 0, 0, 0, 0]);
    env.send(&[ix], &[]).unwrap();
    let ix = set_keeper_ix(&admin, &settlement.pubkey());
    env.send(&[ix], &[]).unwrap();
    let ix = set_pool_timing_ix(&admin, 12 * 60 * 60, 5 * 60);
    env.send(&[ix], &[]).unwrap();
    let ix = set_hard_open_tiers_ix(&admin, [false; 7]);
    env.send(&[ix], &[]).unwrap();
    env.set_pool_type_enabled(MODE_EASY, 0, 16, false).unwrap();
    env.set_pool_type_enabled(MODE_EASY, 0, 16, true).unwrap();

    // ---- 4. Pool 2: the refund fork — opened by hand so the VRF seed
    // lands via a REAL commit_vrf_seed (PoolVrfSeeded). Pool 1's Paid
    // stamped the 64 type's cooldown; wait it out.
    env.advance_time(5 * 60);
    env.fund_platform(env.open_funding_bound(MODE_EASY, 0, 64));
    let ix = env.open_ix(&settlement.pubkey(), 2, 0, MODE_EASY, 64);
    env.send(&[ix], &[&settlement]).unwrap();
    commit_vrf_for_real(&mut env, 2);
    let ix = create_pass_collection_ix(&settlement.pubkey(), 2);
    env.send(&[ix], &[&settlement]).unwrap();
    let refunders = env.register_n(2, 2);
    env.advance_time(12 * 3600 + 1);
    let ix = env.trigger_refund_ix(&settlement.pubkey(), 2);
    env.send(&[ix], &[&settlement]).unwrap();
    for (player, entry) in &refunders {
        let ix = env.refund_ix(&settlement.pubkey(), 2, entry, &player.pubkey());
        env.send(&[ix], &[&settlement]).unwrap();
    }
    assert_eq!(read_pool(&env.svm, &pool_pda(2)).state, 5, "Closed");
    // PoolMigrated, every shape `migrate_pool` grows, from real migrations
    // of the now-Closed pool 2: pre-Ladder (850), pre-Phase-B (849) and
    // pre-R7-b (847).
    for shrink in [shrink_pool_to_v3, shrink_pool_to_v2, shrink_pool_to_v1] {
        shrink(&mut env.svm, &pool_pda(2));
        let ix = migrate_pool_ix(&settlement.pubkey(), 2);
        env.send(&[ix], &[&settlement]).unwrap();
    }

    // ---- 5. Pool 3: a ONE-PLACE (migrated pre-Ladder) pool, where a
    // forfeited share is still paid onward (NextPlacePaid).
    env.advance_time(5 * 60);
    env.open_legacy_pool(3, 0);
    let field = env.register_n(3, 40);
    let ix = flag_ix(&settlement.pubkey(), 3, &field[1].1, "flag_entry");
    env.send(&[ix], &[&settlement]).unwrap();
    env.advance_time(12 * 3600 + 1);
    env.send(
        &[seal_at_deadline_ix(&settlement.pubkey(), 3)],
        &[&settlement],
    )
    .unwrap();
    env.reveal(3);
    let payouts = tied_first_payouts(TIER_POTS[0], 2);
    let wallets: Vec<Pubkey> = field.iter().map(|(p, _)| p.pubkey()).collect();
    let (leaves, _ranks) = results_leaves(&wallets, &payouts);
    env.commit(3, merkle_root(&leaves), &payouts).unwrap();
    env.pay_all(3, &field, &payouts);
    let ix = forfeit_escrow_ix(&admin, 3, &field[1].1);
    env.send(&[ix], &[]).unwrap();
    let ix = pay_next_place_ix(
        &settlement.pubkey(),
        3,
        &field[1].1,
        &field[0].1,
        &field[0].0.pubkey(),
        1,
        TIER_POTS[0] / 2,
        &merkle_proof(&leaves, 0),
        1,
        true,
        &[],
    );
    env.send(&[ix], &[&settlement]).unwrap();

    // ---- 6. Pool 4: a 16-player pool short of capacity, above its floor —
    // the deadline seal and a one-batch settlement, the fixture's last four
    // transactions.
    env.open_ready_pool_sized(4, 0, MODE_EASY, 16);
    let small = env.register_n(4, 12);
    env.advance_time(12 * 3600 + 1);
    let before = env.captured_logs.len();
    env.send(
        &[seal_at_deadline_ix(&settlement.pubkey(), 4)],
        &[&settlement],
    )
    .unwrap();
    env.reveal(4);
    let payouts = straight_payouts(&LADDER_TABLES[1], entry);
    env.commit(4, [1u8; 32], &payouts).unwrap();
    env.pay_all(4, &small, &payouts);
    assert_eq!(env.captured_logs.len() - before, 4, "one payment batch");
    assert_eq!(read_pool(&env.svm, &pool_pda(4)).state, 3, "Paid");

    // Every transaction with a Program data line makes it into the fixture.
    let with_events: Vec<&Vec<String>> = env
        .captured_logs
        .iter()
        .filter(|logs| logs.iter().any(|l| l.starts_with("Program data: ")))
        .collect();
    assert!(with_events.len() > 120, "expected a rich event stream");
    // The head shape `replay-order.spec.ts` indexes (see the module doc):
    // tx 1 emits one event (PoolOpened), tx 2 one (PassCollectionCreated),
    // txs 3..35 one each (EntryRegistered).
    for (i, logs) in with_events.iter().enumerate().take(35).skip(1) {
        let events = logs
            .iter()
            .filter(|l| l.starts_with("Program data: "))
            .count();
        assert_eq!(events, 1, "fixture tx {i} must carry exactly one event");
    }

    if std::env::var("DUMP_EVENT_FIXTURE").is_ok() {
        let mut out = String::from("{\n \"_comment\": \"GENERATED by tests/litesvm/tests/dump_events.rs (DUMP_EVENT_FIXTURE=1 cargo test --test dump_events) — real transaction logs from the compiled program executing in LiteSVM. Do not edit.\",\n \"transactions\": [\n");
        for (i, logs) in with_events.iter().enumerate() {
            out.push_str("  [");
            for (j, l) in logs.iter().enumerate() {
                out.push_str(&format!("{}{:?}", if j > 0 { "," } else { "" }, l));
            }
            out.push_str(if i + 1 < with_events.len() {
                "],\n"
            } else {
                "]\n"
            });
        }
        out.push_str(" ]\n}\n");
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../backend/indexer/test/fixtures/lifecycle-logs.json"
        );
        std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
        std::fs::write(path, out).unwrap();
        eprintln!("wrote {path}");
    }
}
