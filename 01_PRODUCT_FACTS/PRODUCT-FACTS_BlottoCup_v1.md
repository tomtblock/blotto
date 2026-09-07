# PRODUCT FACTS — Blotto Cup, v1

**What this document is.** A statement of what the product IS, derived from
the code in this repository at the commit that carries this file — not from
marketing copy and not from intent documents. Every fact cites its source;
where the source is code, the fact holds because CI pins it (the LiteSVM
suite drives the compiled program; the scoring engine is pinned to a
Python-generated oracle). Audience: counsel, auditors, and anyone checking
a claim. Written per master prompt v3 §E7.

**What this document is not.** Not a legal characterisation (PID §8 owns
that, founder-and-counsel), not a roadmap, not marketing.

---

## 1. The competition

| Fact | Value | Source |
|---|---|---|
| Players per pool | up to 64 seats; a pool **runs with at least 52** (the minimum field) | `programs/blotto_cup/src/constants.rs` `CAPACITY`, `MIN_SEATS`; D-E4 (ratified 2026-09-06) |
| Minimum field and the one clock | option A (founder ruling 2026-09-07): the pool seals at the 64th seat, or — when its deadline passes with 52–63 seated — by `seal_at_deadline`, which anyone can call; below 52 at the deadline it refunds. The 52nd seat changes nothing; there is no second clock (the go-timer of the first cut was removed before any deployment). Nothing the operator holds decides when a pool runs | `instructions/register.rs`; `instructions/seal.rs` (permissionless); D-E4 as amended by D-E6 |
| Battles per entry | 7 | `backend/scoring/src/allocation.ts` `BATTLES`; `app/src/battle/machine.ts` |
| Stats per battle | 5 (Strength, Speed, Heart, Wit, Durability, fixed order) | `backend/scoring/src/allocation.ts` `STATS` / `STAT_NAMES`; PID §4.6 |
| Allocation invariant | five integers in [0, 100] summing to **exactly 100**, in the fixed stat order. **It is not enforced on-chain, and cannot be**: the program receives only `sha256(battles‖salt)` and the plaintext exists nowhere it can read until the pool secret is published — that is the sealing property. The two enforcement points are the client at submission (the interaction cannot express a violating shape) and the scoring engine at reveal, which refuses a malformed set. A set that breaks the rule is scored **all losses**, exactly as a lost ciphertext is, and its status is published in the bundle; one malformed entry can never halt a pool's settlement | `backend/scoring/src/allocation.ts` (`assertAllocation`, `decodeBattleSet`); `backend/reveal/src/crank.ts` and `missing.ts` for the all-losses rule; `app/src/battle/allocation.ts` for the client |
| Per-screen timer | 15 seconds, visible; ninety seconds for the run. When time runs out, every battle the player has NOT locked — the one on screen included — is entered as the even split (20 in each stat); nothing is ever chosen at random. The even split's effect is published as how it performs (loses three stats to two against any three-stat concentration), never as a chance | `constants.rs` `TIMER_SECONDS`; `app/src/battle/machine.ts` `lockAllRemaining`; R9 as amended by R9-b (founder addendum 2026-09-07); `COPY.rules.battleTimer` |
| Fill deadline | **12 hours** from open (`Config.fill_deadline_seconds`, seeded from `DEFAULT_FILL_DEADLINE_SECS`; the admin's `set_pool_timing` changes it for FUTURE pools only — a pool keeps the deadline players entered under); a pool whose deadline passes with **fewer than 52** entrants refunds every entry in full (`trigger_refund` refuses at 52 and above — `FieldReached`) | `constants.rs` `DEFAULT_FILL_DEADLINE_SECS`, `MIN_SEATS`; `instructions/open_pool.rs`, `refund.rs`; D-E6 (founder ruling 1, 2026-09-07) |
| Cooldown between pools | a tier's next pool may open **5 minutes** after the previous one reached Paid or Closed (`Config.cooldown_seconds`, stamped into `tier_next_open_at` when the slot frees; `TierSlotFreed` carries it and the app's "next pool opens in" clock reads it) | `constants.rs` `DEFAULT_COOLDOWN_SECS`; `instructions/slot.rs`; prompt v2 §B.6 |
| Who opens pools | the **keeper** (`Config.keeper`, admin-rotatable via `set_keeper`); a tier idle for 24 hours past its cooldown may be opened by any signer (the liveness fallback), so a dead keeper cannot freeze a tier permanently. A tier's clock starts when the tier becomes usable — `init_config`, `migrate_config` and `set_open_tiers` all stamp it — so a tier's FIRST pool is the keeper's to open (security fix, 2026-09-07: an unstamped clock left the fallback always satisfied, and the opener chooses the pool's sealing key). The keeper holds no discretion over WHETHER a pool opens — the program's gates decide | `instructions/open_pool.rs`, `admin.rs`, `migrate.rs`; `constants.rs` `LIVENESS_FALLBACK_SECS`; prompt v2 §A |
| Who may enter | one entry per wallet per pool (the Entry PDA is `[entry, pool, player]`); no limit across pools; the four service keys — admin, keeper, entry signer, settlement signer — are refused by the program (`ServiceKeyCannotEnter`) | `instructions/register.rs`; prompt v2 §A.4; founder ruling 7 (2026-09-07) |
| Scoring | identical-field: battle k vs every other entry's battle k; a battle is won on ≥3 of 5 stats, else a draw worth half a win each; ranking by battles won then stats won; fully deterministic | `backend/scoring/src/engine.ts` (`compareBattle`, `scorePool`), pinned to the Python oracle fixture |
| Ties | equal on both criteria ⇒ shared competition rank; the tie group splits the combined prize of the positions it occupies evenly — with one paid place that means a tie for first splits the pot and no other tie affects prizes; an indivisible lamport remainder goes to the eligible player with the lowest entry number; seat order never decides rank | D3-B (ratified 2026-08-27) under D-E2; `assignPrizes` in the scoring engine; `prize_math::split_group` |
| A forfeited winner's share | an upheld flag forfeits the share **to the other players, never to the operator**: `pay_next_place` divides it equally among the remaining eligible players ranked first, or — when none is eligible — among the eligible players at the next competition rank; the remainder goes to the eligible player with the lowest entry number. At first place the whole group is on-chain (the committed payout list) and the program verifies the group, its size and the remainder recipient itself; at the next rank each member is proven by a Merkle proof against `results_root` and the group's COMPLETENESS is the settlement signer's assertion — disclosed on the rules page, checkable from the published bundle | `instructions/escrow.rs` `handle_pay_next_place`; `merkle.rs`; founder ruling 4 (2026-09-07) and addendum rulings 2–4 |

## 2. Money

All amounts are integers in lamports end to end; no float ever touches a
money path (repo standing rule; enforced in review and by the integer-only
engine).

| Fact | Value | Source |
|---|---|---|
| Tiers | 7; entry prices 0.1 / 0.5 / 0.75 / 1 / 2.5 / 5 / 7.5 SOL | `constants.rs` `TIER_ENTRY_LAMPORTS` (mirrored in `backend/scoring/src/prizes.ts`, drift-pinned) |
| Prize pool per tier | **fixed**: 4 / 20 / 30 / 40 / 100 / 200 / 300 SOL — founder-set constants (the constant is the law; how the founder arrived at it is history and is stated on no surface, public or internal — addendum ruling 6); funded from the platform treasury **before entries open**, never derived from entries received, and the same whatever the field size | `constants.rs` `TIER_POT_LAMPORTS`; D-A1 revised (master prompt v2); D-E1 (ratified 2026-09-06) |
| Paid places | **one**: the player ranked first receives the whole pot (`PRIZE_BANDS_1024 = [1024]`, `PAID_RANKS = 1`); a tie for first splits it per the ties rule. Winner-takes-all is enforced by the scoring engine (the program accepts any committed list that conserves the pot over valid seats) | `constants.rs`; `backend/scoring/src/prizes.ts`; D-E2 (ratified 2026-09-06) |
| Operator margin | entries received minus the fixed pot: price × 52 − pot at the minimum field (tier 0: 1.2 SOL) up to price × 64 − pot when full (tier 0: 2.4 SOL); break-even is 40 seats at every tier; a refunding pool returns entries **in full** | `prize_math` tests (`every_tier_pot_divides_exactly_with_zero_residual`); `set_tier_economics` refuses a pot ≥ 52 × price (`PotExceedsMinimumField`) |
| Prize vault exits | exactly four: `pay_prizes`, `release_escrow`, `pay_next_place`, `refund` (with `trigger_refund`'s pot return). **`forfeit_escrow` moves nothing** — an admin-signed record that review upheld a flag; the share waits in the vault for `pay_next_place`. **There is no withdraw instruction, no admin escape hatch, and no path from a vault to the operator.** CI asserts the exit set and that `escrow.rs` cannot address the treasury (`scripts/check-standing-rules.sh`) | `programs/blotto_cup/src/instructions/`; D-E6 |
| Held prizes | a flagged share is held by the program in the pool's own vault. The **published rule is 12 hours**: a flag undecided at 12 hours is cleared and the prize is paid. The program's permissionless `release_escrow` after **7 days** (`ESCROW_AUTO_RELEASE_SECS`) is a safeguard against the operator's own failure — anyone may land it — and is never published as the deadline. Once forfeited, a share can only be paid onward | `instructions/escrow.rs`; addendum ruling 1 (2026-09-07); `COPY.rules.reviewProcess` |
| Account layouts | `Pool` 839 bytes (+8 discriminator = 847) — the proposal's "834" was a wrong comment, recorded so nobody "fixes" the code to match; `Config` 476 (+8 = 484) since 2026-09-07, grown from 372 by the one-shot `migrate_config`; `Entry` 219 (+8 = 227) | `state.rs` `account_layouts_are_pinned`; founder ruling 3 (2026-09-07) |
| Platform treasury exit | exactly one (`withdraw_platform`), admin-gated (Squads), and blocked on-chain below the policy floor: minimum balance + one further pot per idle enabled tier + every refundable entry | `instructions/treasury.rs` `handle_withdraw_platform` |
| Prize payment | automatic on settlement; **no claim step** | R10; `pay_prizes` |
| Pause semantics | `set_paused` blocks new entries only — settlement and refunds keep working; pausing can never strand funds | `lib.rs` doc + `set_paused` |

## 3. Chance — what randomness does and does not do

| Fact | Value | Source |
|---|---|---|
| The only random draw | which character-class ARTWORK the entry's pass shows | PID §8.3/§8.4; `instructions/register.rs` class draw |
| Randomness source | Switchboard VRF seed committed on-chain, combined with a later slot hash (delay: 5 slots) | `constants.rs` `SLOT_HASH_DELAY`; `vrf.rs` |
| Class bag at launch | counters [38, 15, 7, 3, 1] per pool — a finite bag of 64, not per-draw probabilities, drawn down in entry order; a pool that runs with fewer than 64 players simply leaves the rest of the bag undrawn; every draw replays from published on-chain data | `constants.rs` `LAUNCH_CLASS_COUNTERS`; ADR-021/026; D-E4 |
| Effect of class on outcomes | **none.** No class value is read anywhere in the scoring, ranking, prize, or tiebreak path; a pass is cosmetic art | PID §3/§8.4; TECH-ARCH §4; enforced by review rule and grep |
| Pass transferability | permanently non-transferable (frozen at mint); **no instruction exists that can unfreeze** | pass mint (Phase 0 carry); PID §8.4 |

## 4. Sealing and verifiability

| Fact | Value | Source |
|---|---|---|
| What is sealed | the 127-byte payload: battles (35) + salt (32) + per-screen timings (28) + device hash (32), encrypted **on the player's device before payment** to the pool's X25519 key | `backend/sealing/src/payload.ts`; TECH-ARCH §5 |
| Who can read it early | no one, operator included: the pool secret is generated locally, imported to Turnkey, wiped, and export-locked until the pool is sealed or past deadline (the policy is enforced at custody, and the read API refuses ciphertexts pre-reveal) | `backend/sealing/src/custody-turnkey.ts`, `custody.ts` `ExportPolicy`; `backend/indexer/src/read-api.ts` sealed-entries 403 |
| On-chain commitments | `sha256(battles‖salt)` per entry at registration; `sha256(secret)` at pool open; the results tree root at commit | `register.rs`, `open_pool.rs`, `reveal_commit.rs` |
| What is published at reveal | the pool secret (on-chain) and the full bundle (permanent storage): every decrypted payload, per-seat scores, competition ranks, split-pot amounts, and the tree | `backend/reveal/src/bundle.ts`, `publisher-irys.ts` |
| Who can recompute | anyone, in a browser, with no operator involvement: the verify page re-runs the identical engine (one module, crank and browser — R20) and compares against the on-chain root; the results page additionally re-scores head-to-head from the post-reveal ciphertexts | `app/src/verify/logic.ts`; `app/src/results/what-beat-you.ts` |
| Entry authorisation freshness | packets expire after 60 s (5 s future skew) | `constants.rs` `PACKET_MAX_AGE_SECS` / `PACKET_MAX_FUTURE_SKEW_SECS` |

## 5. Access controls

| Fact | Value | Source |
|---|---|---|
| Age | 18+ self-attestation clickwrap, versioned, signed by the wallet's key and stored; packet issuance requires a record at the **current** terms version (version 2 since D-E2/D-E4 — every wallet re-accepts once) | D-B4; `backend/packet/src/attestations.ts`; `config/terms.json` |
| Territory | founder-owned schedule in `config/territories.json` — block-list posture since 2026-08-28 (available everywhere except Belgium and Australia); **fail-closed at every edge** — no configured geo service, a lookup failure, or an undetermined location all refuse entry, whatever the posture | D-B3 + founder instruction 2026-08-28; `backend/packet/src/territories.ts`, `service.ts`, `app/src/entry/geo-gate.ts` |
| Sanctions (at entry) | every entrant's wallet is screened against published sanctions **lists** at packet issuance — the mirrored OFAC SDN list always, Chainalysis and OpenSanctions when their keys are staged; a listed wallet gets the same generic refusal as a blocked territory; the verdict carries list membership and **no risk score**; the service refuses to start with no source configured, and a stale mirror or a failed lookup refuses rather than admits | Phase 2 Stages A–B (2026-09-07); `backend/sanctions/`, `backend/packet/src/sanctions-wiring.ts`, `service.ts` |
| KYC | a KYC-at-claim switch exists and is **OFF** at launch (threshold 0) | R3; `set_kyc_threshold` |
| Fairness detection | **manual-only** (prompt v2 §E, recorded 2026-09-07): the five published signals are computed for every pool and logged in shadow mode; the daemon flags nothing. A flag is a named reviewer's signed decision (`flag_entry` through the review service); it only routes the share to signed review — release to the entrant, or an upheld flag that passes the share to the next eligible players. `forfeit_escrow` is admin-signed; the review service holds no admin key | R11 as amended; `backend/reveal/src/main.ts` (the `detect` hook returns nothing); `backend/detection/src/review.ts` |
| Review audit trail | append-only log (no update, no delete, no replaceable key), every decision signed by a registry-listed reviewer | `backend/detection/src/log-pg.ts`, `auth.ts` |

## 6. Player data

| Fact | Value | Source |
|---|---|---|
| Identity data held | the wallet address; the sign-in provider (Privy) holds any email — the product's own stores never hold one | provider model D-08; `backend/packet/src/notify.ts` (choice only, no address) |
| Per-entry data | sealed payload (above), IP-derived geo verdict at issuance (boolean outcome), acceptance records | packet service |
| Published post-reveal | battles, salts, timings, device hashes, scores, ranks, amounts — by design, so results are recomputable | `bundle.ts` (the disclosure is the verifiability mechanism) |
| Notifications | opt-in only, wallet-signed, factual state changes; the retention design explicitly excludes pressure mechanics, and their vocabulary fails CI | v3 D3; `scripts/check-language.sh` `PATTERN_D3` |

## 7. Language controls

The PID §8.7 vocabulary rule is CI-enforced over the whole repository —
code identifiers, comments, tests, and UI copy alike — with the B7
amendment (unprovable trust claims, identity-evasion marketing, guarantee
claims, finance framing, category assertions) and the v3 D3 pressure
vocabulary.
Source: `scripts/check-language.sh`; process: `CONTRIBUTING.md`.

## 8. Things that do not exist (checked, not promised)

- No prize-vault withdraw instruction, no "recover stuck funds" path
  (CI-asserted exit set).
- No instruction that can unfreeze a pass.
- No randomness anywhere in scoring, ranking, or prizes.
- No plaintext path to a sealed allocation before the pool closes.
- No claim step, and no discretionary payment: every ordinary payout is
  validated on-chain against the committed payout list, and a share passed on
  after a forfeit is validated against the committed results root by a Merkle
  proof. The one residual is disclosed in §1 — at the next rank the program
  cannot prove the presented group is complete.
- No operator control over when a pool runs: the 64th seat, or the
  deadline with at least 52 seated, seals it — and the deadline seal is
  callable by anyone.
- No urgency, near-miss, or consecutive-play-reward retention mechanics
  (the v3 do-not-build list; its vocabulary fails CI).

## 9. Published commitments that are NOT yet implemented

Recorded 2026-09-07 by repository audit, and listed here rather than left to
be discovered. The rules page and the terms carry the founder's ratified
wording for the resolving and review process. Four of its undertakings describe
controls that do not exist in this repository at this commit:

| Published | Status |
|---|---|
| "the tournament enters resolving. Resolving lasts up to 12 hours" | **Not built.** There is no `Resolving` pool state; the states are Open, Sealed, Scored, Paid, Refunding, Closed |
| "During resolving we check the winning wallet against published sanctions lists" | **Partly built.** Screening is live at *entry* (§5): every entrant is checked and a listed wallet never holds a seat. The check on the *winner* at *resolving* is not built; it needs an on-chain hold the program does not have, and the founder's decision on it is recorded in `docs/AUDIT-2026-09-07.md` (O10) |
| "If no decision is made within 12 hours, the flag is cleared and the prize is paid" | **Not built.** No 12-hour timer exists. The program has only the seven-day permissionless release, which is published — correctly — as a safeguard rather than as the deadline |
| "You may appeal within 7 days … decided by a different reviewer" | **Not built.** The review service records signed decisions; there is no appeal path |

The operative geographic control at launch is the territory schedule, which is
fail-closed and does work (§5). These four are on the Road to Mainnet checklist
in `docs/AUDIT-2026-09-07.md`, and `app/src/copy/published-claims.test.ts` fails
the build if the set changes without this section changing with it.

---

*Maintenance rule: this document restates only facts whose numbers live in
code or ratified registers, with the source cited. When a source changes,
this file changes in the same change set or the claim comes out.*
