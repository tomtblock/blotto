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
    Pubkey::from_str("5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17").unwrap()
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
pub fn platform_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"platform"], &program_id()).0
}

/// The launch tier prices (constants.rs::TIER_ENTRY_LAMPORTS).
pub const TIER_PRICES: [u64; 7] = [
    100_000_000,
    500_000_000,
    750_000_000,
    1_000_000_000,
    2_500_000_000,
    5_000_000_000,
    7_500_000_000,
];

/// The launch FIXED pots (constants.rs::TIER_POT_LAMPORTS, D-A1 revised).
pub const TIER_POTS: [u64; 7] = [
    4_000_000_000,
    20_000_000_000,
    30_000_000_000,
    40_000_000_000,
    100_000_000_000,
    200_000_000_000,
    300_000_000_000,
];
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
    keeper: &Pubkey,
    vault_ceilings: [u64; 7],
    treasury_min_platform_lamports: u64,
) -> Instruction {
    let mut data = disc("init_config").to_vec();
    data.extend_from_slice(entry_signer.as_ref());
    data.extend_from_slice(settlement_signer.as_ref());
    data.extend_from_slice(keeper.as_ref());
    for c in vault_ceilings {
        data.extend_from_slice(&c.to_le_bytes());
    }
    data.extend_from_slice(&treasury_min_platform_lamports.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new_readonly(platform_pda(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

/// `fund_platform_wallet` — permissionless treasury deposit.
pub fn fund_platform_ix(funder: &Pubkey, amount: u64) -> Instruction {
    let mut data = disc("fund_platform_wallet").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*funder, true),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new(platform_pda(), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

/// `withdraw_platform` — the one Squads-gated treasury exit.
pub fn withdraw_platform_ix(admin: &Pubkey, destination: &Pubkey, amount: u64) -> Instruction {
    let mut data = disc("withdraw_platform").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new(platform_pda(), false),
            AccountMeta::new(*destination, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

/// `set_tier_economics(tier, price, pot)` — founder-owned numbers.
pub fn set_tier_economics_ix(admin: &Pubkey, tier: u8, price: u64, pot: u64) -> Instruction {
    let mut args = vec![tier];
    args.extend_from_slice(&price.to_le_bytes());
    args.extend_from_slice(&pot.to_le_bytes());
    admin_ix(admin, "set_tier_economics", &args)
}

/// `set_treasury_policy(reserve_pots, min_platform_lamports)`.
pub fn set_treasury_policy_ix(admin: &Pubkey, reserve_pots: u8, min: u64) -> Instruction {
    let mut args = vec![reserve_pots];
    args.extend_from_slice(&min.to_le_bytes());
    admin_ix(admin, "set_treasury_policy", &args)
}

/// `set_keeper(new_keeper)` — rotate the key `open_pool` requires before
/// the liveness fallback (prompt v2 §A).
pub fn set_keeper_ix(admin: &Pubkey, keeper: &Pubkey) -> Instruction {
    admin_ix(admin, "set_keeper", keeper.as_ref())
}

/// `set_pool_timing(fill_deadline_seconds, cooldown_seconds)` — for pools
/// opened from now on; never touches an open pool.
pub fn set_pool_timing_ix(admin: &Pubkey, fill_deadline_seconds: i64, cooldown_seconds: i64) -> Instruction {
    let mut args = fill_deadline_seconds.to_le_bytes().to_vec();
    args.extend_from_slice(&cooldown_seconds.to_le_bytes());
    admin_ix(admin, "set_pool_timing", &args)
}

/// `migrate_config(keeper)` — the one-shot 2026-09-07 layout migration.
/// The admin pays the rent top-up (hence `mut`).
pub fn migrate_config_ix(admin: &Pubkey, keeper: &Pubkey) -> Instruction {
    let mut data = disc("migrate_config").to_vec();
    data.extend_from_slice(keeper.as_ref());
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

/// `open_pool` — keeper-gated since 2026-09-07 (prompt v2 §A): `opener` is
/// `Config.keeper`, or any funded signer once the tier's liveness fallback
/// applies (24 h idle past its cooldown; a never-settled tier counts as
/// idle since the epoch). Pays the Pool's rent.
pub fn open_pool_ix(
    opener: &Pubkey,
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
            AccountMeta::new(*opener, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(pool_pda(pool_id), false),
            AccountMeta::new(vault_pda(pool_id), false),
            AccountMeta::new(platform_pda(), false),
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
            AccountMeta::new_readonly(vault_pda(pool_id), false),
            AccountMeta::new(platform_pda(), false),
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

/// The standard no-tie payout list under D-E2 (winner takes all): seat 0 is
/// the ranking's first place and takes the whole pot — one row. Takes the
/// pool's FIXED pot (D-A1 revised) — never derived from entries. (Under
/// top-16 this was a sixteen-row band table; it lives in git history and
/// in the revert branch.)
pub fn winner_payout(pot_lamports: u64) -> Vec<(u16, u64)> {
    vec![(0, pot_lamports)]
}

/// A k-way tie for first over seats `0..k` (D-E2's sharp edge): each takes
/// `pot / k`, the indivisible remainder goes to the lowest seat — the same
/// rule `prize_math::split_group` documents. Seat-sorted as `commit_results`
/// requires.
pub fn tied_first_payouts(pot_lamports: u64, k: u16) -> Vec<(u16, u64)> {
    let each = pot_lamports / k as u64;
    let rem = pot_lamports % k as u64;
    (0..k)
        .map(|seat| (seat, each + if seat == 0 { rem } else { 0 }))
        .collect()
}

/// `seal_at_deadline` (D-E4) — permissionless; `signer` is any keypair.
pub fn seal_at_deadline_ix(signer: &Pubkey, pool_id: u64) -> Instruction {
    let mut data = disc("seal_at_deadline").to_vec();
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
        AccountMeta::new(config_pda(), false),
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

/// `release_escrow` — `signer` is the settlement signer (the reviewed path)
/// or, once the seven-day auto-release window has passed, anyone.
pub fn release_escrow_ix(
    signer: &Pubkey,
    pool_id: u64,
    entry: &Pubkey,
    player: &Pubkey,
) -> Instruction {
    let mut data = disc("release_escrow").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*signer, true),
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

/// `forfeit_escrow` — ADMIN-signed since 2026-09-07; moves no lamports
/// (the vault is listed read-only, the platform is not listed at all).
pub fn forfeit_escrow_ix(admin: &Pubkey, pool_id: u64, entry: &Pubkey) -> Instruction {
    let mut data = disc("forfeit_escrow").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new_readonly(pool_pda(pool_id), false),
            AccountMeta::new_readonly(vault_pda(pool_id), false),
            AccountMeta::new(*entry, false),
        ],
        data,
    }
}

/// One Merkle proof step as the program's `ProofStep` Borsh-encodes it:
/// sibling hash, then `sibling_on_right` as one byte.
pub type ProofStep = ([u8; 32], bool);

/// `promote_on_forfeit(pool_id, rank, amount, proof)` — settlement-signed;
/// `witnesses` are the Entry accounts of the first-place seats that must be
/// shown forfeited, in ascending seat order (see `escrow.rs`).
#[allow(clippy::too_many_arguments)]
pub fn promote_on_forfeit_ix(
    settlement: &Pubkey,
    pool_id: u64,
    from_entry: &Pubkey,
    to_entry: &Pubkey,
    to_player: &Pubkey,
    rank: u8,
    amount: u64,
    proof: &[ProofStep],
    witnesses: &[Pubkey],
) -> Instruction {
    let mut data = disc("promote_on_forfeit").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    data.push(rank);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&(proof.len() as u32).to_le_bytes());
    for (sibling, on_right) in proof {
        data.extend_from_slice(sibling);
        data.push(u8::from(*on_right));
    }
    let mut accounts = vec![
        AccountMeta::new_readonly(*settlement, true),
        AccountMeta::new_readonly(config_pda(), false),
        AccountMeta::new_readonly(pool_pda(pool_id), false),
        AccountMeta::new(vault_pda(pool_id), false),
        AccountMeta::new(*from_entry, false),
        AccountMeta::new(*to_entry, false),
        AccountMeta::new(*to_player, false),
        AccountMeta::new_readonly(system_program_id(), false),
    ];
    for w in witnesses {
        accounts.push(AccountMeta::new_readonly(*w, false));
    }
    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

// ---------------------------------------------------------------------------
// The results tree (mirrors backend/scoring/src/merkle.ts and merkle.rs)
// ---------------------------------------------------------------------------

/// A results leaf: player ‖ rank (u8) ‖ amount (u64 LE) — 41 bytes.
pub fn leaf_bytes(player: &Pubkey, rank: u8, amount: u64) -> Vec<u8> {
    let mut out = Vec::with_capacity(41);
    out.extend_from_slice(player.as_ref());
    out.push(rank);
    out.extend_from_slice(&amount.to_le_bytes());
    out
}

fn hash_leaf(leaf: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([0u8]);
    h.update(leaf);
    h.finalize().into()
}

fn hash_node(l: &[u8; 32], r: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([1u8]);
    h.update(l);
    h.update(r);
    h.finalize().into()
}

/// Root of the results tree over `leaves` (rank order, as the engine
/// publishes them): sha256(0x00 ‖ leaf) leaves, sha256(0x01 ‖ l ‖ r) nodes,
/// an odd node PROMOTED unchanged (never duplicated).
pub fn merkle_root(leaves: &[Vec<u8>]) -> [u8; 32] {
    let mut level: Vec<[u8; 32]> = leaves.iter().map(|l| hash_leaf(l)).collect();
    assert!(!level.is_empty());
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        for pair in level.chunks(2) {
            next.push(if pair.len() == 2 { hash_node(&pair[0], &pair[1]) } else { pair[0] });
        }
        level = next;
    }
    level[0]
}

/// Results leaves for a pool whose committed list is `payouts` (the rank-1
/// group, seat-sorted) and whose remaining seats place strictly below it,
/// one per rank in seat order: seat s ∉ payouts gets rank `1 + k + (its
/// position among the unpaid seats)` and amount 0. Leaves are in seat
/// order; the root is order-agnostic to the verifier as long as the proof
/// matches. Returns (leaves, rank per seat).
pub fn results_leaves(players: &[Pubkey], payouts: &[(u16, u64)]) -> (Vec<Vec<u8>>, Vec<u8>) {
    let k = payouts.len();
    let mut next_rank = 1 + k;
    let mut leaves = Vec::with_capacity(players.len());
    let mut ranks = Vec::with_capacity(players.len());
    for (seat, player) in players.iter().enumerate() {
        let (rank, amount) = match payouts.iter().find(|&&(s, _)| s as usize == seat) {
            Some(&(_, amount)) => (1u8, amount),
            None => {
                let r = next_rank as u8;
                next_rank += 1;
                (r, 0)
            }
        };
        leaves.push(leaf_bytes(player, rank, amount));
        ranks.push(rank);
    }
    (leaves, ranks)
}

/// Proof for `leaves[index]`: each step is (sibling, sibling_on_right); a
/// promoted node contributes no step.
pub fn merkle_proof(leaves: &[Vec<u8>], index: usize) -> Vec<ProofStep> {
    let mut level: Vec<[u8; 32]> = leaves.iter().map(|l| hash_leaf(l)).collect();
    let mut i = index;
    let mut proof = Vec::new();
    while level.len() > 1 {
        let sibling = i ^ 1;
        if sibling < level.len() {
            proof.push((level[sibling], sibling > i));
        }
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        for pair in level.chunks(2) {
            next.push(if pair.len() == 2 { hash_node(&pair[0], &pair[1]) } else { pair[0] });
        }
        level = next;
        i /= 2;
    }
    proof
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
            AccountMeta::new(vault_pda(pool_id), false),
            AccountMeta::new(platform_pda(), false),
            AccountMeta::new_readonly(system_program_id(), false),
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
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(pool_pda(pool_id), false),
            AccountMeta::new(platform_pda(), false),
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
    pub pot_lamports: u64,
    pub entrants: u16,
    /// The moment entries close (unix seconds): open time +
    /// `Config.fill_deadline_seconds`, set once and never rewritten
    /// (option A, 2026-09-07 — the go-timer that shortened it is gone).
    pub fill_deadline: i64,
    pub state: u8, // 0 Open, 1 Sealed, 2 Scored, 3 Paid, 4 Refunding, 5 Closed
    pub class_counters: [u16; 5],
    /// The committed payout list (seat, amount), D3-B.
    pub payouts: Vec<(u16, u64)>,
    pub paid_mask: u64,
    pub refunded_count: u16,
}

pub fn read_pool(svm: &LiteSVM, pool: &Pubkey) -> PoolView {
    let data = svm.get_account(pool).expect("pool account").data;
    // Layout since D-A1 v2 (`pot_lamports` u64 inserted after
    // entry_lamports@17): pot@25, entrants@33, fill_deadline@43, state@51,
    // vrf_seed@116, class_counters@148, payouts_len@192, payouts@194,
    // paid_mask@834, refunded_count@842. Unchanged by D-E4 and by the
    // 2026-09-07 upgrade (Config and Entry grew; Pool did not) —
    // `Pool::LEN` is pinned at 839 in state.rs, not the proposal's 834.
    assert_eq!(
        data.len(),
        847,
        "Pool account size drifted from the pinned layout"
    );
    let counters: [u16; 5] =
        core::array::from_fn(|i| u16::from_le_bytes([data[148 + 2 * i], data[149 + 2 * i]]));
    let payouts_len = u16::from_le_bytes([data[192], data[193]]) as usize;
    let payouts = (0..payouts_len)
        .map(|i| {
            let base = 194 + i * 10;
            (
                u16::from_le_bytes([data[base], data[base + 1]]),
                u64::from_le_bytes(data[base + 2..base + 10].try_into().unwrap()),
            )
        })
        .collect();
    PoolView {
        pot_lamports: u64::from_le_bytes(data[25..33].try_into().unwrap()),
        entrants: u16::from_le_bytes([data[33], data[34]]),
        fill_deadline: i64::from_le_bytes(data[43..51].try_into().unwrap()),
        state: data[51],
        class_counters: counters,
        payouts,
        paid_mask: u64::from_le_bytes(data[834..842].try_into().unwrap()),
        refunded_count: u16::from_le_bytes([data[842], data[843]]),
    }
}

/// Config's pre-migration account size (`Config::SPACE_V1`) — what devnet
/// holds until `migrate_config` runs.
pub const CONFIG_SPACE_V1: usize = 380;
/// Config's account size since 2026-09-07 (`Config::SPACE`).
pub const CONFIG_SPACE: usize = 484;
/// Entry's account size since 2026-09-07 (`Entry::SPACE`).
pub const ENTRY_SPACE: usize = 208;

/// The treasury- and timing-relevant slice of Config (offsets mirror
/// state.rs).
pub struct ConfigView {
    pub keeper: Pubkey,
    pub platform_reserved: u64,
    pub platform_refundable: u64,
    pub active_pool_by_tier: [u64; 7],
    pub next_pool_id: u64,
    pub fill_deadline_seconds: i64,
    pub cooldown_seconds: i64,
    pub tier_next_open_at: [i64; 7],
}

pub fn read_config(svm: &LiteSVM) -> ConfigView {
    let data = svm.get_account(&config_pda()).expect("config account").data;
    // Layout (post-discriminator offsets +8): admin@8, entry_signer@40,
    // settlement_signer@72, paused@104, open_tiers@105, ceilings@112,
    // prices@168, pots@224, reserve_pots@280, min_platform@281,
    // reserved@289, refundable@297, platform_bump@305, kyc@306,
    // detection@314, next_pool_id@315, active_pool_by_tier@323, bump@379;
    // the 2026-09-07 tail, appended AFTER bump: keeper@380,
    // fill_deadline_seconds@412, cooldown_seconds@420,
    // tier_next_open_at@428 — 484 in all (`Config::SPACE`).
    assert_eq!(
        data.len(),
        CONFIG_SPACE,
        "Config account size drifted from the pinned layout"
    );
    ConfigView {
        keeper: Pubkey::new_from_array(data[380..412].try_into().unwrap()),
        platform_reserved: u64::from_le_bytes(data[289..297].try_into().unwrap()),
        platform_refundable: u64::from_le_bytes(data[297..305].try_into().unwrap()),
        active_pool_by_tier: core::array::from_fn(|i| {
            u64::from_le_bytes(data[323 + 8 * i..331 + 8 * i].try_into().unwrap())
        }),
        next_pool_id: u64::from_le_bytes(data[315..323].try_into().unwrap()),
        fill_deadline_seconds: i64::from_le_bytes(data[412..420].try_into().unwrap()),
        cooldown_seconds: i64::from_le_bytes(data[420..428].try_into().unwrap()),
        tier_next_open_at: core::array::from_fn(|i| {
            i64::from_le_bytes(data[428 + 8 * i..436 + 8 * i].try_into().unwrap())
        }),
    }
}

pub struct EntryView {
    pub index: u16,
    pub class: u8,
    pub flagged: bool,
    pub settled: bool,
    pub refunded: bool,
    pub escrow_lamports: u64,
    /// The 2026-09-07 tail (appended after `bump`@190).
    pub escrowed_at: i64,
    pub forfeited: bool,
    pub promoted_lamports: u64,
}

pub fn read_entry(svm: &LiteSVM, entry: &Pubkey) -> EntryView {
    let data = svm.get_account(entry).expect("entry account").data;
    // flagged@179, settled@180, refunded@181, escrow_lamports@182, bump@190;
    // tail: escrowed_at@191, forfeited@199, promoted_lamports@200 — 208 in
    // all (`Entry::SPACE`).
    assert_eq!(
        data.len(),
        ENTRY_SPACE,
        "Entry account size drifted from the pinned layout"
    );
    EntryView {
        index: u16::from_le_bytes([data[72], data[73]]),
        class: data[106],
        flagged: data[179] != 0,
        settled: data[180] != 0,
        refunded: data[181] != 0,
        escrow_lamports: u64::from_le_bytes(data[182..190].try_into().unwrap()),
        escrowed_at: i64::from_le_bytes(data[191..199].try_into().unwrap()),
        forfeited: data[199] != 0,
        promoted_lamports: u64::from_le_bytes(data[200..208].try_into().unwrap()),
    }
}

/// Rewrite the Config account as the PRE-migration layout: the first 380
/// bytes, rent-exempt for 380. Stands in for the account devnet holds
/// between the upgrade and `migrate_config` (the tail is simply absent —
/// the old program never wrote one).
pub fn downgrade_config_to_v1(svm: &mut LiteSVM) {
    let mut acct = svm.get_account(&config_pda()).expect("config account");
    acct.data.truncate(CONFIG_SPACE_V1);
    acct.lamports = svm.minimum_balance_for_rent_exemption(CONFIG_SPACE_V1);
    svm.set_account(config_pda(), acct).unwrap();
}

/// Write a fake committed VRF seed straight into the Pool account
/// (offset 116, mirroring state.rs since D-A1 v2). Stands in for
/// `commit_vrf_seed`, whose Switchboard reveal cannot run inside LiteSVM; the
/// write-once and oracle checks are covered by `tests/vrf_and_freeze.rs`.
pub fn patch_vrf_seed(svm: &mut LiteSVM, pool: &Pubkey, seed: [u8; 32]) {
    let mut acct = svm.get_account(pool).expect("pool account");
    acct.data[116..148].copy_from_slice(&seed);
    svm.set_account(*pool, acct).unwrap();
}

// ---------------------------------------------------------------------------
// The environment
// ---------------------------------------------------------------------------

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    /// The settlement signer — also the keeper at init (devnet posture).
    pub settlement: Keypair,
    pub entry_signer: SigningKey,
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
        // Enough to bootstrap treasuries across multi-pool tests (LiteSVM
        // airdrops are free): the seven launch pots sum to 888.32 SOL.
        svm.airdrop(&admin.pubkey(), 10_000_000_000_000).unwrap();
        svm.airdrop(&settlement.pubkey(), 100_000_000_000).unwrap();
        // The platform treasury PDA stays unfunded on purpose: the first
        // deposit must create it, proving a transfer to a fresh address
        // suffices.

        let entry_signer_pk = Pubkey::new_from_array(entry_signer.verifying_key().to_bytes());
        // Launch ceilings (D2 as re-scoped by v2: caps a pool's PASS SALES,
        // price × 64): tier 0 = 6.4 SOL; every other tier = its own gross,
        // so the ceiling is a cap, not a second switch.
        let ceilings: [u64; 7] = core::array::from_fn(|i| {
            if i == 0 {
                6_400_000_000
            } else {
                TIER_PRICES[i] * 64
            }
        });
        // Launch treasury minimum: 0 (the reserve-pots term still applies).
        // Keeper = the settlement signer, the devnet posture (one daemon
        // key opens and settles); tests of the keeper gate rotate it.
        let ix = init_config_ix(
            &admin.pubkey(),
            &entry_signer_pk,
            &settlement.pubkey(),
            &settlement.pubkey(),
            ceilings,
            0,
        );
        let mut env = Env {
            svm,
            admin,
            settlement,
            entry_signer,
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

    /// Deposit `amount` into the platform treasury from the admin keypair
    /// (any signer works — the instruction is permissionless).
    pub fn fund_platform(&mut self, amount: u64) {
        let ix = fund_platform_ix(&self.admin.pubkey(), amount);
        self.send(&[ix], &[]).expect("fund_platform_wallet");
    }

    /// Open pool `pool_id` on `tier` (signed by the settlement signer, the
    /// keeper at init) and give it a VRF seed + pass Collection. Does NOT
    /// wait out a cooldown — a test re-opening a tier advances the clock.
    /// Tops the treasury up first so the D-A1 policy gate passes regardless of
    /// which tiers a test has enabled: the tier's own pot plus one further pot
    /// of every tier (a safe upper bound on the idle-tier reserve). Tests that
    /// assert exact treasury numbers do their own funding and call
    /// `open_pool_ix` directly.
    pub fn open_ready_pool(&mut self, pool_id: u64, tier: u8) {
        let bootstrap = TIER_POTS[tier as usize] + TIER_POTS.iter().sum::<u64>();
        self.fund_platform(bootstrap);
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
        let reg_ix = register_ix(&player.pubkey(), pool_id, &pass_asset.pubkey(), [3u8; 32]);
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
