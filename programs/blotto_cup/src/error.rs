//! Program error codes.
//!
//! **Phase 0 scope.** Only the errors the two carried instructions raise. Phase 1
//! adds the rest as it adds the instructions that need them — the entry-packet
//! rejections, the capacity and deadline guards, the claim-proof failures and the
//! flag gate.

use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Pool is not accepting entries")]
    PoolNotOpen,

    #[msg("VRF seed has already been committed for this pool")]
    VrfSeedAlreadyCommitted,

    #[msg("Randomness account is not owned by the Switchboard On-Demand program, or is malformed")]
    InvalidRandomnessAccount,

    #[msg("Switchboard randomness has not been revealed at the current slot")]
    RandomnessNotResolved,

    #[msg("Pool VRF seed must be committed before passes can be minted")]
    VrfSeedNotCommitted,
}
