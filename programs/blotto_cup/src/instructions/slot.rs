//! The tier slot: one Open pool per tier (D-A1 revised), freed only when a
//! pool reaches `Paid` or `Closed`, and — since the 2026-09-07 upgrade
//! (prompt v2 §B.5/§B.6) — stamped with the moment the tier may open again.
//!
//! One helper, three callers (`pay_prizes`, `trigger_refund`, `refund`), so
//! the cooldown stamp and the `TierSlotFreed` event cannot drift between the
//! paid path and the two refund paths. Without the on-chain stamp the
//! "next pool in" countdown would be a client-side guess.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::TierSlotFreed;
use crate::state::Config;

/// Free `tier`'s slot if `pool_id` holds it, stamp `tier_next_open_at =
/// now + cooldown_seconds`, emit `TierSlotFreed`. Idempotent for a pool that
/// does not hold the slot (a defensive no-op that changes nothing).
pub(crate) fn free_tier_slot(
    config: &mut Config,
    tier: usize,
    pool_id: u64,
    now: i64,
) -> Result<()> {
    if config.active_pool_by_tier[tier] != pool_id {
        return Ok(());
    }
    config.active_pool_by_tier[tier] = 0;
    let next_open_at = now
        .checked_add(config.cooldown_seconds)
        .ok_or(ErrorCode::Overflow)?;
    config.tier_next_open_at[tier] = next_open_at;
    emit!(TierSlotFreed {
        tier: tier as u8,
        pool_id,
        next_open_at,
    });
    Ok(())
}
