//! `open_pool` (roadmap 1.2 as revised by D-A1 v2, 2026-08-27; keeper-gated
//! since 2026-09-07, prompt v2 §A) — the KEEPER opens the next pool of a
//! tier once the program's own gates pass. The daemon has no discretion
//! over WHETHER a pool opens; the checks here ARE the policy:
//!
//!   0. the signer is `Config.keeper`. FULL STOP, since the founder ruling
//!      of 2026-09-07 (audit O9b/A5b). Until then a tier idle for
//!      `LIVENESS_FALLBACK_SECS` could be opened by ANY signer, so that a
//!      dead daemon could not freeze it — but the opener also chooses the
//!      pool's `sealing_pubkey`, and a pool sealed to a key our custody does
//!      not hold can never be revealed, therefore never settled, and once it
//!      reaches `MIN_SEATS` it can no longer refund either: the pot and up
//!      to 64 entries with no on-chain route to anyone.
//!
//!      A frozen tier strands nothing — no pool means no money at risk — and
//!      the admin can rotate the keeper at any time. Sealing and refunding an
//!      EXISTING pool stay permissionless, and those are the properties that
//!      actually protect players. So the fallback bought very little and
//!      risked everything, and it is gone;
//!   1. the tier is open for the pool's MODE (R6's tier switch; the hard
//!      ladder has its own since Phase B) AND the pool TYPE — this (mode,
//!      tier, capacity) — is enabled (D-E19). Two switches on purpose: R6
//!      governs opening a price tier at all, the pool type governs which
//!      sizes run in it;
//!   2. the pool type's previous pool reached `Paid` or `Closed` (SEQUENTIAL
//!      pools per type — the slot clears only there) AND its cooldown has
//!      elapsed (`PoolType.next_open_at`, prompt v2 §B.6). Pools of
//!      different types — another mode, tier or size — have their own slots,
//!      so all of them can be Open at once;
//!   3. the pool type's prize pool still equals its table at the tier's
//!      CURRENT price (`PoolTypeEconomicsStale` otherwise) — so a price
//!      change can never open a pool whose published prizes no longer match
//!      its stored prize pool;
//!   4. the D2 ceiling caps the pool's pass sales (price × its capacity);
//!   5. the treasury policy holds: after funding this prize pool, the
//!      treasury still has `min` + `reserve_pots` further prize pools of
//!      every OTHER enabled pool type with no live pool — computed over the
//!      treasury's balance EXCLUDING refundable entry payments, which are
//!      players' money in transit, never prize funding. The other enabled
//!      types arrive as remaining accounts and must be all of them
//!      (`treasury::idle_pool_type_reserve`).
//!
//! On success EXACTLY the pool type's prize pool moves from the platform
//! treasury into the new pool's prize vault, before any pass is sold. No
//! partial pools; a prize pool never scales with entries or balances. The
//! pool copies the type's capacity, minimum field and table, so a later
//! change to the type never reaches it. The deadline is `now +
//! Config.fill_deadline_seconds` (12 h at launch), copied likewise.
//!
//! The pool id is `Config.next_pool_id`, passed as an argument (Anchor PDA
//! seeds must be derivable from instruction inputs) and checked against the
//! counter so ids stay gapless and monotonic.

use anchor_lang::prelude::*;

use crate::constants::{CAPACITY, LAUNCH_CLASS_COUNTERS, N_MODES, TIMER_SECONDS};
use crate::error::ErrorCode;
use crate::events::PoolOpened;
use crate::instructions::treasury::idle_pool_type_reserve;
use crate::state::{
    Config, Pool, PoolState, PoolType, CONFIG_SEED, PLATFORM_SEED, POOL_SEED, POOL_TYPE_SEED,
    VAULT_SEED,
};

/// Remaining accounts: every OTHER enabled `PoolType`, ascending by address
/// (the treasury reserve, `treasury::idle_pool_type_reserve`).
#[derive(Accounts)]
#[instruction(
    pool_id: u64,
    tier: u8,
    sealing_pubkey: [u8; 32],
    sealing_secret_hash: [u8; 32],
    mode: u8,
    capacity: u16
)]
pub struct OpenPool<'info> {
    /// The keeper (`Config.keeper`) — the only signer this instruction
    /// accepts. Checked in the handler rather than by `has_one` so the
    /// refusal carries `NotKeeper` alongside the tier's other gates.
    /// Pays the Pool's rent.
    #[account(mut)]
    pub opener: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = opener,
        space = Pool::SPACE,
        seeds = [POOL_SEED, &pool_id.to_le_bytes()],
        bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: The prize-vault PDA. Created here by the pot transfer from
    /// the treasury — the pot is locked before any pass is sold.
    #[account(
        mut,
        seeds = [VAULT_SEED, &pool_id.to_le_bytes()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: The platform treasury PDA (D-A1 v2), the pot's source.
    #[account(mut, seeds = [PLATFORM_SEED], bump = config.platform_bump)]
    pub platform: UncheckedAccount<'info>,

    /// The pool type being opened (D-E19): its slot, cooldown, table, floor
    /// and prize pool. Bound to the arguments by its seeds.
    #[account(
        mut,
        seeds = [POOL_TYPE_SEED, &[mode], &[tier], &capacity.to_le_bytes()],
        bump = pool_type.bump,
    )]
    pub pool_type: Box<Account<'info, PoolType>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_open_pool<'info>(
    ctx: Context<'info, OpenPool<'info>>,
    pool_id: u64,
    tier: u8,
    sealing_pubkey: [u8; 32],
    sealing_secret_hash: [u8; 32],
    mode: u8,
    capacity: u16,
) -> Result<()> {
    // Gapless ids: the argument exists only because PDA seeds need it.
    require!(
        pool_id == ctx.accounts.config.next_pool_id,
        ErrorCode::WrongPoolId
    );

    let tier_idx = tier as usize;
    require!(tier_idx < crate::constants::N_TIERS, ErrorCode::UnknownTier);
    // Phase B: the placing rule is recorded, never guessed. Checked before
    // any per-mode read so an unknown byte can never alias the easy ladder.
    require!(mode < N_MODES, ErrorCode::UnknownMode);
    // The pool type IS this (mode, tier, capacity) — its seeds bind it to
    // the arguments; this restates it against the stored fields so a
    // mismatch is named rather than inferred.
    {
        let t = &ctx.accounts.pool_type;
        require!(
            t.mode == mode && t.tier == tier && t.capacity == capacity,
            ErrorCode::PoolTypeMismatch
        );
    }
    // R6: a tier must be opened by the founder before pools exist in it —
    // per mode since Phase B (`set_open_tiers` / `set_hard_open_tiers`).
    require!(
        ctx.accounts.config.open_tiers_for(mode)[tier_idx],
        ErrorCode::TierNotOpen
    );
    // D-E19: and the pool type must be switched on.
    require!(ctx.accounts.pool_type.enabled, ErrorCode::PoolTypeDisabled);
    // SEQUENTIAL pools per pool type — the slot clears only when the
    // previous pool of this type reaches Paid or Closed.
    require!(
        ctx.accounts.pool_type.active_pool == 0,
        ErrorCode::TierAlreadyHasOpenPool
    );
    // Prompt v2 §B.6: the cooldown stamped when the slot freed.
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.pool_type.next_open_at,
        ErrorCode::TierCoolingDown
    );
    // Prompt v2 §A.2, as amended by the founder ruling of 2026-09-07: the
    // KEEPER opens pools, and nobody else, ever. See the module doc for why
    // the liveness fallback that used to sit here was removed rather than
    // narrowed — the opener chooses the pool's sealing key, and that is not
    // a decision any passing signer may make.
    require!(
        ctx.accounts.opener.key() == ctx.accounts.config.keeper,
        ErrorCode::NotKeeper
    );

    let entry_lamports = ctx.accounts.config.tier_price_lamports[tier_idx];
    let pot_lamports = ctx.accounts.pool_type.pot_lamports;
    require!(
        ctx.accounts.pool_type.paid_places > 0 && pot_lamports > 0,
        ErrorCode::PoolTypeEconomicsUnset
    );
    // D-E19: the stored prize pool must still be the table at TODAY's price.
    // `set_tier_economics` can move the price; it cannot move a published
    // prize — this refuses until `set_pool_type_economics` restates it.
    require!(
        PoolType::table_value(&ctx.accounts.pool_type.prize_table, entry_lamports)
            == pot_lamports as u128,
        ErrorCode::PoolTypeEconomicsStale
    );
    let capacity_seats = ctx.accounts.pool_type.capacity;
    // Defense in depth: no pool may hold more seats than the fixed arrays
    // (payouts, paid_mask, the class bag) are sized for.
    require!(capacity_seats <= CAPACITY, ErrorCode::UnknownCapacity);
    // D2 (re-scoped by v2): the ceiling caps the pool's PASS SALES.
    let gross = (entry_lamports as u128) * (capacity_seats as u128);
    require!(
        gross <= ctx.accounts.config.vault_ceiling_lamports[tier_idx] as u128,
        ErrorCode::VaultCeilingExceeded
    );

    // The treasury policy (module doc): available = balance minus the
    // refundable entry payments; after funding this pot the remainder must
    // cover the floor plus the idle-tier reserve (this tier excluded — it
    // is live once this open succeeds).
    let balance = ctx.accounts.platform.lamports() as u128;
    let refundable = ctx.accounts.config.platform_refundable as u128;
    let available = balance.saturating_sub(refundable);
    // The vault is funded with the pot PLUS the rent-exempt minimum for a
    // zero-data account. The cushion is what stops a stranger freezing the
    // pool for one lamport: the pot can leave in full and the account still
    // holds enough to stay rent-exempt, so the runtime never sees the
    // rent-paying post-state it refuses. See `vault::rent_floor` for the
    // whole story. The cushion is NOT part of the prize and is never
    // reserved against the treasury policy — `platform_reserved` still
    // tracks the pot alone, because the pot is what has to be payable.
    let cushion = crate::vault::rent_floor()?;
    let funding = (pot_lamports as u128)
        .checked_add(cushion as u128)
        .ok_or(ErrorCode::Overflow)?;
    let reserve = idle_pool_type_reserve(
        &ctx.accounts.config,
        ctx.remaining_accounts,
        Some(ctx.accounts.pool_type.key()),
        cushion,
    )?;
    let needed =
        funding + (ctx.accounts.config.treasury_min_platform_lamports as u128) + (reserve as u128);
    require!(available >= needed, ErrorCode::TreasuryShortfall);

    // Fund the pot: treasury → this pool's prize vault, locked before any
    // pass is sold.
    crate::vault::platform_debit(
        &ctx.accounts.system_program,
        &ctx.accounts.platform.to_account_info(),
        &ctx.accounts.vault.to_account_info(),
        ctx.accounts.config.platform_bump,
        u64::try_from(funding).map_err(|_| ErrorCode::Overflow)?,
    )?;

    let config = &mut ctx.accounts.config;
    config.platform_reserved = config
        .platform_reserved
        .checked_add(pot_lamports)
        .ok_or(ErrorCode::Overflow)?;

    // Copied at open (like price and pot): a later `set_pool_timing` never
    // moves the deadline players entered under. 12 h at launch (ruling
    // 2026-09-07, supersedes R7's 72 h).
    let fill_deadline = now
        .checked_add(config.fill_deadline_seconds)
        .ok_or(ErrorCode::Overflow)?;
    let pool = &mut ctx.accounts.pool;
    pool.id = pool_id;
    pool.tier = tier;
    pool.entry_lamports = entry_lamports;
    pool.pot_lamports = pot_lamports;
    pool.entrants = 0;
    pool.opened_at = now;
    pool.fill_deadline = fill_deadline;
    pool.state = PoolState::Open;
    pool.sealing_pubkey = sealing_pubkey;
    pool.sealing_secret_hash = sealing_secret_hash;
    pool.vrf_seed = [0u8; 32]; // uncommitted sentinel; `commit_vrf_seed` fills it
    pool.class_counters = LAUNCH_CLASS_COUNTERS;
    pool.secret_revealed = false;
    pool.results_root = [0u8; 32];
    pool.results_committed = false;
    pool.payouts_len = 0;
    pool.payouts = [crate::state::Payout::default(); crate::constants::CAPACITY as usize];
    pool.paid_mask = 0;
    pool.refunded_count = 0;
    // R9: recorded per pool so the value players entered under is on-chain.
    pool.timer_seconds = TIMER_SECONDS;
    // R7-b (founder instruction 2026-09-12): the same rule for the minimum
    // field. `seal_at_deadline` and `trigger_refund` read THIS, never the
    // pool type, so a later change to the type cannot move the floor under a
    // pool that is already taking entries.
    pool.min_seats = ctx.accounts.pool_type.min_seats;
    // Phase B: the placing rule, recorded once and never rewritten — the
    // same guarantee `min_seats` and `fill_deadline` give.
    pool.mode = mode;
    // D-E19: the size and the prize table, copied once, never rewritten.
    pool.capacity = capacity_seats;
    pool.paid_places = ctx.accounts.pool_type.paid_places;
    pool.prize_table = ctx.accounts.pool_type.prize_table;
    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;

    config.next_pool_id = config
        .next_pool_id
        .checked_add(1)
        .ok_or(ErrorCode::Overflow)?;
    // The slot is the pool TYPE's since D-E19; Config's per-(mode, tier)
    // slots are no longer written or read.
    ctx.accounts.pool_type.active_pool = pool_id;

    emit!(PoolOpened {
        pool: pool.key(),
        id: pool_id,
        tier,
        entry_lamports,
        pot_lamports,
        fill_deadline: pool.fill_deadline,
        timer_seconds: pool.timer_seconds,
        sealing_pubkey,
        sealing_secret_hash,
        mode,
        capacity: pool.capacity,
        min_seats: pool.min_seats,
        paid_places: pool.paid_places,
        prize_table: pool.prize_table,
    });

    Ok(())
}
