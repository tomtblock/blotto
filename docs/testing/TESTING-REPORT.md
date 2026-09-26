# Testing report

How Blotto Cup is tested, what the devnet trial showed, what it found, and what has not been
tested. Everything here ran on **Solana devnet** against program
`5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`. Devnet SOL has no value, so no real money was
involved at any point.

Contents: [1 Summary](#1-summary) · [2 Method](#2-method) ·
[3 Automated suites and CI](#3-automated-suites-and-ci-lanes) ·
[4 Devnet results](#4-devnet-results-per-test) · [5 Product findings](#5-product-findings-and-status) ·
[6 Harness lessons](#6-harness-lessons) · [7 Statistical evidence](#7-statistical-evidence) ·
[8 Limits](#8-limits--what-has-not-been-tested) · [9 Raw data](#9-raw-data-appendix)

---

## 1. Summary

Seven scored tests and one shakedown ran on devnet between 2026-09-16 and 2026-09-25, all on tier 0
(entry 0.1 SOL, prize pool 4 SOL, minimum field 40, capacity 64). For every scored test, the
prediction was committed and merged **before** the pool's first entry, and was then checked
against the chain. T7's prediction is frozen and its pool has not yet filled.

| Test | Scenario | Pool | Outcome | Verdict |
|---|---|---|---|---|
| **T1** | Refund below the minimum field (12 seats) | 14 | `Closed` — 12 of 12 refunded in full | **PASS** |
| **T2** | Refund at the boundary (39 seats) | 20 | A 40th wallet from outside the plan entered, so the pool sealed and played | **SPOILED** (no verdict; recorded as an observation) |
| **T2R** | T2 retried, frozen before the pool existed | 21 | `Closed` at 39 — 39 of 39 refunded in full | **PASS on 7 of 8** criteria; the eighth was an error in the prediction, not the product |
| **T4** | Full pool — a browser wallet wins | 16 | `Paid` at 64 — browser wallet A took the whole 4 SOL, as predicted | **PASS** |
| **T5** | Full pool — a headless wallet wins | 18 | `Paid` at 64 — headless W00 took the whole 4 SOL; both browser wallets unpaid | **PASS** (8 of 8) |
| **T6** | Oversubscribed — 64 seat, 9 arrive late | 27 | `Paid` at 64 — 9 late attempts refused at the state gate, each charged only a network fee | **PASS\*** (one criterion not tested) |
| **T3** | Seal at exactly 40, plus a pause during fill | 29 | `Paid` at 40 via `seal_at_deadline` — W00 took the whole 4 SOL; the pause refused an entry with 6005 | **PASS** (every frozen criterion) |
| Pool 22 | Shakedown of T6's failure path | 22 | `Paid` at 64 — 9 s from seal to payout | Observation only, no verdict |
| T7 | Same device, a tie for first, then the review path | 36 | Plan frozen; not run | Not run |
| T8 | Verify page + independent recompute | — | — | Not run |

**Across every test that ran:**

- **Money was conserved to the lamport.** Every refund returned exactly the 0.1 SOL entry, every
  paid pool paid exactly one rank the whole 4 SOL (or split it on a tie), and every prize vault
  ended at its 650240-lamport rent cushion.
- **Every sealed allocation matched its commitment.** In T3 (40 seats) and in T4, T5 and T6 (64
  seats each), every revealed allocation re-hashes to the `battles_hash` the chain recorded at entry, and the results root
  recomputed from the published data equals the root committed on chain.
- **The winner was always the seat the allocations predicted**, including when the winner was a
  wallet with no relationship to the operator (T3, T5, T6).
- **Nine findings** came out of the trial: five are fixed in code, three are open, and one is a
  design property under review (§5).

---

## 2. Method

**Freeze before fill.** Every scored test starts as a plan file, `battle-test/registry/<test>.plan.json`.
It lists each seat's wallet, its allocation (from a seeded generator, so anyone can regenerate it),
and the predicted rank, payout and pool outcome. The predictions are **computed**, not typed: an
oracle runs the product's own scoring engine (`backend/scoring`) over the planned field, after
first checking that engine against the Python-generated vectors in
`backend/scoring/fixtures/vectors.json`.

The plan is merged through a PR, and a separate `<test>.freeze.json` records two things: the PR's
**GitHub merge timestamp** and the **sha256 of the plan bytes as merged**. A commit date can be
set to anything; a merge timestamp cannot be rewritten from this repository, and a Solana block
time cannot be rewritten by anyone. The reconcile step checks that the plan on disk still hashes to
the frozen value, and that the merge came before the first `register` landed. If either check
fails, the pool is marked `UNFROZEN` and fails, however well the money reconciles. Plans are
never edited after the freeze. If a prediction was wrong, that is the result.

**Two kinds of entrant.**

- **Headless wallets** (W00–W71) enter with `battle-test/scripts/enter.ts`. It follows the same
  path as the app's `app/src/entry/submit.ts`: seal the allocation to the pool's published key,
  store the ciphertext, obtain a signed entry packet, then send `register`.
- **Browser wallets A and B** (UI-A, UI-B) enter by hand through the deployed web app. This is the
  real player path: sign-in, the entry gate, the board and the wallet prompt. Their allocations
  are sealed and unknown until reveal. The plans therefore make only *unconditional* claims about
  them, such as "cannot finish first", derived as floor-versus-ceiling bounds that hold whatever
  those two seats play.

**Harvest.** After settlement, `harvest.ts` writes `<test>.actual.json`. It reads pool state,
entrants and results root from the indexer (which derives them from on-chain events), balances
directly from the cluster, and register signatures from the entrant log. It names the source of
every field, and it fails rather than write a partial file.

**Reconcile.** `reconcile.ts` compares plan against actual and writes `<test>.reconcile.md`. Each
seat gets one of five verdicts: `MATCH`, `RANK_DRIFT` (money as predicted, unpaid rank moved),
`PAYOUT_MISMATCH`, `INPUT_DRIFT` (revealed battles differ from the plan; expected on hand-played
seats) or `ABSENT`. It also recomputes the results root from the revealed seats and compares it
with the chain. Any `PAYOUT_MISMATCH`, or any drift on a headless seat, fails the test.

**Explorer-checkable.** Every pool below is identified by its PDA. Any of them can be inspected at
`https://explorer.solana.com/address/<PDA>?cluster=devnet`, and the registry files carry the
signatures and balances needed to redo the arithmetic.

---

## 3. Automated suites and CI lanes

The devnet trial sits on top of automated suites that run without a cluster. Most of the
settlement assertions (conservation, refund completeness, root equality, detection behaviour) run
on every change, so the devnet runs measure only what needs a real cluster: infrastructure,
timing, and real wallets.

| Suite | Location | What it proves | CI lane |
|---|---|---|---|
| Program unit tests, fmt, clippy `-D warnings` | `programs/`, `crates/` | Host-side program logic | `ci-fast` → rust (every PR) |
| LiteSVM integration (16 test files) | `tests/litesvm/` | The built SBF artifact: lifecycle, fill rule, tiers and ties, next-place payout, treasury gates, vault dust, hard mode, packet layout, double payment | `on-chain` (PRs touching program code) |
| Backend packages (`_shared`, `scoring`, `class-digest`, `sealing`, `sanctions`, `reveal`, `indexer`, `packet`, `detection`) | `backend/*` | Typecheck and unit tests per service | `ci-fast` → node |
| Offline rehearsal | `tests/rehearsal/` | Twenty 64-entrant pools settled through the real crank and detection on a simulated chain, with the pot conserved in each. Also: a pool at exactly the minimum field reaches `Paid`, detection runs in shadow mode and blocks nobody, and a pool one seat short refunds in full | `ci-fast` → node |
| Postgres stores | `tests/postgres/` | Migrations and every Postgres-backed store against a real database | `ci-fast` → postgres |
| App | `app/` | Lint, typecheck, unit tests, production build | `ci-fast` → node |
| Browser journey (Playwright) | `app/e2e/journey.spec.ts` | Landing, pool page, the entry gate's fail-closed panel and the verify page, at 375 px and 1280 px (fixture data, no credentials) | `ci-fast` → journey |
| Secret scan | gitleaks | Working tree and history | `ci-fast` → gitleaks |
| Standing rules (15 checks) | `scripts/` | Language gate, the exact set of vault exits, territory schedule, published numbers match the program, Python oracles reproduce their fixtures, Rust/TypeScript constant mirrors agree, fill-simulation self-test, deploy-gate and upgrade-preflight self-tests, and others | `ci-fast` → standing-rules |
| Test-signer bundle gate | `app/` build | The test-only signer injection is absent from a normal build and present only when deliberately enabled | `app-test-signer` |
| Skill-evidence reproduction | `tests/rehearsal` | Re-runs both strategy studies (easy and hard) and diffs them byte for byte against the committed reports | `skill-evidence` (nightly) |
| Dependency vulnerabilities | Rust and npm | Known-vulnerability sweep | `security-sweep` (daily + PRs) |
| Deployed drift | devnet | The deployed program still matches `main` (simulation only, nothing signed) | `deployed-drift` (daily + after merge) |
| Lighthouse | `app/` | Performance and accessibility budget | `app-lighthouse` (weekly) |
| Battle-test lane | `battle-test/` | Every frozen plan validates, a deliberately broken plan is rejected, and a failing result is carried in the report | `rehearsal` |

A red run on `main` in `ci-fast`, `on-chain` or `deployed-drift` opens a tracking issue
automatically (`stop-the-line`).

---

## 4. Devnet results per test

All amounts are lamports unless marked SOL (1 SOL = 10⁹ lamports). "Per-seat cost" is what a
refunded or unpaid seat is left short: the non-refundable rent of the pass asset minted at entry,
plus fees.

### T1 — pool 14 — refund below the minimum field — PASS

Pool `FZDhx4PUGCJmhskbbNFdUXzgRivSLwZHCcejxeF2afaL`. Frozen by PR 132, merged 2026-09-16T00:07:24Z.

- 12 entrants (browser wallets A and B plus ten headless) at the deadline, against a floor of 40.
  `trigger_refund` moved the pool to `Refunding`, and it reached `Closed`.
- **12 of 12 seats refunded exactly 100000000.** No seat paid a prize. Prize vault ends at 650240.
- **Treasury conservation, to the lamport:** 1.996098560 SOL after pool 14 was funded, + 1.2
  (twelve entries) + 4.0 (the untouched pot returned at `trigger_refund`) − 1.2 (refunds) −
  4.000650240 (funding the next pool's pot and cushion) = **1.995448320**, which is what the chain
  reads.
- Reconcile: 12 MATCH.

### T2 — pool 20 — refund at the boundary — SPOILED

Pool `DhtdSBapxkvzYSrkXVK63MfEEEVK6hLanEFywEKzwvqh`. Frozen by PR 146. The test needed exactly 39
seats. While it filled, a wallet outside the plan's seat list was funded and registered as the
40th seat. At 40 the pool meets the floor, so it sealed and played instead of refunding. No claim
was tested, and nothing about the program misbehaved. The pool is recorded as an observation, and
its result became finding 5.6:

- 40 entrants, `Paid`, results root `003f6302…7f4c`. Both browser wallets had run out of time on
  every battle and were entered on the default even split. They **tied for rank 1 on 426
  half-points and split the pot, 2000000000 each**. The best headless seat scored 318.
- All 40 revealed sets were re-scored independently with `backend/scoring/src/engine.ts`: **0
  mismatches** in rank, score or payout. The tie split follows the program's `split_group` rule
  (a tie for first divides the whole pot).

### T2R — pool 21 — the boundary, retried — PASS on 7 of 8

Pool `967H53GL2g6CnLAJYsSNFNjBvkMtUELwLNAM27RUfeFk`. Frozen by PR 151, merged
**2026-09-18T23:47:18Z**. Pool 21 was created on chain at **2026-09-19T01:21:29Z**, 1 h 34 min
later. The plan named no pool. This is the strongest freeze in the trial.

| Criterion | Result |
|---|---|
| Reaches `Closed`, not `Paid` | MATCH |
| Exactly 39 entrants at the deadline | MATCH |
| Settled by `trigger_refund`, not `seal_at_deadline` | MATCH — no results root |
| Every entrant refunded exactly 100000000 | MATCH — 39 of 39 |
| Prize vault ends at 650240 | MATCH |
| The 4000000000 pot returns to the treasury | MATCH |
| No flag, no sanctions hold | MATCH |
| Each seat's cost is exactly 4441080 | **Did not hold** — 29 of 39 seats cost 4446160 |

The failed criterion is an error in the prediction. Each entry mints a pass asset named
`BLOTTO PASS #<pool>-<seat>`. A two-digit seat index makes the account one byte larger, and one
byte of rent is 5080 lamports. **Seats 0–9 cost 4441080; seats 10 and up cost 4446160.** The same
two bands were then confirmed on the earlier pools and predicted correctly in T6.

Two seats failed mid-run with an expired blockhash after sealing, and both were retried and
landed (the seal-lockout fix, finding 5.1). No substitutions were needed.

### T4 — pool 16 — full pool, a browser wallet wins — PASS

Pool `EgbFPxSRgtc8hd68vbxjsQ8irYAifen7Zxf5uYNkrngq`. Frozen by PR 133, merged
2026-09-16T16:22:00Z, 9 h 43 min before the first entry. The plan was frozen against pool 15,
which was lost to the seal lockout (5.1), and ran unedited on pool 16. A rank depends on the
allocations, not on the pool number.

Browser wallet A played a "wall": three stats at 26 or more in every battle, against a headless
field capped at 25. Browser wallet B played a "pole": one stat. The claim was that the wall beats
every capped seat whatever exact numbers are dialled.

| | Predicted | Actual |
|---|---|---|
| Terminal state · entrants · paid seats | Paid · 64 · 1 | **Paid · 64 · 1** |
| Browser wallet A | rank 1, whole pot | **rank 1, 4000000000** (net +3.895554578 SOL) |
| Browser wallet B | rank 64 | **rank 64**, unpaid |
| Prize vault after | 650240 | **650240** |
| Results root | — | `08675847…b156`, **recomputed from 64 seats · MATCH** |

Reconcile: 58 MATCH · 2 INPUT_DRIFT (the two hand-played seats matched the plan's exact numbers
in 1 and 4 of 7 battles, yet rank and payout matched anyway) · 4 ABSENT. The four absent seats
failed in the runner after sealing. Each was replaced by a spare playing that seat's own frozen
allocation, so the scored field was exactly the planned field.

### T5 — pool 18 — full pool, a headless wallet wins — PASS (8 of 8)

Pool `4KDw44RCUkGjKnCvbKFUugLwZWewvNuixSxPhk1ov1Eb`. Frozen by PR 144, merged 2026-09-17T22:51:00Z.
T4 paid the operator-run browser wallet. T5 shows that no account is privileged.

| Criterion | Evidence |
|---|---|
| `Paid` with 64 entrants | Paid, 64 — sealed on the 64th entry |
| Exactly one seat paid: W00, the whole pot | W00, 4000000000 |
| W01 ranked last | rank 64 |
| Neither browser wallet paid; both in ranks 2–63 | both rank 62, unpaid |
| Every revealed allocation reproduces its committed hash | 64 of 64 |
| Recomputed results root equals the on-chain root | MATCH — `0e1d6b87…3bcc` |
| Prize vault ends at 650240 | 650240 |
| No flag, no sanctions hold | 0 · 0 |

`reconcile.ts` also compares exact ranks in the unpaid field, which was not a pass criterion. 44
of 62 moved by one to five places, because both browser wallets timed out onto the even split
rather than the shapes the plan assumed. The line it prints for that comparison is explained in
[`battle-test/REPORT.md`](../../battle-test/REPORT.md) §9.

### T6 — pool 27 — oversubscribed — PASS\*

Pool `3kkWSsX5BgpyVirejCRMAFXrdhoSnEdrHRQz4TQ4rvh9`. The plan was frozen by PR 156. Browser wallet
B then took seat 1 instead of arriving late, so the field differed from the plan. Before any
further entry (2 of 64 seated), a deviation addendum was frozen at commit `0c77466` and the run
was judged against it (`registry/T6.deviation.json`, `registry/T6.verdict.md`). The original plan
is unedited, and its own reconcile correctly reports a mismatch.

| Criterion | Result |
|---|---|
| `Paid` with exactly 64 entrants | PASS — 0 flagged, 0 refunded |
| Nine late attempts revert `PoolNotOpen` (6000), never `PoolFull` (6010) | PASS — 9 of 9, code 6000 |
| Each refused attempt costs a fee and nothing else | PASS — 15000 each; no entry, no pass, no rent |
| Exactly one seat paid the whole 4000000000, and it is W00 or browser wallet B | PASS — W00 |
| W01 63rd or 64th; browser wallet A neither 1st nor 64th | PASS — 64th; 62nd |
| Recomputed results root equals the on-chain root | PASS — `3caf8e13…71d7` |
| Per-seat cost in the two rent bands, with the boundary moved one seat later | PASS — 10 seats at 4441080, 54 at 4446160 |
| Prize vault ends at 650240 | PASS |
| A person reads the refusal copy | **Not tested** (a person read a refusal in T3, on the pause path) |

The late attempts show the gate order: the 64th entry seals the pool, so a 65th fails the state
gate before it can reach the capacity gate. The ciphertext route told each late wallet
`pool filled`. **Treasury:** 9387645440 before the fill, 15587645440 at harvest. The difference,
6200000000, is exactly 62 × 100000000 (the two browser wallets had already paid before the first
reading).

### T3 — pool 29 — seal at exactly 40, plus a pause — PASS

Pool `3KekiNcocdfB4vEB99HA2mf6eZ2cTFAgrnE9jreisnmv`. Frozen by PR 171, merged
2026-09-24T15:55:01Z, 1 h 33 min before the first entry. This is the weaker freeze standard: pool
29 already existed when the plan merged, and the freeze record was assembled after the run from
independently recoverable timestamps (GitHub merge time, git hashes, devnet block times). It says
so (`registry/T3.freeze.json`).

T2R showed that 39 seats refund. T3 is the other side of the fork: a pool that reaches its
deadline holding exactly 40 seats plays. It is also the first devnet pool sealed by
`seal_at_deadline` rather than by the 64th entry. The indexer's `outcome_if_deadline_now` read
`refund` at 39 entrants and `seal` at 40 on the same pool. From the pool's transaction history:
`SealAtDeadline` two seconds after the deadline, then `RevealPoolSecret`, `CommitResults` and
`PayPrizes`, three seconds from seal to payout. `trigger_refund` does not appear.

Mid-fill, the operator set `Config.paused` through the multisig, and cleared it afterwards.

| Criterion | Result |
|---|---|
| `Paid` with exactly 40 entrants, not `Closed` | PASS |
| `seal_at_deadline` fires, `trigger_refund` does not | PASS — both read from chain |
| Exactly one seat paid, W00, the whole 4000000000 | PASS |
| W00 scores exactly 542; W01 scores exactly 4 and ranks 40th | PASS — 542; 4, 40th |
| Neither browser wallet paid; both in ranks 2–39 | PASS — 39th and 38th, unpaid |
| A headless entry in the paused window reverts `Paused` (6005) | PASS — 6005 |
| That refusal costs a fee and nothing else | PASS — 15000; no entry, no pass, no rent |
| Browser wallet B refused during the pause, accepted after it | PASS — eight minutes apart |
| `Config.paused` true between the two writes, false after | PASS — read from chain both times |
| A person reads the refusal copy | PASS — see below |
| Every revealed allocation reproduces its committed hash | PASS — 40 of 40 |
| Recomputed results root equals the on-chain root | PASS — `28c5608a…606b` |
| Per-seat cost: 10 seats at 4441080, 30 at 4446160 | PASS — boundary at seat 10, as predicted |
| Prize vault ends at 650240 | PASS |
| No flag, no sanctions hold | PASS — 0 · 0 |

**Point predictions, not ranges.** The plan fixed both of the wall's battles against the browser
wallets, so it could predict W00's and W01's scores exactly, and both landed. The best
generated rival, W33, was given a ceiling of 369. It finished second on 367.

**The refusal a person read.** Browser wallet B, holding no seat at that moment, was refused
during the pause with: *"Entries are paused right now, so this one was not accepted and nothing
settled. Try again a little later."* It names the reason, states the outcome, does not suggest the
pool is over or that funds are at risk, and gives a next step. The app's preflight simulation
returned 6005 and the client stopped before submitting, so this refusal put no transaction on
chain and cost the player nothing. The 15000-lamport fee in the table is from the headless
attempt, which skips preflight on purpose so that its cost can be measured.

`reconcile.ts` prints `RESULT: FAIL` for this pool: 16 MATCH, 22 RANK_DRIFT, 0 PAYOUT_MISMATCH,
2 INPUT_DRIFT. Exact unpaid ranks were not a pass criterion. Both browser wallets let the clock
run out (one on all seven battles, one on five) and were entered on the even split, which moved
every head-to-head against them. The plan marked only those two seats' ranks as conditional
(§6). The verdict against the frozen criteria is `registry/T3.verdict.md`.

### Pool 22 — shakedown (observation, no verdict)

Pool `CDKBFm2DybDUrkYhZzDXpPExoL3PU2EJbcBD1JboPaF7`. A browser wallet entered before any
prediction existed, so this pool could not be a test. It was run to try T6's mechanics before a
frozen prediction was spent on them. Full record:
[`registry/pool-22.observation.md`](../../battle-test/registry/pool-22.observation.md).

- **Settlement speed:** 64th entry at slot 501013613, `reveal_pool_secret` +6 s,
  `commit_results` +7 s, `pay_prizes` **+9 s**.
- **Seal gate, both directions on live traffic:** four wallets that had sealed but not registered
  were allowed to re-seal, and all four landed. Fourteen wallets already registered were refused
  `409 already sealed` on a re-attempt, and nothing was written.
- **Fill time:** 62 seats in 5 min 20 s on the public devnet RPC, which throttled every ~15 seats.
  This measures the RPC, not the product.
- **The late entrant's message** hedged between two causes the server had already distinguished.
  This became finding 5.5.

---

## 5. Product findings and status

The status of each finding was checked against the code on this branch.

| # | Finding | Status |
|---|---|---|
| 5.1 | A failure between sealing and registering barred that wallet from that pool permanently | **Fixed** |
| 5.2 | A refunded pool never reveals its pool secret | **Open** |
| 5.3 | `/health` cannot show a signer outage that closes the entry gate | **Open** |
| 5.4 | A packet is logged as issued before it is signed | **Open** |
| 5.5 | A late entrant saw a hedged message instead of "this pool filled" | **Fixed** |
| 5.6 | The even-split default can win against a field that concentrates on one or two stats | Design property, under review |
| 5.7 | Two timed-out players produced a "strong" duplicate-set detection finding | **Fixed** |
| 5.8 | A backend deploy staged a configuration change that did not take effect, printed the failure, and reported success | **Fixed** |
| 5.9 | A service logged its RPC endpoint including the provider credential | **Fixed**; credential rotation pending |

**5.1 Seal lockout — fixed.** The ciphertext store refuses a second, different allocation for a
seat, so that a paid entry can never be overwritten. A replay always differs, because the salt is
fresh. So any failure after the seal (a refused packet, a dismissed wallet prompt, an expired
blockhash) barred that wallet from that pool for good. Eleven headless wallets were lost this way
across T2, T4 and T5, and both browser wallets were barred from pool 15. **Now:** `backend/packet/src/ciphertexts.ts` refuses an overwrite
only when the chain already holds an `Entry` for that wallet and pool (`seats.isRegistered`, read
from the indexer's entries projection). It fails closed: if that cannot be answered, the overwrite
is refused. `app/src/entry/submit.ts` also asks for the entry packet *before* storing the
ciphertext. T2R and pool 22 exercised both directions on devnet (see §4).

**5.2 Refunded pools keep their secret — open.** The program allows `reveal_pool_secret` once a
pool is past its deadline, so that entrants of a refunded pool can check that nobody read their
allocations before the refund. The daemon never asks. In `backend/reveal/src/crank.ts`, the only
call to `revealPoolSecret` is inside `assembleBundle`, which runs only for pools that played.
`crankPool` returns for `Refunding` and does nothing for `Closed`. Every refunded devnet pool
checked (9–14 and 21) showed no revealed secret. Refunds themselves are unaffected. **Consequence:**
a refunded entrant cannot verify that their sealed allocation stayed sealed. The on-chain gate
still accepts a late reveal, so pools already closed could be revealed after the fact.

**5.3 Signer outage invisible to `/health` — open.** Every entry needs one signature from the
signing service. When that service stopped signing, every entry was refused, for every wallet
and every pool, until signing was restored. Meanwhile `/health` on the entry service reported `ok: true`.
The uniform refusal is intentional: a player or prober must not learn which check failed. But
`/health` (`backend/packet/src/server.ts`) still reports only sanctions-screening state, with no
signer probe, and `ofac_loaded` in `backend/sanctions/src/wire.ts` is only ever set to true.

**5.4 Log order — open.** `issuePacket` (`backend/packet/src/service.ts`) logs
`packet issued` before calling the signer. When signing throws, a second line logs
`NOT issued`. A count of "issued" lines therefore reads normally throughout a signing outage.

**5.5 Late-entrant copy — fixed; a person has not yet read the `pool filled` wording on a live pool.** A late
entrant is refused at the ciphertext step, before any transaction, so nothing is charged. This was
verified on pool 22, where the late wallet's balance was unchanged to the lamport. The route did
distinguish `pool closed to entries` from `already sealed`, but the app read only the HTTP status
and showed one hedged sentence for both. **Now:** the route answers `pool filled` at capacity, and
`app/src/entry/outcome.ts` maps the body through a closed allowlist to `pool-full`, `pool-closed`
or `seal-conflict`. `pool-full` shows "This pool filled before your entry reached it…". The
packet-stage refusal stays generic by design. T6's criterion "a person reads the refusal" was not
run. In T3 a person read the pause refusal and it passed (§4); that is the same kind of check on a
different refusal path (§8).

**5.6 The even split can win — design property, under review.** The board opens at 20/20/20/20/20
in every battle, and any battle not locked when the clock ends is entered that way. By
construction, an even split loses 3–2 to any allocation that concentrates on three stats. Against
allocations that pour points into one or two stats, it wins four of five. In pool 20 (T2), a field
generated that way lost to two timed-out wallets, which tied first. Measured over 400 pools of 40
with the product's engine, the default's rank-1 rate is 0% against three-stat concentrators, 0%
against the study's mixed ladder, and 100% against arbitrary free-integer allocations
([skill-evidence report](../skill-evidence/REPORT.md)). If every seat stays on the default, all
tie, and each receives exactly their entry back. The published sentence "the even split is the
weakest allocation in the game" was removed. What remains in the rules copy is the three-stat
statement, which holds by construction. How real players' allocations are distributed is not yet
known.

**5.7 Duplicate-set signal and the timeout default — fixed.** Two players who both time out
submit byte-identical sets, and the `duplicate_sets` signal, the one allocation signal eligible for
a hard block, rated them "strong" (T5, pool 18). Nothing was blocked, because the daemon flags
nobody and a flag is a reviewer's decision. **Now:** `backend/detection/src/signals.ts` compares
only battles that both entries actually chose. Battles left at the default are excluded.

**5.8 A green deploy that did not change the service — fixed.** A backend deploy on the
development-credentials path staged the location-lookup stub and passed every step, yet the entry
service kept refusing as before. Cause: precedence, not delivery. The packet service
(`buildGeo`, `backend/packet/src/main.ts`) prefers the vendor lookup whenever vendor credentials
are present on the app. Emptying them in the repository changed which path the workflow took, but
not what the app held, so the service stayed on the vendor. Two smoke checks could not fail: one
accepted any HTTP 200 whatever the body said, and one searched the boot log for a string the
service never prints. **Now** (PR 174): the development path in
`.github/workflows/deploy-backend.yml` unsets the vendor credentials it replaces, the same fix is
applied to the entry signer, and the smoke step reads the `/geo` answer rather than only its
status code.

**5.9 A credential in a boot log — fixed; rotation pending.** A service logged its RPC endpoint
including the provider credential, once per boot, and the operator's read-only status workflow
copies recent service logs into CI output. The line now redacts it through `urlForLog`
(`backend/_shared/src/short.ts`, called from `backend/detection/src/main.ts`, with tests in
`backend/_shared/test/short.spec.ts`). No other call site logs an RPC endpoint. The credential is
being rotated; the redaction shipped first, so the new credential never reaches the log.

---

## 6. Harness lessons

These are recorded because they bear on how much the results can be trusted.

- **A check that cannot fail is not a check.** Three times the reconcile tool reported a pass it
  had not checked: once a stub that returned `MATCH` for every scored seat, once a
  results-root criterion no tool computed, and once a per-seat-cost criterion it never read. Each
  was fixed, and `reconcile.ts` now refuses to pass a criterion it cannot test. Each fix was also
  shown to catch the failure in both directions before it was trusted.
- **Unconditional claims beat exact predictions.** Every exact prediction about the hand-played
  seats' numbers was wrong. Every floor-versus-ceiling claim ("cannot win", "must be last",
  "rank 1 is one of these two seats") held.
- **Hand-played seats make every other seat's exact rank conditional.** T5's and T3's field ranks
  drifted because the browser wallets played differently from the plan. Both plans marked only the
  browser wallets' own ranks as conditional; exact field ranks were never a pass criterion, and
  `reconcile.ts` reports the drift rather than hiding it.
- **Write the freeze record at freeze time.** T3's freeze record was assembled after the run, from
  timestamps nobody in the project can rewrite, and states that it was late. T7's was written when
  its plan was frozen.
- **Reconcile checks input drift first.** Input drift causes rank drift, so checking rank first hid
  it. T3's first reconcile reported two browser-wallet ranks off by one and missed that both had
  timed out. `reconcile.ts` now checks inputs first and counts even-split battles.
- **Concurrency and the public RPC lose wallets.** Parallel entry and throttled endpoints produced
  expired blockhashes after sealing. The runner now stops at the first casualty and fills at
  concurrency 1, and the trial used a dedicated RPC for T6.
- **A live pool is shared state.** Funding a wallet outside the seat list while T2 was filling
  spoiled it. While a test pool is open, no outside wallet is funded without checking the seat
  count first.
- **The secret scanner works.** It stopped a pool secret from being committed to the registry. The
  harness now stops storing secrets instead of working around the scan.

---

## 7. Statistical evidence

The devnet trial shows that the mechanism settles correctly. Whether allocation choices drive
outcomes is measured separately, by deterministic studies that play thousands of pools through the
same scoring engine. CI reproduces them byte for byte every night.

**Easy board** ([`docs/skill-evidence/REPORT.md`](../skill-evidence/REPORT.md)). Rank-1 rate by
strategy class. The everyone-equal baseline is 1.5625% at 64 seats and 2.5% at 40.

| Seats | random | uniform (default) | heuristic | optimised |
|---|---|---|---|---|
| 64 | 0.000% | 0.000% | 1.093% | **5.156%** |
| 40 | 0.000% | 0.000% | 1.850% | **8.150%** |

**Hard board** ([`docs/skill-evidence/hard/REPORT.md`](../skill-evidence/hard/REPORT.md)): 700
points anywhere across the 35 cells.

| Seats | random | uniform (default) | heuristic | optimised |
|---|---|---|---|---|
| 64 | 0.000% | 0.000% | 0.156% | **6.093%** |
| 40 | 0.000% | 0.000% | 0.800% | **9.250%** |

The uniform rows reflect a field that is half three-stat play. The default's result depends on the
field (§5.6), and the report states this next to the numbers.

**Fill rate** ([`FILL-SIMULATION.md`](FILL-SIMULATION.md)) estimates how often the 40-at-12h rule
seals rather than refunds for a given arrival rate, under the territory schedule in force.
**Live endpoints** ([`LIVE-SKILL-ENDPOINTS.md`](LIVE-SKILL-ENDPOINTS.md)) describes the read-API
routes that compute the same kind of statistics from real pools.

---

## 8. Limits — what has not been tested

- **T7** (two entrants from one browser profile, then the review path) is frozen and has not
  run. Its plan (`battle-test/registry/T7.plan.json`, pool 36) gives two headless seats identical
  allocations so that they tie for first and hold two shares, the only way one pool can exercise
  escrow: both flagged, `pay_prizes` escrows both, one share released, the other forfeited (which
  moves nothing), then `pay_next_place` pays it to the remaining eligible seat. Until it runs,
  detection and review are covered by unit tests and by shadow mode in the offline rehearsal, and
  no reviewer flag, `forfeit_escrow` or `pay_next_place` has run on devnet.
- **T8** (the public verify page, and a recompute by someone outside the project) did not run.
  Results roots were recomputed by the harness from published data (T3, T4, T5, T6), not by an
  outside party.
- **A person reading the late-entry refusal** (T6's ninth criterion, the `pool filled` wording)
  has not been tested on a live pool. A person did read the pause refusal in T3, and it passed
  (§4); that covers the same kind of check on a different refusal path.
- **The signing-service outage path**: with the signer down, the program refuses nothing and the
  entry service refuses everything. That was observed (5.3), not tested against a prediction.
- **Hard mode on devnet**: every trial pool was easy mode, played on the client of the time, which
  had a single 90-second clock. The current board has a 3-minute clock and a hard mode. Hard mode
  is covered by `tests/litesvm/tests/hard_mode.rs`, the backend suites and the hard skill-evidence
  study, but not by a devnet pool.
- **Tiers above 0, pools on mainnet, real money, and real player populations** have not been
  exercised. The field in every trial pool came from the test's own generators.
- **Load**: T6's fill used 64 seats plus 9 late attempts. No sustained multi-pool load test has
  been run.

---

## 9. Raw data appendix

Everything below is in [`battle-test/`](../../battle-test/) (tooling and how to run it:
[`battle-test/README.md`](../../battle-test/)).

| Path | Contents |
|---|---|
| `battle-test/registry/wallets.json` | The roster: wallet ids to addresses (no key material) |
| `battle-test/registry/<test>.plan.json` | Frozen predictions, byte-identical to what was merged |
| `battle-test/registry/<test>.freeze.json` | Merge timestamp and plan sha256 binding each freeze |
| `battle-test/registry/<test>.actual.json` | Harvested outcome, with the source of each field |
| `battle-test/registry/<test>.reconcile.md` | Seat-by-seat diff of prediction against outcome |
| `battle-test/registry/<test>.allocations.md` | Each seat's allocations beside the on-chain hash |
| `battle-test/registry/T6.deviation.json`, `T6.verdict.md` | T6's pre-fill addendum and verdict |
| `battle-test/registry/T3.verdict.md` | T3's verdict against its frozen criteria |
| `battle-test/registry/pool-22.field.json`, `pool-22.observation.md` | The shakedown field and record |
| `battle-test/evidence/<test>-pool-<id>/` | Pool snapshots, balance snapshots, entry logs, T6's late-attempt capture |

| Test | Pool id | Pool PDA | Results root |
|---|---|---|---|
| T1 | 14 | `FZDhx4PUGCJmhskbbNFdUXzgRivSLwZHCcejxeF2afaL` | — (refunded) |
| T2 | 20 | `DhtdSBapxkvzYSrkXVK63MfEEEVK6hLanEFywEKzwvqh` | `003f63021e66a8583f730e2e27ece5705ca82de06c7025a967615ab0d6d87f4c` |
| T2R | 21 | `967H53GL2g6CnLAJYsSNFNjBvkMtUELwLNAM27RUfeFk` | — (refunded) |
| T4 | 16 | `EgbFPxSRgtc8hd68vbxjsQ8irYAifen7Zxf5uYNkrngq` | `0867584752741d72d7266b87b91c1f51417fe736bfd6150fbe44ed571ed7b156` |
| T5 | 18 | `4KDw44RCUkGjKnCvbKFUugLwZWewvNuixSxPhk1ov1Eb` | `0e1d6b87140f8696ef9252a3d1858c48133ce196b265b6c1881668af5b193bcc` |
| T6 | 27 | `3kkWSsX5BgpyVirejCRMAFXrdhoSnEdrHRQz4TQ4rvh9` | `3caf8e13fd58fd00963461fd1961c0de2cf516d745ffd69ef204bc82379071d7` |
| T3 | 29 | `3KekiNcocdfB4vEB99HA2mf6eZ2cTFAgrnE9jreisnmv` | `28c5608a9d63de983c9afad575ac67750dba9ea85320be8d7504e25133bb606b` |
| T7 (frozen, not run) | 36 | `DtaxjC8MoRZ3wGnR6KghsxV1gXvPP5yaTEssrroArpXX` | — |
| Pool 22 | 22 | `CDKBFm2DybDUrkYhZzDXpPExoL3PU2EJbcBD1JboPaF7` | — |
| (pool 15, lapsed) | 15 | `4rZWzP13Wz5uadk1LY8jiBmuCsPUE8RSZYKXDYocdKkn` | — |

The offline half of the rehearsal, and the operator's devnet deploy and admin sequence, are in
[`../guide/DEVNET-REHEARSAL.md`](../guide/DEVNET-REHEARSAL.md).
