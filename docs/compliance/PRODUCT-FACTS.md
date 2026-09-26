# Product facts

**What this document is.** A statement of what Blotto Cup *is*, taken from the code in this
repository at the commit that carries this file — not from marketing copy and not from intent.
Every fact cites its source. Where the source is code, the fact is pinned by CI: the LiteSVM suite
drives the compiled program, and the scoring engine is pinned to a Python-generated oracle.
Decision IDs (`R7-b`, `D-E6` …) resolve in [`../architecture/DECISIONS.md`](../architecture/DECISIONS.md).

**What it is not.** Not a legal characterisation, not a roadmap, not marketing. For the
safeguards and the checks that prove them, see [`SAFEGUARDS.md`](SAFEGUARDS.md); for personal
data, [`DATA-INVENTORY.md`](DATA-INVENTORY.md).

Paths below are relative to the repository root. `instructions/` means
`programs/blotto_cup/src/instructions/`; `constants.rs`, `state.rs` and `events.rs` are in
`programs/blotto_cup/src/`.

---

## 1. The competition

| Fact | Value | Source |
|---|---|---|
| Players per pool | up to **64** seats; a pool **runs with at least 40** (the minimum field). The floor is written onto the pool at open (`Pool.min_seats`), so a later change to the constant cannot move it under players who already entered | `constants.rs` `CAPACITY`, `MIN_SEATS`; `state.rs` `Pool.min_seats`; R7-b |
| When a pool runs | it seals at the 64th seat, or — when its deadline passes with 40–63 seated — by `seal_at_deadline`, which **anyone** can call; below 40 at the deadline it refunds. Both read the pool's own `min_seats`. There is one clock. `PoolSealed.reason` records which sealed it (`Capacity` or `DeadlineMinFill`). Nothing the operator holds decides when a pool runs | `instructions/register.rs`, `seal.rs`; `events.rs` `SealReason`; D-E6, R7-b |
| Two modes | every pool plays one of two placing rules, recorded on the pool (`Pool.mode`: 0 easy, 1 hard) and in `PoolOpened.mode`. Each mode has its own pool per tier, its own enable switch (`set_open_tiers` / `set_hard_open_tiers`) and cooldown; price and prize per tier are the same in both. The mode is never inferred from the entry bytes | `constants.rs` `MODE_EASY`, `MODE_HARD`, `N_MODES`; `instructions/open_pool.rs`, `admin.rs`; D-E17 |
| Battles per entry | **7** | `backend/scoring/src/allocation.ts` `BATTLES`; `app/src/battle/board/mode.ts` `FIELDS` |
| Stats per battle | **5**, in the fixed order Strength, Speed, Heart, Wit, Durability | `backend/scoring/src/allocation.ts` `STATS`, `STAT_NAMES` |
| Allocation rule — easy | each battle's five stats are non-negative integers summing to **exactly 100** | `backend/scoring/src/allocation.ts` `ALLOCATION_SUM`; `app/src/battle/board/mode.ts` `EASY_PER_FIELD` |
| Allocation rule — hard | the board's thirty-five stats are non-negative integers summing to **exactly 700**, placed anywhere — a battle may hold all of it or none | `backend/scoring/src/allocation.ts`; `app/src/battle/board/mode.ts` `HARD_TOTAL` |
| Where the allocation rule is enforced | **Not on-chain, and it cannot be**: the program receives only `sha256(battles ‖ salt)`, and the plaintext exists nowhere it can read until the pool secret is revealed — that is the sealing property. The two enforcement points are the **client** at submission (`encodePayload` → `encodeBattleSet` → `assertBattleSet`; a violating set throws before any ciphertext or commitment exists) and the **scoring engine** at reveal (`decodeBattleSet` refuses a malformed set or one of the wrong mode's length). Both are the same module. A set that breaks the rule is scored **all losses**, as a lost ciphertext is, and its status is published in the bundle; one malformed entry never halts a pool | `backend/scoring/src/allocation.ts`; `backend/sealing/src/payload.ts`; `app/src/entry/submit.ts`; `backend/scoring/src/missing.ts`; `backend/reveal/src/crank.ts` |
| The run clock | **three minutes**, one clock for the whole board, starting on the **first point placed** — never on arrival, on selecting a stat, or on panning. The rule is shown on arrival | `app/src/battle/board/mode.ts` `BOARD_CLOCK_BUDGET_MS`; `app/src/battle/board/machine.ts`; D-E17 |
| Submit or time-out | whatever is on the board is the entry; every point not yet placed is spread **evenly** across the fields not locked in, the indivisible remainder one point at a time in fixed order. In easy an untouched battle becomes 20/20/20/20/20. Deterministic and integer-only; nothing is ever chosen at random | `app/src/battle/board/spread.ts`; R9-b, D-E17 |
| Legacy timer field | the program still writes `Pool.timer_seconds = 15` (`TIMER_SECONDS`, the per-screen timer of the earlier dial run) at open; the board does not use it | `constants.rs` `TIMER_SECONDS`; `instructions/open_pool.rs` |
| Fill deadline | **12 hours** from open (`Config.fill_deadline_seconds`, seeded from `DEFAULT_FILL_DEADLINE_SECS`); `set_pool_timing` changes it for **future** pools only. A pool below its own `min_seats` at the deadline refunds every entry in full (`trigger_refund` refuses at the floor and above — `FieldReached`) | `constants.rs`; `instructions/open_pool.rs`, `refund.rs`; D-E6 |
| Cooldown between pools | a tier's next pool of a mode may open **5 minutes** after the previous one reached Paid or Closed | `constants.rs` `DEFAULT_COOLDOWN_SECS`; `instructions/slot.rs` |
| Who opens pools | the **keeper** (`Config.keeper`, admin-rotatable via `set_keeper`, never the zero key) and nobody else. The opener chooses the pool's sealing key, and a pool sealed to a key the operator's custody does not hold could never be revealed. The keeper has no discretion over *whether* a pool opens — the program's gates decide. Sealing and refunding an existing pool stay permissionless | `instructions/open_pool.rs`, `admin.rs` |
| Who may enter | one entry per wallet per pool (the Entry PDA is `[entry, pool, player]`); no limit across pools; the four service keys — admin, keeper, entry signer, settlement signer — are refused (`ServiceKeyCannotEnter`) | `instructions/register.rs` |
| Scoring | identical field: battle *k* is compared with every other entry's battle *k*; a stat is won by the larger number, a battle by 3 or more of 5 stats, otherwise a draw worth half a win to each; ranking by battles won, then stats won. Integer-only (win +2, draw +1 each). Identical in both modes | `backend/scoring/src/engine.ts` (`compareBattle`, `scorePool`), pinned to `backend/scoring/fixtures/gen_vectors.py` |
| Ties | equal on both criteria ⇒ shared competition rank (1, 2, 2, 4); a tie group splits the combined prize of the positions it occupies evenly — with one paid place, only a tie for first affects a prize; an indivisible lamport remainder goes to the eligible player with the lowest entry number; seat order never decides rank | `backend/scoring/src/prizes.ts` `assignPrizes`; `programs/blotto_cup/src/prize_math.rs` `split_group`; D3-B, D-E2 |
| A forfeited winner's share | an upheld flag passes the share **to other players, never to the operator**: `pay_next_place` divides it equally among the remaining eligible players ranked first or, when none is eligible, among the eligible players at the next competition rank; the remainder goes to the eligible player with the lowest entry number. At first place the whole group is on-chain and the program verifies it; at a later rank each member is proven by a Merkle proof against `results_root`, and the group's **completeness** is the settlement signer's assertion — disclosed on the rules page and checkable from the published bundle | `instructions/escrow.rs` `handle_pay_next_place`; `programs/blotto_cup/src/merkle.rs`; D-E6, D-E7 |

## 2. Money

All amounts are integers in lamports end to end; no float touches a money path.

| Fact | Value | Source |
|---|---|---|
| Tiers | **7**; entry prices 0.1 / 0.5 / 0.75 / 1 / 2.5 / 5 / 7.5 SOL; the same ladder in both modes | `constants.rs` `TIER_ENTRY_LAMPORTS` (mirrored in `backend/scoring/src/prizes.ts`, drift-pinned by `scripts/check-mirrors.py`) |
| Open tiers | only the 0.1 SOL tier opens until the conditions of R6 are met; each mode is switched on separately | `Config.open_tiers`, `Config.hard_open_tiers`; R6 |
| Prize pool per tier | **fixed**: 4 / 20 / 30 / 40 / 100 / 200 / 300 SOL, set by the operator; moved from the platform treasury into the pool's own vault at `open_pool`, **before any entry is sold**; never derived from entries, and the same whatever the field size | `constants.rs` `TIER_POT_LAMPORTS`; `instructions/open_pool.rs`; D-A1, D-E1 |
| Paid places | **one**: the player ranked first receives the whole prize pool (`PAID_RANKS = 1`, `PRIZE_BANDS_1024 = [1024]`); a tie for first splits it | `constants.rs`; `backend/scoring/src/prizes.ts`; D-E2 |
| Where entries go | 100% to the platform treasury; `register` cannot touch a prize vault | `instructions/register.rs`; `scripts/check-standing-rules.sh` check 6(f) |
| Operator margin | entries received minus the fixed prize pool. Every tier's prize pool is exactly forty entries' worth, so the minimum field is **break-even at every tier** and margin is `1 − 40/seats` of intake: nil at 40 seats, 37.5% at 64. `set_tier_economics` refuses a prize pool greater than 40 × price (`PotExceedsMinimumField`) | `constants.rs` `MIN_SEATS` (derivation in its doc comment); `prize_math.rs` tests |
| Prize vault exits | exactly four: `pay_prizes`, `release_escrow`, `pay_next_place` (each to a player), and `trigger_refund` (the untouched prize pool back to the treasury, only for a pool that did not reach its floor). **`forfeit_escrow` moves nothing** — its vault account is not writable. There is no withdraw instruction and no path from a vault to the operator | `instructions/`; `scripts/check-standing-rules.sh` checks 6(b), 6(h), 6(i); D-E6 |
| Platform treasury exits | `open_pool` (funding a prize pool), `refund` (repaying an entry in full) and `withdraw_platform`. The last is admin-gated (Squads multisig) and refused on-chain below a floor of: minimum balance + one further prize pool per idle enabled tier + every refundable entry | `instructions/treasury.rs` `handle_withdraw_platform`; `scripts/check-standing-rules.sh` check 6(e) |
| Refunds | `trigger_refund` and `refund` are both **permissionless**; `refund` repays the full entry price from the treasury, where `Config.platform_refundable` keeps it program-held until repaid | `instructions/refund.rs` |
| Held prizes | a flagged share is held in the pool's own vault. The **published rule is 12 hours**: a flag undecided at 12 hours is cleared and the prize is paid. The program's permissionless `release_escrow` after **7 days** is a safeguard against the operator's own failure. Once forfeited, a share can only be paid onward | `instructions/escrow.rs`; `backend/scoring/src/prizes.ts` `REVIEW_WINDOW_SECS`; `constants.rs` `ESCROW_AUTO_RELEASE_SECS`; D-E7 |
| Prize payment | automatic on settlement; **no claim step** | `instructions/pay_prizes.rs`; R10 |
| Account layouts | `Pool` 842 bytes (+8 discriminator = 850); `Config` 595 (+8 = 603); `Entry` 220 (+8 = 228). Every layout grows by **appending**, never by inserting, because external readers hold byte offsets | `state.rs` `account_layouts_are_pinned` |
| Account migrations | `migrate_config` (admin-signed) grows a `Config` at the previous layout by appending the hard-mode fields; `migrate_pool` (permissionless) grows a pool that predates the current layout, and writes `MIN_SEATS_V1` = 52 into a pool opened before R7-b — the floor its players entered under. Neither moves a lamport; each refuses an account already at the current size | `instructions/migrate.rs`; `constants.rs` `MIN_SEATS_V1` |
| Pause | `set_paused` blocks new entries only — settlement and refunds keep working | `programs/blotto_cup/src/lib.rs` `set_paused` |

## 3. Chance — what randomness does and does not do

| Fact | Value | Source |
|---|---|---|
| The only random draw | which character-class **artwork** an entry's pass shows | `instructions/register.rs` (class draw) |
| Randomness source | a Switchboard VRF seed committed on-chain, combined with a later slot hash (5-slot delay) | `constants.rs` `SLOT_HASH_DELAY`; `programs/blotto_cup/src/vrf.rs`; [ADR-026](../architecture/adr/adr-026-multi-source-randomness.md) |
| Class bag | counters [38, 15, 7, 3, 1] per pool — a finite bag of 64 drawn down in entry order; a pool with fewer than 64 players leaves the rest undrawn; every draw replays from published on-chain data | `constants.rs` `LAUNCH_CLASS_COUNTERS`; [ADR-021](../architecture/adr/adr-021-bag-without-replacement-draw.md) |
| Effect of class on outcomes | **none**. `entry.class` is written once and read nowhere in the program; the settlement process's Entry decoder skips the byte; the scoring engine and `pay_prizes` do not mention the word | `instructions/register.rs`; `backend/reveal/src/chain-web3.ts`; `scripts/check-standing-rules.sh` rule 5 |
| Pass transferability | permanently non-transferable — frozen at collection level with a permanent freeze delegate; **no instruction can unfreeze** | `programs/blotto_cup/src/pass.rs`; [ADR-027](../architecture/adr/adr-027-collection-freeze-propagation.md) |
| Randomness in results | none: no random value, clock or float in the scoring, ranking or prize path | `backend/scoring/src/` (pure modules) |

## 4. Sealing and verifiability

| Fact | Value | Source |
|---|---|---|
| What is sealed | the payload — battles (35 bytes easy, 70 hard) + salt (32) + seven per-field timings (28) + per-pool device marker (32): **127 bytes easy, 162 hard** — encrypted **on the player's device before payment** to the pool's X25519 key | `backend/sealing/src/payload.ts` `payloadBytes`; `backend/sealing/src/sealedbox.ts` |
| Who can read it early | no one, operator included: the pool secret is generated locally, imported to custody, wiped, and export-locked until the pool is sealed or past its deadline. The read API serves no sealed box at all, before or after the reveal | `backend/sealing/src/custody.ts` `ExportPolicy`, `custody-turnkey.ts`; `backend/indexer/src/read-api.ts` |
| Entry and reveal windows | disjoint: `register` requires an open pool within its deadline; `reveal_pool_secret` requires the opposite | `instructions/register.rs`, `reveal_commit.rs` |
| On-chain commitments | `sha256(battles ‖ salt)` per entry at registration; `sha256(secret)` at pool open; the results tree root at commit | `instructions/register.rs`, `open_pool.rs`, `reveal_commit.rs` |
| What is published at reveal | the pool secret (on-chain) and the results bundle (permanent storage, version 3): the pool's mode, every entry's battles, salt and status, per-seat scores, competition ranks and amounts, and the committed payouts. **Not** the timings or the device marker | `backend/reveal/src/bundle.ts`, `publisher-irys.ts` |
| Who can recompute | anyone, in a browser, with no wallet and no operator involvement: the verify page checks the secret against its commitment, each entry against its on-chain hash, re-runs the identical engine (one module, crank and browser — R20), rebuilds the tree and compares it with the **on-chain** root, then checks the payouts. The results page's head-to-head view reads the same bundle and checks each seat against its commitment | `app/src/verify/logic.ts`; `app/src/results/what-beat-you.ts` |
| Read API integrity | the leaderboard recomputes the results root from the fetched bundle; on a mismatch it removes the rankings and serves nothing | `backend/indexer/src/archive.ts` |
| Entry authorisation freshness | packets expire after 60 s (5 s future skew) | `constants.rs` `PACKET_MAX_AGE_SECS`, `PACKET_MAX_FUTURE_SKEW_SECS` |

## 5. Access controls

| Fact | Value | Source |
|---|---|---|
| Age | 18+ self-attestation clickwrap: the wallet signs a fixed sentence naming the terms version, and the signed record is stored only after the signature verifies. Entry authorisation requires a record at the **current** terms version — **version 4 since 2026-09-25** — and the program refuses a packet without one. Every wallet re-accepts once per edition | `backend/_shared/src/attestation-message.ts`; `backend/packet/src/attestations.ts`; `programs/blotto_cup/src/entry_packet.rs` (`PacketTermsVersionMissing`); `config/terms.json`; `app/src/entry/attestation.test.ts`; D-B4 |
| Territory | a schedule set by the operator in `config/territories.json`: block-list posture, **eighteen country codes** at schedule version 5; available everywhere else. `config/territories.README.md` carries one row per code. **Fail-closed at every edge**: no configured location source, a failed lookup or an undetermined location all refuse entry, and the entry service **refuses to start** on a schedule carrying a sub-national code the location source cannot resolve | `backend/packet/src/territories.ts`, `service.ts` (`assertRegionCapability`); `app/src/entry/geo-gate.ts`; `scripts/check-territories.ts`; D-B3, D-B3-3, D-B3-4 |
| Sanctions at entry | every entrant's wallet is screened against published sanctions **lists** when the entry is authorised — the mirrored OFAC SDN list always, Chainalysis and OpenSanctions when configured. A listed wallet gets the same generic refusal as a blocked territory; the verdict records list membership and **no risk score**; a stale mirror or failed lookup refuses; the service refuses to start with no source | `backend/sanctions/src/`; `backend/packet/src/sanctions-wiring.ts`, `service.ts` |
| Sanctions before payment | every wallet on a pool's committed payout list is screened again before the pool is paid. A match places an on-chain **sanctions hold**: `pay_prizes` escrows the share instead of sending it, both release paths refuse, and the entry is excluded from any next-place split. A screening that cannot answer also holds, recorded as "unavailable". Neither screening instruction moves a lamport | `backend/reveal/src/winner-screening.ts`; `instructions/sanctions.rs`; `backend/sanctions/src/wire.ts` |
| Wallet blocklist | a list set by the operator (`config/blocked-wallets.json`, **shipped empty**), consulted at entry beside the territory and sanctions checks, with the same generic refusal. Each address must carry one of six grounds the terms enumerate, recorded in `config/blocked-wallets.README.md`; CI refuses a build where a ground is missing or not enumerated | `backend/packet/src/blocked-wallets.ts`; `scripts/check-blocked-wallets.ts` |
| Identity checks | a KYC-at-payment switch exists and is **off** (threshold 0) | `set_kyc_threshold`; R3, D-B4 |
| Integrity detection | **report only**: five published signals (allocation entropy, timing profile, duplicate sets, same device behind several entries in one pool, population-relative score) are computed for every pool and persisted for review; the settlement process flags nothing itself. CI pins that the daemon returns no flags and that the automatic escrow tier stays off | `backend/detection/src/signals.ts`; `backend/reveal/src/main.ts`; `scripts/check-standing-rules.sh` rule 7; R11, D-E9 |
| Flags and decisions | a flag is a person's decision: a reviewer signs it in the review service, and the settlement signer lands `flag_entry`. Reviewers are the keys in `config/reviewers.json` — **two members since registry version 2**. `forfeit_escrow` is admin-signed; the review service holds no admin key. Reviewer action budget: 64 signed decisions per key per hour | `backend/detection/src/review.ts`, `auth.ts`, `budget.ts`; `instructions/flags.rs`, `escrow.rs`; D-E13 |
| Review audit trail | append-only (no update, no delete), every decision signed by a registry key and citing a published criterion; a forfeit decision is logged before the admin lands it | `backend/detection/src/log-pg.ts`, `review.ts` |
| Complaints | an append-only record, one row per event (lodged, acknowledged, resolved). A wallet signature is **required** for the two categories that ask for an outcome to change (a decision, a payment) and optional for the other three. A signed complaint is served only to the wallet that signed it; an unsigned one records no address. Answers are signed by a registry key over a canonical message and carry `decided_by`. **Published windows: 5 working days to acknowledge, 30 days to resolve.** The reviewer queue is operator-token only and fail-closed | `backend/detection/src/complaints.ts` (`COMPLAINT_ACKNOWLEDGE_WORKING_DAYS`, `COMPLAINT_RESOLVE_DAYS`, `mayReadComplaint`), `complaints-pg.ts`; `app/src/app/complaints/`; `app/src/app/admin/review/complaints-desk.ts` |

## 6. Player data

The full inventory — what is held, where, why and for how long — is
[`DATA-INVENTORY.md`](DATA-INVENTORY.md). The facts other documents cite:

| Fact | Value | Source |
|---|---|---|
| Identity data held | the wallet address. The sign-in provider holds any sign-in email; the product's own stores hold an email only under the per-pool opt-in, and delete it when the message is sent | `backend/packet/src/notify.ts`, `notify-pool.ts`, `stores-pg.ts` |
| Per-entry data | the sealed payload (§4), a location verdict at authorisation, the signed age-and-terms record | `backend/packet/src/` |
| Published after reveal | wallet address, battles, salts, scores, ranks and amounts — by design, so results are recomputable. Timings and device markers are **not** published, and the sealed boxes that carry them have no public reader | `backend/reveal/src/bundle.ts`; `backend/indexer/src/read-api.ts` |
| The device marker | derived **per pool**: `sha256("blotto:device:v2" ‖ pool ‖ secret)`, with the secret never leaving the device. Markers from one device in two pools are unrelated, so entries cannot be linked across tournaments by anyone. The detection signal compares markers only within one pool, and receives them through a channel that is published nowhere | `app/src/entry/device.ts` (`deviceMarker`); `backend/reveal/src/ranking.ts` `forDetection` |
| Notifications | opt-in only, wallet-signed, one factual message per opt-in; the pressure-mechanics vocabulary fails CI | `backend/packet/src/notify-pool.ts`; `scripts/check-language.sh` |

## 7. Language controls

The vocabulary rule is CI-enforced over the whole repository — code identifiers, comments, tests
and copy alike — including unprovable trust claims, guarantee claims, finance framing, category
assertions and pressure vocabulary (D-B7). A second gate refuses any rendered copy string that
carries a value a shared program constant used to have (`scripts/check-published-numbers.ts`).
Sources: `scripts/check-language.sh`; process: `CONTRIBUTING.md`.

## 8. Things that do not exist (checked, not promised)

- No prize-vault withdraw instruction and no "recover stuck funds" path (CI-asserted exit set).
- No instruction that can unfreeze a pass.
- No randomness anywhere in scoring, ranking or prizes.
- No plaintext path to a sealed allocation before the pool closes, and no public reader of a
  sealed box after it.
- No claim step and no discretionary payment: every ordinary payout is validated on-chain against
  the committed payout list, and a share passed on after a forfeit is validated against the
  committed results root. The one residual is disclosed in §1: at a later rank the program cannot
  prove the presented group is complete.
- No operator control over when a pool runs: the 64th seat, or the deadline with the pool's own
  floor seated, seals it, and the deadline seal is callable by anyone.
- No urgency, near-miss or consecutive-play reward mechanics; their vocabulary fails CI.

## 9. Published commitments and how each is kept

Every undertaking on the rules, terms and privacy pages is registered in
`app/src/copy/published-claims.test.ts` against the file that keeps it; the build fails if a
registered phrase disappears from the copy. The rows below are the ones whose mechanism is partly
or wholly a person rather than code.

| Published | How it is kept |
|---|---|
| "Resolving lasts up to 12 hours" | A derived state, not an on-chain pool state: the read API marks a pool *resolving* while it carries a held share and 12 hours (`REVIEW_WINDOW_SECS`) have not passed since its prizes settled. A pool with no held share is never resolving |
| "During resolving we check the winning wallet against published sanctions lists" | Code: the settlement process screens the committed payout list and places the on-chain hold before it commits, so a hold is in place before a share can be sent (§5). A held prize reaches nobody and never the operator |
| "If no decision is made within 12 hours, the flag is cleared and the prize is paid" | Code: the settlement process releases a flagged share still held 12 hours after its on-chain `escrowed_at`, and retries until it lands. The flag bit stays set because the program refuses `clear_flag` on a settled entry; the prize is paid as published. The seven-day permissionless release is the safeguard behind it |
| "You may challenge a decision through our complaints route" | Code and a person: `POST /complaints` records it; a person reads and answers it (§5) |
| "We will acknowledge your complaint within 5 working days and answer it within 30 days" | A person, with the record as evidence: answers are signed rows in the append-only complaints record, so whether each window was met is checkable after the fact |
| "a decision on that challenge will be made by someone other than whoever made the original one wherever that is possible" | Recorded, not enforced: the original decision and the answer both carry `decided_by`, so whether a different person answered is checkable from two append-only tables. With two keys in `config/reviewers.json` a different key can answer; nothing prevents the same key |
| "That refund is made by hand" (an entry whose sealed battles cannot be read at reveal) | A person: the entry is scored all losses and listed in the bundle's `scored_as_all_losses`; no code pays the refund; [`OPERATING-MANUAL.md`](../guide/OPERATING-MANUAL.md) §7 pays each one by an admin transaction (`backend/reveal/src/crank.ts` says so in its header) |

---

*Maintenance rule: this document restates only facts whose values live in code, config or
[`DECISIONS.md`](../architecture/DECISIONS.md), with the source cited. When a source changes, this
file changes in the same change or the claim comes out.*
