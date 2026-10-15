# Roadmap

Where Blotto Cup stands today and what remains before a main-network launch. This page tracks
status only. What the system does is in [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md),
and why it does it is in [`architecture/DECISIONS.md`](architecture/DECISIONS.md). Each open item
below links to the document that tracks it, and that document is authoritative.

Contents: [1 Where we are](#1-where-we-are) · [2 Phases](#2-phases) ·
[3 Road to mainnet](#3-road-to-mainnet) · [4 After launch](#4-after-launch) ·
[5 How this document is maintained](#5-how-this-document-is-maintained)

---

## 1. Where we are

Blotto Cup runs on **Solana devnet only**, as program `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`.
Both modes are live on devnet. Easy mode has used the battle board since 2026-09-24, and hard mode
was deployed on 2026-09-25 (D-E17). A devnet trial of full, refunded and oversubscribed pools ran
between 2026-09-16 and 2026-09-22. Every test that ran conserved money to the lamport
([`testing/TESTING-REPORT.md`](testing/TESTING-REPORT.md)). Nothing is deployed on mainnet, and no
real money has been taken. Devnet SOL has no value.

## 2. Phases

The build was planned in phases, each ending in a gate. The plan dates from 2026-08-26. The table
gives each phase's current status and how it departed from that plan. Phases 7 (a restricted
mainnet) and 8 (opening further tiers) have not started; they are covered by §3 and §4.

| Phase | Goal | Status | What changed from the plan |
|---|---|---|---|
| 0 Extraction | A new repository carrying the tested components (the class-draw crate, the pass, sign-in and backend plumbing) with CI green | **Done with changes** | The scoring engine was scaffolded as TypeScript in `backend/scoring/`, not as a Rust crate (R20) |
| 1 Program | The Anchor program with the vault-invariant suite, deployed to devnet | **Done with changes** | The money model was rebuilt. The treasury pre-funds a fixed prize pool at open (D-A1, D-E1). **One paid place** replaced sixteen (D-E2). A 12-hour deadline and a 40-seat minimum field replaced 72 hours and a full pool (D-E6, R7-b). A forfeited share passes to the next eligible place, not to a later pool (D-E7). A rent cushion was added (2026-09-12). The admin is a multisig vault, but the gate's upgrade-authority item is still open (§3) |
| 2 Scoring and sealing | A sealed devnet pool reveals, scores and pays automatically; the TypeScript engine matches Python vectors | **Done with changes** | The engine pays one place, so a pool pays one winner or splits a tie, not sixteen payouts. The custody service has no X25519 curve, so each pool key is generated in the operator's process and then imported under an export policy (see [ARCHITECTURE §10](architecture/ARCHITECTURE.md#10-not-built-and-known-limitations)) |
| 3 Frontend | A stranger enters a devnet pool from a fresh browser, plays, sees the result and verifies it | **In progress** | The draggable pentagon and its 15-second timer were replaced by the battle board, which has one 3-minute clock (D-E17). A second pool type, hard mode, was added (D-E17 Phase B). The app is tested at mobile and desktop widths (R18). The gate has not passed: no one outside the project has verified a pool (T8, §3) |
| 4 Gates and detection | Entry packet enforced on-chain, territory blocking, detection, a review page | **Done with changes** | Detection only reports, and a reviewer decides every flag (D-E9). The territory allow-list became a block-list (D-B3-2). The identity-check switch is built and off (R3, D-E5). A second reviewer key was added on 2026-09-24. The same-device review path has not run on devnet (T7, frozen) |
| 5 Devnet dress rehearsal | Twenty settled pools including the refund path; every failure path exercised; internal review written | **In progress** | The twenty-pool rehearsal runs offline in CI ([`guide/DEVNET-REHEARSAL.md`](guide/DEVNET-REHEARSAL.md)). The live trial passed T1, T2R, T3, T4, T5 and T6. T7 is frozen and has not run; T8 has not run. The internal reviews are summarised in [`security/SECURITY-REVIEW.md`](security/SECURITY-REVIEW.md) |
| 6 Compliance and documentation | Rules, terms and privacy live; language audit clean; territory named; mainnet keys listed | **In progress** | Rules, terms, privacy and a complaints route are live on devnet (2026-09-19). The language gate runs in CI. The territory schedule is at version 5. Still open: legal review, the operating entity and the mainnet keys (§3) |

## 3. Road to mainnet

Every item must be closed before a mainnet deploy.

### Security

- [ ] **Independent security audit of the program.** Tracked in
      [SECURITY-REVIEW §5](security/SECURITY-REVIEW.md#5-open-items). Under decision R5 the
      internal program review stands in for it before launch, and the independent audit follows
      after ten settled mainnet pools (and before the 0.5 SOL tier opens, R6).
- [ ] **Upgrade authority moved to the multisig, with more than one member and an upgrade
      timelock.** Today the upgrade authority is a single devnet key and the multisig is
      one-of-one with no timelock. Tracked in [`../config/custody.json`](../config/custody.json)
      and [SECURITY-REVIEW §5](security/SECURITY-REVIEW.md#5-open-items).
- [ ] **Settlement key custody.** The settlement signer is a software key with no co-signing.
      Tracked in [ARCHITECTURE §10](architecture/ARCHITECTURE.md#10-not-built-and-known-limitations).
- [ ] **Program-side hardening batch,** including the on-chain prize-table check (D-E15).
      Tracked in [SECURITY-REVIEW §5](security/SECURITY-REVIEW.md#5-open-items).
- [ ] **Remaining medium and low findings** from the 2026-09-11 review. Tracked in
      [SECURITY-REVIEW §4–§5](security/SECURITY-REVIEW.md#4-findings-and-fixes).
- [ ] **Backup and restore for the sealed-entry store,** rehearsed. Tracked in
      [SECURITY-REVIEW §5](security/SECURITY-REVIEW.md#5-open-items).

### Product fixes

- [ ] **Refunded pools never reveal their pool secret,** so a refunded entrant cannot check that
      their allocation stayed sealed (finding 5.2).
- [ ] **`/health` has no signer probe,** so a signing outage that refuses every entry reports
      healthy (finding 5.3).
- [ ] **Log ordering:** a packet is logged as issued before it is signed (finding 5.4).
- [ ] **The even-split default,** a design property under review (finding 5.6).

All four are tracked in [TESTING-REPORT §5](testing/TESTING-REPORT.md#5-product-findings-and-status).

### Testing

- [x] **T3:** seal at exactly 40 seats, plus a pause during fill. Passed on pool 29
      ([TESTING-REPORT §4](testing/TESTING-REPORT.md#4-devnet-results-per-test)).
- [ ] **T7:** two entries from one device, then the review path. The plan is frozen; the pool has
      not run. No `forfeit_escrow` or `pay_next_place` has run on devnet.
- [ ] **T8:** the public verify page, with a recompute by someone outside the project.
- [ ] **A person reads the late-entry refusal copy** on a live pool. A person read the pause
      refusal in T3 and it passed; the `pool filled` wording has not yet been read on a live pool.
- [ ] **A hard-mode pool played on devnet.**

The open items are tracked in [TESTING-REPORT §8](testing/TESTING-REPORT.md#8-limits--what-has-not-been-tested).

### Legal and compliance

- [ ] **Independent legal review.** No outside opinion has been obtained (R1, R1-b). Tracked in
      [SAFEGUARDS — Known gaps](compliance/SAFEGUARDS.md#known-gaps).
- [ ] **The operating entity named** in [`../config/operator.json`](../config/operator.json).
      Every value is unset today, and `scripts/check-operator-identity.ts` refuses a mainnet deploy
      until all are filled.
- [ ] **The sanctioned-jurisdictions rows** in the territory schedule. They are held pending legal
      review; wallet-level sanctions screening applies meanwhile. Tracked in
      [`../config/territories.README.md`](../config/territories.README.md).
- [ ] **A second location and screening provider** before the first pool open to the public
      (D-E14). Tracked in [SAFEGUARDS — Known gaps](compliance/SAFEGUARDS.md#known-gaps).
- [ ] **Retention periods** are applied by hand, apart from two enforced in code. Tracked in
      [`compliance/DATA-INVENTORY.md`](compliance/DATA-INVENTORY.md) §3.
- [ ] **The two reviewer keys held by two separate people.** Tracked in
      [SAFEGUARDS — Known gaps](compliance/SAFEGUARDS.md#known-gaps).

### Operations

- [ ] **Metrics scraped and alerting in place.** Built (R23): the watcher reads every service's
      alerts and checks the chain, and posts failures to the founders' Telegram group. Done once
      `deploy-watch` has run with its secrets ([HOSTING — The watcher](guide/HOSTING.md#the-watcher)).
      Tracked in [OPERATING-MANUAL §9](guide/OPERATING-MANUAL.md#9-monitoring).
- [ ] **Fee-balance floor and cost instrumentation.** The watcher now alerts when the settlement
      signer falls below its floor (`config/watch.json`), but nothing halts a running daemon as the
      balance falls, and a pool cycle's cost is not measured. Tracked in
      [ARCHITECTURE §10](architecture/ARCHITECTURE.md#10-not-built-and-known-limitations).
- [ ] **Runbooks rehearsed for mainnet,** including the upgrade path once the authority is a
      multisig vault and a rehearsed revert. Tracked in
      [OPERATING-MANUAL §4 and §7](guide/OPERATING-MANUAL.md#4-program-upgrades-and-account-migrations).
- [ ] **Mainnet keys generated and published** on the custody page (public keys only). Tracked in
      [`../config/custody.json`](../config/custody.json).

## 4. After launch

Only steps the recorded decisions already plan are listed here.

- **Restricted start.** Mainnet opens with the 0.1 SOL tier only. Every other tier stays closed
  behind `set_open_tiers` (R6, D1).
- **The 0.5 SOL tier** opens only after the independent audit and one written legal opinion (R6,
  R1). Its success target is one 0.5 SOL pool filling within 24 hours without outreach (R17).
- **Higher tiers** open only by a later explicit decision (R6). The identity-check switch is
  expected to be revisited first (R3, D-E5).
- **Automatic detection holds** stay off until ten settled pools of shadow data exist. Turning them
  on is a signed multisig decision (D-E9).
- **Illustrated pass art** could be added as a metadata update, never a change to the competition
  (R12).
- **The Solana dApp Store listing** (D-E18). The app-side half is built; the Android package is
  generated and submitted only after the mainnet launch and the legal review of the listing, per
  the checklist in [`guide/MOBILE.md` §8](guide/MOBILE.md#8-submitting-to-the-solana-dapp-store).

Known limitations with no scheduled fix are listed in
[ARCHITECTURE §10](architecture/ARCHITECTURE.md#10-not-built-and-known-limitations).

## 5. How this document is maintained

- A phase changes status only in the same change as the work that passes its gate. A mainnet item
  is ticked only in the same change that closes it in the document it links to.
- This page restates no constants or findings. It links to where each one lives. If this page and
  a linked document disagree, the linked document is right and this page is out of date.
- New items come from the documents that track them (the security review, the testing report, the
  safeguards' known gaps, the decision log). This page never originates one.
