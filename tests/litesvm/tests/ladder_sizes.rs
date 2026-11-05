//! The four pool sizes (D-E19) against the compiled artifact. For EACH of
//! 8, 16, 32 and 64 seats, all four running side by side on tier 0 — one
//! pool type each, so one live pool each:
//!
//!   - the pool fills and SEALS at its own capacity, and the next entry is
//!     refused;
//!   - `commit_results` refuses an amount above first place, a zero amount
//!     and a list that does not sum to the prize pool;
//!   - `pay_prizes` pays the top quarter — 2, 4, 8 and 16 places — each
//!     exactly its table amount, with every lamport accounted for: what left
//!     the vault is what reached the places, and the treasury does not move;
//!   - past the deadline the pool seals at exactly its minimum field (5, 10,
//!     20, 40) and pays the same table, and one seat below it refunds every
//!     entry in full.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const ENTRY: u64 = 100_000_000; // tier 0
const FILL_DEADLINE_SECS: i64 = 12 * 60 * 60;

/// Pool id for capacity index `k` in these tests: 1, 2, 3, 4.
fn id(k: usize) -> u64 {
    k as u64 + 1
}

/// Open one pool of every size on tier 0, ids 1..=4 in capacity order.
fn open_all_sizes(env: &mut Env) {
    for (k, &cap) in POOL_CAPACITIES.iter().enumerate() {
        env.open_ready_pool_sized(id(k), 0, MODE_EASY, cap);
        let pv = read_pool(&env.svm, &pool_pda(id(k)));
        assert_eq!(
            (pv.capacity, pv.min_seats, pv.paid_places, pv.prize_table),
            (cap, LADDER_MIN_SEATS[k], (cap / 4) as u8, LADDER_TABLES[k]),
            "{cap}: the pool copied its type's terms"
        );
        assert_eq!(pv.pot_lamports, table_value(&LADDER_TABLES[k], ENTRY));
        assert_eq!(
            env.balance(&vault_pda(id(k))),
            pv.pot_lamports + VAULT_RENT_CUSHION,
            "{cap}: the prize pool is locked before any entry"
        );
    }
    assert_eq!(read_config(&env.svm).enabled_pool_types, 4);
    // Four live pools, four pots reserved.
    let reserved: u64 = (0..4).map(|k| table_value(&LADDER_TABLES[k], ENTRY)).sum();
    assert_eq!(read_config(&env.svm).platform_reserved, reserved);
    assert_eq!(reserved, 75 * ENTRY, "5 + 10 + 20 + 40 entries");
}

/// Σ of the vault, the treasury and every paid wallet — the settlement
/// signer pays the fees, so payment must leave this sum exactly unchanged.
fn money_in_play(
    env: &Env,
    pool_id: u64,
    players: &[(Keypair, Pubkey)],
    payouts: &[(u16, u64)],
) -> u128 {
    let mut total = env.balance(&vault_pda(pool_id)) as u128 + env.balance(&platform_pda()) as u128;
    for &(seat, _) in payouts {
        total += env.balance(&players[seat as usize].0.pubkey()) as u128;
    }
    total
}

/// Commit `payouts` after proving the three D-E19 refusals against this
/// pool, then pay every place and assert conservation to the lamport.
fn commit_and_pay(env: &mut Env, k: usize, players: &[(Keypair, Pubkey)], payouts: &[(u16, u64)]) {
    let cap = POOL_CAPACITIES[k];
    let pool_id = id(k);
    let pot = table_value(&LADDER_TABLES[k], ENTRY);
    let first = LADDER_TABLES[k][0] as u64 * ENTRY;

    // An amount above first place — the list still summing to the pot.
    let mut above = payouts.to_vec();
    above[0].1 += 1;
    above[1].1 -= 1;
    assert_refused(
        env.commit(pool_id, [1u8; 32], &above),
        "6085",
        "PayoutAboveFirstPrize",
    );
    // The whole prize pool to one seat — the retired winner-takes-all row.
    assert_refused(
        env.commit(pool_id, [1u8; 32], &[(0, pot)]),
        "6085",
        "PayoutAboveFirstPrize",
    );
    // A zero amount.
    let mut zero = payouts.to_vec();
    zero.push((cap / 4, 0));
    assert_refused(env.commit(pool_id, [1u8; 32], &zero), "6086", "PayoutZero");
    // A list one lamport short of the prize pool; and one place left out.
    let mut short = payouts.to_vec();
    short.last_mut().unwrap().1 -= 1;
    assert_refused(
        env.commit(pool_id, [1u8; 32], &short),
        "6044",
        "PayoutSumMismatch",
    );
    assert_refused(
        env.commit(pool_id, [1u8; 32], &payouts[..payouts.len() - 1]),
        "6044",
        "PayoutSumMismatch",
    );
    assert_eq!(
        read_pool(&env.svm, &pool_pda(pool_id)).state,
        1,
        "{cap}: still Sealed"
    );

    env.commit(pool_id, [1u8; 32], payouts)
        .expect("commit_results");
    assert_eq!(payouts[0].1, first);
    assert_eq!(
        payouts.len(),
        (cap / 4) as usize,
        "{cap}: the top quarter is paid"
    );

    let before = money_in_play(env, pool_id, players, payouts);
    let vault_before = env.balance(&vault_pda(pool_id));
    let platform_before = env.balance(&platform_pda());
    let reserved_before = read_config(&env.svm).platform_reserved;
    let deltas = env.pay_all(pool_id, players, payouts);

    for (i, &(seat, amount)) in payouts.iter().enumerate() {
        assert_eq!(
            deltas[i],
            LADDER_TABLES[k][i] as u64 * ENTRY,
            "{cap}: place {} (seat {seat})",
            i + 1
        );
        assert_eq!(deltas[i], amount);
    }
    assert_eq!(
        deltas.iter().sum::<u64>(),
        pot,
        "{cap}: the places share the prize pool"
    );
    assert_eq!(
        vault_before - env.balance(&vault_pda(pool_id)),
        pot,
        "{cap}: exactly the prize pool left the vault"
    );
    assert_eq!(env.balance(&vault_pda(pool_id)), VAULT_RENT_CUSHION);
    assert_eq!(
        env.balance(&platform_pda()),
        platform_before,
        "{cap}: the treasury did not move"
    );
    assert_eq!(
        money_in_play(env, pool_id, players, payouts),
        before,
        "{cap}: not a lamport created or lost"
    );
    let pv = read_pool(&env.svm, &pool_pda(pool_id));
    assert_eq!(pv.state, 3, "{cap}: Paid");
    assert_eq!(pv.paid_mask, (1u64 << (cap / 4)) - 1);
    assert_eq!(
        read_config(&env.svm).platform_reserved,
        reserved_before - pot,
        "{cap}: its pot released from the reserved book"
    );
    let t = read_pool_type(&env.svm, &pool_type_pda(MODE_EASY, 0, cap));
    assert_eq!(t.active_pool, 0, "{cap}: its type's slot freed");
    assert_eq!(
        t.next_open_at,
        env.now() + 5 * 60,
        "{cap}: its cooldown stamped"
    );
}

#[test]
fn every_size_fills_and_seals_at_its_capacity_and_pays_its_top_quarter() {
    let Some(mut env) = Env::new() else { return };
    open_all_sizes(&mut env);

    let mut fields: Vec<Vec<(Keypair, Pubkey)>> = Vec::new();
    for (k, &cap) in POOL_CAPACITIES.iter().enumerate() {
        let platform_before = env.balance(&platform_pda());
        let players = env.register_n(id(k), cap);
        let pv = read_pool(&env.svm, &pool_pda(id(k)));
        assert_eq!(
            (pv.state, pv.entrants),
            (1, cap),
            "{cap}: Sealed at capacity"
        );
        assert_eq!(
            env.balance(&platform_pda()) - platform_before,
            cap as u64 * ENTRY,
            "{cap}: every entry in the treasury"
        );
        // One bag of 64 for every size (D-E19 decision 2): a smaller pool
        // draws it down without emptying it.
        let left: u16 = pv.class_counters.iter().sum();
        assert_eq!(left, 64 - cap, "{cap}: the bag drawn down by its field");
        // The (capacity + 1)th entry is refused — the pool is no longer Open.
        assert_refused(env.register_player(id(k)), "6000", "PoolNotOpen");
        fields.push(players);
    }
    assert_eq!(
        read_config(&env.svm).platform_refundable,
        0,
        "every field became revenue at seal"
    );

    for (k, players) in fields.iter().enumerate() {
        env.reveal(id(k));
        let payouts = straight_payouts(&LADDER_TABLES[k], ENTRY);
        commit_and_pay(&mut env, k, players, &payouts);
    }
    assert_eq!(read_config(&env.svm).platform_reserved, 0);
}

#[test]
fn every_size_seals_at_its_deadline_at_exactly_the_minimum_field() {
    let Some(mut env) = Env::new() else { return };
    open_all_sizes(&mut env);
    let platform_at_open = env.balance(&platform_pda());
    let settlement = env.settlement.insecure_clone();

    let mut fields: Vec<Vec<(Keypair, Pubkey)>> = Vec::new();
    for (k, &min) in LADDER_MIN_SEATS.iter().enumerate() {
        fields.push(env.register_n(id(k), min));
        // Before the deadline neither fork is open.
        let ix = seal_at_deadline_ix(&settlement.pubkey(), id(k));
        assert_refused(env.send(&[ix], &[&settlement]), "6012", "DeadlineNotPassed");
    }
    env.advance_time(FILL_DEADLINE_SECS + 1);
    let rando = Keypair::new();
    env.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    for (k, &min) in LADDER_MIN_SEATS.iter().enumerate() {
        let cap = POOL_CAPACITIES[k];
        // At the floor the refund fork is closed...
        let ix = env.trigger_refund_ix(&rando.pubkey(), id(k));
        assert_refused(env.send(&[ix], &[&rando]), "6052", "FieldReached");
        // ...and anyone may seal.
        env.send(&[seal_at_deadline_ix(&rando.pubkey(), id(k))], &[&rando])
            .unwrap_or_else(|e| panic!("{cap}: seal at {min}: {e}"));
        let pv = read_pool(&env.svm, &pool_pda(id(k)));
        assert_eq!(
            (pv.state, pv.entrants),
            (1, min),
            "{cap}: Sealed at its minimum field"
        );
    }
    assert_eq!(read_config(&env.svm).platform_refundable, 0);

    for (k, players) in fields.iter().enumerate() {
        env.reveal(id(k));
        // The SAME fixed table at the floor as at capacity (D-E19: the table
        // depends on the capacity only, never on entrants).
        let payouts = straight_payouts(&LADDER_TABLES[k], ENTRY);
        commit_and_pay(&mut env, k, players, &payouts);
    }
    // Exactly break-even at every size: the minimum fields' entries are the
    // prize pools the treasury funded, to the lamport.
    let entries_in: u64 = LADDER_MIN_SEATS.iter().map(|&m| m as u64 * ENTRY).sum();
    let pots_out: u64 = (0..4).map(|k| table_value(&LADDER_TABLES[k], ENTRY)).sum();
    assert_eq!(entries_in, pots_out);
    assert_eq!(
        env.balance(&platform_pda()) - platform_at_open,
        entries_in,
        "the treasury holds exactly the fields' entries; the pots left at open"
    );
}

#[test]
fn every_size_refunds_in_full_one_seat_below_its_minimum_field() {
    let Some(mut env) = Env::new() else { return };
    open_all_sizes(&mut env);
    let settlement = env.settlement.insecure_clone();
    let platform_at_open = env.balance(&platform_pda());

    let mut fields: Vec<Vec<(Keypair, Pubkey)>> = Vec::new();
    for &min in LADDER_MIN_SEATS.iter() {
        let k = fields.len();
        fields.push(env.register_n(id(k), min - 1));
    }
    env.advance_time(FILL_DEADLINE_SECS + 1);
    for (k, players) in fields.iter().enumerate() {
        let cap = POOL_CAPACITIES[k];
        let pot = table_value(&LADDER_TABLES[k], ENTRY);
        let ix = seal_at_deadline_ix(&settlement.pubkey(), id(k));
        assert_refused(env.send(&[ix], &[&settlement]), "6051", "FieldBelowMinimum");
        let platform_before = env.balance(&platform_pda());
        let ix = env.trigger_refund_ix(&settlement.pubkey(), id(k));
        env.send(&[ix], &[&settlement])
            .unwrap_or_else(|e| panic!("{cap}: trigger_refund: {e}"));
        assert_eq!(
            read_pool(&env.svm, &pool_pda(id(k))).state,
            4,
            "{cap}: Refunding"
        );
        assert_eq!(
            env.balance(&platform_pda()) - platform_before,
            pot,
            "{cap}: the untouched prize pool returned"
        );
        for (p, e) in players {
            let before = env.balance(&p.pubkey());
            let ix = env.refund_ix(&settlement.pubkey(), id(k), e, &p.pubkey());
            env.send(&[ix], &[&settlement]).expect("refund");
            assert_eq!(
                env.balance(&p.pubkey()) - before,
                ENTRY,
                "{cap}: R7 full refund"
            );
        }
        assert_eq!(
            read_pool(&env.svm, &pool_pda(id(k))).state,
            5,
            "{cap}: Closed"
        );
        assert_eq!(env.balance(&vault_pda(id(k))), VAULT_RENT_CUSHION);
        let t = read_pool_type(&env.svm, &pool_type_pda(MODE_EASY, 0, cap));
        assert_eq!(t.active_pool, 0, "{cap}: its slot freed at Closed");
    }
    let cfg = read_config(&env.svm);
    assert_eq!((cfg.platform_refundable, cfg.platform_reserved), (0, 0));
    // Every pot back, every entry out: the treasury is where it stood after
    // funding the four opens, plus the four pots it got back.
    let pots: u64 = (0..4).map(|k| table_value(&LADDER_TABLES[k], ENTRY)).sum();
    assert_eq!(env.balance(&platform_pda()), platform_at_open + pots);
}
