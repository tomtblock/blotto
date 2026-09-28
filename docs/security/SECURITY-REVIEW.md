# Security review summary

**Status.** Blotto Cup runs on Solana **devnet only**, with devnet SOL and no real money
(program `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`). A mainnet launch is gated on legal
review and the checklist in [`../ROADMAP.md`](../ROADMAP.md). Everything below comes from the
project's own reviews, and none of them is an independent audit: under decision `R5`, the internal
program review stands in for one before launch, and an independent audit follows after ten settled
mainnet pools.

This page summarises those reviews: what each one read, the threat model, how the on-chain money
invariants are enforced and tested, what was found and fixed, and what is still open. To report a
vulnerability, see [`SECURITY.md`](../../SECURITY.md).

---

## 1. Reviews and their method

| Review | Date | What was read | Method |
|---|---|---|---|
| **Repository review** | 2026-09-07 | The whole repository: the program, the backend services, the frontend, tests, scripts and documents | Every suite and gate run first as a baseline, then a dead-code pass, a pass for contradictions between constants and claims, and an adversarial read of the money paths and the public surfaces. Every claim was checked against code |
| **Pre-mainnet program review** | Before 2026-09-11 | `programs/blotto_cup/` only, against the four carried threat-model entries (§2), the vault-invariant suite and a ten-class Anchor vulnerability checklist | Line-by-line review of each instruction's accounts, signer checks, arithmetic and state gates |
| **Cold-read review** | 2026-09-11 | 338 of 439 source, test, migration, CI, script and deploy files (77%). 100% of the program and crates, backend services, migrations, CI workflows and deploy files; 74% of app source; test files sampled | Reviewers new to the codebase, one per area and slice of the tree, required to cite line numbers. Every finding went to a second reviewer who saw only the finding and was told to refute it. 20 findings were refuted and 81 were lowered in severity. None was raised |

**Limits the cold read stated itself.** It could not see branch-protection settings or the live
deployment's configuration. It did not profile compute units, scan dependencies against a live
advisory database, or assess legal questions. Vendor failure modes were read from the project's
adapters, not observed. Its test-suite assessment is a sample, not a census.

## 2. Threat model

The system is built so that the operator can be checked, not trusted. Each boundary below lists
what it can and cannot do if it goes wrong.

| Boundary | What it holds or decides | What it cannot do |
|---|---|---|
| **The program and prize vaults** | Every lamport. Each pool's fixed pot sits in its own vault PDA from the moment the pool opens, before any entry is sold. Entry payments go to a separate platform treasury PDA | There is no instruction that withdraws from a prize vault, no admin escape hatch and no recover-funds path (§3) |
| **The operator backend** (entry service, indexer, settlement daemon, review service) | Signs entry packets. Stores sealed ciphertexts. Seals, scores and settles pools. Commits the results root and the payout list | It cannot read an allocation before the pool closes (sealing, below). It cannot pay a prize to itself or to the treasury. The program checks that a committed payout list sums to the pool's pot, has the right length and uses in-range, strictly ordered seats. **Who is paid what** is checked by recomputation: the pool secret, every sealed entry and the scoring engine are published, and the verify page recomputes the ranking and checks the roster against the chain |
| **Sealing keys** | Each pool has its own X25519 key. The browser encrypts the player's battles to it before payment, and only `sha256(battles ‖ salt)` goes on chain. The hash of the pool secret is committed at `open_pool` | The key's export policy prevents reading plaintext before the pool closes. After close the secret is revealed on chain, checked against the committed hash, and every entry becomes publicly checkable against its on-chain commitment |
| **Reviewers** (two members in `config/reviewers.json`) | Can flag a winning entry for fair-play review, which holds that share in escrow | Cannot move lamports. Upholding a flag (`forfeit_escrow`) requires the admin multisig and moves nothing. The share stays in the pool's vault and passes only to the next eligible player. If no decision lands within the published 12-hour review window, the share is released to its player. An appeal is decided by a different registry member |
| **The client** (browser app) | Enforces the allocation shape at submission and seals the payload | The program never sees an allocation, so it cannot enforce the shape. The scoring engine enforces it again at reveal: a malformed or unreadable sealed set scores as all losses and is published as such, and settlement does not halt |

**Carried threat-model entries.** Four entries from the design's threat model remain in force:
PDA seed collision (TM-401), missing signer checks on privileged instructions (TM-402), integer
overflow and truncation (TM-403), and failure or compromise of the randomness oracle used for the
cosmetic class draw (TM-502). Only the class draw uses randomness, and the class is cosmetic: no
scoring, payout or ranking input reads it, and CI enforces that (§3).

## 3. On-chain invariants and how they are enforced

| Invariant | Enforcement | Test or check |
|---|---|---|
| **No withdraw path from a prize vault.** Vault lamport exits are exactly `pay_prizes`, `release_escrow`, `pay_next_place` (all pay players) and `trigger_refund` (the untouched pot of an unplayed pool returns to the treasury). Once a pool plays, its prize is only ever paid to players. `forfeit_escrow` moves nothing | All lamport movement goes through two debit helpers in `programs/blotto_cup/src/vault.rs`. `system_program::transfer` appears nowhere else | `scripts/check-standing-rules.sh`, on every push. It allow-lists the files that may call each helper, then enumerates **functions**: every function that calls `vault_debit` or `platform_debit` must be one of seven named `file:function` pairs. A call site the extractor cannot place fails the check. It also asserts that `escrow.rs` cannot address the treasury, that `forfeit_escrow` moves no lamports, and that `register` credits no vault. The script tests itself first against a probe tree that breaks every rule |
| **Treasury exits are bounded.** The treasury's exits are `open_pool` (pot into a vault), `refund` (each entry repaid in full on an unplayed pool) and the admin-gated `withdraw_platform` | `withdraw_platform` is refused on chain below a floor: the minimum balance, plus one pot and rent cushion per idle enabled tier, plus every refundable entry | Same script (check 6(e)). LiteSVM `treasury_gates.rs`. The property model in `programs/blotto_cup/tests/vault_model.rs` |
| **Pots are fixed, never derived** | A tier's pot is a configured constant copied onto the `Pool` at open | Standing-rules check 6(g) fails on pot arithmetic over entries or balances |
| **Distinct PDA seed prefixes** (TM-401) | Six prefixes: `config`, `platform`, `pool`, `vault`, `entry`, `pass_collection` | Pairwise-distinctness and derived-address tests in `state.rs` |
| **Signer checks on privileged instructions** (TM-402) | Admin instructions use `Signer` plus `has_one = admin` (the admin is a multisig vault). Settlement instructions use `has_one = settlement_signer`. `open_pool` accepts only the configured keeper. Each permissionless instruction is justified where it is defined (write-once, state-gated, or pays a fixed recipient) | Negative tests for every admin instruction and the settlement path (LiteSVM `gates.rs`, `keeper_and_timing.rs`) |
| **Checked integer math** (TM-403) | No floats anywhere in on-chain or scoring math. `u128` intermediates in prize arithmetic, `checked_add` on growing counters, and saturating (not wrapping) down-casts on floors. `overflow-checks = true` in the workspace release profile, which applies to the deployed build | 10,000-sequence vault property test, exact-division tests |
| **Vault dust and rent cushion** | `open_pool` funds each vault with the pot **plus** the runtime's rent-exempt minimum for an empty account, read from the network at open. Both debit helpers refuse any transfer that would leave an account between zero and rent-exempt (`WouldStrandRentBalance`). A lamport donated to a vault can no longer freeze its payout or refund | Rust unit tests. LiteSVM `vault_dust.rs`: a vault with a donated lamport still pays and still refunds. Also shown on devnet: a pool whose vault held a donated lamport refunded in full and closed |
| **Other Anchor classes** | Typed accounts wherever state is read. `remaining_accounts` checked for owner, discriminator and pool/player binding. mpl-core pinned by address. Sysvars pinned by `address =`. No `init_if_needed` and no `close`. Every handler requires an explicit `PoolState` | LiteSVM lifecycle, double-payment, fill-rule and state-matrix suites (`tests/litesvm/tests/`) |
| **Pass cannot be transferred** | Passes are minted frozen. No instruction can unfreeze one | Standing greps that must stay empty: `frozen: false`, `UpdateCollectionPluginV1` |
| **Class is cosmetic** | Nothing in the scoring path or `pay_prizes` reads class | Standing-rules rule 5: a whole-word grep for `class` over `backend/scoring/` and `pay_prizes.rs` |
| **Upgrade safety** | Before any program upgrade, `scripts/admin.ts pools --upgrade-preflight` must report no pool mid-settlement (Sealed, Scored, Refunding) and none taking entries | `scripts/drain-verdict.ts --self-test` runs in CI and proves the pre-flight still refuses |

The compiled program is tested by the LiteSVM suite (`on-chain` workflow). The standing-rules lane
of `ci-fast` runs 15 checks on every push, including the language gate, the structural greps
above, the upgrade pre-flight self-test and a Rust-to-TypeScript mirror check. Dependency
advisories run in `security-sweep` (blocking for Rust). Secret scanning covers the checkout and
the git history.

## 4. Findings and fixes

### 2026-09-07 repository review

- **1 high, program, fixed.** Under a liveness fallback, a non-keeper could open a tier's first
  pool and choose its sealing key. That pool could take entries that no instruction could then
  settle or refund. The fallback has since been removed: only the configured keeper may open a
  pool (`open_pool.rs`, `NotKeeper`).
- **Operational promises published before they were built** (a resolving state, sanctions
  screening of winners, a 12-hour review clock, an appeal route). All four have since been built.
  `app/src/copy/published-claims.test.ts` now fails the build when a published promise has no
  artefact behind it.
- **Smaller fixes:** a false claim that the program enforces the allocation shape; a stale
  exit list in `vault.rs`'s own documentation; a mainnet-guard helper that was never called; an
  unchecked TypeScript mirror of the program's constants (now compared by CI); a truncating cast
  on a treasury floor (now saturating, the safe direction).

### Pre-mainnet program review

- **IR-1, fixed.** Permissionless pass-collection creation accepted caller-supplied metadata.
  Metadata is now derived on chain.
- **IR-2, accepted.** The randomness owner check accepts either cluster's oracle program ID.
  An attacker cannot fabricate data owned by either program, and the draw decides only the
  cosmetic class. A build flag pinning a single ID is a hardening option.
- **IR-3, reversed and fixed.** Donated lamports to a vault were first judged harmless. The
  cold read showed that a single donated lamport froze the vault, because the runtime refuses a
  balance between zero and rent-exempt. This was fixed with the rent cushion (§3).
- **IR-4, accepted by design.** A held share depends on the settlement signer to release it.
  Two mitigations: the daemon releases it at the 12-hour review window, and the program allows
  anyone to release it after seven days. Inaction pays the player, never the operator.
- **Anchor checklist:** all ten classes addressed (§3).

### 2026-09-11 cold-read review

236 verified findings: **4 critical, 16 high, 118 medium, 98 low.** 20 more were refuted.

| Severity | Status |
|---|---|
| Critical (4) | **All fixed**, each with a test that fails on the old code |
| High (16) | **15 fixed.** The last is half fixed: settlement now refuses a field with too many unreadable entries, but a backup and restore procedure for sealed entries is still open (§5) |
| Medium / low (216) | Worked in batches. Many are closed. The rest are tracked, and a set of program-side items waits for the next program upgrade (§5) |

The significant fixes:

- **Critical: sealed entries stored under one key and read under another.** Every entry would
  have scored as missing. The store and the crank now use the same pool id, proven by a test that
  posts through the HTTP route and reads back through the crank.
- **Critical: unauthenticated ciphertext overwrite.** Anyone could replace another entrant's
  sealed allocation. Writes now require the player's Ed25519 signature over the pool, wallet and
  exact bytes. The pool must still be open, and a different allocation for a paid seat is
  refused. A later refinement (the "seal lock-out" fix) lets a wallet replace an abandoned attempt
  whose seat was never registered, and fails closed when it cannot tell. Verified in
  `backend/packet/src/ciphertexts.ts`.
- **Critical: payouts could never land.** The client sent an account read-only where the program
  requires it writable. Fixed, and a test now compares every client instruction builder's
  writable accounts against the program's Rust definitions.
- **Critical: one donated lamport froze a vault.** Fixed by the rent cushion (§3). Deployed and
  shown on devnet.
- **High, settlement integrity:** the crank now refuses to settle if it read fewer entry accounts
  than the pool's entrant count, or if unreadable entries exceed a set ceiling. It publishes the
  bundle after paying rather than before. A sanctions screener that cannot answer now retries and
  no longer places a permanent hold. An upheld review can no longer be overtaken by the 12-hour
  release clock. The verify page checks the published roster against the chain.
- **High, availability and hygiene:** the webhook checks its secret before buffering a body and
  caps body size. Indexer backfill replays events in chain order. Geo lookups are no longer spent
  on unauthenticated page views. Sign-in and appeal screens show a way out when a dependency is
  down. The archive labels as "verified" only the fields the on-chain results root commits to
  (player, rank, amount).

### Devnet trial (operational)

The devnet trial ([`../testing/TESTING-REPORT.md`](../testing/TESTING-REPORT.md) §5) produced two
findings about deployment and logging rather than the program:

- **A deploy that could not see its own failure, fixed** (finding 5.8). On the
  development-credentials path, the entry service kept using the vendor location lookup because
  the vendor credentials were still set on the app and take precedence. The run's smoke checks
  passed regardless. The deploy workflow now clears the credentials it replaces, for both the
  location lookup and the entry signer, and reads the `/geo` answer instead of only its status
  code (PR 174).
- **A credential in a boot log, fixed; rotation pending** (finding 5.9). A service logged its RPC
  endpoint including the provider credential. The line now redacts it
  (`urlForLog` in `backend/_shared/src/short.ts`, called from `backend/detection/src/main.ts`,
  with tests). The credential is being rotated, after the redaction shipped so that the new one
  never reaches the log.

## 5. Open items

- **No independent audit yet.** Under decision `R5` it follows after ten settled mainnet pools; the
  internal program review stands in for it before launch. Legal review is a precondition for
  mainnet.
- **Upgrade authority and custody.** On devnet the program's upgrade authority is a single
  operator key. `config/custody.json` records that it moves to the multisig before mainnet. That
  multisig is currently 1-of-1 with no upgrade timelock set. Both are mainnet preconditions, and
  the public custody page shows the current values.
- **Program-side hardening batch not yet shipped.** Medium and low program findings from the
  2026-09-11 review are scheduled for the next program upgrade. One example: an on-chain check of
  who is paid what. Today the program checks the payout list's total, length, seat range and
  order, and recomputation from published data catches a wrong recipient.
- **Remaining medium and low findings** from the 2026-09-11 review are open across the backend,
  app, CI and tests. This page does not give an item-by-item count.
- **Settlement key.** The settlement signer is a software key held by the settlement service.
  Hardware-backed co-signing is not built.
- **Sealed-entry backup.** A rehearsed backup and restore procedure for the off-chain store of
  sealed entries is not yet in place. The crank's unreadable-entry ceiling limits the damage but
  does not replace a backup.
- **IR-2** (§4) remains an accepted risk.
- **RPC credential rotation** after finding 5.9 is an open operator action.
- **The Android package** (D-E18, 2026-09-28). The app-side changes were reviewed with the change:
  the mobile wallet library is loaded on Android only and registers into the existing wallet
  registry; the response headers admit a plain WebSocket to the loopback only (pinned by test); the
  build check fails open on an unreachable version route, by design, and is stated as such. Open:
  the package's signing key is a new long-lived secret held by hand
  ([`../guide/MOBILE.md` §4](../guide/MOBILE.md#4-the-signing-key)); a WebView has no address bar or
  browser interstitials, so the shell's own navigation allow-list (that it opens only our host and
  hands other links to the system browser) must be confirmed on the generated project before any
  submission; and the third-party library's transport has not been reviewed beyond its published
  source.
