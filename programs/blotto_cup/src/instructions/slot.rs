//! The pool-type slot: one Open pool per pool TYPE — (mode, tier, capacity)
//! since D-E19; (tier) under D-A1 and (mode, tier) under Phase B before it —
//! freed only when a pool reaches `Paid` or `Closed`, and — since the
//! 2026-09-07 upgrade (prompt v2 §B.5/§B.6) — stamped with the moment the
//! type may open again.
//!
//! One helper, three callers (`pay_prizes`, `trigger_refund`, `refund`), so
//! the cooldown stamp and the `TierSlotFreed` event cannot drift between the
//! paid path and the two refund paths. Without the on-chain stamp the
//! "next pool in" countdown would be a client-side guess.
//!
//! Each caller takes the `PoolType` as an account whose seeds are derived
//! from the POOL's own recorded mode, tier and capacity, so a permissionless
//! caller cannot point the free at another type's slot — and cannot leave
//! it out, which would leave this type's slot held by a finished pool and
//! stop every later pool of the type.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::TierSlotFreed;
use crate::state::PoolType;

/// Free `pool_type`'s slot if `pool_id` holds it, stamp `next_open_at = now +
/// cooldown_seconds`, emit `TierSlotFreed`. Idempotent for a pool that does
/// not hold the slot (a defensive no-op that changes nothing — e.g. a pool
/// opened before the Ladder, whose slot lived on Config).
pub(crate) fn free_pool_type_slot(
    pool_type: &mut PoolType,
    cooldown_seconds: i64,
    pool_id: u64,
    now: i64,
) -> Result<()> {
    if pool_type.active_pool != pool_id {
        return Ok(());
    }
    pool_type.active_pool = 0;
    let next_open_at = now
        .checked_add(cooldown_seconds)
        .ok_or(ErrorCode::Overflow)?;
    pool_type.next_open_at = next_open_at;
    emit!(TierSlotFreed {
        tier: pool_type.tier,
        pool_id,
        next_open_at,
        mode: pool_type.mode,
        capacity: pool_type.capacity,
    });
    Ok(())
}
