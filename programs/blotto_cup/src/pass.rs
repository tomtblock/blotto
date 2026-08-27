//! The character pass — a Metaplex Core Collection whose members are permanently
//! non-transferable, and the bare member mint that inherits that freeze.
//!
//! Carried from the predecessor repository: `create_pass_collection` from
//! its `instructions/create_collection_asset.rs`, and `mint_pass` from the
//! `CreateV2CpiBuilder` section of `instructions/pack_open.rs`.
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
//! to the program's Pool PDA. `mint_pass` then mints each member **bare**, with no
//! member-level plugins, so it inherits the Collection-level freeze.
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
//! # The pass carries no scoring input
//!
//! The class written to the pass is cosmetic and is read by nothing in the scoring
//! path (PID §3, §8.4). `mint_pass` takes it only to put it in the event and,
//! eventually, in the asset's display metadata. Nothing downstream may branch on it.

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
pub(crate) const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// ---------------------------------------------------------------------------
// create_pass_collection
// ---------------------------------------------------------------------------

/// Creates the Core Collection that groups one pool's 64 character passes.
///
/// # Address and authority
/// The Collection asset lives at `[PASS_COLLECTION_SEED, pool.key()]`. Because the
/// address is derivable it is *not* stored on `Pool` — `mint_pass` re-derives it
/// from the same seeds.
///
/// The Collection's update authority is set to the program's `Pool` PDA, never a
/// human. That is the precondition that makes the freeze trustless: only a
/// Pool-PDA-signed CPI could ever mutate the freeze plugin, and this program
/// contains no instruction that does. Note that in `CreateCollectionV2` the
/// `update_authority` account is *not* a signer — it merely designates who the
/// authority becomes — so the `Pool` PDA does not sign here; only the new Collection
/// account (a PDA we own) signs, via `invoke_signed`. The `PermanentFreezeDelegate`'s
/// authority is `UpdateAuthority`, which therefore resolves to that same `Pool` PDA.
///
/// # Permissionless caller, write-once
/// The signer is permissionless: anyone may pay the rent to create the deterministic
/// Collection, because the resulting update authority is fixed regardless of who
/// calls. Write-once is enforced naturally — a second call finds the account already
/// initialized and mpl-core's create CPI rejects it.
#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct CreatePassCollection<'info> {
    /// Pays rent for the new Collection account. Permissionless — no privilege
    /// check; the update authority is fixed to the `Pool` PDA regardless of who signs.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// The pool these passes belong to. Not `mut`: this instruction stores nothing
    /// back on the struct (the Collection address is derivable), it only reads
    /// `state` and is designated as the update authority.
    #[account(
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: The Core Collection asset address, derived as `[PASS_COLLECTION_SEED,
    /// pool.key()]`. Passed in uninitialized (system-owned, empty); the mpl-core
    /// program initializes it during the PDA-signed `CreateCollectionV2` CPI below.
    /// Anchor validates only that the supplied address matches the derivation; its
    /// contents and post-create owner (the mpl-core program) are the CPI's
    /// responsibility. A second call finds this account already initialized, so the
    /// create CPI fails — the write-once guard.
    #[account(
        mut,
        seeds = [PASS_COLLECTION_SEED, pool.key().as_ref()],
        bump,
    )]
    pub pass_collection: UncheckedAccount<'info>,

    /// CHECK: The Metaplex Core program. Validated by the `address` constraint
    /// against the hardcoded program ID; used only as the CPI target.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_pass_collection(
    ctx: Context<CreatePassCollection>,
    _pool_id: u64,
    name: String,
    uri: String,
) -> Result<()> {
    // 1. State guard. Only an Open pool may have its pass Collection created; a
    //    sealed or closed pool is past the point where this matters, and we reject
    //    rather than create orphaned on-chain state.
    require!(
        ctx.accounts.pool.state == PoolState::Open,
        ErrorCode::PoolNotOpen
    );

    // Capture the pool key and the Collection PDA bump before borrowing account
    // infos for the CPI. The signer seeds reproduce the `pass_collection` PDA — that
    // is the account `CreateCollectionV2` requires to sign (it is the new account
    // being created), and we own its seeds, so `invoke_signed` provides its
    // signature. (`update_authority` is a non-signer account here, so the `Pool` PDA
    // does not sign.)
    let pool_key = ctx.accounts.pool.key();
    let pass_collection_bump = ctx.bumps.pass_collection;

    // Bind owned `AccountInfo`s so the builder's borrows outlive the call.
    let mpl_core_program = ctx.accounts.mpl_core_program.to_account_info();
    let pass_collection = ctx.accounts.pass_collection.to_account_info();
    let update_authority = ctx.accounts.pool.to_account_info();
    let payer = ctx.accounts.signer.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();

    // 2. Create the Collection via mpl-core CPI, PDA-signed.
    //    - collection account = the `pass_collection` PDA (signed below)
    //    - update authority   = the `Pool` PDA (program-controlled)
    //    - payer              = the permissionless signer
    //    - plugins            = one `PermanentFreezeDelegate { frozen: true }` at the
    //                           Collection level. Its authority is
    //                           `PluginAuthority::UpdateAuthority`, resolving to the
    //                           `Pool` PDA — so only a Pool-PDA-signed CPI could ever
    //                           thaw it, and THIS PROGRAM HAS NO SUCH INSTRUCTION.
    //                           The Collection-level freeze propagates to member
    //                           Assets (verified on devnet — see
    //                           docs/reference/q-016-verification-note.md), so members
    //                           are non-transferable without any per-asset plugin.
    //
    // mpl-core 0.12.0, pinned in Cargo.toml. The plugins argument is
    // `Vec<PluginAuthorityPair>`; each pair wraps a `Plugin` variant and an optional
    // `PluginAuthority`.
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

    // 3. Emit for the off-chain indexer and audit replay.
    emit!(PassCollectionCreated {
        pool: pool_key,
        pass_collection: ctx.accounts.pass_collection.key(),
        name,
        uri,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// mint_pass
// ---------------------------------------------------------------------------

/// Mints one player's character pass as a bare member of the pool's frozen
/// Collection.
///
/// In Phase 1 this becomes part of `register` rather than a standalone instruction —
/// a pass is minted as a side effect of paying an entry, never on its own. It is
/// carried separately here so the freeze mechanism can be tested in isolation before
/// `register` exists, and so `tests/pass.ts` can assert the negative case (that a
/// minted pass cannot be transferred) without a full pool.
#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct MintPass<'info> {
    /// The player receiving the pass. Pays rent and becomes the asset owner.
    ///
    /// The pass is **non-transferable for the life of the asset**, so "owner" here
    /// means the wallet it is permanently attached to, not a holder who can sell it.
    #[account(mut)]
    pub player: Signer<'info>,

    /// The pool this pass belongs to. Signs the mint CPI as the Collection's update
    /// authority.
    #[account(
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// The Core member asset. A fresh, system-owned account the caller generates per
    /// entry — it must **sign** (`CreateV2` requires the new asset account to sign)
    /// and is `mut` because mpl-core initializes it. Not a PDA, so the signature
    /// comes from the outer transaction rather than `invoke_signed`.
    #[account(mut)]
    pub pass_asset: Signer<'info>,

    /// CHECK: the program-owned Core Collection that members are minted into, derived
    /// as `[PASS_COLLECTION_SEED, pool.key()]` — the same seeds
    /// `create_pass_collection` creates it under. `mut` because the member mint
    /// rewrites its registry. The address is checked against the derivation;
    /// contents and owner are the mpl-core CPI's responsibility. Must already exist,
    /// or the `CreateV2` CPI fails.
    #[account(
        mut,
        seeds = [PASS_COLLECTION_SEED, pool.key().as_ref()],
        bump,
    )]
    pub pass_collection: UncheckedAccount<'info>,

    /// CHECK: the Metaplex Core program, validated by `address` against the
    /// hardcoded program ID. CPI target for the member mint.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_mint_pass(ctx: Context<MintPass>, pool_id: u64, class: u8) -> Result<()> {
    // 1. State guard — passes are minted only while the pool is accepting entries.
    require!(
        ctx.accounts.pool.state == PoolState::Open,
        ErrorCode::PoolNotOpen
    );

    // 2. The class must have been drawn from committed randomness. In Phase 1
    //    `register` derives the class inline from `Pool.vrf_seed` and cannot reach
    //    this point without one; here, where `class` is a parameter, the guard is
    //    what stops a pass being minted against an uncommitted (zero) seed.
    require!(
        ctx.accounts.pool.vrf_seed != [0u8; 32],
        ErrorCode::VrfSeedNotCommitted
    );

    // 3. Mint the Core member into the frozen `pass_collection`. PDA-signed by the
    //    `Pool` PDA, which is the Collection's update authority (set in
    //    `create_pass_collection`) and therefore the `authority` that may add a
    //    member.
    //
    //    THE MEMBER IS MINTED BARE — no member plugins — so it inherits the
    //    Collection-level `PermanentFreezeDelegate` and is non-transferable. We do
    //    NOT and must NOT attach a member plugin here or via a later `AddPlugin`:
    //    that path panics in mpl-core 1.10 (see the module doc). `name`/`uri` are
    //    empty placeholders — program-controlled, not caller-supplied; the display
    //    metadata scheme is a later phase. `update_authority` is left unset so the
    //    member inherits the Collection's (the `Pool` PDA). Bind owned
    //    `AccountInfo`s first so the builder's borrows outlive the call.
    let pool_bump = ctx.accounts.pool.bump;

    let mpl_core_program = ctx.accounts.mpl_core_program.to_account_info();
    let pass_asset = ctx.accounts.pass_asset.to_account_info();
    let pass_collection = ctx.accounts.pass_collection.to_account_info();
    let pool_authority = ctx.accounts.pool.to_account_info();
    let player = ctx.accounts.player.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();

    CreateV2CpiBuilder::new(&mpl_core_program)
        .asset(&pass_asset)
        .collection(Some(&pass_collection))
        .authority(Some(&pool_authority))
        .payer(&player)
        .owner(Some(&player))
        .system_program(&system_program)
        .name(String::new())
        .uri(String::new())
        .invoke_signed(&[&[POOL_SEED, &pool_id.to_le_bytes(), &[pool_bump]]])?;

    emit!(PassMinted {
        pool: ctx.accounts.pool.key(),
        player: ctx.accounts.player.key(),
        pass_asset: ctx.accounts.pass_asset.key(),
        class,
    });

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

/// Emitted once per character pass minted.
#[event]
pub struct PassMinted {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub pass_asset: Pubkey,
    /// The cosmetic class index (PID §3). Carried in the event for display and for
    /// audit replay against the published class table. **Read by nothing in the
    /// scoring path** (PID §8.4).
    pub class: u8,
}
