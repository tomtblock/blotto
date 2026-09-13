# PID — Blotto Cup

**Version:** 0.5 · **Date:** 2026-08-26 · **Status:** Project Initiation — for build
**v0.5 changes:** §4 rewritten — the allocation interaction is a draggable pentagon radar with live normalisation; quick-set chips removed (they cluster the population and reintroduce draws); "Even split" is the only button.
**v0.4:** seven battles; zones Strength / Speed / Heart / Wit / Durability; rarity mapped to character classes.
**Companions:** `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` · `REPO-EXTRACTION-BRIEF.md` · `REPO-TRANSITION-PLAYBOOK.md`

> §8–10 are a brief for counsel by a non-lawyer.

---

## 1. One paragraph

A player pays a fixed entry (0.1 or 0.5 SOL) into a 64-seat pool, receives a non-transferable character pass whose class is assigned by verifiable on-chain randomness, and immediately fights **seven sealed battles** — each time reshaping a pentagon of five stats (Strength, Speed, Heart, Wit, Durability) that always sums to 100. About ninety seconds, then nothing more to do. When the 64th ticket lands, every battle is revealed and scored against the corresponding battle of every other player: 441 comparisons per person, 14,112 in total, in milliseconds. No pairing, no bracket, no clock, no chance in the mechanism. Top 16 paid from a pool equal to 80% of entries; the platform retains 20%. Unflagged winners claim immediately.

---

## 2. Pools

| Pool | Entry | Seats | Gross | Prize pool (80%) | Platform (20%) |
|---|---|---|---|---|---|
| Entry | 0.1 SOL | 64 | 6.4 | 5.12 | 1.28 |
| Standard | 0.5 SOL | 64 | 32.0 | 25.60 | 6.40 |

**Rolling** — one pool per tier open at any time. **Fill deadline** 72 hours; 32–63 entrants run at reduced size; fewer than 32 → automatic full refund.

---

## 3. The character pass

Metaplex Core with transfer permanently frozen, or Token-2022 `NonTransferable`. Class drawn bag-without-replacement from a Merkle-committed table seeded by Switchboard VRF, opener's pubkey in the digest.

| Rarity | Class | Count of 64 |
|---|---|---|
| Common | Goblin | 38 |
| Uncommon | Knight | 15 |
| Rare | Wizard | 7 |
| Epic | Dragon | 3 |
| Mythic | Titan | 1 |

Class names are placeholders for art direction; the rarity structure is fixed.

**Class is cosmetic only.** It does not affect any zone, any battle, any pool, or any prize. A Titan's Strength is worth exactly what a Goblin's is. This is the load-bearing rule for the legal position (§8.4) and the thing every future feature request will try to erode.

---

## 4. The game — seven battles

### 4.1 A battle
Distribute 100 points across five stats: **Strength, Speed, Heart, Wit, Durability.** Free integers summing to exactly 100.

### 4.2 The allocation interaction — pentagon radar
Each battle is one screen: a pentagon with a draggable vertex per stat.

- **Opens at an even split** — 20 on every stat. Players nudge from a balanced shape rather than building from zero.
- **Drag a vertex** outward or inward along its axis. The other four are untouched by the drag itself.
- **Live normalisation.** After every movement the five raw values are rescaled to sum to 100, rounded to integers, with any rounding remainder placed on the largest stat. The displayed integers are always the real allocation. The player never does arithmetic and never sees a "points remaining" counter.
- **Integers are shown under the pentagon as feedback, not as targets.** A player who wants exactly 40 on Speed can nudge to it; most will not bother, which is the point.
- **One button: "Even split."** It resets to 20-20-20-20-20. There are no presets, no quick-set chips, and no named shapes. Anything that offers a shape becomes a target that clusters the population.
- **Lock in** commits the battle and advances. Seven screens, then a review, then one transaction.
- **Ten seconds per screen is a UX default, not a rule.** There is no opponent waiting. The timer exists to keep sessions short and to give the detection layer a timing signal.

### 4.3 Why this design
The tension is not clean-versus-granular. It is that **any prominent discrete target clusters the population, and clustering causes draws.**

| Effective granularity | Distinct allocations | Random-vs-random draw rate |
|---|---|---|
| 20-point steps (six values per stat) | 126 | **86%** |
| 10-point steps | 1,001 | 56% |
| 5-point steps | 10,626 | 31% |
| Free integers | 4,598,126 | **7%** |

With chips at 0/25/50/75/100, most players land on those values and the effective grid collapses back toward the first row. A dragged vertex lands on 37, 22, 41 — the spread the game needs — without the player ever thinking about granularity. Precision comes from the physics of a thumb, not from an advanced mode.

This also matters legally (§8.3): a 126-option menu reads as "pick a number"; a 4.6-million-option space in which consistent players reliably outperform is a skill game.

### 4.4 A comparison
Your battle *k* against another player's battle *k*. A stat is won by the larger number; the battle by three or more stats. Tied stats go to neither; 2–2 with a tie is a draw (half a win each).

### 4.5 Why seven battles
Simulation across 64 players of varying skill:

| Battles | Paid 16 who are genuinely top-16 | Best player finishes 1st | Rank fidelity |
|---|---|---|---|
| 5 | 70% | 39% | 0.81 |
| **7** | **74%** | **44%** | **0.85** |
| 10 | 77% | 51% | 0.89 |
| 21 | 83% | 61% | 0.94 |

Seven is the defensible floor: skill clearly dominates, the session is ninety seconds, and seven timing and entropy samples per player are workable for detection. Ten was the knee of the curve; seven is the product decision, recorded here so nobody later treats it as arbitrary.

### 4.6 Client invariant
The client must be unable to submit anything other than five non-negative integers summing to exactly 100, in the fixed stat order. The program rejects anything else. This invariant is what makes the 7% draw rate real rather than aspirational.

---

## 5. Sealing and scoring

**At entry:** the client encrypts the seven battles (and per-screen timings) to the pool's ephemeral public key and submits them; the program records `sha256(battles ‖ salt)` in the entry account. Nobody, including the operator, can read a sealed battle before close.

**At close:** the pool secret is released, every battle decrypts and is verified against its hash, scoring runs, results are published.

**Scoring:** for every pair of players and every battle index 1..7, compare. Score = battles won (draws 0.5). Rank by score, then total stats won, then earlier entry.

**Every player faces the identical field.** No pairing exists. The only variable between players is the quality of their seven decisions.

---

## 6. Prizes — top 16

| Place | Share each | 0.1 SOL | 0.5 SOL | × entry |
|---|---|---|---|---|
| 1st | 26.37% | 1.350 | 6.750 | **13.5×** |
| 2nd | 15.43% | 0.790 | 3.950 | 7.9× |
| 3rd | 9.96% | 0.510 | 2.550 | 5.1× |
| 4th | 7.62% | 0.390 | 1.950 | 3.9× |
| 5th–8th | 4.88% | 0.250 | 1.250 | 2.5× |
| 9th–16th | 2.64% | 0.135 | 0.675 | **1.35×** |

25% paid; everyone paid profits.

---

## 7. Money flow

```
Player ──entry──► register(pool, hash)
                    ├─ 80% ──► Prize PDA  (no admin withdrawal path)
                    └─ 20% ──► Operational wallet
Pool fills ──► reveal ──► verify ──► score ──► Merkle root on-chain
   ├─ unflagged ──► claim immediately
   └─ flagged   ──► escrow 24h ──► review + appeal
Deadline missed, <32 ──► automatic full refund
```

---

## 8. Legal characterisation

### 8.1 What this is
A **paid-entry skill competition** from which the operator retains 20%, with a cosmetic random draw attached to the entry.

### 8.2 Three-element test
| | Pass purchase | Competition |
|---|---|---|
| Consideration | Yes | Yes |
| Chance | Yes — cosmetic class | **No** — none in the mechanism |
| Prize of value | **No** — soulbound, cosmetic, no market, no competitive effect | Yes — the pool |

Neither leg satisfies all three.

### 8.3 Is it skill?
No chance in the mechanism — no pairing, no bracket, no timing; every player faces the identical field. Decisions are blind, so the skill is choosing allocations that perform against an unknown population: game theory rather than reaction. The fantasy-sports analogy carries it in most markets. Seven battles is the point where the product's own simulation shows skill clearly dominating (best player 44%, versus ~2% for a lottery), and the free-integer space (§4.3) is what makes consistent players separable from guessers. Publish both.

Belgium (any chance element) and Australia ("mixed chance and skill") remain blocked.

### 8.4 The rule that cannot bend
Class confers nothing of value and nothing competitive. Any proposed class reward: *would anyone pay money for this, and does it improve the chance of winning?* Both must be no.

### 8.5 The 20%
An organiser's margin on a skill competition — not a rake on a gaming pool. Depends entirely on §8.3.

### 8.6 Format-specific obligations
Decisions final on submission, stated before payment · fill deadline and automatic refund · sealing described accurately · identical-field scoring published · the allocation rules (free integers, live normalisation, no presets) published, since they are part of why the game is skilful.

### 8.7 Language
Never: lottery · gamble · bet · wager · casino · pull · pack · odds · jackpot · rake · deal · roll. Use: entry · pass · character · battle · stat · allocation · tournament · prize pool · ranking. `00_READ_FIRST/HUB-06`.

---

## 9. Where it runs, and who is out

**Entity:** UK Ltd, Isle of Man, Cyprus, Estonia, Ireland, Delaware (with state analysis). Not the UAE.

**Blocked:** India · Belgium · Washington State · US restrictive skill-contest states — AZ, AR, CT, DE, LA, MD, MT, SC, SD, TN, VT *(verify)* · UAE/GCC, China, Hong Kong, Singapore, Malaysia, Indonesia · sanctioned · Australia (caution — blocked until a specific opinion).

**Open subject to counsel confirmation of §8.3:** UK · remaining ~39 US states · Germany, France, Nordics, Ireland, Netherlands, Spain, Italy · Canada ex-Ontario · Brazil, Mexico, Colombia, Chile · Japan, South Korea (verify).

---

## 10. Compliance build list

| # | Item | Blocks |
|---|---|---|
| C1 | Counsel opinions on §8.3 and §8.2 — UK, DE, four US states | Launch |
| C2 | Entry-packet gate on `register`; geolocation vendor of record | Launch |
| C3 | Age gate before payment | Launch |
| C4 | Published rules incl. scoring formula, allocation rules, fill deadline, refund, "decisions are final" | Launch |
| C5 | Prize PDA with no admin withdrawal; Merkle claim; refund and escrow | Launch |
| C6 | Pass mint with transfer frozen | Launch |
| C7 | Restricted-territory schedule matching the block | Launch |
| C8 | KYC at claim above threshold | First settlement |
| C9 | Detection on the seven-battle session; staffed 24h review | First settlement |
| C10 | DPIA; privacy notice | Launch |
| C11 | Prompt blocklist for class art; vendor indemnity | Launch |
| C12 | Language audit against §8.7 | Launch |

---

## 11. Open decisions

| # | Decision | Owner |
|---|---|---|
| D1 | Fill deadline (72h) and minimum (32) | Product |
| D2 | Class names and art direction | Art |
| D3 | Per-screen timer default (10s) | Product |
| D4 | Claim window (30d) | Product / Counsel |
| D5 | KYC threshold | Compliance |
| D6 | Operating entity | Founders |
| D7 | Australia | Founders / Counsel |
| D8 | Any class reward — §8.4 first | Product / Counsel |

---

*Filed: 10_BLOTTO_CUP.*

---

## Appendix — decisions taken after this version was filed

**Appended 2026-09-13 on the founder's instruction of 2026-09-12 §4.5, which asks that §2 and D1
be annotated as superseded rather than rewritten. Nothing above this line has been altered.**

This document is v0.5 and is the founder's to reissue. Until a v0.6 exists, the rows below are where
the body is known to be behind what is built. The full list — including the prize structure and the
prize amounts — is maintained in `INDEX.md` under "The PID is behind the build", and `AS-BUILT.md`
§5 carries the same table with the code-side detail.

| Where | This document says | The build, and since when |
|---|---|---|
| §2 pool-cadence paragraph; **D1** | Fill deadline **72 hours**; 32–63 entrants run at reduced size; fewer than 32 refunds | Fill deadline **12 hours** (D-E6, 2026-09-07), held in `Config.fill_deadline_seconds` and copied onto each pool at open. A pool runs with **40–63** seated as well as at 64; below 40 at the deadline every entry refunds in full (**R7-b**, founder instruction 2026-09-12 — the floor was 52 under D-E4 from 2026-09-06). The floor is carried per pool, so a change never moves it under players already seated |
| §2 table; §6 | Prize pools 5.12 / 25.60 SOL; top 16 paid | **4 / 20 / 30 / 40 / 100 / 200 / 300 SOL** across seven tiers (D-E1, 2026-09-06), and **one paid place** — the winner takes the pool whole (D-E2, 2026-09-06) |
| **D3** | Per-screen timer default **10s** | **15 seconds** (R9), recorded on each pool at open |

The 40-seat floor is exactly break-even at the D-E1 prize pools: forty entries at 0.1 SOL is the
4 SOL prize. That was ratified deliberately on 2026-09-13 on the ground that the prize is pre-funded
from the treasury before any entry is sold, so a pool's ability to pay has never depended on how many
players it has. `docs/CHANGE-2026-09-12_sim-report.md` measures what the floor does to the rate at
which pools run.
