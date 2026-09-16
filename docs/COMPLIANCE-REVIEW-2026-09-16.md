# Compliance and fairness review — 2026-09-16

**What this document is.** A review of the code as built against every document in this repository
that makes a legal claim: `PID_Blotto-Cup_v0.5.md` §8–§10 and its 2026-09-13 appendix, the v0.6
draft, `../01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md`, the territory, terms and custody
configs, both audits, the ratified register in `BUILD-ROADMAP_v1.0.md`, and the copy a player
actually reads. It was commissioned by the founder on 2026-09-16 with one question: how close are
we to launching a lawful, checkable competition of skill, and where do we stand on the licensing,
cryptocurrency and online-gaming questions.

**Dated by design.** It reviews one branch head — `3cd0ec7`, before the changes of 2026-09-16 that
answered part of it (§6). It is canonical for nothing except its own findings. A later review gets
its own file and this one becomes history.

**Reconciled with `main` before it was filed.** `main` moved to `0d9beafc` (PR #134) while this was
being written, and that change deleted code three findings cite. Rather than quietly rewrite the
findings, each one states what was true at `3cd0ec7` and then what #134 did about it — the same
treatment `internal-review.md` IR-3 gets. A review whose subject is documents describing code the
project stopped running does not get to be one.

**It does not replace `AUDIT-2026-09-07.md`.** That document's Open Items and Road to Mainnet
remain the live lists, as `INDEX.md` says. Where this review finds something already on them — the
second reviewer (O24), the upgrade authority (O5), the skill evidence restatement (O13) — it points
at them rather than restating, per `INDEX.md` rule 3.

**This is not legal advice, and neither is PID §8.** That section opens with the founder's own
line: *"§8–10 are a brief for counsel by a non-lawyer."* What follows is an engineering assessment
of whether the software does what our documents say it does, and of where those documents make
claims nobody qualified has checked. It cannot and does not say whether any of it is lawful
anywhere.

**Written to the §8.7 lexicon**, like every other live document here and for the same reason
(D-B7: naming a category is a claim about it rather than a description of the mechanism). Where
this review would otherwise name a legal category or a statute, it describes the test instead and
points at PID §8, which owns that language. `HOW-IT-WORKS.md` is written under the same constraint
and is the document `INDEX.md` marks as safe to hand to counsel.

---

## 1. The headline

| | Verdict |
|---|---|
| **Results a player can recompute** | Substantially built and independently checkable. Two real holes — §4.4. |
| **The mechanism as a contest of skill** | The strongest part of the build. Ten hard invariants hold, and hold in CI rather than on trust. |
| **Ready to operate for money** | **Not started.** No legal advice, no operating entity, no terms document, no privacy notice, no support channel, and the United States is entirely open. |

The engineering half of this product is in unusually good shape. The legal half has essentially not
begun. The distance between the two is the whole of the risk.

---

## 2. R1, and why it frames everything else

The project had already decided to launch without an opinion, and the conflict was recorded at the
time. `BUILD-ROADMAP_v1.0.md` R1, ratified 2026-08-26:

> **R1** — *"Launch on own analysis in a clearly-open market; counsel opinions pursued in parallel,
> not as a gate."* ⚠ *"Conflicts with PID C1 ('blocks launch') and with the stated goal of full
> compliance. Counsel remains a critical-path item in Phase 6 and a hard gate for the 0.5 SOL tier
> and above (see R6)."*

So the absence of an opinion is a decision, not an oversight. Two things follow.

**The rule and the document disagreed.** `HOW-IT-WORKS.md` — written expressly for *"counsel, an
adviser, a candidate"* — told them that going to the main network *"waits on counsel sign-off."* R1
says it does not. Both were live until 2026-09-16. **Resolved by register row R1-b** (founder
ruling, 2026-09-16): R1 stands, and the document was amended to state the position plainly rather
than go silent on it. The row carries the architect's contrary recommendation and one consequence
left deliberately open; read the row, not this summary.

**R1 was ratified against a different product.** It predates the change to one paid place (D-E2),
the fixed pre-funded pots of 4–300 SOL (D-E1), and a schedule that blocks fourteen countries and
opens everywhere else. Register row **D-B3-2** carries its own unresolved flag about exactly that:
*"Counsel has not reviewed the open-to-everywhere posture; R1's counsel engagement should confirm
it before mainnet."*

---

## 3. What holds

Verified against source, not taken from the documents. Ten hard invariants, all holding.

1. **The prize vault cannot pay the operator.** Four lamport exits — `pay_prizes`,
   `release_escrow`, `pay_next_place`, `refund` (with `trigger_refund`'s pot return). Three end at a
   wallet pinned to an `Entry.player`; the fourth at the treasury PDA by seed derivation. No
   withdraw instruction, no admin escape hatch, no recover-stuck-funds path, and **no `set_admin`**
   — the admin key is written once at `instructions/admin.rs:71` and cannot be escalated.
   `vault.rs` is the only file that may call `system_program::transfer`.
2. **`forfeit_escrow` moves nothing.** Its `vault` account is declared without `mut`
   (`instructions/escrow.rs:186-189`), so the runtime itself would refuse a balance change. The
   only consumer of a forfeited share is `pay_next_place`, which pays players.
3. **`escrow.rs` cannot address the treasury at all** — no `PLATFORM_SEED`, no `platform_debit`, no
   account named `platform`. Verified by search, not by comment.
4. **Class is cosmetic, provably.** `entry.class` occurs **exactly once in the program: the write**
   (`instructions/register.rs:243`). There is no read anywhere. The settlement crank's own Entry
   decoder omits the class byte (`backend/reveal/src/chain-web3.ts:492-520`), so it never holds the
   value, and `backend/scoring/` has no case-insensitive match for the word at all.
5. **The program never sees an allocation.** `register` takes two arguments: `pool_id` and
   `battles_hash`. And the entry window and the reveal window are **provably disjoint** —
   `register` requires `state == Open && now <= fill_deadline`, `reveal_pool_secret` requires the
   complement, and `fill_deadline` is written once at `open_pool.rs:193` and rewritten nowhere. No
   secret can be on chain while an entry can still land.
6. **The pass cannot be unfrozen.** `frozen: false` appears nowhere; no `UpdatePluginV1`, no
   `TransferV1`, no burn, no revoke. The freeze sits at collection level with the Pool PDA — never
   a person — as update authority.
7. **Integer-only money.** No floats anywhere in `programs/`; `overflow-checks = true` at the
   workspace root; `unsafe_code = "forbid"`; `u128` intermediates on every product; and every
   indivisible remainder disposed of explicitly. The last payment of a forfeited share **must empty
   it exactly** (`escrow.rs:501-508`) or the call is refused.
8. **Six PDA types, six distinct seed prefixes**, pinned by a test that derives all six from
   related inputs and asserts the addresses differ (`state.rs:453-471`).
9. **Refunds are permissionless on both halves** and program-held: entries land in the treasury and
   are tracked in `Config.platform_refundable`, which both the withdrawal floor and the
   pool-opening gate subtract.
10. **The gate is real and self-testing.** `scripts/check-standing-rules.sh` runs ten sub-checks —
    including a function-body extractor requiring every `vault_debit`/`platform_debit` call to sit
    inside one of seven named `file:fn` pairs — builds a probe tree violating all ten, and **exits
    2 if it fails to catch them.** It runs on every proposed change.

### The contest, and the evidence for it

- **No chance decides any result.** Ranking is score then zones; ties share a competition rank and
  split the combined prize; entry index breaks no rank — it fixes published leaf order and takes an
  indivisible remainder of a few lamports, nothing more.
- **Half-points are integers.** Win `+2`, draw `+1` each. Display code divides; the engine never
  does. No float, no `Math.random`, no `Date.now` in the scoring path.
- **The measured evidence is strong and reproducible.** `skill-evidence/REPORT.md`: entrants who
  allocate at random, and entrants who leave the opening even split untouched, place first
  **0.000%** of the time — and the report shows why this is structural rather than statistical, a
  flat split losing three stats to two by construction against any three-stat concentration.
  Considered play reaches 5.16% at 64 seats against a 1.5625% everyone-equal baseline, and 8.15%
  against 2.50% at 40. Regenerated nightly in CI, which fails on drift.
- **One engine, two runtimes, genuinely.** The crank and the browser import the same
  `backend/scoring/src`. A test bundles it for the browser with `require`, `process` and `Buffer`
  forced `undefined` and reproduces a Python-computed root.
- **The fixtures are an independent oracle.** `backend/scoring/fixtures/gen_vectors.py` is a
  separate implementation of the scoring rule in Python, not a capture of our own output, and
  `check-fixtures.sh` fails on drift.
- **The read API fails closed where it matters.** `/leaderboard` recomputes the results root from
  the fetched bundle and, on a mismatch, **deletes the rankings and serves nothing**
  (`backend/indexer/src/archive.ts:115-180`). At `3cd0ec7` this section also credited
  `/sealed-entries` with returning 403 until the secret was on chain; **PR #134 went further on
  2026-09-16 and removed the route altogether** — the sealed boxes now have no public reader at any
  point in a pool's life, before or after the reveal. The stronger fact replaces the weaker one.
- **Sealing is sound, and both leaks found on 2026-09-13 are closed.** The export policy is chain
  state read fresh per export, off the **Clock sysvar** rather than host wall-clock. The ciphertext
  route is authorised: the pool must be Open, the submission carries the player's own signature over
  `pool ‖ player ‖ digest`, and a differing second write is refused rather than overwritten.
- **Screening runs at both ends** — every entrant at the gate, every winning wallet before payment
  — across three sources, and a screening that **cannot answer holds the payment** rather than
  paying unchecked. Neither screening instruction moves a lamport. With nothing configured the
  services refuse to start.

### Two refusals worth recording

Both are places where the legal position was protected against a founder instruction, and both are
the reason §8.4 and §8.3 still hold.

- **2026-09-14, the rarity caveat.** The founder asked for wording reading *"this rarity means
  nothing right now, but it might mean something in the future."* The second half was flagged and
  not built, on the ground that pay a fee → receive a random outcome → the outcome may carry value
  later is the structure a regulator looks at, and it would put that in writing on the screen a
  player reads after paying. The founder accepted the safe wording the same day.
  (`CHANGE-2026-09-15_reveal-and-rarity.md` §4.)
- **R9, the timeout.** The founder's first instinct was to randomise an unfinished allocation when
  the clock expires. Rejected, because it would insert chance into the scoring mechanism and break
  §8.3. Unlocked battles enter as the even split, whose effect is published as how it performs and
  never as a chance of anything (R9-b).

---

## 4. What does not hold

### 4.1 The legal work has not started

| Item | PID says | Actual |
|---|---|---|
| **C1** — counsel opinions on §8.2/§8.3 | Blocks launch | **Not started.** Set aside by R1 for tier 0; still a hard gate for tier 1 (R6) |
| **D6** — operating entity | Founder-owned | **Open.** No jurisdiction chosen, so no regulator, licensing regime, tax treatment or money-laundering obligation is even identified |
| **C10** — DPIA and privacy notice | Blocks launch | **Not built.** No DPIA, no privacy notice, no `/privacy` route. The v0.6 draft said "Built" until 2026-09-16 |
| **Terms of service** | Roadmap 6.3 | **Does not exist as a document.** `config/terms.json` is a version ledger with no text; the clickwrap's "the terms" links to `/rules` |
| **C11** — prompt blocklist for class art | Blocks launch | Not started; deferred with no art vendor at launch |
| **C2** — geolocation vendor of record | Blocks launch | Gate built and the source is real; **the vendor of record is not contracted** and the second slot is an empty seam |
| **D-E14** — second geography and screening vendor | Ratified: *"before the first pool with strangers in it"* | **Open — procurement** |

There is **no external legal advice anywhere in this repository** — no memo, no opinion, no firm,
no dated engagement output. The nearest thing is one second-hand clause in the register (D-E7 item
3) reporting a reading attributed to counsel, with no source, date or name. Two documents the
repository cites, `COUNSEL-STANDING-RULES_v2.md` and `00_READ_FIRST/HUB-06`, have never existed
here (O21).

### 4.2 The United States is entirely open

`config/territories.json` (schedule version 3) blocks fourteen country codes: AE, AU, BE, BH, CN,
HK, ID, IN, KW, MY, OM, QA, SA, SG.

PID §9 also blocks Washington State and eleven further US states, and opens the remaining ~39 only
*"subject to counsel confirmation of §8.3."* **None of the United States is blocked in the
software.**

The engineering reason is honest and now mechanical: the geo source reports `resolvesRegion =
false` (`backend/packet/src/geo-iplocate.ts:123`), so `assertRegionCapability` refuses to start the
entry service with any sub-national code in the schedule, `issuePacket` refuses the individual
entry as a second line, and `scripts/check-territories.ts` fails the build. That is the right
behaviour — `config/territories.README.md` puts it as *"a rule that cannot be applied must not look
like one that is"* — and the alternative, a schedule naming twelve states and admitting every one
of them silently, would be far worse.

What it leaves is a commercial position: open to all fifty states with no opinion on any of them.
It also sits oddly beside the hosting posture, which is deliberately EU-only (`deploy/fly/*.toml`,
Frankfurt, *"never US"*). One decision avoids a US footprint; the other invites US players.

Two further limits, both self-declared in the code rather than found: screening is **IP-only and
per-request**, so a network route the vendor has not catalogued defeats it and nothing binds the
screened address to the wallet that later enters; and there is no device or payment second signal.

The **sanctioned-jurisdictions** row is held deliberately (founder ruling 2026-09-13, that a
guessed list must not be merged) and holding it opens nothing, because wallets are screened against
live lists on every entry. That one is sound as it stands.

### 4.3 Five published claims outran the code

Our own standard is that a published promise must be true. Five were not. Three were fixed the same
day (§6); two remain and are listed in §7.

1. **The landing page** stated the wrong minimum field — `app/src/copy/index.ts:428`, *"at least
   fifty-two seated"*, where R7-b moved it to 40 on 2026-09-12.
2. **The screen a player reads immediately after paying** stated it too — `:344`, the sealed panel.
   PID §8.6 requires the fill deadline and the refund rule to be stated accurately and stated
   *before* payment; a player told "below 52 refunds" who then watches a 41-seat pool play has been
   told the wrong rule at the worst moment.
3. **The skill exhibit was mislabelled** — `:460` headed its second column *"First place, 52
   seats"* over data computed at 40. The configuration derived the number correctly; only the
   heading was missed.
4. **Half of detection signal 4 did not run.** The rules page published *"the same device or
   network origin behind multiple entries in one pool."* At `3cd0ec7`,
   `backend/reveal/src/main.ts:420` passed `ipHash: ''` for every entry and `deviceIpCorrelation`
   skipped an empty key, so the network half correlated nothing and never could.
   **Resolved twice over, independently, on 2026-09-16.** PR #134 deleted the `ipHash` input and the
   IP-correlation branch from the code (`backend/detection/src/signals.ts` keeps only a note where
   they were); this branch narrowed the published sentence to the device half. Both were needed:
   #134 removed the dead code and left the claim describing it, and the claim is what a player
   reads. `backend/reveal/src/main.ts:420` now carries `deviceHash`, which still reaches detection
   through the non-published `forDetection` channel.
5. **The lost-ciphertext refund is a promise with no code path.** `backend/reveal/src/crank.ts:30-60`
   says so in capitals: *"The published rule says that player's entry fee is refunded. NOTHING
   IN THIS CODEBASE PAYS IT."* The remedy is one manual admin
   transaction per affected player; the alert and the bundle are the only ledger. This is a promise
   to give money back, executed by hand.

**The systemic cause of 1–3** was that eleven self-testing gates existed and none looked at the
words on the screen. `check-mirrors.py` pinned the Rust constants to their TypeScript mirror and
`mirror.spec.ts` pinned them from the other side, so the constants could not disagree with each
other — but nothing pinned either to the copy describing them. The constant moved on 2026-09-12,
the copy file was edited on 2026-09-15, and the whole lane stayed green.

### 4.4 Two holes in what a player can recompute

The answer to *can a player recompute their own score and the winner's from published data* is
**yes** — `app/src/verify/logic.ts` demonstrates the full chain in the browser with no wallet
connected: secret commitment, then each entry's `sha256(battles‖salt)` against the on-chain hash,
then rescore, then rebuild the tree, then compare against **the on-chain root** (the bundle's own
copy is explicitly informational), then committed payouts, then settled payouts. These two items
are about whether that stays true when the operator is unhelpful or absent.

1. **The scoring function that actually runs has no independent vector.** `scorePool` is
   Python-vectored, but neither the crank nor the verify page calls it. Both call
   `scoreWithMissing`, which lives outside `backend/scoring/` at `backend/reveal/src/missing.ts:39`.
   It has **no Python oracle vector** — `gen_vectors.py` contains no case for a missing entry — and
   its only tests are TypeScript assertions captured from our own output, which is the thing
   `CLAUDE.md` forbids on the ground that it proves nothing. It also carries a **second,
   hand-written copy of the competition-rank grouping**, so there are two implementations of the
   published ranking rule and only one is oracle-checked. And it sits outside the browser-bundle
   test, which covers only `backend/scoring/src/index.ts`. The published all-losses arithmetic is
   load-bearing on **every real settlement** and is proven by nothing independent.
2. **The published bundle's location is not on chain.** No event carries a bundle URI and there is
   no `BundlePublished` event. The URI lives in our `published_bundles` table and is served by our
   own API, and publication is best-effort — a failure is caught and recorded without stopping
   settlement. A player's fallbacks are the permanent-storage tags the crank writes (workable, and
   documented to nobody). At `3cd0ec7` there was a second fallback, `/sealed-entries` plus the
   revealed secret; **PR #134 removed that route on 2026-09-16**, on privacy grounds, which is the
   right call and which also narrows a player's options to the bundle alone. The data is checkable;
   *finding* it depends on us, now more than when this was written.

### 4.5 §8's own evidence describes a product we stopped building

- **§8.3** cites the §4.5 simulation — *"best player 44%"*, *"paid 16 who are genuinely top-16"*.
  There is one paid place now. `AUDIT-2026-09-07.md` put it plainly: *"§8.3's evidence is currently
  about a payout structure we no longer use."* The replacement exists, is stronger, and is
  reproducible; §8.3 does not cite it (O13). This is not tidiness: moving from sixteen paid places
  to one raises every individual's outcome variance, which is what a regulator reads.
- **§8.5 is headed "The 20%"** and says the operator retains twenty per cent. The margin is
  `1 − 40/seats` — **nil at the forty-seat floor**, 37.5% at a full 64 — and every one of the seven
  tiers is exactly break-even at 40 (`prize_math.rs:150-169`). `AS-BUILT.md` notes this is the
  section counsel reads.
- **§8.2's two-part table** severs one payment into a pass purchase and a competition, and shows
  each part failing one element of consideration / chance / prize of value. That severance carries
  the argument, and it is the part most open to challenge, because a player makes one payment. The
  stronger form of the same point — which the code fully supports — is that the chance element has
  no bearing on the prize at all: `entry.class` is written once and read nowhere.
- **§4.3's draw-rate table**, cited by §8.3 as why consistent players separate from guessers, is
  PID-era simulation. The regenerated study does not measure it.
- **PID §4.3 still contains a two-word category assertion** that register row D-B7 later forbade
  everywhere else, and that CI would refuse in any other file. Both PID files are excluded from the
  gate precisely so §8 can be reproduced word for word, which is right — but it means the product
  document asserts a status no other surface is allowed to.

One figure deserves the founder's eye before this goes to counsel: at 64 seats the *heuristic*
class places first 1.09% of the time, **below** the 1.5625% everyone-equal baseline. It is
explainable — the field contains optimised entrants who beat heuristics — but a reader coming to
the table cold sees "only a narrow expert strategy wins, and everyone else is at or below the
equal baseline." Better that we frame it than that somebody else does.

### 4.6 Controls that exist but are not operable

- **One reviewer.** `config/reviewers.json` holds a single member, so **every appeal is
  undecidable by construction** and there is no separation of duties. The service warns at boot.
  Open since 2026-09-07 (O24), found again independently on 2026-09-11.
- **No support channel exists anywhere in the tree.** The copy says *"you can ask us about your own
  entry"*, *"we will give it to you on request"*, *"tell us"* — and a search of `app/src` and
  `backend` for an address, a contact page or a chat link returns nothing. With the appeal route
  undecidable, a player with a complaint has nowhere to go.
- **No alert destination and no on-call path.** Metrics are exposed on the private network only;
  nothing scrapes them, and no destination is configured.
- **One person can hold many seats, and it cannot be detected across pools by design.** One entry
  per *wallet* per pool is structural, but social sign-in makes a wallet per account. Device markers
  are per-pool derived and deliberately unlinkable across pools; the within-pool signal's network
  half is dead (§4.3); detection is report-only by ruling D-E9, its hook returning an empty list
  unconditionally. So the only control is a reviewer noticing before `pay_prizes`, and there is one
  reviewer. There is also no challenge-response, proof-of-work or signup throttle.
- **Identity checks are off and there is no age-verification vendor.** Packets set tier 0 as a
  constant. The on-chain comment states the bind exactly: under one paid place, *any* threshold
  below the smallest pot escrows **every** payout at **every** tier — it is an all-or-nothing gate
  now, not a large-prize gate. And the seven-day permissionless release presents no packet at all,
  so turning the switch on must revisit that path first. R3's own flag says it: *"⚠ Removes the only
  lever when detection flags a wallet; incompatible with large prizes."*
- **A failed location check tells a visitor in an allowed country that their country is blocked.**
  Recorded in `CHANGE-2026-09-14_geo-and-welcome.md` §5 and deliberately not fixed, because it
  turns on a founder instruction about a control that faces players. Still open, and it will
  produce complaints that look like wrongful exclusion.
- **The origin allowlist is a deploy-time variable, not a code fix**, and §7 of that same change
  report records that the post-deploy check which would catch it was never added.
- **Upgrade authority is a single key.** `config/custody.json` declares a one-of-one multisig with
  no timelock, against R21's *"nothing is 'local keys for now'"* (O5).
- **Rate limits and the content-security policy are unratified proposals**, both flagged in place.
- **Roughly thirty `PHASE-N-REVIEW` markers in the copy module alone** mean most player-facing
  wording is a draft awaiting the founder's voice — including the Fair play page title, which is
  explicitly waiting on counsel because the founder's working title asserts a status D-B7 forbids.

### 4.7 A player's entry can become unrecoverable

Refunds are permissionless and robust — **up to the moment a pool seals.** Once it seals (at 64
entries, or at its deadline with at least 40), `trigger_refund` is unreachable for ever, and every
remaining step is settlement-signer-only. **There is no permissionless fallback past seal and no
timeout that reopens refunds.** If the settlement signer is permanently lost after a pool reaches
40 seats, that pool's pot and up to 64 entry payments have no on-chain route to anyone.

This is the deliberate trade against keeper-only `open_pool` and it is stated in the source
(`constants.rs:37-41`). But it is unmitigated in code, and it is the one hole in the otherwise clean
claim that players' money cannot be taken: it cannot be taken, but it can be stranded.

### 4.8 The cryptocurrency perimeter has never been examined

A search of every document in this repository for money transmission, money service business,
FinCEN, VASP, travel rule, MiCA, money laundering or tax reporting returns **zero matches**.

The product takes SOL from the public and pays SOL to the public. Whatever the answer to §8's
characterisation, that activity raises questions nobody has looked at: whether the operator is a
transmitter or a virtual-asset service provider in any jurisdiction it accepts players from, and
whether the pre-funded-pot structure helps or hurts that analysis; registration and licensing
obligations in the US, UK and EU; an anti-money-laundering **programme** as distinct from the
**control** we have, since excellent screening sits beside no risk assessment, no nominated
officer, no suspicious-activity reporting and no retention policy; travel-rule obligations on prize
payments above thresholds; and tax, both prize reporting and our own treatment of entry income.

Two facts reduce this surface and are worth keeping: **no fiat funding route is enabled** — the
app degrades to "send SOL to this address", so players must already hold it — and the character
pass is non-transferable, has no market and pays nothing, which the §8.4 discipline keeps true.

---

## 5. The three questions, answered

**The category question.** The mechanism is as clean as this product could be built: no chance in
any result, a decorative draw provably read by nothing, a fixed purse funded before entries open,
and measured evidence that unconsidered play never places first. Under a test that asks whether
skill predominates, that is a strong position. Under the test in the 2005 Act's s.14 — whether the
requirement to exercise skill or judgement is likely to prevent a significant proportion of those
who enter from receiving a prize — *"entrants who allocate at random place first 0.000% of the
time"* is close to an ideal fact, and PID §8.3 is where that argument belongs. **But nobody
qualified has written it down for a single jurisdiction, the operating entity is undecided, and the
software is open to fifty US states where the analysis is made state by state and several treat an
entry fee plus a prize as within the licensing regime whatever the skill content.** Defensible in
principle; unverified in fact.

**Cryptocurrency.** Unexamined. See §4.8. That is a gap in the question set, not in the build.

**Online gaming and consumer law.** Half built. Published rules, a refund rule, "decisions are
final", a responsible-play section and an eighteen-plus gate all exist and are well written — the
responsible-play wording in particular is careful, and the copy is free of chance framing
throughout. What is missing: a terms contract, a privacy notice, any complaints or
dispute-resolution route, a governing-law clause, a limitation of liability, and any support
channel at all. For an operator facing the UK and EU while processing sign-in identity, location
data, device markers and behavioural timing — and using that data in decisions that can withhold a
prize — the absent privacy notice is a hard requirement, not a polish item.

---

## 6. What was fixed on 2026-09-16

Five commits answered the part of this review that needed no decision. Recorded here so the
document is accurate on the day it lands rather than describing defects that are already gone.

| Change | What changed |
|---|---|
| **PR #134** (merged 03:40, before this session) | The founder's data-minimisation ruling, and it lands on three findings below. It **deleted the `ipHash` input and the IP-correlation branch**, **removed the `/rivals` and `/sealed-entries` routes** so the sealed boxes have no public reader, and **already corrected the `PRODUCT-FACTS` published-post-reveal row** — the same error this review found independently a few hours later. Recorded here because a reader comparing this document to `main` would otherwise find three citations describing code that is gone |
| `3cbf39c` | The three field-size drifts of §4.3. All three now take the shared constant, following the convention `rules.howToEnter` already states. `app/src/copy/field-size.test.ts` pins each and sweeps every rendered string for a superseded floor — the sweep exists because the landing string spelled the number out, so digits alone would not have caught it |
| `2ef9c15` | Detection signal 4 narrowed to the device half, which is real and is the hard-block half under R11. Not widened by building the network capture first: a published claim does not wait on a build, and putting a network identifier into the detection pipeline is a privacy decision as much as an engineering one. Registered in `published-claims.test.ts` so the narrowing is load-bearing |
| `c99279c` | `scripts/check-published-numbers.ts` — the twelfth gate. A value a shared constant used to have may not appear in a rendered copy string, as digits or as a number word. Reads the program's own `constants.rs`, so the chain of custody is Rust → (`check-mirrors`, `mirror.spec`) → TypeScript → (this gate) → published copy. Verified against the real failure: with all three original strings restored it names each surface, value, constant and register row and exits 1; sabotaging its word matching makes it exit 2 and say so |
| `799c578` | R1-b and the `HOW-IT-WORKS.md` amendment of §2 |
| `2d12b03` | Stale lines across five documents — `PRODUCT-FACTS` (three rows), the v0.6 draft (C10 and C2), `internal-review.md` (IR-3's superseded "No action", IR-4's review window, a helper name that no longer exists), the roadmap's standing rule 6 (three vault exits where there are four), and a committed test artefact reading "failed" while naming no test. Two of them misled counsel — see below |

Two of those six are worth naming here because they are the class of error this review exists to
find, and both were in documents written for counsel:

- **`PRODUCT-FACTS` said we publish players' device markers.** Its player-data section read
  *"Published post-reveal: battles, salts, timings, device hashes, scores, ranks, amounts."* Bundle
  version 2 (2026-09-12, audit B-31) carries neither the timings nor the device marker, and the
  reason is the point: the bundle is permanent public storage and **the device marker is stable
  across pools**, so publishing it linked a player's entries across every pool they ever played, to
  anyone, for ever. We stopped on privacy grounds and the document counsel reads still described the
  product that had not. Corrected, with the non-publication now stated as its own row.
- **The v0.6 draft said we hold a privacy notice.** C10 read "Built". We have never had one. The
  roadmap has an unrelated C10 (the review service), which is built, and is the likeliest source of
  the error. C2 was split in the same pass: the gate is built, the vendor of record is not
  contracted.

---

## 7. What remains, by owner

**Founder.** Ordered by what unblocks the most.

1. **The operating entity (D6).** Until this is answered, no regulator, licensing regime,
   anti-money-laundering obligation or tax treatment is identified. Cheapest decision available and
   it unblocks §4.8 entirely.
2. **Reissue the PID as v0.6.** The draft is ready and §8 stays untouched and founder-and-counsel
   owned. What changes is that counsel reads the product that exists rather than one we stopped
   building in September. PID §4.3's category assertion should come out in the same pass.
3. **The United States** — block it at country level in `config/territories.json`, which is one
   line and enforceable today, or contract a location source that can resolve state codes (D9).
4. **Terms, a privacy notice and a support channel.** The first two are roadmap 6.3; the third is
   not tracked anywhere and every "tell us" in the copy currently points nowhere.
5. **A second reviewer** (O24/D10) — one keypair from a trusted person, no code change. Without it
   the published appeal right does not exist.
6. **The failed-location message** (§4.6), which is a founder instruction and will not be
   overturned here.
7. **The geography and screening vendors of record**, which D-E14 already makes a precondition of
   the first pool with strangers in it.
8. **The identity-check threshold** (D5/O9), answerable only after 1 and the instruction in §4.8.

**Architect.**

1. **Give `scoreWithMissing` a Python oracle vector**, delete its duplicate ranking logic in favour
   of the engine's, move it inside `backend/scoring/` so the browser-bundle test covers it, and
   extend `check-fixtures.sh` to it. The function that decides every real settlement should not be
   the only one in the path proven by nothing independent.
2. **Put the bundle URI on chain**, or at minimum publish the storage tag scheme on the verify page
   and make publication retry rather than record.
3. **Automate the lost-ciphertext refund**, or change the published promise to describe the manual
   process honestly.
4. **Post-seal liveness** (§4.7) — key custody with a recovery story, co-signing for the settlement
   key, and a disclosure on the rules page in the way the next-rank residual is already disclosed.
5. Alerting and an on-call path; ratify the rate limits and the content-security policy.

**Already tracked and not re-litigated here:** the upgrade authority moving to the multisig (O5),
co-signing for the settlement key (O6), the twenty-pool rehearsal (O16), and the external program
review, which R5 defers until after ten settled pools on the main network. That deferral carries its
own flag — *"⚠ Solo founder, unaudited vault"* — and real money is the thing it guards.

---

*Reviewed against `3cd0ec7`. Findings §4.3 items 1–4 and the documentation errors in §6 were fixed
in `3cbf39c`…`2d12b03` on the same day. Everything else in §7 was open when this document was
written.*
