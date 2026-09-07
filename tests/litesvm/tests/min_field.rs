//! D-E4 acceptance against the compiled artifact — the minimum field under
//! option A (founder ruling 2026-09-07; the go-timer of the first cut is
//! gone): a pool seals at the 64th seat, or at its fill deadline with at
//! least `MIN_SEATS`, and refunds below that. One clock, set once at open
//! from `Config.fill_deadline_seconds` (12 h at launch), never rewritten.
//!
//!   - the 52nd seat changes NOTHING about the deadline;
//!   - past the deadline a 52-seat pool SEALS, by any signer, and settles
//!     to Paid with the winner taking the whole pot — the treasury keeps
//!     the field's entries (52 × 0.1 = 5.2 SOL) minus the pot: +1.2 SOL,
//!     the §11.1 break-even margin, measured;
//!   - the same at 63 (the top of the range) — the seal-accounting trap
//!     (`entry × entrants`, never `× 64`) fails HERE if it ever comes back;
//!   - below 52 the pool still refunds and cannot be sealed; at 52 it cannot
//!     be refunded — each instruction rejects the other's case;
//!   - the seal is a PURE function of state and time (prompt v2 §B.3): the
//!     settlement signer, the admin and the keeper have no earlier path; a
//!     random keypair succeeds the moment the deadline passes;
//!   - `set_tier_economics` refuses a pot at or above MIN_SEATS × price.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const ENTRY: u64 = 100_000_000; // tier 0
const POT: u64 = 4_000_000_000; // tier 0 (D-E1)
const MIN_SEATS: u16 = 52; // constants.rs::MIN_SEATS (D-E4)
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
    assert_eq!(pv.state, 0, "still Open at 52 — the deadline decides, not the seat");
    assert_eq!(pv.fill_deadline, opened, "the 52nd seat moves nothing (option A)");
    register_n(&mut env, 1, 3);
    assert_eq!(read_pool(&env.svm, &pool).fill_deadline, opened, "nor any later seat");
}

#[test]
fn a_52_seat_pool_seals_at_the_deadline_and_pays_the_winner() {
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
        .send(&[seal_at_deadline_ix(&settlement.pubkey(), 1)], &[&settlement])
        .unwrap_err();
    assert!(err.contains("6012"), "at the boundary the pool is still open: {err}");

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
    // the treasury holds the field's entries minus the pot — the §11.1
    // margin at the floor is 1.2 SOL at exactly 52.
    let won = settle_winner(&mut env, 1, &players);
    assert_eq!(won, POT, "winner takes all, at 52 as at 64");
    assert_eq!(env.balance(&vault_pda(1)), 0);
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
    assert_eq!(
        env.balance(&platform_pda()) - platform_at_open,
        (MIN_SEATS as u64 + 1) * ENTRY,
        "treasury holds exactly the field's entries (the pot left at open)"
    );
    assert_eq!(
        MIN_SEATS as u64 * ENTRY - POT,
        1_200_000_000,
        "margin at the floor: 1.2 SOL"
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
    assert_eq!(env.balance(&vault_pda(1)), 0);
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

#[test]
fn set_tier_economics_refuses_a_pot_the_minimum_field_cannot_cover() {
    let Some(mut env) = Env::new() else { return };
    let admin = env.admin.pubkey();
    // Exactly MIN_SEATS × price: break-even, refused (must be strictly below).
    let ix = set_tier_economics_ix(&admin, 0, ENTRY, MIN_SEATS as u64 * ENTRY);
    let err = env.send(&[ix], &[]).unwrap_err();
    assert!(
        err.contains("6053") || err.contains("PotExceedsMinimumField"),
        "{err}"
    );
    // One 1024-multiple below it clears (5.2 SOL − 1024 lamports is a
    // multiple of 1024 because 5_200_000_000 is).
    assert_eq!((MIN_SEATS as u64 * ENTRY) % 1024, 0);
    let ix = set_tier_economics_ix(&admin, 0, ENTRY, MIN_SEATS as u64 * ENTRY - 1024);
    env.send(&[ix], &[])
        .expect("a pot under the floor's entries is accepted");
    // Restore the launch value (also accepted: 4 SOL < 5.2 SOL).
    let ix = set_tier_economics_ix(&admin, 0, ENTRY, POT);
    env.send(&[ix], &[]).expect("launch pot re-accepted");
}
