//! THE FILL RULE against the compiled artifact (R7-b, founder instruction
//! 2026-09-12; was D-E4 with a 52-seat floor). A pool seals at the 64th
//! seat, or at its fill deadline with at least its own `min_seats`, and
//! refunds in full below that. Nothing in between. One clock, set once at
//! open from `Config.fill_deadline_seconds` (12 h), never rewritten.
//!
//! Renamed from `min_field.rs` on 2026-09-13. Its assertions are rewritten
//! in place rather than deleted, per the instruction's standing rule 0.7:
//! each one encoded the rule being replaced.
//!
//!   - no seat changes the deadline;
//!   - past the deadline a pool at the floor SEALS, by any signer, and
//!     settles to Paid with the winner taking the whole pot;
//!   - the same at 63 (the top of the range) — the seal-accounting trap
//!     (`entry × entrants`, never `× 64`) fails HERE if it ever comes back;
//!   - below the floor the pool refunds and cannot be sealed; at the floor
//!     it cannot be refunded — each instruction rejects the other's case;
//!   - the seal is a PURE function of state and time (prompt v2 §B.3): the
//!     settlement signer, the admin and the keeper have no earlier path; a
//!     random keypair succeeds the moment the deadline passes;
//!   - `set_tier_economics` accepts a pot up to and INCLUDING the floor's
//!     intake, and refuses anything above it;
//!   - a pool plays by the floor it was OPENED with, not by the constant.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const ENTRY: u64 = 100_000_000; // tier 0
const POT: u64 = 4_000_000_000; // tier 0 (D-E1)
/// constants.rs::DEFAULT_FILL_DEADLINE_SECS — 12 h (founder ruling 1,
/// 2026-09-07), seeded into `Config.fill_deadline_seconds` at init.
const FILL_DEADLINE_SECS: i64 = 12 * 60 * 60;

fn register_n(env: &mut Env, pool_id: u64, n: u16) -> Vec<(Keypair, Pubkey)> {
    (0..n)
        .map(|_| env.register_player(pool_id).unwrap())
        .collect()
}

/// Reveal, commit the winner and pay them; returns the winner's delta.
fn settle_winner(env: &mut Env, pool_id: u64, players: &[(Keypair, Pubkey)]) -> u64 {
    let settlement = env.settlement.insecure_clone();
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), pool_id, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).expect("reveal");
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&winner_payout(POT)));
    let ix = settle_ix(&settlement.pubkey(), pool_id, "commit_results", &args);
    env.send(&[ix], &[&settlement]).expect("commit");
    let (p, e) = &players[0];
    let before = env.balance(&p.pubkey());
    let ix = pay_prizes_ix(&settlement.pubkey(), pool_id, &[0], &[(p.pubkey(), *e)]);
    env.send(&[ix], &[&settlement]).expect("pay");
    env.balance(&p.pubkey()) - before
}

#[test]
fn the_deadline_is_twelve_hours_from_open_and_no_seat_moves_it() {
    let Some(mut env) = Env::new() else { return };
    let opened_at = env
        .svm
        .get_sysvar::<solana_sdk::clock::Clock>()
        .unix_timestamp;
    env.open_ready_pool(1, 0);
    let pool = pool_pda(1);
    let opened = read_pool(&env.svm, &pool).fill_deadline;
    assert_eq!(opened, opened_at + FILL_DEADLINE_SECS, "12 h from open");
    assert_eq!(
        read_config(&env.svm).fill_deadline_seconds,
        FILL_DEADLINE_SECS,
        "seeded from DEFAULT_FILL_DEADLINE_SECS at init"
    );

    register_n(&mut env, 1, MIN_SEATS - 1);
    assert_eq!(read_pool(&env.svm, &pool).fill_deadline, opened, "51 seats");
    env.advance_time(3600);
    register_n(&mut env, 1, 1);
    let pv = read_pool(&env.svm, &pool);
    assert_eq!(pv.entrants, MIN_SEATS);
    assert_eq!(
        pv.state, 0,
        "still Open at 52 — the deadline decides, not the seat"
    );
    assert_eq!(
        pv.fill_deadline, opened,
        "the 52nd seat moves nothing (option A)"
    );
    register_n(&mut env, 1, 3);
    assert_eq!(
        read_pool(&env.svm, &pool).fill_deadline,
        opened,
        "nor any later seat"
    );
}

#[test]
fn a_minimum_field_pool_seals_at_the_deadline_and_pays_the_winner() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let platform_at_open = env.balance(&platform_pda());
    let players = register_n(&mut env, 1, MIN_SEATS);
    let settlement = env.settlement.insecure_clone();

    // Before the deadline: neither fork is open — not for the settlement
    // signer (also the keeper here), not for the admin. Purity, §B.3.
    for signer in [env.settlement.insecure_clone(), env.admin.insecure_clone()] {
        let err = env
            .send(&[seal_at_deadline_ix(&signer.pubkey(), 1)], &[&signer])
            .unwrap_err();
        assert!(
            err.contains("6012") || err.contains("DeadlineNotPassed"),
            "{err}"
        );
    }
    let err = env
        .send(
            &[trigger_refund_ix(&settlement.pubkey(), 1)],
            &[&settlement],
        )
        .unwrap_err();
    assert!(
        err.contains("6012") || err.contains("DeadlineNotPassed"),
        "{err}"
    );
    // The last second of the window still takes an entry (`now <=
    // fill_deadline`) and still refuses the seal (`now > fill_deadline`).
    env.advance_time(FILL_DEADLINE_SECS);
    register_n(&mut env, 1, 1);
    let err = env
        .send(
            &[seal_at_deadline_ix(&settlement.pubkey(), 1)],
            &[&settlement],
        )
        .unwrap_err();
    assert!(
        err.contains("6012"),
        "at the boundary the pool is still open: {err}"
    );

    // Past it: entries close, a refund is refused (FieldReached), the seal
    // lands — signed by a RANDOM keypair, not the settlement signer.
    env.advance_time(1);
    let err = env.register_player(1).unwrap_err();
    assert!(
        err.contains("6011") || err.contains("DeadlinePassed"),
        "{err}"
    );
    let err = env
        .send(
            &[trigger_refund_ix(&settlement.pubkey(), 1)],
            &[&settlement],
        )
        .unwrap_err();
    assert!(
        err.contains("6052") || err.contains("FieldReached"),
        "{err}"
    );

    let rando = Keypair::new();
    env.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    env.send(&[seal_at_deadline_ix(&rando.pubkey(), 1)], &[&rando])
        .expect("anyone may seal a pool past its deadline at the minimum field");
    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!(pv.state, 1, "Sealed");
    assert_eq!(pv.entrants, MIN_SEATS + 1, "the field it plays with");
    // The bag is drawn down, not emptied (D-E4 — PID §3 reissue).
    let remaining: u32 = pv.class_counters.iter().map(|&c| c as u32).sum();
    assert_eq!(remaining, (64 - MIN_SEATS - 1) as u32, "undrawn classes");
    // Seal accounting on the REAL field: 53 entries became revenue exactly.
    let cfg = read_config(&env.svm);
    assert_eq!(
        cfg.platform_refundable, 0,
        "entrants × price left the refundable floor"
    );
    assert_eq!(
        cfg.active_pool_by_tier[0], 1,
        "slot held until Paid (sequential)"
    );
    // A second seal is refused: the pool is no longer Open.
    let err = env
        .send(&[seal_at_deadline_ix(&rando.pubkey(), 1)], &[&rando])
        .unwrap_err();
    assert!(err.contains("6000") || err.contains("PoolNotOpen"), "{err}");

    // Settle: the winner takes the whole pot, the vault reaps to zero, and
    // the treasury holds the field's entries minus the pot.
    let won = settle_winner(&mut env, 1, &players);
    assert_eq!(won, POT, "winner takes all, at the floor as at 64");
    assert_eq!(env.balance(&vault_pda(1)), VAULT_RENT_CUSHION);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
    assert_eq!(
        env.balance(&platform_pda()) - platform_at_open,
        (MIN_SEATS as u64 + 1) * ENTRY,
        "treasury holds exactly the field's entries (the pot left at open)"
    );

    // THE FLOOR IS EXACTLY BREAK-EVEN — the founder's ruling of 2026-09-13,
    // measured. This assertion read `== 1_200_000_000, "margin at the floor:
    // 1.2 SOL"` under D-E4's 52-seat floor. R7-b spends that whole buffer
    // deliberately: at 40 seats a pool takes in precisely what it pays out.
    //
    // Stated as an equality rather than `>= 0` on purpose. A pot that ever
    // drifted above the floor's intake would make the subtraction wrap, and
    // a `>= 0` assertion on unsigned arithmetic proves nothing.
    assert_eq!(
        MIN_SEATS as u64 * ENTRY,
        POT,
        "the floor's intake IS the pot — break-even, by decision (R7-b)"
    );
    // The other end of the range, for contrast: a full field returns 2.4
    // SOL. Margin is `1 - 40/seats` of intake; every seat above the floor
    // is margin.
    assert_eq!(
        64u64 * ENTRY - POT,
        2_400_000_000,
        "margin at a full field: 2.4 SOL"
    );
}

#[test]
fn a_63_seat_pool_seals_the_same_way() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let players = register_n(&mut env, 1, 63);
    env.advance_time(FILL_DEADLINE_SECS + 1);
    let settlement = env.settlement.insecure_clone();
    env.send(
        &[seal_at_deadline_ix(&settlement.pubkey(), 1)],
        &[&settlement],
    )
    .expect("seal at 63");
    let pv = read_pool(&env.svm, &pool_pda(1));
    assert_eq!((pv.state, pv.entrants), (1, 63));
    assert_eq!(
        read_config(&env.svm).platform_refundable,
        0,
        "63 × price released, not 64"
    );
    assert_eq!(settle_winner(&mut env, 1, &players), POT);
    assert_eq!(env.balance(&vault_pda(1)), VAULT_RENT_CUSHION);
}

#[test]
fn below_the_minimum_field_the_pool_refunds_and_cannot_seal() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let players = register_n(&mut env, 1, MIN_SEATS - 1);
    env.advance_time(FILL_DEADLINE_SECS - 1);
    let settlement = env.settlement.insecure_clone();
    let err = env
        .send(
            &[trigger_refund_ix(&settlement.pubkey(), 1)],
            &[&settlement],
        )
        .unwrap_err();
    assert!(err.contains("6012"), "12 h not yet passed: {err}");
    env.advance_time(2);
    let err = env
        .send(
            &[seal_at_deadline_ix(&settlement.pubkey(), 1)],
            &[&settlement],
        )
        .unwrap_err();
    assert!(
        err.contains("6051") || err.contains("FieldBelowMinimum"),
        "{err}"
    );
    env.send(
        &[trigger_refund_ix(&settlement.pubkey(), 1)],
        &[&settlement],
    )
    .expect("refund fork below the minimum");
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 4, "Refunding");
    // Every entrant repaid in full (R7 unchanged).
    for (p, e) in &players {
        let before = env.balance(&p.pubkey());
        let ix = refund_ix(&settlement.pubkey(), 1, e, &p.pubkey());
        env.send(&[ix], &[&settlement]).expect("refund");
        assert_eq!(env.balance(&p.pubkey()) - before, ENTRY);
    }
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 5, "Closed");
}

/// S-econ: the break-even comparison, at the boundary on both sides.
///
/// REWRITTEN for R7-b. It read "exactly MIN_SEATS × price: break-even,
/// refused (must be strictly below)" — D-E4's rule. The founder's ruling of
/// 2026-09-13 set the floor AT break-even, on the ground that the pot is
/// pre-funded from the treasury and a pool's ability to pay never depended
/// on its own entries, so the comparison is now `<=`. What did not change is
/// the thing the guard exists for: a pot LARGER than the floor's intake is
/// still refused, and this pins both sides of that line.
#[test]
fn set_tier_economics_accepts_break_even_and_refuses_more() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    let floor_intake = MIN_SEATS as u64 * ENTRY;

    // The launch pot IS the floor's intake — that is the R7-b relationship,
    // and it is exactly the case D-E4 refused.
    assert_eq!(POT, floor_intake, "the launch pot is the floor's intake");
    let ix = set_tier_economics_ix(&admin, 0, ENTRY, floor_intake);
    env.send(&[ix], &[])
        .expect("break-even is accepted since R7-b");

    // One 1024-multiple ABOVE it is refused: the guard still holds the line
    // it was written for. (4 SOL is a multiple of 1024, so 4 SOL + 1024 is
    // too — the divisibility check cannot be what rejects this.)
    assert_eq!(floor_intake % 1024, 0);
    let ix = set_tier_economics_ix(&admin, 0, ENTRY, floor_intake + 1024);
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(
        err.contains("6053") || err.contains("PotExceedsMinimumField"),
        "a pot above the floor's intake must still be refused: {err}"
    );

    // And well below is fine.
    let ix = set_tier_economics_ix(&admin, 0, ENTRY, floor_intake - 1024);
    env.send(&[ix], &[])
        .expect("a pot under the floor's intake is accepted");

    // Restore the launch value.
    let ix = set_tier_economics_ix(&admin, 0, ENTRY, POT);
    env.send(&[ix], &[]).expect("launch pot re-accepted");
}

// ---------------------------------------------------------------------------
// S9 — a pool plays by the floor it was OPENED with (R7-b).
// ---------------------------------------------------------------------------

/// The reason `Pool.min_seats` exists, proven from outside the program.
///
/// `MIN_SEATS` is a compile-time constant, so "an upgrade moves the floor"
/// cannot be staged in a test. What CAN be staged is the observable
/// consequence: a pool whose stored floor differs from the constant must
/// seal and refund by ITS OWN number. If either guard read `MIN_SEATS`
/// instead of `pool.min_seats`, every assertion below would invert.
///
/// This is not a hypothetical sequence. The upgrade drain gate is
/// `{Sealed, Scored, Refunding}` (`scripts/admin.ts`) and does NOT include
/// `Open`, so a program upgrade can land while a pool is taking entries —
/// and before R7-b that upgrade would have moved the floor underneath the
/// people already seated.
#[test]
fn a_pool_seals_and_refunds_by_its_own_stored_floor() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);

    // Opened with the constant.
    assert_eq!(
        read_min_seats(&env.svm, &pool_pda(1)),
        MIN_SEATS,
        "open_pool copies the constant"
    );

    // Now give this pool the OLD floor, as a pool opened before R7-b has.
    const OLD_FLOOR: u16 = 52;
    patch_min_seats(&mut env.svm, &pool_pda(1), OLD_FLOOR);

    // Seat it between the two floors: at or above the constant (40), below
    // the pool's own (52). Under the constant this pool would seal; under
    // its own number it must refund.
    let players = register_n(&mut env, 1, OLD_FLOOR - 1);
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
        "51 seats is below THIS pool's floor of 52, whatever the constant says: {err}"
    );

    // And the refund fork — which the constant would have refused — opens.
    env.send(
        &[trigger_refund_ix(&settlement.pubkey(), 1)],
        &[&settlement],
    )
    .expect("below its own floor, the pool refunds");
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 4, "Refunding");
    for (p, e) in &players {
        let before = env.balance(&p.pubkey());
        let ix = refund_ix(&settlement.pubkey(), 1, e, &p.pubkey());
        env.send(&[ix], &[&settlement]).expect("refund");
        assert_eq!(env.balance(&p.pubkey()) - before, ENTRY);
    }
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 5, "Closed");
}

/// The same field, the other way round: a pool whose stored floor is LOWER
/// than the constant seals where the constant would refuse.
#[test]
fn a_lower_stored_floor_seals_where_the_constant_would_refuse() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    const LOW_FLOOR: u16 = 10;
    patch_min_seats(&mut env.svm, &pool_pda(1), LOW_FLOOR);

    register_n(&mut env, 1, LOW_FLOOR);
    env.advance_time(FILL_DEADLINE_SECS + 1);
    let settlement = env.settlement.insecure_clone();

    // The refund fork is closed at this pool's floor...
    let err = env
        .send(
            &[trigger_refund_ix(&settlement.pubkey(), 1)],
            &[&settlement],
        )
        .unwrap_err();
    assert!(
        err.contains("6052") || err.contains("FieldReached"),
        "{err}"
    );
    // ...and the seal lands, on a field the constant (40) would have refused.
    env.send(
        &[seal_at_deadline_ix(&settlement.pubkey(), 1)],
        &[&settlement],
    )
    .expect("at its own floor, the pool seals");
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 1, "Sealed");
}

// ---------------------------------------------------------------------------
// S7 — an empty pool goes straight to Closed.
// ---------------------------------------------------------------------------

#[test]
fn an_empty_pool_closes_and_returns_the_pot() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let platform_after_open = env.balance(&platform_pda());
    env.advance_time(FILL_DEADLINE_SECS + 1);
    let settlement = env.settlement.insecure_clone();
    env.send(
        &[trigger_refund_ix(&settlement.pubkey(), 1)],
        &[&settlement],
    )
    .expect("an empty pool past its deadline closes");
    // Straight to Closed — there is nobody to refund, so Refunding would be
    // a state with no exit.
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 5, "Closed");
    // The untouched pot returns to the treasury; the vault keeps its rent
    // cushion (B-03 — the vault is never drained to zero).
    assert_eq!(
        env.balance(&platform_pda()) - platform_after_open,
        POT,
        "the pot returns to the treasury"
    );
    assert_eq!(env.balance(&vault_pda(1)), VAULT_RENT_CUSHION);
    // And the tier slot frees at once: there is nothing left to settle.
    assert_eq!(read_config(&env.svm).active_pool_by_tier[0], 0);
}

// ---------------------------------------------------------------------------
// `migrate_pool` — growing the pools that predate the field.
// ---------------------------------------------------------------------------

/// The migration writes the OLD floor, not the new constant.
///
/// This is the part that would be easy to get subtly wrong and impossible to
/// undo. A pool opened before R7-b took its entries under a 52-seat rule;
/// writing 40 into it would move the goalposts under people already seated,
/// which is the exact thing `Pool.min_seats` was added to prevent. A
/// migration that defeated its own field would be worse than no field.
#[test]
fn migrate_pool_writes_the_floor_those_players_entered_under() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let pool = pool_pda(1);
    shrink_pool_to_v1(&mut env.svm, &pool);

    let rando = Keypair::new();
    env.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    env.send(&[migrate_pool_ix(&rando.pubkey(), 1)], &[&rando])
        .expect("anyone may migrate a pool");

    assert_eq!(
        env.svm.get_account(&pool).unwrap().data.len(),
        849,
        "the account grew"
    );
    assert_eq!(
        read_min_seats(&env.svm, &pool),
        52,
        "a migrated pool keeps the floor its players entered under, not the new constant"
    );
    // And every field ahead of the appended one is untouched — the whole
    // reason the field was appended rather than inserted.
    let pv = read_pool(&env.svm, &pool);
    assert_eq!(pv.state, 0, "still Open");
    assert_eq!(pv.entrants, 0);
    assert_eq!(pv.pot_lamports, POT);
}

/// Run twice, and the second is a clean refusal rather than a second write.
#[test]
fn migrate_pool_refuses_a_pool_already_at_the_current_layout() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let rando = Keypair::new();
    env.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();

    // A pool `open_pool` just allocated is already current.
    let err = env
        .send(&[migrate_pool_ix(&rando.pubkey(), 1)], &[&rando])
        .unwrap_err();
    assert!(
        err.contains("6072") || err.contains("PoolAlreadyMigrated"),
        "{err}"
    );

    // And after a real migration, the same refusal — so a repeated runbook
    // step cannot overwrite a floor that is already correct.
    shrink_pool_to_v1(&mut env.svm, &pool_pda(1));
    env.send(&[migrate_pool_ix(&rando.pubkey(), 1)], &[&rando])
        .expect("first migration");
    let err = env
        .send(&[migrate_pool_ix(&rando.pubkey(), 1)], &[&rando])
        .unwrap_err();
    assert!(
        err.contains("6072") || err.contains("PoolAlreadyMigrated"),
        "{err}"
    );
}

/// A migrated pool then plays by the floor it was given.
///
/// The migration and the guards are separate pieces of code, and this is the
/// test that they agree: 51 seats is below a migrated pool's 52 and would be
/// above the constant's 40.
#[test]
fn a_migrated_pool_plays_by_the_floor_the_migration_gave_it() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    shrink_pool_to_v1(&mut env.svm, &pool_pda(1));
    let rando = Keypair::new();
    env.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    env.send(&[migrate_pool_ix(&rando.pubkey(), 1)], &[&rando])
        .expect("migrate");

    register_n(&mut env, 1, 51);
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
        "51 is below the migrated floor of 52: {err}"
    );
    env.send(
        &[trigger_refund_ix(&settlement.pubkey(), 1)],
        &[&settlement],
    )
    .expect("and the refund fork is open");
}
