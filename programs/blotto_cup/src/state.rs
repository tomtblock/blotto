//! Account state and PDA seed prefixes.
//!
//! Layouts per TECH-ARCH §3.1 as amended by roadmap §1.4:
//! `Config` gains `open_tiers`, `vault_ceiling_lamports`,
//! `kyc_required_above_lamports`, `detection_hard_block`; `Pool` gains
//! `timer_seconds` and (per R10) the 16 winners committed alongside the results
//! root; `Entry` gains `escrow_lamports` and loses `claimed` (there is no claim
//! step — prizes are pushed).
//!
//! Every field traces to TECH-ARCH §3.1 or a register row; nothing is invented.

use anchor_lang::prelude::*;

use crate::constants::{CAPACITY, N_TIERS};

// ---------------------------------------------------------------------------
// PDA seed prefixes — one distinct prefix per PDA type (threat-tm-401).
// ---------------------------------------------------------------------------

/// Config PDA: `[CONFIG_SEED]` — global singleton.
pub const CONFIG_SEED: &[u8] = b"config";

/// Pool PDA: `[POOL_SEED, pool_id.to_le_bytes()]`.
pub const POOL_SEED: &[u8] = b"pool";

/// Prize vault PDA: `[VAULT_SEED, pool_id.to_le_bytes()]`. A zero-data
/// system-owned account holding the 80% prize pot. Lamports leave it only
/// through the exits enumerated in `vault.rs`.
pub const VAULT_SEED: &[u8] = b"vault";

/// Fees PDA: `[FEES_SEED, pool_id.to_le_bytes()]`. A zero-data system-owned
/// account holding the 20% platform share **until the pool seals**. Holding it
/// per-pool until seal is what makes the R7 full refund (100% back, platform
/// share included) operator-independent — the program cannot debit the founder's wallet,
/// so the refundable 20% must sit under program control until the pool can no
/// longer refund. Swept to the platform wallet in the 64th `register`.
/// Recorded as a deliberate deviation from PID §7's instant-split diagram in
/// `docs/phase-reports/phase-1-program.md`.
pub const FEES_SEED: &[u8] = b"fees";

/// Entry PDA: `[ENTRY_SEED, pool.key(), player.key()]`. Keying on the player
/// makes one entry per wallet per pool a program invariant (a second `register`
/// finds the PDA already initialized and reverts) — consistent with PID §1's
/// "a player pays a fixed entry" and with detection treating multi-entry as
/// multi-accounting (TECH-ARCH §9).
pub const ENTRY_SEED: &[u8] = b"entry";

/// Metaplex Core Collection asset PDA for a pool's character passes:
/// `[PASS_COLLECTION_SEED, pool.key()]` (carried from Phase 0).
pub const PASS_COLLECTION_SEED: &[u8] = b"pass_collection";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/// Global program configuration. Admin is the Squads vault (playbook §4.1).
#[account]
pub struct Config {
    /// Squads multisig. The only signer for the admin instructions.
    pub admin: Pubkey,
    /// Signs entry packets (Turnkey-custodied, sign-only). Rotatable.
    pub entry_signer: Pubkey,
    /// Signs `open_pool`, `reveal_pool_secret`, `commit_results`, `pay_prizes`,
    /// flag/escrow instructions (Turnkey-custodied). Rotatable.
    pub settlement_signer: Pubkey,
    /// Receives the 20% platform share at seal, and forfeited escrow when no
    /// successor pool exists.
    pub platform_wallet: Pubkey,
    /// Blocks `register` when true (admin kill switch).
    pub paused: bool,
    /// Which of the configured tiers may open pools (roadmap R6, D1).
    /// Index = tier into `TIER_ENTRY_LAMPORTS`.
    pub open_tiers: [bool; N_TIERS],
    /// Per-TIER gross ceiling in lamports (decision D2, 2026-08-27 —
    /// roadmap Phase 8's "each with its own vault ceiling"). `open_pool`
    /// rejects a tier whose full pool (entry × 64) would exceed its entry.
    /// Launch values: tier 0 = 6.4 SOL; every other tier = its own gross,
    /// so the ceiling is a cap, not a second open/closed switch.
    pub vault_ceiling_lamports: [u64; N_TIERS],
    /// KYC-at-claim switch (roadmap R3/4.5). 0 = off. When non-zero,
    /// `pay_prizes` escrows any share above it until a `kyc_tier ≥ 1` packet
    /// is presented via `release_escrow`.
    pub kyc_required_above_lamports: u64,
    /// Detection hard-block policy flag (roadmap R11). Read by the off-chain
    /// detection layer, recorded on-chain so the operative policy is public.
    pub detection_hard_block: bool,
    /// Next pool id. Starts at 1; 0 is the "no pool" sentinel below.
    pub next_pool_id: u64,
    /// The currently-Open pool id per tier, 0 if none (roadmap R14: max one
    /// open pool per tier). Set by `open_pool`; cleared at seal or refund.
    pub active_pool_by_tier: [u64; N_TIERS],
    pub bump: u8,
}

impl Config {
    /// 4 pubkeys (128) + paused (1) + open_tiers (N_TIERS) + ceilings
    /// (8·N_TIERS) + kyc threshold (8) + detection switch (1) +
    /// next_pool_id (8) + active_pool_by_tier (8·N_TIERS) + bump (1).
    pub const LEN: usize = 32 * 4 + 1 + N_TIERS + 8 * N_TIERS + 8 + 1 + 8 + 8 * N_TIERS + 1;
    pub const SPACE: usize = 8 + Self::LEN;
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

/// Pool lifecycle (TECH-ARCH §3.2 as amended by R10: `Paid` replaces the
/// claim-window states).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PoolState {
    /// Accepting entries.
    Open,
    /// 64th entry landed. No further entries; the pool secret may be exported.
    Sealed,
    /// Results root + winners committed. Awaiting `pay_prizes`.
    Scored,
    /// All 16 ranks settled (paid or escrowed).
    Paid,
    /// Deadline passed below 64. Entries refunded in full.
    Refunding,
    /// Terminal: every entrant refunded.
    Closed,
}

/// One committed payout: a seat and the lamports it settles for. Amounts
/// are computed off-chain by the published split-pot rule (D3-B; the
/// scoring engine + the Python oracle) and validated in aggregate on-chain:
/// the verify page is what makes a wrong list detectable (trust unchanged
/// from the winners-array design).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct Payout {
    /// Seat (entry index), 0-based.
    pub entry_index: u16,
    /// Lamports this seat settles for.
    pub amount: u64,
}

/// A single competition pool.
#[account]
pub struct Pool {
    /// Monotonic pool id; also the PDA seed (little-endian).
    pub id: u64,
    /// Tier index into `TIER_ENTRY_LAMPORTS`.
    pub tier: u8,
    /// Entry price in lamports, fixed at open.
    pub entry_lamports: u64,
    /// Entries so far. Also the next entry's index.
    pub entrants: u16,
    pub opened_at: i64,
    /// `opened_at + FILL_DEADLINE_SECS` (72h, R7).
    pub fill_deadline: i64,
    pub state: PoolState,
    /// X25519 public key entries are sealed to (TECH-ARCH §5). Published at open.
    pub sealing_pubkey: [u8; 32],
    /// `sha256(secret)`, committed at open; checked at reveal.
    pub sealing_secret_hash: [u8; 32],
    /// Switchboard On-Demand VRF result, committed once by `commit_vrf_seed`.
    /// Zero = uncommitted sentinel. One of five inputs to the cosmetic class
    /// digest; read by nothing in the scoring path (PID §8.4).
    pub vrf_seed: [u8; 32],
    /// Bag-without-replacement class counters (PID §3). Sum falls from 64 to 0
    /// as entries land. Named `class_counters`, never anything shorter
    /// (PID §8.7).
    pub class_counters: [u16; 5],
    /// Set by `reveal_pool_secret` after the hash check.
    pub secret_revealed: bool,
    /// Merkle root of the full 64-place ranking `(player, rank, amount)`
    /// (R10: committed for verifiability; the paid pairs go on-chain in the
    /// payout transaction).
    pub results_root: [u8; 32],
    pub results_committed: bool,
    /// Settled payout list, committed with the root (decision D3-B,
    /// 2026-08-27 — split-pot ties). Sorted by `entry_index`, no duplicates,
    /// amounts summing to exactly the pot — all validated at
    /// `commit_results`. The paid set is variable (ties straddling 16th/17th
    /// pay more than 16 players), so this replaces the fixed 16-winner
    /// array; `pay_prizes` pays exactly these amounts to exactly these
    /// seats. Measured on-Pool: 2 + 64×10 bytes keeps `Pool` at 834 bytes —
    /// far under the 10 KiB companion-PDA threshold.
    pub payouts_len: u16,
    pub payouts: [Payout; CAPACITY as usize],
    /// Bit `entry_index` set once that seat's payout is settled (paid or
    /// escrowed). Makes `pay_prizes` batches idempotent; all `payouts_len`
    /// bits set → state `Paid`.
    pub paid_mask: u64,
    /// Entries refunded so far (Refunding pools). == entrants → `Closed`.
    pub refunded_count: u16,
    /// Per-screen timer, seconds (R9: 15). Recorded per pool so the value
    /// players entered under is on-chain.
    pub timer_seconds: u8,
    pub bump: u8,
    pub vault_bump: u8,
    pub fees_bump: u8,
}

impl Pool {
    pub const LEN: usize = 8 // id
        + 1 // tier
        + 8 // entry_lamports
        + 2 // entrants
        + 8 // opened_at
        + 8 // fill_deadline
        + 1 // state
        + 32 // sealing_pubkey
        + 32 // sealing_secret_hash
        + 32 // vrf_seed
        + 2 * 5 // class_counters
        + 1 // secret_revealed
        + 32 // results_root
        + 1 // results_committed
        + 2 // payouts_len
        + 10 * CAPACITY as usize // payouts (u16 + u64 each)
        + 8 // paid_mask
        + 2 // refunded_count
        + 1 // timer_seconds
        + 1 + 1 + 1; // bumps
    pub const SPACE: usize = 8 + Self::LEN;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/// One player's entry in one pool.
#[account]
pub struct Entry {
    pub pool: Pubkey,
    pub player: Pubkey,
    /// Seat index, 0-based; feeds the class digest.
    pub index: u16,
    /// `sha256(35-byte battle set ‖ 32-byte salt)` (TECH-ARCH §5).
    pub battles_hash: [u8; 32],
    /// The drawn cosmetic class (PID §3). Written here and to the pass for
    /// display; **read by nothing in the scoring path** (PID §8.4).
    pub class: u8,
    /// The minted character pass (Metaplex Core asset).
    pub pass_asset: Pubkey,
    pub entered_at: i64,
    /// The delayed slot hash the class digest consumed — stored (and emitted)
    /// so any player can replay the draw from on-chain data alone.
    pub slot_hash: [u8; 32],
    /// Detection flag (R11). A flagged entry's prize share is escrowed at
    /// `pay_prizes` instead of paid.
    pub flagged: bool,
    /// Rank settled at `pay_prizes` (paid or escrowed).
    pub settled: bool,
    pub refunded: bool,
    /// Prize share held in the vault pending review (flag) or KYC (R3 switch).
    pub escrow_lamports: u64,
    pub bump: u8,
}

impl Entry {
    pub const LEN: usize = 32 + 32 + 2 + 32 + 1 + 32 + 8 + 32 + 1 + 1 + 1 + 8 + 1;
    pub const SPACE: usize = 8 + Self::LEN;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::LAUNCH_CLASS_COUNTERS;

    /// Distinct seed prefix per PDA type (threat-tm-401).
    #[test]
    fn pda_seed_prefixes_are_pairwise_distinct() {
        let prefixes: [&[u8]; 6] = [
            CONFIG_SEED,
            POOL_SEED,
            VAULT_SEED,
            FEES_SEED,
            ENTRY_SEED,
            PASS_COLLECTION_SEED,
        ];
        for (i, a) in prefixes.iter().enumerate() {
            for b in prefixes.iter().skip(i + 1) {
                assert_ne!(a, b, "seed prefixes collide (TM-401)");
            }
        }
    }

    /// The PDA types derive pairwise-distinct addresses from related inputs.
    #[test]
    fn pda_types_derive_distinct_addresses() {
        let id: u64 = 7;
        let pool = Pubkey::find_program_address(&[POOL_SEED, &id.to_le_bytes()], &crate::ID).0;
        let player = Pubkey::new_from_array([9u8; 32]);
        let addrs = [
            Pubkey::find_program_address(&[CONFIG_SEED], &crate::ID).0,
            pool,
            Pubkey::find_program_address(&[VAULT_SEED, &id.to_le_bytes()], &crate::ID).0,
            Pubkey::find_program_address(&[FEES_SEED, &id.to_le_bytes()], &crate::ID).0,
            Pubkey::find_program_address(&[ENTRY_SEED, pool.as_ref(), player.as_ref()], &crate::ID)
                .0,
            Pubkey::find_program_address(&[PASS_COLLECTION_SEED, pool.as_ref()], &crate::ID).0,
        ];
        for (i, a) in addrs.iter().enumerate() {
            for b in addrs.iter().skip(i + 1) {
                assert_ne!(a, b, "two PDA types derive the same address");
            }
        }
    }

    /// The LEN constants must match what Borsh writes — a stale LEN
    /// under-allocates and fails at runtime, expensively.
    #[test]
    fn config_len_matches_serialized_size() {
        let c = Config {
            admin: Pubkey::new_unique(),
            entry_signer: Pubkey::new_unique(),
            settlement_signer: Pubkey::new_unique(),
            platform_wallet: Pubkey::new_unique(),
            paused: true,
            open_tiers: [true, false, false, false, false, false, false],
            vault_ceiling_lamports: [u64::MAX; N_TIERS],
            kyc_required_above_lamports: 0,
            detection_hard_block: true,
            next_pool_id: 1,
            active_pool_by_tier: [0; N_TIERS],
            bump: 255,
        };
        let mut buf = Vec::new();
        c.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Config::LEN, "Config::LEN is stale");
    }

    #[test]
    fn pool_len_matches_serialized_size() {
        let p = Pool {
            id: u64::MAX,
            tier: 3,
            entry_lamports: u64::MAX,
            entrants: 64,
            opened_at: i64::MAX,
            fill_deadline: i64::MAX,
            state: PoolState::Paid,
            sealing_pubkey: [1; 32],
            sealing_secret_hash: [2; 32],
            vrf_seed: [3; 32],
            class_counters: LAUNCH_CLASS_COUNTERS,
            secret_revealed: true,
            results_root: [4; 32],
            results_committed: true,
            payouts_len: 17,
            payouts: [Payout {
                entry_index: 63,
                amount: u64::MAX,
            }; CAPACITY as usize],
            paid_mask: u64::MAX,
            refunded_count: 64,
            timer_seconds: 15,
            bump: 255,
            vault_bump: 254,
            fees_bump: 253,
        };
        let mut buf = Vec::new();
        p.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Pool::LEN, "Pool::LEN is stale");
    }

    #[test]
    fn entry_len_matches_serialized_size() {
        let e = Entry {
            pool: Pubkey::new_unique(),
            player: Pubkey::new_unique(),
            index: 63,
            battles_hash: [1; 32],
            class: 4,
            pass_asset: Pubkey::new_unique(),
            entered_at: i64::MAX,
            slot_hash: [2; 32],
            flagged: true,
            settled: true,
            refunded: false,
            escrow_lamports: u64::MAX,
            bump: 255,
        };
        let mut buf = Vec::new();
        e.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Entry::LEN, "Entry::LEN is stale");
    }
}
