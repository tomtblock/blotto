//! The Ladder's pool types (D-E19) against the compiled artifact: the three
//! admin instructions that create, configure and switch a (mode, tier,
//! capacity).
//!
//!   - `init_pool_type` creates the account at its PDA, disabled and with no
//!     table, for 8, 16, 32 or 64 seats only; admin only; once;
//!   - `set_pool_type_economics` accepts the four launch tables at every
//!     tier in both modes, and refuses — by name — a prize pool that is not
//!     the table at the tier's price, a table paying other than the top
//!     quarter, an increasing table, a zero inside the paid places, a prize
//!     pool above the minimum field's entries, a minimum field at or below
//!     the places paid or above the capacity, and any signer but the admin;
//!   - `set_pool_type_enabled` refuses to switch on a type with no economics
//!     and keeps `Config.enabled_pool_types` exact across repeated calls;
//!   - neither touches a pool already taking entries.

use blotto_litesvm_tests::*;
use solana_sdk::instruction::AccountMeta;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const ENTRY: u64 = 100_000_000; // tier 0

fn mallory(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    k
}

/// `set_pool_type_economics` on (easy, tier 0, `capacity`), admin-signed.
fn economics(
    env: &mut Env,
    capacity: u16,
    min_seats: u16,
    table: [u8; 16],
    pot: u64,
) -> Result<(), String> {
    let ix = set_pool_type_economics_ix(
        &env.admin.pubkey(),
        MODE_EASY,
        0,
        capacity,
        min_seats,
        table,
        pot,
    );
    env.send(&[ix], &[])
}

fn table(prefix: &[u8]) -> [u8; 16] {
    let mut t = [0u8; 16];
    t[..prefix.len()].copy_from_slice(prefix);
    t
}

#[test]
fn init_pool_type_creates_a_disabled_type_with_no_table() {
    let Some(mut env) = Env::new() else { return };
    let admin_before = env.balance(&env.admin.pubkey());
    env.init_pool_type(MODE_HARD, 3, 32).expect("init_pool_type");
    let addr = pool_type_pda(MODE_HARD, 3, 32);
    let bump = solana_sdk::pubkey::Pubkey::find_program_address(
        &[b"ptype", &[MODE_HARD], &[3], &32u16.to_le_bytes()],
        &program_id(),
    )
    .1;
    assert_eq!(
        read_pool_type(&env.svm, &addr),
        PoolTypeView {
            mode: MODE_HARD,
            tier: 3,
            capacity: 32,
            min_seats: 0,
            paid_places: 0,
            prize_table: [0; 16],
            pot_lamports: 0,
            enabled: false,
            active_pool: 0,
            next_open_at: 0,
            bump,
        }
    );
    // The admin paid the rent; nothing else moved, no type is enabled.
    let rent = env.svm.minimum_balance_for_rent_exemption(POOL_TYPE_SPACE);
    assert_eq!(env.balance(&addr), rent);
    assert!(admin_before - env.balance(&env.admin.pubkey()) >= rent);
    assert_eq!(read_config(&env.svm).enabled_pool_types, 0);

    // Once only: the PDA is taken.
    let err = env.init_pool_type(MODE_HARD, 3, 32).unwrap_err();
    assert!(err.contains("already in use"), "{err}");
}

#[test]
fn init_pool_type_refuses_any_capacity_but_the_four_and_any_signer_but_the_admin() {
    let Some(mut env) = Env::new() else { return };
    for bad in [0u16, 1, 4, 9, 12, 24, 48, 63, 65, 128, u16::MAX] {
        assert_refused(env.init_pool_type(MODE_EASY, 0, bad), "6076", "UnknownCapacity");
        assert!(
            env.svm.get_account(&pool_type_pda(MODE_EASY, 0, bad)).is_none(),
            "{bad}: nothing was created"
        );
    }
    // The other two coordinates are refused by name too.
    assert_refused(env.init_pool_type(2, 0, 8), "6074", "UnknownMode");
    assert_refused(env.init_pool_type(MODE_EASY, 7, 8), "6007", "UnknownTier");

    // The account must be the PDA of the arguments (threat-tm-401's seeds).
    let ix = init_pool_type_at_ix(
        &env.admin.pubkey(),
        MODE_EASY,
        0,
        8,
        &pool_type_pda(MODE_EASY, 0, 16),
    );
    assert_refused(env.send(&[ix], &[]), "2006", "ConstraintSeeds");

    // Admin only (threat-tm-402): Config's `has_one = admin`.
    let m = mallory(&mut env);
    let ix = init_pool_type_ix(&m.pubkey(), MODE_EASY, 0, 8);
    assert_refused(env.send(&[ix], &[&m]), "2001", "ConstraintHasOne");

    // And each of the four sizes is accepted, in both modes.
    for &cap in &POOL_CAPACITIES {
        for mode in [MODE_EASY, MODE_HARD] {
            env.init_pool_type(mode, 0, cap)
                .unwrap_or_else(|e| panic!("({mode}, 0, {cap}): {e}"));
            assert_eq!(read_pool_type(&env.svm, &pool_type_pda(mode, 0, cap)).capacity, cap);
        }
    }
}

/// The four launch tables, at every tier, in both modes: 56 pool types,
/// each recording its table, its minimum field, the top quarter as its
/// places paid, and a prize pool of `Σ table × price` — 5, 10, 20 and 40
/// entries — exactly.
#[test]
fn set_pool_type_economics_accepts_the_four_launch_tables_at_all_seven_tiers() {
    let Some(mut env) = Env::new() else { return };
    for mode in [MODE_EASY, MODE_HARD] {
        for tier in 0u8..7 {
            for (k, &cap) in POOL_CAPACITIES.iter().enumerate() {
                env.init_pool_type(mode, tier, cap).unwrap();
                let price = TIER_PRICES[tier as usize];
                let pot = table_value(&LADDER_TABLES[k], price);
                let ix = set_pool_type_economics_ix(
                    &env.admin.pubkey(),
                    mode,
                    tier,
                    cap,
                    LADDER_MIN_SEATS[k],
                    LADDER_TABLES[k],
                    pot,
                );
                env.send(&[ix], &[])
                    .unwrap_or_else(|e| panic!("({mode}, {tier}, {cap}): {e}"));
                let t = read_pool_type(&env.svm, &pool_type_pda(mode, tier, cap));
                assert_eq!(
                    (t.min_seats, t.paid_places, t.prize_table, t.pot_lamports),
                    (LADDER_MIN_SEATS[k], (cap / 4) as u8, LADDER_TABLES[k], pot),
                    "({mode}, {tier}, {cap})"
                );
                assert_eq!(pot, LADDER_MIN_SEATS[k] as u64 * price, "break-even floor");
                assert!(!t.enabled, "economics do not switch a type on");
            }
        }
        // The 64 column at every tier is the D-E1 tier pot.
        for tier in 0u8..7 {
            assert_eq!(
                read_pool_type(&env.svm, &pool_type_pda(mode, tier, 64)).pot_lamports,
                TIER_POTS[tier as usize]
            );
        }
    }
    assert_eq!(read_config(&env.svm).enabled_pool_types, 0);
}

#[test]
fn set_pool_type_economics_refuses_every_malformed_shape() {
    let Some(mut env) = Env::new() else { return };
    env.init_pool_type(MODE_EASY, 0, 16).unwrap();
    let good = LADDER_TABLES[1]; // [5, 3, 1, 1]
    let pot = 10 * ENTRY;

    // (a) The prize pool must be Σ table × price at the tier's price: a
    // lamport either side, or the right table at another tier's price.
    for wrong in [pot - 1, pot + 1, 10 * TIER_PRICES[1], 11 * ENTRY] {
        assert_refused(economics(&mut env, 16, 10, good, wrong), "6082", "PrizePoolMismatch");
    }
    assert_refused(economics(&mut env, 16, 10, good, 0), "6047", "ZeroAmount");

    // (b) Exactly the top quarter is paid: three places, five places, or the
    // 8- or 32-player table on a 16-player type.
    assert_refused(
        economics(&mut env, 16, 10, table(&[6, 3, 1]), pot),
        "6080",
        "PrizeTableMalformed",
    );
    assert_refused(
        economics(&mut env, 16, 11, table(&[5, 3, 1, 1, 1]), 11 * ENTRY),
        "6080",
        "PrizeTableMalformed",
    );
    assert_refused(
        economics(&mut env, 16, 10, LADDER_TABLES[0], 5 * ENTRY),
        "6080",
        "PrizeTableMalformed",
    );
    assert_refused(
        economics(&mut env, 16, 10, LADDER_TABLES[2], 20 * ENTRY),
        "6080",
        "PrizeTableMalformed",
    );

    // (c) Never increasing down the table.
    assert_refused(
        economics(&mut env, 16, 11, table(&[5, 3, 1, 2]), 11 * ENTRY),
        "6080",
        "PrizeTableMalformed",
    );
    assert_refused(
        economics(&mut env, 16, 10, table(&[3, 5, 1, 1]), pot),
        "6080",
        "PrizeTableMalformed",
    );

    // (d) No zero inside the paid places.
    assert_refused(
        economics(&mut env, 16, 10, table(&[5, 4, 0, 1]), pot),
        "6080",
        "PrizeTableMalformed",
    );

    // (e) The prize pool may not exceed the minimum field's entries — the
    // break-even rule at every size: the launch table with a floor of 9.
    assert_refused(economics(&mut env, 16, 9, good, pot), "6053", "PotExceedsMinimumField");

    // (f) The minimum field must exceed the places paid and not exceed the
    // capacity.
    for bad in [0u16, 3, 4, 17, 64] {
        assert_refused(economics(&mut env, 16, bad, good, pot), "6081", "MinimumFieldInvalid");
    }

    // (g) Admin only.
    let m = mallory(&mut env);
    let ix = set_pool_type_economics_ix(&m.pubkey(), MODE_EASY, 0, 16, 10, good, pot);
    assert_refused(env.send(&[ix], &[&m]), "2001", "ConstraintHasOne");

    // And the arguments must name the account's own coordinates (seeds).
    env.init_pool_type(MODE_EASY, 0, 8).unwrap();
    let mut ix = set_pool_type_economics_ix(&env.admin.pubkey(), MODE_EASY, 0, 16, 10, good, pot);
    ix.accounts[2] = AccountMeta::new(pool_type_pda(MODE_EASY, 0, 8), false);
    assert_refused(env.send(&[ix], &[]), "2006", "ConstraintSeeds");

    // Nothing above landed.
    let t = read_pool_type(&env.svm, &pool_type_pda(MODE_EASY, 0, 16));
    assert_eq!((t.paid_places, t.pot_lamports, t.min_seats), (0, 0, 0));

    // The boundaries themselves are accepted: a floor one above the places
    // paid with a table that sums to it, and a floor of the full capacity.
    economics(&mut env, 16, 5, table(&[2, 1, 1, 1]), 5 * ENTRY)
        .expect("floor = paid places + 1, break-even");
    economics(&mut env, 16, 16, good, pot).expect("floor = capacity");
    // A table other than the launch one is a founder decision, not a shape
    // the program refuses — [4, 3, 2, 1] is the top quarter, never
    // increasing, and sums to the floor.
    economics(&mut env, 16, 10, table(&[4, 3, 2, 1]), pot).expect("another well-formed table");
    economics(&mut env, 16, 10, good, pot).expect("the launch values");
    let t = read_pool_type(&env.svm, &pool_type_pda(MODE_EASY, 0, 16));
    assert_eq!((t.paid_places, t.prize_table, t.pot_lamports, t.min_seats), (4, good, pot, 10));
}

#[test]
fn set_pool_type_enabled_needs_economics_and_keeps_the_count_exact() {
    let Some(mut env) = Env::new() else { return };
    let count = |env: &Env| read_config(&env.svm).enabled_pool_types;
    env.init_pool_type(MODE_EASY, 0, 8).unwrap();
    env.init_pool_type(MODE_HARD, 0, 64).unwrap();

    // No economics, no switch.
    assert_refused(
        env.set_pool_type_enabled(MODE_EASY, 0, 8, true),
        "6078",
        "PoolTypeEconomicsUnset",
    );
    assert_eq!(count(&env), 0);
    // Switching OFF an unconfigured, disabled type is a harmless no-op.
    env.set_pool_type_enabled(MODE_EASY, 0, 8, false).expect("off is always allowed");
    assert_eq!(count(&env), 0);

    env.set_launch_economics(MODE_EASY, 0, 8).unwrap();
    env.set_launch_economics(MODE_HARD, 0, 64).unwrap();

    // The count moves only on an actual change of state.
    let steps: [(u8, u16, bool, u16); 8] = [
        (MODE_EASY, 8, true, 1),
        (MODE_EASY, 8, true, 1),   // repeated: no double count
        (MODE_HARD, 64, true, 2),
        (MODE_HARD, 64, true, 2),
        (MODE_EASY, 8, false, 1),
        (MODE_EASY, 8, false, 1),  // repeated: no double decrement
        (MODE_HARD, 64, false, 0),
        (MODE_EASY, 8, true, 1),
    ];
    for (mode, cap, on, want) in steps {
        env.set_pool_type_enabled(mode, 0, cap, on).unwrap();
        assert_eq!(count(&env), want, "after ({mode}, {cap}) -> {on}");
        assert_eq!(read_pool_type(&env.svm, &pool_type_pda(mode, 0, cap)).enabled, on);
        // The remaining-accounts list the harness derives agrees.
        assert_eq!(env.enabled_pool_types().len(), want as usize);
    }

    // Admin only.
    let m = mallory(&mut env);
    let ix = set_pool_type_enabled_ix(&m.pubkey(), MODE_HARD, 0, 64, true);
    assert_refused(env.send(&[ix], &[&m]), "2001", "ConstraintHasOne");
    assert_eq!(count(&env), 1);
}

/// Every pool copies its type's terms at open, so neither switch reaches a
/// pool players have entered: new economics apply to the NEXT pool, and a
/// type switched off keeps its open pool taking entries while no new one
/// opens.
#[test]
fn a_pool_type_change_never_touches_an_open_pool() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool_sized(1, 0, MODE_EASY, 16);
    let mut players = env.register_n(1, 3);

    // A different well-formed table and floor for the next pool.
    let next_table = table(&[4, 3, 2, 1]);
    economics(&mut env, 16, 12, next_table, 10 * ENTRY).expect("restated economics");
    // Off: the open pool keeps taking entries; `register` never reads the
    // switch.
    env.set_pool_type_enabled(MODE_EASY, 0, 16, false).unwrap();
    players.extend(env.register_n(1, 1));
    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!(pv.entrants, 4);
    assert_eq!(
        (pv.capacity, pv.min_seats, pv.paid_places, pv.prize_table),
        (16, 10, 4, LADDER_TABLES[1]),
        "the open pool keeps the terms it opened with"
    );

    // Settle it (refund fork: 4 is below its own floor of 10).
    env.advance_time(12 * 3600 + 1);
    let settlement = env.settlement.insecure_clone();
    let ix = env.trigger_refund_ix(&settlement.pubkey(), 1);
    env.send(&[ix], &[&settlement]).unwrap();
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 4, "Refunding");
    env.advance_time(5 * 60);

    // The next open of the switched-off type is refused...
    let ix = env.open_ix(&settlement.pubkey(), 2, 0, MODE_EASY, 16);
    assert_refused(env.send(&[ix], &[&settlement]), "6077", "PoolTypeDisabled");
    // ...and once switched on (and its last pool settled), it copies the
    // NEW terms.
    env.set_pool_type_enabled(MODE_EASY, 0, 16, true).unwrap();
    let ix = env.open_ix(&settlement.pubkey(), 2, 0, MODE_EASY, 16);
    assert_refused(env.send(&[ix], &[&settlement]), "6008", "TierAlreadyHasOpenPool");
    // (Refunding is not Closed: the slot is still held. Close it.)
    for (p, e) in &players {
        let ix = env.refund_ix(&settlement.pubkey(), 1, e, &p.pubkey());
        env.send(&[ix], &[&settlement]).unwrap();
    }
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 5, "Closed");
    env.advance_time(5 * 60);
    env.fund_platform(env.open_funding_bound(MODE_EASY, 0, 16));
    let ix = env.open_ix(&settlement.pubkey(), 2, 0, MODE_EASY, 16);
    env.send(&[ix], &[&settlement]).expect("the type opens again");
    let pv = read_pool(&env.svm, &pool_pda(2));
    assert_eq!(
        (pv.min_seats, pv.prize_table, pv.pot_lamports),
        (12, next_table, 10 * ENTRY),
        "the next pool copies the restated terms"
    );
}
