# Blotto Cup — Brief for Counsel

**Version 1 · 2026-09-18 · Prepared for a qualified lawyer instructed to give a written opinion on the
legal characterisation of Blotto Cup and on the operating entity.**

**Status.** This brief was prepared by the project's architect, who is not a lawyer, from the
source code on the `main` branch at commit `02a036c` and from the internal desk studies listed in
Part 8. It is not legal advice. Every statement about what the software does cites the file that
does it; every statement about the law is a lay reading offered so counsel knows what the client
believes, and each is marked for verification. Authorities were checked against public sources as
at the date above, and the desk studies carry their own re-verification date of 2026-11-22.

**Why this document uses vocabulary the product bans.** The product's own rules (PID §8.7, enforced
by a CI grep over the whole repository) forbid the words *gambling*, *lottery*, *bet*, *wager*,
*odds* and others on every surface, because a category assertion is a claim and not a description.
A brief for counsel cannot avoid the statutory language, so this file is one of a small set the
grep does not run over. It should not be quoted on any player-facing surface.

**Reading order for counsel.** Part 1 is the summary. Part 2 introduces the game. Part 3 is the
mechanism in plain language. Part 4 is the guardrails, one at a time, each with the code that
enforces it. Parts 5 to 7 apply the law. Part 8 is the prior desk studies. Part 9 is the entity
question. Part 10 is what is not yet in place. Part 11 is the questions we are asking counsel.
Annex A is a glossary of the blockchain terms used; a reader with no cryptocurrency background may
want to read it first.

---

## Part 1 — Summary

**What Blotto Cup is.** A paid-entry competition of strategy. Up to 64 players each pay the same
fixed entry into a pool. Each player, alone and once, makes seven decisions: seven times, they split
100 points across five named attributes. The seven decisions are encrypted on the player's own
device before payment and cannot be read by anyone, the operator included, until the pool closes.
When the pool closes, every player's seven decisions are compared against every other player's, by
a published deterministic rule, and the player ranked first is paid a fixed prize that was placed in
the pool's account before the first entry was sold. Nothing in the path from entry to payment is
random.

**Why the client believes it falls outside the gambling definitions it has examined.** Every
regime the client has looked at tests some form of *consideration + chance + prize*. Blotto Cup has
consideration and a prize. The client's position is that the third element is absent from the
competition, and that where chance does appear in the product (the artwork on the entry pass) it
attaches to nothing of value and to nothing competitive. The evidence for the absence of chance is
not an assertion but a measurement, reproduced nightly in the build: entrants who allocate at random
place first in **0.000%** of pools, and so do entrants who leave the default allocation untouched;
entrants who think about it place first at roughly three to five times the everyone-equal baseline
(Part 2.4).

**The guardrails, in one table.** Each is expanded in Part 4 with its source file.

| # | Guardrail | What the code does | Why it matters |
|---|---|---|---|
| 1 | 64-seat pools, minimum 40 | Every player faces the identical field of 39–63 others; 441 comparisons per player at full capacity | Large fields collapse variance; a single lucky decision cannot carry a pool |
| 2 | Everyone plays everyone | No pairing, no bracket, no draw of opponents | Removes the one place chance usually enters a tournament: who you are matched against |
| 3 | Seven sealed decisions per entry | Seven independent allocations, each scored against the field; seven timing samples for integrity review | Repeated decisions separate skill from guessing; the sample supports detection |
| 4 | Integrity review and sanction | Five published signals, a named human reviewer, a signed append-only log, a hold on the prize, an appeal to a different reviewer; a forfeited prize passes to the next eligible player, never to the operator | A competition of skill must be able to show its results are genuine |
| 5 | Territory block-list | Fifteen countries refused at entry, the United States among them; unresolvable locations refused; the service refuses to start if it cannot enforce its own list | The client does not offer the service where it believes it cannot lawfully do so |
| 6 | 18+ attestation | A wallet-signed, versioned statement recorded before any payment; entry refused without it | Age policy before money moves |
| 7 | Pre-funded fixed prize | The prize is a constant per tier, moved into the pool's account before entries open, the same whatever the field size; entries are paid to the operator, not into the prize | The operator is not a stakeholder between players; no player's money is at risk to another player; no percentage is taken from a pot |
| 8 | Sanctions screening before payment | Every wallet is screened against the OFAC SDN list at entry and again before any prize is paid; a match or an unanswerable screening places an on-chain hold | Strict-liability sanctions compliance; nothing is paid unscreened |

**What is not in place.** No external legal opinion has yet been obtained (a recorded decision,
Part 10). There is no operating entity, no terms-of-service document, no privacy notice and no
support channel. The United States is entirely open in the software because the location vendor
cannot resolve US states, and several European markets the schedule leaves open appear on a lay
reading to regulate paid skill competitions (Part 6.3). Identity verification is switched off. These
are stated plainly in Part 10 so that counsel is not advising on a product other than the one built.

**What we are asking.** Part 11 lists the questions. The first three are: is the competition
outside the gambling definition in the named jurisdictions; is the pre-funded prize structure
material to that answer; and is a Delaware LLC the right operating entity given that the founder's
existing company is a Dubai free-zone entity.

---

## Part 2 — The game

### 2.1 Colonel Blotto

Blotto Cup is a form of the *Colonel Blotto game*, a model of resource allocation first posed by
the mathematician Émile Borel in 1921 and studied in game theory since. Two commanders each divide
a fixed force across several battlefields without seeing the other's division; a battlefield is
won by the larger force; the war is won by taking more battlefields. The game is taught because it
has no best answer: any fixed division can be beaten by an opponent who knows it, so competent play
consists of reasoning about what the population of opponents is likely to do and choosing a
division that performs well against that population. The formal equilibria of the two-player game
were characterised in the economics literature (Roberson, *Economic Theory*, 2006, for the
continuous case; Hart, 2008, for discrete forces), and the game is a standard example of strategic
reasoning in the same family as the "beauty contest" experiments used to measure depth of thought.

Blotto is not a game of reaction, dexterity or general knowledge. It is a game of judgement about
other people's judgement. That is the kind of skill that fantasy-sports contests were held to
involve in the United States cases in Part 6.1 (selecting a line-up that will outperform other
entrants' line-ups), except that in Blotto Cup there is no external sporting event at all: the only
inputs to the result are the players' own decisions.

### 2.2 The rules as implemented

Every figure below is a value the program enforces, cited to its source in Annex B.

- **A battle** is one division of exactly 100 points across five attributes, in a fixed order:
  Strength, Speed, Heart, Wit, Durability. The five values are whole numbers between 0 and 100
  summing to exactly 100. There are 4,598,126 distinct legal divisions.
- **An entry** is seven battles, made in about ninety seconds on seven consecutive screens, each
  with a visible fifteen-second timer. A screen the player does not lock in time is entered as the
  even split (20 in each attribute). Nothing is ever chosen for the player at random.
- **Comparison.** Battle *k* of one entry is compared with battle *k* of every other entry in the
  pool. An attribute is won by the higher number. A battle is won by taking three or more of the
  five attributes; if neither side takes three (two each with a tie), it is a draw worth half a win
  to each.
- **Ranking.** Entries are ranked by battles won, then by attributes won across every comparison.
  Players still equal share a rank. Entry order does not decide rank.
- **Prize.** The player ranked first receives the whole fixed prize for that tier. Players tied
  for first divide it equally.

The interaction is a draggable pentagon with live normalisation and one button, "Even split". There
are no preset shapes and no suggested numbers. This is deliberate: any prominent discrete target
clusters the population and raises the draw rate; free integers spread it. The client's design
document estimates the random-versus-random draw rate at 7% under free integers against 86% under
20-point steps (PID §4.3).

### 2.3 Why the design is a competition of skill

Three properties of the format do the work.

**The field is identical for everyone.** In a bracket or a ladder, who you are drawn against is
a matter of chance and can decide a tournament. Here there is no draw. Every player's seven
battles meet every other player's seven battles, so two players with the same seven decisions
receive the same score. The only difference between any two players' outcomes is the content of
their decisions.

**The result is a deterministic function of the decisions.** Given the 64 sealed entries, the
ranking is fixed and can be recomputed by anyone. There is no dice, no card, no random seed and no
external event anywhere in the scoring path. The one random draw in the product decides which of
five pieces of artwork appears on the entry pass, and Part 4.9 shows that value is written once and
read by nothing.

**Repetition separates skill from luck.** Seven decisions, each scored against 39–63 opponents, is
between 273 and 441 comparisons per player. A single lucky allocation cannot carry a pool; a player
who consistently reads the population better than the others wins more of those comparisons. The
measurement in 2.4 is the demonstration.

### 2.4 The measured evidence

The repository carries a reproducible study (`docs/skill-evidence/REPORT.md`, regenerated nightly
in CI from a fixed seed, with the build failing on drift). It runs the real settlement engine over
200 simulated pools at each of two field sizes, with equal numbers of entrants from four strategy
classes: *random* (valid allocations with no intent), *heuristic* (a three-attribute
concentration), *optimised* (the same family, tuned), and *uniform* (the untouched default).

| Field | Class | Rank-1 rate | Everyone-equal baseline |
|---|---|---|---|
| 64 | random | 0.000% | 1.5625% |
| 64 | uniform (default untouched) | 0.000% | 1.5625% |
| 64 | heuristic | 1.093% | 1.5625% |
| 64 | optimised | 5.156% | 1.5625% |
| 40 | random | 0.000% | 2.5000% |
| 40 | uniform | 0.000% | 2.5000% |
| 40 | heuristic | 1.850% | 2.5000% |
| 40 | optimised | 8.150% | 2.5000% |

Two readings matter to the legal question. First, unconsidered play does not merely do worse; it
never places first, in either field, and the report shows this is structural rather than
statistical for the default (a flat split loses three attributes to two, by construction, against
any three-attribute concentration). Second, in control runs where every entrant plays the *same*
strategy class, every class regresses exactly to the everyone-equal baseline: among equals nobody
holds an edge, which is the shape a competition of skill should have. The study can be re-run by
anyone with the command in the report.

The study's own caveat should be put in front of counsel rather than discovered: at 64 seats the
*heuristic* class places first slightly below the baseline, because the field contains optimised
entrants who beat it. A reader coming cold might phrase this as "only a narrow expert strategy
wins". The accurate phrasing is that considered play beats less-considered play, which is the
point.

### 2.5 The honest counter-argument

A regulator could say that a player cannot control what 63 other people choose, and that this
uncertainty is a form of chance. The client's answer has three parts.

1. **Strategic uncertainty is not randomness.** Every competition of skill involves opponents whose
   choices are unknown in advance (chess, poker excepted because of the deal, every esport). The
   legal tests distinguish chance in the *mechanism* from uncertainty about *other competitors*.
   Blotto Cup has none of the former.
2. **The fantasy-sports cases accepted a larger external input.** In *Humphrey*, *Dew-Becker* and
   *White* (Part 6.1) the result turned on real athletes' performances, which entrants cannot
   influence at all; the courts still held the contests to be skill-dominated because the entrant's
   selection was the dominant determinant of *relative* success. In Blotto Cup the only external
   input is other entrants' decisions, and the entrant's own decisions are the whole of their
   contribution.
3. **The measurement.** If the population's choices were effectively random from the entrant's
   point of view, considered play could not systematically beat unconsidered play. It does, at both
   field sizes, and the effect is large.

Two jurisdictions define chance so widely that the client does not rely on this argument there:
Belgium (chance "even if only ancillary") and Australia ("mixed chance and skill"). Both are
blocked in the software (Part 4.5).

---

## Part 3 — The mechanism, step by step

Written for a reader who has not used a blockchain. Terms in *italics* are in Annex A.

1. **Sign in.** The player signs in with a social login or an existing *wallet*. Where the login is
   social, a wallet is created for them by the sign-in provider (Privy). The product's own systems
   hold the wallet address and nothing else about identity.
2. **Location check.** Before anything else is shown, the player's location is checked against the
   territory schedule (Part 4.5). If the location is blocked or cannot be determined, the play flow
   does not render.
3. **Age and terms.** The player ticks two unchecked boxes (18+, and acceptance of the terms at the
   current version) and their wallet *signs* a fixed sentence recording it. The signed record is
   stored. Without it no entry can be issued (Part 4.6).
4. **Sanctions screening.** The wallet address is screened against the OFAC SDN list (and, when
   configured, Chainalysis and OpenSanctions). A match receives the same generic refusal as a
   blocked territory (Part 4.8).
5. **Entry authorisation.** The operator's entry service issues a short-lived signed *packet*
   (valid 60 seconds) that the on-chain program requires before it will accept an entry. This is
   how steps 2–4 bind the program and not merely the website.
6. **The seven battles.** The player makes seven allocations. On their own device, before any
   payment, the seven battles plus a random *salt* are encrypted to a key generated for that pool
   and held in a custody service that refuses to export it until the pool closes. A *hash* of the
   battles is also computed.
7. **Payment and registration.** In one transaction the player pays the fixed entry price for the
   tier into the program's *treasury* account and the program records their entry: the hash of
   their battles, and a randomly drawn class for the artwork on their non-transferable *pass*. The
   program never receives the battles themselves, only the hash.
8. **The pool closes.** At the 64th entry, or when the 12-hour window ends with at least 40 seated,
   the pool seals. Anyone, not only the operator, can call the deadline seal. Below 40 at the
   deadline, every entry is refunded in full, and anyone can trigger that too.
9. **Reveal and scoring.** The custody service releases the pool key; it is published on-chain.
   The operator's settlement process decrypts every entry, checks each against the hash recorded at
   entry, scores the pool with the published engine, and publishes the complete bundle (every
   battle, every score, the ranking, the prize amounts) to permanent storage. The scoring engine is
   one TypeScript module run unchanged by the settlement process and by the public Verify page in a
   browser, so any player can recompute the result without trusting the operator.
10. **Screening and payment.** Every wallet on the payout list is screened again. A clear wallet is
    paid automatically by the program from the pool's own *vault*; there is no claim step. A
    flagged or sanctioned share is held by the program (Parts 4.4, 4.8).
11. **Review window.** If an entry was flagged by a named reviewer, the share stays held for up to
    12 hours while the reviewer decides; an undecided flag clears and the prize is paid. A separate
    seven-day permissionless release, callable by anyone, guards against the operator's own
    failure. An upheld flag passes the share to the next eligible player. There is an appeal to a
    different reviewer.

---

## Part 4 — The guardrails, each with its enforcement point

The user's eight points are 4.1–4.8; 4.9–4.12 are guardrails the code also carries that counsel
should know about. Each row of the tables cites the file that enforces it. A claim that appears
only in a document and not in code is marked as such.

### 4.1 Sixty-four seats, minimum forty

| Fact | Source |
|---|---|
| A pool has 64 seats (`CAPACITY`) and runs with at least 40 (`MIN_SEATS`); the floor is copied onto each pool at open so a later change cannot move it under seated players | `programs/blotto_cup/src/constants.rs`; `state.rs` `Pool.min_seats` |
| Below 40 at the 12-hour deadline, every entry is refunded in full; the refund is callable by anyone | `instructions/refund.rs` (`trigger_refund` refuses at or above the floor) |
| The 40-seat floor is exactly break-even for the operator at every tier (pot = 40 × entry price); the program refuses any pot larger than that | `constants.rs` (`TIER_POT_LAMPORTS` derivation); `set_tier_economics` refuses `PotExceedsMinimumField` |

Legal relevance: a large field is what makes the repetition argument in Part 2.3 real, and the
minimum field is published before entry as the format-specific obligation in PID §8.6 requires.

### 4.2 Everyone plays everyone

| Fact | Source |
|---|---|
| Battle *k* of each entry is compared with battle *k* of every other entry; no pairing, no bracket | `backend/scoring/src/engine.ts` (`compareBattle`, `scorePool`) |
| The engine is integer-only (win +2, draw +1 each); no float, no `Math.random`, no clock in the scoring path | `backend/scoring/src/engine.ts`; repo standing rule, CI-checked |
| The engine is pinned to a Python-generated oracle, so the published rule and the running code cannot diverge unnoticed | `backend/scoring/fixtures/gen_vectors.py`; `scripts/check-fixtures.sh` |

### 4.3 Seven sealed decisions per entry

The user's note describes this as "seven entries of the same game to ensure no botting or
cheating". The precise position is: each entry is seven independent allocations, and the seven
serve two purposes. For skill, they give the ranking seven decisions per player rather than one
(Part 2.3). For integrity, they give the review process seven per-screen timings and seven
allocations per player from which the five signals in 4.4 are computed. The PID's own simulation
(§4.5) chose seven as the point where skill clearly dominates within a ninety-second session.

| Fact | Source |
|---|---|
| Seven battles per entry (`BATTLES`), five attributes summing to exactly 100 | `backend/scoring/src/allocation.ts`; `app/src/battle/machine.ts` |
| The allocation invariant is enforced by the client at submission and by the scoring engine at reveal; a malformed set is scored all-losses and its status published, never halting the pool | `app/src/battle/allocation.ts`; `backend/scoring/src/allocation.ts` (`assertAllocation`); `backend/scoring/src/missing.ts` |
| Sealing: 127-byte payload (battles, salt, timings, device hash) encrypted on the device before payment to the pool's key; the key is export-locked in custody until the pool is sealed or past deadline | `backend/sealing/src/payload.ts`; `backend/sealing/src/custody-turnkey.ts`, `custody.ts` (`ExportPolicy`) |
| The program receives only `sha256(battles ‖ salt)`; entry and reveal windows are provably disjoint | `instructions/register.rs` (two arguments: `pool_id`, `battles_hash`); `reveal_commit.rs` |

Why sealing matters legally: it is what makes the identical-field claim true. If any entry could be
read before close, a later entrant could play against known allocations, and the competition would
be one of information rather than judgement. The export policy is the mechanism; since 2026-09-16
the read API serves no ciphertext at all.

### 4.4 Integrity review and sanction of bad actors

| Fact | Source |
|---|---|
| Five published signals are computed for every pool over revealed data: allocation entropy, timing profile, duplicate/near-duplicate sets, same device behind multiple entries, population-relative score | `backend/detection/src/signals.ts`; published at `app/src/copy/index.ts` `rules.detection` |
| Detection is report-only: the daemon flags nothing; a flag is a named reviewer's signed decision (`flag_entry`), routing the share to review | Founder ruling D-E9; `backend/reveal/src/main.ts` (the `detect` hook returns no auto-flags); `backend/detection/src/review.ts` |
| A flagged share is held by the program in the pool's vault; the published rule is 12 hours, after which an undecided flag clears and the prize is paid; anyone may release a held share after seven days | `instructions/escrow.rs`; `ESCROW_AUTO_RELEASE_SECS`; `rules.reviewProcess` |
| An upheld flag forfeits the share to the remaining eligible players at that rank, or to the next rank; a prize is always paid to a player and never returns to the operator | `instructions/escrow.rs` `handle_pay_next_place`; `forfeit_escrow` moves no funds (its vault account is not writable) |
| The review log is append-only, every decision signed by a registry-listed reviewer; appeals are lodged by the affected wallet within 7 days and decided by a different reviewer | `backend/detection/src/log-pg.ts`, `auth.ts`, `appeals.ts` |
| Reviewer action budget: 64 signed decisions per key per hour | `backend/detection/src/budget.ts` (D-E13) |
| One entry per wallet per pool; the four service keys can never enter | `instructions/register.rs` (`ServiceKeyCannotEnter`) |

Legal relevance: a competition that could not detect and sanction collusion or automation would
struggle to show that its results reflect skill. The design principle carried from the desk study
on tournament integrity (Part 8) is that detection must be multi-signal, published in advance,
decided by a human with an appeal, and never able to route money to the operator.

Two limits are recorded rather than hidden. The reviewer registry currently holds one member, so
the published appeal cannot yet be decided (Part 10). And multi-accounting *across* pools is
undetectable by design since device markers are per-pool; the control against it is identity
verification at payout, which is off.

### 4.5 Territory blocking

| Fact | Source |
|---|---|
| Posture is a block-list: available everywhere except fifteen country codes: AE, AU, BE, BH, CN, HK, ID, IN, KW, MY, OM, QA, SA, SG, US (schedule version 4, 2026-09-21). `US` is a country-level block standing in for the twelve states of PID §9, which cannot be enforced while the geo source resolves no region — D-B3-3 | `config/territories.json`; one row per code with its reason in `config/territories.README.md` |
| Fail-closed at every layer: an unresolvable, malformed or ambiguous location is refused; no configured geo source refuses; the client withholds the whole play flow (attestation included) until an explicit "allowed" | `backend/packet/src/territories.ts` (`territoryAllowed`); `app/src/entry/geo-gate.ts` |
| The entry service refuses to start if the schedule carries a sub-national code the location vendor cannot resolve, so a rule that cannot be applied never looks like one that is | `backend/packet/src/service.ts` (`assertRegionCapability`); `scripts/check-territories.ts` fails CI on the same condition |
| Enforcement is at entry, never at payment: a lawful entrant who later travels is still paid or refunded | `HOW-IT-WORKS.md`; the payout path carries no location check |
| The list, its version and its last-updated date are published on the rules page | `rules.availabilityUpdated` |

Why each country is there: India (the 2025 online money-games prohibition); Belgium (any chance
element); Australia ("mixed chance and skill", blocked until a specific opinion); the six Gulf
states, China, Hong Kong, Singapore, Malaysia and Indonesia (prohibition regimes in the desk
studies' Tier 0). Two rows from the product document are *not* in the schedule, for stated
reasons: the twelve US states (the vendor cannot resolve a state, see Part 10) and the sanctioned
jurisdictions (held by the founder pending counsel; wallet screening covers the individuals, which
a country code cannot).

Screening is IP-based and per-request. A route the vendor has not catalogued (some VPNs) defeats
it, and nothing binds the screened address to the wallet that later enters. The location vendor of
record is not yet contracted.

### 4.6 Age attestation

| Fact | Source |
|---|---|
| Two explicit unchecked boxes (18+ and terms at the named version) before any paid action; accept button disabled until both are ticked | `app/src` play page; step report `docs/phase-reports/step-age-clickwrap.md` |
| The wallet signs the exact sentence *"I confirm I am 18 or older and I accept the Blotto Cup terms dated …"*; the record is stored only after the signature verifies for the current terms version | `backend/_shared/src/attestation-message.ts`; `backend/packet/src/attestations.ts` |
| Entry issuance requires a record at the current version; the entry packet carries the terms version and the program refuses a packet without one; the on-chain event records it, so every entry is durably tied to an accepted version | `backend/packet/src/service.ts`; `programs/blotto_cup/src/entry_packet.rs` (`PacketTermsVersionMissing`) |
| Bumping the version re-prompts every wallet | `config/terms.json` (founder-owned) |

This is self-attestation with a signed record, not age verification by a vendor. Whether that
suffices is a jurisdiction question (Part 11). The pattern (conspicuous, unavoidable, versioned,
logged with signature and timestamp) follows the clickwrap standards in the US cases the desk
studies cite (*Berman v. Freedom Financial*, *Meyer v. Uber*, *Nguyen v. Barnes & Noble*).

### 4.7 Pre-funded prize, no percentage of a pot

This is the structural feature most likely to matter to the analysis, so the flow is set out
exactly.

| Fact | Source |
|---|---|
| Seven tiers; entry 0.1 / 0.5 / 0.75 / 1 / 2.5 / 5 / 7.5 SOL; prize 4 / 20 / 30 / 40 / 100 / 200 / 300 SOL. Only the 0.1 SOL tier is open | `constants.rs` `TIER_ENTRY_LAMPORTS`, `TIER_POT_LAMPORTS`; `Config.open_tiers` |
| The prize is a constant per tier. It is moved from the operator's treasury into the pool's own vault at `open_pool`, **before any entry is sold**. It is the same whether 40 or 64 players enter | `instructions/open_pool.rs`; register row D-A1 (revised), D-E1 |
| A tier cannot open a pool unless the treasury holds the full prize plus its policy floor | `instructions/open_pool.rs` gates; `rules.poolOpening` |
| Entries are paid 100% to the treasury; `register` cannot touch a vault | `instructions/register.rs` |
| The prize vault has exactly four exits: `pay_prizes`, `release_escrow`, `pay_next_place`, `refund` (with the pot's return to treasury on a refunded pool). There is no withdraw instruction and no admin path from a vault to the operator; CI asserts the exit set and that the escrow file cannot address the treasury | `programs/blotto_cup/src/instructions/`; `scripts/check-standing-rules.sh` |
| The operator's margin is entries received minus the fixed prize: nil at 40 seats, 37.5% of intake at 64. No percentage of anything is computed anywhere; CI greps for that arithmetic | `constants.rs` (`MIN_SEATS` doc comment); `prize_math` tests |
| The treasury's one exit (`withdraw_platform`) is multisig-gated and refused on-chain below a floor of: minimum balance + one further prize per idle open tier + every refundable entry | `instructions/treasury.rs` |
| Prizes are pushed automatically on settlement against a committed payout list; there is no claim step and no discretionary payment | `pay_prizes`; register row R10 |

What this means in the language of the cases. The operator is not a stakeholder holding the
players' money for distribution to the winner. It offers a fixed prize, announced and funded before
entry, which does not depend on the number of entrants or the fees received. The players' fees are
the price of entry, paid to the operator for the competition it runs. This is the structure the
court in *Humphrey v. Viacom* relied on in holding an entry fee not to be a wager (prizes announced
in advance and independent of the number of participants; the operator not a competitor and able
only to lose the amount offered), and the structure of the *Las Vegas Hacienda v. Gibson* line
(the person offering the prize is not a contestant). It is also the shape of the fantasy-sports
carve-out in the US federal statute (31 U.S.C. §5362(1)(E)(ix)(I): prizes "established and made
known … in advance" and not "determined by the number of participants or the amount of any fees
paid"), although that carve-out is written for sports contests and does not literally cover Blotto
Cup.

Two honest qualifications. Economically, the treasury that funds prizes is the same treasury that
receives entries, so entries fund future prizes in aggregate; the legal point is that no pool's
prize is contingent on, computed from, or increased by its own entries. And the operator cannot lose
money on a pool that runs: at 40 it breaks even and a refunding pool returns its prize to the
treasury. That is a fact about the business model, not about the players' risk, and counsel should
have it.

### 4.8 Sanctions screening before payment

| Fact | Source |
|---|---|
| At entry: every wallet is screened against the mirrored OFAC SDN list always, and Chainalysis and OpenSanctions when configured; a listed wallet is refused; a stale mirror or failed lookup refuses rather than admits; the service refuses to start with no source | `backend/sanctions/src/ofac-sdn.ts`, `composite.ts`; `backend/packet/src/sanctions-wiring.ts` |
| At resolving: every wallet on the committed payout list is screened again before the pool is paid; a match places an on-chain `sanctions_hold`, under which `pay_prizes` escrows the share instead of sending it and both release paths refuse; the entry is excluded from any next-place split; a screening that cannot answer also holds and says "unavailable" | `backend/reveal/src/winner-screening.ts`; `programs/blotto_cup/src/instructions/sanctions.rs` |
| Neither screening instruction can move funds; a held share reaches nobody and never the operator | `sanctions.rs`; `escrow.rs` |
| The verdict records list membership only; no risk score is stored | `backend/sanctions/src/seam.ts` |

Under OFAC's October 2021 guidance for the virtual currency industry, sanctions are strict
liability, geolocation and IP blocking are treated as a minimum, and blocked virtual currency must
be denied to all parties and reported. The code does the first two and the denial; the reporting of
a blocked prize to OFAC within the required period is a process obligation the operating entity
must own (Part 11). Where blocked property ultimately goes is counsel's question; nothing in the
program can move it meanwhile.

### 4.9 Class is cosmetic and is read by nothing

The one random draw in the product assigns one of five artwork classes to the entry pass, from a
finite bag of 64 per pool (counters 38 / 15 / 7 / 3 / 1), using a Switchboard VRF seed combined
with a later slot hash, replayable from published on-chain data.

| Fact | Source |
|---|---|
| `entry.class` occurs exactly once in the program: the write. There is no read anywhere in the program, the settlement process (whose Entry decoder omits the byte) or the scoring engine | `instructions/register.rs:243`; `backend/reveal/src/chain-web3.ts`; CI rule 5 in `scripts/check-standing-rules.sh` |
| The pass is permanently non-transferable: frozen at mint at collection level, and no instruction in the program can set `frozen: false` | `programs/blotto_cup/src/pass.rs` |
| The pass has no market, pays nothing, unlocks nothing, and the rarity ladder is shown on the player's profile only | `docs/CHANGE-2026-09-15_reveal-and-rarity.md` |

Legal relevance: this is the answer to the second limb of the three-element test. The desk studies
(Part 8) show that the predecessor design failed precisely because its random draw produced a
transferable item with a market value; every iteration that tried to route value back to rarity
landed in the same place. The client's rule, recorded in `CLAUDE.md` and PID §8.4, is that any
proposed class reward must answer *no* to both "would anyone pay money for this?" and "does it
improve the chance of winning?". Two founder instructions were refused on this ground and are
recorded (Part 8.3).

### 4.10 Verifiability

Every number a player is paid is recomputable by that player from published data: the pool key
and the results root are on-chain; the bundle publishes every battle, salt, score, rank and
amount; the Verify page re-runs the identical engine in the browser and compares against the
on-chain root (`app/src/verify/logic.ts`). The read API deletes and serves nothing if a fetched
bundle fails to reproduce the on-chain root (`backend/indexer/src/archive.ts`). This is what makes
the operator checkable rather than trusted, and it is the reason the client can put the skill
study in front of counsel as evidence rather than as an assertion.

### 4.11 No operator discretion over when a pool runs or whether it pays

The 64th seat or the deadline seals a pool; the deadline seal and the refund are callable by
anyone; ordinary payouts are validated on-chain against the committed list; the operator can pause
new entries but cannot stop settlement or refunds (`set_paused`). The one residual discretion is
disclosed on the rules page: at the *next* rank after a forfeit, the completeness of the group is
the settlement signer's assertion, checkable from the bundle.

### 4.12 Language and retention controls

The §8.7 lexicon and the D-B7 amendment are enforced by CI over code, comments, tests and copy.
Public copy never asserts a legal category in either direction; it describes mechanics. Retention
mechanics that a regulator associates with harm (urgency, near-miss, streak rewards, daily
bonuses) are on a do-not-build list whose vocabulary fails the build (`scripts/check-language.sh`,
`PATTERN_D3`). Notifications are opt-in, wallet-signed and factual.

---

## Part 5 — The three-element test applied

| Element | The entry pass | The competition |
|---|---|---|
| Consideration | Yes: the entry price | Yes: the same payment |
| Chance | Yes: which artwork | **No**: none in the mechanism (Parts 2, 4.2, 4.9) |
| Prize of value | **No**: non-transferable, no market, no competitive effect (4.9) | Yes: the fixed prize |

The product document (PID §8.2) presents this as two legs of one payment, each failing one
element. The 2026-09-16 compliance review recorded that this severance is the part most open to
challenge, because a player makes one payment, and that the stronger form of the same point is the
one the code supports directly: the chance element has no bearing on the prize at all. Counsel is
asked to say which framing to lead with.

---

## Part 6 — The law as the client understands it

Lay reading, for counsel to correct. Citations were checked against public sources on the date of
this brief; statutes and guidance change, and the desk studies note that several relevant
instruments were in motion in 2026.

### 6.1 United States

**Federal.** The Unlawful Internet Gambling Enforcement Act (31 U.S.C. §§5361–5367) prohibits
payment processing for "unlawful Internet gambling", which is defined by reference to the law of
the state where the bet is placed; it creates no federal definition of illegality of its own. The
Illegal Gambling Business Act (18 U.S.C. §1955) likewise requires a violation of state law. The
Wire Act has been confined to sports wagering by the First Circuit (*NH Lottery Commission v.
Rosen*, 2021). The federal analysis therefore collapses into the state analysis.

**State tests.** States apply one of three tests to a paid competition with a prize: the
*dominant factor* (or predominance) test, under which a contest is lawful if skill predominates
over chance; the *material element* test, under which any material chance element makes it
gambling; and the *any chance* test. The leading recent authorities on the predominance side are:

- *Humphrey v. Viacom*, No. 06-2768, 2007 WL 1797648 (D.N.J. June 20, 2007): a bona fide entry fee
  paid to enter a fantasy-sports contest is not a bet or wager where the prize is announced in
  advance, does not depend on the number of participants or fees, and the operator is not a
  competitor. Success depended on the entrant's skill in selecting and managing a line-up.
- *Dew-Becker v. Wu*, 2020 IL 124472: the Illinois Supreme Court adopted the predominant-factor
  test and held head-to-head daily fantasy to be a contest of skill, so the loser could not recover
  under the state's loss-recovery statute.
- *White v. Cuomo*, 38 N.Y.3d 209 (2022): the New York Court of Appeals held that the
  constitutional prohibition on "gambling" does not reach skill-based competitions in which
  participants who exercise substantial influence over the outcome are awarded pre-determined
  fixed prizes by a neutral operator, adopting the dominating-element test and rejecting the
  material-degree test. (The decision was 4–3.)
- *Las Vegas Hacienda v. Gibson*, 77 Nev. 25, 359 P.2d 85 (1961): a contest in which a party
  offers a prize to whoever accomplishes a feat is not a wager, because the offeror is not a
  contestant and can only lose the amount offered. *Morrow v. State*, 511 P.2d 127 (Alaska 1973)
  sets out a skill-dominance test requiring that participants have a distinct possibility of
  exercising skill and sufficient data to form an informed judgement.

The phrase in *White* — substantial influence over the outcome, pre-determined fixed prizes, a
neutral operator — describes Blotto Cup's structure closely, and more closely than it describes
daily fantasy, because Blotto Cup has no external event.

**Restrictive states.** A number of states are conventionally excluded by pay-to-enter skill
platforms because their statutes or attorney-general positions capture contests with any chance
element or restrict entry-fee contests specifically. The largest such platform currently excludes
Arizona, Arkansas, Connecticut, Delaware, Louisiana, Montana, South Carolina, South Dakota and
Tennessee, with card-game restrictions in Indiana and Maine; the product document's list adds
Maryland and Vermont and marks the set "verify". Washington State makes online gambling a player-
side felony and its courts have taken a broad view of "thing of value" (*Kater v. Churchill
Downs*, 886 F.3d 784 (9th Cir. 2018)). The client's intention is to block all of these; the
software cannot yet do so (Part 10).

**Sweepstakes statutes.** Several states enacted function-based prohibitions on "sweepstakes
casinos" in 2025–26 (dual currency, simulated gambling, prizes of value). Blotto Cup has no free
entry route, no dual currency and no simulated casino game, and the client's vocabulary rules
forbid the words *promotional* and *sweepstakes* precisely to keep the product out of that box.
Counsel should confirm these statutes do not reach a paid skill competition.

### 6.2 United Kingdom

The Gambling Act 2005 defines gambling as gaming, betting or a lottery (s.3), and s.339 provides
that participating in a competition or other arrangement under which a person may win a prize is
not gambling unless it is one of those three. The client's reading:

- **Not gaming** (s.6). Gaming is playing a game of chance for a prize. "Game of chance" includes a
  game involving both chance and skill (s.6(2)(a)) and a game whose chance element can be
  eliminated by superlative skill (s.6(2)(b)). Blotto Cup has no chance element in the game at all;
  the only uncertainty is other players' decisions (Part 2.5). This is the point on which the UK
  analysis turns and the one on which the client most wants a view.
- **Not betting** (s.9). No participant bets on the outcome of an event; each is a competitor in
  it. (Note that UK daily-fantasy operators are treated as pool betting because their contests
  turn on real sporting events; that route does not describe Blotto Cup and the fantasy analogy in
  PID §8.3 should not be pressed in Great Britain.)
- **Not a lottery** (s.14). A lottery requires that prizes be allocated by a process relying
  wholly on chance. Under s.14(5) a process requiring skill or judgement is treated as relying
  wholly on chance only if that requirement cannot reasonably be expected to prevent a significant
  proportion of participants from receiving a prize, and cannot reasonably be expected to deter a
  significant proportion of would-be participants from entering. The Gambling Commission's guidance
  on prize competitions says organisers should be able to demonstrate that they had reason to
  believe the skill element would eliminate a significant proportion, and that it is likely to be
  satisfied by material showing steps taken to estimate that proportion. The skill study (Part
  2.4) is that material: random or unconsidered entrants receive a prize 0.000% of the time.

The client's own compliance review put it this way: under the s.14 test, "entrants who allocate at
random place first 0.000% of the time" is close to an ideal fact. Counsel is asked whether the
Commission would accept the identical-field, all-versus-all structure as a competition of skill or
would regard a single-winner, paid-entry, multi-entrant format as a lottery with a skill veneer.

### 6.3 European Union and other markets the schedule leaves open

The schedule blocks fifteen countries and opens everywhere else. The product document lists the
UK, the remaining US states, Germany, France, the Nordics, Ireland, the Netherlands, Spain, Italy,
Canada ex-Ontario, Brazil, Mexico, Colombia, Chile, Japan and South Korea as "open subject to
counsel confirmation". That confirmation has not been given, and a lay reading suggests several of
those markets regulate paid skill competitions with cash prizes irrespective of the chance question:

- **Spain.** The definition of "juego" in Ley 13/2011 art. 3 expressly covers activities in which
  money is risked on uncertain future outcomes *regardless of whether the players' skill
  predominates*. (Verify; if correct, Spain requires a licence and should be blocked.)
- **Italy.** Remote skill games with cash prizes ("giochi di abilità a distanza con vincita in
  denaro") are a licensed category administered by ADM. (Verify; if correct, block.)
- **France.** The 2014 consumer law extended the lottery prohibition in the Code de la sécurité
  intérieure to games requiring a financial stake whose operation rests on the player's skill.
  (Verify; if correct, block.)
- **Germany.** The 2021 State Treaty defines a game of chance as one where the decision on winning
  depends wholly or predominantly on chance; pure skill competitions fall outside. (Predominance
  test; the Part 2 argument applies.)
- **Netherlands.** The Betting and Gaming Act reaches arrangements where winners are designated by
  a determination of chance over which participants generally cannot exercise a predominant
  influence. (Predominant-influence test; the Part 2 argument applies, with caution.)
- **Canada ex-Ontario.** The Criminal Code captures games of "mixed chance and skill" played for
  stakes; the case law takes a broad view of chance. (Caution.)
- **Japan and South Korea.** Marked "verify" in the product document; South Korea's game
  legislation restricts cash-prize games broadly. (Caution.)

The recommendation to the founder, recorded here so counsel sees it, is to move Spain, Italy and
France to the block-list now and to reopen any of them only on a written opinion. The schedule is a
one-line configuration change and the block is enforceable today.

### 6.4 Belgium and Australia

Blocked, and correctly so on the client's reading. Belgium's Gaming Act of 7 May 1999 defines a
game of chance as one in which a stake is committed and chance is a factor "even if only
ancillary"; the strategic-uncertainty argument in Part 2.5 is not one the client wishes to test
there. Australia's Interactive Gambling Act 2001 s.4 captures a game "of chance or of mixed chance
and skill" played for money; commentary reads "mixed" as requiring chance to be a dominant or
governing element, which would favour the client, but the regulator's tools (ISP blocking,
director movement-alert listing) make Australia a market to enter only on a specific opinion.

### 6.5 India and the prohibition regimes

India's 2025 online money-games legislation prohibits all online money games irrespective of
skill, reaching offshore operators, payments and promotion; it is blocked. China, Hong Kong,
Singapore, Malaysia, Indonesia and the Gulf states are blocked as prohibition regimes.

---

## Part 7 — The cryptocurrency perimeter

The product takes SOL from the public and pays SOL to the public. Whatever the answer to Part 6,
this raises questions the desk studies flagged and the compliance review of 2026-09-16 recorded as
unexamined. What the code does, and the lay reading, follow.

**Money transmission.** FinCEN's 2019 guidance (FIN-2019-G001) treats persons who accept and
transmit convertible virtual currency as money transmitters unless an exemption applies, including
the exemption for a person who accepts and transmits funds only integral to the provision of a
service other than money transmission (31 C.F.R. §1010.100(ff)(5)(ii)(F)). The client's position is
that it sells entry to a competition and pays a prize from its own pre-funded treasury; it does not
hold one player's money for transmission to another, does not exchange currencies, does not
custody player wallets, and enables no fiat funding route (the app degrades to "send SOL to this
address"). The refund path returns a player's own payment to the wallet it came from. Counsel is
asked whether this is outside federal and state money-transmitter regimes, and whether the
pre-funded structure helps.

**Sanctions.** Part 4.8. A US operating entity would be a US person for OFAC purposes in any event.

**Securities.** The pass is non-transferable, has no market and pays nothing; no token is issued;
there is no platform-run market. The desk studies (Part 8) record that the predecessor's
transferable token and captive marketplace were its securities exposure and that removing them was
the design response. SOL itself is treated as a digital commodity in the March 2026 SEC/CFTC
interpretive release the desk studies cite (verify).

**Tax.** Prizes are income to recipients; the rules page should say so. For a US payer, prizes of
$2,000 or more per recipient per year (the 2026 threshold, raised from $600 by the 2025 federal tax
legislation, with indexing from 2027) are reportable on Form 1099-MISC, which requires a taxpayer
identification number, and backup withholding applies where none is provided. At the 0.1 SOL tier
the prize is 4 SOL; at the 7.5 SOL tier it is 300 SOL. Identity collection at payout is not built
and the identity switch is off (Part 10). This is a concrete reason the higher tiers are gated on
counsel.

**Anti-money-laundering programme.** The code has excellent controls (screening at both ends,
refusal on failure, an append-only log) and no programme around them: no risk assessment, no
nominated officer, no suspicious-activity reporting, no retention policy. Whether a programme is
required depends on the entity's classification (above).

**Data.** The product holds wallet addresses, a location verdict per entry, signed attestation
records, sealed payloads (with per-screen timings and a per-pool device marker that is not
published and has no public reader since 2026-09-16), and behavioural signals used in decisions
that can withhold a prize. Under the EDPB's 2025 guidelines wallet addresses may be personal data.
No privacy notice or DPIA exists yet (Part 10).

---

## Part 8 — The prior desk studies, and how the design answered them

All are internal, written by a non-lawyer, and stored in the client's Drive library (folder
`.fun Legal Advisor`). They are listed so counsel can see the reasoning history, and so that a
reader coming across them understands what they describe.

### 8.1 What they are

| Date | Document | Subject |
|---|---|---|
| 2026-08-24 | *Product-Legal-Analysis* | The predecessor product ("Anarchy.fun"): a paid random draw producing a transferable NFT with a platform-run market. Concluded it was gambling under the UK, US, Australian and Belgian tests, raised securities and money-transmission issues, and could not be operated from the Dubai FZCO |
| 2026-08-24 | *LEGAL-OPINION_Proposed-Architecture* | A flat-price redesign of the predecessor. Concluded it remained a licensable chance product, that a Curaçao licence would be required, and that the tournament attached to it was a promotional prize competition only if free to enter |
| 2026-08-24 | *Tournament-Integrity-and-Prize-Settlement v3* | Why a competition of skill needs sample size, published detection criteria, a human review and an appeal; the origin of the integrity design in Part 4.4 |
| 2026-08-24 | *HUB-01 to HUB-05* (authorities) and *CASE-INDEX* | Jurisdiction-by-jurisdiction survey; the three-element test and the four ways out of it; the loot-box, social-casino, NFT and sanctions case law |
| 2026-08-24 | *PLAYBOOK_Company-Structure-Licensing-Compliance*; *DRAFT_Restricted-Territory-Clauses* | Entity structure for a licensed chance product; draft territory, eligibility and enforcement clauses |
| 2026-08-26 | *PRD_Blotto-Cup v0.2*; then *PID_Blotto-Cup v0.5* (2026-08-26, in the repository) | The pivot: "the other fork: rarity's economic weight traded for the UK, most of Europe and most of the US without a licence" |

The predecessor documents contain candid language about that design. They describe a product that
was never launched and that the client abandoned on the strength of its own analysis. Counsel may
wish to receive them through privileged channels; the client should not circulate them otherwise.

### 8.2 The four ways out, and which one Blotto Cup takes

HUB-02 §0 records that a random-reward product escapes the consideration-chance-prize test in
exactly four ways: no consideration; predominance of skill; no prize of value; or integration into
a skill game bought for in-game use. The predecessor could take none of them. Blotto Cup is built
to take the second (the competition) and the third (the pass) at once: the prize is won by skill,
and the only thing chance touches has no value. Each feature of the predecessor that the desk
studies identified as the problem was removed, not reframed: the transferable prize, the
platform-run market, the per-user undisclosed odds, the blockhash randomness, the creator revenue
share, the treasury rewards to traders, and the second wagering pool.

### 8.3 Two refusals the record carries

The compliance review of 2026-09-16 records two founder instructions that were refused on legal-
position grounds, and the founder's acceptance of each:

- **The rarity caveat (2026-09-14).** Proposed wording: *"this rarity means nothing right now, but
  it might mean something in the future."* Refused, because pay a fee, receive a random outcome,
  the outcome may carry value later is the structure a regulator looks at. Safe wording adopted.
- **The timeout (R9).** The founder's first instinct was to randomise an unfinished allocation when
  the timer expires. Refused, because it would insert chance into the scoring mechanism. Unlocked
  battles enter as the even split, whose effect is published as how it performs.

These are recorded because they show the rule in Part 4.9 operating against commercial pressure,
which is what a regulator asking "is class really cosmetic?" will want to see.

---

## Part 9 — The operating entity

### 9.1 The plan

A Delaware LLC, wholly separate from T Block Labs FZCO (Dubai), to operate Blotto Cup.

### 9.2 Recommendation

A Delaware entity is a defensible choice **if and only if the United States is a market the client
intends to serve and can block state by state**. If the US is to be blocked at country level, a
Delaware entity brings the whole product under US federal and state jurisdiction for no commercial
benefit, and a UK or Irish company would be the more natural home for a competition whose largest
open market is Great Britain.

On the assumption that the US is served, the points for counsel:

1. **Form and tax.** A single-member LLC owned by a non-US individual is disregarded for US tax and
   makes its owner personally engaged in a US trade or business, with US filing obligations and a
   Form 5472 requirement. A corporation, or an LLC electing corporate treatment, contains that. US
   tax advice is needed before formation; the choice affects the founder personally.
2. **Delaware itself is on the conventional restricted-state list** for pay-to-enter skill
   contests. Being domiciled there while refusing Delaware residents is the position of the major
   skill-gaming platforms and is not a contradiction, but counsel should confirm that a Delaware
   entity operating a paid skill competition for non-Delaware residents attracts no Delaware
   registration or prohibition.
3. **Separation from the FZCO.** Gambling is a criminal offence in the UAE and paid prize
   competitions there require permits; the UAE is blocked. The FZCO should neither own the operator
   nor receive player funds. If the FZCO is to supply software or IP to the operator, UAE counsel
   should confirm the free-zone licence's activity scope permits it, and the arrangement should be
   papered at arm's length with a transfer-pricing file. The founder is UAE-resident and would
   manage the operator; UAE counsel should say whether managing a foreign paid-competition operator
   from the UAE raises any personal exposure. The desk studies raised this for the predecessor,
   where the answer was clearly adverse; for a competition of skill the client expects a different
   answer but has not obtained it.
4. **Substance.** Directors, banking and hosting outside every blocked market; hosting is
   currently EU-only (Frankfurt), which sits oddly beside a US entity serving US players and should
   be a deliberate decision.
5. **Terms.** A US-facing operator should carry the individual-arbitration, class-waiver, opt-out
   architecture that has repeatedly been enforced (the *Ridley v. Stake* line in the desk studies),
   while understanding that it offers little in UK and EU consumer forums and nothing against a
   regulator.

### 9.3 Rejected alternatives, with reasons

- **The FZCO itself.** Rejected: UAE penal exposure, permit regime for prize competitions,
  free-zone activity scope; and the desk studies' unanimous view.
- **Curaçao or another gaming licence.** Rejected as unnecessary if Part 6 holds, and undesirable
  because holding a gaming licence is itself a statement about category. It is the fallback if
  counsel concludes the product is a game of chance somewhere the client must serve.
- **Cayman or BVI holding with no operating substance.** Rejected: banking and payment-partner
  friction, and it does not remove US or UK jurisdiction over a product served there.
- **UK Ltd.** Not rejected. It is the alternative if the US is blocked, and it places the operator
  where the largest open market's regulator can see it. The founder's personal UK non-residence
  planning would need reconciling.

---

## Part 10 — What is not yet in place

Stated so that counsel advises on the product that exists. Sources: `docs/COMPLIANCE-REVIEW-2026-09-16.md`,
`docs/AUDIT-2026-09-07.md` (the live open-items list), `01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md` §9.

| Item | Status |
|---|---|
| External legal opinion | None obtained. Register row R1 (ratified 2026-08-26, reaffirmed 2026-09-16 as R1-b) records the decision to proceed at the 0.1 SOL tier on the client's own analysis with opinions pursued in parallel; one written opinion is a hard gate for the 0.5 SOL tier and above (R6). The architect recommended the opposite and it is recorded |
| Operating entity | Not formed |
| Terms of service, privacy notice, DPIA, support channel, complaints route, governing-law clause | None exist as documents. `config/terms.json` is a version ledger; the clickwrap's "the terms" links to the rules page |
| The United States | **Blocked at country level** since schedule version 4 (founder instruction 2026-09-21, register row D-B3-3). This is wider than PID §9, which names twelve states: the location vendor of record returns a subdivision *name* and never an ISO 3166-2 code, so the entry service refuses to start with any state code in the schedule, and the live choice was a schedule naming twelve states that admits all twelve or a country block that works. No US state has an opinion. The block can be narrowed to the twelve once a region-capable vendor is contracted; counsel question 6 asks whether it should be |
| Spain, Italy, France and other "open subject to confirmation" markets | Open in the software; see Part 6.3 |
| Sanctioned jurisdictions as country codes | Held by founder ruling pending counsel; wallets are screened against live lists regardless |
| Identity verification | Switch exists and is off (threshold 0). Under one paid place, any threshold below the smallest prize would hold every payout at every tier, and the seven-day permissionless release presents no identity, so switching it on needs design work first |
| Second reviewer | The registry holds one member; no appeal can be decided; no separation of duties |
| Location vendor of record; second screening vendor | Not contracted (register row D-E14 makes both a precondition of the first pool with strangers in it) |
| Mainnet | Never run; no real money has entered the program. Independent security review is scheduled after ten settled pools; the entry price is capped at 0.1 SOL until then |
| Lost-ciphertext refund | Published as a rule; executed by a manual admin transaction, not by code |
| Post-seal liveness | **Corrected 2026-09-21; version 1 named the wrong key.** The *settlement* signer is recoverable — `set_settlement_signer` rotates it under the admin authority (`lib.rs:147`, `instructions/admin.rs:154`), so losing it strands nothing. The key with no recovery is the **pool sealing key**: entries are encrypted to it on the player's own device, no instruction can rotate or replace it, and `trigger_refund` requires `PoolState::Open` (`instructions/refund.rs:70`). So a pool whose sealing key is lost *after* it seals can never be revealed, settled or refunded, and its prize and entries have no on-chain route to anyone. Refunds remain permissionless only while a pool is Open |
| PID v0.5 | Materially behind the build (it still describes sixteen paid places and an 80/20 split); a v0.6 draft exists. `01_PRODUCT_FACTS` and `AS-BUILT.md` describe the build; this brief is written from those and the code |

---

## Part 11 — Questions for counsel

1. **Category.** In Great Britain, is a paid-entry, identical-field, deterministic competition with
   no random element in its mechanism outside "gaming" (s.6), "betting" (s.9) and "lottery" (s.14,
   applying s.14(5)) of the Gambling Act 2005, on the evidence in Part 2.4? In the United States,
   under the predominance test, is it a bona fide contest of skill on the *Humphrey* /
   *Dew-Becker* / *White* reasoning, and which states must be excluded under material-element or
   any-chance tests?
2. **Strategic uncertainty.** Does uncertainty about other entrants' decisions constitute "chance"
   in any of the named jurisdictions, given there is no random process in the game (Part 2.5)?
3. **The pre-funded fixed prize.** Is the structure in Part 4.7 material to the analysis, and does
   it matter that the operator's treasury both receives entries and funds future prizes?
4. **The pass.** Does a randomly assigned, non-transferable, valueless artwork class attached to the
   entry pass create a chance element in any jurisdiction, and is the two-leg framing in Part 5 or
   the "read by nothing" framing the one to lead with?
5. **Age.** Is wallet-signed self-attestation of age sufficient, and where is vendor verification
   required before payment or before a prize?
6. **Territories.** Should Spain, Italy and France be blocked (Part 6.3)? Should the US be blocked
   at country level until state blocking is enforceable? Which sanctioned-jurisdiction codes should
   be added to the schedule?
7. **Money transmission and AML.** Is the operator outside FinCEN's and the states' money-
   transmitter regimes on the facts in Part 7? What AML programme, if any, is required, and what are
   the OFAC reporting obligations when a prize is held under a sanctions match?
8. **Tax.** Confirm the 1099-MISC position and what identity collection is required at which prize
   size; advise on the entity's tax form.
9. **Entity.** Delaware LLC versus a corporation versus a UK company, on the facts in Part 9;
   the FZCO's permitted role; the founder's personal position as a UAE-resident manager.
10. **Detection and forfeiture.** Are the published detection criteria, the 12-hour hold, the
    passing of a forfeited share to the next eligible player and the appeal to a different
    reviewer sufficient to support a forfeiture against an unfair-terms challenge?
11. **Documents.** Terms of service, privacy notice, complaints and dispute route, governing law,
    limitation of liability: what is required before the first pool with strangers in it.

---

## Annex A — Glossary for a reader new to blockchains

- **Solana.** A public blockchain: a shared ledger maintained by many independent computers, on
  which programs run and balances are recorded. Nobody, the operator included, can alter a recorded
  transaction after the fact.
- **SOL.** Solana's native currency, in which entries are paid and prizes are paid. One SOL is one
  billion *lamports*; every amount in the program is an integer in lamports.
- **Wallet.** A key pair. The public half is an address (like an account number); the private half
  signs transactions and messages. In Blotto Cup a player's wallet is either one they already hold
  or one created for them by the sign-in provider.
- **Program.** The on-chain code (here written in Rust with the Anchor framework). Its instructions
  are the only ways to change the accounts it controls. The full set of instructions is public and
  can be audited; the absence of an instruction (for example, a withdrawal from the prize vault) is
  a provable fact about the program, not a policy.
- **PDA / account.** A storage location on the chain controlled by the program. The *treasury*
  (where entries are paid) and each pool's *vault* (where its prize sits) are such accounts.
- **Multisig.** A wallet that requires several named signers to act. The operator's treasury
  withdrawal and program upgrades are meant to require one (Squads); the custody disclosure page
  publishes the current signer count and delay.
- **Hash.** A fixed-length fingerprint of data. Recording the hash of a player's battles at entry
  commits them without revealing them; any later change would not match.
- **Sealing / encryption to the pool key.** The battles are encrypted on the player's device with a
  key generated for the pool; the matching secret is held in a custody service (Turnkey) under a
  policy that refuses to export it until the pool is closed. Publishing the secret afterwards lets
  everyone decrypt every entry.
- **VRF.** A verifiable random function: a source of randomness whose output comes with a proof
  that it was not chosen. Used here only for the pass artwork.
- **Permissionless.** An instruction anyone may call, not only the operator; used for the deadline
  seal, the refund and the seven-day release, so that those outcomes never depend on the operator
  being present or willing.
- **Bundle / permanent storage.** The published results file for a pool, written to a permanent
  storage network (Irys) so it cannot be quietly changed or removed.

## Annex B — Source map

| Subject | Canonical file |
|---|---|
| Every product fact with its code citation | `01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md` |
| The mechanism without code, one page | `docs/HOW-IT-WORKS.md` |
| What the system is | `docs/AS-BUILT.md` |
| Program constants | `programs/blotto_cup/src/constants.rs` |
| Instruction set and vault exits | `programs/blotto_cup/src/instructions/`; `scripts/check-standing-rules.sh` |
| Scoring engine | `backend/scoring/src/engine.ts`, `allocation.ts`, `prizes.ts` |
| Skill study | `docs/skill-evidence/REPORT.md` (regenerate: `cd tests/rehearsal && npm run skill-evidence`) |
| Territory schedule and legend | `config/territories.json`; `config/territories.README.md` |
| Terms version ledger | `config/terms.json` |
| Sanctions | `backend/sanctions/`; `backend/reveal/src/winner-screening.ts`; `programs/blotto_cup/src/instructions/sanctions.rs` |
| Detection and review | `backend/detection/src/`; `backend/reveal/src/main.ts` |
| Published rules copy | `app/src/copy/index.ts` (`rules.*`) |
| The 2026-09-16 review of code against every legal claim | `docs/COMPLIANCE-REVIEW-2026-09-16.md` |
| Live open items | `docs/AUDIT-2026-09-07.md` |
| Ratified decisions (R1–R21, D-A…D-E) | `docs/BUILD-ROADMAP_v1.0.md` |
| Product intent and the founder's own legal brief (§8) | `docs/PID_Blotto-Cup_v0.5.md` |

*Maintenance rule: this brief restates facts whose sources are the files above. When a source
changes, this brief changes in the same change set or the claim comes out. A later brief for a
later commit gets its own file; this one is dated by design.*
