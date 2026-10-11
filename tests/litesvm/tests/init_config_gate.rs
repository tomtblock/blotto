//! Who may initialise Config (scanner triage 2026-10-11, item A —
//! docs/security/SCANNER-TRIAGE-2026-10-11.md).
//!
//! `Config` sits at the fixed PDA `[b"config"]`, and `init_config` used to
//! make whoever signed it the admin. On a fresh deployment that left a window
//! between the program going live and our own `init_config`, in which anyone
//! watching the chain could initialise Config first and own the deployment:
//! the keeper, both signers and `withdraw_platform`. Devnet was initialised
//! long before by the Squads vault, so the gap was a mainnet one.
//!
//! Since the fix only the program's UPGRADE AUTHORITY may sign `init_config`,
//! and the admin is an argument. These tests pin both halves against the
//! compiled program: every signer but the authority is refused, and the
//! authority can name a different key — the multisig — as admin without
//! becoming admin itself.

use blotto_litesvm_tests::*;
use litesvm::LiteSVM;
use solana_sdk::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;

/// Launch-shaped ceilings; the values do not matter to these tests.
const CEILINGS: [u64; 7] = [6_400_000_000; 7];

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair) -> Result<(), String> {
    svm.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer.pubkey()),
        &[payer],
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?} logs={:?}", e.err, e.meta.logs))
}

fn funded(svm: &mut LiteSVM) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    k
}

/// `init_config` signed by `signer`, naming `admin` as Config's admin.
fn init(svm: &mut LiteSVM, signer: &Keypair, admin: &Pubkey) -> Result<(), String> {
    let service = Pubkey::new_unique();
    let ix = init_config_ix(
        &signer.pubkey(),
        admin,
        &service,
        &service,
        &service,
        CEILINGS,
        0,
    );
    send(svm, &[ix], signer)
}

/// Config.admin as stored: the first field after the discriminator.
fn stored_admin(svm: &LiteSVM) -> Pubkey {
    let data = svm.get_account(&config_pda()).expect("config account").data;
    Pubkey::new_from_array(data[8..40].try_into().unwrap())
}

fn assert_refused_as(err: &str, code: &str, name: &str) {
    assert!(
        err.contains(code) || err.contains(name),
        "expected {name} ({code}), got: {err}"
    );
}

/// The attack the scanner described: a stranger lands `init_config` first,
/// naming itself admin. Refused, and Config stays uninitialised for the real
/// deployer.
#[test]
fn a_stranger_cannot_initialise_config() {
    let Some(mut svm) = bare_svm() else { return };
    let deployer = funded(&mut svm);
    set_upgrade_authority(&mut svm, Some(&deployer.pubkey()));
    let stranger = funded(&mut svm);

    let err =
        init(&mut svm, &stranger, &stranger.pubkey()).expect_err("a stranger initialised Config");
    assert_refused_as(&err, "6075", "NotUpgradeAuthority");
    assert!(
        svm.get_account(&config_pda())
            .is_none_or(|a| a.data.is_empty()),
        "a refused init_config must leave Config uninitialised"
    );

    // ...and the window is still the deployer's to close.
    init(&mut svm, &deployer, &deployer.pubkey()).expect("the upgrade authority initialises");
}

/// The mainnet order: the deploying key signs, the Squads vault becomes
/// admin, and the deploying key holds no admin power afterwards.
#[test]
fn the_upgrade_authority_names_a_different_admin_and_does_not_become_it() {
    let Some(mut svm) = bare_svm() else { return };
    let deployer = funded(&mut svm);
    set_upgrade_authority(&mut svm, Some(&deployer.pubkey()));
    let vault = funded(&mut svm);

    init(&mut svm, &deployer, &vault.pubkey()).expect("the upgrade authority initialises");
    assert_eq!(
        stored_admin(&svm),
        vault.pubkey(),
        "the named key is the admin"
    );

    // The deployer signed init_config but is not the admin: an admin-only
    // instruction (`has_one = admin`) refuses it, and accepts the vault.
    let keeper = Pubkey::new_unique();
    let err = send(
        &mut svm,
        &[set_keeper_ix(&deployer.pubkey(), &keeper)],
        &deployer,
    )
    .expect_err("the deployer acted as admin");
    assert!(
        err.contains("2001") || err.contains("ConstraintHasOne"),
        "got: {err}"
    );
    send(&mut svm, &[set_keeper_ix(&vault.pubkey(), &keeper)], &vault).expect("the vault is admin");
}

/// A program with no upgrade authority (deployed `--final`, or made
/// immutable before initialisation) can never be initialised — nobody can
/// satisfy the gate, which is the safe failure.
#[test]
fn a_program_with_no_upgrade_authority_cannot_be_initialised() {
    let Some(mut svm) = bare_svm() else { return };
    set_upgrade_authority(&mut svm, None);
    let anyone = funded(&mut svm);
    let err =
        init(&mut svm, &anyone, &anyone.pubkey()).expect_err("an immutable program initialised");
    assert_refused_as(&err, "6075", "NotUpgradeAuthority");
}

/// A zero admin would leave every admin instruction unsignable for good —
/// Config is write-once and nothing rotates the admin — so it is refused.
#[test]
fn a_zero_admin_is_refused() {
    let Some(mut svm) = bare_svm() else { return };
    let deployer = funded(&mut svm);
    set_upgrade_authority(&mut svm, Some(&deployer.pubkey()));
    let err = init(&mut svm, &deployer, &Pubkey::default()).expect_err("a zero admin was accepted");
    assert_refused_as(&err, "6076", "AdminMustNotBeZero");
}

/// Still write-once: the upgrade authority cannot re-initialise Config to
/// replace the admin it named.
#[test]
fn init_config_still_runs_exactly_once() {
    let Some(mut svm) = bare_svm() else { return };
    let deployer = funded(&mut svm);
    set_upgrade_authority(&mut svm, Some(&deployer.pubkey()));
    let vault = Pubkey::new_unique();
    init(&mut svm, &deployer, &vault).expect("first init");
    init(&mut svm, &deployer, &deployer.pubkey()).expect_err("Config was initialised twice");
    assert_eq!(stored_admin(&svm), vault, "the admin did not move");
}
