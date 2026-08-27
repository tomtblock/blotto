# Internal review — the on-chain program (roadmap 5.5, the R5 substitute)

**Scope.** `programs/blotto_cup/` at this branch's head, reviewed against the
four carried threat-model entries (`docs/reference/threat-tm-*.md`), the
vault-invariant suite, and the checklist of the ten most common Anchor
vulnerability classes below. This review is the R5 substitute for a
pre-mainnet audit — the independent audit follows after ten settled mainnet
pools; R6 gates the 0.5 SOL tier on it.

**Verdict.** One finding fixed during review (IR-1). Three accepted risks
documented with rationale (IR-2..IR-4). No open blocking items. The founder
should read IR-2..IR-4 and ratify each.

---

## Findings

### IR-1 — FIXED: permissionless collection creation accepted caller metadata

`create_pass_collection` is deliberately permissionless (any payer may fund
the Collection account) — but it accepted a caller-supplied `name`/`uri`. A
griefer could front-run the settlement crank after `open_pool` and label a
pool's pass Collection with arbitrary text, which every pass in the pool
would then sit under, permanently (there is deliberately no update path).
**Fix:** metadata is now derived on-chain (`BLOTTO PASS COLLECTION #<id>`,
empty uri per R12); no caller input reaches the Collection. All suites
re-run green against the rebuilt artifact.

### IR-2 — ACCEPTED: `commit_vrf_seed` accepts either cluster's Switchboard ID

The owner check admits the mainnet AND devnet Switchboard On-Demand program
IDs, because the deploy target isn't knowable at compile time. Exploitability
was analysed and is nil-to-negligible: an attacker cannot fabricate a
non-zero `RandomnessAccountData` under either program's ownership
(`allocate`+`assign` leaves data zeroed; only the owning program writes), so
the check admits only genuinely oracle-produced values — the already-
documented TM-502 substitution residual, which the multi-source digest
(ADR-026) bounds and which, in this product, decides only cosmetics
(PID §8.4). **Hardening option for Phase 7:** a cargo feature that pins the
single expected ID per deploy. Founder to ratify either way.

### IR-3 — ACCEPTED: unsolicited lamport donations to the vault/fees PDAs

Anyone can transfer lamports to the vault or fees PDA addresses. Nothing in
the program reads those balances to make decisions — payout and refund
amounts are always computed, never "whatever is in the account" — so a
donation strands harmlessly (and keeps a reaped account alive, also
harmless). The vault-model suite's ledger identity intentionally models
program-driven flows only. No action.

### IR-4 — ACCEPTED: escrowed shares depend on settlement-signer liveness

A flagged or KYC-escrowed share can only leave the vault via
settlement-signed `release_escrow`/`forfeit_escrow`. A vanished operator
strands escrow (unlike refunds and payouts, which are permissionless or
push). This is R10/R11's design — escrow exists precisely so a human
reviews — and the KYC path releases on a packet, not operator grace. Recorded
so nobody mistakes it for an oversight; the 24h-review commitment
(TECH-ARCH §9) is the operational mitigation.

---

## The ten-class Anchor checklist

| # | Class | Status |
|---|---|---|
| 1 | Missing signer checks (TM-402) | ✅ Admin: `Signer` + `has_one = admin`; settlement: `has_one = settlement_signer`. Negative tests for every admin ix and a settlement ix (LiteSVM `gates.rs`). Permissionless instructions are each argued at their site (write-once, state-gated, or pay-to-fixed-recipient). |
| 2 | Missing owner / account-type validation | ✅ Typed `Account<'_, T>` everywhere state is read; `pay_prizes` remaining accounts go through `Account::try_from` (owner + discriminator) plus pool/player binding; recipient wallets are pinned to committed winners / `entry.player` / `config.platform_wallet`. |
| 3 | PDA seed collisions (TM-401) | ✅ Six distinct prefixes; pairwise-distinctness and derived-address tests in `state.rs`. |
| 4 | Arbitrary CPI targets | ✅ mpl-core pinned by address constant; System via `Program<System>`; all transfers through the one `vault.rs` chokepoint (CI-enforced); Switchboard owner-checked (IR-2). |
| 5 | Integer overflow / underflow (TM-403) | ✅ `u128` intermediates in prize math; `checked_add` on counters that can grow; counter decrements proven non-underflowing (a zero-count class is unselectable by the cumulative walk); workspace `overflow-checks = true` applies to the SBF release build. Vault-model fuzz (10k sequences) + exact-division tests. |
| 6 | Re-initialization | ✅ Anchor `init` on config/pool/entry (no `init_if_needed` anywhere); pool ids monotonic via `next_pool_id`; VRF write-once vs a zero sentinel that a real reveal cannot collide with. |
| 7 | Account revival / closing hazards | ✅ No `close` anywhere; the two system-owned PDAs reap only by draining to exactly zero via computed amounts. |
| 8 | Sysvar spoofing | ✅ Instructions and SlotHashes sysvars pinned by `address =`; ed25519 packet read from the sysvar with self-referential offset checks (cross-instruction references rejected). |
| 9 | Duplicate / aliased accounts in a batch | ✅ `paid_mask` bit per rank + winners pairwise-distinct at commit + `entry.settled` write-back via `exit()` makes an aliased Entry fail on the second touch. |
| 10 | Missing state-machine gates | ✅ Every handler starts from an explicit `PoolState` requirement; the full matrix is exercised by the LiteSVM suites (65th entry, pay-before-commit, commit-before-reveal, refund-before-deadline, double-everything). |

## Compute + size

- `anchor build`: our stack frames clean (the one over-limit frame found in
  `Register::try_accounts` was fixed in Phase 1 by boxing); remaining
  stack warnings are dead mpl-core deserializers, documented in Cargo.toml.
- `register` (the heaviest instruction: sha256 digest + bag draw + mpl-core
  mint CPI + two transfers + packet parse) executes inside LiteSVM's default
  per-instruction budget; exact CU numbers land in `docs/devnet-rehearsal.md`
  with the 5.4 load run.

## Standing property checks (CI, every push)

- `system_program::transfer` appears only in `vault.rs`; `vault_debit` call
  sites pinned to `pay_prizes/escrow/refund`; `fees_debit` to
  `register/refund` (standing rule 6).
- No `class` token anywhere in the scoring path (standing rule 5).
- Forbidden-vocabulary grep (PID §8.7) over the whole tree.
- Greps that must stay empty forever: `frozen: false`,
  `UpdateCollectionPluginV1` (the no-thaw doctrine, `pass.rs`).
