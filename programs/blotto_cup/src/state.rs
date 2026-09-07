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

/// Platform treasury PDA: `[PLATFORM_SEED]` — one per program (D-A1
/// revised, 2026-08-27). A zero-data system-owned account that receives
/// 100% of pass-sale revenue at `register` and funds each pool's prize
/// vault at `open_pool`, BEFORE any pass is sold. Its only exits are
/// `open_pool` (pot funding), `refund` (returning entry payments — the
/// program holds every refundable lamport, R7 stays operator-independent)
/// and the Squads-gated `withdraw_platform`, floor-guarded so neither the
/// treasury policy's reserve nor any refundable entry can be withdrawn.
/// The former per-pool fees PDA (the 80/20 split) is GONE.
pub const PLATFORM_SEED: &[u8] = b"platform";

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
    /// Signs `reveal_pool_secret`, `commit_results`, `pay_prizes`, flags,
    /// `release_escrow` (the reviewed path) and `pay_next_place`
    /// (Turnkey-custodied). Rotatable. `open_pool` is the keeper's
    /// (tail field below); `forfeit_escrow` is the admin's.
    pub settlement_signer: Pubkey,
    /// Blocks `register` when true (admin kill switch).
    pub paused: bool,
    /// Which of the configured tiers may open pools (roadmap R6, D1).
    /// Index = tier into `TIER_ENTRY_LAMPORTS`.
    pub open_tiers: [bool; N_TIERS],
    /// Per-TIER ceiling in lamports on a pool's PASS SALES (decision D2 as
    /// re-scoped by D-A1 v2: pots are fixed, so the ceiling caps gross
    /// pass-sale intake, price × 64, at `open_pool`). Launch values: tier 0
    /// = 6.4 SOL; every other tier = its own gross — a cap, not a second
    /// open/closed switch.
    pub vault_ceiling_lamports: [u64; N_TIERS],
    /// Per-tier entry price (D-A1 v2: founder-changeable via
    /// `set_tier_economics`; a change never touches an open pool — each
    /// pool copies its price at open). Seeded from `TIER_ENTRY_LAMPORTS`.
    pub tier_price_lamports: [u64; N_TIERS],
    /// Per-tier FIXED pot (D-A1 v2), funded from the platform treasury at
    /// `open_pool`. Never derived from entries or balances. Seeded from
    /// `TIER_POT_LAMPORTS`; must stay a multiple of 1024.
    pub tier_pot_lamports: [u64; N_TIERS],
    /// Treasury policy (D-A1 v2): a tier may open only if, after funding
    /// its pot, the treasury still holds `min` + `reserve_pots` further
    /// pots of every OTHER enabled tier with no live pool. Founder-tunable;
    /// changes never touch an open pool.
    pub treasury_reserve_pots: u8,
    pub treasury_min_platform_lamports: u64,
    /// Pots currently locked in open pools' prize vaults (informational,
    /// D-A1 v2's `reserved`).
    pub platform_reserved: u64,
    /// Entry payments received for pools that can still refund (Open,
    /// below 64). `withdraw_platform` may never dip into this — R7's 100%
    /// refund is program-held, not a promise.
    pub platform_refundable: u64,
    /// Canonical bump of the `[PLATFORM_SEED]` treasury PDA.
    pub platform_bump: u8,
    /// KYC-at-claim switch (roadmap R3/4.5). 0 = off. When non-zero,
    /// `pay_prizes` escrows any share above it until a `kyc_tier ≥ 1` packet
    /// is presented via `release_escrow`. D-E5: kept at 0, never deleted;
    /// under D-E2 (one paid seat = the whole pot) any threshold below the
    /// smallest pot escrows EVERY payout — see `handle_set_kyc_threshold`.
    pub kyc_required_above_lamports: u64,
    /// Detection hard-block policy flag (roadmap R11). Read by the off-chain
    /// detection layer, recorded on-chain so the operative policy is public.
    pub detection_hard_block: bool,
    /// Next pool id. Starts at 1; 0 is the "no pool" sentinel below.
    pub next_pool_id: u64,
    /// The tier's LIVE pool id, 0 if none (D-A1 v2: pools per tier are
    /// SEQUENTIAL — the slot is set by `open_pool` and clears only when the
    /// pool reaches `Paid` or `Closed`, so the next pool in a tier cannot
    /// open while the previous is unsettled).
    pub active_pool_by_tier: [u64; N_TIERS],
    pub bump: u8,
    // ---- Fields appended by the 2026-09-07 upgrade (prompt v2 §A/§B/§G).
    // APPENDED AFTER `bump` ON PURPOSE: every off-chain reader addresses the
    // fields above by fixed byte offset, and the live devnet Config was
    // allocated at the old size. Appending keeps every existing offset
    // valid; `migrate_config` grows the account once and writes this tail.
    // The next layout change goes here too, never above this line.
    /// The keeper: the one key allowed to call `open_pool` before the
    /// liveness fallback (`LIVENESS_FALLBACK_SECS`). Set at init / migrate,
    /// rotatable by admin (`set_keeper`). The daemon holds it; on devnet it
    /// is the settlement signer until E6 splits the keys.
    pub keeper: Pubkey,
    /// The fill deadline applied at `open_pool` (`Pool.fill_deadline =
    /// now + this`). Seeded `DEFAULT_FILL_DEADLINE_SECS`; `set_pool_timing`
    /// changes it — never a pool already open.
    pub fill_deadline_seconds: i64,
    /// The pause between a tier's pool settling and its next open. Seeded
    /// `DEFAULT_COOLDOWN_SECS`.
    pub cooldown_seconds: i64,
    /// Per tier: the earliest unix time its next pool may open, stamped
    /// `now + cooldown_seconds` whenever the tier's slot frees (`Paid` /
    /// `Closed`). 0 = the tier has never settled a pool. Read by `open_pool`
    /// (the cooldown gate and the keeper liveness fallback) and by the app's
    /// "next pool in" countdown via `TierSlotFreed`.
    pub tier_next_open_at: [i64; N_TIERS],
}

impl Config {
    /// The pre-2026-09-07 layout, in bytes after the discriminator: 3 pubkeys
    /// (96), paused (1), open_tiers (N_TIERS), ceilings (8·N_TIERS),
    /// prices (8·N_TIERS), pots (8·N_TIERS), reserve_pots (1),
    /// min_platform (8), reserved (8), refundable (8), platform_bump (1),
    /// kyc threshold (8), detection switch (1), next_pool_id (8),
    /// active_pool_by_tier (8·N_TIERS), bump (1) — 372 in all.
    /// `migrate_config` accepts exactly this size and nothing else.
    pub const LEN_V1: usize =
        32 * 3 + 1 + N_TIERS + 8 * N_TIERS * 4 + 1 + 8 + 8 + 8 + 1 + 8 + 1 + 8 + 1;
    pub const SPACE_V1: usize = 8 + Self::LEN_V1;
    /// The appended tail: keeper (32) + fill_deadline_seconds (8) +
    /// cooldown_seconds (8) + tier_next_open_at (8·N_TIERS).
    pub const TAIL_LEN: usize = 32 + 8 + 8 + 8 * N_TIERS;
    pub const LEN: usize = Self::LEN_V1 + Self::TAIL_LEN;
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
    /// The 64th entry landed, or the deadline passed with at least
    /// `MIN_SEATS` (D-E4). No further entries; the pool secret may be exported.
    Sealed,
    /// Results root + payout list committed. Awaiting `pay_prizes`.
    Scored,
    /// Every committed seat settled (paid or escrowed).
    Paid,
    /// Deadline passed below `MIN_SEATS`. Entries refunded in full.
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
    /// Entry price in lamports, fixed at open (copied from Config's tier
    /// price — a later founder change never touches this pool).
    pub entry_lamports: u64,
    /// The FIXED pot funding this pool's prize vault (D-A1 v2), copied from
    /// Config at open and locked in the vault before any pass is sold.
    pub pot_lamports: u64,
    /// Entries so far. Also the next entry's index. Under D-E4 a pool may
    /// seal anywhere in `MIN_SEATS..=CAPACITY`; this is the field it played.
    pub entrants: u16,
    pub opened_at: i64,
    /// The moment entries close: `opened_at + Config.fill_deadline_seconds`
    /// as it stood at open (12 h by default — founder ruling 2026-09-07),
    /// copied here so a later `set_pool_timing` never moves a deadline
    /// players entered under. Never rewritten (option A: the go-timer of
    /// D-E4 §11.3 was removed by the same ruling). Past it, `seal_at_deadline`
    /// (≥ MIN_SEATS) or `trigger_refund` (< MIN_SEATS).
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
    /// `commit_results`. The paid set is variable (under D-E2 it is the
    /// winner, or every member of a tie for first), so this is a length plus
    /// a fixed 64-slot array; `pay_prizes` pays exactly these amounts to
    /// exactly these seats. The array stays 64 wide on purpose (proposal E1
    /// §2.3): shrinking it would move every offset the LiteSVM and web3
    /// readers hard-code, force an account migration, and foreclose a
    /// return to a multi-place table — 630 bytes of rent is the price of
    /// reversibility. On the wire: 2 + 64×10 = 642 bytes of an 839-byte
    /// `Pool::LEN` (847 with the discriminator) — far under the 10 KiB
    /// companion-PDA threshold.
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
}

impl Pool {
    pub const LEN: usize = 8 // id
        + 1 // tier
        + 8 // entry_lamports
        + 8 // pot_lamports
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
        + 1 + 1; // bumps
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
    /// After `forfeit_escrow` the lamports STAY here (and in the vault) with
    /// `forfeited = true`, until `pay_next_place` pays them to the next
    /// eligible player — forfeited money never reaches the operator (founder
    /// ruling 2026-09-07).
    pub escrow_lamports: u64,
    pub bump: u8,
    // ---- Appended by the 2026-09-07 upgrade (prompt v2 §E). After `bump`
    // for the same reason as Config's tail: the readers address the fields
    // above by offset. Entries are created per `register`, so pre-upgrade
    // Entries exist only in pools opened before it (devnet: none).
    /// When `pay_prizes` escrowed the share (unix seconds; 0 = never).
    /// `release_escrow` becomes permissionless `ESCROW_AUTO_RELEASE_SECS`
    /// after this — inaction pays the player.
    pub escrowed_at: i64,
    /// Review upheld the flag (`forfeit_escrow`, admin-signed). The share can
    /// no longer be released to this player; only paid onward.
    pub forfeited: bool,
    /// Lamports this entry received by next-place payout from a forfeited share
    /// (`pay_next_place`) — on top of any committed payout.
    pub next_place_lamports: u64,
    // ---- The split (founder ruling 3 of the 2026-09-07 addendum): a
    // forfeited share is divided EQUALLY among the eligible players at the
    // rank it passes to, one member per `pay_next_place` call. These four
    // fields live on the FORFEITER's Entry and make the split idempotent
    // and exact across calls.
    /// The share as it stood when the first split payment went out (the
    /// dividend); 0 until then. `escrow_lamports` counts down from it.
    pub split_total: u64,
    /// Bit per SEAT already paid from this forfeited share.
    pub split_paid_mask: u64,
    /// The size of the group the share is divided among, fixed by the first
    /// payment (recomputed and checked on-chain at first place; asserted
    /// by the settlement signer at the next rank — disclosed residual, see
    /// `escrow.rs`). 0 = no payment yet.
    pub split_group_size: u16,
    /// The indivisible remainder has been paid (to the lowest entry number
    /// of the group — verified at first place, asserted at the next rank).
    pub split_remainder_paid: bool,
}

impl Entry {
    /// The pre-2026-09-07 layout (183); pre-upgrade Entries, if any, are
    /// this size and are read by offset only up to here.
    pub const LEN_V1: usize = 32 + 32 + 2 + 32 + 1 + 32 + 8 + 32 + 1 + 1 + 1 + 8 + 1;
    /// escrowed_at (8) + forfeited (1) + next_place_lamports (8) +
    /// split_total (8) + split_paid_mask (8) + split_group_size (2) +
    /// split_remainder_paid (1).
    pub const TAIL_LEN: usize = 8 + 1 + 8 + 8 + 8 + 2 + 1;
    pub const LEN: usize = Self::LEN_V1 + Self::TAIL_LEN;
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
            PLATFORM_SEED,
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
            Pubkey::find_program_address(&[PLATFORM_SEED], &crate::ID).0,
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
            paused: true,
            open_tiers: [true, false, false, false, false, false, false],
            vault_ceiling_lamports: [u64::MAX; N_TIERS],
            tier_price_lamports: crate::constants::TIER_ENTRY_LAMPORTS,
            tier_pot_lamports: crate::constants::TIER_POT_LAMPORTS,
            treasury_reserve_pots: 1,
            treasury_min_platform_lamports: u64::MAX,
            platform_reserved: u64::MAX,
            platform_refundable: u64::MAX,
            platform_bump: 254,
            kyc_required_above_lamports: 0,
            detection_hard_block: true,
            next_pool_id: 1,
            active_pool_by_tier: [0; N_TIERS],
            bump: 255,
            keeper: Pubkey::new_unique(),
            fill_deadline_seconds: i64::MAX,
            cooldown_seconds: i64::MAX,
            tier_next_open_at: [i64::MAX; N_TIERS],
        };
        let mut buf = Vec::new();
        c.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Config::LEN, "Config::LEN is stale");
        // The tail is exactly the appended fields, in order, after the V1
        // bytes — what `migrate_config` writes by hand.
        assert_eq!(buf.len(), Config::LEN_V1 + Config::TAIL_LEN);
        assert_eq!(&buf[Config::LEN_V1..Config::LEN_V1 + 32], c.keeper.as_ref());
        assert_eq!(
            &buf[Config::LEN_V1 + 32..Config::LEN_V1 + 40],
            &i64::MAX.to_le_bytes()
        );
    }

    #[test]
    fn pool_len_matches_serialized_size() {
        let p = Pool {
            id: u64::MAX,
            tier: 3,
            entry_lamports: u64::MAX,
            pot_lamports: u64::MAX,
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
        };
        let mut buf = Vec::new();
        p.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Pool::LEN, "Pool::LEN is stale");
    }

    /// The account layouts are load-bearing beyond this crate: the LiteSVM
    /// harness, `backend/reveal/src/chain-web3.ts` and `scripts/admin.ts`
    /// read them by hard-coded byte offsets, and every live account on-chain
    /// was allocated at its size. A field INSERTED anywhere moves every
    /// offset behind it and makes every pre-upgrade account undeserialisable
    /// (a pool that can neither take entries nor refund holds its pot with no
    /// exit). The rule since the 2026-09-07 upgrade: new fields are APPENDED
    /// after `bump`, the readers learn the tail, and an account that must
    /// grow gets a migration instruction in the same upgrade
    /// (`migrate_config`). `Pool::LEN` is 839 — not the 834 the proposal and
    /// prompt v2 repeat (that number is `paid_mask`'s byte offset, D1/D14;
    /// the founder's note against it is in the decision register). These
    /// pins turn a layout change into a deliberate, reviewed act.
    #[test]
    fn account_layouts_are_pinned() {
        assert_eq!(Pool::LEN, 839, "Pool layout changed — read the note above");
        assert_eq!(Pool::SPACE, 847);
        assert_eq!(
            Config::LEN_V1,
            372,
            "the pre-migration Config layout is history — never change"
        );
        assert_eq!(Config::SPACE_V1, 380);
        assert_eq!(Config::TAIL_LEN, 104);
        assert_eq!(
            Config::LEN,
            476,
            "Config layout changed — append after the tail and ship a migration"
        );
        assert_eq!(Config::SPACE, 484);
        assert_eq!(Entry::LEN_V1, 183);
        assert_eq!(Entry::TAIL_LEN, 36);
        assert_eq!(Entry::LEN, 219);
        assert_eq!(Entry::SPACE, 227);
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
            escrowed_at: i64::MAX,
            forfeited: true,
            next_place_lamports: u64::MAX,
            split_total: u64::MAX,
            split_paid_mask: u64::MAX,
            split_group_size: u16::MAX,
            split_remainder_paid: true,
        };
        let mut buf = Vec::new();
        e.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Entry::LEN, "Entry::LEN is stale");
        assert_eq!(buf.len(), Entry::LEN_V1 + Entry::TAIL_LEN);
    }
}
