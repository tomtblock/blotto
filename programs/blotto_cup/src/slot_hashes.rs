//! Delayed slot-hash read for the class digest (TECH-ARCH §4).
//!
//! The class digest mixes the blockhash from at least [`SLOT_HASH_DELAY`]
//! slots before the executing slot. That hash was finalized before the
//! executing validator's slot began, so the validator processing `register`
//! has no influence over it — combined with the pool-committed VRF seed, the
//! outcome is neither predictable at submission nor manipulable at execution
//! (the carried ADR-026 reasoning, `docs/architecture/adr/adr-026-multi-source-randomness.md`).
//!
//! The `SlotHashes` sysvar exceeds the size the `Sysvar` trait can load via
//! syscall, so it is read as raw account data with an `address =` constraint
//! pinning the account to the real sysvar (the pattern the predecessor proved).
//!
//! # Layout
//!
//! `u64` entry count, then `count` × (`u64` slot, 32-byte hash), newest first.
//!
//! # Determinism for replay
//!
//! "At least 5 back" rather than "exactly 5" because slots can be skipped: the
//! sysvar holds entries only for slots that produced a block. The rule —
//! newest entry with `slot ≤ current − 5` — is deterministic given the
//! execution slot, and irrelevant to replay anyway: the CHOSEN hash is written
//! to `Entry.slot_hash` and emitted in `EntryRegistered`, so an auditor
//! replays the digest from the event without reconstructing sysvar history.

use anchor_lang::prelude::*;

use crate::constants::SLOT_HASH_DELAY;
use crate::error::ErrorCode;

/// The SlotHashes sysvar address.
pub const SLOT_HASHES_SYSVAR_ID: Pubkey = pubkey!("SysvarS1otHashes111111111111111111111111111");

/// Pick the newest slot hash at least [`SLOT_HASH_DELAY`] slots old.
/// Pure over the sysvar bytes — unit tested against hand-built sysvar bytes.
pub fn delayed_slot_hash(data: &[u8], current_slot: u64) -> Result<[u8; 32]> {
    if data.len() < 8 {
        return err!(ErrorCode::SlotHashUnavailable);
    }
    let count = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
    let cutoff = current_slot.saturating_sub(SLOT_HASH_DELAY);
    const ENTRY: usize = 8 + 32;
    for i in 0..count {
        let base = 8 + i * ENTRY;
        let Some(entry) = data.get(base..base + ENTRY) else {
            break; // count claims more entries than the data holds
        };
        let slot = u64::from_le_bytes(entry[0..8].try_into().unwrap());
        if slot <= cutoff {
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&entry[8..8 + 32]);
            return Ok(hash);
        }
    }
    err!(ErrorCode::SlotHashUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sysvar(entries: &[(u64, u8)]) -> Vec<u8> {
        let mut d = (entries.len() as u64).to_le_bytes().to_vec();
        for &(slot, fill) in entries {
            d.extend_from_slice(&slot.to_le_bytes());
            d.extend_from_slice(&[fill; 32]);
        }
        d
    }

    #[test]
    fn picks_the_newest_entry_at_least_five_back() {
        // Current slot 100; entries newest-first 99, 97, 95, 90.
        let d = sysvar(&[(99, 1), (97, 2), (95, 3), (90, 4)]);
        // Cutoff 95 → first entry ≤ 95 is slot 95.
        assert_eq!(delayed_slot_hash(&d, 100).unwrap(), [3u8; 32]);
    }

    #[test]
    fn skipped_slots_fall_through_to_an_older_entry() {
        // Slots 96..93 skipped: cutoff 95 has no exact entry; 92 is chosen.
        let d = sysvar(&[(99, 1), (98, 2), (92, 7)]);
        assert_eq!(delayed_slot_hash(&d, 100).unwrap(), [7u8; 32]);
    }

    #[test]
    fn refuses_when_nothing_is_old_enough() {
        let d = sysvar(&[(99, 1), (98, 2)]);
        assert!(delayed_slot_hash(&d, 100).is_err());
        assert!(delayed_slot_hash(&[], 100).is_err());
    }

    #[test]
    fn refuses_a_count_that_overruns_the_data() {
        let mut d = sysvar(&[(90, 4)]);
        d[0] = 200; // count lies
                    // Entry 0 (slot 90 ≤ 95) still parses within bounds and wins.
        assert_eq!(delayed_slot_hash(&d, 100).unwrap(), [4u8; 32]);
        // But with no in-bounds qualifying entry, the lying count cannot make
        // the reader run off the end.
        let mut d2 = sysvar(&[(99, 1)]);
        d2[0] = 200;
        assert!(delayed_slot_hash(&d2, 100).is_err());
    }
}
