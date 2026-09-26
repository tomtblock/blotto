# TM-401: PDA seed collision

**Status:** Mitigated · residual risk low
**Enforced in:** `programs/blotto_cup/src/state.rs` (seed constants and their tests)

## Threat

**Attacker:** anyone who can derive program addresses.
**Vector:** supply inputs so that the address derived for one account type equals an address of
another type, and pass it where the program expects the other, to bypass an ownership or authority
check.
**Impact:** a forged account standing in for a pool, vault, entry or the treasury. Here that could
mean paying out of the wrong vault or registering against the wrong pool.

This is the most common class of Solana program bug, which is why it is recorded even though the
mitigation is simple.

## Mitigation in Blotto Cup

- **Every PDA type has its own literal seed prefix**, declared once in `state.rs`:

  | PDA | Seeds |
  |---|---|
  | `Config` | `[b"config"]` |
  | `Pool` | `[b"pool", pool_id (u64 LE)]` |
  | Prize vault | `[b"vault", pool_id (u64 LE)]` |
  | Platform treasury | `[b"platform"]` |
  | `Entry` | `[b"entry", pool, player]` |
  | Pass Collection | `[b"pass_collection", pool]` |

- Every account constraint derives its address through Anchor's `seeds = [...]` with one of these
  constants and the stored canonical `bump`; no seed prefix is written inline.
- Two unit tests in `state.rs` guard the scheme: `pda_seed_prefixes_are_pairwise_distinct` and
  `pda_types_derive_distinct_addresses` (the six types derive six different addresses from related
  inputs).
- The prize vault and treasury seeds may appear in a signed transfer only inside `vault.rs`;
  `scripts/check-standing-rules.sh` fails CI otherwise.
- The `Entry` PDA keyed on `(pool, player)` also enforces one entry per wallet per pool (decision
  D-E6 in [DECISIONS.md](../DECISIONS.md)).

## Residual risk

**Low.** A new PDA type must add its prefix to the constants and to both tests; code review checks
for it.
