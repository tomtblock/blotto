# Phase 1 report — the on-chain program

**Status: complete.** The full pool lifecycle is implemented, unit-tested,
model-fuzzed and integration-tested against the compiled artifact. This report
records every judgement call made under uncertainty, per CLAUDE.md — each one
is also marked `PHASE-1-REVIEW` at its site in the code where it changes
behaviour.

## What exists now

Instructions (all in `programs/blotto_cup/src/`, wired in `lib.rs`):

| Area | Instructions | Signer |
|---|---|---|
| Admin | `init_config`, `set_paused`, `rotate_entry_signer`, `set_settlement_signer`, `set_open_tiers`, `set_vault_ceiling`, `set_kyc_threshold`, `set_detection_hard_block` | Squads vault (`has_one = admin`) |
| Pool | `open_pool`, `commit_vrf_seed` (permissionless), `create_pass_collection` (permissionless), `register` (player) | settlement signer where noted |
| Settlement | `reveal_pool_secret`, `commit_results`, `pay_prizes` (batched), `flag_entry`, `clear_flag`, `release_escrow`, `forfeit_escrow` | settlement signer |
| Refund fork | `trigger_refund`, `refund` | anyone (R7 needs no operator) |

Money movement is confined to `vault.rs` (`credit_from_signer`, `vault_debit`,
`fees_debit`); `scripts/check-standing-rules.sh` greps this in CI (rule 6:
`system_program::transfer` nowhere else; `vault_debit` call sites only in
`pay_prizes.rs`/`escrow.rs`/`refund.rs`; `fees_debit` only in
`register.rs`/`refund.rs`).

Test coverage:

- **Unit** (`cargo test -p blotto_cup`): prize math pinned to PID §6 to the
  lamport; packet parsing/policy decision table; delayed slot-hash reader;
  account-size and PDA-distinctness checks. 23 tests.
- **Vault model** (`programs/blotto_cup/tests/vault_model.rs`, roadmap 1.7):
  10k random instruction sequences against the ledger identity
  `vault == Σ80% − paid − refunded − released − forfeited`, plus exact-zero
  terminal checks. Runs in CI.
- **Integration** (`tests/litesvm/`): the compiled `blotto_cup.so` executed in
  LiteSVM with the real mpl-core binary and real Ed25519 packet instructions.
  12 tests: the full 64-entry lifecycle paying every band exactly; escrow
  flag/release/forfeit; the refund fork; admin auth (every admin ix rejects a
  non-admin); pause; R6/R14/ceiling gates; packet negatives; VRF
  commit/write-once against a fabricated Switchboard account; and a transfer
  attempt on a minted pass rejecting with `InvalidAuthority (0x9)` — the
  freeze, verified against the real mpl-core program.

## Judgement calls (founder attention ordered first)

### 1. Forfeited escrow goes to the platform wallet, not the next pool's vault

Roadmap 1.5: forfeit "passes to the next open pool's vault of the same tier, or
platform wallet if none." **Not implemented as written**, deliberately: a
pool's vault exits pay amounts derived strictly from its *own* entries (band ×
its pot, or its refunds). Lamports parked in a successor's vault could never
leave it again — the roadmap's forwarding would silently burn the money.
Correctness of vault flows outranks fidelity to the prose (tradeoff order #1),
so `forfeit_escrow` pays the platform wallet always. If forfeitures should
boost a later pool's prizes, that needs a designed mechanism (a published
bonus pot with recomputable augmented amounts) — a founder call, priced as a
program change. Site: `instructions/escrow.rs`.

### 2. The 20% share sits in a per-pool fees PDA until seal

Roadmap 1.6 funds the refund's 20% from "the platform wallet's pre-funded
refund reserve." Implemented instead: `register` splits 80/20 into two
program PDAs, and the 20% is swept to the platform wallet only at seal — the
moment refunds become impossible. R7's "full refund" is then a program
guarantee rather than a promise that depends on the operator keeping a reserve
topped up (the program cannot debit the founder's wallet). Same money, same
destinations, custody shifted for the only window where it matters. Site:
`state.rs` (`FEES_SEED`), `instructions/refund.rs`.

### 3. `pay_prizes` is batched against winners committed at `commit_results`

Roadmap 1.5's single transaction — 16 `(pubkey, amount)` pairs plus 16 Merkle
proofs plus 32+ account metas — cannot fit Solana's 1232-byte packet. Instead:
`commit_results` commits the 16 winners in rank order on the Pool (with the
full-ranking Merkle root, unchanged), amounts are derived on-chain from the
band table, and `pay_prizes(ranks: Vec<u8>)` settles any subset, idempotent
via a 16-bit `paid_mask`. The settlement signer chooses only batching — who
and how much were fixed at commit and are player-recomputable. Site:
`instructions/pay_prizes.rs`.

### 4. Prize bands are 1024ths, not basis points

PID §6's percentage column is rounded and sums to 100.02%; a bps table built
from it would misallocate. The published SOL amounts are exact 1024ths of the
pot, so the table is `[270, 158, 102, 78, 50×4, 27×8]` (sum 1024), divides
every tier's pot with zero residual, and reproduces PID §6 to the lamport — a
test pins all of this. Site: `constants.rs` (derivation shown), `prize_math.rs`.

### 5. Four vault exits, not three

The roadmap's prose says "exactly three exits (`pay_prizes`,
`release_escrow`, `refund`)" but its own §1.4 routes forfeited escrow out of
the vault. The true mover set is four; the standing-rules check asserts that
exact enumerated set. Site: `vault.rs`, `scripts/check-standing-rules.sh`.

### 6. Entry-packet verification is real in Phase 1, not the 1.3 stub

The Ed25519 instructions-sysvar verification (`entry_packet.rs`) is on-chain
code with a compliance function; stubbing it and swapping later invites the
§13 failure mode (a caller-supplied boolean). Phase 4 builds the *issuing*
service; the program-side check is done now and the LiteSVM suite exercises
its rejection table with real signatures.

### 7. Smaller calls

- **`commit_vrf_seed` now requires the pool to be `Open`** (it was carried
  without a state check; nothing after seal reads a fresh seed).
- **Vault and fees PDAs are created lazily** by the first entry's transfer,
  and reaped when their last lamport leaves — no prefunded rent, nothing
  stranded on-chain after a pool settles or refunds fully.
- **No `set_platform_wallet` admin instruction.** Re-pointing revenue is a
  money-flow change the roadmap doesn't list; recovery from a compromised
  wallet is pause + reviewed upgrade, not an always-armed admin path.
- **`init_config` bakes the launch policy** (0.1 tier only, everything else
  off) and takes founder-owned deploy values (signers, wallet, ceiling) as
  arguments. Launch ceiling used in tests: 6.4 SOL gross per pool (roadmap §7.1).
- **`Register`'s deserialized accounts are `Box`ed** — unboxed, the generated
  account-validation frame overruns the 4 KB SBF stack (a `cargo build-sbf`
  hard warning of undefined behaviour, not style).
- **Two pinned split-crate deps** (`solana-instructions-sysvar`,
  `solana-sha256-hasher`): anchor-lang 1.0's facade does not re-export the
  checked sysvar loaders or sha256. Versions match anchor's own tree.
- **`trigger_refund` closes an empty pool directly** (nothing to refund;
  `Refunding` would be a dead end).
- **A duplicate `refund` after the last refund reports `PoolNotRefunding`**
  (the pool closed) rather than `AlreadyRefunded` — the state gate fires
  first; both reject.

### 8. The Surfpool TS suites are replaced by LiteSVM

`tests/vrf.ts` and `tests/pass.ts` (carried in Phase 0) mocked the *old* Pool
layout, tested a `mint_pass` instruction that no longer exists, and required
Surfpool. Their coverage — VRF commit against a fabricated Switchboard
account, write-once, wrong-owner/unrevealed rejections, and the freeze's
`0x9` rejection — is ported to `tests/litesvm/tests/vrf_and_freeze.rs` and
runs against the real artifacts. `Anchor.toml`'s test script now points at
the LiteSVM suite.

## Known limits / deferred

- **Devnet deploy + Squads upgrade authority (roadmap 1.8)** needs the
  founder's devnet Squads vault and Turnkey sandbox sub-org (R21) — external
  accounts this environment cannot create. The artifact builds
  (`anchor build` green, program ID `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`)
  and deploy is a single command once those exist.
- **The LiteSVM suite runs locally, not yet in `ci-fast`** — it needs the SBF
  artifact, and `ci-fast` deliberately has no Solana toolchain. A separate
  program-CI lane (toolchain cached, `anchor build` + LiteSVM) is Phase 5
  work alongside the rehearsal harness.
- **TM-502 residual** (Switchboard randomness not payload-bound) carried
  unchanged, documented in `vrf.rs`.
- **mpl-core stack-offset warnings** at `anchor build` are dead code
  (deserializers this program never calls) — documented in the program's
  `Cargo.toml`; our own frames are clean.

---

## Founder ratifications (2026-08-27)

The three Phase 1/2 judgement calls put to the founder were ratified as
built: **(1)** forfeited escrow transfers automatically to the platform
wallet once a review decision is made (no successor-vault forwarding);
**(2)** the 20% platform share is program-held in the fees PDA until seal;
**(3)** payouts land in batches of four with winners and amounts fixed
on-chain at commit. Note kept with the decisions it closes.
