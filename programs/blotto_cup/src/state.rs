//! Account state and PDA seed prefixes.
//!
//! **Phase 0 scope.** `Pool` here is a deliberate *subset* of the account
//! specified in TECH-ARCH §3.1 — only the fields the two instructions carried in
//! Phase 0 actually read or write. Phase 1 owns the full struct (`tier`,
//! `entry_lamports`, `entrants`, `opened_at`, `fill_deadline`, `pool_pubkey`,
//! `pool_secret_hash`, `class_root`, `class_counters`, `results_root`,
//! `prize_vault`) along with `Config`, `Entry`, and the vault PDA.
//!
//! Adding a field here is a Phase 1 decision, not a Phase 0 one: every field
//! costs rent on every pool, and the layout is what the off-chain indexer decodes
//! against. Nothing has been invented — every field below appears in TECH-ARCH
//! §3.1 (`CLAUDE.md`: never invent values).

use anchor_lang::prelude::*;

/// Pool PDA seed prefix.
///
/// Full derivation: `[POOL_SEED, pool_id.to_le_bytes()]`.
///
/// Note this differs from the predecessor's Collection PDA, which was seeded on a
/// pack-token mint. A Pool has no mint — entries are paid in SOL and the only
/// token involved is the character pass, which is minted per entry — so the pool
/// id is the discriminator.
pub const POOL_SEED: &[u8] = b"pool";

/// Metaplex Core Collection asset PDA seed prefix — the collection that groups a
/// pool's character passes.
///
/// Full derivation: `[PASS_COLLECTION_SEED, pool_pubkey.as_ref()]`.
///
/// The address is derivable, so it is never stored on `Pool`: `create_pass_collection`
/// (producer) and `mint_pass` (consumer) both re-derive it from these seeds.
///
/// Distinct prefix per PDA type, per `docs/reference/threat-tm-401.md`.
pub const PASS_COLLECTION_SEED: &[u8] = b"pass_collection";

/// Pool lifecycle (TECH-ARCH §3.2).
///
/// Phase 0 only ever inspects `Open`. The transitions — `Open` → `Sealed` at the
/// 64th entry, `Sealed` → `Scored` after `commit_results`, and the `Refunding` /
/// `Closed` terminal states — are Phase 1's to implement.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PoolState {
    /// Accepting entries.
    Open,
    /// Full (or past its fill deadline with enough entrants). No further entries;
    /// the pool secret may now be exported and revealed.
    Sealed,
    /// Results committed. Unflagged winners may claim.
    Scored,
    /// Deadline passed below the minimum fill. Entries are refunded in full.
    Refunding,
    /// Terminal.
    Closed,
}

/// A single competition pool.
///
/// **Phase 0 subset — see the module doc.**
#[account]
pub struct Pool {
    /// Monotonic pool identifier. Also the Pool PDA's second seed, little-endian.
    pub id: u64,

    /// Lifecycle state (TECH-ARCH §3.2).
    pub state: PoolState,

    /// Switchboard On-Demand VRF result, committed once by `commit_vrf_seed`.
    ///
    /// Zero-filled at `open_pool` as the "uncommitted" sentinel; `commit_vrf_seed`
    /// enforces write-once against exactly that. This seed is one of five inputs
    /// to the per-entry class digest (TECH-ARCH §4) and **never determines an
    /// outcome on its own** — knowing it in full tells an observer nothing about
    /// any class, because the digest also mixes an execution-time slot hash.
    ///
    /// The class it eventually produces is cosmetic and is read by nothing in the
    /// scoring path (PID §8.4).
    pub vrf_seed: [u8; 32],

    /// Canonical bump for this PDA, stored so PDA-signed CPIs do not have to
    /// re-derive it.
    pub bump: u8,
}

impl Pool {
    /// Account size, excluding Anchor's 8-byte discriminator.
    ///
    /// `id` (8) + `state` (1, single-byte enum discriminant) + `vrf_seed` (32) +
    /// `bump` (1). Phase 1 must revise this as it adds the fields from
    /// TECH-ARCH §3.1.
    pub const LEN: usize = 8 + 1 + 32 + 1;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Distinct seed prefix per PDA type (`docs/reference/threat-tm-401.md`): a
    /// PDA crafted for one type must not satisfy another type's `seeds =`
    /// constraint. With only two prefixes this is close to trivial, but the test
    /// exists so that adding a third prefix without adding it here is visible.
    #[test]
    fn pda_seed_prefixes_are_pairwise_distinct() {
        let prefixes: [&[u8]; 2] = [POOL_SEED, PASS_COLLECTION_SEED];
        for (i, a) in prefixes.iter().enumerate() {
            for b in prefixes.iter().skip(i + 1) {
                assert_ne!(a, b, "seed prefixes {a:?} and {b:?} collide (TM-401)");
            }
        }
    }

    /// The two PDA types must derive distinct addresses even from related inputs.
    #[test]
    fn pool_and_pass_collection_pdas_are_distinct() {
        let pool_id: u64 = 7;
        let pool = Pubkey::find_program_address(&[POOL_SEED, &pool_id.to_le_bytes()], &crate::ID).0;
        let pass_collection =
            Pubkey::find_program_address(&[PASS_COLLECTION_SEED, pool.as_ref()], &crate::ID).0;
        assert_ne!(pool, pass_collection);
    }

    /// The Pool PDA is keyed on the little-endian pool id, so two different pools
    /// can never share an address.
    #[test]
    fn distinct_pool_ids_derive_distinct_pdas() {
        let a = Pubkey::find_program_address(&[POOL_SEED, &0u64.to_le_bytes()], &crate::ID).0;
        let b = Pubkey::find_program_address(&[POOL_SEED, &1u64.to_le_bytes()], &crate::ID).0;
        assert_ne!(a, b);
    }

    /// `Pool::LEN` must match what Borsh actually writes. A stale LEN under-allocates
    /// the account and the write fails at runtime, which is an expensive way to find out.
    #[test]
    fn pool_len_matches_serialized_size() {
        let pool = Pool {
            id: u64::MAX,
            state: PoolState::Open,
            vrf_seed: [0xff; 32],
            bump: 255,
        };
        let mut buf = Vec::new();
        pool.serialize(&mut buf).expect("Pool must serialize");
        assert_eq!(
            buf.len(),
            Pool::LEN,
            "Pool::LEN is stale — update it alongside the struct",
        );
    }
}
