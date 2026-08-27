//! Cross-language event fixture: run a compressed but complete lifecycle
//! against the REAL artifact and dump every successful transaction's logs.
//! The indexer's decode suite replays these exact `Program data:` payloads,
//! so the Rust `#[event]` structs and the TypeScript decoders are checked
//! against each other rather than against copies of themselves.
//!
//! Regenerate the committed fixture with:
//!   DUMP_EVENT_FIXTURE=1 cargo test --test dump_events
//! (writes ../../backend/indexer/test/fixtures/lifecycle-logs.json)

use blotto_litesvm_tests::*;
use solana_sdk::account::Account;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
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

    // Pool 1: full lifecycle with a flagged winner, escrow release+forfeit.
    env.open_ready_pool(1, 0);
    let mut players: Vec<(Keypair, Pubkey)> = Vec::new();
    for _ in 0..64 {
        players.push(env.register_player(1).unwrap());
    }
    let settlement = env.settlement.insecure_clone();
    for (_, entry) in players.iter().take(2) {
        let ix = flag_ix(&settlement.pubkey(), 1, entry, "flag_entry");
        env.send(&[ix], &[&settlement]).unwrap();
    }
    // Unflag one again so the fixture carries both flag directions.
    let ix = flag_ix(&settlement.pubkey(), 1, &players[0].1, "clear_flag");
    env.send(&[ix], &[&settlement]).unwrap();
    let ix = flag_ix(&settlement.pubkey(), 1, &players[0].1, "flag_entry");
    env.send(&[ix], &[&settlement]).unwrap();

    let secret = env.pool_secret;
    let ix = settle_ix(&settlement.pubkey(), 1, "reveal_pool_secret", &secret);
    env.send(&[ix], &[&settlement]).unwrap();
    // D3-B: commit the payout list (seats 0..15 take ranks 1..16's bands in
    // this fixture's ranking), then pay by seat in two batches of eight.
    let mut args = [1u8; 32].to_vec();
    args.extend_from_slice(&encode_payouts(&band_payouts(100_000_000)));
    let ix = settle_ix(&settlement.pubkey(), 1, "commit_results", &args);
    env.send(&[ix], &[&settlement]).unwrap();
    for half in 0u16..2 {
        let seats: Vec<u16> = (0..8u16).map(|s| half * 8 + s).collect();
        let metas: Vec<(Pubkey, Pubkey)> = seats
            .iter()
            .map(|&seat| {
                let (p, e) = &players[seat as usize];
                (p.pubkey(), *e)
            })
            .collect();
        let ix = pay_prizes_ix(&settlement.pubkey(), 1, &seats, &metas);
        env.send(&[ix], &[&settlement]).unwrap();
    }
    let ix = release_escrow_ix(&settlement.pubkey(), 1, &players[0].1, &players[0].0.pubkey());
    env.send(&[ix], &[&settlement]).unwrap();
    let ix = forfeit_escrow_ix(&settlement.pubkey(), 1, &players[1].1, &env.platform_wallet);
    env.send(&[ix], &[&settlement]).unwrap();

    // Pool 2: the refund fork — opened by hand so the VRF seed lands via a
    // REAL commit_vrf_seed (emitting PoolVrfSeeded into the fixture).
    let ix = open_pool_ix(&settlement.pubkey(), 2, 0, [9; 32], env.sealing_secret_hash);
    env.send(&[ix], &[&settlement]).unwrap();
    commit_vrf_for_real(&mut env, 2);
    let ix = create_pass_collection_ix(&settlement.pubkey(), 2);
    env.send(&[ix], &[&settlement]).unwrap();
    let refunders: Vec<(Keypair, Pubkey)> =
        (0..2).map(|_| env.register_player(2).unwrap()).collect();
    env.advance_time(72 * 3600 + 1);
    let ix = trigger_refund_ix(&settlement.pubkey(), 2);
    env.send(&[ix], &[&settlement]).unwrap();
    for (player, entry) in &refunders {
        let ix = refund_ix(&settlement.pubkey(), 2, entry, &player.pubkey());
        env.send(&[ix], &[&settlement]).unwrap();
    }

    // Every transaction with a Program data line makes it into the fixture.
    let with_events: Vec<&Vec<String>> = env
        .captured_logs
        .iter()
        .filter(|logs| logs.iter().any(|l| l.starts_with("Program data: ")))
        .collect();
    assert!(with_events.len() > 70, "expected a rich event stream");

    if std::env::var("DUMP_EVENT_FIXTURE").is_ok() {
        let mut out = String::from("{\n \"_comment\": \"GENERATED by tests/litesvm/tests/dump_events.rs (DUMP_EVENT_FIXTURE=1 cargo test --test dump_events) — real transaction logs from the compiled program executing in LiteSVM. Do not edit.\",\n \"transactions\": [\n");
        for (i, logs) in with_events.iter().enumerate() {
            out.push_str("  [");
            for (j, l) in logs.iter().enumerate() {
                out.push_str(&format!("{}{:?}", if j > 0 { "," } else { "" }, l));
            }
            out.push_str(if i + 1 < with_events.len() { "],\n" } else { "]\n" });
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
