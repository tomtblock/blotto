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
//!
//! # The Ladder (D-E19)
//!
//! Since D-E19 every pool belongs to a POOL TYPE — one `PoolType` account per
//! (mode, tier, capacity), seeded `["ptype", [mode], [tier], capacity LE]` —
//! which carries the pool's table, minimum field, prize pool and its
//! one-at-a-time slot. `open_pool` takes the type plus, as remaining
//! accounts, every OTHER enabled type in ascending address order (the
//! treasury reserve); `pay_prizes`, `trigger_refund` and `refund` take the
//! pool's own type; `withdraw_platform` takes every enabled type.
//!
//! `Env::new` creates NO pool type: a test states the types it plays with
//! (`Env::ensure_pool_type`), or lets `open_ready_pool*` create the one it
//! opens. `Env` remembers every type it created, so the remaining-accounts
//! lists (`Env::open_ix`, `Env::withdraw_ix`) are derived from the chain —
//! each type's `enabled` byte read back — never from what a test believes.

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

/// Anchor account discriminator: `sha256("account:<Name>")[..8]`.
pub fn account_disc(name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("account:{name}").as_bytes());
    h[..8].try_into().unwrap()
}

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &program_id()).0
}
pub fn pool_pda(id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"pool", &id.to_le_bytes()], &program_id()).0
}
/// The rent-exempt minimum for a zero-data account — the cushion
/// `open_pool` funds every prize vault with on top of the pot (2026-09-12).
///
/// A vault therefore ends its life holding exactly this, not zero. The
/// cushion is why a stranger can no longer freeze a pool by sending its
/// vault a lamport: the pot can leave in full and the account still clears
/// the rent-exempt line, so the runtime never sees the rent-paying
/// post-state it refuses. See `programs/blotto_cup/src/vault.rs`.
pub const VAULT_RENT_CUSHION: u64 = 890_880;

pub fn vault_pda(id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", &id.to_le_bytes()], &program_id()).0
}
pub fn platform_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"platform"], &program_id()).0
}

/// The pool-type PDA (D-E19): `["ptype", [mode], [tier], capacity LE]`.
/// Seeded `ptype`, not `pool_type`: "pool" is already a prefix and seeds are
/// concatenated without lengths (threat-tm-401).
pub fn pool_type_pda(mode: u8, tier: u8, capacity: u16) -> Pubkey {
    Pubkey::find_program_address(
        &[b"ptype", &[mode], &[tier], &capacity.to_le_bytes()],
        &program_id(),
    )
    .0
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

/// The four pool sizes (constants.rs::POOL_CAPACITIES, D-E19), smallest
/// first. Index into `LADDER_TABLES` / `LADDER_MIN_SEATS` by position.
pub const POOL_CAPACITIES: [u16; 4] = [8, 16, 32, 64];

/// The widest prize table (constants.rs::MAX_PAID_PLACES).
pub const MAX_PAID_PLACES: usize = 16;

/// The minimum field per capacity (constants.rs::LADDER_MIN_SEATS, D-E19):
/// the break-even field — each table sums to exactly its minimum field.
///
/// Lives HERE, beside the tables, and is pinned by `scripts/check-mirrors.py`.
/// Its predecessor, one `MIN_SEATS`, lived in a test file with a comment
/// claiming to mirror the program and nothing checking the claim — so when
/// the program moved from 52 to 40 the test kept asserting the old rule and
/// failed in a way that read like a program bug.
pub const LADDER_MIN_SEATS: [u16; 4] = [5, 10, 20, 40];

/// The launch prize tables (constants.rs::LADDER_TABLES, D-E19), in whole
/// multiples of the entry, rank 1 first, zero-padded to 16; one row per
/// `POOL_CAPACITIES` entry. Pinned by `scripts/check-mirrors.py`.
pub const LADDER_TABLES: [[u8; 16]; 4] = [
    [3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [5, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [8, 4, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [12, 6, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
];

/// The 64-player prize pool at each tier (constants.rs::TIER_POT_LAMPORTS):
/// `LADDER_TABLES[3]`'s sum (40) × the tier's price. Since D-E19 no pool is
/// funded from Config's copy of this — each pool type carries its own prize
/// pool — but it is still what a 64-player pool type's prize pool is.
pub const TIER_POTS: [u64; 7] = [
    4_000_000_000,
    20_000_000_000,
    30_000_000_000,
    40_000_000_000,
    100_000_000_000,
    200_000_000_000,
    300_000_000_000,
];

/// Position of `capacity` in `POOL_CAPACITIES`. Panics on any other size —
/// a test that asks for one has a bug, the program refuses it by name.
pub fn cap_index(capacity: u16) -> usize {
    POOL_CAPACITIES
        .iter()
        .position(|&c| c == capacity)
        .unwrap_or_else(|| panic!("{capacity} is not a pool capacity"))
}

/// The launch table for a capacity.
pub fn ladder_table(capacity: u16) -> [u8; 16] {
    LADDER_TABLES[cap_index(capacity)]
}

/// The launch minimum field for a capacity.
pub fn ladder_min_seats(capacity: u16) -> u16 {
    LADDER_MIN_SEATS[cap_index(capacity)]
}

/// Places paid by a table: its leading non-zero multiples.
pub fn table_paid_places(table: &[u8; 16]) -> usize {
    table.iter().take_while(|&&m| m > 0).count()
}

/// `Σ multiple × price` — the prize pool a table pays at `price`.
pub fn table_value(table: &[u8; 16], price: u64) -> u64 {
    table.iter().map(|&m| m as u64 * price).sum()
}

/// The launch prize pool for `capacity` at tier `tier`'s launch price.
pub fn prize_pool(capacity: u16, tier: u8) -> u64 {
    table_value(&ladder_table(capacity), TIER_PRICES[tier as usize])
}

/// What position `rank` (1-based) is worth: `table[rank-1] × entry`, zero
/// past the table. Mirrors `prize_math::place_amount`.
pub fn place_amount(table: &[u8; 16], entry: u64, rank: u16) -> u64 {
    if rank == 0 || rank as usize > MAX_PAID_PLACES {
        return 0;
    }
    table[(rank - 1) as usize] as u64 * entry
}

/// D3-B's tie split (mirrors `prize_math::split_group`): a group of
/// `group_size` tied from `first_rank` shares the positions it occupies —
/// zero past the paid line — floor division, `(each, remainder)`.
pub fn split_group(table: &[u8; 16], entry: u64, first_rank: u16, group_size: u16) -> (u64, u64) {
    assert!(group_size > 0);
    let combined: u128 = (0..group_size)
        .map(|o| place_amount(table, entry, first_rank + o) as u128)
        .sum();
    (
        (combined / group_size as u128) as u64,
        (combined % group_size as u128) as u64,
    )
}

/// The committed payout list for a ranking in SEAT ORDER (seat 0 ranks
/// first) partitioned into consecutive tie groups of the given sizes. Each
/// group shares the combined worth of the positions it occupies (D3-B,
/// unchanged by D-E19 — a group may straddle the paid line), the remainder
/// to the group's lowest seat. Seats owed nothing are left out: the program
/// refuses a zero amount (`PayoutZero`). Seat-sorted, as `commit_results`
/// requires. Seats past the groups rank below them and are owed nothing.
pub fn ladder_payouts(table: &[u8; 16], entry: u64, groups: &[u16]) -> Vec<(u16, u64)> {
    let mut out = Vec::new();
    let mut pos: u16 = 0;
    for &g in groups {
        let (each, rem) = split_group(table, entry, pos + 1, g);
        for i in 0..g {
            let amount = each + if i == 0 { rem } else { 0 };
            if amount > 0 {
                out.push((pos + i, amount));
            }
        }
        pos += g;
    }
    out
}

/// No ties: seat `i` takes rank `i + 1`, and the paid places are exactly the
/// table's — `[(0, t[0]·e), (1, t[1]·e), …]`.
pub fn straight_payouts(table: &[u8; 16], entry: u64) -> Vec<(u16, u64)> {
    let groups = vec![1u16; table_paid_places(table)];
    ladder_payouts(table, entry, &groups)
}

/// A k-way tie for first over seats `0..k` with nobody else placed — the
/// whole list for a ONE-PLACE pool (every pool opened before the Ladder,
/// recorded by `migrate_pool` as one paid place, table `[pot / entry]`):
/// each takes `pot / k`, the remainder to the lowest seat.
pub fn tied_first_payouts(pot_lamports: u64, k: u16) -> Vec<(u16, u64)> {
    let each = pot_lamports / k as u64;
    let rem = pot_lamports % k as u64;
    (0..k)
        .map(|seat| (seat, each + if seat == 0 { rem } else { 0 }))
        .collect()
}

/// The single-winner list of a ONE-PLACE (pre-Ladder) pool: seat 0 takes
/// the whole prize pool. Under the Ladder no pool type pays one place, so
/// this is only ever committed to a migrated pool (`Env::open_legacy_pool`).
pub fn winner_payout(pot_lamports: u64) -> Vec<(u16, u64)> {
    vec![(0, pot_lamports)]
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

/// `withdraw_platform` — the one Squads-gated treasury exit. Remaining
/// accounts (D-E19): EVERY enabled pool type, ascending by address
/// (`Env::withdraw_ix` derives the list from the chain).
pub fn withdraw_platform_ix(
    admin: &Pubkey,
    destination: &Pubkey,
    amount: u64,
    enabled_pool_types: &[Pubkey],
) -> Instruction {
    let mut data = disc("withdraw_platform").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    let mut accounts = vec![
        AccountMeta::new_readonly(*admin, true),
        AccountMeta::new_readonly(config_pda(), false),
        AccountMeta::new(platform_pda(), false),
        AccountMeta::new(*destination, false),
        AccountMeta::new_readonly(system_program_id(), false),
    ];
    for t in enabled_pool_types {
        accounts.push(AccountMeta::new_readonly(*t, false));
    }
    Instruction {
        program_id: program_id(),
        accounts,
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
/// (prompt v2 §A; keeper-only with no fallback since 2026-09-07).
pub fn set_keeper_ix(admin: &Pubkey, keeper: &Pubkey) -> Instruction {
    admin_ix(admin, "set_keeper", keeper.as_ref())
}

/// `set_pool_timing(fill_deadline_seconds, cooldown_seconds)` — for pools
/// opened from now on; never touches an open pool.
pub fn set_pool_timing_ix(
    admin: &Pubkey,
    fill_deadline_seconds: i64,
    cooldown_seconds: i64,
) -> Instruction {
    let mut args = fill_deadline_seconds.to_le_bytes().to_vec();
    args.extend_from_slice(&cooldown_seconds.to_le_bytes());
    admin_ix(admin, "set_pool_timing", &args)
}

/// `migrate_config()` — grows an old Config to the current layout: a 603-byte
/// (Phase B) account gains the Ladder's `enabled_pool_types`; a 484-byte
/// (pre-Phase-B) one gains the hard ladder and then that. No arguments. The
/// admin pays the rent top-up (hence `mut`).
pub fn migrate_config_ix(admin: &Pubkey) -> Instruction {
    let data = disc("migrate_config").to_vec();
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

/// The two board modes (constants.rs::MODE_EASY / MODE_HARD, Phase B).
/// `open_pool`'s `mode` argument and `Pool.mode`'s values.
pub const MODE_EASY: u8 = 0;
pub const MODE_HARD: u8 = 1;

/// `init_pool_type(mode, tier, capacity)` — admin (signer, pays rent),
/// config (read-only), the pool-type PDA, the system program.
pub fn init_pool_type_ix(admin: &Pubkey, mode: u8, tier: u8, capacity: u16) -> Instruction {
    init_pool_type_at_ix(admin, mode, tier, capacity, &pool_type_pda(mode, tier, capacity))
}

/// `init_pool_type` with the pool-type account given explicitly — for the
/// tests that pass the wrong one.
pub fn init_pool_type_at_ix(
    admin: &Pubkey,
    mode: u8,
    tier: u8,
    capacity: u16,
    pool_type: &Pubkey,
) -> Instruction {
    let mut data = disc("init_pool_type").to_vec();
    data.push(mode);
    data.push(tier);
    data.extend_from_slice(&capacity.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(config_pda(), false),
            AccountMeta::new(*pool_type, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

/// `set_pool_type_economics(mode, tier, capacity, min_seats, prize_table,
/// pot_lamports)` — admin, config (mut), the pool type.
#[allow(clippy::too_many_arguments)]
pub fn set_pool_type_economics_ix(
    admin: &Pubkey,
    mode: u8,
    tier: u8,
    capacity: u16,
    min_seats: u16,
    prize_table: [u8; 16],
    pot_lamports: u64,
) -> Instruction {
    let mut data = disc("set_pool_type_economics").to_vec();
    data.push(mode);
    data.push(tier);
    data.extend_from_slice(&capacity.to_le_bytes());
    data.extend_from_slice(&min_seats.to_le_bytes());
    data.extend_from_slice(&prize_table);
    data.extend_from_slice(&pot_lamports.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(pool_type_pda(mode, tier, capacity), false),
        ],
        data,
    }
}

/// `set_pool_type_enabled(mode, tier, capacity, enabled)` — same accounts.
pub fn set_pool_type_enabled_ix(
    admin: &Pubkey,
    mode: u8,
    tier: u8,
    capacity: u16,
    enabled: bool,
) -> Instruction {
    let mut data = disc("set_pool_type_enabled").to_vec();
    data.push(mode);
    data.push(tier);
    data.extend_from_slice(&capacity.to_le_bytes());
    data.push(u8::from(enabled));
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(pool_type_pda(mode, tier, capacity), false),
        ],
        data,
    }
}

/// `open_pool(pool_id, tier, sealing_pubkey, sealing_secret_hash, mode,
/// capacity)` — keeper-gated (prompt v2 §A): `opener` must be
/// `Config.keeper` and nobody else. Pays the Pool's rent. The pool type is
/// the PDA of (mode, tier, capacity); `other_enabled` is the remaining
/// accounts list — every OTHER enabled pool type, ascending by address
/// (D-E19). `Env::open_ix` derives it from the chain; tests of the list's
/// own refusals build it by hand.
#[allow(clippy::too_many_arguments)]
pub fn open_pool_ix(
    opener: &Pubkey,
    pool_id: u64,
    tier: u8,
    sealing_pubkey: [u8; 32],
    sealing_secret_hash: [u8; 32],
    mode: u8,
    capacity: u16,
    other_enabled: &[Pubkey],
) -> Instruction {
    open_pool_with_type_ix(
        opener,
        pool_id,
        tier,
        sealing_pubkey,
        sealing_secret_hash,
        mode,
        capacity,
        &pool_type_pda(mode, tier, capacity),
        other_enabled,
    )
}

/// `open_pool` with the pool-type account given explicitly.
#[allow(clippy::too_many_arguments)]
pub fn open_pool_with_type_ix(
    opener: &Pubkey,
    pool_id: u64,
    tier: u8,
    sealing_pubkey: [u8; 32],
    sealing_secret_hash: [u8; 32],
    mode: u8,
    capacity: u16,
    pool_type: &Pubkey,
    other_enabled: &[Pubkey],
) -> Instruction {
    let mut data = disc("open_pool").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    data.push(tier);
    data.extend_from_slice(&sealing_pubkey);
    data.extend_from_slice(&sealing_secret_hash);
    data.push(mode);
    data.extend_from_slice(&capacity.to_le_bytes());
    let mut accounts = vec![
        AccountMeta::new(*opener, true),
        AccountMeta::new(config_pda(), false),
        AccountMeta::new(pool_pda(pool_id), false),
        AccountMeta::new(vault_pda(pool_id), false),
        AccountMeta::new(platform_pda(), false),
        AccountMeta::new(*pool_type, false),
        AccountMeta::new_readonly(system_program_id(), false),
    ];
    for t in other_enabled {
        accounts.push(AccountMeta::new_readonly(*t, false));
    }
    Instruction {
        program_id: program_id(),
        accounts,
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

/// `commit_results(pool_id, root, payouts)` — settlement-signed.
pub fn commit_results_ix(
    settlement: &Pubkey,
    pool_id: u64,
    root: [u8; 32],
    payouts: &[(u16, u64)],
) -> Instruction {
    let mut args = root.to_vec();
    args.extend_from_slice(&encode_payouts(payouts));
    settle_ix(settlement, pool_id, "commit_results", &args)
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

/// `set_hard_open_tiers(open_tiers)` — the hard ladder's tier switch
/// (Phase B); `set_open_tiers` is untouched by it.
pub fn set_hard_open_tiers_ix(admin: &Pubkey, open_tiers: [bool; 7]) -> Instruction {
    let args: Vec<u8> = open_tiers.iter().map(|&b| u8::from(b)).collect();
    admin_ix(admin, "set_hard_open_tiers", &args)
}

/// `migrate_pool(pool_id)` — permissionless; grows a pre-R7-b (847-byte),
/// pre-Phase-B (849-byte) or pre-Ladder (850-byte) pool account to the
/// current layout, writing what is missing: the floor its players entered
/// under, `mode` (always easy), and the Ladder tail (64 seats, one place,
/// `[pot / entry]` — or no table for a never-played pool whose prize pool is
/// not a whole number of entries).
pub fn migrate_pool_ix(payer: &Pubkey, pool_id: u64) -> Instruction {
    let mut data = disc("migrate_pool").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(pool_pda(pool_id), false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

/// Pool's account sizes: the current layout (`Pool::SPACE`, 869 since the
/// Ladder appended capacity, paid_places and prize_table), the pre-Ladder one
/// (`Pool::SPACE_V3`, 850 — `mode` present), the pre-Phase-B one
/// (`Pool::SPACE_V2`, 849 — R7-b's `min_seats` present) and the pre-R7-b one
/// (`Pool::SPACE_V1`, 847).
pub const POOL_SPACE: usize = 869;
pub const POOL_SPACE_V3: usize = 850;
pub const POOL_SPACE_V2: usize = 849;
pub const POOL_SPACE_V1: usize = 847;

/// Shrink a pool account back to its PRE-R7-B size (847), as the oldest
/// pools on devnet are.
///
/// There is no way to allocate one at the old size with the current program
/// — `open_pool` allocates `Pool::SPACE` — so the only way to exercise
/// `migrate_pool` against a real account is to open one and take the
/// appended bytes off again. The lamports are left alone deliberately: a
/// pool allocated at 847 bytes is rent-exempt for 847 and NOT for 869, which
/// is the top-up the migration has to pay, and a test that funded it first
/// would skip the part most likely to be wrong.
pub fn shrink_pool_to_v1(svm: &mut LiteSVM, pool: &Pubkey) {
    shrink_pool_to(svm, pool, POOL_SPACE_V1);
}

/// Shrink a pool account back to its PRE-PHASE-B size (849): `min_seats`
/// present, `mode` absent — every pool devnet opened between R7-b and the
/// Phase B upgrade.
pub fn shrink_pool_to_v2(svm: &mut LiteSVM, pool: &Pubkey) {
    shrink_pool_to(svm, pool, POOL_SPACE_V2);
}

/// Shrink a pool account back to its PRE-LADDER size (850): `mode` present,
/// the Ladder tail absent — every pool on devnet when the Ladder ships.
pub fn shrink_pool_to_v3(svm: &mut LiteSVM, pool: &Pubkey) {
    shrink_pool_to(svm, pool, POOL_SPACE_V3);
}

fn shrink_pool_to(svm: &mut LiteSVM, pool: &Pubkey, size: usize) {
    let mut acct = svm.get_account(pool).expect("pool account");
    assert!(
        acct.data.len() > size,
        "expected a pool larger than {size} bytes"
    );
    acct.data.truncate(size);
    acct.lamports = svm.minimum_balance_for_rent_exemption(size);
    svm.set_account(*pool, acct).unwrap();
}

pub fn pay_prizes_ix(
    settlement: &Pubkey,
    pool_id: u64,
    pool_type: &Pubkey,
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
        AccountMeta::new(*pool_type, false),
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

/// `place_sanctions_hold` (settlement-signed) / `lift_sanctions_hold`
/// (admin-signed) — Phase 2 Stage F. Same account order as `flag_ix`.
pub fn sanctions_hold_ix(signer: &Pubkey, pool_id: u64, entry: &Pubkey, name: &str) -> Instruction {
    flag_ix(signer, pool_id, entry, name)
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

/// `pay_next_place(pool_id, rank, amount, proof, group_size,
/// takes_remainder)` — settlement-signed; `peers` are the Entry accounts of
/// EVERY other committed (first-place) seat — all but `from` and `to` — in
/// ascending seat order (see `escrow.rs` `committed_peers`). Since D-E19 it
/// pays only in a ONE-PLACE pool (one opened before the Ladder); a Ladder
/// pool's forfeited share is held (`NextPlaceUnsupported`).
#[allow(clippy::too_many_arguments)]
pub fn pay_next_place_ix(
    settlement: &Pubkey,
    pool_id: u64,
    from_entry: &Pubkey,
    to_entry: &Pubkey,
    to_player: &Pubkey,
    rank: u8,
    amount: u64,
    proof: &[ProofStep],
    group_size: u16,
    takes_remainder: bool,
    peers: &[Pubkey],
) -> Instruction {
    let mut data = disc("pay_next_place").to_vec();
    data.extend_from_slice(&pool_id.to_le_bytes());
    data.push(rank);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&(proof.len() as u32).to_le_bytes());
    for (sibling, on_right) in proof {
        data.extend_from_slice(sibling);
        data.push(u8::from(*on_right));
    }
    data.extend_from_slice(&group_size.to_le_bytes());
    data.push(u8::from(takes_remainder));
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
    for w in peers {
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
            next.push(if pair.len() == 2 {
                hash_node(&pair[0], &pair[1])
            } else {
                pair[0]
            });
        }
        level = next;
    }
    level[0]
}

/// Results leaves for a ONE-PLACE pool whose committed list is `payouts`
/// (the rank-1 group, seat-sorted) and whose remaining seats place strictly
/// below it, one per rank in seat order: seat s ∉ payouts gets rank `1 + k +
/// (its position among the unpaid seats)` and amount 0. Leaves are in seat
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
            next.push(if pair.len() == 2 {
                hash_node(&pair[0], &pair[1])
            } else {
                pair[0]
            });
        }
        level = next;
        i /= 2;
    }
    proof
}

/// `trigger_refund` — permissionless. `pool_type` is the POOL's own type
/// (D-E19); any other is refused by its seeds.
pub fn trigger_refund_ix(signer: &Pubkey, pool_id: u64, pool_type: &Pubkey) -> Instruction {
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
            AccountMeta::new(*pool_type, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

/// `refund` — permissionless, one entry. `pool_type` as for `trigger_refund`.
pub fn refund_ix(
    signer: &Pubkey,
    pool_id: u64,
    entry: &Pubkey,
    player: &Pubkey,
    pool_type: &Pubkey,
) -> Instruction {
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
            AccountMeta::new(*pool_type, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

// ---------------------------------------------------------------------------
// Account-layout readers (offsets mirror state.rs; a drift fails the suite)
// ---------------------------------------------------------------------------

pub struct PoolView {
    pub tier: u8,
    pub entry_lamports: u64,
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
    /// R7-b: the pool's own floor, copied from its pool type at open.
    pub min_seats: u16,
    /// Phase B: 0 easy, 1 hard.
    pub mode: u8,
    /// D-E19: the pool's size (8, 16, 32 or 64), places paid, and its table.
    pub capacity: u16,
    pub paid_places: u8,
    pub prize_table: [u8; 16],
}

pub fn read_pool(svm: &LiteSVM, pool: &Pubkey) -> PoolView {
    let data = svm.get_account(pool).expect("pool account").data;
    // Layout since D-A1 v2 (`pot_lamports` u64 inserted after
    // entry_lamports@17): tier@16, pot@25, entrants@33, fill_deadline@43,
    // state@51, vrf_seed@116, class_counters@148, payouts_len@192,
    // payouts@194, paid_mask@834, refunded_count@842, min_seats@847,
    // mode@849, and the Ladder tail (D-E19): capacity@850, paid_places@852,
    // prize_table@853..869. Every offset before the tail is unchanged by
    // every upgrade since D-A1 v2: each one APPENDED its fields after
    // `vault_bump` — `Pool::LEN` is pinned at 861 in state.rs (842 before the
    // Ladder, 841 before Phase B, 839 before R7-b).
    assert_eq!(
        data.len(),
        POOL_SPACE,
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
        tier: data[16],
        entry_lamports: u64::from_le_bytes(data[17..25].try_into().unwrap()),
        pot_lamports: u64::from_le_bytes(data[25..33].try_into().unwrap()),
        entrants: u16::from_le_bytes([data[33], data[34]]),
        fill_deadline: i64::from_le_bytes(data[43..51].try_into().unwrap()),
        state: data[51],
        class_counters: counters,
        payouts,
        paid_mask: u64::from_le_bytes(data[834..842].try_into().unwrap()),
        refunded_count: u16::from_le_bytes([data[842], data[843]]),
        min_seats: u16::from_le_bytes([data[847], data[848]]),
        mode: data[849],
        capacity: u16::from_le_bytes([data[850], data[851]]),
        paid_places: data[852],
        prize_table: data[853..869].try_into().unwrap(),
    }
}

/// Config's original account size (`Config::SPACE_V1`) — the 2026-09-07
/// migration grew it; `migrate_config` REFUSES it now (that path is retired).
pub const CONFIG_SPACE_V1: usize = 380;
/// Config's account size between 2026-09-07 and Phase B (`Config::SPACE_V2`).
pub const CONFIG_SPACE_V2: usize = 484;
/// Config's account size between Phase B and the Ladder (`Config::SPACE_V3`)
/// — what devnet holds until the Ladder's `migrate_config` runs.
pub const CONFIG_SPACE_V3: usize = 603;
/// Config's account size since the Ladder (`Config::SPACE`):
/// `enabled_pool_types` (u16) appended at 603.
pub const CONFIG_SPACE: usize = 605;
/// Entry's account size since 2026-09-07 (`Entry::SPACE`).
pub const ENTRY_SPACE: usize = 228;

/// The treasury- and timing-relevant slice of Config (offsets mirror
/// state.rs).
pub struct ConfigView {
    pub keeper: Pubkey,
    pub open_tiers: [bool; 7],
    pub tier_price_lamports: [u64; 7],
    pub tier_pot_lamports: [u64; 7],
    pub treasury_reserve_pots: u8,
    pub treasury_min_platform_lamports: u64,
    pub platform_reserved: u64,
    pub platform_refundable: u64,
    /// No longer written or read by `open_pool` since D-E19 (the slot is the
    /// pool TYPE's); kept because the layout is load-bearing.
    pub active_pool_by_tier: [u64; 7],
    pub next_pool_id: u64,
    pub fill_deadline_seconds: i64,
    pub cooldown_seconds: i64,
    /// Still stamped by `set_open_tiers` on the enable edge; no longer the
    /// cooldown gate since D-E19 (`PoolType.next_open_at` is).
    pub tier_next_open_at: [i64; 7],
    /// The Phase B hard ladder (appended after `tier_next_open_at`).
    pub hard_open_tiers: [bool; 7],
    pub hard_active_pool_by_tier: [u64; 7],
    pub hard_tier_next_open_at: [i64; 7],
    /// The Ladder (D-E19): how many pool types are enabled.
    pub enabled_pool_types: u16,
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
    // tier_next_open_at@428 (484 = `Config::SPACE_V2`); the Phase B tail
    // after that: hard_open_tiers@484, hard_active_pool_by_tier@491,
    // hard_tier_next_open_at@547 (603 = `Config::SPACE_V3`); the Ladder tail:
    // enabled_pool_types@603 — 605 in all (`Config::SPACE`).
    assert_eq!(
        data.len(),
        CONFIG_SPACE,
        "Config account size drifted from the pinned layout"
    );
    let u64_at = |at: usize| u64::from_le_bytes(data[at..at + 8].try_into().unwrap());
    let i64_at = |at: usize| i64::from_le_bytes(data[at..at + 8].try_into().unwrap());
    ConfigView {
        keeper: Pubkey::new_from_array(data[380..412].try_into().unwrap()),
        open_tiers: core::array::from_fn(|i| data[105 + i] != 0),
        tier_price_lamports: core::array::from_fn(|i| u64_at(168 + 8 * i)),
        tier_pot_lamports: core::array::from_fn(|i| u64_at(224 + 8 * i)),
        treasury_reserve_pots: data[280],
        treasury_min_platform_lamports: u64_at(281),
        platform_reserved: u64_at(289),
        platform_refundable: u64_at(297),
        active_pool_by_tier: core::array::from_fn(|i| u64_at(323 + 8 * i)),
        next_pool_id: u64_at(315),
        fill_deadline_seconds: i64_at(412),
        cooldown_seconds: i64_at(420),
        tier_next_open_at: core::array::from_fn(|i| i64_at(428 + 8 * i)),
        hard_open_tiers: core::array::from_fn(|i| data[484 + i] != 0),
        hard_active_pool_by_tier: core::array::from_fn(|i| u64_at(491 + 8 * i)),
        hard_tier_next_open_at: core::array::from_fn(|i| i64_at(547 + 8 * i)),
        enabled_pool_types: u16::from_le_bytes([data[603], data[604]]),
    }
}

/// PoolType's account size (`PoolType::SPACE`, D-E19).
pub const POOL_TYPE_SPACE: usize = 57;

/// One pool type (offsets mirror state.rs: the discriminator, then mode@8,
/// tier@9, capacity@10, min_seats@12, paid_places@14, prize_table@15..31,
/// pot_lamports@31, enabled@39, active_pool@40, next_open_at@48, bump@56).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolTypeView {
    pub mode: u8,
    pub tier: u8,
    pub capacity: u16,
    pub min_seats: u16,
    pub paid_places: u8,
    pub prize_table: [u8; 16],
    pub pot_lamports: u64,
    pub enabled: bool,
    pub active_pool: u64,
    pub next_open_at: i64,
    pub bump: u8,
}

pub fn read_pool_type(svm: &LiteSVM, pool_type: &Pubkey) -> PoolTypeView {
    let acct = svm.get_account(pool_type).expect("pool type account");
    assert_eq!(acct.owner, program_id(), "a pool type is owned by the program");
    let data = acct.data;
    assert_eq!(
        data.len(),
        POOL_TYPE_SPACE,
        "PoolType account size drifted from the pinned layout"
    );
    assert_eq!(
        data[..8],
        account_disc("PoolType"),
        "PoolType discriminator (sha256(\"account:PoolType\")[..8] = 23bee6af4b720965)"
    );
    PoolTypeView {
        mode: data[8],
        tier: data[9],
        capacity: u16::from_le_bytes([data[10], data[11]]),
        min_seats: u16::from_le_bytes([data[12], data[13]]),
        paid_places: data[14],
        prize_table: data[15..31].try_into().unwrap(),
        pot_lamports: u64::from_le_bytes(data[31..39].try_into().unwrap()),
        enabled: data[39] != 0,
        active_pool: u64::from_le_bytes(data[40..48].try_into().unwrap()),
        next_open_at: i64::from_le_bytes(data[48..56].try_into().unwrap()),
        bump: data[56],
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
    pub next_place_lamports: u64,
    /// The split book-keeping on a FORFEITER's entry (addendum ruling 3).
    pub split_total: u64,
    pub split_paid_mask: u64,
    pub split_group_size: u16,
    pub split_remainder_paid: bool,
    /// Phase 2 Stage F: the sanctions hold (`sanctions_hold`@227).
    pub sanctions_hold: bool,
}

pub fn read_entry(svm: &LiteSVM, entry: &Pubkey) -> EntryView {
    let data = svm.get_account(entry).expect("entry account").data;
    // flagged@179, settled@180, refunded@181, escrow_lamports@182, bump@190;
    // tail: escrowed_at@191, forfeited@199, next_place_lamports@200,
    // split_total@208, split_paid_mask@216, split_group_size@224,
    // split_remainder_paid@226, sanctions_hold@227 — 228 (`Entry::SPACE`).
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
        next_place_lamports: u64::from_le_bytes(data[200..208].try_into().unwrap()),
        split_total: u64::from_le_bytes(data[208..216].try_into().unwrap()),
        split_paid_mask: u64::from_le_bytes(data[216..224].try_into().unwrap()),
        split_group_size: u16::from_le_bytes([data[224], data[225]]),
        split_remainder_paid: data[226] != 0,
        sanctions_hold: data[227] != 0,
    }
}

/// Rewrite the Config account as the PRE-LADDER layout: the first 603
/// bytes, rent-exempt for 603. Stands in for the account devnet holds
/// between the Ladder upgrade and its `migrate_config`.
pub fn downgrade_config_to_v3(svm: &mut LiteSVM) {
    downgrade_config_to(svm, CONFIG_SPACE_V3);
}

/// Rewrite the Config account as the PRE-PHASE-B layout: the first 484
/// bytes, rent-exempt for 484 (the hard tail is simply absent — the program
/// of that time never wrote one).
pub fn downgrade_config_to_v2(svm: &mut LiteSVM) {
    downgrade_config_to(svm, CONFIG_SPACE_V2);
}

/// Rewrite the Config account as the ORIGINAL 380-byte layout — the shape
/// the retired 2026-09-07 migration grew. Exists so a test can prove
/// `migrate_config` refuses it rather than growing it with a zeroed keeper.
pub fn downgrade_config_to_v1(svm: &mut LiteSVM) {
    downgrade_config_to(svm, CONFIG_SPACE_V1);
}

fn downgrade_config_to(svm: &mut LiteSVM, size: usize) {
    let mut acct = svm.get_account(&config_pda()).expect("config account");
    acct.data.truncate(size);
    acct.lamports = svm.minimum_balance_for_rent_exemption(size);
    svm.set_account(config_pda(), acct).unwrap();
}

/// Overwrite bytes of a pool account directly — for the states no
/// instruction can produce (a pre-Ladder pot that is not a whole number of
/// entries, a floor other than the one copied at open). Each caller names
/// the field it reaches past the program for, and why.
pub fn patch_pool_bytes(svm: &mut LiteSVM, pool: &Pubkey, offset: usize, bytes: &[u8]) {
    let mut acct = svm.get_account(pool).expect("pool account");
    acct.data[offset..offset + bytes.len()].copy_from_slice(bytes);
    svm.set_account(*pool, acct).unwrap();
}

/// Overwrite a pool's stored `min_seats` (offset 847 — the field R7-b
/// appended after `vault_bump`).
///
/// There is no instruction that can do this, on purpose: the floor is copied
/// at open and never rewritten, which is the whole property. So a test that
/// wants to prove the guards read the FIELD rather than the pool type has to
/// reach past the program, exactly as `patch_vrf_seed` does for the VRF
/// commitment.
pub fn patch_min_seats(svm: &mut LiteSVM, pool: &Pubkey, min_seats: u16) {
    patch_pool_bytes(svm, pool, 847, &min_seats.to_le_bytes());
}

/// A pool's stored `min_seats`, read at the same offset (any layout from
/// R7-b on).
pub fn read_min_seats(svm: &LiteSVM, pool: &Pubkey) -> u16 {
    let data = svm.get_account(pool).expect("pool account").data;
    u16::from_le_bytes([data[847], data[848]])
}

/// Write a fake committed VRF seed straight into the Pool account
/// (offset 116, mirroring state.rs since D-A1 v2). Stands in for
/// `commit_vrf_seed`, whose Switchboard reveal cannot run inside LiteSVM; the
/// write-once and oracle checks are covered by `tests/vrf_and_freeze.rs`.
pub fn patch_vrf_seed(svm: &mut LiteSVM, pool: &Pubkey, seed: [u8; 32]) {
    patch_pool_bytes(svm, pool, 116, &seed);
}

/// Assert `r` failed with `code` (e.g. "6083") or `name` in its message.
pub fn assert_refused<T: std::fmt::Debug>(r: Result<T, String>, code: &str, name: &str) -> String {
    let err = r.expect_err(&format!("expected {name} ({code})"));
    assert!(
        err.contains(code) || err.contains(name),
        "expected {name} ({code}): {err}"
    );
    err
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
    /// Every pool type this environment created, in creation order. The
    /// remaining-accounts lists are derived from these by reading each one's
    /// `enabled` byte back from the chain.
    pub pool_types: Vec<Pubkey>,
}

impl Env {
    /// Fresh SVM with both programs loaded, sysvars set, config initialized.
    /// No pool type exists yet. Returns None (skip) when artifacts are
    /// missing.
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
        // airdrops are free): the seven 64-player prize pools sum to 694 SOL.
        svm.airdrop(&admin.pubkey(), 10_000_000_000_000).unwrap();
        svm.airdrop(&settlement.pubkey(), 100_000_000_000).unwrap();
        // The platform treasury PDA stays unfunded on purpose: the first
        // deposit must create it, proving a transfer to a fresh address
        // suffices.

        let entry_signer_pk = Pubkey::new_from_array(entry_signer.verifying_key().to_bytes());
        // Launch ceilings (D2 as re-scoped by v2: caps a pool's PASS SALES,
        // price × its capacity): tier 0 = 6.4 SOL, a 64-player pool's gross;
        // every other tier = its own 64-player gross, so the ceiling is a
        // cap, not a second switch.
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
            pool_types: Vec::new(),
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

    // ---- Pool types (D-E19) ------------------------------------------------

    /// `init_pool_type`, admin-signed; remembered for the remaining-accounts
    /// lists.
    pub fn init_pool_type(&mut self, mode: u8, tier: u8, capacity: u16) -> Result<(), String> {
        let ix = init_pool_type_ix(&self.admin.pubkey(), mode, tier, capacity);
        self.send(&[ix], &[])?;
        let t = pool_type_pda(mode, tier, capacity);
        if !self.pool_types.contains(&t) {
            self.pool_types.push(t);
        }
        Ok(())
    }

    /// `set_pool_type_economics` at the LAUNCH values for the capacity: its
    /// table, its minimum field, and the table's value at the tier's CURRENT
    /// price on Config (so a test that moved the price restates at the new
    /// one).
    pub fn set_launch_economics(&mut self, mode: u8, tier: u8, capacity: u16) -> Result<(), String> {
        let price = read_config(&self.svm).tier_price_lamports[tier as usize];
        let table = ladder_table(capacity);
        let ix = set_pool_type_economics_ix(
            &self.admin.pubkey(),
            mode,
            tier,
            capacity,
            ladder_min_seats(capacity),
            table,
            table_value(&table, price),
        );
        self.send(&[ix], &[])
    }

    /// `set_pool_type_enabled`, admin-signed.
    pub fn set_pool_type_enabled(
        &mut self,
        mode: u8,
        tier: u8,
        capacity: u16,
        enabled: bool,
    ) -> Result<(), String> {
        let ix = set_pool_type_enabled_ix(&self.admin.pubkey(), mode, tier, capacity, enabled);
        self.send(&[ix], &[])
    }

    /// The pool type for (mode, tier, capacity) exists, carries the launch
    /// economics and is enabled — created, configured and switched on as
    /// needed. Idempotent. Does NOT touch the tier switch (`set_open_tiers`
    /// / `set_hard_open_tiers`): which tiers are open stays each test's own
    /// statement.
    pub fn ensure_pool_type(&mut self, mode: u8, tier: u8, capacity: u16) -> Pubkey {
        let t = pool_type_pda(mode, tier, capacity);
        if self.svm.get_account(&t).is_none_or(|a| a.data.is_empty()) {
            self.init_pool_type(mode, tier, capacity)
                .unwrap_or_else(|e| panic!("init_pool_type({mode}, {tier}, {capacity}): {e}"));
        } else if !self.pool_types.contains(&t) {
            self.pool_types.push(t);
        }
        let view = read_pool_type(&self.svm, &t);
        if view.paid_places == 0 {
            self.set_launch_economics(mode, tier, capacity)
                .unwrap_or_else(|e| panic!("set_pool_type_economics: {e}"));
        }
        if !view.enabled {
            self.set_pool_type_enabled(mode, tier, capacity, true)
                .unwrap_or_else(|e| panic!("set_pool_type_enabled: {e}"));
        }
        t
    }

    /// Every ENABLED pool type this environment knows, ascending by address
    /// — read back from the chain, so it is what the program will see.
    pub fn enabled_pool_types(&self) -> Vec<Pubkey> {
        let mut v: Vec<Pubkey> = self
            .pool_types
            .iter()
            .copied()
            .filter(|t| read_pool_type(&self.svm, t).enabled)
            .collect();
        v.sort();
        v
    }

    /// `open_pool`'s remaining accounts for (mode, tier, capacity): every
    /// OTHER enabled pool type, ascending.
    pub fn other_enabled_pool_types(&self, mode: u8, tier: u8, capacity: u16) -> Vec<Pubkey> {
        let own = pool_type_pda(mode, tier, capacity);
        self.enabled_pool_types()
            .into_iter()
            .filter(|t| *t != own)
            .collect()
    }

    /// A well-formed `open_pool` for (mode, tier, capacity) with this
    /// environment's sealing hash and the remaining accounts derived from
    /// the chain.
    pub fn open_ix(
        &self,
        opener: &Pubkey,
        pool_id: u64,
        tier: u8,
        mode: u8,
        capacity: u16,
    ) -> Instruction {
        open_pool_ix(
            opener,
            pool_id,
            tier,
            [9u8; 32],
            self.sealing_secret_hash,
            mode,
            capacity,
            &self.other_enabled_pool_types(mode, tier, capacity),
        )
    }

    /// A well-formed `withdraw_platform`, admin-signed, with every enabled
    /// pool type as remaining accounts.
    pub fn withdraw_ix(&self, destination: &Pubkey, amount: u64) -> Instruction {
        withdraw_platform_ix(
            &self.admin.pubkey(),
            destination,
            amount,
            &self.enabled_pool_types(),
        )
    }

    /// The pool type a pool belongs to — the PDA of the pool's OWN recorded
    /// mode, tier and capacity, read from its account.
    pub fn pool_type_of(&self, pool_id: u64) -> Pubkey {
        let pv = read_pool(&self.svm, &pool_pda(pool_id));
        pool_type_pda(pv.mode, pv.tier, pv.capacity)
    }

    pub fn pay_ix(
        &self,
        pool_id: u64,
        seats: &[u16],
        wallets_and_entries: &[(Pubkey, Pubkey)],
    ) -> Instruction {
        pay_prizes_ix(
            &self.settlement.pubkey(),
            pool_id,
            &self.pool_type_of(pool_id),
            seats,
            wallets_and_entries,
        )
    }

    pub fn trigger_refund_ix(&self, signer: &Pubkey, pool_id: u64) -> Instruction {
        trigger_refund_ix(signer, pool_id, &self.pool_type_of(pool_id))
    }

    pub fn refund_ix(
        &self,
        signer: &Pubkey,
        pool_id: u64,
        entry: &Pubkey,
        player: &Pubkey,
    ) -> Instruction {
        refund_ix(signer, pool_id, entry, player, &self.pool_type_of(pool_id))
    }

    // ---- Treasury ---------------------------------------------------------

    /// Deposit `amount` into the platform treasury from the admin keypair
    /// (any signer works — the instruction is permissionless).
    pub fn fund_platform(&mut self, amount: u64) {
        let ix = fund_platform_ix(&self.admin.pubkey(), amount);
        self.send(&[ix], &[]).expect("fund_platform_wallet");
    }

    /// What opening (mode, tier, capacity) needs the treasury to hold beyond
    /// its refundable entries: the type's prize pool and its vault cushion,
    /// the policy minimum, and `reserve_pots` further pools (each with its
    /// cushion) of every OTHER enabled type. An upper bound — it counts every
    /// other enabled type as idle — so funding this always clears the gate.
    pub fn open_funding_bound(&self, mode: u8, tier: u8, capacity: u16) -> u64 {
        let cfg = read_config(&self.svm);
        let own = read_pool_type(&self.svm, &pool_type_pda(mode, tier, capacity));
        let others: u64 = self
            .other_enabled_pool_types(mode, tier, capacity)
            .iter()
            .map(|t| read_pool_type(&self.svm, t).pot_lamports + VAULT_RENT_CUSHION)
            .sum();
        own.pot_lamports
            + VAULT_RENT_CUSHION
            + cfg.treasury_min_platform_lamports
            + cfg.treasury_reserve_pots as u64 * others
    }

    // ---- Pools ------------------------------------------------------------

    /// Open pool `pool_id` — an EASY 64-player pool on `tier` — signed by the
    /// settlement signer (the keeper at init), and give it a VRF seed + pass
    /// Collection. Creates and enables the pool type if needed. Does NOT
    /// wait out a cooldown — a test re-opening a type advances the clock.
    /// Tops the treasury up first so the policy gate passes whatever a test
    /// has enabled (`open_funding_bound`). Tests that assert exact treasury
    /// numbers do their own funding and send `open_ix` directly.
    pub fn open_ready_pool(&mut self, pool_id: u64, tier: u8) {
        let settlement = self.settlement.insecure_clone();
        self.open_ready_pool_sized_as(&settlement, pool_id, tier, MODE_EASY, 64);
    }

    /// `open_ready_pool` with an explicit opener — for tests that rotate the
    /// keeper away from the settlement signer and then need a pool. The
    /// opener must be `Config.keeper`; the collection is still created by
    /// the settlement signer, which is only its payer.
    pub fn open_ready_pool_as(&mut self, opener: &Keypair, pool_id: u64, tier: u8) {
        self.open_ready_pool_sized_as(opener, pool_id, tier, MODE_EASY, 64);
    }

    /// `open_ready_pool` for either mode (Phase B), 64 players.
    pub fn open_ready_pool_mode(&mut self, pool_id: u64, tier: u8, mode: u8) {
        let settlement = self.settlement.insecure_clone();
        self.open_ready_pool_sized_as(&settlement, pool_id, tier, mode, 64);
    }

    /// `open_ready_pool` for any mode and capacity (D-E19).
    pub fn open_ready_pool_sized(&mut self, pool_id: u64, tier: u8, mode: u8, capacity: u16) {
        let settlement = self.settlement.insecure_clone();
        self.open_ready_pool_sized_as(&settlement, pool_id, tier, mode, capacity);
    }

    pub fn open_ready_pool_sized_as(
        &mut self,
        opener: &Keypair,
        pool_id: u64,
        tier: u8,
        mode: u8,
        capacity: u16,
    ) {
        self.ensure_pool_type(mode, tier, capacity);
        let bootstrap = self.open_funding_bound(mode, tier, capacity);
        self.fund_platform(bootstrap);
        let ix = self.open_ix(&opener.pubkey(), pool_id, tier, mode, capacity);
        self.send(&[ix], &[opener]).expect("open_pool");
        let settlement = self.settlement.insecure_clone();
        patch_vrf_seed(&mut self.svm, &pool_pda(pool_id), [5u8; 32]);
        let ix = create_pass_collection_ix(&self.settlement.pubkey(), pool_id);
        self.send(&[ix], &[&settlement])
            .expect("create_pass_collection");
    }

    /// A ONE-PLACE pool, as every pool opened before the Ladder is once
    /// `migrate_pool` has grown it: an easy 64-player pool opened under its
    /// pool type, then taken back to the pre-Ladder 850-byte layout and
    /// migrated — recorded as 64 seats, one paid place, table `[pot / entry]`
    /// (`[40]` at the launch prices), its floor kept.
    ///
    /// The one difference from a real pre-Ladder pool: this one holds its
    /// POOL TYPE's slot (it was opened by the Ladder's `open_pool`), where a
    /// real one's slot lived on Config. That changes only which slot
    /// `pay_prizes` frees at `Paid`, never the money. It exists so the paths
    /// that still serve one-place pools — `pay_next_place` above all, which
    /// refuses every Ladder pool — stay proven against the artifact.
    pub fn open_legacy_pool(&mut self, pool_id: u64, tier: u8) {
        self.open_ready_pool(pool_id, tier);
        shrink_pool_to_v3(&mut self.svm, &pool_pda(pool_id));
        let settlement = self.settlement.insecure_clone();
        self.send(&[migrate_pool_ix(&settlement.pubkey(), pool_id)], &[&settlement])
            .expect("migrate_pool to the one-place shape");
        let pv = read_pool(&self.svm, &pool_pda(pool_id));
        assert_eq!((pv.capacity, pv.paid_places), (64, 1), "one-place shape");
    }

    /// Fund a fresh player and register them. Returns (player, entry PDA).
    pub fn register_player(&mut self, pool_id: u64) -> Result<(Keypair, Pubkey), String> {
        let player = Keypair::new();
        self.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        self.register_as(pool_id, &player).map(|e| (player, e))
    }

    /// Register `n` fresh players, panicking on the first failure.
    pub fn register_n(&mut self, pool_id: u64, n: u16) -> Vec<(Keypair, Pubkey)> {
        (0..n)
            .map(|i| {
                self.register_player(pool_id)
                    .unwrap_or_else(|e| panic!("register #{i} in pool {pool_id}: {e}"))
            })
            .collect()
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

    /// `reveal_pool_secret` with the harness secret, settlement-signed.
    pub fn reveal(&mut self, pool_id: u64) {
        let settlement = self.settlement.insecure_clone();
        let secret = self.pool_secret;
        let ix = settle_ix(&settlement.pubkey(), pool_id, "reveal_pool_secret", &secret);
        self.send(&[ix], &[&settlement]).expect("reveal_pool_secret");
    }

    /// `commit_results` with `root` and `payouts`, settlement-signed.
    pub fn commit(
        &mut self,
        pool_id: u64,
        root: [u8; 32],
        payouts: &[(u16, u64)],
    ) -> Result<(), String> {
        let settlement = self.settlement.insecure_clone();
        let ix = commit_results_ix(&settlement.pubkey(), pool_id, root, payouts);
        self.send(&[ix], &[&settlement])
    }

    /// Pay every seat in `payouts` in batches of six, settlement-signed, and
    /// return each seat's wallet delta in the same order.
    pub fn pay_all(
        &mut self,
        pool_id: u64,
        players: &[(Keypair, Pubkey)],
        payouts: &[(u16, u64)],
    ) -> Vec<u64> {
        let settlement = self.settlement.insecure_clone();
        let before: Vec<u64> = payouts
            .iter()
            .map(|&(seat, _)| self.balance(&players[seat as usize].0.pubkey()))
            .collect();
        for chunk in payouts.chunks(6) {
            let seats: Vec<u16> = chunk.iter().map(|&(s, _)| s).collect();
            let metas: Vec<(Pubkey, Pubkey)> = chunk
                .iter()
                .map(|&(seat, _)| {
                    let (p, e) = &players[seat as usize];
                    (p.pubkey(), *e)
                })
                .collect();
            let ix = self.pay_ix(pool_id, &seats, &metas);
            self.send(&[ix], &[&settlement]).expect("pay batch");
        }
        payouts
            .iter()
            .enumerate()
            .map(|(i, &(seat, _))| self.balance(&players[seat as usize].0.pubkey()) - before[i])
            .collect()
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

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }
}
