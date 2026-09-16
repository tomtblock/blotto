# PID — Blotto Cup

**Version:** 0.6 · **Status: DRAFT — a proposal for the founder, not the PID**
**Prepared:** 2026-09-13 by the architect · **Supersedes nothing until the founder adopts it**

> **Read this box first.**
>
> `PID_Blotto-Cup_v0.5.md` remains the PID. It stays in the tree, unedited, with its
> founder-authorised appendix. This file is a draft of what v0.6 would say, offered so the founder
> can adopt, amend or reject it in one pass rather than reconstruct three months of decisions.
>
> **§8 is carried across from v0.5 word for word and is NOT proposed for adoption.** It is the legal
> characterisation, it is founder-and-counsel-owned without exception, and parts of it are now
> factually behind the build — §8.1 and §8.5 in particular describe a 20% margin that no longer
> exists in that form. Those are flagged where they sit, and they need counsel's words, not the
> architect's. **Do not adopt §8 from this draft.**
>
> Every number below traces to a program constant, a ratified register row, or a founder
> instruction. Where a v0.5 statement has been changed, the change is cited. Where the founder still
> owns a call, it is left open rather than decided here.

**v0.6 changes (proposed):** §1, §2, §6, §7 rewritten for one paid place, seven tiers, fixed
pre-funded prize pools and a 12-hour fill deadline with a 40-seat floor · §4.2's timer default
corrected to 15 seconds and the timeout behaviour stated · §4.5 restated against one paid place and
against the study the repository actually publishes · §4.6 corrected — the program never sees an
allocation · §5's ranking tiebreak corrected · §9 split into what is enforced and what is not yet
enforceable · §10 and §11 brought up to date. **§8 unchanged from v0.5.**
**v0.5:** §4 rewritten — the allocation interaction is a draggable pentagon radar with live normalisation; quick-set chips removed (they cluster the population and reintroduce draws); "Even split" is the only button.
**v0.4:** seven battles; zones Strength / Speed / Heart / Wit / Durability; rarity mapped to character classes.
**Companions:** `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` (read with its 2026-09-13 appendix) · `REPO-EXTRACTION-BRIEF_v1.1.md` · `REPO-TRANSITION-PLAYBOOK.md` · `AS-BUILT.md` (what exists) · `01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md` (each fact with its source)

> §8–10 are a brief for counsel by a non-lawyer.

---

## 1. One paragraph

A player pays a fixed entry into a 64-seat pool, receives a non-transferable character pass whose
class is assigned by verifiable on-chain randomness, and immediately fights **seven sealed battles**
— each time reshaping a pentagon of five stats (Strength, Speed, Heart, Wit, Durability) that always
sums to 100. About ninety seconds, then nothing more to do. The pool closes when the 64th entry
lands, or when its twelve-hour deadline passes with at least forty seated; below forty at the
deadline every entry is refunded in full. At close every battle is revealed and scored against the
corresponding battle of every other player: 441 comparisons per person, 14,112 in a full pool, in
milliseconds. No pairing, no bracket, no clock, no chance in the mechanism. **The player ranked
first takes the whole prize pool**, which is a fixed amount moved from the operator's treasury into
the pool before a single entry was sold. The prize is paid automatically on settlement — there is no
claim step.

*Changed from v0.5: the entry prices are no longer listed here (§2 has the table); top-16 and the
80/20 split are replaced by one paid place and a pre-funded fixed pot (D-E2 and D-A1 revised /
D-E1, ratified 2026-09-06); "unflagged winners claim immediately" is removed — R10 removed the
claim step entirely; the deadline fork is stated because it is now the ordinary way a pool closes.*

---

## 2. Pools

Seven tiers are configured. **One is open at launch** (tier 0); opening another is a deliberate
founder act, gated on the preconditions in register row R6.

| Tier | Entry | Seats | Prize pool | Intake at 40 seats | Intake at 64 seats |
|---|---|---|---|---|---|
| 0 | 0.1 SOL | 64 | 4 SOL | 4 SOL | 6.4 SOL |
| 1 | 0.5 SOL | 64 | 20 SOL | 20 SOL | 32 SOL |
| 2 | 0.75 SOL | 64 | 30 SOL | 30 SOL | 48 SOL |
| 3 | 1 SOL | 64 | 40 SOL | 40 SOL | 64 SOL |
| 4 | 2.5 SOL | 64 | 100 SOL | 100 SOL | 160 SOL |
| 5 | 5 SOL | 64 | 200 SOL | 200 SOL | 320 SOL |
| 6 | 7.5 SOL | 64 | 300 SOL | 300 SOL | 480 SOL |

**The prize pool is a fixed amount, not a share of entries.** It is moved from the operator's
treasury into the pool's own vault when the pool opens, before anyone can enter. It is the same
whether forty players enter or sixty-four. Entries are received by the treasury and are held as
refundable until the pool seals.

**The operator's margin is therefore intake minus a fixed cost**, which is `1 − 40/seats` of intake:
**nothing at all at forty seats, and 37.5% in a full pool.** Forty is exactly break-even at every
tier, by decision — the founder's ruling of 2026-09-13 is that pre-funding makes a pool's ability to
pay independent of how many players it has, and that some pools breaking even is acceptable.

**Continuous** — one pool per tier is open at any time, the next opening five minutes after the
last one finishes. **Fill deadline twelve hours.** At the deadline: forty to sixty-three seated and the pool
seals and plays; fewer than forty and every entry is refunded in full. The floor is written onto
each pool when it opens, so a later change to the rule cannot move it under players who already
entered. Anyone may send the transaction that seals a pool or the one that starts its refund — the
operator holds no discretion over either.

*Changed from v0.5: two tiers become seven, with one open; 5.12 / 25.60 SOL prize pools become the
D-E1 table; the 80/20 derivation is gone (D-A1 revised); 72 hours becomes 12 (D-E6, 2026-09-07); the
32-entrant minimum became 52 (D-E4, 2026-09-06) and is now 40 (R7-b, 2026-09-12). The per-pool floor
and the five-minute cooldown are new.*

---

## 3. The character pass

Metaplex Core with transfer permanently frozen. There is no instruction in the program that can
unfreeze one. Class is drawn bag-without-replacement from a per-pool counter bag published on
chain, seeded by Switchboard VRF.

| Rarity | Count of 64 |
|---|---|
| Common | 38 |
| Uncommon | 15 |
| Rare | 7 |
| Epic | 3 |
| Mythic | 1 |

The tier name is the whole of a character's label. The creature names v0.5 §3 carried — Goblin,
Knight, Wizard, Dragon, Titan — were dropped by the founder on 2026-09-15; the five looks and the
rarity structure are unchanged, and the on-chain bag is indexed the same way. A player sees their
tier on their profile only, beside a line stating that it is decorative; it is not shown in the
entry flow (the egg-and-reveal was removed on the founder's instruction of 2026-09-14, so that the
rarity assignment happens quietly and is not broadcast at the moment of entry).

Each draw mixes five inputs into one digest, in this order: the pool's committed VRF seed, a slot
hash from a slot deliberately in the past, the entry's seat number, the pool's address and the
player's address. Every draw can be replayed by anyone from the published events; the verify page
does not yet do so, which is recorded as not-built rather than claimed.

**Class is cosmetic only.** It does not affect any zone, any battle, any pool, or any prize. A
Mythic's Strength is worth exactly what a Common's is. This is the load-bearing rule for the legal
position (§8.4) and the thing every future feature request will try to erode.

*Changed from v0.5: the digest's fifth input was described as "opener's pubkey"; it is the pool's
address and the player's address (the opener's key is not in it). The Merkle-committed class table
was replaced by an on-chain counter bag, which is stronger: every draw replays from published
events rather than from a commitment the operator made.*

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
- **Fifteen seconds per screen.** There is no opponent waiting; the timer keeps sessions short and
  gives the detection layer a timing signal. **When it runs out, every battle the player has not
  locked — the one on screen included — is entered as the even split, 20 in each stat.** Nothing is
  ever chosen at random on a player's behalf, and the even split's effect is published as how it
  performs (it loses three stats to two against any three-stat concentration), never as a chance.

*Changed from v0.5: ten seconds becomes fifteen (R9), the value is recorded on each pool at open so
a later change cannot alter a pool already being played, and the timeout behaviour is stated rather
than left to the build (R9-b, founder addendum 2026-09-07).*

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

The original simulation, which is the reason seven was chosen:

| Battles | Best player finishes 1st | Rank fidelity |
|---|---|---|
| 5 | 39% | 0.81 |
| **7** | **44%** | **0.85** |
| 10 | 51% | 0.89 |
| 21 | 61% | 0.94 |

Seven is the defensible floor: skill clearly dominates, the session is ninety seconds, and seven
timing and entropy samples per player are workable for detection. Ten was the knee of the curve;
seven is the product decision, recorded here so nobody later treats it as arbitrary.

**Since v0.5 the built game has been measured rather than simulated.** The repository publishes a
deterministic study of the real scoring engine, regenerated nightly and diffed against its committed
output (`docs/skill-evidence/REPORT.md`). Against an everyone-equal baseline — what one seat is worth
if nothing a player does matters — it reports:

| Field | Baseline | Random valid allocations | A tuned plan |
|---|---|---|---|
| 64 seats | 1.5625% | 0.000% | **5.156%** |
| 40 seats | 2.5000% | 0.000% | **8.150%** |

Considered play takes first place roughly **3.3 times** as often as the everyone-equal baseline, at
both the full field and the smallest field the rules allow, and unconsidered play takes it
essentially never. This is the evidence §8.3 should be argued on, and it is reproducible by anyone
from the committed inputs.

*Changed from v0.5: the "Paid 16 who are genuinely top-16" column is removed — there is one paid
place, so it has no referent (D-E2). The measured study is added because it is what the product can
actually show counsel.*

### 4.6 Client invariant
The client must be unable to submit anything other than five non-negative integers summing to
exactly 100, in the fixed stat order.

**The program does not and cannot check this.** It receives only `sha256(battles ‖ salt)`; the
plaintext exists nowhere it can read until the pool closes — that *is* the sealing property, and a
program that could check an allocation would be a program that could read one. The two enforcement
points are the client at submission, where the interaction cannot express a violating shape, and the
scoring engine at reveal, which refuses a malformed set. A set that breaks the rule is scored **all
losses**, exactly as an unreadable entry is, and its status is published; one malformed entry can
never halt a pool's settlement.

*Changed from v0.5, which said "the program rejects anything else". It never has and never could.
The invariant holds; where it is enforced is different from what was written.*

---

## 5. Sealing and scoring

**At entry:** the client encrypts the seven battles (and per-screen timings) to the pool's ephemeral
public key and submits them; the program records `sha256(battles ‖ salt)` in the entry account.
Nobody, including the operator, can read a sealed battle before close.

**At close:** the pool secret is released, every battle decrypts and is verified against its hash,
scoring runs, results are published.

**Scoring:** for every pair of players and every battle index 1..7, compare. Score = battles won
(draws half). Rank by score, then total stats won. **Players equal on both share a competition rank**
and split the combined prize of the positions they occupy; with one paid place that means a tie for
first splits the pool and no other tie affects a prize. Where a split leaves an indivisible lamport,
it goes to the tied player with the lowest entry number.

**Every player faces the identical field.** No pairing exists. The only variable between players is
the quality of their seven decisions.

*Changed from v0.5, which ranked "by score, then total stats won, then earlier entry". Entry order
is not a tiebreak: it decides only the indivisible remainder of a split and the order of leaves in
the published results. Being early has never been worth anything and should not read as though it
were.*

---

## 6. Prizes — one place

**The player ranked first receives the entire prize pool.** A tie for first splits it evenly among
the tied players.

| Place | Share | Tier 0 | Tier 6 |
|---|---|---|---|
| 1st | 100% | 4 SOL | 300 SOL |
| 2nd and below | — | — | — |

At tier 0 that is 40× the entry. The prize is paid automatically when the pool settles: there is no
claim, no claim window and nothing for a winner to do. A prize withheld pending a review is held in
the pool's own vault and, if the review upholds the flag, is divided among the other eligible
players — it never returns to the operator.

*Changed from v0.5's top-16 band table (D-E2, ratified 2026-09-06). "25% paid; everyone paid
profits" is gone with it: one player in forty to sixty-four is paid, and that is the shape the
product should be described by.*

---

## 7. Money flow

```
Operator treasury ──open_pool──► Prize vault   (the FIXED pot, before any entry)

Player ──entry──► register(pool, battles_hash)
                    └─ 100% ──► Operator treasury, held refundable until the pool seals

Pool closes (64th seat, or the deadline with ≥ the pool's floor)
        └─► reveal ──► verify ──► score ──► results root on-chain
                 ├─ clear    ──► paid automatically from the prize vault
                 └─ flagged  ──► held in the prize vault; 12-hour published review window;
                                 an upheld flag passes the share to the next eligible players,
                                 never to the operator

Deadline reached below the pool's floor
        └─► the untouched pot returns to the treasury, then every entry is refunded IN FULL
```

**The prize vault has four exits and all four pay players**: settlement, a released review hold, a
forfeited share passed onward, and a refund. There is no withdraw instruction, no admin escape hatch
and no recover-stuck-funds path, and this is asserted mechanically on every change to the code.

*Changed from v0.5's diagram in four places: the 80/20 split at entry; "claim immediately"; the
24-hour escrow; and the "<32 → refund" branch.*

---

## 8. Legal characterisation

> **CARRIED FROM v0.5 WORD FOR WORD AND NOT PROPOSED FOR ADOPTION.** This section is
> founder-and-counsel-owned without exception, and the architect does not draft it. It is reproduced
> here only so a reader of this draft has the whole document. **Two parts of it are known to be
> behind the build and need counsel's attention before any v0.6 is adopted:**
>
> - **§8.1 and §8.5 describe the operator retaining 20% of entries.** That is not the model. The
>   prize is a fixed amount funded before entries open, and the margin is intake minus that fixed
>   cost — `1 − 40/seats`, which is **nothing at the forty-seat floor** and 37.5% in a full pool.
>   Whatever §8.5's argument is, it has to be made about this shape.
> - **§8.3's evidence** cites the §4.5 simulation. The repository now publishes a measured study of
>   the built game (§4.5 above), which is stronger evidence and says something different: one paid
>   place, and considered play winning about 3.3× the everyone-equal baseline.
>
> §8.2, §8.4, §8.6 and §8.7 are believed to be unaffected. §8.7's trailing path reference does not
> exist in this repository.
>
> **One phrase outside §8 also needs counsel.** §4.3's closing sentence — carried unchanged from
> v0.5 — characterises the product in two words that register row D-B7 later put on the forbidden
> list, on the ground that naming the category is a claim about it rather than a description of the
> mechanism. It is left verbatim here because changing how this document characterises the product
> is not the architect's call, but it should not survive into an adopted v0.6 unedited. Every
> other surface in the repository is already clear of it, and CI keeps them that way.

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

**Entity:** UK Ltd, Isle of Man, Cyprus, Estonia, Ireland, Delaware (with state analysis). Not the
UAE. *(Unchanged from v0.5 — founder-owned, undecided.)*

### Enforced today

The schedule in `config/territories.json` is a **block-list**: the service is available everywhere
except the codes in it. Fourteen countries are blocked as of schedule version 3 (founder instruction
2026-09-12): **India · Belgium · Australia · the six GCC states (UAE, Saudi Arabia, Qatar, Kuwait,
Bahrain, Oman) · China · Hong Kong · Singapore · Malaysia · Indonesia.**

The gate is fail-closed at every edge: no geo service configured, a lookup that fails, or a location
that cannot be determined all refuse entry, whatever the posture. `config/territories.README.md`
carries one row per code with the §9 line it implements.

### In §9 but NOT enforced, for two different reasons

- **Washington State and the eleven US restrictive skill-contest states** (AZ, AR, CT, DE, LA, MD,
  MT, SC, SD, TN, VT). These are sub-national rules and the geolocation source of record returns a
  subdivision *name*, never an ISO 3166-2 code. The entry service therefore **refuses to start** if
  any sub-national code is in the schedule — a rule that cannot be applied must not look like one
  that is. Unblocking them needs a region-capable geolocation source, which is a vendor choice and a
  cost. **This is a real gap in the published position and the founder should see it as one.**
- **Sanctioned jurisdictions.** Held pending counsel's exact list. This opens nothing: wallets on
  the published sanctions lists are already refused at entry, screened against live lists and named
  individuals rather than a country code.

**Open subject to counsel confirmation of §8.3:** UK · remaining ~39 US states · Germany, France, Nordics, Ireland, Netherlands, Spain, Italy · Canada ex-Ontario · Brazil, Mexico, Colombia, Chile · Japan, South Korea (verify).

*Changed from v0.5: the blocked list is split into what the software actually refuses and what it
does not, because a published list that the product does not enforce is worse than a shorter one
that it does.*

---

## 10. Compliance build list

| # | Item | Blocks | State |
|---|---|---|---|
| C1 | Counsel opinions on §8.3 and §8.2 — UK, DE, four US states | Launch | **Not started** |
| C2 | Entry-packet gate on `register`; geolocation vendor of record | Launch | **Split, 2026-09-16.** The packet gate is **built** and the geo path is real (IPLocate, fail-closed at every edge). The **vendor of record is not contracted**, and the second source is an empty seam — `geo-adapters.ts` says so in its own header, and D-E14 makes a second geography and screening vendor a precondition of the first pool with strangers in it. One source on a fail-closed control means a vendor outage refuses every entry. |
| C3 | Age gate before payment | Launch | Built |
| C4 | Published rules incl. scoring formula, allocation rules, fill deadline, refund, "decisions are final" | Launch | Built |
| C5 | Prize vault with no admin withdrawal; automatic payment; refund and review hold | Launch | Built |
| C6 | Pass mint with transfer frozen | Launch | Built |
| C7 | Restricted-territory schedule matching the block | Launch | **Partial — see §9** |
| C8 | KYC above a threshold | First settlement | Switch exists, **off** |
| C9 | Detection on the seven-battle session; a staffed review within the published window | First settlement | Detection built and advisory; the review registry holds one member, so **no appeal can yet be decided** |
| C10 | DPIA; privacy notice | Launch | **Not started** — this draft said "Built" until 2026-09-16, which was wrong: no privacy notice, DPIA or retention policy exists. The 2026-09-15 data inventory (`CHANGE-2026-09-16_data-minimisation.md` §1) is the first input; the text is counsel's. (Two reviewers reached this independently on the same day. The likely source of the original error: the roadmap has its own C10 — the review service — which **is** built, and is a different C10 from this one.) |
| C11 | Prompt blocklist for class art; vendor indemnity | Launch | **Not started** |
| C12 | Language audit against §8.7 | Launch | Built, and enforced on every change |

*Changed from v0.5: C5's "Merkle claim" and C8's "KYC at claim" no longer have a referent — there is
no claim step (R10). C9's "24h" is the wrong number: the published review window is **12 hours**;
the program's permissionless safety release after **7 days** exists so that our own failure cannot
strand a player's prize, and is deliberately never published as the deadline. A "State" column is
added because a build list with no state is a list nobody can act on.*

---

## 11. Open decisions

| # | Decision | Owner | State |
|---|---|---|---|
| D1 | Fill deadline and minimum field | Product | **Settled**: 12 hours (D-E6, 2026-09-07); 40 seats (R7-b, 2026-09-12) |
| D2 | Class names and art direction | Art | Open |
| D3 | Per-screen timer default | Product | **Settled**: 15 seconds (R9) |
| D4 | ~~Claim window~~ | — | **Void**: there is no claim step (R10) |
| D5 | KYC threshold | Compliance | Open; the switch is off |
| D6 | Operating entity | Founders | Open |
| D7 | Australia | Founders / Counsel | Blocked, per v0.5's caution |
| D8 | Any class reward — §8.4 first | Product / Counsel | Open, and §8.4 has not bent |
| **D9** | **A region-capable geolocation source, or the US states stay unenforced** | Founders / Counsel | **New — see §9** |
| **D10** | **A second reviewer**, without which no appeal can be decided | Founders | **New — see C9** |

---

*Filed: 10_BLOTTO_CUP. Draft — not adopted.*
