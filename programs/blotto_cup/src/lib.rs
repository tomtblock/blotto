//! Blotto Cup on-chain program.
//!
//! **Phase 0 scaffold.** This program currently exposes only the three
//! instructions carried across from the predecessor repository during extraction:
//! the Switchboard VRF seed commit, and the two halves of the permanently frozen
//! character pass. It is deliberately incomplete — `lib.rs` exposes only what
//! exists, so an absent instruction is an absent instruction rather than a stub
//! that silently succeeds.
//!
//! Phase 1 builds the rest per TECH-ARCH §3.2: `init_config`, `open_pool`,
//! `register`, `reveal_pool_secret`, `commit_results`, `claim`, `flag_entry`,
//! `clear_flag`, `trigger_refund`, `refund`, `sweep_unclaimed`,
//! `rotate_entry_signer` and `pause`.
//!
//! # Two invariants that outrank any instruction added later
//!
//! **The prize vault has no withdraw instruction.** When Phase 1 adds the vault,
//! the only lamport exits are `claim`, `refund` and `sweep_unclaimed`. There is no
//! admin path, no escape hatch, no recover-stuck-funds instruction. An auditor
//! confirms there is no other route (TECH-ARCH §3.2).
//!
//! **There is no instruction that can thaw a character pass.** See `pass.rs`.
//!
//! See `docs/INDEX.md` for the source-of-truth map and `CLAUDE.md` for the full
//! hard-rule list.

// `clippy::diverging_sub_expression` fires on the entry-point glue emitted by
// Anchor 1.0's `#[program]` proc macro. The diagnostic is internal to generated
// code and out of our hands; suppressed at the crate level rather than
// workspace-wide.
#![allow(clippy::diverging_sub_expression)]

use anchor_lang::prelude::*;

pub mod error;
pub mod pass;
pub mod state;
pub mod vrf;

pub use pass::*;
pub use vrf::*;

// Devnet program identity, generated fresh during Phase 0 extraction. The
// predecessor's program ID (57goj6dM…) is NOT reused — see TRANSITION-REPORT.md,
// which also records where this keypair's private half lives (outside this
// repository, and never in it).
declare_id!("4pspHqtbdgqKTvSxvKFT2ycEU28u3EWdxjmj3xsTHD3Y");

#[program]
pub mod blotto_cup {
    use super::*;

    /// Commit the pool's Switchboard On-Demand VRF seed. Write-once, permissionless,
    /// and must be bundled in the same transaction as the Switchboard reveal. See
    /// `vrf.rs` for why this is a separate instruction from `open_pool`.
    pub fn commit_vrf_seed(ctx: Context<CommitVrfSeed>, pool_id: u64) -> Result<()> {
        vrf::handle_commit_vrf_seed(ctx, pool_id)
    }

    /// Create the Metaplex Core Collection that groups a pool's character passes,
    /// with transfer permanently frozen at the Collection level.
    pub fn create_pass_collection(
        ctx: Context<CreatePassCollection>,
        pool_id: u64,
        name: String,
        uri: String,
    ) -> Result<()> {
        pass::handle_create_pass_collection(ctx, pool_id, name, uri)
    }

    /// Mint one player's character pass as a bare member of the frozen Collection,
    /// inheriting its non-transferability. Folds into `register` in Phase 1.
    pub fn mint_pass(ctx: Context<MintPass>, pool_id: u64, class: u8) -> Result<()> {
        pass::handle_mint_pass(ctx, pool_id, class)
    }
}
