# RESULTS — the devnet battle test, one screen

Regenerated after every pool. A `FAIL` or `UNFROZEN` row here must have a matching
open item in the report; CI refuses the default branch otherwise.

| test | scenario | pool | state | entrants | frozen | reconciled | VERDICT |
|---|---|---|---|---|---|---|---|
| T1 | Refund, sparse — below the minimum field | 14 | Closed | 12 | PR 132, 2026-09-16T00:07:24Z | 2026-09-16T14:04Z | **PASS** |
| T2 | Refund at the boundary (39) | — | not started | — | — | — | — |
| T3 | Seal at the minimum field (40) + pause | 29 | Paid | 40 | PR 171, 2026-09-24T15:55:01Z | 2026-09-26T14:34Z | **PASS** |
| T4 | Full pool — UI wallet wins | 16 | Paid | 64 | PR 133, 2026-09-16T16:22:00Z | 2026-09-17T02:23Z | **PASS** |
| T5 | Full pool — headless wallet wins | 18 | Paid | 64 | 144, 2026-09-17T22:51:00Z | 2026-09-18T01:38Z | **PASS** |
| T6 | Oversubscribed + load | 27 | Paid | 64 | PR 156, 2026-09-19T19:11:28Z | 2026-09-22T00:27Z | **PASS\*** |
| T7 | Same device → review | — | not started | — | — | — | — |
| T8 | Verify page + non-founder recompute | — | not started | — | — | — | — |

**Pool 22 settled `Paid` at 64 seats, nine seconds from seal to payout, with W00 taking the whole
4 SOL.** Its one finding is a product one and is recorded in the observation, not here: the late
entrant is refused correctly and charged nothing at all, but is shown a message that hedges between
two causes the server had already told the client apart. **T6's copy criterion would fail against
the product as it stands** — see `registry/pool-22.observation.md` §Observation 4.

**Pool 22 is not in this table, on purpose.** It is running as a shakedown for T6's failure path and
is recorded as an observation (`registry/pool-22.observation.md`), not a test: UI-A entered it before
any prediction for it was written, so nothing frozen from here could predate it. It claims nothing.

**Money conserved.** T1 closes to the lamport. The treasury held 1.996098560 SOL
after pool 14 was funded, took in 1.2 for twelve entries, received 4.0 back as
the untouched pot at `trigger_refund`, paid out 1.2 in refunds, and spent
4.000650240 funding the next pool — leaving 1.995448320, which is what the chain
reads.

**Predicted payouts matched.** Twelve of twelve seats refunded exactly
100000000 lamports. No seat was paid a prize, as predicted for a pool below the
minimum field.

**Unexplained deviations: none.** One observation, not a deviation: W06 and W09
each spent 5080 lamports more in fees than the other eight headless seats. Their
entry price returned in full like every other seat.

---

## T4 — the first pool that played, and paid

**UI-A took the entire 4 SOL pot. UI-B finished 64th.** Both confirmed against the chain's own
committed payout list, `[{"seat":0,"amount":"4000000000"}]` — exactly one paid seat.

| | predicted (frozen 16:22:00Z) | actual | |
|---|---|---|---|
| UI-A net | +3.895564000 SOL | **+3.895554578** | 9422 lamports apart |
| UI-B net | −0.104436000 SOL | **−0.104441167** | 5167 lamports apart |
| prize vault after | 650240 | **650240** | exact |
| terminal state | Paid | **Paid** | |
| entrants | 64 | **64** | |
| paid seats | 1 | **1** | |
| flagged · sanctions holds | none · none | **none · none** | |

Reconcile: **58 MATCH · 0 RANK_DRIFT · 0 PAYOUT_MISMATCH · 2 INPUT_DRIFT · 4 ABSENT**. Freeze **OK** — the plan's
sha256 matches the bytes merged in PR 133, and the merge preceded the first entry by 9 h 43 min.

**The plan was frozen against pool 15 and ran on pool 16, unedited.** Pool 15 was lost to the
seal-lockout (§H6); the plan was not changed, because a rank falls out of the allocations and not
the pool. A prediction frozen before its pool existed is stronger evidence, not weaker.

**The first reconcile checked nothing per-seat (§H9).** Its scored-pool branch was a stub that
returned `MATCH` unconditionally. It has been implemented and re-run; the table above is the real
check. All 64 revealed allocations reproduce the `battles_hash` the chain recorded at entry, and
every field seat's rank is exactly the one the plan predicted.

The 2 INPUT_DRIFT are the founder's own seats, played by hand against a 90-second clock: UI-A
matched the plan's exact numbers in **1 of 7 battles**, UI-B in **4 of 7**. Rank and payout matched
regardless — which is the point.

**And that is the result worth keeping (§H10).** Every *conditional* prediction about those exact
numbers was wrong. Every *unconditional* one was exactly right: all seven of UI-A's battles still
held three stats at 26 or above, so it won every battle and took the whole pot. The claim under test
was "rank 1 holds for ANY wall against a field capped at 25" — and a genuinely different wall,
played by a human against a 90-second clock, proved it.

**Cost: five wallets, and the fault was the runner's, not the product's (§H8).** W22, W42, W43, W55
and W65 sealed and then failed to register — `Blockhash not found` from a preflight the send did not
need. Each is barred from pool 16 by §H6. The guardrail built earlier the same day stopped the run
at each first casualty instead of marching on, which is why it was five and not sixty-two. All five
were replaced by spares playing the burnt seats' own frozen allocations, so the scored field was
exactly the planned field.


## T5 — a headless wallet won, and neither operator account did

**All eight frozen pass criteria met, each checked against evidence rather than assumed.**

| criterion (frozen 2026-09-17T22:51:00Z) | evidence |
|---|---|
| Paid with 64 entrants | Paid, 64/64 — sealed at capacity on the 64th entry |
| Exactly one seat paid: **W00**, the whole pot | one paid seat, W00, **4000000000** lamports |
| W01 ranked last | rank **64** of 64 |
| Neither founder wallet paid, both in ranks 2..63 | UI-A **62**, UI-B **62**, both paid 0 |
| Every revealed allocation reproduces its committed hash | **64 of 64**, none false |
| Recomputed results root equals the on-chain root | **MATCH** — `0e1d6b87…3bcc`, computed by hand (§H14) |
| Vault ends at 650240 lamports | **650240** |
| No seat flagged, no sanctions hold | 0 flagged, 0 holds |

**What this proves that T4 could not.** T4 paid the whole pot to the operator's own account, so it
could not rule out that the account was privileged. Here a headless wallet with no relationship to
the operator took rank 1 and all 4 SOL, another took last, and both founder wallets finished
mid-field and were paid nothing. The winner is decided by the allocations and nothing else.

**`reconcile.ts` prints `RESULT: FAIL`, and the reason is mine, not the product's.** 44 of 62 exact
field ranks drifted, by one to five places each. Exact field ranks are **not** a pass criterion —
the eight above are. The drift has a single cause: both founder wallets timed out into the even
split (§H13) instead of the rotations the plan assumed, which changed every head-to-head against
them and perturbed scores across the field.

The plan marked only **2 of 64** seats `rankIsConditional` — the two founder seats. It should have
marked all 62 headless field seats conditional too, because every one of their ranks depended on how
the founders played. That is §H10 again in a new disguise: I saw that the founders' own ranks were
conditional and did not see that everyone else's were conditional on the same input.

**The three findings this pool produced:** §H12 (my concurrency burnt four more wallets; fixed and
proved by re-running the remainder at concurrency 1 with zero losses), §H13 (the timeout default
manufactures the strongest detection signal — **for the founder and counsel**), §H14 (a pass
criterion no tool checked; checked by hand, it passes).

---

## T6 — pool 27 — oversubscribed, and the field was not the one that was frozen

**PASS\*** — every criterion the run could carry, with one knowingly surrendered. Judged against
`registry/T6.deviation.json`, frozen at commit `0c77466` before a lamport moved, **not** against
`T6.plan.json`. The plan is unedited (`e6595def…`) and predicts a field that did not run, so
`T6.reconcile.md` reports FAIL against it and is right to. `registry/T6.verdict.md` is the verdict.

**What deviated.** UI-B registered as seat 1 instead of arriving late and being refused — my
instruction carried two founder actions in one numbered list (§H26). The founder ruled option (a):
run anyway. W62 was dropped, every wallet from W00 on shifted one seat later, and UI-B's allocation
was unreadable until reveal.

**The four claims frozen before the run, all held:**

| claim | outcome |
|---|---|
| Rank 1 is W00 or UI-B, no other seat (863 floor > 542 ceiling) | **HELD** — W00 |
| W01, the pole, is 63rd or 64th (19 < 323) | **HELD** — 64th |
| UI-A cannot take rank 1 (353 < 863) | **HELD** — 62nd |
| UI-A cannot finish 64th (339 > 19) | **HELD** — 62nd |

**What was measured**

- Paid at 64 entrants, 0 flagged, 0 refunded. W00 took rank 1 on 877 and the whole 4000000000.
- **Nine late attempts, nine refusals, all `PoolNotOpen` (6000) — never `PoolFull` (6010)**, which
  confirms the gate-order derivation: the 64th entry seals the pool, so a 65th dies at the state
  gate and can never reach the capacity gate. Each spent **15000 lamports** — a fee, no entry, no
  pass, no rent.
- Every one of the nine was told `pool filled` by the ciphertext route.
- **Results root VERIFIED — recomputed from 64 seats, MATCH.**
- Per-seat cost: 7 seats at 4441080, 54 at 4446160, with UI-A, UI-B and W00 completing the low
  band. **The addendum predicted the boundary would move to W07/W08 because UI-B took a seat, and
  it did.** §H20's bands now hold on a fifth pool.
- Treasury 9387645440 (00:05Z, pre-fill) → 15587645440 (00:27Z, harvest), a difference of
  6200000000 = 62 × 100000000, exactly the entries this run added. Vault ends at its 650240
  cushion. It reads 11586995200 by 00:33Z because pool 28 opened and drew 4000650240 to seed its
  own pot and cushion.

**The asterisk.** A person reading the refusal was not tested and no headless wallet can stand in
for it. It is still reachable on pool 27 — the state gate runs before the signature, so a wallet
that already sealed there and tries again reads `pool filled` — and that is outstanding with the
founder.

**And the risk that did not land.** W00 scored 877, the top of its predicted `[863, 877]`, which
happens only if UI-B lost all seven battles to it. The founder did not concentrate. Had they played
three stats at 34/33/33 — an ordinary strong shape — UI-B would have scored 871 and taken rank 1.
The claim would still have held, but 4 SOL would have gone to a seat that was never meant to be in
the field. That is luck, and the record says so.

## T2R — pool 21 — the boundary claim, retried and PROVEN. One criterion failed, and it was mine.

**Frozen before the pool it ran on existed.** PR 151 merged **2026-09-18T23:47:18Z**; pool 21 was
created by a Solana block at **2026-09-19T01:21:29Z**, one hour and 34 minutes later. The plan named
no pool — `poolId` and `poolPda` are both null in the frozen bytes. Neither clock is ours. This is
the strongest form of freeze in this test, and we have it here only because T2 was spoiled and the
retry was forced (§H16).

**The claim under test — the fork is at exactly 40, and 39 is on the refunding side — HELD.**

| criterion | result |
|---|---|
| reaches `Closed`, not `Paid` | **MATCH** |
| exactly 39 entrants at the deadline | **MATCH** |
| `trigger_refund` settles it, not `seal_at_deadline` | **MATCH** — no `results_root`, no revealed secret |
| every entrant refunded exactly `100000000` | **MATCH** — 39 of 39 |
| prize vault ends at exactly `650240` | **MATCH** |
| pot of `4000000000` returns to the treasury | **MATCH** — vault holds only the rent cushion; treasury net +4000000000 |
| no flag, no sanctions hold, no reviewer | **MATCH** |
| **each seat's net loss is exactly `4441080`** | **FAILED — 29 of 39 seats cost `4446160`** |

**The failed criterion is a defect in my prediction, not in the product.** Every entry mints a pass
asset named `BLOTTO PASS #<pool>-<seat>`. A two-digit seat index is one character longer, the
account is one byte bigger, and one byte of devnet rent is 5080 lamports. Seats 0–9 cost 4441080;
seats 10 and up cost 4446160. Rent scaling with a name is correct behaviour.

**It was always true and I never looked.** Probing the earlier pools' pass assets directly: T1, T4
and T5 all show 92 bytes at seat 9 and 93 bytes at seat 10. On T4 and T5, **54 of 64 seats** were at
the higher figure. The plan's claim that "three settled pools measured the same figure to the
lamport" described a measurement never made — early seats were read and the result generalised, then
restated with increasing confidence until it was frozen as "a single lamport of drift is a failure".
Full account in `DRIFT.md` §H20.

**`reconcile.ts` reported PASS while that criterion failed** — it contained no reference to the
claim at all (§H21). That is §H9's stub verdict and §H14's unchecked root a third time. It now
checks the per-seat cost, and refuses to pass a plan that states the prediction without the
starting balance needed to test it. Proven in both directions before being believed: predicting
`4441080` catches the 29 two-digit seats, predicting `4446160` catches the 10 single-digit ones, and
neither passes — because the cost genuinely is two numbers.

**Two seats were burnt mid-run and BOTH RECOVERED.** W14 and W28 each sealed and then failed with
`block height exceeded` (2 of 40, matching T2's 2 of 32). Before PR 147 each would have been barred
from the pool permanently and replaced by a spare. Both were retried and both landed, so **no
substitutions: the 39 seats are the 39 the frozen plan named.** W14's state was read directly before
retrying — `{"sealed":true}` with no Entry PDA, exactly the condition the fix addresses.

**Verdict: the boundary property is proven. The cost model was wrong and is now measured.**

---

## T3 — pool 29 — the fork watched from the playing side, and two point predictions that landed

**PASS on every frozen pass criterion.** `T3.reconcile.md` prints `RESULT: FAIL`; the reason is
mine and is §H10 for the third time. `registry/T3.verdict.md` is the verdict.

**The fork is at exactly 40.** T2R proved 39 refunds. This pool reached its deadline holding exactly
`MIN_SEATS` and played. The indexer's `outcome_if_deadline_now`, read on the same pool an hour
apart: **39 → `refund`, 40 → `seal`.**

**`seal_at_deadline` had never run on this cluster.** T4, T5 and T6 all sealed on capacity, inside
the 64th `register`, with no separate actor and no clock. From the pool's own history:

```
01:24:52Z  SealAtDeadline      two seconds after the deadline
01:24:54Z  RevealPoolSecret
01:24:55Z  CommitResults
01:24:55Z  PayPrizes
```

`trigger_refund` does not appear. Three seconds from seal to payout.

### The point predictions — what makes T3 sharper than T5 and T6

T5 and T6 could only predict the wall's score as a range, because the founders' play swung it.
Premise P1 fixes **both** of the wall's founder battles, so T3 predicted a point:

| | predicted | actual |
|---|---|---|
| W00 score | **542** | **542** |
| W01 score | **4** | **4** |
| W00 | rank 1, paid 4000000000 | **rank 1, paid 4000000000** |
| W01 | rank 40 | **rank 40** |
| founder seats | ranks 2..39, paid 0 | **UI-A 39, UI-B 38, both 0** |
| prize vault | 650240 | **650240** |
| results root | recomputed = on-chain | **VERIFIED from 40 seats · MATCH** |
| allocations reproducing their committed hash | 40 of 40 | **40 of 40** |
| flagged · sanctions holds | none · none | **0 · 0** |

The plan computed a ceiling of **369** for the best seed-generated rival, W33. W33 finished **rank 2
on 367**. W00 won by **175**.

### Per-seat cost — §H20's bands on a sixth pool

```
rent+fee 4441080  ×10  seats 0..9
rent+fee 4446160  ×28  seats 10..39   (+ the two UI seats at 29 and 30 = 30)
```

Exactly the 10/30 split predicted, boundary precisely at seat 10. Measured from each register
transaction's own pre/post balances — the wallet-balance method breaks on W00, which the funder
never topped up because it already held 7.93 SOL from winning T5 and T6.

### Both founder seats timed out into the even split — and every unconditional claim still held

```
UI-B   all seven battles   [20,20,20,20,20]
UI-A   battles 1-2 dialled, battles 3-7   [20,20,20,20,20]
```

The even split is what the client submits when the ninety-second clock expires. **§H13 recurring,
and harder than T5's** — there one seat, here both, one of them on every screen.

It changed nothing that was claimed unconditionally. An even split is five non-zero stats, none
above 25, so P1 and P2 both still applied. **33 of 40 scores differ from the plan and every
unconditional claim held exactly.** That is the two-tier split doing the job it exists to do, and a
prediction that survives both founders playing nothing like the recipe is stronger than one that
survives them following it.

**This was invisible in the first reconcile**, which is a defect now fixed: `INPUT_DRIFT` was
checked *after* `RANK_DRIFT` in an `if/else if` chain, so any seat whose rank had also moved was
labelled `RANK_DRIFT` and the input check never ran — and input drift is what *causes* rank drift.
The report said only that two founder ranks were off by one. It now names the even split by count.

### Why the reconcile says FAIL

22 of 38 headless seats drifted in rank. Exact field ranks are **not** a pass criterion. The plan
marked only the two founder seats `rankIsConditional` when it should have marked all 38, because
every headless rank depends on how the founders played. **T4 had this on 2 seats, T5 on 44 of 62,
T3 on 22 of 38** — three pools, one lesson, still not fixed in the artifact that keeps repeating it.

### The freeze, and its limit

`T3.freeze.json` was **written two days after the run**, because none was written at the time;
`reconcile.ts` refused the pool as UNFROZEN and was right to. It is built from GitHub's merge
timestamp, git hashes and devnet block times, all independently recoverable — but it records that
**T3 holds the weaker freeze standard**: frozen 1 h 33 min before the first entry, and **not**
before the pool existed, since pool 29 was opened 2 h 30 min before the plan merged. T6 and T2R hold
the stronger one; this does not.

### The pause — all criteria passed, and T6's asterisk closed

| criterion | evidence |
|---|---|
| the bit moved | `Config.paused` **true** from chain, `Instruction: SetPaused`, 6974 CU, matching an off-chain simulation exactly |
| refused at the **pause** gate | **6005** — `AnchorError thrown in register.rs:138. Error Code: Paused.` Not 6000, not 6010 |
| costs a fee and nothing else | **15000 lamports**, no entry, no pass, no rent |
| **a person read a true sentence** | *"Entries are paused right now, so this one was not accepted and nothing settled. Try again a little later."* |
| lifts cleanly | `Config.paused` **false** from chain; UI-B then entered as seat 31 |

`register` checks the pause **first**, before the state gate, the deadline and capacity — confirmed
on live traffic. And UI-B was refused during the window and accepted eight minutes later: same
wallet, same device, the pause bit the only difference.

**"Nothing settled" is simply accurate.** UI-B's refusal produced no transaction on chain at all —
the app preflights, the simulation returns 6005, and the client refuses before anything is
submitted. The player pays nothing. The 15000 lamports is an artefact of `late-attempt.ts` using
`skipPreflight: true` deliberately so a refusal lands and can be measured. An earlier draft had this
backwards and raised a counsel item that does not exist.

### Operator error, twice, neither the product's

1. **Base64 into a base58 field.** Squads' Data field is base58; `admin.ts --emit-proposal` prints
   `dataBase64`, with an "Export as base58" button on the same screen. The program threw
   `InstructionFallbackNotFound` (101). Cost: one fee. Correct values `2AMgDu5cpQDDr` /
   `2AMgDu5cpQDDq`, one character apart.
2. **No freeze record at freeze time**, as above.
