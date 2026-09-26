# TM-402: Missing signer check on a privileged instruction

**Status:** Mitigated · residual risk low
**Enforced in:** the account constraints in `programs/blotto_cup/src/instructions/`; negative tests
in `tests/litesvm/tests/`

## Threat

**Attacker:** anyone.
**Vector:** call an instruction that should require a specific role without that role's signature,
or with a signature from the wrong key.
**Impact:** unauthorised state changes. Here that could mean opening pools, changing prices or
prize pools, flagging or clearing entries, committing a false results root, or moving treasury
funds.

## Mitigation in Blotto Cup

Each privileged instruction takes the role as `Signer<'info>` and binds it to the key stored on
`Config` with `has_one` (or an explicit key comparison):

| Role (stored on `Config`) | Instructions | Check |
|---|---|---|
| `admin` (a multisig vault) | every `set_*` switch, `rotate_entry_signer`, `withdraw_platform`, `lift_sanctions_hold`, `forfeit_escrow` | `has_one = admin` |
| `settlement_signer` | `reveal_pool_secret`, `commit_results`, `pay_prizes`, `flag_entry`, `clear_flag`, `place_sanctions_hold`, `pay_next_place` | `has_one = settlement_signer` |
| `settlement_signer`, or anyone after 7 days | `release_escrow` | compared to `Config.settlement_signer` in the handler unless the auto-release window (`ESCROW_AUTO_RELEASE_SECS`) has passed |
| `keeper` | `open_pool` | `opener == config.keeper`, else `NotKeeper` |
| `entry_signer` | `register` (through the entry packet) | the ed25519 precompile instruction must be signed by `Config.entry_signer` (`entry_packet.rs`) |

Instructions that protect players stay deliberately **permissionless**: `seal_at_deadline`,
`trigger_refund`, `refund`, `create_pass_collection` and `commit_vrf_seed`. Their safety comes from
state checks (deadline passed, pool below the minimum field, write-once), not from who signs.

Tests: `tests/litesvm/tests/gates.rs` (`non_admin_reverts_on_every_admin_instruction`) calls every
admin instruction from a non-admin key and expects Anchor's `ConstraintHasOne` (2001), then succeeds
as the admin. `keeper_and_timing.rs` proves that only the keeper opens a pool (`NotKeeper`) and
that the service keys cannot enter; `lifecycle.rs` covers settlement-signer refusals.

## Residual risk

**Low under review.** A new privileged instruction must add a signer constraint and a negative test
in the same change.
