//! Instruction handlers, one module per lifecycle area.
//!
//! The lifecycle: `init_config` (once) → `open_pool` → `commit_vrf_seed`
//! (`vrf.rs`) + `create_pass_collection` (`pass.rs`) → `register` × n →
//! sealed (at the `register` that fills the pool to its capacity, or by
//! `seal_at_deadline` once the deadline passes with at least the pool's
//! minimum field) → `reveal_pool_secret` → `commit_results` → `pay_prizes`
//! (batched) → escrow settlement. The refund fork: deadline passes below the
//! minimum field → `trigger_refund` → `refund` × n → closed. Pool types
//! (`pool_type.rs`, D-E19) are created and switched by the admin before any
//! pool of that (mode, tier, capacity) opens. A forfeited share (admin
//! `forfeit_escrow`) is paid onward by `pay_next_place` in a one-place pool
//! and HELD in a Ladder pool until the field-moves-up payout ships.
//! `migrate_config` / `migrate_pool` run once after a layout upgrade.
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
pub mod pool_type;
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
pub use pool_type::*;
pub use refund::*;
pub use register::*;
pub use reveal_commit::*;
pub use sanctions::*;
pub use seal::*;
pub use treasury::*;
