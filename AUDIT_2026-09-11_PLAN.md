# Blotto Cup — the road from the 2026-09-11 audit to green

**Status:** founder-approved plan, 2026-09-12. Companion to `AUDIT_2026-09-11.md` (the cold read)
and `AUDIT_2026-09-11_RESPONSE.md` (what PR #106 changed). This file is the inventory of everything
that still stands between that audit and a fully green report — every blocker, every founder
decision, the batched MEDIUM/LOW backlog, the order to do it in, and how each item is shown closed.
It is written to the founder ("you") by the architect ("me"); the executable steps are precise
enough for whoever runs them.

**Update rule:** architect-owned. A wave that completes gets its addendum in
`AUDIT_2026-09-11_RESPONSE.md`; a decision the founder makes gets its dated line in
`docs/BUILD-ROADMAP_v1.0.md`'s register and is struck through here. Wave 0's code items (§5, §3a,
D-43) landed in the PR that added this file.

## Context

The cold-read audit (`AUDIT_2026-09-11.md`, verdict DO NOT SHIP) found 4 CRITICAL, 16 HIGH,
118 MEDIUM and 98 LOW findings. PR #106 (merged 2026-09-12) closed all four CRITICAL, twelve HIGH
and the eight Tier 3 hygiene items, and proved the on-chain change on a built program in CI. The
founder now wants the complete remaining picture: every decision and every blocker that still
stands between the audit and a fully green report with every change implemented — each with an
overview, a recommendation, and a step-by-step plan where one is executable (e.g. redeploying the
program).

This plan is the inventory and the sequencing. It is written for the founder (non-technical) with
the executable steps kept precise enough for an executor.

## 1. The blockers (must happen before anything else is trusted)

These are not decisions. They are sequenced operations that nobody has run yet. Until they run, the
rent-cushion fix is proven only on a CI build, and the deployed devnet program still has the
one-lamport freeze (B-03) live.

### 1a. Redeploy the program to devnet — BLOCKER, founder's keys

**What it is.** The merged program (`706a6c0` rent cushion, `cbb0bec` reserve counts the cushion)
is not on devnet. The deployed binary still funds vaults with the pot alone.

**Good news found in exploration.** No account migration is needed: `Config` is unchanged at 484
bytes (`programs/blotto_cup/src/state.rs:160-167`, pinned by `account_layouts_are_pinned`), the only
new surface is the appended error `WouldStrandRentBalance` (6071). So `scripts/admin.ts migrate-config`
is NOT part of this; it is a plain binary upgrade. On devnet the upgrade authority is still the
single fee payer `GXKXLYHBWBAhp7LWNMEZbsuwGb3WHeoDBsmhfndwagXY` (`~/.config/solana/blotto/fee-payer-devnet.json`,
`config/custody.json`), not Squads — runbook step C4 moves it and is deliberately deferred until
after the rehearsal (`docs/devnet-rehearsal-runbook.md:468-503`, prior-audit item O5). So no Squads
proposal is needed for the binary. `Config.admin` IS already the Squads vault `9EEWtz…`, so any
admin instruction (none is required here) would be a proposal.

**Step by step (you run these; one command per line, no backslash continuations — the 2026-09-05
rule in `docs/OPERATING-MANUAL.md:31-33`).**

1. On the ops machine, confirm the ambient wallet is the fee payer, because every bare `solana` /
   `anchor` command signs with it:
   `solana address -k ~/.config/solana/blotto/fee-payer-devnet.json` → must print `GXKX…agXY`, and
   `solana address` (no flag) must print the same.
2. Confirm the fee payer holds enough for the upgrade (rent for a larger binary plus fees; the
   runbook's guidance is ~10 SOL on devnet): `solana balance --url devnet`.
3. Fetch `main` at or after the merge of PR #106 and confirm `git log -1` shows `7043149` or later.
4. **Drain check — never skip** (`docs/OPERATING-MANUAL.md:270-278`): `npx ts-node --transpile-only scripts/admin.ts pools`
   must report every pool `drain: CLEAR`. If any pool is `Sealed`, `Scored` or `Refunding`, wait for
   it to settle or refund before upgrading.
5. Run the deploy script with the program keypair and the database URL so the indexer
   migrate/re-derive step runs too:
   `BLOTTO_PROGRAM_KEYPAIR=~/.config/solana/blotto/blotto_cup-program-devnet.json BLOTTO_DEPLOY_KEYPAIR=~/.config/solana/blotto/fee-payer-devnet.json ./scripts/deploy-devnet.sh`
   (since 2026-09-12 the script names its signing key, raises the open-file limit and sends the
   upload itself with retries — the runbook's recovery note of that date says why)
   The script (`scripts/deploy-devnet.sh:36-106`) refuses a keypair whose pubkey is not `declare_id`,
   runs `anchor build` (strict, not `--ignore-keys`), extends the program account if the binary
   grew, runs `anchor deploy`, prints `solana program show`, then runs the indexer's `migrate` and
   `re-derive`. If `ANCHOR_PROVIDER_URL` is used it must be `export`ed.
6. Verify three ways, in this order:
   - `solana program show 5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17 --url devnet` — the
     deployed slot advanced; authority still `GXKX…agXY`.
   - `npm run check-deployed` — the wire-contract drift check (`scripts/check-deployed.ts`), which
     simulates every admin instruction against the live program and fails on 101/102. It was built
     after the 2026-09-05 nine-day-stale-deploy incident; a clean `program show` is not evidence.
   - `npx ts-node --transpile-only scripts/admin.ts status` — `Config` still 484 bytes, tiers,
     policy and reserved figures unchanged.
7. Redeploy the backend (Actions → `deploy-backend`) so the daemon image carries the reveal client
   that sends `pay_prizes` with Config writable (`d29464d`) and the crank guards. Then
   `GET /health` on all four Fly apps and Actions → `backend-status`.
8. **Prove B-03 on devnet, cheaply, before the rehearsal**: open one tier-0 pool via the keeper (the
   daemon does this), send its vault 1 lamport from any wallet (the vault address is
   `["vault", pool_id]`), let it run to payout or refund, and confirm the pool reaches Paid/Closed
   and the tier slot frees. This is the vault_dust test replayed against the real cluster.
9. Record the deploy slot and date in `docs/devnet-rehearsal-runbook.md` (its Key Register and
   recovery notes are the operating memory) and tick O15 in `docs/AUDIT-2026-09-07.md`.

**What changes for the operator after this deploy.** Each pool open now costs the pot plus one
rent cushion — the runtime's rent-exempt minimum for an empty account, read from the network at
open (`programs/blotto_cup/src/vault.rs:62`): 890,880 lamports under the standard parameters,
650,240 on devnet as of 2026-09-12 — and the treasury floor per idle enabled tier rises by the
same. The runbook's Stage D SOL figures were already marked SUPERSEDED
(`docs/devnet-rehearsal-runbook.md:632-658`); recompute the treasury bootstrap from a measured
pool 1 (prior-audit O16's own note) and add one cushion per pool.

### 1b. The credentialed devnet rehearsal through the real front end — BLOCKER, founder-attended

**What it is.** The twenty-pool rehearsal that runs in CI is offline (`tests/rehearsal`, a
`FakeChain`). The credentialed run on devnet through the deployed app has never happened
(`docs/devnet-rehearsal.md:1-4`, prior-audit O16: "harness written, no runner wired"). It is the
first time entry, settlement and payout will all have worked at once against a real cluster, and the
audit's own "next gate".

**Prerequisites** (`docs/devnet-rehearsal.md:11-19`, runbook Stage C): Squads vault as admin
(done, C3); Turnkey sandbox entry + settlement signers and the pool-key export policy (C1, C6);
fee payer ~10 SOL; bank wallet working capital (fronts each pool's entries plus ~0.41 SOL/pool of
unrecoverable rent); platform treasury bootstrap ≥ 6 SOL plus one cushion per pool; settlement
signer funded (daemon refuses below 0.05 SOL); Irys devnet upload wallet funded; app deployed in an
EU region; a Helius URL (public RPC will not carry the load step).

**Step by step (runbook `docs/devnet-rehearsal.md:21-124`; the founder signs a Squads proposal at
every treasury sweep, so the run is ten segments of two pools with an attended sweep between).**

1. Fund: fee payer, settlement signer, bank wallet, Irys wallet; confirm each with `solana balance`.
2. `scripts/admin.ts fund-platform-wallet` for the bootstrap; `set-open-tiers` to tier 0 only.
3. Bring services up in order: indexer (`sync`: migrate → backfill → serve), packet, daemon, review;
   create the Helius webhook against the indexer's secret.
4. **5.1** — twenty pools through the orchestrator, at least one through the real front end
   (`tests/rehearsal/playwright/entry-flow.spec.ts` with `APP_URL`).
5. **5.2** — the failure paths once each: a sub-52 pool → `trigger_refund`; a 63-entry pool at the
   deadline seals; `set_paused` mid-fill and resume; a Turnkey export refusal → deadline refund; one
   deliberate flag → `release_escrow` / `forfeit_escrow`. Add the one-lamport donation from 1a step 8
   to one pool here if not done earlier.
6. **5.2a** — end-of-run treasury recovery: disable tier 0, `withdraw-platform`, `status`.
7. **5.3** — public verification of all twenty pools from `/verify`, wallet disconnected, one
   non-founder recompute. (This is where D-02 bites — see §3 — the bundle address must reach the
   page, so do §3's D-02 fix BEFORE this step.)
8. **5.4** — load: one pool fills in under 5 minutes at 64 concurrent; the crank settles in under 2.
9. Recompute the Stage D budget from measured pool 1 and record it (closes the SUPERSEDED note).

**Then, and only then:** runbook C4 — move the upgrade authority to the Squads vault
(`solana program set-upgrade-authority 5aaw… --new-upgrade-authority 9EEW… --url devnet`, verify
with `solana program show`), record it in `config/custody.json`, tick O5. After C4 every program
upgrade is a Squads buffer-upgrade proposal, which is why it comes after the fix is proven.

## 2. Decisions the founder owns (nothing moves until each is made)

Each entry: what it is, the options, my recommendation, and what happens the moment you decide.
Per CLAUDE.md these are yours (and counsel's where §8 is touched); I am not choosing, I am
recommending.

### 2a. B-22 — a second reviewer (prior-audit O24) — BUSINESS DECISION, then a one-line config change

**What it is.** `config/reviewers.json` holds one member. The published appeal rule requires a
different reviewer from the one who upheld the flag, and the review service enforces it
(`backend/detection/src/appeals.ts:120-131` returns `same_reviewer`). So today an appeal can be
lodged but never decided; the service warns at boot (`backend/detection/src/main.ts:125-130`).

**What adding one takes.** Only a public key: a second trusted person generates a Solana keypair
(never shared), and their base58 public key is appended to `members[]` with `version` and `updated`
bumped. No Turnkey identity, no Squads change, no code change. They sign decisions in the admin
review page with that key.

**Recommendation.** Name the second reviewer before the rehearsal's 5.2 step (the deliberate flag
exercises the appeal path). The natural candidates are the counsel engaged under R1 or a co-founder;
the constraint is that they must be reachable inside the seven-day decision window. Until it is
done, the appeal panel now renders honestly (C-04 fix) but every lodged appeal will sit undecided.

**Steps.** (1) You: pick the person; they run `solana-keygen new` on their own machine and send you
the *public* key. (2) Me: PR adding it to `config/reviewers.json`, bump `version`/`updated`; the
review service's boot warning disappears. (3) Rehearsal 5.2: lodge and decide one appeal end to end.

### 2b. Detection — report, or act? — ~~PRODUCT DECISION~~ RATIFIED 2026-09-12, register D-E9

**RATIFIED 2026-09-12 as option (a), register row D-E9** in `docs/BUILD-ROADMAP_v1.0.md`: reports
are persisted and the concerning findings are surfaced in the reviewer's page before the review
window closes; no signal acts automatically. R11's automatic path waits for ten settled pools of
quiet data and stays a signed decision. The report surface ships with batch R1 (A-18, D-36).

**What it is.** The five detection signals run on every settled pool, but the daemon hard-codes
shadow mode (`backend/reveal/src/main.ts:302-327`: `fullEscrowTier: false`, the report is
`console.log`ged only when it has findings, and the closure always returns `[]`). The on-chain switch
`Config.detection_hard_block` (`set_detection_hard_block`) has **no off-chain reader** — flipping it
would change nothing. Findings reach no human surface: the admin review page only drives the manual
`/decisions` flow over entries already flagged by a person. R11 ratified hard-block on two signals
(exact-duplicate battle sets, same-device multi-entry); the 2026-09-07 ruling put detection in
"manual-only" shadow mode. Both are on record; the code implements neither fully.

**Options.**
- (a) **Report** — keep manual-only, but persist every report and surface `reviewRecommended`
  findings in the admin review page, so a human sees them before the review window closes. No
  policy change; the reviewer still decides every flag.
- (b) **Act** — read `Config.detection_hard_block` in the daemon and return `report.hardBlocks` from
  the closure when it is on; the crank already flags what the closure returns before paying
  (`backend/reveal/src/crank.ts:257-282`). This is R11 as written.
- (c) Leave as is — findings continue to reach nobody.

**Recommendation.** (a) now, before the first pool with strangers in it; (b) only after ten settled
pools of shadow data show the two hard-block signals fire on nobody honest. (c) is the one option
that makes the "detection + review before first settlement" commitment (C9) untrue in practice.
(a) touches only the backend and the admin page; (b) additionally needs the founder to confirm the
switch on chain via a Squads proposal, which is the point — acting is a signed decision.

### 2c. B-07 — the archive serves three fields the Merkle root does not cover — ~~DECISION on scope~~ RATIFIED 2026-09-12, register D-E8

**RATIFIED 2026-09-12 as option (2), register row D-E8** in `docs/BUILD-ROADMAP_v1.0.md`: only
`player ‖ rank ‖ amount` stays under the verified label, `seat` comes from the indexer's own chain
records, score and zones are labelled recomputed, and bundle discovery is constrained to our own
storage address. Option (1) is explicitly not chosen. **Batch I1 is unblocked** (B-07, C-25, D-28,
F-06).

**What it is.** The committed leaf is `player ‖ rank ‖ amount` (`backend/scoring/src/merkle.ts:34-54`).
The archive also serves `seat`, `score_half` and `zones` under the same "verified" flag
(`backend/indexer/src/read-api.ts:370-397`), taking `seat` verbatim from the untrusted bundle
(`archive.ts:148-156`), and finds bundles on Irys by tag alone with no owner filter
(`archive.ts:167-191`) — anyone can upload a same-tagged bundle and win the "newest" query.

**Options.**
- (1) Extend the committed leaf to cover the three fields — a program change (`programs/blotto_cup/src/merkle.rs`
  and every proof check), the crank, the verify page, and a bundle-version bump: a compatibility
  break for every settled pool's proofs.
- (2) Stop presenting uncommitted fields as verified: derive `seat` from the indexer's own
  `payouts`/`entries` rows, label `score_half`/`zones` as recomputed-not-committed (or omit them from
  the verified view), and constrain `discoverBundleUri` to the operator's own Irys address with the
  announce path (D-02) as primary.

**Recommendation.** (2) now — it is a backend-only change with no compatibility cost and it closes the
forgery route. Decide (1) at the next program-upgrade window, after C4 makes upgrades multisig-gated,
and only if the product wants `score`/`zones` to be part of what a player can prove rather than what
they can recompute (the verify page already recomputes both from the sealed entries, which is the
stronger guarantee anyway).

### 2d. KYC threshold (prior-audit O9) — FOUNDER + COUNSEL, standing

D-E5 (2026-09-06) keeps the switch built and OFF (`kyc_required_above_lamports = 0`). Turning it
on must first revisit the two payment paths that present no packet (auto-release, next-place). No
action in this plan; recorded so it is not mistaken for a gap.

### 2e. The numbers I defaulted in PR #106 — RATIFY OR CHANGE (the ceiling ratified 2026-09-12, register D-E10)

| Where | Default today | My recommendation | How it changes |
|---|---|---|---|
| Unreadable-entry ceiling before commit | all but one (`backend/reveal/src/crank.ts:201-206`) — wired from `BLOTTO_MAX_UNREADABLE_ENTRIES` since Wave 0; unset on devnet keeps this default, unset on mainnet refuses to start | **RATIFIED at 3 on 2026-09-12 — register row D-E10.** One lost ciphertext is a single player's loss; more than three is a storage or key-handling failure, and the settlement stops rather than scoring them as losses and paying out | You: set the repository variable `BLOTTO_MAX_UNREADABLE_ENTRIES` to `3`; the deploy stages it onto the daemon. Never set `treasury_min_platform_lamports` below one cushion (the model's finding, §4 P1) |
| Geo spending ceiling | off until `GEO_DAILY_CAP` is set | **DEFERRED 2026-09-12 until a geo vendor is contracted** (R2's vendor of record) — until there is a plan to cap, the ceiling governs nothing. Then: that plan's daily cap minus a margin (free tier: **800**) | Fly secret on the packet app, at contract time |
| Geo issuance reserve | a quarter of the cap | Keep a quarter | `GEO_ISSUANCE_RESERVE` if you want a different split |
| Second geo vendor (R2 vendor of record) | seam only (`GEO_VENDOR_2_*`) | Contract one before launch traffic; with one source a vendor outage still stops entry | Two Fly secrets; no code |
| Sign-in deadline | 10 s (`app/src/wallet/auth-select.ts:38`) | Keep | Code constant |
| Upload-wallet floor (mainnet) | 0.01 SOL (`backend/reveal/src/startup.ts:141`) | Keep | Code constant |
| Five copy lines | drafts in `app/src/copy/index.ts:64-68, 538-540` | Your voice pass | Copy edit |
| Rent cushion | **not a fixed figure**: the program reads the runtime's rent-exempt minimum for an empty account when the pool opens (`programs/blotto_cup/src/vault.rs:62`) — 890,880 lamports under the standard parameters, **650,240 on devnet** as of 2026-09-12, confirmed by pool 9's vault at 4,000,650,240 lamports (the 4 SOL pot plus 650,240). Never recovered either way | Not discretionary (it is the network's own rent figure, and it can differ per cluster) — but budget the bill at the standard-parameter 890,880, ≈0.9 SOL per thousand pools, because `docs/INFRASTRUCTURE.md` prices mainnet (`:174` carries the cushion since Wave 0) | Docs |

## 3. Open HIGH findings not in the audit's fix list

### 3a. D-02 — the verification journey cannot complete in the deployed system — MECHANICAL, no decision

**What it is.** The daemon publishes each pool's reveal bundle to Irys but never tells the indexer
where it is, because the announce is gated on two env vars that are never staged for the daemon app
(`backend/reveal/src/main.ts:347-375`: without `BLOTTO_INDEXER_ANNOUNCE_URL` + `BLOTTO_HELIUS_WEBHOOK_SECRET`
it logs "bundle announce OFF" and boots anyway), and the fallback, the indexer's `archive-backfill`
command (`backend/indexer/src/index.ts:226-227`), is invoked by nothing — not `sync`, not
`indexer-backfill.yml` (whose choices are `backfill | re-derive | both`), not any cron. So no player is
ever shown a bundle address; the verify page's auto-fetch has nothing to fetch.

**Recommendation.** Fix both halves — either alone leaves the gap — in one small PR, before rehearsal
step 5.3.

**Steps (code + CI; I do these).**
1. `.github/workflows/deploy-backend.yml`, "Stage daemon secrets" (lines ~441-462): add
   `BLOTTO_INDEXER_ANNOUNCE_URL="https://<indexer app>.fly.dev/bundles"` (the indexer's webhook port,
   `backend/indexer/src/webhook.ts:269`) and `BLOTTO_HELIUS_WEBHOOK_SECRET="$HELIUS_WEBHOOK_SECRET"` —
   the same secret the indexer step already stages at lines 358-365.
2. Schedule `archive-backfill`: extend `indexer-backfill.yml`'s `choice` to include it (manual), and
   add a `schedule:` cron (the `deployed-drift.yml` pattern, e.g. daily) that runs
   `flyctl ssh console --app blotto-indexer -C "npx ts-node --transpile-only src/index.ts archive-backfill"`.
   Idempotent by design ("safe to re-run", `index.ts:10-11`).
3. Document `BLOTTO_INDEXER_ANNOUNCE_URL` and `KEEPER_KEYPAIR` in `backend/.env.example` (closes the
   audit's E-07 too).
4. Make the daemon's silence louder: raise a monitor alert, not just a log line, when the announce is
   OFF in a deployment that has `IRYS_UPLOAD_KEY` set (a publish that nobody can find is the failure
   mode).

**Verification.** After the next backend deploy: the daemon's boot log no longer says "bundle
announce OFF"; settle one pool; `GET /pools/<pool>/archive` (read API) returns the verified bundle;
the results page shows the archive standings; `/verify` auto-fetches. Then rehearsal step 5.3.

### 3b. D-03 — the 12-hour auto-release ignores an upheld review — MECHANICAL (daemon), plus an optional program change

**What it is.** The daemon's review clock (`backend/reveal/src/daemon.ts:210-235`) releases any
flagged, escrowed, not-yet-forfeited share once `escrowedAt + 12h` passes, and reads nothing else.
A reviewer's upheld forfeit is written to `review_decisions` first
(`backend/detection/src/review.ts:154-160`, `recorded_pending_admin`) and the on-chain
`forfeit_escrow` lands later, by a Squads proposal a human signs. In that gap the clock pays the
flagged player. The program cannot tell the two cases apart: the daemon calls `release_escrow`
settlement-signed, which is the reviewed path with no time gate (`escrow.rs:88-141`), and
`DaemonDeps` has no handle on the decision log at all.

**Recommendation.** Daemon-side fix now; program-side "review pending" bit later, in the same
upgrade window as B-07 option (1) if that is chosen.

**Steps (me).**
1. Give `DaemonDeps` a read-only decision-log handle (`backend/detection/src/log-pg.ts`
   `PgDecisionLog`, or a thin client to the review service's `GET /decisions?pool=&player=`).
2. Before `releaseEscrow`, compute the entry's appeal state with the existing
   `backend/detection/src/appeals.ts:81-101` and **skip the release when a `forfeit` row exists**,
   logging `release:held-for-forfeit` and raising a monitor alert if the on-chain forfeit has not
   landed within the review window (the multisig is late — a human needs to sign).
3. Tests in `backend/reveal/test/daemon.spec.ts`: a forfeit row present → no release; absent → the
   12-hour release as before; the alert fires when the window passes with the forfeit unlanded.
4. Later (program): an `Entry.review_pending` flag set by a settlement-signed instruction when a
   forfeit is logged, checked by the reviewed release path — closes the race on chain rather than in
   the daemon. Needs a program upgrade; sequence with §1 C4.

### 3c. F-02 — no backup posture for the sealed entries — OPERATIONAL, plus one wiring gap

**What it is.** Postgres (Neon, Frankfurt) holds the only copy of every sealed entry
(`sealed_entries`, `backend/_shared/migrations/0002`) and every published pool key
(`published_pool_keys`, migration `0010`). There is no `pg_dump`, no snapshot schedule, no restore
runbook, no mention of Neon's point-in-time restore anywhere in `docs/`. A database loss between
seal and settlement loses the field: the crank scores unreadable entries as all losses, bounded
only by the `maxUnreadableEntries` ceiling — which the daemon does not wire (§5).

**Recommendation.** Three things, none needing a decision beyond spending a few dollars a month.
1. **Neon PITR** — you: confirm the project is on a plan with point-in-time restore and set the
   retention to cover the longest pool lifetime plus the review window (≥ 14 days). This is the
   real safety net for the money-critical tables and costs nothing to code.
2. **A nightly dump of the two tables** — me: a scheduled workflow (`deployed-drift.yml`'s cron
   pattern) that runs `pg_dump --table=sealed_entries --table=published_pool_keys` from the
   indexer app and stores the encrypted file in the Fly volume or an object store you name; a
   `restore-sealed-entries` script beside it.
3. **A rehearsed restore** — you and me, once: restore last night's dump into a Neon branch and run
   the read API against it; write the result into `docs/OPERATING-MANUAL.md` as the recovery
   procedure. Rehearsal step 5.2 is the natural slot.

## 4. The MEDIUM and LOW backlog, grouped and batched

216 findings (118 MEDIUM, 98 LOW). Read as clusters they are fewer defects than rows: the same
daemon predicate gap appears as B-30/C-10/C-23/D-26, the archive-never-fills gap as
A-08/C-24/D-24/E-08 (= D-02), the single reviewer as B-22/A-20/C-32/D-30/E-14, the rate-limiter
sweep as B-19/B-38/B-39/B-46, "watch every CI lane" as A-12/G-09/D-39/G-23. **PR #106 already
closed about fifteen of them outright** (A-12, A-13, B-17, B-33, C-19, D-05, D-23, D-39, E-06,
E-11, G-05, G-08, G-09, G-12, G-23) and two partially (B-49: permissions block on deploy-backend
only; E-07: gate not extended, the two variables still undocumented).

Fifteen rows need a decision (all listed in §2 except two below), twenty are the dead-code sweep,
the rest are mechanical. Batches are sized to one PR each and ordered by the tradeoff order in
CLAUDE.md: money correctness, the legal position, verifiability, integrity, UX, cost.

| # | Batch (one PR) | Rows | Notable items | Decisions inside |
|---|---|---|---|---|
| P1 | **Program upgrade window #2** — every on-chain fix in one keyed deploy, with LiteSVM tests each | 11 + D-03's program half + B-07 (1) if chosen | A-02 / B-37 / B-12 / B-16 (a sanctions hold on one player blocks or strands other players' shares and refunds); B-10 + B-41 (`init_config` signer binding and zero-keeper refusal — matters for the mainnet fresh deploy); B-11 (deadline bounds); B-45 (enforce the packet nonce — the class draw is grindable without it); B-14 (bind the sealing public key into the commitment); C-08 (a forfeited share with no eligible rank strands); F-09 (on-chain reviewed-release window); B-15 (skew knob); the treasury rent band found by the proptest model on 2026-09-12 (fold one cushion into the withdraw floor while `platform_refundable > 0`, so a zero minimum cannot leave the last refund refused until someone deposits) | B-07 option (1) — §2c |
| D1 | **Daemon correctness** | 18 | The held-entry loop (B-30 cluster: the review clock reverts every tick for ever on a sanctions-held entry); B-47 (`liftSanctionsHold` sent with the wrong signer — always fails); C-09/B-32/D-27 (re-uploads the bundle every 15 s while a pool is stuck — bill and noise); C-22 (a hung vendor socket wedges settlement while `/health` stays 200); C-35/F-10 (export policy on the host clock, not the chain clock); D-11 (partial next-place split stuck on one refusal); C-12 (the all-losses refund obligation has no payer or tool); C-34 (no priority fee on money-moving instructions); B-31 (the public bundle carries a cross-pool browser identifier — a privacy exposure, so first in this batch); D-03 daemon half (§3b); §5's ceiling wiring | — |
| I1 | **Indexer, archive, verify** — **split in two on 2026-09-12**: the eight rows are one review too large for one diff, and the archive half is what ruling D-E8 unblocked. **I1a (landed)**: B-07 option (2) with C-25, D-28, F-06, plus B-20/F-05. **I1b (next)**: B-18, D-18 with O26's report half, C-11/C-21, F-19, E-15 | 15 | D-02 (§3a); B-07 option (2) incl. C-25 (constrain bundle discovery to our own uploads); B-20/F-05 (rankings rewritten outside a transaction — a mid-write failure leaves an empty leaderboard); B-18 (`GET /treasury` loads the whole ledger unauthenticated); C-11/C-21 (recurring reconciliation, not boot-only); D-18, F-19, E-15 | D-28/F-06 = §2c, **ratified D-E8** |
| S1 | **Sanctions and screening** | 8 | B-27/G-07 (no response-body timeout — a stalled vendor wedges the entry gate); C-18 (the 29 MB OFAC load is unretried at boot — crash loop); B-36 (a sanctions match at entry is logged truncated, stored nowhere); D-20/F-08 (holds are invisible to every off-chain surface; the events are emitted but never decoded); C-30 (the boot assertion the code claims); B-43 is an accepted limitation | B-28: a second screening vendor (procurement) |
| R1 | **Review service and appeals** | 18 | A-04/B-21 (the log destroys the signed timestamp on read-back, so no published decision re-verifies); B-23 (signatures replayable for five minutes, replay material published); B-25 (one reviewer key can flag or release any entry with no precondition); B-24, B-35, C-07; C-16/D-19 (the admin desk shows "nothing flagged" on an outage); D-33; B-46 | §2a second reviewer; §2b detection report path (A-18, D-36) |
| E1 | **Entry gate** | 8 | B-44 (the clickwrap signature does not cover the terms version — legal-adjacent, first); E-03/C-31 (the geo stub selects on one variable with no in-code opt-in); B-13 (the catch-all answers 500 and logs nothing); B-29; E-20 (bare `Number()` on env — NaN) | A-05/A-10/D-31/C-33: the promised email that nothing sends — build it or cut the promise |
| O1 | **Operations and monitoring** | 19 | E-09/E-10/A-19/A-35 (the Prometheus sink is never selected; three of four services emit nothing); C-05/C-27/E-04/D-07 (the daemon can never report unhealthy once ready; no staleness alert); the rate-limiter sweep cluster; B-54 (no CSP or security headers on the app); D-06/D-08/D-21 (admin tooling gaps); D-09 = F-02 (§3c); E-21; E-22 (containers run as root) | — |
| C1 | **CI and deploy** | 30 → ~22 open | G-10/E-16 (deploy-backend ships without a CI-green gate or a ref restriction); E-05 (a green deploy can silently skip a service); E-19 (a generated webhook secret leaves ingest 401'd, warned only); B-34 (lockfile-less `npm install` in the drift lane); B-50/G-21/G-24 (cargo-deny/audit never run); B-51 (gitleaks never scans history); A-06/E-02; A-09/E-07/D-38 (env gate blind to `env.X` reads); A-11, D-25, E-17, E-18, F-11, F-13; A-34 and B-49's remainder (§5) | — |
| T1 | **Tests that cross a boundary** | 31 | A-03/G-03/G-04/G-17 (no test executes SQL; a CI job with real Postgres and the migrations); G-02/G-11/G-06/D-40 (the 751-line chain client has no test; hard-coded account offsets); B-26/C-20 (the Turnkey round-trip is proven only by a self-returning fake); G-19 (the double-payment guard is never hit on the artifact); G-13/G-14/G-15/G-16/G-18; F-14; A-17/F-16; C-29/D-32/G-20/G-22 (the e2e harness is dead) | — |
| A1 | **App and UX** | 25 | D-43 (`/admin/review` and `/admin/treasury` are unguarded routes — first); A-07/C-26/D-15/E-01 (a missing indexer URL serves fabricated tournaments); C-17/D-13 (a wallet change mid-run discards allocations); C-14 (broadcast-but-unconfirmed exits as not-entered); D-10 and D-29 (verify page passes green with nothing scored; red on a committed-but-unpaid pool); C-13, C-15/D-16, D-04, D-12, D-14, D-17, D-34, D-35/D-41, B-40, B-53, F-04, F-07, F-15 | — |
| X1 | **Dead code and docs** | 20 + 7 | The sweep the audit asked for as its own pass (A-14…A-33, B-42, C-36, F-17, F-18; A-15 and A-16 are "keep"); docs: C-28/D-42 (lib.rs advertises removed code), D-22 (pause runbook contradicts the Squads reality), D-44, D-45 (lost-ciphertext runbook step), B-52, D-37, E-12, E-13 | B-55: a `SECURITY.md` disclosure contact (needs a named owner) |

## 5. Engineering follow-ups from PR #106 itself

Small, mechanical, no decisions; one PR, before the rehearsal.

| Item | What | Where |
|---|---|---|
| Wire the unreadable-entry ceiling | `main.ts` never sets `maxUnreadableEntries`, so the daemon settles with up to 63 of 64 entries unreadable. Add `BLOTTO_MAX_UNREADABLE_ENTRIES` (required in production; `.env.example` entry; fail-fast if unset on mainnet) → `CrankDeps`. The value itself is §2e's | `backend/reveal/src/main.ts:377-387`, `backend/reveal/src/crank.ts:93-100` |
| Faithful proptest model | `programs/blotto_cup/tests/vault_model.rs` moves the pot alone (PHASE-N-REVIEW at `:178-184`). Update the ~20 sites the exploration scoped: `idle_reserve` (+cushion), `open_pool` debit/vault/`needed` (+cushion; `reserved` stays pot-only), `trigger_refund` (vault ends at the cushion), both ledger identities, terminal assertions (`Paid` → `escrow_total + cushion`, `Closed` → `cushion`), and every `m.fund(pot); m.open_pool()` pair (5 sites) funded `pot + cushion`. Runs locally in `cargo test --workspace` | `vault_model.rs:185-192, 232-242, 595-602, 630-646, 719-726, 877-1128` |
| A-34 instruction-level vault-exit check | Rule 6(b)/(e) allow-list files; a new handler inside an allowed file could call `vault_debit` unnoticed. Generalise 6(h)'s `awk` body-extraction to every `pub fn handle_*`, allow an enumerated `(file, function)` set, assert every other handler is clean; extend the existing self-test probe tree | `scripts/check-standing-rules.sh:93-102, 127-135, 146-166` |
| E-07 env documentation | `KEEPER_KEYPAIR` and `BLOTTO_INDEXER_ANNOUNCE_URL` are read but absent from `backend/.env.example` | with §3a |
| Pre-existing lint warning | unused `terms` in `app/src/app/rules/rules.config.ts:23` | trivial |
| Cost line | `docs/INFRASTRUCTURE.md:174` per-pool SOL cost gains the cushion | docs |

## 6. Sequencing — the order to do it in

Six waves. Each wave has a gate; nothing in the next wave starts until the gate is met. Items inside a
wave run in parallel where the "who" column differs — your keys and my PRs never wait on each other
except where marked.

| Wave | What | Who | Gate to the next wave |
|---|---|---|---|
| **0 — this week** | 0.1 §1a: redeploy the program to devnet (steps 1–9, incl. the backend redeploy in step 7 and the one-lamport pool in step 8). **Program deployed 2026-09-12, slot 497261524, `check-deployed` clean; backend redeploy and the pool-9 proof pending** | You | `check-deployed` clean on the new slot; the one-lamport pool reaches Paid/Closed |
| | 0.2 PR "post-audit follow-ups": all six §5 rows (the ceiling wiring, the faithful proptest model, A-34, E-07, the lint warning, the cost line) | Me | ci-fast + on-chain green; merged |
| | 0.3 PR "D-02 announce + archive-backfill": §3a steps 1–4 | Me | merged; next backend deploy shows announce ON |
| | 0.4 Four decisions, in this order: **2a** name the second reviewer → **2e** ratify the numbers table → **2c** confirm option (2) for B-07 → **2b** confirm (a) report for detection. 2c gates I1 and 2b gates R1; the first two gate the rehearsal | You | Decisions written into `docs/BUILD-ROADMAP_v1.0.md`'s register (one line each, dated) |
| | 0.5 §3c step 1: Neon point-in-time restore on, retention ≥ 14 days | You | A screenshot of the Neon setting pasted into the runbook |
| | 0.6 Tiny PR: D-43 — guard `/admin/review` and `/admin/treasury` (moved forward from A1 because the app is already public) | Me | merged |
| **1 — before the rehearsal** (one to two weeks) | 1.1 **D1** daemon batch, B-31 first (the bundle goes to permanent storage, so the privacy leak is fixed before any bundle with it is published), then §3b D-03's daemon half, the B-30 held-entry loop, B-47, C-09, C-22, C-35/F-10, D-11, C-12, C-34. **Landed 2026-09-12 with the daemon liveness rows of 1.3 folded in (response record, Wave 1 D1 addendum)** | Me | reveal package typecheck + tests green; merged |
| | 1.2a **I1a** — the archive half, unblocked by D-E8: B-07 option (2) with C-25, D-28 and F-06 (only what the results root covers is presented as verified; the seat comes from our own entry projection; discovery reads the daemon's own record of what it published), and B-20/F-05 (the write lands as one unit with the vouching flag last) | Me | indexer typecheck + tests green; merged |
| | 1.2b **I1b** — the rest of the indexer batch: B-18, D-18 with the report half of prior-audit **O26** (anchor `GET /treasury`'s policy and tier tables on the live Config; its event half is a program change and goes to P1), C-11/C-21, F-19, E-15 | Me | indexer typecheck + tests green; merged |
| | 1.3 **O1-part**: daemon liveness (C-05/C-27/E-04/D-07) and §3c step 2, the nightly dump of `sealed_entries` + `published_pool_keys`. The rest of O1 waits for wave 5 | Me | first scheduled dump run green |
| | 1.4 **C1-quick**: G-10/E-16 (deploy-backend gated on CI green and restricted to `main`), E-19 (a 401'd webhook fails the deploy, not warns), B-34 (lockfile in the drift lane). These protect the deploys wave 1 relies on; the rest of C1 waits for wave 5. **Landed 2026-09-12, with the post-deploy `check-deployed` comparison of E-16's third half (response record, Wave 1.4 addendum)** | Me | one deploy-backend run refused on a red ref, one accepted |
| | 1.5 The 2a one-line PR once you have the public key; the 2e repository variable and Fly secrets (`BLOTTO_MAX_UNREADABLE_ENTRIES` at 3 per D-E10; `GEO_DAILY_CAP` and the second geo vendor once one is contracted) | You (key, secrets), me (PR) | review service boots without the single-reviewer warning |
| | 1.6 Backend deploy, then **one pool end to end on devnet**: open, fill via the orchestrator, settle, archive fills within a minute, `/verify` auto-fetches. This is the dress rehearsal for the rehearsal | Me runs the orchestrator; you watch the Squads queue | the pool is Paid and verifiable from a wallet-disconnected browser |
| **2 — the rehearsal** (one or two attended days) | 2.1 §1b steps 1–9, with §3c step 3 (the restore drill) in step 5.2's slot and the 2a appeal decided end to end in 5.2 | You + me | all four runbook exit criteria met (§7); O16 ticked |
| | 2.2 Runbook **C4**: upgrade authority → Squads vault; `config/custody.json` updated; O5 ticked | You | `solana program show` prints `9EEW…` as authority |
| **3 — after the rehearsal, before the next program window** | 3.1 **S1** sanctions (B-27/G-07 and C-18 first — the entry gate must not wedge or crash-loop the moment strangers arrive); B-28 procurement runs in parallel and is yours | Me (code), you (vendor) | sanctions typecheck + tests green; merged |
| | 3.2 **R1** review service, A-04/B-21 first (a decision that does not re-verify is a published number nobody can check — tradeoff order item 3); then B-23, B-25, B-24, B-35, C-07, C-16/D-19, D-33, B-46, and the 2b (a) report surface (A-18, D-36) | Me | merged; one decision re-verified from the public log alone |
| | 3.3 **E1** entry gate, B-44 first (the clickwrap must cover the terms version); the email promise decision (A-05/A-10/D-31/C-33) is yours: build it or cut the copy | Me (code), you (decision) | merged |
| | 3.4 **A1** app, the rest (D-43 already done in wave 0) | Me | app typecheck, vitest, lint at zero warnings; merged |
| **4 — program upgrade window #2** | 4.1 **P1**: every on-chain row in one PR with a LiteSVM test each, plus D-03's program half (`Entry.review_pending`), O26's event half (`init_config` emits `TreasuryPolicySet` / `TierEconomicsSet`), and B-07 option (1) only if you chose it in 0.4 (my recommendation is you did not) | Me | on-chain lane green; layouts still pinned or a migration written and tested |
| | 4.2 The first Squads-mediated upgrade: `anchor build`, write the buffer, a Squads upgrade proposal you sign, `check-deployed`, backend deploy | You sign; I prepare the buffer and the proposal text | `check-deployed` clean; `admin.ts status` unchanged |
| | 4.3 Mini-rehearsal: only runbook steps 5.2 (the failure paths) and 5.3 against the new program — the paths P1 touches | You + me | the same exit criteria as wave 2 for those two steps |
| **5 — hardening** | 5.1 **T1** tests, the Postgres CI job first (A-03/G-03/G-04/G-17 — it is the job that would have caught B-20/F-05), then the chain-client tests (G-02/G-11/G-06/D-40), the Turnkey round-trip (B-26/C-20), the artifact double-payment guard (G-19), the e2e harness (C-29/D-32/G-20/G-22) | Me | new lanes green on `main` |
| | 5.2 **C1** remainder: cargo-deny/audit (B-50/G-21/G-24), gitleaks history (B-51), the `env.X` gate (A-09/E-07/D-38), E-05, A-06/E-02, A-11, D-25, E-17, E-18, F-11, F-13, B-49's remainder | Me | ci-fast green with the new steps |
| | 5.3 **O1** remainder: the Prometheus sink actually selected on all four services (E-09/E-10/A-19/A-35), the rate-limiter sweep, B-54 (CSP and security headers on the app), D-06/D-08/D-21, E-21, E-22 (containers not root) | Me | `/metrics` answers on all four; headers verified from outside |
| | 5.4 **X1** dead code and docs (A-14…A-33 sweep, B-42, C-36, F-17, F-18; C-28/D-42, D-22, D-44, D-45, B-52, D-37, E-12, E-13); B-55's `SECURITY.md` needs a named disclosure contact from you | Me (code), you (the name) | merged; `docs/INDEX.md` still the true map |
| **Horizon — not in this plan (target is devnet)** | 2d KYC (D-E5 standing); prior-audit O2 (counsel sign-off on PID §6/§8.5 and terms v2) and O3 (PID v0.6) — founder + counsel, not code; a second cold-read audit before mainnet (§7) | You + counsel | — |

**Why this order and not another.** Wave 0 is everything that is both cheap and blocking: the deploy
proves the CRITICAL fix on the real cluster, D-02 is the one HIGH finding that makes the rehearsal's
verification step impossible, and the four decisions unblock three batches. Wave 1 is the set of
known defects on exactly the paths the rehearsal exercises (settlement, flags, the archive, the
verify page); running a founder-attended rehearsal on code known to be wrong there would spend the
run finding what we already know. C4 sits after the rehearsal, not before, because moving the upgrade
authority before the fix is proven means the very next fix needs a multisig ceremony — the runbook
already sequences it this way and the prior audit's O5 agrees. P1 comes after C4 deliberately: it is
the first upgrade that should go through Squads, and bundling every on-chain row into one keyed
window is the only way to keep the number of ceremonies at one. Waves 3 and 5 are ordered by the
CLAUDE.md tradeoff order — money correctness (S1, R1's re-verification), the legal position (B-44,
B-31), verifiability (R1), integrity (T1's real-database and chain-client tests), then UX and cost.

**Rejected orderings.**
- *Rehearsal first, fix after* — cheaper on my side, but it burns the founder's attended day and
  ~8 SOL of unrecoverable devnet rent (0.41 SOL × 20 pools) on a run we know would fail at 5.3.
- *C4 before the redeploy* — safer custody one week sooner, at the cost of every fix in this plan
  becoming a multisig ceremony; O5 was deferred for this reason and the reason still holds.
- *One giant PR per wave* — fewer reviews, but the audit's own §14 lesson (PR #106 took three CI
  rounds because the on-chain and backend changes were coupled) says one batch per PR.
- *Splitting P1 into two program windows* — halves the LiteSVM surface per window, doubles the
  Squads ceremonies and the `check-deployed` / mini-rehearsal cost. One window, fully tested.

## 7. Verification — how each item is shown closed

Three rules, then the hooks per item.

1. **Every fix ships with the test that fails without it**, in the CI lane that owns the code
   (`ci-fast` node/rust, `on-chain` for anything under `programs/` or `tests/litesvm`). A fix with
   no failing-then-passing test is not closed, it is claimed.
2. **Every deployed change is verified on the cluster, not on the build.** `solana program show`
   proves a slot moved; only `npm run check-deployed` proves the deployed program answers this
   branch's wire contract (the 2026-09-05 nine-day-stale lesson). Backend deploys are verified by
   `GET /health` on all four Fly apps plus Actions → `backend-status`.
3. **"Audit green" is measured by a stranger, not by us.** When waves 0–5 are done, re-run the
   2026-09-11 cold-read prompt unchanged against `main` in a fresh session with no memory of the
   fixes, and diff its counts against `AUDIT_2026-09-11.md`. Target: 0 CRITICAL, 0 HIGH; every
   MEDIUM/LOW either closed or listed as an accepted limitation with a dated founder ruling in the
   register. Anything the re-read finds that we marked closed is a failure of verification, not of
   code, and goes to the front of the queue. `AUDIT_2026-09-11_RESPONSE.md` is the running ledger:
   one addendum per wave, each row an audit ID → commit → the test or command that proves it.

### Per item

| Item | Closed when | Proof to keep |
|---|---|---|
| §1a redeploy | `solana program show 5aaw…` shows the new slot and authority `GXKX…`; `npm run check-deployed` prints "wire contracts match this branch for N of M instructions" with no NOT-simulated admin instruction unexplained; `admin.ts status` still reports a 484-byte Config; the one-lamport pool reaches Paid/Closed and `admin.ts pools` shows its tier slot free; the next `deployed-drift` cron run is green | Slot + date in the runbook's Key Register; O15 ticked |
| §1b rehearsal | The runbook's four exit criteria: 5.1 twenty pools Paid; 5.2 each failure path reaches its terminal state on chain (refund balances back to the bank wallet, the sealed 63-entry pool, the paused/resumed pool, the export-refusal refund, the flag → release/forfeit → next place); 5.2a `withdraw-platform` leaves the floor, `status` agrees; 5.3 `/verify` green for all twenty from a wallet-disconnected browser and one non-founder recompute matching the published root; 5.4 fill < 5 min at 64 concurrent, settle < 2 min | Measured pool-1 budget written into the runbook (closes the SUPERSEDED note); O16 ticked |
| C4 | `solana program show` prints the Squads vault `9EEW…` as upgrade authority; `config/custody.json` updated | O5 ticked |
| §2a second reviewer | The review service boots without the single-reviewer warning; rehearsal 5.2 lodges one appeal and a *different* member decides it; `GET /decisions` shows both rows verifying from the log alone | O24 ticked; B-22/A-20/C-32/D-30/E-14 closed |
| §2b detection (a) | A detection spec that feeds a settled pool with an exact-duplicate battle set and asserts the report is persisted and the entry appears review-recommended in the admin page; on devnet, one such pool shows it before the window closes | A-18, D-36 closed; R11 vs shadow noted as reconciled in the register |
| §2c B-07 (2) | `GET /pools/<id>/archive` marks only `player ‖ rank ‖ amount` as committed, `seat` comes from the indexer's own rows, `score_half`/`zones` are labelled recomputed; an indexer test where a same-tagged bundle from a stranger's Irys address is discovered and ignored; the verify page still green on a real pool | B-07, C-25, D-28, F-06 closed |
| §2e numbers | The daemon's boot log prints the ceiling it will apply; a `tests/rehearsal` case with more unreadable entries than the ceiling shows the crank refusing to commit; `flyctl secrets list` (names only) on packet and daemon shows the variables set; the copy lines carry your wording | Register lines dated; `.env.example` gate green |
| §3a D-02 | Daemon boot log no longer says "bundle announce OFF"; a settled devnet pool's `GET /pools/<id>/archive` returns the verified bundle within a minute; the scheduled `archive-backfill` run is green in Actions; `scripts/check-env-examples.sh` passes with the two new variables | A-08, C-24, D-24, E-08, E-07 closed |
| §3b D-03 | `daemon.spec.ts`: forfeit row present → no release; absent → release at 12 h; window passed with the forfeit unlanded → alert. On devnet: flag → forfeit logged → clock passes → log shows `release:held-for-forfeit` and the alert fires → Squads `forfeit_escrow` → `pay_next_place` | D-03 closed (daemon); the program half's row moves to P1 |
| §3c F-02 | Neon shows PITR retention ≥ 14 days; the nightly dump workflow is green with the file size in its log; the restore drill's result (time to restore, rows counted, read API answering against the branch) written into `docs/OPERATING-MANUAL.md` | F-02, D-09 closed |
| §5 follow-ups | The daemon refuses to boot on mainnet without `BLOTTO_MAX_UNREADABLE_ENTRIES` (startup spec); `cargo test --workspace` runs the proptest model with the cushion and the PHASE-N-REVIEW comment is gone; the standing-rules probe tree gains a handler that calls `vault_debit` inside an allowed file and the script exits 1 on it; `next lint` reports zero warnings; the cost line carries the cushion | A-34, B-49 remainder closed |
| §4 batches (P1, D1, I1, S1, R1, E1, O1, C1, T1, A1, X1) | Each PR's description lists the audit IDs it closes and, per ID, the test or command that proves it; the owning lane is green; for P1 additionally `check-deployed` clean after the Squads upgrade and the wave-4 mini-rehearsal passed | One addendum row per ID in the response record |
| The whole audit | Rule 3 above: the second cold read against `main` reports 0 CRITICAL, 0 HIGH, and no MEDIUM/LOW without a closed row or a dated accepted-limitation ruling | The second audit file beside the first, with its counts diffed in the response record |
