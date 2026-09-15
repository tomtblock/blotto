# Blotto Cup — Devnet Battle-Test Manual

> ## AMENDED 2026-09-15 — read this box before anything else
>
> The drift check (WP0) read every claim in this document against the live tree and the deployed
> program. **`DRIFT.md` is authoritative wherever it and this manual disagree**, and the sections
> below have been amended in place. The amendments, shortest form:
>
> 1. **A pool with 40 or more seats plays.** `MIN_SEATS` is 40 and `seal_at_deadline` seals any pool
>    at or above it. Only a pool **below 40** refunds. §0.1, §1 and the §9 cards are rewritten.
> 2. **Rank 1 takes the whole pot.** One paid place. There is no top 16, no 270/1024 band, no
>    1.35 SOL, and nothing to predict but the ranking itself.
> 3. **The 12-hour deadline is already live** and is settable at runtime by an admin instruction.
>    §4.0's eleven-point change is already done; it survives only as a verification.
> 4. **Every test runs on tier 0.** Tier 1 cannot be opened — the admin tool refuses a tier whose
>    live economics differ from the ratified table, and tiers 1–6 on chain still carry a superseded
>    derivation. §4.9 and §4.10 as written were mutually exclusive.
> 5. **The pentagon is gone**: five slider dials with per-stat locks, one 90-second clock for the
>    whole run that starts on the first dial movement, and an expiry that enters the **even split**
>    rather than the shape on screen. §7.3 is rewritten.
> 6. **`forfeit_escrow` moves no lamports** and **detection never flags by itself**. §9's T7 is
>    rewritten; a forfeit is a reviewer decision plus a separate admin transaction.
> 7. **Two UI accounts, not three**, and there is no email login — the app offers Google, Apple, X
>    and wallet. Roles rotate per pool.
> 8. **A headless entrant must first record an age and terms attestation**, which the app performs
>    as its clickwrap. Without it the packet service refuses with a generic 403. Not in the original
>    text at all; found by probing the live service.
>
> Founder instructions live in **`FOUNDER-ACTIONS.md`**, which is written against the control that
> exists today. Where this manual still describes the old one, that file wins.


**Version 1.2 · 15 September 2026 · Owner: founder · Driver: Claude Code · Companion to roadmap Phase 5 and `docs/devnet-rehearsal.md`**

This manual is designed to be picked up cold by either party. Claude Code drives: it runs the tooling, keeps the records, and tells the founder what to do and when. The founder does the things only a human with the accounts and the admin key can do — and those are listed, timed and numbered in §3 so nothing arrives as a surprise. If you close this for a week and come back, read `STATE.md` and `LOG.md` first (§2.3), then the schedule (§3).

---

## 0. Read this first — four things before anything else

The brief as originally written cannot be executed against the program that is deployed, and this manual itself was written from a snapshot. Four things need saying first.

**1. A pool with at least 40 seats PLAYS; only a pool below 40 refunds.** *(Amended — the original
text here said the opposite.)* R7's "full 64 or automatic full refund" was superseded by D-E4 and
R7-b: `MIN_SEATS` is **40** (`constants.rs:75`), and at the fill deadline `seal_at_deadline`
(`seal.rs:64-67`) seals any pool holding at least that many, which then scores and pays. Only below
40 does `trigger_refund` apply (`refund.rs:75`); calling it on a larger field reverts with
`FieldReached` (6052). A pool still seals immediately at the 64th seat. So "a pool at 40 and a pool
at 63 both refund" — the original claim — is false, and the two tests built on it are remapped in §1:
**T2 tests 39 seats, the last count that refunds; T3 tests 40, the first that plays.**

**2. This is devnet, not testnet.** The program, Irys uploads, the Switchboard queue, the Privy RPC config and every script default to devnet. Nothing is deployed to testnet. All evidence carries `?cluster=devnet` and the report says devnet.

**3. The fill deadline is already 12 hours, and it is admin-settable.** *(Amended.)* The constant is
`DEFAULT_FILL_DEADLINE_SECS` (not `FILL_DEADLINE_SECS`), it has read `12 * 60 * 60` since the founder
ruling of 2026-09-07, and it only *seeds* `Config.fill_deadline_seconds`, which is copied onto each
pool at open. The live value on chain reads 43200. There **is** an admin flag — `set_pool_timing`
(`admin.rs:184-200`) — so the original claim that the deadline cannot be moved is wrong; it applies
to pools opened from then on and never rewrites a deadline players already entered under. §4.0's
eleven-point change-control list is therefore already landed and survives only as the on-chain
verification at its point 11. There is also a **five-minute cooldown** between a tier's pools
(`DEFAULT_COOLDOWN_SECS`), which this manual nowhere mentions and every schedule line depends on.

**4. This manual is a snapshot and must be verified against the live repo before anything runs.** It was written from the PID, the roadmap, the decision register and a read of the code as they stood on 15 September 2026 — not from a build. Things have moved since some of those were written: the allocation screen is described here as a draggable pentagon, and that feature has evolved; `admin.ts` flags, DOM selectors in the Playwright spec, the `assignPrizes` signature, `Entry::LEN`, and whether `deviceHash()` and `__BLOTTO_TEST_SIGNER__` are live are all things the repo knows and this document only remembers. So the **first work package is a drift check** (§2.5, and WP0 in the session prompt): Claude Code reads the manual against the tree, writes `battle-test/DRIFT.md` listing every assumption that is stale, and amends the manual by PR — including rewriting every founder instruction that describes the UI so it describes the UI that exists — before Day 0 starts. Nothing in §3 onward is trusted until `DRIFT.md` says so.

---

## 1. The test matrix — AMENDED

Eight tests. The entrant counts and expected states below are the amended ones; the originals assumed
a 64-or-refund program and a sixteen-place prize table, and neither exists.

| # | Test | Entrants | Tier | Expected terminal state | Roadmap |
|---|---|---|---|---|---|
| T1 | Refund, sparse | 12 (2 UI + 10 headless) | 0 | `Closed` after 12h; 12 × full refund | 5.2 |
| T2 | Refund at the boundary | **39** (2 UI + 37 headless) | 0 | `Closed` after 12h; 39 × full refund | 5.2 / R7-b |
| T3 | **Seal at the minimum field** + pause mid-fill | **40** (2 UI + 38 headless) | 0 | **`Paid`** — seals at the deadline, rank 1 takes the pot; one paused attempt rejected | 5.2 / D-E4 |
| T4 | Full pool — **UI wallet wins** | 64 (2 UI + 62 headless) | 0 | `Paid`; UI-A rank 1, paid the whole pot | 5.1 |
| T5 | Full pool — **headless wallet wins** | 64 (2 UI + 62 headless) | 0 | `Paid`; W63 rank 1; no UI wallet paid | 5.1 |
| T6 | Oversubscribed + load | 64 land, 9 more attempt | 0 | `Sealed` at exactly 64; 9 reverts with `PoolNotOpen` (6000); fill < 5 min; crank < 2 min | 5.4 |
| T7 | Same-device → review | 64 (2 UI from one browser) | 0 | `Paid` with 2 seats escrowed; release one, forfeit one | 4.3 / 4.4 |
| T8 | Verify page + non-founder recompute | — (uses T3–T7) | — | Every `results_root` independently reproduced | 5.3 |

**Everything runs on tier 0, sequentially.** Tier 1 cannot be opened (`DRIFT.md` §F2), and pools per
tier are sequential (D-A1), so the tests run one after another rather than two tiers in parallel. A
deadline test occupies a 12-hour cycle; a full pool settles minutes after its 64th entry. The
schedule in §3.1 is rewritten around that and around the founder's 11:00 / 23:00 availability.

**Three consequences worth stating plainly.** T3 is no longer a refund test: at exactly the minimum
field it seals at its deadline and pays, which exercises the fork the program actually defends and
the site actually advertises. T6's predicted error is `PoolNotOpen` (6000), not `PoolFull` — the 64th
entry seals the pool, so a 65th fails the state gate before it reaches the capacity gate. And the
63-seat case is dropped: mechanically it is identical to 40.

---

## 2. How the week runs

### 2.1 Roles — the boundary that keeps the result honest

Parts of this test cannot be automated. A session that quietly simulated them would produce a fake result, so the line is drawn explicitly.

| Claude Code | Founder |
|---|---|
| All code; all plan generation, harvesting, reconciliation; all GitHub mechanics (branches, PRs, issues, board) | Merging each freeze PR (the merge is the timestamp — a second pair of hands on it is worth having) |
| Holds and uses the disposable devnet keys in `battle-test/keys/` (72 headless wallets, the funder) for `fan-out.ts` and `enter.ts` | Holds the admin key and the program keypair; runs every `admin.ts` write and `deploy-devnet.sh` from a command Claude Code has prepared |
| Reads on-chain state, runs `admin.ts status` freely | The three UI entries per pool: Privy sign-in with three email accounts, the pentagon, the screenshots |
| Maintains `STATE.md`, `LOG.md`, `RESULTS.md`, `LEDGER.md`, the issues | The faucet; the non-founder recruit for T8; the final judgement on any FAIL |
| Drafts `REPORT.md`; writes the narrative sections | Reviews and signs off the report |

Neither party registers into a pool that is not a named test — one stray entry locks its tier for the whole 12-hour window and cannot be undone.

### 2.2 The driving protocol

Claude Code ends **every turn** with the founder's next action and when it is due, even if the answer is "nothing until 13:00". When it needs the founder now, it emits a block in exactly this shape, numbered from the catalogue in §3.3:

```
▶ FOUNDER ACTION F-14 — T4 UI entries        est. 25 min · do now · window closes 10:45
Why now:   T4 plan frozen at 3f2a9c1 (merged 10:04). Pool 7 is Open at 0/64.
           The headless fill waits on your three seats.
Do:
  1. UI-A (profile 1) — winner drag: three vertices to ≥ 30, vary which three
     each battle, two left at the centre. Screenshot every lock-in.
  2. UI-B (profile 2) — pole drag: one vertex to the rim each battle, rotate it.
  3. UI-C (profile 3) — touch nothing. Let the 15s timer expire seven times.
Send back:  three transaction signatures; 21 lock-in screenshots + 3 seat cards
            into battle-test/evidence/T4-pool-7/UI-*/ ; the words "F-14 done".
Do not:     enter with any other wallet; refresh mid-session; start UI-C before A and B land.
```

When the founder reports back, Claude Code logs the completion, verifies what it can (the signatures exist on-chain, the screenshots are in the folder), and continues. If the founder's report is incomplete, Claude Code says exactly what is missing rather than proceeding on assumption.

### 2.3 The two files that make the week resumable

**`battle-test/STATE.md`** — rewritten by Claude Code every time anything changes. One screen. Whoever opens the repo reads this first.

```
# STATE — 2026-09-16 10:12 local — by Claude Code
Phase:            WP6 · pool T4 (pool 7, tier 0) · loop step 8.5 (headless fill)
Waiting on:       founder — F-14 (T4 UI entries), requested 10:05
After that:       F-15 (T4 settled screenshots) ~11:30 · F-16 (T5 freeze merge) 13:00
Live deadlines:   T1 / pool 4 / tier 1 → 21:00 today (F-19)
Blocked:          none
Results so far:   T1 filling · T4 filling · others not started
```

**`battle-test/LOG.md`** — append-only, one line per event, written by Claude Code for both parties. This is the timeline the report is built from, so it is never edited, only appended.

```
2026-09-16 09:00 | founder | —  | F-11 set-open-tiers 1,1        | 4Kq…9a
2026-09-16 09:00 | daemon  | T1 | pool 4 opened, deadline 21:00   | 7Hh…2c
2026-09-16 09:00 | daemon  | T4 | pool 7 opened                   | 9Pd…e1
2026-09-16 09:18 | founder | T1 | F-12 UI-A entered seat 0        | 2Ab…f4
2026-09-16 09:41 | cc      | T1 | enter.ts seats 3–11 landed      | log: evidence/T1-pool-4/headless-register.log
2026-09-16 10:04 | founder | T4 | F-13 freeze PR #41 merged       | 3f2a9c1
2026-09-16 10:05 | cc      | T4 | requested F-14                  |
```

Columns: local time · actor (`founder`, `cc`, `daemon`, `chain`) · test · event · reference (signature, SHA, path). A founder action appears twice: when requested and when reported done.

### 2.4 Where things live

| What | Where | Committed? |
|---|---|---|
| This manual, `STATE.md`, `LOG.md`, `RESULTS.md`, `REPORT.md`, `ENVIRONMENT.md`, `CAPITAL.md`, `LEDGER.md` | `battle-test/` | yes |
| Plans, actuals, reconciles, `wallets.json` (addresses only) | `battle-test/registry/` | yes |
| Per-pool evidence: `CARD.md`, screenshots, logs, balance snapshots | `battle-test/evidence/T<n>-pool-<id>/` | yes — keep screenshots under ~300 KB each |
| Tooling | `battle-test/scripts/`, `battle-test/src/`, `battle-test/package.json`; one CI file `.github/workflows/rehearsal.yml` path-filtered to `battle-test/**` | yes |
| Keypairs: 72 headless + funder | `battle-test/keys/` | **never** — gitignored; gitleaks lane stays green |

### 2.5 The source boundary, and the drift check

**The battle test does not touch the product.** Everything it creates lives in one top-level folder, `battle-test/`, with its own `package.json`, importing from `backend/scoring`, `backend/sealing`, `backend/reveal` and `tests/rehearsal` as read-only libraries. Nothing under `app/`, `programs/`, `backend/` or `tests/` is modified by the battle test, and a CI check on every battle-test PR fails if the diff strays outside `battle-test/` and its one workflow file. When the week is over, deleting `battle-test/` leaves the product exactly as it was.

**The one exception, named so it cannot be confused with the test.** The founder's decision to shorten the fill deadline to 12 hours (§0.3, §4.0) is a *product* change. It touches `programs/`, `app/` and `docs/`. It ships as its own PR, `product/fill-deadline-12h`, before the battle test begins, and is recorded in `ENVIRONMENT.md` as the deployed build under test. It is not battle-test tooling and the boundary check does not apply to it.

**The drift check (WP0).** Before Day 0, Claude Code reads every claim this manual makes about the repo and checks it against the tree. The output is `battle-test/DRIFT.md`: one row per assumption — where the manual says it, what the repo actually has, and what changes. Known candidates: the allocation screen (the "pentagon", its selectors, its timer, its lock-in control, what the five integers under it look like now); `admin.ts` command names and flags; `FILL_DEADLINE_SECS` and every §4.0 touchpoint; `assignPrizes`, `rankOrder` and the Merkle builder signatures; `Entry::LEN` and the pass-asset size; `deviceHash()` and `ipHash`; `__BLOTTO_TEST_SIGNER__` in the deployed build; the indexer and packet-service endpoints; the daemon's pool-opening behaviour; the `set-tier-economics` 1024-multiple rule; the seven-tier configuration and the 270/1024 band; the detection signals and the two hard-block rules; the copy strings quoted in §4.0; the fixture pool watermark; the Privy embedded-wallet setting. Every row marked *changed* is fixed in the manual by PR — and every founder instruction that describes the UI (§3.2, §7.3, §9 cards, `FOUNDER-ACTIONS.md`) is rewritten to describe the current one. Day 0 does not start until `DRIFT.md` has zero unresolved rows.

---

## 3. The founder's schedule

Four days, Monday to Thursday. Times are local and assume tier 1 opens at exactly 09:00 on Day 1; if that slips, every tier-1 time slips with it and Claude Code re-issues the schedule. Founder time is roughly three hours a day, in blocks, never continuous — the rest of the day is Claude Code's.

### 3.1 The calendar — AMENDED

*Rebuilt around one tier, a sequential pool order, and the founder's 11:00 / 23:00 availability.
Times are local. Each pool's successor opens five minutes after it closes, so the cycle drifts a few
minutes later each day; Claude Code re-issues the times from the actual `fill_deadline` on chain
rather than from this table.*

| Pool | Test | Opens | Settles / closes | Founder actions |
|---|---|---|---|---|
| 14 | **T1** refund, 12 seats | Day 0, 22:46 | Day 1, ~10:46 | F-12 entries at open · F-19 at the deadline |
| 15 | **T4** full, UI wins | Day 1, ~10:56 | ~11:40 | freeze merge · entries · settled screenshots |
| 16 | **T5** full, headless wins | Day 1, ~11:45 | ~12:30 | freeze merge · entries · settled screenshots |
| 17 | **T6** oversubscribed | Day 1, ~12:35 | ~13:20 | freeze merge · two entries then wait · the late attempt on call |
| 18 | **T7** same device → review | Day 1, ~13:25 | ~14:30 | freeze merge · both accounts from one profile · the review decision + the admin forfeit |
| 19 | **T2** refund at 39 | Day 1, ~22:46 | Day 2, ~10:46 | entries at open · deadline screenshots |
| 20 | **T3** seal at 40 + pause | Day 2, ~10:56 | Day 2, ~22:56 | entries · the pause on call · deadline screenshots |
| — | **T8** verify + recompute | Day 3 | — | hand the bundles to a non-founder |

**Deleted from the original calendar**, all three because the work is already done or cannot be done
(`DRIFT.md` §G2): the change-control merge and deploy, the tier-1 economics call, and the
open-tiers call. Tier 0 is already open at ratified economics and the deadline is already 12 hours.
**Two admin writes remain in the whole week**: the pause on and off for T3, and the forfeit for T7.

Every founder action is defined in **`FOUNDER-ACTIONS.md`** with its exact steps. That file, not this
table, is what the founder follows.

### 3.2 What each block feels like

**A UI-entry block** (F-12, F-14, F-17, F-20, F-22, F-25, F-28): three browser profiles, three timed sessions of about ninety seconds each, a screenshot at every lock-in and one of the seat card. Claude Code has already frozen the plan and tells you which role each wallet plays. Order matters: A, then B, then C, and Claude Code's headless fill does not start until all three have landed (except T6, where the order is deliberately reversed).

**An admin block** (F-03, F-04, F-05, F-11, F-23, F-32): Claude Code has prepared the exact command in a code block. You run it, paste back the signature, and Claude Code logs it. Nothing is guessed on either side.

**A deadline block** (F-19, F-21, F-30): the daemon does the work; you arrive fifteen minutes after the deadline, screenshot what the player sees, and confirm the balances Claude Code has already harvested match what the UI shows.

**A freeze merge** (F-13, F-16, F-24, F-28): open the PR, glance at the predicted top 16 and last place that Claude Code has put in the description, merge. The merge timestamp is the evidence.

### 3.3 The founder-action catalogue

Every F-ID above is defined once in `battle-test/FOUNDER-ACTIONS.md`: its purpose, its exact steps, what to send back, what not to do. Claude Code writes that file in WP2 from §4, §8 and §9 of this manual, and its `▶ FOUNDER ACTION` blocks quote from it. The founder should read it once on Day 0 and never need to search for an instruction again.

---

## 4. Day 0 — setup

Day 0 is a full working day for Claude Code and about three hours, in blocks, for the founder. Nothing in §8 or §9 starts until the §4.14 gate is green. Two long-running things start first: the faucet (F-01) and the code (§4.11).

**The trap, restated.** Pools per tier are sequential. A "just to see" registration into an open pool locks that tier for 12 hours and cannot be undone. Never register into a pool that is not a named test. This is why §4.8 measures cost off-chain.

### 4.0 The 12-hour decision — ALREADY LANDED, verify only (AMENDED)

*The original eleven-point change-control list is deleted. Every point was either already done before
this manual was written or describes a file that does not say what the manual claimed.* The founder
ruling of 2026-09-07 (D-E6) landed the 12-hour deadline in the program, the shared constants, the
rules copy and the tests; the rules test now **forbids** the old figure rather than asserting it, and
the app's copy carries no hard-coded hours at all — it interpolates from the shared constant. The
deployed program matches the branch (`check-deployed`, run 2026-09-15).

What survives is the verification, and it is a read:

- `admin.ts status` prints `fill deadline: 43200 s` and `cooldown: 300 s`.
- On the first pool opened, `fill_deadline − opened_at == Config.fill_deadline_seconds`. Read
  `opened_at` from the Pool account: the `PoolOpened` event does not carry it.
- If the deadline ever needs to move mid-week, `set_pool_timing` is the admin instruction. It affects
  pools opened from then on and never rewrites one players have already entered.

**One flag, then dropped.** A refunded entrant gets `entry_lamports` back in full but not the Entry
account's rent or the pass asset's, which the program keeps: **0.004436 SOL per entry**, measured on
devnet 2026-09-11 (`docs/INFRASTRUCTURE.md`). Every pool opened also sinks one vault rent cushion of
**0.00065024 SOL**, measured 2026-09-15, which is never recovered. Both belong in the conservation
table; whether they belong on the rules page is Phase 6's problem.

### 4.1 Confirm the environment is up (Claude Code)

| Check | How | Expect |
|---|---|---|
| Program deployed | `solana program show <id> --url devnet` | executable; expected authority |
| Config initialised | `admin.ts status` | not "NOT INITIALISED" |
| Packet service | `GET /health` | 200 |
| Indexer | `GET /pools` | JSON array |
| Frontend | Pools tab | real data — **not** the `FIXTURE` pool |
| Daemon | `GET /health`, then a tick | 200; opens a pool when a tier opens in §4.10 |

A Pools tab showing `FIXTURE` means the frontend has no indexer URL and every screenshot will be worthless. Fix first.

### 4.2 Environment baseline → `ENVIRONMENT.md` (Claude Code drafts, founder confirms in F-08)

```
Cluster: devnet · Program id · Deployed commit · Admin · Entry signer (pubkey, TURNKEY | DEV SEED — from the boot log, not inferred)
Settlement signer · VRF coordinator (SWITCHBOARD_QUEUE | RANDOMNESS_ACCOUNT stub) · Geo mode (stub cc | vendor)
detection_hard_block · kyc threshold (expect 0) · paused=false · tier prices · tier pots · treasury balance · next_pool_id
deviceHash wired? · ipHash populated? · __BLOTTO_TEST_SIGNER__ present in deployed build? · RPC endpoint used
```

Two need a decision, not a reading. **Entry signer:** dev seed is fine on devnet; not knowing is not — that was the 29 August incident. **VRF:** a stub `RANDOMNESS_ACCOUNT` means the class draw is not evidence of anything; either switch to the queue for the week or state that class randomness is out of scope.

### 4.3 Tooling and RPC (Claude Code)

`solana`, `node ≥ 20`, `ts-node`, `playwright` + chromium. Choose a dedicated devnet RPC (Helius, QuickNode, Triton all have free tiers) — the public endpoint will throttle T6's 73 concurrent registrations and you would be measuring the RPC, not the app. Record it.

### 4.4 Wallets (Claude Code)

```bash
mkdir -p battle-test/keys/wallets && for i in $(seq -w 0 71); do
  solana-keygen new --no-bip39-passphrase --silent -o "battle-test/keys/wallets/$i.json"; done
echo "battle-test/keys/" >> .gitignore
```

72, not 64: T6 needs eight extra keypairs (W64–W71) whose registrations are meant to be rejected; with UI-C's deliberate late attempt that makes nine rejected registrations. Filename order is seat order for life: `00.json` is W00. Addresses only go into `registry/wallets.json` (§5.2).

### 4.5 The three UI accounts (founder, F-02)

Per email, in a separate browser profile: sign in, wait for the embedded wallet, copy the address from Profile, complete age attestation and terms clickwrap, screenshot the signed-in Profile. Send the three addresses, the profile names, and the terms version. Claude Code writes them into `wallets.json` with `deviceGroup` set — `device-1`, `device-2`, `device-3` normally; T7 changes this.

Then Claude Code checks `deviceHash()` in `app/src/entry/submit.ts`. Zeros → the device signal groups nothing, T7 is not testable, profiles may be shared. Wired → T7 is live and three profiles are mandatory outside it. Either way it is a line in `ENVIRONMENT.md`. Same for `ipHash`: three UI entries from one home IP produce an IP-correlation *note* on every pool — a note, never a block, but predict it rather than discover it.

### 4.6 Capital plan → `CAPITAL.md` (Claude Code)

(a) **Pot capital:** tier 0 at production economics, 5.12 SOL, plus tier 1 shrunk to 1024 lamports (§4.9). Two pots, locked in vaults until each pool is Paid or Closed. (b) **Treasury floor:** `min_platform` + reserve pots × idle-tier pots, from `admin.ts status`; `open_pool` refuses below it. (c) **Entry capital:** 6.4 SOL per full pool, recirculating — 80% to winners, 20% to treasury, 100% back on refund pools — so the standing need is one pool's worth if you sweep between pools. (d) **Sunk cost per entry** from §4.8 × 371 entries. Show the arithmetic.

### 4.7 Faucet (founder, F-01)

The binding constraint of the week. CLI `solana airdrop` is 2 SOL and per-IP throttled; `faucet.solana.com` with GitHub auth gives more per day. Start at 09:00 Day 0 into the funder Claude Code names, and repeat through the day. If the funder is also the admin key, say so in `ENVIRONMENT.md`.

### 4.8 Per-entry sunk cost, off-chain (Claude Code)

Never open a pool to measure this. Either `solana rent <Entry::LEN>` + the pass asset's size + 2 × 5000 lamports, or a balance diff around `env.register_as` in the LiteSVM harness — rent and fees are identical on devnet. Record both. `--target` for fan-out is measured total × 1.2. The first real T1 entry confirms it; a >10% discrepancy stops the week until explained.

### 4.9 Tier economics (Claude Code prepares, founder runs: F-04)

Tier 1 never pays a prize — the pot sits untouched and returns whole at `trigger_refund` — so its size proves nothing:

```bash
admin.ts set-tier-economics --tier 1 --price 0.1sol --pot 1024
```

Pot must be a multiple of 1024 lamports; `admin.ts` checks locally. Tier 0 stays at production economics — its money evidence is the point. The report states plainly that tier 1's pot was reduced for the rehearsal.

### 4.10 Fund the treasury and open the tiers (founder: F-05 on Day 0, F-11 at 09:00 Day 1)

```bash
admin.ts fund-platform-wallet --amount <n>sol     # Day 0, F-05 — permissionless
admin.ts set-open-tiers --tiers 1,1,0,0,0,0,0     # Day 1 09:00, F-11 — admin
```

Within one daemon tick: two `PoolOpened` events; `next pool id` +2; `reserved` up by both pots; both pools `Open` with a non-zero `vrf_seed` and a pass collection; two tiers enterable in the UI. **Record ids, PDAs and deadlines. Check `fill_deadline − opened_at == 43200`.** T1's clock starts now; T2's and T3's start when the daemon opens them — the instant the previous pool closes — which is why the chain starts at 09:00.

### 4.11 The code (Claude Code — WP1–WP4 in the session prompt)

0. Registry tooling — `wallets.json`, `plan.ts`, `harvest.ts`, `reconcile.ts`, `report.ts` (§5).
1. `battle-test/src/populations.ts` — `cappedField`, `wall`, `pole` + re-export `poolPopulation` (§6.2).
2. `battle-test/scripts/oracle.ts` — `scorePool` → `assignPrizes` → `rankOrder` + Merkle root, a component of `plan.ts`. Verify the real signatures first.
3. `battle-test/scripts/enter.ts` — the direct route (§6.1), mirroring `app/src/entry/submit.ts`.
4. Playwright driver around `entry-flow.spec.ts` with `__BLOTTO_TEST_SIGNER__` injection — **only if the hook survives into the deployed build**; check `typeof window.__BLOTTO_TEST_SIGNER__` in the live app's console. If stripped, the Playwright route does not exist; record the reduction against roadmap 5.1.
5. `FOUNDER-ACTIONS.md` — the F-catalogue (§3.3).

### 4.12 Put SOL in every wallet (Claude Code runs it; founder sees the numbers)

Every wallet that enters a pool needs the entry price (0.1 SOL), the sunk rent from §4.8, and fees — per pool it enters. Rather than budget per pool, every wallet is kept topped up to a fixed **target** and the top-up is repeated before every pool. The `fund` command is idempotent (it tops each wallet *up to* the target, sending nothing to wallets already there), so re-running it is always safe.

**Targets.** Headless wallets: **0.2 SOL** each — one entry plus margin; they are re-topped before each pool. UI wallets: **0.5 SOL** each — they enter up to seven pools, and refunds and prizes arrive between, but 0.5 means the founder never has to wait for a top-up mid-session.

```bash
cd battle-test
export FEE_PAYER_KEYPAIR=./keys/funder.json

# 1. See what is needed before sending anything
npx ts-node --transpile-only scripts/fan-out.ts status --target 0.2sol

# 2. Top the 72 headless wallets up to 0.2 SOL (batched, ~4 transactions)
npx ts-node --transpile-only scripts/fan-out.ts fund --target 0.2sol

# 3. Confirm zero shortfall
npx ts-node --transpile-only scripts/fan-out.ts status --target 0.2sol

# 4. The three UI wallets, 0.5 SOL each
solana transfer <UI-A address> 0.5 --url devnet --allow-unfunded-recipient --keypair keys/funder.json
solana transfer <UI-B address> 0.5 --url devnet --allow-unfunded-recipient --keypair keys/funder.json
solana transfer <UI-C address> 0.5 --url devnet --allow-unfunded-recipient --keypair keys/funder.json
```

Total on Day 0: 72 × 0.2 + 3 × 0.5 = **15.9 SOL** from the funder, plus fees. Claude Code pastes the final `status` output to the founder and saves it as `evidence/day0-balances.txt` — the opening balance for the conservation table.

**Before every pool** (loop step 8.0): `fan-out.ts fund --target 0.2sol` again, and a `solana balance` on each UI wallet with a top-up to 0.5 if any is below 0.2. After every full pool (8.12): `fan-out.ts sweep` returns prize money and leftovers to the funder so the next top-up comes from recirculated SOL, not the faucet.

### 4.13 Smoke test (founder: F-06, F-07; Claude Code: the rest)

Founder: drag practice until ≥ 26 on three stats in under ten seconds, reliably (this decides T4); then a UI dry run with UI-A to the review screen — **abandon before paying**. Claude Code: `oracle.ts` reproduces the committed Python vectors in `backend/scoring/fixtures/vectors.json`; `enter.ts` dry-runs its encoding against LiteSVM or a local validator (never devnet). If capital allows, a sacrificial tier-4 pool with a 1024-lamport pot takes one real `enter.ts` registration and is left to close.

### 4.14 Day 0 gate (founder signs off: F-08)

```
[ ] 4.0  R7 amended; 11 points done; suite green; upgrade deployed; signature logged
[ ] 4.1  five services up; frontend not on FIXTURE
[ ] 4.2  ENVIRONMENT.md complete incl. entry signer, VRF, deviceHash, test-signer presence
[ ] 4.3  tooling present; dedicated RPC recorded
[ ] 4.4  72 wallets; battle-test/keys/ gitignored; gitleaks green
[ ] 4.5  UI-A/B/C in wallets.json with deviceGroup; clickwrap signed
[ ] 4.6  CAPITAL.md with four figures and arithmetic
[ ] 4.7  funder covers the plan
[ ] 4.8  sunk cost measured: ______ lamports
[ ] 4.9  tier 1 economics set; signature logged
[ ] 4.10 treasury funded; floor covered — tiers NOT yet opened (that is F-11, Day 1 09:00)
[ ] 4.11 all tooling merged; CI rehearsal.yml green on a broken-plan fixture
[ ] 4.12 72 headless at 0.2 SOL, zero shortfall; UI-A/B/C at 0.5 SOL; day0-balances.txt saved
[ ] 4.13 drag practised; dry run done; oracle matches vectors
[ ] T7 status decided: LIVE / NOT TESTABLE, recorded
[ ] Playwright route: AVAILABLE / STRIPPED, recorded
[ ] STATE.md, LOG.md, FOUNDER-ACTIONS.md exist; issues T1–T8 open; board created
```

---

## 5. The registry — expected vs actual

Everything in this manual depends on one thing being true: that you can say, for any wallet, which pools it entered, what it was supposed to do, and what it actually did — and that the "supposed to" was written down *before* the outcome existed. That is the difference between a test report and a story told afterwards. This section is the machinery.

Three principles, and they are what make the rest of it defensible:

- **Expectations are derived, never typed.** You do not write "wallet 17 should come 4th." You write a population assignment, run the oracle over it, and the oracle writes the expected rank. A hand-typed expectation is just an opinion; a computed one is a prediction from a published rule.
- **Expectations are frozen before entry.** The plan file is committed to git before the first `register` lands, and the report cites the commit SHA alongside the first register's slot. Anyone can check the timestamps and see the prediction predates the result.
- **One identity per wallet, everywhere.** `W00`–`W71` for headless, `UI-A`/`UI-B`/`UI-C`. Never a raw pubkey in prose, never a seat number without its wallet id. Seats are per-pool; wallet ids are for life.

---

### 5.1 The file layout

```
battle-test/registry/
  wallets.json              the roster — identity, key path, address, history
  T1.plan.json              written before entry, committed, never edited after
  T1.actual.json            harvested after settlement
  T1.reconcile.md           the diff — generated
  T2.plan.json  …  T7.reconcile.md
  LEDGER.md                 generated summary across all pools
```

`plan.json` is append-only in spirit: once the first entry for that pool has landed, the file is frozen. If the plan turns out to be wrong, you do not edit it — you record the deviation in `reconcile.md` and explain it. A plan you can edit after the fact proves nothing.

---

### 5.2 `wallets.json` — the roster

Written once at Day 0 (§4.4–4.5) and updated by the tooling, never by hand after that.

```json
{
  "schema": "blotto-rehearsal-wallets/1",
  "cluster": "devnet",
  "generatedAt": "2026-09-15T08:00:00Z",
  "wallets": [
    {
      "id": "W00",
      "kind": "headless",
      "keypair": "battle-test/keys/wallets/00.json",
      "address": "…",
      "notes": "",
      "history": []
    },
    {
      "id": "W71",
      "kind": "headless",
      "keypair": "battle-test/keys/wallets/71.json",
      "address": "…",
      "notes": "reserved for T6 rejected-entry set",
      "history": []
    },
    {
      "id": "UI-A",
      "kind": "ui",
      "email": "…",
      "address": "…",
      "browserProfile": "Chrome profile 1",
      "deviceGroup": "device-1",
      "history": []
    }
  ]
}
```

`deviceGroup` is load-bearing for T7: it records which UI wallets share a browser, which is exactly what the `device_ip_correlation` signal is meant to catch. Setting it deliberately means the detection result is a prediction too, not a surprise.

Each `history` entry is appended by the reconcile step, so the roster answers "what has W17 done" without opening every pool file:

```json
{
  "pool": "T4",
  "poolId": 7,
  "seat": 17,
  "role": "field",
  "expectedRank": 31,
  "actualRank": 29,
  "expectedLamports": "0",
  "actualLamports": "0",
  "outcome": "MATCH_PAYOUT_RANK_DRIFT",
  "registerSig": "…"
}
```

---

### 5.3 `<test>.plan.json` — the frozen prediction

Generated by `plan.ts` (§5.5), committed, then left alone.

```json
{
  "schema": "blotto-rehearsal-plan/1",
  "test": "T4",
  "title": "Full pool — UI wallet wins",
  "cluster": "devnet",
  "programId": "…",
  "poolId": 7,
  "poolPda": "…",
  "tier": 0,
  "entryLamports": "100000000",
  "potLamports": "5120000000",
  "fillDeadline": "…",
  "frozenAt": "2026-09-16T09:14:00Z",
  "gitCommit": "…",

  "hypothesis": "A wall shape (three stats ≥ 26) beats a field capped at 25 on every battle, so UI-A takes rank 1 and band 1. A rotating pole loses every battle, so UI-B takes last. UI-C never touches the pentagon and lands mid-table, which also exercises R9 lock-current.",

  "expectations": {
    "terminalState": "Paid",
    "entrants": 64,
    "sealingEntry": "W62",
    "paidSeatCount": 16,
    "hardBlocks": [],
    "detectionNotes": ["W63 timing_profile"]
  },

  "seats": [
    {
      "seat": 0,
      "wallet": "UI-A",
      "route": "ui",
      "role": "winner",
      "generator": "ui-wall-drag",
      "target": [[33,33,34,0,0], "…7 rows…"],
      "tolerance": "any three stats ≥ 26",
      "expectedRank": 1,
      "expectedLamports": "1350000000",
      "expectedBalanceDelta": "+1249…"
    },
    {
      "seat": 3,
      "wallet": "W03",
      "route": "direct",
      "role": "field",
      "generator": "cappedField",
      "seed": 4003,
      "battles": [[21,19,22,18,20], "…7 rows…"],
      "expectedRank": 44,
      "expectedLamports": "0",
      "expectedBalanceDelta": "-100…"
    }
  ]
}
```

Three fields matter most:

- **`hypothesis`** in plain English. If you cannot state in two sentences why the outcome must happen, you have not engineered it — you are hoping. Writing it also makes the report's section 4 mostly free.
- **`expectedBalanceDelta`** per seat: `−entryLamports − sunkRent − fees + expectedLamports`. This is what turns the ranking prediction into a *money* prediction, and it is what report section 3's conservation table is built from.
- **`expectations.detectionNotes`**: predicting which detection signals fire is as much a test as predicting the winner. An unpredicted hard block is a finding.

---

### 5.4 `<test>.actual.json` — the harvest

Machine-collected after settlement, from four sources, with the source named per field so nothing is "just known":

| Field | Source |
|---|---|
| terminal state, entrants, `results_root`, payout list, `paid_mask` | on-chain Pool account |
| per-seat revealed battles, timings | the published Irys bundle |
| register signatures, slots | your own `enter.ts` log + the indexer's entries endpoint |
| balances before/after | `fan-out status` snapshots and `solana balance` for UI wallets |
| detection findings | the detection report for the pool |

```json
{
  "schema": "blotto-rehearsal-actual/1",
  "test": "T4",
  "poolId": 7,
  "harvestedAt": "…",
  "terminalState": "Paid",
  "entrants": 64,
  "resultsRoot": "…",
  "bundleUri": "…",
  "signatures": { "sealed": "…", "reveal": "…", "commitResults": "…", "payPrizes": ["…"] },
  "seats": [
    {
      "seat": 0, "wallet": "UI-A", "registerSig": "…", "slot": 0,
      "revealedBattles": [[34,33,33,0,0], "…"],
      "rank": 1, "scoreHalf": 882, "zones": 1323,
      "lamports": "1350000000",
      "balanceBefore": "…", "balanceAfter": "…"
    }
  ],
  "detection": { "findings": [], "hardBlocks": [] }
}
```

---

### 5.5 The four commands

Add these under `battle-test/scripts/`. All are thin — the real work is already in `backend/scoring` and the harness.

**`plan.ts --test T4 --pool <id>`**
Reads `wallets.json` and a seat map (which wallet gets which generator and seed, and which UI wallet gets which role), generates every headless battle set, takes the UI targets as declared intent, runs `scorePool` → `assignPrizes` over all 64, and writes `T4.plan.json` with ranks, prizes and balance deltas filled in. Refuses to write if: any two seats share an identical battle set, any entrant has fewer than three distinct shapes, any allocation does not sum to 100, or a wallet is already listed as having entered this pool. Prints the predicted top 16 and the predicted last place for you to eyeball before committing.

**`harvest.ts --test T4`**
Collects the four sources above into `T4.actual.json`. Fails loudly rather than writing partial data — a half-harvested file that looks complete is worse than none.

**`reconcile.ts --test T4`**
Diffs plan against actual; writes `T4.reconcile.md`; appends to each wallet's `history` in `wallets.json`; regenerates `LEDGER.md` and `RESULTS.md`; asserts that the freeze PR's GitHub merge timestamp precedes the first register's block time and marks the pool `UNFROZEN` if not. Every seat gets one of five verdicts:

| Verdict | Meaning |
|---|---|
| `MATCH` | rank and lamports both as predicted |
| `RANK_DRIFT` | lamports as predicted (usually both zero), rank moved within the unpaid field |
| `PAYOUT_MISMATCH` | money differs from prediction — **always investigate, never wave through** |
| `INPUT_DRIFT` | revealed battles ≠ planned battles. Expected on UI seats (dragging is approximate); on a `direct` seat it means the pipeline altered the entry, which is a bug |
| `ABSENT` | planned seat never landed |

The rule that keeps this honest: **`RANK_DRIFT` and `INPUT_DRIFT` on a UI seat are acceptable and expected; a `PAYOUT_MISMATCH` anywhere, or any drift on a `direct` seat, is a FAIL until explained.** The whole point of capping the field at 25 is that the winner and loser predictions survive sloppy dragging — if they do not, the margin was too thin and that is a finding about your test design, which belongs in the report too.

The generated `reconcile.md`:

```
# T4 reconcile — pool 7 — Paid
Plan frozen: PR #41 merged 2026-09-16T13:04Z (GitHub)  commit 3f2a9c1
First register: slot 312884190 · block time 2026-09-16T13:19Z   (freeze < first register: YES)
Root: on-chain 4f2a…  recomputed 4f2a…  MATCH
Payout sum == pot: YES        Seats paid: 16

seat  wallet  role     exp.rank  act.rank  exp.lamports  act.lamports  verdict
  0   UI-A    winner          1         1   1350000000    1350000000   MATCH
  1   UI-B    loser          64        64            0             0   MATCH
  2   UI-C    mid            38        41            0             0   RANK_DRIFT
  3   W03     field          44        44            0             0   MATCH
 63   W63     bot            57        57            0             0   MATCH

Verdicts: 61 MATCH · 3 RANK_DRIFT · 0 PAYOUT_MISMATCH · 0 INPUT_DRIFT · 0 ABSENT
Detection predicted: [W63 timing_profile]   observed: [W63 timing_profile]   MATCH
RESULT: PASS
```

**`report.ts`**
Assembles `REPORT.md` (§11) from what already exists — `ENVIRONMENT.md`, `RESULTS.md`, `LEDGER.md`, every `*.reconcile.md`, every `CARD.md`, and the `LOG.md` timeline — into the §11 skeleton, leaving three clearly marked narrative sections for Claude Code to write and the founder to review. A report that is mostly generated cannot drift from its evidence; a report that is mostly written can.

---

### 5.6 `LEDGER.md` — the summary

Regenerated by `reconcile.ts` after every pool; this is the "where am I" view and it becomes appendix material in the final report.

```
## By pool
test  poolId  state   entrants  MATCH  DRIFT  MISMATCH  result
T1        4   Closed        12     12      0         0  PASS
T4        7   Paid          64     61      3         0  PASS
T5        9   Paid          64     62      2         0  PASS

## By wallet
wallet  pools entered          roles              best rank  total won (lamports)  net delta
UI-A    T1,T4,T5,T6,T7         winner,capped,…            1          1350000000     +1.24 SOL
UI-B    T1,T4,T5,T6,T7         loser,capped,…            38                   0     -0.51 SOL
W63     T4,T5,T7               bot,wall,wall              1          2700000000     +2.6 SOL
```

The by-wallet half is what the founder asked for and what a reviewer will actually read: one line per wallet, every pool it touched, what it was for, what it won. It is also the fastest way to spot an accounting error — a wallet whose net delta does not equal (prizes won − entries paid − sunk rent) is a reconciliation failure somewhere upstream.

---

### 5.7 Where this plugs into the loop

The per-pool loop in §8 already has the steps; the registry is what they write into. Explicitly:

| Loop step (§8) | Registry action |
|---|---|
| 8.2 | `plan.ts` — generate seat map and population |
| 8.3 | `plan.ts` writes the plan; Claude Code opens the freeze PR; **founder merges (F-13 etc.)**; the merge timestamp is the freeze |
| 8.5 | `enter.ts` appends register signatures and slots |
| 8.9 | `harvest.ts` |
| 8.9 | `reconcile.ts` — writes the reconcile file and updates `wallets.json` + `LEDGER.md` |
| 8.11 | `CARD.md` quotes the reconcile summary line rather than restating it |

For refund pools there is no ranking, so the plan's `expectations` block carries `terminalState: "Closed"`, the entrant count, and a per-seat `expectedBalanceDelta` of `−sunkRent` only (entry price returned in full, rent kept by the program). `reconcile.ts` still runs; `PAYOUT_MISMATCH` there means a refund did not land or did not land in full, which is the single most important thing those three tests exist to prove.

---

### 5.8 Two failure modes to design against

**Editing a plan after seeing the result.** It will be tempting once — a prediction that missed by one rank, a typo in a seed. Do not. Add the correction to `reconcile.md` under "deviations" and leave the plan as it was. The commit history is the evidence; a rewritten plan destroys it.

**Predicting only the winner.** A plan that says "UI-A wins" and nothing else passes trivially. The plan predicts *every* seat's rank, every payout, the terminal state, the sealing entry, and the detection findings. A 64-row prediction that lands is strong evidence; a one-row prediction is a coin flip you called.

---

## 6. Headless entrants

### 6.1 Two routes

**Direct (Node) — `enter.ts`.** Per wallet, exactly what `app/src/entry/submit.ts` does: `encodePayload` → `seal` to the pool's `sealing_pubkey` → `putCiphertext` → `requestPacket` → `register` with the battles hash and the Ed25519 packet instruction. `tests/rehearsal/src/orchestrator.ts` already sequences this over `FakeChain`; the devnet version swaps in the real RPC and HTTP endpoints. Exact integers, concurrent, fast. This is the bulk route.

**Real frontend (Playwright).** `entry-flow.spec.ts` with `window.__BLOTTO_TEST_SIGNER__` injected, one browser context per wallet — what roadmap 5.1 literally asks for, and the only route that proves the frontend pipeline. Its weakness is the pentagon: dragging cannot hit exact integers and the 15-second timer is real. **Available only if the hook survives into the deployed build** (§4.11).

The plan uses direct for the bulk and Playwright for a quota: in each full pool, 8 of the 61 headless entrants go through Playwright with the same target shapes (dragged approximately), 53 go direct. If Playwright is flaky, drop the quota to 2 and record it; if the hook is stripped, the quota is 0 and the report says so against 5.1.

### 6.2 Setting each headless wallet's battles

By population file, never by hand. `battle-test/src/populations.ts`, each generator deterministic from a seed:

| Generator | Produces | Used for |
|---|---|---|
| `cappedField(seed)` | Free-integer allocation, rejection-sampled until every stat ≥ 1 and ≤ 25; distinct per seed; `random`-profile timings | the beatable background in T4, T5, T7 |
| `wall(seed)` | Three stats ≥ 30, two ≤ 3; **which three rotates per battle** | the engineered winner |
| `pole(seed)` | 100 on one stat, 0 elsewhere; the stat rotates per battle | the engineered certain loser |
| `poolPopulation(seed)` | the existing four-strategy mix | T1–T3, T6 |

Invariants every generator asserts, and why: **no two entrants share an identical seven-battle set** (the one allocation signal that hard-blocks — R11); **≥ 3 distinct shapes per entrant** (`allocation_entropy` fires "strong" at ≤ 2; one strong signal alone only recommends review, but keep the evidence clean); **varied timings** (uniform 1400 ms trips `timing_profile`; wanted in exactly one seat per pool as shadow evidence, not sixty).

The seat map — which wallet gets which generator and seed — is what `plan.ts` consumes (§5.5).

---

## 7. Engineering the outcome

### 7.1 The rule, in four lines

From `backend/scoring/src/engine.ts`, the published rule: a stat is won by the larger number, ties to neither; a battle by ≥ 3 of 5 stats, else a draw; score in half-points, win 2, draw 1, your battle *k* against every other entrant's battle *k*; rank by score, then total stats won; equal on both is a shared rank and a split prize.

Because the whole field is yours, outcomes are constructed, not hoped for.

### 7.2 Three recipes

**Certain loser — `pole`.** `[100,0,0,0,0]` loses four stats against any opponent with four non-zero stats. Against `cappedField` (all stats ≥ 1) it loses every one of its 7 × 63 comparisons. Rank 64.

**Certain winner — `wall` against `cappedField`.** If no background stat exceeds 25, any allocation with three stats ≥ 26 wins those three against everyone and so wins every battle: 882 half-points, rank 1 — unless a second entrant also wins everything, which is why the *other* UI wallets in a "wins" pool play `pole` or capped.

**Mid-table — even split.** 20 × 5 against `cappedField` finishes in the middle. Letting the timer expire seven times produces exactly this (R9 lock-current) and tests that rule for free.

### 7.3 Through the UI — AMENDED for the control that exists

*The pentagon radar is gone. The allocation screen is five horizontal slider dials, one per stat in
the fixed order, each with a live integer and a padlock button, under a rack of seven tiles that
fill as battles are locked. The tolerance bands and the field cap below are what matter and survive
any UI change; the keystrokes are current as of 2026-09-15. `FOUNDER-ACTIONS.md` carries the
step-by-step.*

**The three rules that changed, and that decide whether a recipe works:**

1. **One 90-second clock for the whole run of seven**, not 15 seconds per screen. It starts on the
   **first dial movement or lock press** and never stops between battles. Touching nothing does not
   start it, so a player who touches nothing waits forever rather than timing out.
2. **On expiry every unlocked battle is entered as the even split** — 20/20/20/20/20 — including the
   one on screen, whatever shape it was showing. (The original text cited "R9 lock-current"; that was
   superseded by the founder addendum of 2026-09-07.)
3. **Moving one dial re-apportions the other four proportionally**, integer-only, largest remainder,
   so the five always total exactly 100. A stat already at 0 stays at 0. The dragged stat lands
   exactly on its target, so **UI allocations are now exact and predictable** — which means
   `INPUT_DRIFT` on a UI seat is a failure like any other, not the expected noise §5.5 assumed.

| Role | Instruction (keyboard is fastest and exact) | Holds if |
|---|---|---|
| Winner | Focus two dials and press **Home** on each. Result 34/33/33/0/0. Rotate which two each battle | any three stats ≥ 26 |
| Loser | Focus any dial, press **End**. Result exactly 100 on that stat. Rotate it each battle | one stat ≥ 76 |
| Mid | Press **one padlock** to start the clock, then wait out the 90 seconds without locking | exactly 20 × 5 on all seven |
| Capped (T5, T7) | Focus Strength, press **Shift+ArrowRight** once → 25/19/19/19/18 | no stat above 25 |

Exact integers that free movement cannot reach are reachable **with locks**: set a stat, lock it, set
the next, lock it, and the last unlocked dial is fully determined. This is how 33/33/34/0/0 is made,
if the literal plan target is wanted rather than the tolerance.

**Screenshot the rack, not each lock-in.** After seven battles one image of the rack carries all
seven allocations with their five numbers each. The per-lock-in shots remain a useful backup.

**A timer-expiry entry has a distinctive timing profile** — roughly 90000 ms on battle 1 and 0 ms on
battles 2 through 7 — which the plan should predict rather than discover.

### 7.4 Predict, then verify

`plan.ts` runs the oracle over the 61 headless sets plus the intended UI sets and freezes the ranks (§5.3). After the reveal, `harvest.ts` fetches the bundle and `reconcile.ts` re-runs the engine over the *revealed* sets: the root must equal on-chain `results_root`, payouts must equal the on-chain list, and each UI wallet's revealed battles must match its lock-in screenshots. A pre-announced 64-row prediction matched against on-chain commitments is the strongest single artefact in the report.

---

## 8. The per-pool loop

Twelve steps, every pool. Claude Code drives; the founder is called in at 8.3, 8.4, 8.7 (deadline pools) and 8.8.

| Step | Who | Action | Evidence → `evidence/T<n>-pool-<id>/` |
|---|---|---|---|
| 8.0 | CC | Top up: `fan-out.ts fund --target 0.2sol`; check the three UI balances, top up to 0.5 if any is under 0.2; paste the status to the founder | `balances-before.txt` |
| 8.1 | CC | Read the open pool for this tier; create the folder; record id, PDA, `fill_deadline`, `sealing_pubkey`, `sealing_secret_hash`; screenshot pool page at 0/64 | `pool.json`, `open.png` |
| 8.2 | CC | `plan.ts` — seat map, population, UI roles per the §9 card | seat map |
| 8.3 | CC → **founder** | Open the freeze PR with the predicted top 16 and last place in the description; founder merges (F-13/16/24/28). **No entry before the merge.** | `registry/T<n>.plan.json`, PR #, merge time |
| 8.4 | **founder** | UI entries in role order A, B, C: screenshot pre-flight, each lock-in, review screen, seat card; send signatures | `UI-*/` (10 screenshots + `tx.txt` each) |
| 8.5 | CC | `enter.ts` for the headless seats per the card; Playwright quota; log every signature | `headless-register.log` |
| 8.6 | CC | Confirm entrant count matches the plan; screenshot; `admin.ts status` for the entry signer | `filled.png`, `status.txt` |
| 8.7 | CC (+ founder at deadline) | Refund pools: log the deadline, wait; at deadline the daemon triggers and refunds, founder screenshots (F-19/21/30). Full pools: watch the daemon — `PoolSealed`, reveal, `commit_results`, `pay_prizes`; copy signatures | `settlement-sigs.txt` |
| 8.8 | **founder** | Post-settlement screenshots: pool ranking, each UI profile (F-15/18/27) | `settled-*.png` |
| 8.9 | CC | `harvest.ts` → `reconcile.ts`; root recompute; `RESULTS.md`, `LEDGER.md` regenerate | `T<n>.actual.json`, `T<n>.reconcile.md` |
| 8.10 | CC | Balances after for every wallet (`fan-out status`; `solana balance` for UI); treasury and vault for refund pools; diff against 8.0 | `balances-after.txt` |
| 8.11 | CC | `CARD.md` quoting the reconcile summary; comment on the issue; close it or open the FAIL item | `CARD.md` |
| 8.12 | CC | `fan-out sweep` (full pools); confirm the daemon opened the tier's next pool; update `STATE.md` | — |

Explorer: `https://explorer.solana.com/tx/<sig>?cluster=devnet`, `.../address/<pda>?cluster=devnet`.

---

## 9. Recipe cards — AMENDED

What changes inside the §8 loop, per test. All eight run on **tier 0**, sequentially. Founder steps
are in `FOUNDER-ACTIONS.md`; these are the plans and the pass criteria.

**Two facts apply to every card below.** Rank 1 takes the **entire pot** (4 SOL at tier 0) and no
other rank is paid, so "the top 16" appears nowhere. And every pool opened permanently sinks one
vault rent cushion of 650240 lamports, so no vault ever ends at zero.

### T1 — Refund, sparse (12 · F-12, F-19)
Both UI accounts played naturally; W00–W09 from the four-strategy mix. 12 is far below the 40-seat
floor, so at the deadline the daemon calls `trigger_refund`, the untouched pot returns from the
vault to the treasury, and each entry is refunded exactly `entry_lamports` **from the treasury**.
**Pass:** state `Closed`; every after-balance = before + exactly 0.1 SOL; each entrant down only the
sunk rent and fees; the vault holds exactly the rent cushion; the tier's next pool opens five minutes
later. The plan is frozen without an oracle — a refund pool is never scored.

### T2 — Refund at the boundary (39 · amended from 40)
As T1 with 39 seats: the **last count that still refunds**. Documentary purpose: the fork is decided
at 40, and 39 is on the refunding side of it. Pass as T1 with 39 refunds.

### T3 — Seal at the minimum field + pause (40 · amended from "refund at 63")
**This is no longer a refund test.** At exactly 40 seats the pool reaches its deadline at the floor,
so `seal_at_deadline` seals it, the crank scores it, and rank 1 is paid the whole pot. It is the
first count that plays, and it exercises the fork the site advertises on every pool page.
At about 30 entrants the founder pauses entries: one headless attempt should be refused with
`Paused` (6005) and one UI attempt should show the paused copy, having paid only a transaction fee.
Then entries resume to exactly 40. **Stop at 40 — a 41st is harmless, but the boundary is the point.**
**Pass:** state `Paid`, not `Closed`; `seal_at_deadline` fired, not `trigger_refund`; the recomputed
root matches on chain; rank 1 received the pot; the paused attempts reverted and nothing else was
affected.

### T4 — Full pool, UI wallet wins (64 · UI-A winner, UI-B loser)
W00–W61 capped field (no stat above 25), W62 the scripted bot, UI-A the wall, UI-B the pole. UI seats
first, headless after. **Pass:** root and payouts match; UI-A is rank 1 and receives the **whole 4 SOL
pot**; UI-B is last and unpaid; UI-A's revealed battles match the rack screenshot exactly — since the
dials land on exact integers, any difference is a failure, not dragging noise.

### T5 — Full pool, headless wallet wins (64 · both UI accounts capped)
Both UI accounts capped at 25, W00–W61 capped field, **W62 the wall**, entered last. **Pass:** W62 is
rank 1 and takes the pot; neither UI wallet is paid; both UI balances down exactly entry plus rent.

### T6 — Oversubscribed + load (64 land, 9 attempt)
UI-A and UI-B early, then wait. Claude Code fires the headless field concurrently and calls GO at
62/64; UI-B starts a session, **moves one dial to start the clock**, takes the full 90 seconds and
submits into a sealed pool. **Pass:** exactly 64 `EntryRegistered`; nine reverts carrying
**`PoolNotOpen` (6000)**, not `PoolFull`; fill under 5 minutes; crank under 2; the late entrant sees
the legible "filled before your entry reached it" copy, not a spinner, and is charged only the fee;
her ciphertext was stored before the failed payment, which is the documented ordering.

### T7 — Same device → review (64 · both UI accounts in ONE browser profile)
Both UI accounts signed in to the **same** browser profile, so they derive an identical device marker
for this pool; all capped; W62 the wall so a headless seat wins. **Detection will not flag them by
itself** — the daemon stores a report and alerts, then hard-blocks nobody, by the manual-only policy
ruling. So T7 is a test of the **review path**: the finding appears in the detection report, a
configured reviewer signs a decision for each seat, and the forfeit is then landed on chain by the
admin key as a **separate transaction**. **Pass:** `flag_entry` lands before `pay_prizes`; both seats
escrow; the release pays its player; the forfeit **moves no lamports** — the share stays in the pool's
vault until `pay_next_place` divides it among the next eligible place, and it never reaches the
operator. The appeal path is **not testable**: the reviewer registry holds one member.
**T7 is NOT TESTABLE at all unless the founder holds that reviewer key** — see `DRIFT.md` Q7.

### T8 — Verify page + non-founder recompute
Desk work. Hand a non-founder the pool addresses and the **bundle URIs from each `actual.json`** — the
verify page only auto-fills a bundle when the pool has a verified archive — plus the oracle. One
signed line per pool that the root matched. No wallet or login is needed to verify.

---

## 10. Evidence card — `CARD.md`, one per pool

```
# T<n> — <name>        Pool <id>  PDA <pda>  Tier <t>      Cluster devnet  Program <id>  Entry signer TURNKEY|DEV
Plan: registry/T<n>.plan.json  frozen PR #<n> merged <utc>  commit <sha>   first register slot <n> <utc>  freeze<first: YES/NO
Timeline: open_pool <sig> · UI-A/B/C <sig> <sig> <sig> · PoolSealed|deadline · [set_paused on/off <sig> <sig>]
          reveal <sig> (sha256(secret)==hash YES/NO) · commit_results <sig> root <hex> · pay_prizes <sig>… (sum==pot YES/NO)
          [RefundTriggered <sig> pot returned <n> · Refunded ×<n> each==entry YES/NO] · [release/forfeit <sig> <sig>] · bundle <uri>
Outcome:  state Paid|Closed · entrants <n> · recompute root MATCH|MISMATCH · payouts MATCH|MISMATCH
          UI-A rank <r> paid <n> battles==screenshots YES/NO · UI-B … · UI-C …
          detection predicted [..] observed [..] MATCH|MISMATCH · hard blocks <none|list>
Reconcile: <the summary line from T<n>.reconcile.md>
Balances: UI-A/B/C, headless total, treasury, vault — before / after / delta / expected delta
Deviations:
```

---

## 11. The report — `REPORT.md`

`report.ts` assembles the skeleton from committed files; Claude Code writes the three narrative sections (*italic*); the founder reviews (F-33).

1. **Scope and environment** — from `ENVIRONMENT.md`, plus the §0 corrections stated plainly.
2. **Results** — `RESULTS.md` verbatim, with a link to each `CARD.md`.
3. **Money conservation** — one table across all pools: pots funded, entries taken, prizes paid, escrow released/forfeited, refunds paid, rent sunk, treasury start vs end. From `balances-*.txt` and the reconciles.
4. *Outcome engineering and the prediction record* — per pool: freeze PR merge time vs first-register block time; the reconcile table; a statement that the field was constructed and why a 64-row prediction that lands is stronger than a natural field.
5. **Wallet ledger** — `LEDGER.md`'s by-wallet table.
6. **Player experience** — per UI wallet, per pool: what the player saw at each state, with the screenshots. The section a product reviewer reads.
7. **Load and timing** — T6 against the 5.4 thresholds.
8. **Detection shadow log** — every finding across the paid pools, by signal; confirm only R11's two signals hard-blocked.
9. *Open items* — every FAIL, UNFROZEN and NOT TESTABLE with the roadmap item it belongs to. A skipped T7 lives here, not in the pass column.
10. **Timeline** — `LOG.md` verbatim.
11. **Appendix** — every `CARD.md` and `*.reconcile.md`; the T8 statements.

`RESULTS.md` is the one-screen version that sits above all of this and is regenerated after every pool; a CI check fails the default branch if it contains a `FAIL` or `UNFROZEN` row without a matching §9 entry.

---

## 12. Things that will bite — AMENDED

- **The floor is 40, and it decides everything.** Below it a pool refunds; at or above it the pool
  plays. Two of the original eight tests were built on the opposite rule.
- **The 12-hour window runs from `open_pool`, not from the first entry**, and a pool's successor
  opens **five minutes** after it closes, not instantly.
- **A pool keeps the deadline and the floor it opened under.** Both are copied onto the pool; a later
  `set_pool_timing` or a program upgrade never moves them for players already seated.
- **The clock does not start until the first dial movement.** "Touch nothing and let it expire" waits
  forever. Press one padlock first.
- **Expiry enters the even split**, not the shape on screen. A great allocation left unlocked is lost.
- **Never let a stray entry into a pool that is not a named test.** It locks tier 0 — the only tier
  the week uses — for the whole fill window, and cannot be undone.
- **Both accounts in one browser profile is T7 and only T7.** Outside it they must be separate
  profiles, and never a private window: a fresh profile secret breaks the grouping T7 needs.
- **A refunded entry is invisible on the profile.** The evidence is the wallet balance and the pool
  page state, nothing else.
- **A headless entrant must attest first.** No stored age and terms attestation means the packet
  service refuses with a generic 403 that names no reason.
- **`set-paused` does not stop a new pool opening.** It blocks entries only. Stopping the daemon is
  what prevents an open — and that also stops settlement.
- **Language.** `check-language.sh` greps the **whole tree**, including `battle-test/`, on every
  change. It has already caught this manual three times and the tooling three more. A review-link URL
  and several ordinary English words are on the list; read the failure rather than arguing with it.
- **Faucet.** Everything recirculates except rent and fees, but the upfront capital is real: about
  0.0044 SOL sunk per entry and 0.00065 SOL per pool opened, neither recoverable.
