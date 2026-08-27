//! `commit_vrf_seed` — write the committed Switchboard On-Demand VRF seed into the
//! Pool account (TECH-ARCH §4).
//!
//! Carried from the predecessor repository's `commit_vrf_seed.rs` instruction.
//! `Collection` becomes `Pool` throughout; the write-once guard, the owner check
//! and the same-slot reveal constraint are carried unchanged.
//!
//! # Background — why this is its own instruction
//! `open_pool` zero-fills `Pool.vrf_seed` as a placeholder. Switchboard On-Demand
//! is a commit/reveal oracle, not a single-transaction callback: randomness is
//! requested, an oracle reveals it a few slots later, and the consuming program
//! reads the revealed value. **There is no single transaction that both requests
//! and consumes randomness**, so the seed commit lives in a dedicated instruction
//! rather than growing `open_pool`.
//!
//! This matters because TECH-ARCH §3.2 lists the VRF request as part of
//! `open_pool`. The *request* can indeed live there; the *commit* cannot. Phase 1
//! decides whether to merge the two — it may fold the request into `open_pool` and
//! keep this instruction separate, which is the shape the old repo settled on
//! after hitting exactly this constraint.
//!
//! Flow (off-chain → on-chain):
//!   1. `open_pool` → `Pool.vrf_seed == [0u8; 32]`.
//!   2. off-chain: create a Switchboard On-Demand Randomness account, commit, reveal.
//!   3. `commit_vrf_seed` → read the revealed Randomness account, copy its 32 bytes
//!      into `Pool.vrf_seed`.
//!
//! # Write-once
//! Callable exactly once per pool: the handler rejects if `vrf_seed` is already
//! non-zero. The commit is permissionless on the signer — anyone may land it once a
//! valid reveal exists. Switchboard's reveal is the trust anchor; the protocol
//! merely copies the bytes. The per-entry class digest later combines this seed
//! with a delayed slot hash, the entry index, the pool pubkey and the player's
//! pubkey (TECH-ARCH §4); **the committed seed alone never determines an outcome.**
//!
//! # Same-slot reveal+consume constraint (Switchboard On-Demand)
//! `RandomnessAccountData::get_value(slot)` returns the revealed value only when the
//! supplied slot equals the account's `reveal_slot` — the value is readable only in
//! the same slot the oracle revealed it. In practice the caller bundles the
//! Switchboard `reveal` instruction and this `commit_vrf_seed` instruction in one
//! transaction so that `Clock::slot == reveal_slot` holds. If the reveal never lands
//! (`docs/reference/threat-tm-502.md`), `get_value` errors and the whole transaction
//! reverts atomically — no half-committed seed.
//!
//! # Residual risk — no payload binding (TM-502)
//! Switchboard On-Demand Randomness is not bound to an application payload: the
//! revealed 32 bytes carry no commitment to *this* pool. A motivated caller could
//! substitute a *different* validly-revealed Randomness account at commit time. The
//! damage is bounded — the substitute value is still oracle-produced randomness the
//! caller cannot choose, only swap — so the bag-without-replacement class structure
//! holds and no chosen class can be forced. The seed is also combined with
//! execution-time slot hashes, so even full knowledge of the committed seed does not
//! make per-entry class outcomes predictable.
//!
//! **And in this product the residual risk is smaller than it was in the old one.**
//! There, the seed fed a rarity draw that determined an asset's resale value. Here it
//! feeds a draw that is **cosmetic and read by nothing in the scoring path** (PID
//! §8.4): swapping the seed changes which player gets the Titan artwork and changes
//! nothing about who wins money. Scoring depends only on the sealed allocations.
//!
//! TODO(TM-502): if Switchboard On-Demand later exposes commit-to-payload binding,
//! bind the Randomness account to `pool` here and drop this residual risk.

use anchor_lang::prelude::*;
use switchboard_on_demand::accounts::RandomnessAccountData;

use crate::error::ErrorCode;
use crate::state::{Pool, POOL_SEED};

/// Switchboard On-Demand program IDs (source: switchboard-xyz/solana-sdk
/// `src/program_id.rs`, constants `ON_DEMAND_MAINNET_PID` / `ON_DEMAND_DEVNET_PID`).
/// Hardcoded here rather than imported from the SDK, because the SDK constants live
/// behind the `anchor` feature we deliberately do not enable (it would pin a
/// conflicting anchor-lang / Solana v2 — see `Cargo.toml`). Both clusters are
/// accepted: the resolved program ID depends on the deploy target, which is not
/// known at compile time on-chain.
const SB_ON_DEMAND_MAINNET_PID: Pubkey = pubkey!("SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv");
const SB_ON_DEMAND_DEVNET_PID: Pubkey = pubkey!("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct CommitVrfSeed<'info> {
    /// Pool whose VRF seed is being committed. The canonical bump is derived from
    /// seeds (`bump` with no `= expr`).
    ///
    /// The predecessor bound this account with `has_one = mint`, tying the
    /// Collection PDA to a launch-token mint. **That binding is not carried**: a Pool
    /// has no mint. The PDA is keyed on the pool id instead, which is the
    /// discriminator that actually identifies a pool.
    #[account(
        mut,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: Switchboard On-Demand Randomness PDA, owned by the Switchboard program.
    /// Not an Anchor account; validated entirely in the handler — the owner is checked
    /// against the Switchboard On-Demand program ID, the data is deserialized via the
    /// Switchboard SDK (`RandomnessAccountData::parse`, which verifies the account
    /// discriminator and size), and `get_value` confirms the reveal has landed at the
    /// current slot.
    pub randomness_account: UncheckedAccount<'info>,

    /// Permissionless: any signer may land the commit once a valid reveal exists.
    /// There is no privilege check on the signer — Switchboard's reveal is the trust
    /// anchor.
    pub signer: Signer<'info>,
}

pub fn handle_commit_vrf_seed(ctx: Context<CommitVrfSeed>, _pool_id: u64) -> Result<()> {
    // 1. Write-once. Reject if a seed is already committed. The zero-filled
    //    placeholder written by `open_pool` is the "uncommitted" sentinel. This runs
    //    first so a second commit fails cheaply, before touching the oracle account.
    require!(
        ctx.accounts.pool.vrf_seed == [0u8; 32],
        ErrorCode::VrfSeedAlreadyCommitted
    );

    // 2. Validate the Randomness account owner (TM-502). Accept either cluster's
    //    Switchboard On-Demand program ID. `AccountInfo::owner` is `&Pubkey`.
    require!(
        ctx.accounts.randomness_account.owner == &SB_ON_DEMAND_MAINNET_PID
            || ctx.accounts.randomness_account.owner == &SB_ON_DEMAND_DEVNET_PID,
        ErrorCode::InvalidRandomnessAccount
    );

    // 3 + 4. Deserialize via the Switchboard SDK and read the revealed value. `parse`
    //    verifies the account discriminator and size; `get_value(slot)` returns the
    //    32-byte revealed value only when the current slot matches the account's
    //    reveal slot — otherwise the reveal has not landed (or this tx is not bundled
    //    with it) and we reject. The borrow is scoped so it is released before we
    //    mutate the pool. `seed` is a `[u8; 32]` copy, so nothing outlives the borrow.
    let clock = Clock::get()?;
    let seed = {
        let data = ctx.accounts.randomness_account.data.borrow();
        let randomness =
            RandomnessAccountData::parse(data).map_err(|_| ErrorCode::InvalidRandomnessAccount)?;
        randomness
            .get_value(clock.slot)
            .map_err(|_| ErrorCode::RandomnessNotResolved)?
    };

    // 5. Copy the revealed bytes into the Pool. A revealed value of 32 zero bytes is
    //    cryptographically impossible (2^-256), so it cannot collide with the
    //    uncommitted sentinel and re-open the write-once guard.
    ctx.accounts.pool.vrf_seed = seed;

    emit!(PoolVrfSeeded {
        pool: ctx.accounts.pool.key(),
        randomness_account: ctx.accounts.randomness_account.key(),
        vrf_seed: seed,
        slot: clock.slot,
    });

    Ok(())
}

/// Emitted once per pool when its VRF seed is committed, for the off-chain indexer
/// and for audit replay.
///
/// Renamed from the predecessor's `VrfSeedCommitted`. Every input needed to
/// recompute a class draw reaches the log (TECH-ARCH §3.3): this event carries the
/// seed, and `EntryRegistered` carries the entry index and slot hash.
#[event]
pub struct PoolVrfSeeded {
    pub pool: Pubkey,
    pub randomness_account: Pubkey,
    pub vrf_seed: [u8; 32],
    pub slot: u64,
}
