//! Ports of the two carried Surfpool suites (`tests/vrf.ts`, `tests/pass.ts`)
//! into LiteSVM, against the real artifact.
//!
//! `commit_vrf_seed`: the Switchboard Randomness account is fabricated
//! byte-for-byte (discriminator ‖ 400-byte struct; offsets from
//! switchboard-on-demand 0.12.1's #[repr(C)] layout, the same ones the old
//! Surfpool suite documented). The same-slot reveal+consume constraint is
//! honored by writing `reveal_slot = Clock.slot`.
//!
//! The freeze: a minted pass must refuse transfer with mpl-core's
//! `InvalidAuthority` (0x9) — the empirically verified rejection code (see
//! programs/blotto_cup/src/pass.rs and docs/reference/q-016-verification-note.md).

use blotto_litesvm_tests::*;
use solana_sdk::account::Account;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use std::str::FromStr;

fn sb_mainnet_pid() -> Pubkey {
    Pubkey::from_str("SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv").unwrap()
}

// RandomnessAccountData: disc(8) ‖ struct(400). Struct offsets: seed_slot 96,
// reveal_slot 136, value 144.
const RANDOMNESS_DISC: [u8; 8] = [10, 66, 229, 135, 220, 239, 217, 114];
const RANDOMNESS_LEN: usize = 8 + 400;
const OFF_SEED_SLOT: usize = 8 + 96;
const OFF_REVEAL_SLOT: usize = 8 + 136;
const OFF_VALUE: usize = 8 + 144;

fn set_randomness_account(
    env: &mut Env,
    address: Pubkey,
    owner: Pubkey,
    reveal_slot: u64,
    value: [u8; 32],
) {
    let mut data = vec![0u8; RANDOMNESS_LEN];
    data[..8].copy_from_slice(&RANDOMNESS_DISC);
    data[OFF_SEED_SLOT..OFF_SEED_SLOT + 8]
        .copy_from_slice(&reveal_slot.saturating_sub(1).to_le_bytes());
    data[OFF_REVEAL_SLOT..OFF_REVEAL_SLOT + 8].copy_from_slice(&reveal_slot.to_le_bytes());
    data[OFF_VALUE..OFF_VALUE + 32].copy_from_slice(&value);
    env.svm
        .set_account(
            address,
            Account {
                lamports: 10_000_000,
                data,
                owner,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
}

fn commit_vrf_ix(signer: &Pubkey, pool_id: u64, randomness: &Pubkey) -> Instruction {
    let mut data = disc("commit_vrf_seed").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(pool_pda(pool_id), false),
            AccountMeta::new_readonly(*randomness, false),
            AccountMeta::new_readonly(*signer, true),
        ],
        data,
    }
}

fn read_vrf_seed(env: &Env, pool: &Pubkey) -> [u8; 32] {
    let data = env.svm.get_account(pool).unwrap().data;
    data[108..140].try_into().unwrap()
}

#[test]
fn commit_vrf_seed_copies_a_revealed_value_write_once() {
    let Some(mut env) = Env::new() else { return };
    // Open a pool WITHOUT the harness's seed patch.
    let settlement = env.settlement.insecure_clone();
    let ix = open_pool_ix(&settlement.pubkey(), 1, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement]).unwrap();
    let pool = pool_pda(1);
    assert_eq!(read_vrf_seed(&env, &pool), [0u8; 32], "opens uncommitted");

    let anyone = Keypair::new();
    env.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    let slot = 100; // Env warps to slot 100

    // Wrong owner → InvalidRandomnessAccount.
    let rand = Pubkey::new_unique();
    set_randomness_account(&mut env, rand, system_program_id(), slot, [77u8; 32]);
    let err = env
        .send(&[commit_vrf_ix(&anyone.pubkey(), 1, &rand)], &[&anyone])
        .unwrap_err();
    assert!(err.contains("6002"), "{err}");

    // Not revealed in this slot → RandomnessNotResolved.
    let rand = Pubkey::new_unique();
    set_randomness_account(&mut env, rand, sb_mainnet_pid(), slot - 3, [77u8; 32]);
    let err = env
        .send(&[commit_vrf_ix(&anyone.pubkey(), 1, &rand)], &[&anyone])
        .unwrap_err();
    assert!(err.contains("6003"), "{err}");

    // Revealed at the current slot → the value lands, permissionlessly.
    let rand = Pubkey::new_unique();
    set_randomness_account(&mut env, rand, sb_mainnet_pid(), slot, [77u8; 32]);
    env.send(&[commit_vrf_ix(&anyone.pubkey(), 1, &rand)], &[&anyone])
        .expect("commit");
    assert_eq!(read_vrf_seed(&env, &pool), [77u8; 32]);

    // Write-once: a second commit rejects.
    let rand2 = Pubkey::new_unique();
    set_randomness_account(&mut env, rand2, sb_mainnet_pid(), slot, [88u8; 32]);
    let err = env
        .send(&[commit_vrf_ix(&anyone.pubkey(), 1, &rand2)], &[&anyone])
        .unwrap_err();
    assert!(err.contains("6001"), "{err}");
    assert_eq!(
        read_vrf_seed(&env, &pool),
        [77u8; 32],
        "first value survives"
    );
}

#[test]
fn a_minted_pass_refuses_transfer() {
    let Some(mut env) = Env::new() else { return };
    env.open_ready_pool(1, 0);
    let (player, entry) = env.register_player(1).unwrap();
    let _ = entry;

    // The pass asset pubkey is recorded on the Entry (offset 107..139).
    let entry_data = env.svm.get_account(&entry).unwrap().data;
    let pass_asset = Pubkey::new_from_array(entry_data[107..139].try_into().unwrap());
    assert!(env.svm.get_account(&pass_asset).is_some(), "pass minted");

    // mpl-core TransferV1: [asset(w), collection, payer(s,w), authority
    // (placeholder = mpl-core id → payer acts), new_owner, system_program,
    // log_wrapper (placeholder)] ‖ data [14, 0].
    let thief_target = Pubkey::new_unique();
    let ix = Instruction {
        program_id: mpl_core_id(),
        accounts: vec![
            AccountMeta::new(pass_asset, false),
            AccountMeta::new_readonly(pass_collection_pda(&pool_pda(1)), false),
            AccountMeta::new(player.pubkey(), true),
            AccountMeta::new_readonly(mpl_core_id(), false),
            AccountMeta::new_readonly(thief_target, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(mpl_core_id(), false),
        ],
        data: vec![14, 0],
    };
    let err = env.send(&[ix], &[&player]).unwrap_err();
    // PermanentFreezeDelegate force-rejects inside the lifecycle validator:
    // InvalidAuthority (0x9 = 9), NOT AssetIsFrozen — the empirically
    // verified code. A different code here means the freeze mechanism moved.
    assert!(
        err.contains("Custom(9)"),
        "expected InvalidAuthority(0x9): {err}"
    );
}
