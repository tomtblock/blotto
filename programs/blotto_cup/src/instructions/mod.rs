//! Instruction handlers, one module per lifecycle area.
//!
//! The lifecycle: `init_config` (once) → `open_pool` → `commit_vrf_seed`
//! (`vrf.rs`) + `create_pass_collection` (`pass.rs`) → `register` × n →
//! sealed (at the 64th `register`, or by `seal_at_deadline` once the
//! deadline passes with `MIN_SEATS..64` seats — D-E4) → `reveal_pool_secret`
//! → `commit_results` → `pay_prizes` (batched) → escrow settlement. The
//! refund fork: deadline passes below `MIN_SEATS` → `trigger_refund` →
//! `refund` × n → closed. A forfeited share (admin `forfeit_escrow`) is paid
//! to the next eligible place by `pay_next_place` (founder ruling
//! 2026-09-07). `migrate_config` runs once, right after the 2026-09-07
//! upgrade.
//!
//! Money movement is NOT here — every lamport transfer goes through
//! `crate::vault` (the standing-rules chokepoint). These modules decide *when*
//! and *how much*; `vault.rs` is the only *how*.

pub mod admin;
pub mod escrow;
pub mod flags;
pub mod migrate;
pub mod open_pool;
pub mod pay_prizes;
pub mod refund;
pub mod register;
pub mod reveal_commit;
pub mod sanctions;
pub mod seal;
pub(crate) mod slot;
pub mod treasury;

pub use admin::*;
pub use escrow::*;
pub use flags::*;
pub use migrate::*;
pub use open_pool::*;
pub use pay_prizes::*;
pub use refund::*;
pub use register::*;
pub use reveal_commit::*;
pub use sanctions::*;
pub use seal::*;
pub use treasury::*;
