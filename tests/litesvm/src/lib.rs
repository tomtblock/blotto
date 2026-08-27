//! Test harness: a byte-level client for the compiled `blotto_cup.so`.
//!
//! Everything here is hand-encoded — discriminators, Borsh args, account
//! orders, PDA derivations — deliberately duplicating what the program crate
//! and the IDL would provide. The duplication is the test: if the artifact's
//! real interface drifts from what this file encodes, the suite fails, the
//! same way a TypeScript client would.
//!
//! Artifact-gated: `artifacts()` returns `None` (and the suite skips, loudly)
//! when `target/deploy/blotto_cup.so` is absent — run `anchor build` first.
//! The mpl-core binary is the committed Phase 0 fixture at
//! `tests/fixtures/mpl_core.so` (a public program; refresh command in
//! Anchor.toml).

use ed25519_dalek::{Signer as DalekSigner, SigningKey};
use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_sdk::clock::Clock;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use solana_sdk::slot_hashes::SlotHashes;
use solana_sdk::transaction::Transaction;
use std::path::PathBuf;
use std::str::FromStr;

// ---------------------------------------------------------------------------
// Program addresses
// ---------------------------------------------------------------------------

pub fn program_id() -> Pubkey {
    Pubkey::from_str("4pspHqtbdgqKTvSxvKFT2ycEU28u3EWdxjmj3xsTHD3Y").unwrap()
}
pub fn mpl_core_id() -> Pubkey {
    Pubkey::from_str("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d").unwrap()
}
pub fn ed25519_id() -> Pubkey {
    Pubkey::from_str("Ed25519SigVerify111111111111111111111111111").unwrap()
}
pub fn instructions_sysvar_id() -> Pubkey {
    Pubkey::from_str("Sysvar1nstructions1111111111111111111111111").unwrap()
}
pub fn slot_hashes_id() -> Pubkey {
    Pubkey::from_str("SysvarS1otHashes111111111111111111111111111").unwrap()
}
pub fn system_program_id() -> Pubkey {
    Pubkey::from_str("11111111111111111111111111111111").unwrap()
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

/// (program_so, mpl_core_so) — or None if either is missing.
pub fn artifacts() -> Option<(PathBuf, PathBuf)> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let program = root.join("../../target/deploy/blotto_cup.so");
    let mpl = root.join("../fixtures/mpl_core.so");
    if program.exists() && mpl.exists() {
        Some((program, mpl))
    } else {
        eprintln!(
            "SKIP: missing artifact ({} / {}). Run `anchor build` and \
             keep tests/fixtures/mpl_core.so present.",
            program.display(),
            mpl.display()
        );
        None
    }
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/// Anchor global-instruction discriminator.
pub fn disc(name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("global:{name}").as_bytes());
    h[..8].try_into().unwrap()
}

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &program_id()).0
}
pub fn pool_pda(id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"pool", &id.to_le_bytes()], &program_id()).0
}
pub fn vault_pda(id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", &id.to_le_bytes()], &program_id()).0
}
pub fn fees_pda(id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"fees", &id.to_le_bytes()], &program_id()).0
}
pub fn entry_pda(pool: &Pubkey, player: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"entry", pool.as_ref(), player.as_ref()], &program_id()).0
}
pub fn pass_collection_pda(pool: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"pass_collection", pool.as_ref()], &program_id()).0
}

// ---------------------------------------------------------------------------
// The entry packet + its Ed25519 instruction (mirrors entry_packet.rs)
// ---------------------------------------------------------------------------

pub fn encode_packet(
    wallet: &Pubkey,
    pool: &Pubkey,
    nonce: u64,
    geo: u8,
    age: u8,
    kyc: u8,
    issued_at: i64,
) -> Vec<u8> {
    // Terms version 1 (D-B4) — the well-formed default; tests exercising the
    // terms gate use `encode_packet_with_terms`.
    encode_packet_with_terms(wallet, pool, nonce, geo, age, kyc, issued_at, 1)
}

#[allow(clippy::too_many_arguments)]
pub fn encode_packet_with_terms(
    wallet: &Pubkey,
    pool: &Pubkey,
    nonce: u64,
    geo: u8,
    age: u8,
    kyc: u8,
    issued_at: i64,
    terms_version: u16,
) -> Vec<u8> {
    let mut m = Vec::with_capacity(85);
    m.extend_from_slice(wallet.as_ref());
    m.extend_from_slice(pool.as_ref());
    m.extend_from_slice(&nonce.to_le_bytes());
    m.push(geo);
    m.push(age);
    m.push(kyc);
    m.extend_from_slice(&issued_at.to_le_bytes());
    m.extend_from_slice(&terms_version.to_le_bytes());
    m
}

/// Build a real `Ed25519Program` instruction over `message`, signed by `key`.
/// Layout: header(2) ‖ offsets(14) ‖ pubkey(32) ‖ signature(64) ‖ message.
pub fn ed25519_ix(key: &SigningKey, message: &[u8]) -> Instruction {
    let sig = key.sign(message);
    let pubkey = key.verifying_key().to_bytes();
    let pubkey_offset: u16 = 16;
    let sig_offset: u16 = 16 + 32;
    let msg_offset: u16 = 16 + 32 + 64;
    let mut data = vec![1u8, 0u8];
    for v in [
        sig_offset,
        u16::MAX,
        pubkey_offset,
        u16::MAX,
        msg_offset,
        message.len() as u16,
        u16::MAX,
    ] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    data.extend_from_slice(&pubkey);
    data.extend_from_slice(&sig.to_bytes());
    data.extend_from_slice(message);
    Instruction {
        program_id: ed25519_id(),
        accounts: vec![],
        data,
    }
}

// ---------------------------------------------------------------------------
// Instruction builders (account orders mirror the #[derive(Accounts)] structs)
// ---------------------------------------------------------------------------

pub fn init_config_ix(
    admin: &Pubkey,
    entry_signer: &Pubkey,
    settlement_signer: &Pubkey,
    platform_wallet: &Pubkey,
    vault_ceilings: [u64; 7],
) -> Instruction {
    let mut data = disc("init_config").to_vec();
    data.extend_from_slice(entry_signer.as_ref());
    data.extend_from_slice(settlement_signer.as_ref());
    data.extend_from_slice(platform_wallet.as_ref());
    for c in vault_ceilings {
        data.extend_from_slice(&c.to_le_bytes());
    }
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

/// Admin-only setters share one account shape.
pub fn admin_ix(admin: &Pubkey, name: &str, arg_bytes: &[u8]) -> Instruction {
    let mut data = disc(name).to_vec();
    data.extend_from_slice(arg_bytes);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda(), false),
        ],
        data,
    }
}

pub fn open_pool_ix(
    settlement: &Pubkey,
    pool_id: u64,
    tier: u8,
    sealing_pubkey: [u8; 32],
    sealing_secret_hash: [u8; 32],
) -> Instruction {
    let mut data = disc("open_pool").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    data.push(tier);
    data.extend_from_slice(&sealing_pubkey);
    data.extend_from_slice(&sealing_secret_hash);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*settlement, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(pool_pda(pool_id), false),
            AccountMeta::new_readonly(vault_pda(pool_id), false),
            AccountMeta::new_readonly(fees_pda(pool_id), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub fn create_pass_collection_ix(payer: &Pubkey, pool_id: u64) -> Instruction {
    let mut data = disc("create_pass_collection").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    let pool = pool_pda(pool_id);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(pool, false),
            AccountMeta::new(pass_collection_pda(&pool), false),
            AccountMeta::new_readonly(mpl_core_id(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub fn register_ix(
    player: &Pubkey,
    pool_id: u64,
    platform_wallet: &Pubkey,
    pass_asset: &Pubkey,
    battles_hash: [u8; 32],
) -> Instruction {
    let mut data = disc("register").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    data.extend_from_slice(&battles_hash);
    let pool = pool_pda(pool_id);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*player, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(pool, false),
            AccountMeta::new(vault_pda(pool_id), false),
            AccountMeta::new(fees_pda(pool_id), false),
            AccountMeta::new(*platform_wallet, false),
            AccountMeta::new(entry_pda(&pool, player), false),
            AccountMeta::new(pass_collection_pda(&pool), false),
            AccountMeta::new(*pass_asset, true),
            AccountMeta::new_readonly(mpl_core_id(), false),
            AccountMeta::new_readonly(instructions_sysvar_id(), false),
            AccountMeta::new_readonly(slot_hashes_id(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub fn settle_ix(settlement: &Pubkey, pool_id: u64, name: &str, args: &[u8]) -> Instruction {
    let mut data = disc(name).to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    data.extend_from_slice(args);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*settlement, true),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new(pool_pda(pool_id), false),
        ],
        data,
    }
}

/// Borsh-encode a committed payout list: u32 len + per payout (u16 seat LE,
/// u64 amount LE) — the `Vec<Payout>` argument of `commit_results`.
pub fn encode_payouts(payouts: &[(u16, u64)]) -> Vec<u8> {
    let mut out = (payouts.len() as u32).to_le_bytes().to_vec();
    for &(seat, amount) in payouts {
        out.extend_from_slice(&seat.to_le_bytes());
        out.extend_from_slice(&amount.to_le_bytes());
    }
    out
}

/// The standard no-tie payout list for a pool whose seats 0..15 are the
/// ranking's top 16 in order: seat i takes rank i+1's band amount.
pub fn band_payouts(entry_lamports: u64) -> Vec<(u16, u64)> {
    let pot = entry_lamports / 10 * 8 * 64;
    const BANDS: [u64; 16] = [270, 158, 102, 78, 50, 50, 50, 50, 27, 27, 27, 27, 27, 27, 27, 27];
    (0..16u16).map(|i| (i, pot / 1024 * BANDS[i as usize])).collect()
}

pub fn pay_prizes_ix(
    settlement: &Pubkey,
    pool_id: u64,
    seats: &[u16],
    winner_wallets_and_entries: &[(Pubkey, Pubkey)],
) -> Instruction {
    let mut data = disc("pay_prizes").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    data.extend_from_slice(&(seats.len() as u32).to_le_bytes());
    for &s in seats {
        data.extend_from_slice(&s.to_le_bytes());
    }
    let mut accounts = vec![
        AccountMeta::new_readonly(*settlement, true),
        AccountMeta::new_readonly(config_pda(), false),
        AccountMeta::new(pool_pda(pool_id), false),
        AccountMeta::new(vault_pda(pool_id), false),
        AccountMeta::new_readonly(system_program_id(), false),
    ];
    for (wallet, entry) in winner_wallets_and_entries {
        accounts.push(AccountMeta::new(*wallet, false));
        accounts.push(AccountMeta::new(*entry, false));
    }
    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

pub fn flag_ix(settlement: &Pubkey, pool_id: u64, entry: &Pubkey, name: &str) -> Instruction {
    let mut data = disc(name).to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*settlement, true),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new_readonly(pool_pda(pool_id), false),
            AccountMeta::new(*entry, false),
        ],
        data,
    }
}

pub fn release_escrow_ix(
    settlement: &Pubkey,
    pool_id: u64,
    entry: &Pubkey,
    player: &Pubkey,
) -> Instruction {
    let mut data = disc("release_escrow").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*settlement, true),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new_readonly(pool_pda(pool_id), false),
            AccountMeta::new(vault_pda(pool_id), false),
            AccountMeta::new(*entry, false),
            AccountMeta::new(*player, false),
            AccountMeta::new_readonly(instructions_sysvar_id(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub fn forfeit_escrow_ix(
    settlement: &Pubkey,
    pool_id: u64,
    entry: &Pubkey,
    platform_wallet: &Pubkey,
) -> Instruction {
    let mut data = disc("forfeit_escrow").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*settlement, true),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new_readonly(pool_pda(pool_id), false),
            AccountMeta::new(vault_pda(pool_id), false),
            AccountMeta::new(*entry, false),
            AccountMeta::new(*platform_wallet, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

pub fn trigger_refund_ix(signer: &Pubkey, pool_id: u64) -> Instruction {
    let mut data = disc("trigger_refund").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(pool_pda(pool_id), false),
        ],
        data,
    }
}

pub fn refund_ix(signer: &Pubkey, pool_id: u64, entry: &Pubkey, player: &Pubkey) -> Instruction {
    let mut data = disc("refund").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new(pool_pda(pool_id), false),
            AccountMeta::new(vault_pda(pool_id), false),
            AccountMeta::new(fees_pda(pool_id), false),
            AccountMeta::new(*entry, false),
            AccountMeta::new(*player, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

// ---------------------------------------------------------------------------
// Account-layout readers (offsets mirror state.rs; a drift fails the suite)
// ---------------------------------------------------------------------------

pub struct PoolView {
    pub entrants: u16,
    pub state: u8, // 0 Open, 1 Sealed, 2 Scored, 3 Paid, 4 Refunding, 5 Closed
    pub class_counters: [u16; 5],
    /// The committed payout list (seat, amount), D3-B.
    pub payouts: Vec<(u16, u64)>,
    pub paid_mask: u64,
    pub refunded_count: u16,
}

pub fn read_pool(svm: &LiteSVM, pool: &Pubkey) -> PoolView {
    let data = svm.get_account(pool).expect("pool account").data;
    let counters: [u16; 5] =
        core::array::from_fn(|i| u16::from_le_bytes([data[140 + 2 * i], data[141 + 2 * i]]));
    // Layout after results_committed@183 (D3-B): payouts_len u16 @184,
    // payouts [u16+u64; 64] @186, paid_mask u64 @826, refunded_count @834.
    let payouts_len = u16::from_le_bytes([data[184], data[185]]) as usize;
    let payouts = (0..payouts_len)
        .map(|i| {
            let base = 186 + i * 10;
            (
                u16::from_le_bytes([data[base], data[base + 1]]),
                u64::from_le_bytes(data[base + 2..base + 10].try_into().unwrap()),
            )
        })
        .collect();
    PoolView {
        entrants: u16::from_le_bytes([data[25], data[26]]),
        state: data[43],
        class_counters: counters,
        payouts,
        paid_mask: u64::from_le_bytes(data[826..834].try_into().unwrap()),
        refunded_count: u16::from_le_bytes([data[834], data[835]]),
    }
}

pub struct EntryView {
    pub index: u16,
    pub class: u8,
    pub flagged: bool,
    pub settled: bool,
    pub refunded: bool,
    pub escrow_lamports: u64,
}

pub fn read_entry(svm: &LiteSVM, entry: &Pubkey) -> EntryView {
    let data = svm.get_account(entry).expect("entry account").data;
    EntryView {
        index: u16::from_le_bytes([data[72], data[73]]),
        class: data[106],
        flagged: data[179] != 0,
        settled: data[180] != 0,
        refunded: data[181] != 0,
        escrow_lamports: u64::from_le_bytes(data[182..190].try_into().unwrap()),
    }
}

/// Write a fake committed VRF seed straight into the Pool account
/// (offset 108, mirroring state.rs). Stands in for `commit_vrf_seed`, whose
/// Switchboard reveal cannot run inside LiteSVM; the write-once and oracle
/// checks are covered by the carried devnet test (`tests/vrf.ts`).
pub fn patch_vrf_seed(svm: &mut LiteSVM, pool: &Pubkey, seed: [u8; 32]) {
    let mut acct = svm.get_account(pool).expect("pool account");
    acct.data[108..140].copy_from_slice(&seed);
    svm.set_account(*pool, acct).unwrap();
}

// ---------------------------------------------------------------------------
// The environment
// ---------------------------------------------------------------------------

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub settlement: Keypair,
    pub entry_signer: SigningKey,
    pub platform_wallet: Pubkey,
    pub pool_secret: [u8; 32],
    pub sealing_secret_hash: [u8; 32],
    /// Log lines of every SUCCESSFUL transaction, in send order — the raw
    /// material for the indexer's cross-language event fixtures.
    pub captured_logs: Vec<Vec<String>>,
}

impl Env {
    /// Fresh SVM with both programs loaded, sysvars set, config initialized.
    /// Returns None (skip) when artifacts are missing.
    #[allow(clippy::new_ret_no_self)]
    pub fn new() -> Option<Env> {
        let (program_so, mpl_so) = artifacts()?;
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(program_id(), program_so).unwrap();
        svm.add_program_from_file(mpl_core_id(), mpl_so).unwrap();

        // A believable clock + slot history: slot 100, entries ≥ 5 back.
        svm.warp_to_slot(100);
        let mut clock: Clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = 1_756_000_000;
        svm.set_sysvar(&clock);
        let hashes: Vec<(u64, solana_sdk::hash::Hash)> = (60..=99)
            .rev()
            .map(|s| (s, solana_sdk::hash::Hash::new_unique()))
            .collect();
        svm.set_sysvar(&SlotHashes::new(&hashes));

        let admin = Keypair::new();
        let settlement = Keypair::new();
        let entry_signer = SigningKey::from_bytes(&[7u8; 32]);
        let platform_wallet = Pubkey::new_unique();
        svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
        svm.airdrop(&settlement.pubkey(), 100_000_000_000).unwrap();
        // The platform wallet stays unfunded on purpose: the fees sweep must
        // create it, proving a transfer to a fresh address suffices.

        let entry_signer_pk = Pubkey::new_from_array(entry_signer.verifying_key().to_bytes());
        // Launch ceilings (D2): tier 0 = 6.4 SOL; every other tier = its own
        // gross (entry × 64), so the ceiling is a cap, not a second switch.
        let ceilings: [u64; 7] = {
            let entries = [
                100_000_000u64,
                500_000_000,
                750_000_000,
                1_000_000_000,
                2_500_000_000,
                5_000_000_000,
                7_500_000_000,
            ];
            core::array::from_fn(|i| if i == 0 { 6_400_000_000 } else { entries[i] * 64 })
        };
        let ix = init_config_ix(
            &admin.pubkey(),
            &entry_signer_pk,
            &settlement.pubkey(),
            &platform_wallet,
            ceilings,
        );
        let mut env = Env {
            svm,
            admin,
            settlement,
            entry_signer,
            platform_wallet,
            pool_secret: [42u8; 32],
            sealing_secret_hash: Sha256::digest([42u8; 32]).into(),
            captured_logs: Vec::new(),
        };
        env.send(&[ix], &[]).expect("init_config");
        Some(env)
    }

    /// Send instructions; fee payer is the first extra signer, or the admin.
    pub fn send(&mut self, ixs: &[Instruction], extra: &[&Keypair]) -> Result<(), String> {
        // A fresh blockhash per send: deliberately re-sent duplicates (a
        // rejected call retried after fixing state) must not collide on the
        // transaction signature and die as AlreadyProcessed.
        self.svm.expire_blockhash();
        let payer: &Keypair = if extra.is_empty() {
            &self.admin
        } else {
            extra[0]
        };
        let mut signers: Vec<&Keypair> = vec![payer];
        for k in extra.iter().skip(1) {
            signers.push(k);
        }
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&payer.pubkey()),
            &signers,
            self.svm.latest_blockhash(),
        );
        match self.svm.send_transaction(tx) {
            Ok(meta) => {
                self.captured_logs.push(meta.logs.clone());
                Ok(())
            }
            Err(e) => Err(format!("{:?} logs={:?}", e.err, e.meta.logs)),
        }
    }

    /// Open pool `pool_id` on `tier` and give it a VRF seed + pass Collection.
    pub fn open_ready_pool(&mut self, pool_id: u64, tier: u8) {
        let ix = open_pool_ix(
            &self.settlement.pubkey(),
            pool_id,
            tier,
            [9u8; 32],
            self.sealing_secret_hash,
        );
        let settlement = self.settlement.insecure_clone();
        self.send(&[ix], &[&settlement]).expect("open_pool");
        patch_vrf_seed(&mut self.svm, &pool_pda(pool_id), [5u8; 32]);
        let ix = create_pass_collection_ix(&self.settlement.pubkey(), pool_id);
        self.send(&[ix], &[&settlement])
            .expect("create_pass_collection");
    }

    /// Fund a fresh player and register them. Returns (player, entry PDA).
    pub fn register_player(&mut self, pool_id: u64) -> Result<(Keypair, Pubkey), String> {
        let player = Keypair::new();
        self.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        self.register_as(pool_id, &player).map(|e| (player, e))
    }

    /// Register a specific funded keypair.
    pub fn register_as(&mut self, pool_id: u64, player: &Keypair) -> Result<Pubkey, String> {
        let pass_asset = Keypair::new();
        let pool = pool_pda(pool_id);
        let now = self.svm.get_sysvar::<Clock>().unix_timestamp;
        let packet = encode_packet(&player.pubkey(), &pool, 1, 1, 1, 0, now);
        let sig_ix = ed25519_ix(&self.entry_signer, &packet);
        let reg_ix = register_ix(
            &player.pubkey(),
            pool_id,
            &self.platform_wallet,
            &pass_asset.pubkey(),
            [3u8; 32],
        );
        let entry = entry_pda(&pool, &player.pubkey());
        self.send(&[sig_ix, reg_ix], &[player, &pass_asset])?;
        Ok(entry)
    }

    pub fn balance(&self, key: &Pubkey) -> u64 {
        self.svm.get_balance(key).unwrap_or(0)
    }

    /// Move the clock forward.
    pub fn advance_time(&mut self, secs: i64) {
        let mut clock: Clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }
}
