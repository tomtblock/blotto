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
| Minimum field and the go-timer | the 52nd entry shortens the pool's deadline to `min(fill deadline, now + GO_TIMER_SECS)` (six hours — a PROPOSAL pending the founder's number) and emits `GoTimerStarted`; when the deadline passes with 52–63 seated, anyone can call `seal_at_deadline` and the pool runs; the 64th seat still seals immediately. Nothing the operator holds decides when a pool runs | `constants.rs` `GO_TIMER_SECS`; `instructions/register.rs` step 7a; `instructions/seal.rs` (permissionless) |
| Battles per entry | 7 | `constants.rs` `BATTLES` |
| Stats per battle | 5 (Strength, Speed, Heart, Wit, Durability, fixed order) | `constants.rs` `STATS`; PID §4.6 |
| Allocation invariant | five u8 summing to **exactly 100**; the program rejects anything else | `programs/blotto_cup/src/instructions/register.rs`; client invariant in `app/src/battle/allocation.ts` |
| Per-screen timer | 15 seconds, visible; on timeout the battle locks exactly what the pentagon shows — **nothing is ever chosen for the player** | `constants.rs` `TIMER_SECONDS`; R9 (randomise-on-timeout was explicitly rejected) |
| Fill deadline | 72 hours from open; a pool whose deadline passes with **fewer than 52** entrants refunds every entry in full (`trigger_refund` refuses at 52 and above — `FieldReached`) | `constants.rs` `FILL_DEADLINE_SECS`, `MIN_SEATS`; `instructions/refund.rs`; D-E4 |
| Scoring | identical-field: battle k vs every other entry's battle k; a battle is won on ≥3 of 5 stats, else a draw worth half a win each; ranking by battles won then stats won; fully deterministic | `backend/scoring/src/engine.ts` (`compareBattle`, `scorePool`), pinned to the Python oracle fixture |
| Ties | equal on both criteria ⇒ shared competition rank; the tie group splits the combined prize of the positions it occupies evenly — with one paid place that means a tie for first splits the pot and no other tie affects prizes; an indivisible lamport remainder goes to the earliest entrant; seat order never decides rank | D3-B (ratified 2026-08-27) under D-E2; `assignPrizes` in the scoring engine; `prize_math::split_group` |

## 2. Money

All amounts are integers in lamports end to end; no float ever touches a
money path (repo standing rule; enforced in review and by the integer-only
engine).

| Fact | Value | Source |
|---|---|---|
| Tiers | 7; entry prices 0.1 / 0.5 / 0.75 / 1 / 2.5 / 5 / 7.5 SOL | `constants.rs` `TIER_ENTRY_LAMPORTS` (mirrored in `backend/scoring/src/prizes.ts`, drift-pinned) |
| Prize pool per tier | **fixed**: 4 / 20 / 30 / 40 / 100 / 200 / 300 SOL (the founder's derivation: entry ÷ 8 × 5 × 64, exact in integers; the constant is the law, the derivation is history); funded from the platform treasury **before entries open**, never derived from entries received, and the same whatever the field size | `constants.rs` `TIER_POT_LAMPORTS`; D-A1 revised (master prompt v2); D-E1 (ratified 2026-09-06) |
| Paid places | **one**: the player ranked first receives the whole pot (`PRIZE_BANDS_1024 = [1024]`, `PAID_RANKS = 1`); a tie for first splits it per the ties rule. Winner-takes-all is enforced by the scoring engine (the program accepts any committed list that conserves the pot over valid seats) | `constants.rs`; `backend/scoring/src/prizes.ts`; D-E2 (ratified 2026-09-06) |
| Operator margin | entries received minus the fixed pot: price × 52 − pot at the minimum field (tier 0: 1.2 SOL) up to price × 64 − pot when full (tier 0: 2.4 SOL); break-even is 40 seats at every tier; a refunding pool returns entries **in full** | `prize_math` tests (`every_tier_pot_divides_exactly_with_zero_residual`); `set_tier_economics` refuses a pot ≥ 52 × price (`PotExceedsMinimumField`) |
| Prize vault exits | exactly four: `pay_prizes`, `release_escrow`, `refund`, `forfeit_escrow`. **There is no withdraw instruction and no admin escape hatch.** CI asserts the exit set (`scripts/check-standing-rules.sh`) | `programs/blotto_cup/src/instructions/` |
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
| KYC | a KYC-at-claim switch exists and is **OFF** at launch (threshold 0) | R3; `set_kyc_threshold` |
| Fairness detection | five published signals over post-reveal data; a flag needs two independent signals, except two conclusive cases (byte-identical battle sets; two entries from one device); a flag only routes the share to signed human review — release to the entrant or forfeit, nothing else | R11; `backend/detection/src/signals.ts`, `pipeline.ts`; review process in `backend/detection/src/review.ts` |
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
- No claim step, and no discretionary payment: every payout is validated
  on-chain against the committed list.
- No operator control over when a pool runs: the 64th seat, or the
  deadline with at least 52 seated, seals it — and the deadline seal is
  callable by anyone.
- No urgency, near-miss, or consecutive-play-reward retention mechanics
  (the v3 do-not-build list; its vocabulary fails CI).

---

*Maintenance rule: this document restates only facts whose numbers live in
code or ratified registers, with the source cited. When a source changes,
this file changes in the same change set or the claim comes out.*
