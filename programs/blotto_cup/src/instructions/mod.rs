//! Instruction handlers, one module per lifecycle area.
//!
//! The lifecycle: `init_config` (once) → `open_pool` → `commit_vrf_seed`
//! (`vrf.rs`) + `create_pass_collection` (`pass.rs`) → `register` × n →
//! sealed (at the 64th `register`, or by `seal_at_deadline` once the
//! deadline passes with `MIN_SEATS..64` seats — D-E4) → `reveal_pool_secret`
//! → `commit_results` → `pay_prizes` (batched) → escrow settlement. The
//! refund fork: deadline passes below `MIN_SEATS` → `trigger_refund` →
//! `refund` × n → closed.
//!
//! Money movement is NOT here — every lamport transfer goes through
//! `crate::vault` (the standing-rules chokepoint). These modules decide *when*
//! and *how much*; `vault.rs` is the only *how*.

pub mod admin;
pub mod escrow;
pub mod flags;
pub mod open_pool;
pub mod pay_prizes;
pub mod refund;
pub mod register;
pub mod reveal_commit;
pub mod seal;
pub mod treasury;

pub use admin::*;
pub use escrow::*;
pub use flags::*;
pub use open_pool::*;
pub use pay_prizes::*;
pub use refund::*;
pub use register::*;
pub use reveal_commit::*;
pub use seal::*;
pub use treasury::*;
