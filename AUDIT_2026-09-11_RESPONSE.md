# Audit response — 12 September 2026

The record of what changed after [`AUDIT_2026-09-11.md`](AUDIT_2026-09-11.md), side by side with
what the audit found, and an appraisal of where the system stands. Everything here is on branch
`claude/nice-turing-k0ipl5`: fourteen commits after the audit commit `1fcd181`, 78 files,
4237 lines added and 305 removed, 69 new TypeScript test cases (one of them
parameterised over all seventeen instruction builders) and 8 new Rust tests.

## The short version

- The audit's verdict was **DO NOT SHIP**, on four CRITICAL findings. Each one on its own stopped
  money from moving correctly: sealed entries were stored where nothing could read them, anyone
  could overwrite anyone's sealed entry, no pool could ever be paid, and one lamport sent to a
  vault froze the pool for ever. **All four are closed in code**, each with a test that fails on
  the code as it was.
- **Twelve of the sixteen HIGH findings are closed.** Four remain open: one the audit deferred
  pending a decision (B-07), and three the audit found but left out of its own fix list (D-02,
  D-03, F-02). They are listed below with what each needs.
- The eight Tier 3 hygiene items are done. The 118 MEDIUM and 98 LOW findings are untouched except
  where a Tier 3 item happened to close one.
- **Every gate that can run in this environment is green**: both vocabulary and standing-rules
  gates (each now with a self-test), the env-example gate, `cargo fmt`, `clippy -D warnings`,
  the Rust workspace, all nine backend suites (573 cases), the offline twenty-pool rehearsal (25),
  and the app's lint, typecheck, 380 unit tests and production build.
- **Two things cannot be verified here and must be before anyone relies on this.** The on-chain
  test suite needs `anchor build` on a machine with the toolchain — the harness now fails loudly
  instead of passing when the build is missing, which is what it did here. And the B-03 fix
  changes the program: the deployed devnet program still funds each vault with the pot alone, so
  the one-lamport exposure is live on devnet until the program is rebuilt, redeployed and
  rehearsed.
- **My appraisal: not yet shippable, but now testable.** The four ship-blockers are out of the
  code. The next gate is a real one — a devnet rehearsal on the redeployed program with the
  on-chain suite green on a real build — and it is the first end-to-end execution this system will
  have had with the entry, settlement and payout paths all working at once.

## Side by side

Findings are the audit's IDs. "Before" is what was true on the audit commit; "After" is what is
true on this branch; "Proof" is the test that would fail if the fix were reverted.

| # | Finding | Before | After | Proof | Commit |
|---|---------|--------|-------|-------|--------|
| 1 | **B-01** CRITICAL (and B-08 HIGH) | The entry service stored each sealed allocation under a hash of the pool's address; the crank, the read API and the next-place driver all read by the pool's numeric on-chain id. Every pool would have settled with its whole field scored as all losses, and the sealed-entries route always answered empty. | `backend/packet/src/pool-ids.ts` resolves the address to the numeric id from the indexer's own `pools` projection, deliberately uncached; the local hash is deleted; an unknown pool is refused (400) rather than written under a guessed key. | `entry-seam.spec.ts` posts through the route and reads back through the crank's `revealEntries`; `allLosses` is empty. Fails on the old code. | `3903dc6` |
| 2 | **B-02** CRITICAL (and D-01 HIGH) | `POST /ciphertexts` took a sealed allocation for any wallet from anyone, and the store's write was an upsert: an attacker could replace any entrant's sealed entry with random bytes and win every battle against it, and a player starting a second run destroyed their own paid entry. | Three gates: the pool must be known and still Open; the body must carry an Ed25519 signature by the player over a canonical message binding pool, wallet and a digest of the exact bytes; a different allocation for a seat that already has one is refused (409) while re-posting identical bytes stays idempotent. The browser signs before it posts. | Attacker signing the victim's message → 403; unsigned → 403; overwrite → 409; sealed pool → 409; the legitimate path → 204. | `d42a47c` |
| 3 | **A-01** CRITICAL | The settlement client sent the Config account read-only on `pay_prizes` while the program declares it `mut`. Anchor rejects that before the handler runs, so every payment batch reverted: no pool could ever be paid and no tier slot ever freed. | One word (`isWritable: true`) — and the durable half, `account-metas.spec.ts`, which parses every `#[derive(Accounts)]` struct in the program and every builder in the client and compares the writable sets across the language boundary; a builder nothing compares is itself a failure. | Nineteen cases; the `payPrizes` case fails on the old line. | `d29464d` |
| 4 | **B-03** CRITICAL (and B-17 LOW) | A vault held exactly the pot and every exit drained a computed amount, so one donated lamport left a final balance of 1, which the runtime refuses (a zero-data account may end at 0 or at rent-exemption, never between). The pot froze, the tier died, and the internal review had accepted the scenario as harmless. | `open_pool` funds the pot plus a rent cushion (890,880 lamports, about 0.00089 SOL, which stays in the vault); both debit helpers assert the post-balance lands on zero or at rent exemption, with a named error `WouldStrandRentBalance`. A cushion rather than the audit's sweep, because a sweep needs each caller to know which debit is last and a wrong guess breaks a partial payment. | Four Rust unit tests including "without the cushion a single lamport is fatal"; `vault_dust.rs` (the harness models the rule; a poisoned vault still pays; still refunds) and `artifact_present.rs`, so a missing build fails instead of passing. **Compiles; cannot execute here. On-chain change; not deployed.** | `706a6c0` |
| 5 | **B-09** HIGH and **F-01** HIGH | The crank never compared the entry accounts it read against the pool's entrant count; a lagging RPC settled the pot against a short field, permanently. Nothing bounded how many sealed entries could be unreadable before commit. | Settlement refuses unless the read matches `entrants`, in `crankPool` and in `recomputeRanking` (the next-place path); and refuses when unreadable entries exceed a ceiling. The ceiling defaults to "all but one" — the ratified threshold is the founder's — through the `maxUnreadableEntries` seam. | Crank cases: incomplete field; wholly unreadable field; `ranking-field.spec.ts`. | `12d3cab`, `f38389c` |
| 6 | **C-01** HIGH | The bundle was published to Irys before commit and pay; a persistent publish failure stranded a Sealed pool, which has no refund path. An empty upload wallet was discovered at the first settlement. | Publish moved after `pay_prizes` and recorded as a non-fatal `publish-failed` step, so the pool still reaches Paid. The daemon checks the upload wallet's balance at startup: refuses on mainnet below 0.01 SOL, records on devnet where uploads are free-tier. | "publishing keeps failing" still reaches Paid; three upload-wallet cases. | `a7e54cd`, `f38389c` |
| 7 | **C-02** HIGH | A screener that merely could not answer was treated as a match: an on-chain hold on the winner's share, which nothing ever revisited. | `screening_unavailable` stops the settlement before any hold is placed and is retried next tick; a real list match still holds. One earlier commit of mine had left a test red for a tick; fixed in the next, with the test's real intent ("nobody is paid unscreened") kept. | Crank cases: screening outage; real match still holds. | `90baa90`, `4cbc8bc` |
| 8 | **B-05** HIGH | The backfill replayed an order-dependent projection newest-first; on a first boot every settled pool ended marked Open and empty. | `backfillAndRederive` replays the ledger in chain order after any insert. | Three cases, one of which proves the raw walk corrupts the rows (so the fix's test cannot pass vacuously). | `cd74248` |
| 9 | **B-04** HIGH | One paid geo vendor; the unauthenticated `/geo` spent a credit per unseen address on every page mount; exhaustion refused every entry until the vendor reset, with no alert. | An ordered composite with a second-source seam (`GEO_VENDOR_2_*`), monitor events and alerts for quota, credential and total failure, a spending ceiling whose issuance reserve the pre-flight cannot touch (`GEO_DAILY_CAP`, `GEO_ISSUANCE_RESERVE`), the packet service wired to the shared monitor, and a five-minute tab memo of an allowed answer in the browser. Fail-closed unchanged. | Fifteen cases plus four; a quota error raises the event and the alert; the composite falls through; the pre-flight stops first while issuance keeps its reserve. | `f5df4ff` |
| 10 | **C-03** HIGH and **C-04** HIGH | A silent sign-in provider left the app "initializing" for ever with no control anywhere; a missing or unreachable review service rendered nothing for a forfeited player on a seven-day clock. | A ten-second deadline falls through to a named `unreachable` state — the header shows the sign-in link, the sign-in page explains, a late provider still wins. The appeal read returns a discriminated result and the panel renders each ending: not configured, unreachable with a retry control, or the form. | Twenty-two cases, including the header and the panel rendered with `react-dom/server`. | `d16ef03` |
| 11 | **F-03** HIGH | The verify page never checked that the bundle's roster was the chain's roster; a bundle missing the last entrant passed every row. | A `roster` row runs first: same players, same count, none twice, indices a permutation. | The dishonest-operator case: roster red, every other row green. | `70971f8` |
| 12 | Tier 3: **B-06** HIGH, G-08, D-23, A-12/G-09/G-23, A-13, E-11, B-33 | The standing-rules gate passed when the program directory was missing; the drift check overclaimed; red-main automation watched one lane of three; the read API trusted proxy headers unconditionally; an unset database URL became localhost; the webhook buffered any body before checking the secret; the deploy job took a third-party action from a mutable branch with no permissions block. | Each closed as described in commit `cbb3032`; the standing-rules gate now tests itself on a probe tree that violates every rule. | Standing-rules self-test; webhook socket test (401 before the body, 413 over the cap); database config test. | `cbb3032` |

## What was deliberately not done

The audit's own instruction was to defer these, and each needs a decision before code:

- **B-07 — the archive serves three fields the Merkle root does not cover.** Fixing it properly
  changes the committed leaf, which is a program change and a compatibility break.
- **B-22 — a second reviewer.** With one member in `config/reviewers.json` no appeal can be decided.
  Adding a member is a business decision.
- **The detection pipeline being inert.** Whether detection acts or only reports is a product
  decision recorded as open elsewhere.
- **Dead code.** Roughly thirty unreachable modules and keys; a separate pass so nothing important
  hides in a deletion diff.
- **The on-chain deploy.** Commit 4 changes the program; deploying it is a sequenced operation with
  its own runbook.

## Found by the audit, not in its fix list, still open

- **D-02 (HIGH) — the verification journey cannot complete in the deployed system.** ~~The daemon's
  bundle announce is never staged (`BLOTTO_INDEXER_ANNOUNCE_URL` and the webhook secret are not set
  for the daemon app) and `archive-backfill` is invoked by nothing, so no player is ever shown the
  bundle address. This is a deployment change plus one scheduled job.~~ **Closed 2026-09-12 in the
  Wave 0 PR** — see the addendum below. Shown closed on devnet only after the next backend deploy
  settles a pool and `GET /pools/<id>/archive` returns its bundle (plan §7).
- **D-03 (HIGH) — the twelve-hour auto-release ignores an upheld review.** The daemon never reads
  `review_decisions`, so between a reviewer's forfeit decision and the multisig landing it, the
  clock can release the share. The daemon needs a handle on the decision log before it releases.
- **F-02 (HIGH) — no backup posture for the sealed entries.** The settlement-threshold half is now
  the `maxUnreadableEntries` seam; the backup and rehearsed restore half is operational work.
- **A-34 (LOW)** — ~~the standing-rules gate enumerates files, not instructions; the rewrite kept that.~~
  **Closed 2026-09-12** — check 6(i) enumerates functions (addendum below).

## Numbers I chose that are the founder's to ratify

Each is a default with an override and a `PHASE-N-REVIEW` note in the code, never a constant.

| Where | Value | Why this default |
|-------|-------|------------------|
| Unreadable-entry ceiling before commit | all but one entry | A logical boundary, not a policy; `maxUnreadableEntries` takes the ratified figure |
| Geo spending ceiling and issuance reserve | off until `GEO_DAILY_CAP` is set; reserve a quarter of it | The vendor's cap is a property of the operator's plan; the split is a judgement |
| Second geo vendor | seam only (`GEO_VENDOR_2_*`) | R2 names the vendor of record; with one source an outage still stops entry, and the startup line says so |
| Sign-in deadline | 10 seconds | Longer than the 8-second geo ceiling, short enough to explain a blocked network; a wrong value costs seconds, never a dead end |
| Upload wallet floor (mainnet) | 0.01 SOL | Orders of magnitude over one upload; the point is discovery at startup |
| Rent cushion per pool | 890,880 lamports (≈0.00089 SOL) | The runtime's own figure; it stays in the vault, so about 0.9 SOL per thousand pools |
| Five copy lines | sign-in "connecting" and "unreachable"; appeal "unreachable" and "try again"; the panel's "not configured" now reachable | Drafts in the file's own register, marked for the founder's voice |

## Verification

Run from the repository root in this session, on the final commit.

| Check | Result |
|-------|--------|
| `scripts/check-language.sh` | clean, self-test passed |
| `scripts/check-standing-rules.sh` | clean, self-test passed (new) |
| `scripts/check-env-examples.sh` | every env read has an example entry |
| `cargo fmt --all -- --check` | clean |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo test --workspace` | 59 passed |
| nine backend suites | 573 passing (shared 68 · packet 121 · indexer 61 · reveal 120 · sealing 13 · sanctions 53 · scoring 97 · detection 30 · class-digest 10) |
| `tests/rehearsal` (offline twenty-pool settlement) | 25 passing |
| app: `eslint`, `tsc`, `vitest`, `next build` | 0 errors (one pre-existing warning in `rules.config.ts`, untouched), clean, 380 passing, build clean |
| `tests/litesvm` (the compiled program) | **cannot run here** — no build toolchain, no artifact; `artifact_present` fails by design |
| `scripts/check-deployed.ts` (devnet drift) | **cannot run here** — needs the cluster |

## Overall appraisal

**What was broken was the spine, and it is fixed in code.** Money went into the treasury, but the
sealed entry was written where nothing could read it, nobody could ever be paid, and a stranger
with one lamport could freeze a pool. None of those is a corner case; each was the ordinary path.
All four are closed, and closed the way the audit asked: with a test that fails on the old code, not
a test that agrees with the new one.

**The system is structurally healthier than the findings alone suggest.** The audit's central
observation was systemic: 121 test files and none crossed a process boundary, so a route could
write with one key and a crank read with another and every suite stayed green. Three tests now
cross a boundary on purpose — the entry service into the crank, the client's account metadata into
the program's Rust, and the backfill's order into the projection — and the two CI gates that could
pass while checking nothing now check themselves first. The failure mode the audit named cannot
recur in the same shape without one of those going red.

**What is unchanged is still real.** Nothing in this branch has run against a deployed program that
carries the rent cushion, and the compiled-program suite has not executed on a real build in this
session. The deployed devnet program still has the one-lamport exposure until it is rebuilt and
redeployed. Three HIGH findings and five deferred items remain, and the 216 MEDIUM and LOW findings
are as the audit left them, bar the Tier 3 overlaps.

**Not yet shippable; now testable.** The honest next gate is not another read of the code. It is:
build the program, run the on-chain suite green, deploy to devnet, run a full rehearsal through the
real front end, and watch a pool go from open to paid with a verify page that agrees. That will be
the first time this system has executed end to end with entry, settlement and payout all working at
once — and it will either confirm this branch or find the next thing. Then B-07, D-02, D-03 and
F-02 need their decisions before a mainnet conversation starts.

## Addendum — what CI showed (2026-09-12, 02:52Z)

The PR for this branch (#106) ran the one suite this session could not: `anchor build + litesvm`,
against a program built from this source. It took three rounds, and each found something.

1. `9689206` — the `node` lane's typecheck rejected a test helper (TS7022) in a spec that had only
   been run, never typechecked.
2. `cbb0bec` — the on-chain lane's first run: two fixtures funded the treasury with exactly one pot,
   and an open now costs the pot plus the cushion. Reading the rest exposed a flaw in the cushion
   change itself, not just in the fixtures: the treasury policy reserves one pot per idle tier so the
   next pool can always open, but the reserve counted the pot alone and so fell short by exactly one
   cushion per pot — the ladder test's exact-threshold property would have failed. `idle_tier_reserve`
   now counts the cushion: a reserved pot is an openable pot. The withdraw floor shares the function
   and rises by the same amount, which is the safe direction. Every exact-pot fixture was fixed and
   the lane runs `--no-fail-fast`, so one cycle shows the whole board.
3. `4bc8692` — the second run passed every binary, **both dust-attack tests included** (a poisoned
   vault still pays the winner; still refunds), and failed only the harness-capability probe, which
   had made the probed account its own fee payer, so the runtime's fee-payer rent check fired before
   the transfer was judged. A funded bystander pays the fee now, the refusal must be the rent error
   by name, and both balances are checked afterwards. Green.

So the verification table above changes in one row: the compiled-program suite **ran green in CI**
on `4bc8692`, 48 tests across twelve binaries. What has not changed: the program is still not
deployed, and the proptest model in `programs/blotto_cup/tests/vault_model.rs` still moves the pot
alone (a drift since the cushion commit, marked `PHASE-N-REVIEW` rather than folded into a CI fix).
The appraisal stands: not yet shippable; now testable — and now tested on a real build.

## Addendum — Wave 0 of the plan (2026-09-12)

The founder approved the plan in `AUDIT_2026-09-11_PLAN.md` on 2026-09-12. Its Wave 0 has six
items; the three that need only the architect landed in the PR that added the plan, in one commit
each. What each closes, and the test or command that shows it:

| Audit id | What changed | Shown closed by |
|---|---|---|
| B-08's wiring (plan §5) | `BLOTTO_MAX_UNREADABLE_ENTRIES` reaches `CrankDeps.maxUnreadableEntries` through `parseUnreadableCeiling` (`backend/reveal/src/startup.ts`). Unset on devnet = the crank's default, printed at boot; unset on mainnet = the daemon refuses to start. The deploy stages it from a repository variable of the same name | `backend/reveal/test/startup.spec.ts` — five cases (whole number through, zero accepted, devnet default named, mainnet refusal named, malformed refused on any cluster) |
| D-02 / A-08 / C-24 / D-24 / E-08 | `deploy-backend.yml` stages `BLOTTO_INDEXER_ANNOUNCE_URL` (the indexer's webhook service, port 8080) and the indexer's own webhook secret for the daemon, clearing a stale pair with a `::warning::` when the repository secret is absent; `indexer-backfill.yml` gains an `archive-backfill` mode and a daily schedule; the daemon's "announce OFF" is graded by `announceVerdict` — a warning on devnet while bundles are being published, a refusal on mainnet, and `bundleAnnounce` on `/health` | `startup.spec.ts` — four cases (ON names the URL and never the secret; OFF-while-publishing warns on devnet naming the missing variable and the fallback; refuses on mainnet; OFF-with-nothing-published is only a fact). Both workflows parse. Closed on the cluster only when a settled pool's archive fills — plan §7 |
| E-07 (the documentation half) | `KEEPER_KEYPAIR` and `BLOTTO_INDEXER_ANNOUNCE_URL` in `backend/.env.example`, with the new ceiling. The gate's blindness to `env.X` reads stays in batch C1 | `scripts/check-env-examples.sh` green |
| A-34 | `scripts/check-standing-rules.sh` check 6(i): every top-level fn body in `instructions/*.rs` that calls `vault_debit(` or `platform_debit(` must be one of seven named `file:fn` pairs, and a call site the extractor cannot place inside any body fails rather than slipping past | The probe tree gains a second handler in an allowed file, a private helper and an impl-block method; the self-test asserts 6(i) names each. Bite test on the real tree: a throwaway fn in `pay_prizes.rs` (an allowed file, where 6(b) stays silent) fails 6(i) by name |
| D-43 | `app/src/app/robots.ts` refuses `/admin/` and `/dev/` to crawlers; both admin pages carry noindex metadata; `AdminGate` renders a page body only for a signed-in wallet on `config/reviewers.json` — the same list the review service checks. A door sign, not a lock | `admin-access.test.ts` (four outcomes) and `admin-gate.test.tsx` (the four rendered branches) |
| The proptest money model (plan §5) | `programs/blotto_cup/tests/vault_model.rs` carries the cushion everywhere the program does: `open_pool` funds pot + cushion from the treasury, the idle reserve and the withdraw floor price an open at pot + cushion, both ledger identities count every vault the run opened, a Paid vault ends at outstanding escrow + cushion and a Closed one at exactly the cushion, and every lamport movement passes `vault::rent_safe` — asserted on the vault, mirrored as a refusal on the treasury. The `PHASE-N-REVIEW` note is gone | `cargo test --workspace` (the ci-fast rust lane) — the eight property tests, including the new `treasury_debits_refuse_the_rent_paying_band` |
| The lint warning; the cost line | `rules.config.ts` no longer imports the unused terms file; `docs/INFRASTRUCTURE.md` prices a pool at 0.016 SOL with the 890,880-lamport cushion named | `next lint` at zero warnings |

**Found by the model, for the register.** With `treasury_min_platform_lamports` at zero the
treasury can stand at exactly `refundable + dust`, and the LAST refund of a Refunding pool would
leave it rent-paying, which `platform_debit` refuses — nothing moves until a permissionless deposit
lifts the balance past the band. R7's sum is still program-held by the floor; only the landing of
the final refund can wait. The live devnet Config holds 0.5 SOL as the minimum, which keeps the
treasury clear of the band; the LiteSVM launch policy runs it at zero. Two answers, both recorded
in the plan: for the founder's numbers (§2e), never set the minimum below one cushion; for the
program (batch P1), fold one cushion into the withdraw floor whenever `platform_refundable > 0`, so
the floor itself keeps the last refund landable. The model also does not yet drive a donation to a
vault (the B-03 vector itself); a `Donate` op with its term in the identity is a batch T1 row.

**Not closed by this PR:** the two blockers (the devnet redeploy, the credentialed rehearsal) and
the five decisions are the founder's; waves 1–5 follow the plan's order.

**Later the same day (2026-09-12, ~15:40Z):** the founder deployed the program — slot 497261524,
`check-deployed` clean, Config 484 bytes — after three tooling failures the runbook's recovery
notes now record (the loader's 10,240-byte minimum extension, macOS's 256 open-file limit, the
buffer resume). The backend redeploy and the one-lamport proof on pool 9 remain before the Wave 0
gate is met in full.

## Addendum — Wave 1, batch D1: daemon correctness (2026-09-12)

The plan's first Wave 1 batch, landed in one PR with a test per row. The daemon liveness rows the
plan listed under O1 (1.3) are folded in because they live in the same file as the tick loop.

| Audit id | What changed | Shown closed by |
|---|---|---|
| B-31 (and B-40's publication half) | Bundle version 2 carries neither `device_hash` nor `timings_ms`; detection reads them from an unpublished channel `revealEntries` returns beside the bundle rows | `crank.spec`: the stored bundle has neither key and detection still receives both; `publisher-irys.spec` pins the v2 tag |
| B-30 / C-10 / C-23 / D-26 | The review clock leaves a sanctions-held share in place instead of calling a release the program refuses; the pool stays non-terminal, nothing throws, the next-place step still runs | `daemon.spec`: held share left alone across ticks, released after the admin lifts the hold; `review-clock.spec` pins `releasableByClock` over every combination |
| D-03 (daemon half) | With `PgDecisionLog` + `appealState` wired, a share whose reviewer logged a forfeit is never released by the clock; `reveal forfeit logged but not landed on chain` fires once the window passes unlanded | `daemon.spec`: held inside and past the window, alert on the second, next-place pays once the forfeit lands |
| C-09 / B-32 / D-27 | Every upload is recorded in `published_bundles` (migration 0016); a recorded bundle is never re-uploaded; a Paid pool with no record is retried on a ten-minute backoff through `publishBundle` (no detection, screening, commit or payment) and alerted after three failures | `crank.spec`: one upload across a resume, `publishBundle` after a failed settlement upload, refused on a non-Paid pool; `daemon.spec`: backoff, alert, announce on landing |
| D-11 | `planNextPlace` reads the program's split frame (five new `ChainEntryView` fields through an `ENTRY_LAYOUT` table pinned against `state.rs`) and resumes a partial split with only the unpaid recipients | `next-place.spec`: nine FakeChain-judged cases including the regression (first portion lands, second fails, resume pays exactly the rest); `entry-layout.spec` derives every offset from the Rust struct |
| B-47 | `liftSanctionsHold` signs as the admin | `account-metas.spec`: every builder naming `admin.publicKey` as a signer sends with `[admin]` |
| C-34 | Every send carries `setComputeUnitPrice` from the shared percentile choice (moved to `_shared/src/priority-fee.ts`; the app re-exports it) via a cached sampler with the floor as fallback | `priority-fee.spec` (reveal), the app's existing `priority-fee.test` unchanged |
| C-35 / F-10 | `KeeperChain.chainNow()` reads the Clock sysvar's `unix_timestamp`; the daemon's deadline comparisons and the export policy use it, one read per tick | `entry-layout.spec` pins `clockUnixTimestamp`; the daemon's `now` is the chain's in `main.ts` |
| C-22 | Every RPC request aborts after 30 s, the announce after 10 s; a tick that still hangs is caught by the staleness rule below | `main.ts` (a wiring change; the rule it relies on is tested in `health.spec`) |
| C-05 / C-27 / E-04 / D-07 | `/health` answers 503 once no tick has completed for `STALE_TICK_MS` (fifteen minutes, PHASE-N-REVIEW); the daemon builds a Monitor from `BLOTTO_MONITOR_SINK`, serves `/metrics`, and a `reveal` metrics namespace exists; `backend-watch` probes all four services | `health.spec`: four staleness cases, the old "never fails for age" contract inverted on purpose |
| C-12 | `reveal entry refund owed after lost ciphertext` names the pool and the all-losses players; the manual's §7 says what to do with it | `crank.spec`: the alert names exactly the sabotaged seats |

**Reported, not changed (routed):** B-37 (a sanctions hold on any committed peer makes `pay_next_place`
refuse `NextPlaceIneligible` — program, batch P1); the indexer table and admin command for the
entry-refund obligation (batch I1); a `Donate` op in the proptest model (batch T1).
