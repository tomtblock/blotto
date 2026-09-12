//! The suite must not report success when it ran nothing.
//!
//! Every test in this crate opens with `let Some(mut env) = Env::new() else
//! { return };`, and `Env::new` returns `None` when the compiled program is
//! missing. A bare `return` is reported by the test harness as PASSED, so a
//! run with no artifact printed a full green board having asserted nothing —
//! and the module doc claimed the suite "skips, loudly". It skipped in
//! silence. The 2026-09-11 audit found it (G-03) and this file is the fix.
//!
//! The skip itself is kept: it is genuinely useful for `cargo test` in a
//! checkout that has not built the program. What is not acceptable is not
//! being told. So exactly one test refuses to skip, and a run without the
//! artifact now fails on this file alone, naming the command to fix it.

use blotto_litesvm_tests::artifacts;

#[test]
fn the_compiled_program_is_present() {
    assert!(
        artifacts().is_some(),
        "the compiled program is missing, so every other test in this suite \
         returned early and reported success without asserting anything. Run \
         `anchor build` from the repository root (and keep \
         tests/fixtures/mpl_core.so in place), then run this suite again."
    );
}
