# Blotto Cup — product requirements

**What this document is.** The product requirements for Blotto Cup as it is built and designed to
be today: what the product is, who it is for, and what it must do. It states requirements and
points to where each is met. The mechanism in plain language is
[`../guide/HOW-IT-WORKS.md`](../guide/HOW-IT-WORKS.md); every fact with its line of code is
[`../compliance/PRODUCT-FACTS.md`](../compliance/PRODUCT-FACTS.md); every decision ID cited here
(`R7-b`, `D-E17` …) resolves in [`../architecture/DECISIONS.md`](../architecture/DECISIONS.md).
Where this document and the code disagree, the code is right.

**Status.** Built and running on Solana devnet only. No real money has entered it. Legal review of
the product is pending; this document makes no claim about the product's legal status.

**Document history.** Supersedes the original product document, v0.5 (not published). Reconciled
against the code on 2026-09-26.

Contents: [1 Summary](#1-summary) · [2 Players and the session](#2-players-and-the-session) ·
[3 The game](#3-the-game) · [4 Why decisions decide](#4-why-decisions-decide-the-result) ·
[5 The character pass](#5-the-character-pass) · [6 Pools, tiers and prizes](#6-pools-tiers-and-prizes) ·
[7 Fairness and verifiability](#7-fairness-and-verifiability) · [8 Eligibility](#8-eligibility) ·
[9 Language and presentation](#9-language-and-presentation) · [10 Non-goals](#10-non-goals) ·
[11 Success measures](#11-success-measures-and-quality-bars) · [12 Open questions](#12-open-product-questions)

---

## 1. Summary

Blotto Cup is a paid-entry tournament built on the Colonel Blotto game. Up to 64 players enter a
pool at the same fixed price. Each receives a non-transferable character pass whose class is
decorative, then places points on a board of **seven battles × five stats** within one
three-minute clock. The entry is sealed on the player's device before payment. When the pool
closes, every entry is revealed and compared battle by battle against every other entry, and the
player ranked first receives the whole prize pool — a fixed amount moved into the pool's own
account before the first entry was sold. There is no pairing, no bracket and no random element in
the result, and anyone can recompute the ranking from published data.

## 2. Players and the session

**Who it is for.** Adults who want a short contest decided entirely by their own choices: the
skill is choosing an allocation that performs well against a population of other players whose
choices are hidden. Nothing rewards reaction speed, spending more, or playing more often.

**The session** — a few minutes, once per entry, then nothing to do until the pool concludes:

| Step | Requirement | Where it is met |
|---|---|---|
| Sign in | An embedded wallet with social sign-in, or an external wallet (R19) | `app/src/wallet/` |
| Accept terms and attest age | The wallet signs an 18+ statement naming the current terms version (§8) | `backend/packet/src/attestations.ts` |
| Choose a pool | Each pool card names its mode, entry price, prize pool, seats taken and deadline before anyone pays | `app/src/app/page.tsx`, `app/src/app/pools/` |
| Fill the board | Seven battles, three-minute clock from the first point placed (§3) | `app/src/battle/board/` |
| Seal and pay | The board is encrypted on the device, then one transaction pays the entry and records the entry's hash. Decisions are final on submission, and the page says so before payment (R4) | `app/src/entry/submit.ts`; `app/src/app/rules/` |
| Wait | Optional, opt-in, wallet-signed notification: one factual message per opt-in (D-E11) | `backend/packet/src/notify-pool.ts` |
| Results | Rank, score, the head-to-head against other players, and a link to recompute the pool | `app/src/app/pools/[pool]/results/`, `app/src/app/verify/` |
| Profile | Read-only: pools entered, ranks, win rate, the pass collection with its rarity (R15) | `app/src/app/profile/` |

There is no second session, no upgrade to buy, and nothing that costs money after the entry.

## 3. The game

### 3.1 The board

| Rule | Easy (`Pool.mode` 0) | Hard (`Pool.mode` 1) |
|---|---|---|
| Battles | 7 | 7 |
| Stats per battle, fixed order | Strength, Speed, Heart, Wit, Durability | the same |
| Placing budget | **100 per battle**: five non-negative integers summing to exactly 100 | **700 across the board**: thirty-five non-negative integers summing to exactly 700; a battle may hold nothing |
| Lock-in | A battle can be locked once it holds its full 100 | Any battle can be locked, except the last open one while points remain |

Sources: `backend/scoring/src/allocation.ts` (`STATS`, `BATTLES`, `ALLOCATION_SUM`, `HARD_TOTAL`);
`app/src/battle/board/mode.ts`. Each mode runs in its own pools with its own prize; price, prize
and seat rules per tier are the same in both (D-E17).

Requirements on the interaction (D-E17; `app/src/battle/board/`):

- Points are placed one at a time by press-and-hold, or with a stepper of ±1, ±5, ±10 and ±20
  (`STEP_SIZES`). A placement never overshoots a battle (easy) or the board (hard).
- **Points left to place are always shown**: per battle in easy, one total in hard.
- **No presets and no suggested splits.** Nothing on screen proposes a shape.
- **One clock: three minutes** (`BOARD_CLOCK_BUDGET_MS`), starting at the **first point placed**
  — never on arrival, selecting a stat or connecting a wallet. The rule is shown before it starts.
  The clock is calm: no red, no pulsing.
- **The buzzer spread.** On Submit or when the clock ends, every unplaced point is spread evenly
  across the cells of the battles **not** locked in — in easy, each unlocked battle spreads its own
  missing points across its five stats, so an untouched battle becomes 20/20/20/20/20; in hard, the
  board's missing points spread across every cell of every unlocked battle. Any remainder goes one
  point at a time in fixed order (battle 1 Strength … battle 7 Durability), unlocked battles only.
  Deterministic and integer-only: the same board and locks always produce the same entry, and
  nothing is ever chosen at random for a player (R9, `app/src/battle/board/spread.ts`).

### 3.2 The allocation invariant

The client must be unable to submit a board that breaks its pool's rule, and it is: the finished
board is checked before anything is encrypted. **The program does not and cannot check an
allocation**: it receives only `sha256(battles ‖ salt)`, and a program that could check an
allocation could read one, which would end sealing. The second enforcement point is the scoring
engine at reveal, which scores a malformed or unreadable set as losing every comparison and
publishes that status; one bad entry never halts a pool.
Sources: `backend/scoring/src/allocation.ts`, `missing.ts`; [SAFEGUARDS §9](../compliance/SAFEGUARDS.md#9-the-allocation-rule-and-where-it-is-enforced).

### 3.3 Scoring and ranking

Identical in both modes (`backend/scoring/src/engine.ts`, pinned to Python-generated vectors in
`backend/scoring/fixtures/gen_vectors.py`):

- **Every player faces the identical field.** Battle *k* is compared with every other entry's
  battle *k*: 63 × 7 = **441 comparisons per player** in a full pool, and 64 × 63 × 7 ÷ 2 =
  **14,112 pairings** in all.
- **A stat** goes to the larger number; equal numbers go to neither.
- **A battle** is won by taking three or more of its five stats; otherwise it is a draw.
- **Score**: a win is worth 2 half-points, a draw 1 half-point to each side. Integer arithmetic
  throughout — no float anywhere in scoring or payment.
- **Ranking**: by score, then by total stats won across every comparison.
- **Ties**: players equal on both share a competition rank (1, 2, 2, 4) and split the combined
  prize of the places they occupy evenly; with one paid place, only a tie for first affects a
  prize. An indivisible lamport remainder goes to the tied player with the lowest entry number.
  Entry order never decides rank (D3-B, `backend/scoring/src/prizes.ts`).

## 4. Why decisions decide the result

**Requirement:** the result must depend on the player's choices, and the product must publish
evidence of that which anyone can reproduce (D-A2).

### 4.1 The measured study

The repository publishes a deterministic study of the real scoring engine, regenerated and diffed
nightly in CI: [`../skill-evidence/REPORT.md`](../skill-evidence/REPORT.md) (easy) and
[`../skill-evidence/hard/REPORT.md`](../skill-evidence/hard/REPORT.md) (hard). Rate of finishing
first, by strategy class, against the everyone-equal baseline (1 ÷ seats):

| Mode | Seats | Baseline | Random valid allocations | Tuned plan (`optimised`) | Tuned ÷ baseline |
|---|---|---|---|---|---|
| Easy | 64 | 1.5625% | 0.000% | **5.156%** | 3.3× |
| Easy | 40 | 2.5000% | 0.000% | **8.150%** | 3.3× |
| Hard | 64 | 1.5625% | 0.000% | **6.093%** | 3.9× |
| Hard | 40 | 2.5000% | 0.000% | **9.250%** | 3.7× |

Considered play finishes first several times as often as the baseline, at the full field and at the
smallest field a pool plays with; allocation without intent finishes first essentially never in
these fields. Within one strategy class every seat sits at the baseline, which is what a
competition decided by choices should show. The study is explicit that the even-split default's
result depends on the field it meets (0 of 400 pools won against three-stat players, 400 of 400
against arbitrary free-integer allocations), so that row is a property of the population, not of
the allocation.

### 4.2 Why free integers, and the draw rate

A draw decides nothing, so the product keeps the space of allocations large and avoids anything
that clusters players onto the same shapes. The number of easy-mode battles is the number of ways
to write 100 as an ordered sum of five non-negative integers — stars and bars:

C(100 + 4, 4) = C(104, 4) = (104 × 103 × 102 × 101) ÷ 24 = **4,598,126**

Coarser grids collapse that space: on a 20-point grid a battle is five multiples of 20 summing to
100, C(9, 4) = **126** shapes; on 10 points, C(14, 4) = **1,001**; on 5 points, C(24, 4) =
**10,626**. Recomputed for this document, with two players choosing uniformly at random among the
valid shapes (exact enumeration for the 20- and 10-point grids, one million sampled pairs
otherwise):

| Grid | Distinct battles | Draw rate |
|---|---|---|
| 20-point steps | 126 | 77.9% |
| 10-point steps | 1,001 | 51.6% |
| 5-point steps | 10,626 | 29.8% |
| Free integers | 4,598,126 | **6.7%** |

The original product document gave about 7% for free integers, which this recomputation confirms;
its coarse-grid figures (86% / 56% / 31%) used a population model it does not record, and are not
reproduced here. The conclusion holds either way: the fewer distinct shapes players actually use,
the more battles are drawn. Hard mode's measured free-integer draw rate is **4.65%** at 64 seats
([hard report](../skill-evidence/hard/REPORT.md#draw-rate-under-the-hard-rule)).

### 4.3 Why seven battles

Seven was chosen as the smallest number at which an earlier simulation showed the strongest
player clearly separated from the field while keeping the session short. That simulation is not
published; the study in §4.1 is the evidence the product relies on.

## 5. The character pass

| Requirement | Where it is met |
|---|---|
| Every entry mints one pass: a Metaplex Core asset, frozen at collection level with a permanent freeze delegate. **No instruction can unfreeze it**; there is no transfer and no market | `programs/blotto_cup/src/pass.rs`; [adr-003](../architecture/adr/adr-003-metaplex-core.md), [adr-027](../architecture/adr/adr-027-collection-freeze-propagation.md) |
| **Class is cosmetic.** Nothing that decides a stat, battle, pool, prize or ranking reads it; a Mythic's Strength is worth exactly what a Common's is. CI fails if the class appears in the scoring path | `scripts/check-standing-rules.sh` rule 5; [SAFEGUARDS §1](../compliance/SAFEGUARDS.md#1-class-is-cosmetic-and-is-read-by-nothing-in-scoring) |
| The class is drawn without replacement from a per-pool on-chain bag, `class_counters` = **38 / 15 / 7 / 3 / 1** of 64 (Common, Uncommon, Rare, Epic, Mythic). A pool that plays below 64 leaves the rest of the bag undrawn | `constants.rs` `LAUNCH_CLASS_COUNTERS`; [adr-021](../architecture/adr/adr-021-bag-without-replacement-draw.md) |
| Each draw mixes a committed Switchboard VRF seed, a slot hash from at least five slots back, the seat number, the pool address and the player address, and replays from published events | `programs/blotto_cup/src/vrf.rs`; [adr-026](../architecture/adr/adr-026-multi-source-randomness.md) |
| **No class reveal at entry.** Rarity appears only on the player's profile, beside the line: "Rarity is decorative. It changes nothing: not your battles, not your score, not your ranking, and no prize. A Mythic's Strength is worth exactly a Common's." | `app/src/copy/index.ts` (`rarityCaveat`); `app/src/app/profile/` |
| Passes are typographic (`BLOTTO PASS #<pool>-<index>`); illustrated art, if ever added, is a metadata change and never a change to the competition (R12) | `programs/blotto_cup/src/pass.rs` |

Any proposed class reward must answer two questions — would anyone pay money for it, and does it
improve the chance of winning? — and both answers must be no.

## 6. Pools, tiers and prizes

**Seats.** A pool has **64 seats** (`CAPACITY`) and plays with **at least 40** (`MIN_SEATS`,
R7-b). It seals the moment the 64th seat fills, or when its **12-hour** fill deadline
(`DEFAULT_FILL_DEADLINE_SECS`, D-E6) passes with 40 or more seated. Below 40 at the deadline,
every entry is repaid in full. The floor and the deadline are written onto each pool when it
opens, so a later change never moves them under players already seated. Sealing at the deadline
and starting a refund are permissionless.

**Tiers.** Seven tiers are configured, the same ladder in both modes (`constants.rs`
`TIER_ENTRY_LAMPORTS`, `TIER_POT_LAMPORTS`; D1, D-E1):

| Tier | Entry | Prize pool (fixed) |
|---|---|---|
| 0 | 0.1 SOL | 4 SOL |
| 1 | 0.5 SOL | 20 SOL |
| 2 | 0.75 SOL | 30 SOL |
| 3 | 1 SOL | 40 SOL |
| 4 | 2.5 SOL | 100 SOL |
| 5 | 5 SOL | 200 SOL |
| 6 | 7.5 SOL | 300 SOL |

These are the seed values; prices and prize pools are set by the operator (`set_tier_economics`)
and never change for an open pool. **Which tiers and modes are open is set by the operator**
(`set_open_tiers`, `set_hard_open_tiers`); only the 0.1 SOL tier is switched on (R6). One pool per
tier per mode runs at a time; the next opens **5 minutes** after the previous one is paid or
closed (`DEFAULT_COOLDOWN_SECS`).

**Prize requirements.**

- **The prize pool is fixed and funded before entry.** Opening a pool moves the tier's prize pool,
  plus a small rent reserve, from the treasury into the pool's own vault. It never depends on the
  number of entries (D-A1).
- **Entries go to the treasury**, never to a prize vault, and stay repayable until the pool seals.
- **One paid place** (`PAID_RANKS = 1`, D-E2): the player ranked first receives the whole prize
  pool; a tie for first splits it (§3.3). Payment is automatic on settlement; there is no claim
  step (R10).
- **Refunds.** Below 40 at the deadline, `trigger_refund` returns the untouched prize pool to the
  treasury and `refund` repays each entry in full from the treasury. Both are permissionless.
- **Once a pool plays, its prize is only ever paid to players.** The vault's only exits are
  `pay_prizes`, `release_escrow` and `pay_next_place`, plus `trigger_refund` for a pool that never
  played. `forfeit_escrow` moves nothing; an upheld flag passes the share to the next eligible
  place. There is no withdraw instruction, and CI asserts the exact exit set
  ([SAFEGUARDS §5](../compliance/SAFEGUARDS.md#5-the-prize-vault-has-no-withdraw-path-a-played-pools-prize-only-goes-to-players)).

## 7. Fairness and verifiability

Every number a player is paid must be recomputable by that player from published data. Each
requirement below is stated, enforced and tested in [`../compliance/SAFEGUARDS.md`](../compliance/SAFEGUARDS.md);
this section does not restate the mechanisms.

| Requirement | SAFEGUARDS |
|---|---|
| **Sealing.** No one, the operator included, can read an allocation before the pool closes. Entries are encrypted on the device to a per-pool key; only a hash goes on-chain | [§3](../compliance/SAFEGUARDS.md#3-sealing-nobody-can-read-an-allocation-until-the-pool-closes) |
| **Published secret and battle set.** At close the pool secret is published on-chain, and every entry's battles, salt, status, score, rank and amount are published; the results root is committed on-chain before any prize moves | [§4](../compliance/SAFEGUARDS.md#4-every-payout-can-be-recomputed-from-published-data) |
| **Recompute page.** Anyone can recompute a pool in the browser with no wallet, using the same scoring module the settlement process runs (R13, R20) | [§4](../compliance/SAFEGUARDS.md#4-every-payout-can-be-recomputed-from-published-data) |
| **No chance in the result.** No random value, clock or float in scoring, ranking or payment | [§2](../compliance/SAFEGUARDS.md#2-no-chance-in-the-scoring-mechanism) |
| **Detection is advisory.** Integrity signals are computed and shown to a reviewer; no signal acts on its own. A flag is a person's signed decision, by a key in [`config/reviewers.json`](../../config/reviewers.json) (two members) (D-E9) | [§14](../compliance/SAFEGUARDS.md#14-detection-is-advisory-a-flag-is-a-persons-signed-decision) |
| **Review window.** A flagged share is held in the pool's vault. The published window is **12 hours**; undecided at 12 hours, the flag is cleared and the prize paid. After **7 days** anyone may release a held share to its owner (D-E7) | [§14](../compliance/SAFEGUARDS.md#14-detection-is-advisory-a-flag-is-a-persons-signed-decision) |
| **Complaints and challenges.** A published route, signed append-only records, published response windows | [§15](../compliance/SAFEGUARDS.md#15-complaints-route) |

## 8. Eligibility

All eligibility checks happen **at entry, never at payment**, and every check fails closed: a
check that cannot get an answer refuses. Details and proofs are in
[SAFEGUARDS §10–§13](../compliance/SAFEGUARDS.md#10-age-attestation-and-terms-versioning).

| Requirement | Set in |
|---|---|
| **Age**: 18+ self-attestation, signed by the wallet and naming the terms version; no identity vendor (D-B4) | — |
| **Terms version**: a new edition re-prompts every wallet before its next entry | [`config/terms.json`](../../config/terms.json) |
| **Territory**: a block-list set by the operator, checked at the entry service and in the app | [`config/territories.json`](../../config/territories.json), legend [`config/territories.README.md`](../../config/territories.README.md) |
| **Sanctions**: every wallet screened against published sanctions lists at entry, and every payout wallet again before payment (a match places an on-chain hold) | `backend/sanctions/` |
| **Wallet blocklist**: operator-set, each address with an enumerated ground | [`config/blocked-wallets.json`](../../config/blocked-wallets.json), legend [`config/blocked-wallets.README.md`](../../config/blocked-wallets.README.md) |
| **One entry per wallet per pool**; the service's own keys cannot enter | `instructions/register.rs` |
| **Identity checks**: a switch exists and is off (R3, D-E5) | `set_kyc_threshold` |

## 9. Language and presentation

- **The language gate** in [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md#the-language-gate) binds
  every surface — copy, code, comments, tests and documents — and CI enforces it.
- **Describe mechanics; never assert a legal category** in either direction, and never claim a
  legal or trust status (D-B7).
- **Published numbers come from the program's constants**, not hand-typed copy (D-B6); CI refuses
  copy that carries a stale value.
- **Every undertaking on the rules, terms and privacy pages is registered** against the file or
  person that keeps it (`app/src/copy/published-claims.test.ts`).
- **The rules page publishes** the scoring rule, the allocation rule for each mode, the clock and
  buzzer spread, the fill deadline and refund, how sealing works, the review window, and that
  decisions are final on submission (R4).
- The default's effect is described as how the allocation performs, never as a chance of anything
  (D-E7).

## 10. Non-goals

The product does not and will not have:

- **Any class effect** on a stat, battle, pool, prize or ranking tiebreak.
- **Any chance in the result**: no pairing, bracket, random allocation on a player's behalf, or
  random tiebreak.
- **Presets, quick-set chips or named shapes** on the board.
- **Pressure mechanics**: urgency prompts, near-miss framing, rewards for consecutive play, daily
  bonuses. Their vocabulary fails CI.
- **Points systems, levels or referral schemes** (R15), or a reward for sharing a result (R16).
- **Anything purchasable after entry**, and no second session.
- **A transferable pass**, or any market for it.
- **A claim step**, a discretionary payment, a prize-vault withdrawal, or any path by which a
  played pool's prize reaches the operator.
- **Automatic sanctions against a player from detection** alone (D-E9).

## 11. Success measures and quality bars

The original product document set no success measures. The decision log records one target and
two quality bars:

| Measure | Value | Status |
|---|---|---|
| A 0.5 SOL pool fills within 24 hours without outreach (R17) | target | Not measurable until that tier opens (R6) |
| App performance and accessibility score (D-E12) | at least 90 | Checked weekly in CI |
| Screen widths tested on every change (R18) | 375 px and 1280 px | In force |

## 12. Open product questions

Stated neutrally; status for each is tracked in [`../ROADMAP.md`](../ROADMAP.md) or the document
linked.

1. **Further tiers.** When are the conditions in R6 met for opening the 0.5 SOL tier and above?
2. **Step sizes and clustering.** The board's ±5 / ±10 / ±20 steps are a deliberate exception to
   the "no prominent targets" principle (§4.2). How much of a live field lands on multiples of
   five? No measurement is published yet; if many players do, the draw rate moves toward the
   5-point row of the table in §4.2.
3. **The buzzer default.** The even split's result depends on the field it meets (§4.1). Is it the
   right shape for unplaced points? Under review (ROADMAP, finding 5.6).
4. **Published rules wording.** The rules page's timer section (`battleTimer` in
   `app/src/copy/index.ts`) still describes a per-battle timer that enters an unlocked battle as an
   even split. The board's rule (§3.1) is one clock and an even spread of *unplaced* points only.
5. **Identity checks.** At what prize value, if any, does the identity-check switch turn on
   (R3, D-E5)?
6. **Location and screening vendors.** A second vendor is a precondition of the first public pool
   (D-E14). The sanctioned-jurisdictions country list is not yet in the territory schedule, and
   sub-national blocking cannot be enforced with the current location source.
7. **A confirmed sanctions match.** Where does a held share finally go? Any answer will not be a
   path to the operator.
8. **Verifiability gaps.** The class draw replays from published events but no page does it for
   the player; a refunded pool never reveals its secret, so its entrants cannot check that their
   allocation stayed sealed; each pool's sealing key is generated in the operator's process before
   it is imported into custody.
9. **Detection under the board.** The timing signal was designed for per-screen times, and hard-mode
   thresholds are untuned.
10. **The reviewer panel.** The two reviewer keys are not yet held by two different people, so
    "decided by someone else" is recorded rather than enforced.
11. **Operating entity, data-protection impact assessment and retention periods** — not yet
    settled (D6; [`../compliance/DATA-INVENTORY.md`](../compliance/DATA-INVENTORY.md)).
12. **Pass art and class names beyond the rarity labels** (R12).
