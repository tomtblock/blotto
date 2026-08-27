//! The character pass — a Metaplex Core Collection whose members are permanently
//! non-transferable, and the bare member mint that inherits that freeze.
//!
//! Carried from the predecessor repository in Phase 0 (`create_pass_collection`
//! from its collection-creation instruction; the bare-mint section of its open
//! flow). In Phase 1 the standalone mint instruction is gone: a pass is minted
//! only as a side effect of paying an entry, inside `register` — there is no
//! way to mint one on its own. The CPI lives here as [`mint_pass_cpi`] so the
//! freeze mechanism stays in one reviewed place.
//!
//! # There is no thaw path, and that is the point
//!
//! **There is no instruction in this program that can set `frozen: false`. Adding
//! one is a legal-position change (PID §8.4) and requires counsel sign-off.**
//!
//! The old repository *did* have one: a single `UpdateCollectionPluginV1` CPI that
//! thawed a whole collection once it reached the end of its launch lifecycle, so its
//! NFTs could be listed and traded. That instruction is deliberately **not carried**,
//! and neither is any part of the decision record that adopted it
//! (`docs/reference/adr-027-collection-freeze-propagation.md` carries the propagation
//! finding and explicitly drops the unfreeze half).
//!
//! The reason is the product's legal characterisation. PID §8.2 splits Blotto Cup
//! into two legs, and the pass-purchase leg passes the three-element test only
//! because the pass is a **prize of no value**: soulbound, cosmetic, no market, no
//! competitive effect. A pass that can be thawed has a resale market, and a pass
//! with a resale market is a thing of value obtained partly by chance for
//! consideration. The freeze is not a UX decision; it is the load-bearing fact.
//!
//! Two greps should return nothing in this program, forever: `frozen: false` and
//! `UpdateCollectionPluginV1`.
//!
//! # How the freeze works
//!
//! `create_pass_collection` attaches a `PermanentFreezeDelegate { frozen: true }`
//! at the **Collection** level, with authority `UpdateAuthority` — which resolves
//! to the program's Pool PDA. [`mint_pass_cpi`] then mints each member **bare**,
//! with no member-level plugins, so it inherits the Collection-level freeze.
//!
//! This was verified empirically on devnet before the old repo relied on it; the
//! run is carried at `docs/reference/q-016-verification-note.md`. Two findings from
//! it matter to anyone writing tests here:
//!
//! - A frozen-member transfer fails with **`InvalidAuthority` (`0x9`)**, not
//!   `AssetIsFrozen` (`0xa`) — the freeze plugin force-rejects inside the lifecycle
//!   validator. Test code must match on `0x9` plus the
//!   `permanent_freeze_delegate…Reject` log line.
//! - The freeze holds against **transfer delegates**, not only owners. A member
//!   minted with a legitimately granted `TransferDelegate` still could not be moved
//!   by that delegate. So the mint does not need to defensively block per-asset
//!   delegates for freeze integrity.
//!
//! # Why the member is minted bare (carried verbatim — this comment is load-bearing)
//!
//! In mpl-core 1.10 a follow-up `AddPlugin` against a collection member **panics
//! ~3.5k CU in, before any lifecycle check** (`utils/mod.rs:31`). Any member plugin
//! must therefore be attached at `CreateV2` time. Minting bare sidesteps the trap
//! entirely and is what makes the inherited Collection-level freeze the whole
//! mechanism. Do not add a member plugin here, and do not add one in a follow-up
//! instruction. The old repo tracked this as IPC-003.
//!
//! # Pass metadata (roadmap R12)
//!
//! Launch passes are typographic: the on-chain `name` is `"BLOTTO PASS #<pool>-<index>"`
//! and the `uri` is empty at mint. The per-pass seed R12 bakes into metadata is the
//! class digest already emitted in `EntryRegistered` — unique per pass, on-chain
//! from day one, so the later illustrated-art upgrade is a URI update by the
//! collection authority (the Pool PDA), never a program change. NOTE: no URI-update
//! instruction exists yet either; adding one touches nothing about the freeze but
//! is deliberately deferred until R12's art upgrade is scheduled.

use anchor_lang::prelude::*;
use mpl_core::instructions::{CreateCollectionV2CpiBuilder, CreateV2CpiBuilder};
use mpl_core::types::{PermanentFreezeDelegate, Plugin, PluginAuthority, PluginAuthorityPair};

use crate::error::ErrorCode;
use crate::state::{Pool, PoolState, PASS_COLLECTION_SEED, POOL_SEED};

/// Metaplex Core program ID (`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`).
/// Identical on devnet and mainnet (source:
/// `docs/reference/q-016-verification-note.md`; also exported as `mpl_core::ID`).
/// Hardcoded so the `address =` constraint does not depend on a cross-crate
/// `Pubkey` reaching through the mpl-core facade.
pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// ---------------------------------------------------------------------------
// create_pass_collection
// ---------------------------------------------------------------------------

/// Creates the Core Collection that groups one pool's 64 character passes.
///
/// The Collection's update authority is set to the program's `Pool` PDA, never a
/// human. That is the precondition that makes the freeze trustless: only a
/// Pool-PDA-signed CPI could ever mutate the freeze plugin, and this program
/// contains no instruction that does. In `CreateCollectionV2` the
/// `update_authority` account is *not* a signer — it merely designates who the
/// authority becomes — so the `Pool` PDA does not sign here; only the new
/// Collection account (a PDA we own) signs, via `invoke_signed`.
///
/// Permissionless and write-once: anyone may pay the rent (the settlement crank
/// does, right after `open_pool`), and a second call finds the account already
/// initialized so the create CPI rejects it.
#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct CreatePassCollection<'info> {
    /// Pays rent for the new Collection account. Permissionless — the update
    /// authority is fixed to the `Pool` PDA regardless of who signs.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// The pool these passes belong to. Not `mut`: only `state` is read.
    #[account(
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: The Core Collection asset address, derived as `[PASS_COLLECTION_SEED,
    /// pool.key()]`. Passed in uninitialized; the mpl-core program initializes it
    /// during the PDA-signed CPI. A second call finds it initialized — the
    /// write-once guard.
    #[account(
        mut,
        seeds = [PASS_COLLECTION_SEED, pool.key().as_ref()],
        bump,
    )]
    pub pass_collection: UncheckedAccount<'info>,

    /// CHECK: The Metaplex Core program, pinned by address.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_pass_collection(
    ctx: Context<CreatePassCollection>,
    _pool_id: u64,
) -> Result<()> {
    require!(
        ctx.accounts.pool.state == PoolState::Open,
        ErrorCode::PoolNotOpen
    );

    // INTERNAL-REVIEW (Phase 5, finding IR-1): the metadata is DERIVED, not
    // caller-supplied. This instruction is deliberately permissionless (any
    // payer), so accepting a name/uri from the caller would let a griefer
    // front-run the settlement crank and label a pool's collection with
    // arbitrary text. The name is fixed per pool; the uri starts empty (R12
    // typographic launch) and only a later, counsel-gated instruction could
    // ever set one.
    let name = format!("BLOTTO PASS COLLECTION #{}", ctx.accounts.pool.id);
    let uri = String::new();

    let pool_key = ctx.accounts.pool.key();
    let pass_collection_bump = ctx.bumps.pass_collection;

    let mpl_core_program = ctx.accounts.mpl_core_program.to_account_info();
    let pass_collection = ctx.accounts.pass_collection.to_account_info();
    let update_authority = ctx.accounts.pool.to_account_info();
    let payer = ctx.accounts.signer.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();

    // One PermanentFreezeDelegate { frozen: true } at the Collection level, its
    // authority UpdateAuthority — resolving to the Pool PDA, which no human
    // holds and no instruction lets thaw. See the module doc.
    let freeze_plugin = PluginAuthorityPair {
        plugin: Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: true }),
        authority: Some(PluginAuthority::UpdateAuthority),
    };

    CreateCollectionV2CpiBuilder::new(&mpl_core_program)
        .collection(&pass_collection)
        .update_authority(Some(&update_authority))
        .payer(&payer)
        .system_program(&system_program)
        .name(name.clone())
        .uri(uri.clone())
        .plugins(vec![freeze_plugin])
        .invoke_signed(&[&[
            PASS_COLLECTION_SEED,
            pool_key.as_ref(),
            &[pass_collection_bump],
        ]])?;

    emit!(PassCollectionCreated {
        pool: pool_key,
        pass_collection: ctx.accounts.pass_collection.key(),
        name,
        uri,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// The bare member mint — called from `register`, nowhere else
// ---------------------------------------------------------------------------

/// Mint one player's character pass as a bare member of the pool's frozen
/// Collection. PDA-signed by the `Pool` PDA (the Collection's update authority).
///
/// THE MEMBER IS MINTED BARE — no member plugins — so it inherits the
/// Collection-level `PermanentFreezeDelegate` and is non-transferable for the
/// life of the asset. We do NOT and must NOT attach a member plugin here or via
/// a later `AddPlugin`: that path panics in mpl-core 1.10 (module doc).
#[allow(clippy::too_many_arguments)]
pub(crate) fn mint_pass_cpi<'info>(
    mpl_core_program: &AccountInfo<'info>,
    pass_asset: &AccountInfo<'info>,
    pass_collection: &AccountInfo<'info>,
    pool_authority: &AccountInfo<'info>,
    player: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    pool_id: u64,
    pool_bump: u8,
    name: String,
) -> Result<()> {
    let id_bytes = pool_id.to_le_bytes();
    CreateV2CpiBuilder::new(mpl_core_program)
        .asset(pass_asset)
        .collection(Some(pass_collection))
        .authority(Some(pool_authority))
        .payer(player)
        .owner(Some(player))
        .system_program(system_program)
        .name(name)
        .uri(String::new())
        .invoke_signed(&[&[POOL_SEED, &id_bytes, &[pool_bump]]])?;
    Ok(())
}

/// Emitted once per pool when its pass Collection is created.
#[event]
pub struct PassCollectionCreated {
    pub pool: Pubkey,
    pub pass_collection: Pubkey,
    /// Declared after the fixed-size `Pubkey`s so those sit at stable byte offsets
    /// for a hand-written off-chain Borsh decoder.
    pub name: String,
    pub uri: String,
}
