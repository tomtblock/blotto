//! Admin instructions (roadmap 1.1). Admin = the Squads vault (R21) — every
//! instruction here requires its signature via `has_one = admin`, so a
//! non-admin signer fails Anchor's `ConstraintHasOne` before any handler runs.
//!
//! Since D-A1 (revised) the revenue and forfeit destination is the
//! program-held platform treasury PDA, not an operator wallet — so there is
//! nothing to re-point and no `set_platform_wallet` exists. The treasury's
//! own admin setters (`set_tier_economics`, `set_treasury_policy`,
//! `withdraw_platform`) live in `instructions/treasury.rs`.

use anchor_lang::prelude::*;

use crate::constants::{
    DEFAULT_COOLDOWN_SECS, DEFAULT_FILL_DEADLINE_SECS, N_TIERS, TIER_ENTRY_LAMPORTS,
    TIER_POT_LAMPORTS,
};
use crate::error::ErrorCode;
use crate::events::{HardTiersOpened, KeeperSet, PoolTimingSet, TiersOpened};
use crate::state::{Config, CONFIG_SEED, PLATFORM_SEED};

// ---------------------------------------------------------------------------
// init_config
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitConfig<'info> {
    /// The program's UPGRADE AUTHORITY — the only key that may initialise
    /// Config (scanner triage 2026-10-11, item A). It pays the rent; it does
    /// not become the admin, which is the `admin` argument.
    ///
    /// Until then the signer simply BECAME `Config.admin`. `Config` sits at a
    /// fixed PDA, so on a fresh deployment whoever landed `init_config` first
    /// — in the window between the program going live and our own
    /// transaction — would have owned the keeper, both signers and
    /// `withdraw_platform`. Devnet was initialised long before this by the
    /// Squads vault; the gap was a mainnet one.
    #[account(mut)]
    pub deployer: Signer<'info>,

    #[account(
        init,
        payer = deployer,
        space = Config::SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: The platform treasury PDA — passed so its canonical bump is
    /// derived and captured once, here. The account itself stays a
    /// zero-data system account funded lazily by the first deposit.
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,

    /// This program. `Program<BlottoCup>` pins the address to `crate::ID`;
    /// read only to find its ProgramData account.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ ErrorCode::NotUpgradeAuthority
    )]
    pub program: Program<'info, crate::program::BlottoCup>,

    /// The upgradeable loader's record of this program (`Account` checks its
    /// owner is that loader). Its upgrade authority must be the signer, so a
    /// program deployed with no authority can never be initialised: deploy
    /// upgradeable, initialise, then move or burn the authority. Anchor's own
    /// documented pattern (`anchor-lang` 1.0.2, `src/accounts/account.rs`).
    // PHASE-N-REVIEW: the two typed loader reads cost ~64 KB of program size (measured: 661,656 ->
    // 725,704 bytes, bincode); hand-parsing the 45-byte header would avoid it, but correctness and a
    // reviewable standard form outrank rent (CLAUDE.md tradeoff order), so the standard form stays.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(deployer.key())
            @ ErrorCode::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

/// One-time global setup. `init` makes it write-once: a second call finds the
/// PDA initialized and reverts.
///
/// Launch policy baked in rather than parameterized (each traces to a register
/// row): only the 0.1 SOL tier open (R6), not paused, detection full-escrow
/// switch off (R11), KYC-at-claim switch off (R3), tier prices and pots from
/// the published launch constants (D-A1 revised: founder-changeable later via
/// `set_tier_economics`), treasury reserve of ONE further pot per idle enabled
/// tier (v2 default). The founder-owned numbers that may legitimately differ
/// per deploy — the admin, signers, ceilings, the treasury's minimum balance
/// — are arguments.
pub fn handle_init_config(
    ctx: Context<InitConfig>,
    admin: Pubkey,
    entry_signer: Pubkey,
    settlement_signer: Pubkey,
    keeper: Pubkey,
    vault_ceiling_lamports: [u64; N_TIERS],
    treasury_min_platform_lamports: u64,
) -> Result<()> {
    // A zero admin would leave every admin instruction unsignable for good:
    // Config is write-once and nothing rotates the admin. Refuse it here
    // rather than discover it after the deployment is live.
    require!(admin != Pubkey::default(), ErrorCode::AdminMustNotBeZero);
    let config = &mut ctx.accounts.config;
    config.admin = admin;
    config.entry_signer = entry_signer;
    config.settlement_signer = settlement_signer;
    // Prompt v2 §A: the keeper opens pools; the multisig controls WHO opens
    // pools by holding this rotation, not by signing every open.
    config.keeper = keeper;
    // Prompt v2 §B.5, founder ruling 2026-09-07: 12 h to fill, 5 min between
    // a tier's pools. Config state so a later change is one admin
    // transaction; copied onto each pool at open so it never moves a
    // deadline players entered under.
    config.fill_deadline_seconds = DEFAULT_FILL_DEADLINE_SECS;
    config.cooldown_seconds = DEFAULT_COOLDOWN_SECS;
    config.paused = false;
    // R6 as amended by D1: seven tiers configured; open at launch: 0.1
    // ONLY. Written out, not computed, so the launch policy is readable.
    config.open_tiers = [true, false, false, false, false, false, false];
    // Every tier's liveness clock starts NOW, not at the epoch. The
    // permissionless liveness fallback this field once governed is gone —
    // `open_pool` is keeper-only — so all the clock now decides is the
    // per-tier cooldown between opens, and starting it at `now` lets the
    // keeper open a tier's first pool immediately (`now >= now`). At `0` it
    // would mean the same thing today; `now` is written because the field's
    // meaning is "the earliest this tier may open again" and the epoch is not
    // that.
    let now = Clock::get()?.unix_timestamp;
    config.tier_next_open_at = [now; N_TIERS];
    config.vault_ceiling_lamports = vault_ceiling_lamports;
    // D-A1 revised: prices and pots are Config state, seeded from the launch
    // constants; `set_tier_economics` changes them later (never an open pool).
    config.tier_price_lamports = TIER_ENTRY_LAMPORTS;
    config.tier_pot_lamports = TIER_POT_LAMPORTS;
    // Treasury policy defaults (v2): one further pot per idle enabled tier.
    config.treasury_reserve_pots = 1;
    config.treasury_min_platform_lamports = treasury_min_platform_lamports;
    config.platform_reserved = 0;
    config.platform_refundable = 0;
    // R3: the KYC-at-claim switch starts off at launch (0 = off).
    config.kyc_required_above_lamports = 0;
    // R11: full escrow tier behind an admin switch, off at launch. The
    // baseline hard blocks (exact-duplicate sets, same-device multi-entry)
    // are `flag_entry` calls by the detection layer, not this switch.
    config.detection_hard_block = false;
    // Pool ids start at 1: 0 is `active_pool_by_tier`'s "none" sentinel.
    config.next_pool_id = 1;
    config.active_pool_by_tier = [0; N_TIERS];
    // Phase B (2026-09-24): the hard ladder starts fully disabled — a hard
    // tier opens only by an explicit `set_hard_open_tiers`, after the
    // offline evidence run the founder gated it on. Its clocks start now for
    // the same reason the easy ones do.
    config.hard_open_tiers = [false; N_TIERS];
    config.hard_active_pool_by_tier = [0; N_TIERS];
    config.hard_tier_next_open_at = [now; N_TIERS];
    config.bump = ctx.bumps.config;
    config.platform_bump = ctx.bumps.platform;
    Ok(())
}

// ---------------------------------------------------------------------------
// The shared admin-only context
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    /// Must equal `Config.admin` (the Squads vault) — `has_one` enforces it.
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin,
    )]
    pub config: Box<Account<'info, Config>>,
}

/// Kill switch: blocks `register` (and only `register` — reveal, payout and
/// refund keep working so paused never strands funds).
pub fn handle_set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

/// Rotate the Turnkey-custodied packet signer (TECH-ARCH §8). Old packets die
/// instantly: `register` binds against the CURRENT value.
pub fn handle_rotate_entry_signer(ctx: Context<AdminOnly>, new_signer: Pubkey) -> Result<()> {
    ctx.accounts.config.entry_signer = new_signer;
    Ok(())
}

/// Rotate the settlement signer (reveal/commit/pay/flag/release/pay_next_place).
pub fn handle_set_settlement_signer(ctx: Context<AdminOnly>, new_signer: Pubkey) -> Result<()> {
    ctx.accounts.config.settlement_signer = new_signer;
    Ok(())
}

/// Rotate the keeper — the ONLY key `open_pool` accepts (prompt v2 §A.1, as
/// amended 2026-09-07: the liveness fallback is gone). Emits `KeeperSet` so
/// the ledger records who may open pools, the way `TiersOpened` records
/// which tiers.
///
/// The zero key is refused (audit A7). It is a typo, not a policy: with the
/// fallback removed there is no longer a 24-hour self-heal behind it, so a
/// keeper nobody holds would freeze every tier's next open until an admin
/// noticed and rotated it. Cheap to refuse, tedious to diagnose.
pub fn handle_set_keeper(ctx: Context<AdminOnly>, new_keeper: Pubkey) -> Result<()> {
    require!(
        new_keeper != Pubkey::default(),
        ErrorCode::KeeperMustNotBeZero
    );
    ctx.accounts.config.keeper = new_keeper;
    emit!(KeeperSet { keeper: new_keeper });
    Ok(())
}

/// The fill deadline applied to pools opened from now on, and the per-tier
/// cooldown (prompt v2 §B.5). Both founder-owned numbers (12 h and 5 min at
/// launch — ruling 2026-09-07); both must be positive. A change never
/// touches an open pool: every pool copies its deadline at open, and a
/// tier's `tier_next_open_at` was stamped with the cooldown in force when
/// its slot freed.
pub fn handle_set_pool_timing(
    ctx: Context<AdminOnly>,
    fill_deadline_seconds: i64,
    cooldown_seconds: i64,
) -> Result<()> {
    require!(
        fill_deadline_seconds > 0 && cooldown_seconds > 0,
        ErrorCode::InvalidTiming
    );
    ctx.accounts.config.fill_deadline_seconds = fill_deadline_seconds;
    ctx.accounts.config.cooldown_seconds = cooldown_seconds;
    emit!(PoolTimingSet {
        fill_deadline_seconds,
        cooldown_seconds,
    });
    Ok(())
}

/// Which tiers may open pools (R6: 0.5 opens only after audit + one counsel
/// opinion; higher tiers only by explicit founder decision). Emits
/// `TiersOpened` so the events ledger — and the treasury report replayed
/// from it — knows enablement, not just the keeper reading live Config.
///
/// # Starting the liveness clock (security fix, 2026-09-07)
///
/// Enabling a tier restamps its cooldown clock: any tier this call takes
/// from disabled to enabled gets `tier_next_open_at = max(stamp, now)`.
///
/// `max` is the whole point — a tier disabled and re-enabled inside its
/// cooldown does not get a shorter one — and stamping `now` over a stale
/// value keeps the app's published "next pool opens in" instant meaningful
/// rather than months in the past.
///
/// It carried a SECURITY role until 2026-09-07, when the same field was also
/// the origin of `open_pool`'s liveness fallback and a stale stamp meant any
/// signer could open a newly enabled tier's first pool. The founder ruling of
/// that date removed the fallback outright (audit O9b), so `open_pool` is
/// keeper-only and a stale stamp now means only "the keeper may open at
/// once", which is correct. See `open_pool.rs`.
pub fn handle_set_open_tiers(ctx: Context<AdminOnly>, open_tiers: [bool; N_TIERS]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    for (tier, &enabled) in open_tiers.iter().enumerate() {
        let was_enabled = config.open_tiers[tier];
        if enabled && !was_enabled {
            config.tier_next_open_at[tier] = config.tier_next_open_at[tier].max(now);
        }
    }
    config.open_tiers = open_tiers;
    emit!(TiersOpened { open_tiers });
    Ok(())
}

/// Which tiers may open HARD pools (Phase B, 2026-09-24) — the hard twin of
/// `set_open_tiers`, with the same restamp rule on the disabled→enabled edge
/// and its own event. A separate instruction rather than a second argument
/// on `set_open_tiers` so that every Squads proposal already drafted against
/// the easy setter keeps its exact payload, and so a hard-ladder change can
/// never ride in on an easy-ladder one by mistake.
///
/// Enablement is per (mode, tier): the easy and hard ladders share a tier's
/// price, pot and ceiling but nothing else — each has its own live slot,
/// its own cooldown clock and its own switch.
pub fn handle_set_hard_open_tiers(
    ctx: Context<AdminOnly>,
    open_tiers: [bool; N_TIERS],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    for (tier, &enabled) in open_tiers.iter().enumerate() {
        let was_enabled = config.hard_open_tiers[tier];
        if enabled && !was_enabled {
            config.hard_tier_next_open_at[tier] = config.hard_tier_next_open_at[tier].max(now);
        }
    }
    config.hard_open_tiers = open_tiers;
    emit!(HardTiersOpened { open_tiers });
    Ok(())
}

/// Per-TIER gross ceiling (D2), one tier per call — so a Squads proposal
/// reads as "raise tier 2's ceiling", never "replace the whole table".
/// Checked at `open_pool` only: lowering a ceiling never affects a pool
/// already open, it blocks the NEXT open in that tier.
pub fn handle_set_vault_ceiling(
    ctx: Context<AdminOnly>,
    tier: u8,
    ceiling_lamports: u64,
) -> Result<()> {
    require!((tier as usize) < N_TIERS, ErrorCode::UnknownTier);
    ctx.accounts.config.vault_ceiling_lamports[tier as usize] = ceiling_lamports;
    Ok(())
}

/// KYC-at-claim switch (R3, roadmap 4.5). 0 = off. When non-zero,
/// `pay_prizes` escrows any share above it and `release_escrow` demands a
/// `kyc_tier ≥ 1` packet.
///
/// D-E5 (founder decision 2026-09-06): identity verification is NOT
/// required; the switch stays at 0 and is kept — not deleted — so turning
/// it on later is one admin transaction rather than a program upgrade
/// under pressure. READ BEFORE FLIPPING IT: under D-E2 (winner takes all)
/// the one paid seat receives the entire pot, so any threshold below the
/// smallest pot (4 SOL at tier 0) escrows EVERY payout at EVERY tier. It is
/// an all-or-nothing gate now, not a large-prize gate as it was under
/// top-16. The decision to run without it, and its AML/CTF and territory
/// reasoning, are recorded in the decision register beside D-E5.
pub fn handle_set_kyc_threshold(ctx: Context<AdminOnly>, above_lamports: u64) -> Result<()> {
    ctx.accounts.config.kyc_required_above_lamports = above_lamports;
    Ok(())
}

/// R11's full-escrow-tier switch, published on-chain so the operative
/// detection policy is public.
///
/// NOTHING OFF-CHAIN READS IT YET (audit 2026-09-11, A-18 / D-36). Detection
/// runs manual-only by founder ruling D-E9 (2026-09-12): the report reaches
/// the reviewer and nothing acts on it automatically, so this flag records the
/// published policy rather than driving a code path. The review service
/// labels the hard-block list reported-and-not-acted-on for the same reason.
/// Wiring a reader is a change to that ruling, not an implementation detail.
pub fn handle_set_detection_hard_block(ctx: Context<AdminOnly>, on: bool) -> Result<()> {
    ctx.accounts.config.detection_hard_block = on;
    Ok(())
}
