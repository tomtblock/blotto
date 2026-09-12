//! The dust-donation attack, against the real runtime.
//!
//! A prize vault is a zero-data, System-owned PDA at an address anyone can
//! derive from the public pool id. Until 2026-09-12 `open_pool` funded it
//! with exactly the pot and settlement drained it to exactly zero, which
//! left one lamport between a stranger and a dead pool: send the vault a
//! single lamport and the final payout tries to leave a balance of 1, which
//! the runtime refuses because it moves a rent-exempt account into the
//! rent-paying band. The pot froze, the entrants went unpaid, and since the
//! tier slot is freed only by `pay_prizes` or the two refund paths, that
//! tier could never open another pool. Cost to the attacker: one lamport.
//!
//! `docs/internal-review.md` IR-3 had considered unsolicited donations and
//! accepted them as harmless — correct about this program's own logic, which
//! never reads those balances, and wrong about the runtime, which does.
//!
//! The fix is the rent cushion `open_pool` now funds alongside the pot. This
//! file proves it holds where it matters: in an SVM, not in arithmetic. The
//! program's own unit tests cover the band rule itself
//! (`programs/blotto_cup/src/vault.rs`); what only a runtime can answer is
//! whether the transaction actually lands.
//!
//! READ THIS BEFORE TRUSTING A GREEN RUN. If this harness does not enforce
//! the rent-state transition, the two attack tests would pass with or
//! without the cushion and would prove nothing. So
//! `the_harness_enforces_the_rent_state_transition` establishes that first
//! and fails loudly if the rule is not modelled. Treat a failure there as
//! "this suite cannot verify the fix, verify it against a validator", never
//! as a defect in the program.

use blotto_litesvm_tests::*;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

const POT: u64 = 4_000_000_000; // tier 0's fixed pot

/// A plain System transfer, built by hand the way this harness builds every
/// other instruction (index 2, then the lamports, both little-endian).
fn transfer(from: &Pubkey, to: &Pubkey, lamports: u64) -> Instruction {
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&lamports.to_le_bytes());
    Instruction {
        program_id: system_program_id(),
        accounts: vec![AccountMeta::new(*from, true), AccountMeta::new(*to, false)],
        data,
    }
}

/// One lamport into a pool's vault. Anyone can do this and nothing should
/// stop them: the address is public and the transfer is ordinary.
fn donate_one_lamport(env: &mut Env, pool_id: u64) {
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ix = transfer(&stranger.pubkey(), &vault_pda(pool_id), 1);
    env.send(&[ix], &[&stranger])
        .expect("anyone may send a lamport to a vault");
}

/// Does this harness model the rule the whole finding rests on?
///
/// Built directly, with no program involved: a rent-exempt zero-data account
/// and a transfer out that would leave it holding one lamport. A runtime that
/// enforces the transition refuses it — with the rent error, not just any
/// error — and draining the same account to nothing stays legal.
///
/// The FEE PAYER IS SOMEONE ELSE, deliberately. The first run of this probe
/// (PR #106) made the probed account the transaction's payer, and the runtime
/// checks a payer's post-fee balance against rent BEFORE any instruction
/// runs: both halves then answered `InsufficientFundsForRent` about the fee,
/// the refusal passed for the wrong reason and the drain failed for no reason
/// the finding is about. A funded bystander pays the fee, so what the probe
/// measures is the transfer's post-state and nothing else.
#[test]
fn the_harness_enforces_the_rent_state_transition() {
    let Some(mut env) = Env::new() else { return };

    let sink = Pubkey::new_unique();
    let payer = Keypair::new();
    env.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let stranding = Keypair::new();
    env.svm
        .airdrop(&stranding.pubkey(), VAULT_RENT_CUSHION + 1)
        .unwrap();
    let refused = env.send(
        &[transfer(&stranding.pubkey(), &sink, VAULT_RENT_CUSHION)],
        &[&payer, &stranding],
    );

    let draining = Keypair::new();
    env.svm
        .airdrop(&draining.pubkey(), VAULT_RENT_CUSHION + 1)
        .unwrap();
    let allowed = env.send(
        &[transfer(&draining.pubkey(), &sink, VAULT_RENT_CUSHION + 1)],
        &[&payer, &draining],
    );

    match &refused {
        Err(e) if e.contains("InsufficientFundsForRent") => {}
        other => panic!(
            "this harness does NOT enforce the rent-state transition (got {other:?}), so \
             the dust tests below cannot fail and prove nothing. Verify the cushion \
             against a real validator instead."
        ),
    }
    assert!(
        allowed.is_ok(),
        "draining an account to zero must stay legal: {allowed:?}"
    );
    assert_eq!(
        env.balance(&stranding.pubkey()),
        VAULT_RENT_CUSHION + 1,
        "the refused transfer moved nothing"
    );
    assert_eq!(
        env.balance(&draining.pubkey()),
        0,
        "the drain emptied the account"
    );
}

/// The attack itself: donate a lamport, then run the pool through to Paid.
#[test]
fn a_poisoned_vault_still_pays_the_winner() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);

    donate_one_lamport(&mut env, 1);
    assert_eq!(
        env.balance(&vault_pda(1)),
        POT + VAULT_RENT_CUSHION + 1,
        "the donation landed on top of the pot and the cushion"
    );

    // A full field, so the pool seals on the 64th entry.
    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..64u16 {
        players.push(env.register_player(1).expect("register"));
    }
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 1, "Sealed");

    let settlement = env.settlement.insecure_clone();
    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).expect("reveal");

    let payouts = winner_payout(POT);
    let mut commit_args = [1u8; 32].to_vec();
    commit_args.extend_from_slice(&encode_payouts(&payouts));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &commit_args);
    env.send(&[ix], &[&settlement]).expect("commit_results");

    // The moment that used to be unlandable.
    let (winner, winner_entry) = &players[0];
    let before = env.balance(&winner.pubkey());
    let ix = pay_prizes_ix(
        &settlement.pubkey(),
        1,
        &[0],
        &[(winner.pubkey(), *winner_entry)],
    );
    env.send(&[ix], &[&settlement])
        .expect("a donated lamport must not be able to freeze the payout");

    assert_eq!(
        env.balance(&winner.pubkey()) - before,
        POT,
        "the winner is paid the pot in full, donation or no donation"
    );
    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 3, "Paid");
    assert_eq!(
        env.balance(&vault_pda(1)),
        VAULT_RENT_CUSHION + 1,
        "the cushion and the stranger's lamport stay behind, harmlessly"
    );
    // The point of the whole finding: the tier is not dead.
    assert_eq!(
        read_config(&env.svm).active_pool_by_tier[0],
        0,
        "the tier slot freed, so a successor pool can open"
    );
}

/// The refund fork had the same exposure: it returns exactly the pot, so a
/// donation would have left the same forbidden residue.
#[test]
fn a_poisoned_vault_still_refunds() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);

    donate_one_lamport(&mut env, 1);

    // A field below the minimum at the deadline takes the refund fork.
    for _ in 0..3 {
        env.register_player(1).expect("register");
    }
    env.advance_time(12 * 3600 + 1);

    let rando = Keypair::new();
    env.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    let platform_before = env.balance(&platform_pda());
    let ix = trigger_refund_ix(&rando.pubkey(), 1);
    env.send(&[ix], &[&rando])
        .expect("a donated lamport must not be able to freeze the refund");

    assert_eq!(read_pool(&env.svm, &pool_pda(1)).state, 4, "Refunding");
    assert_eq!(
        env.balance(&platform_pda()) - platform_before,
        POT,
        "the whole pot returned to the treasury"
    );
    assert_eq!(
        env.balance(&vault_pda(1)),
        VAULT_RENT_CUSHION + 1,
        "the cushion and the donation stay behind"
    );
}
