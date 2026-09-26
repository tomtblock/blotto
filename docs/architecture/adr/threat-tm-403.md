# TM-403: Numerical overflow, underflow or rounding in money and scoring maths

**Status:** Mitigated · residual risk low
**Enforced in:** `Cargo.toml` (`overflow-checks = true`), `programs/blotto_cup/src/prize_math.rs`,
`programs/blotto_cup/src/instructions/`, `backend/scoring/src/`; invariant suite
`programs/blotto_cup/tests/vault_model.rs`

## Threat

**Attacker:** incidental; exploitable once found.
**Vector:** an intermediate product exceeds `u64` and wraps; a subtraction underflows; rounding
leaks or creates lamports across many payouts; a fractional score is carried as a float and two
runtimes disagree.
**Impact:** wrong prize amounts, a vault that pays more or less than its pot, a pool that cannot
settle, or a ranking a player recomputes differently from the one that was paid.

## Mitigation in Blotto Cup

- **No floats anywhere in money or scoring.** On-chain maths is integer-only. The TypeScript
  scoring engine carries scores in integer half-points (win 2, draw 1, loss 0) and lamports as
  `bigint` (`backend/scoring/src/engine.ts`, `prizes.ts`), so the crank and the browser compute the
  same numbers.
- **`u128` intermediates where a product can grow.** Prize bands are computed as
  `pot × band / 1024` in `u128` (`prize_math.rs`); `commit_results` sums the committed payout list
  in `u128` before comparing it to the pot (`reveal_commit.rs`); the treasury reserve is accumulated
  in `u128` (`treasury.rs`).
- **Revert, never wrap.** Balance arithmetic uses `checked_add` / `checked_sub` and returns
  `ErrorCode::Overflow`; the release profile sets `overflow-checks = true`, so any unchecked
  overflow panics instead of wrapping.
- **Exact division by construction.** Every prize pool is a multiple of 1024 lamports, so the band
  table divides with no remainder (asserted per tier in `prize_math` tests). A tie split's
  indivisible remainder goes to one named player (D3-B in [DECISIONS.md](../DECISIONS.md)), so no
  lamport is created or lost.
- **Pots are constants, not arithmetic.** A prize pool is copied from `Config` at `open_pool` and
  never derived from entries or balances; `scripts/check-standing-rules.sh` check 6(g) fails CI on
  such arithmetic.
- **Rent-safe debits.** Every vault and treasury debit goes through `vault.rs`, which refuses a
  debit that would leave the account below rent exemption (`WouldStrandRentBalance`).
- **Property testing.** `vault_model.rs` drives a model of the money flows through 10,000 random
  instruction sequences using the same arithmetic the handlers use, and asserts the vault and
  treasury ledger identities after every step. The scoring engine is pinned to Python-generated
  known vectors (`backend/scoring/fixtures/gen_vectors.py`).

## Residual risk

**Low.** A new money path must go through `vault.rs`, use checked or `u128` arithmetic, and be added
to the model suite.
