# RESULTS — the devnet battle test, one screen

Regenerated after every pool. A `FAIL` or `UNFROZEN` row here must have a matching
open item in the report; CI refuses the default branch otherwise.

| test | scenario | pool | state | entrants | frozen | reconciled | VERDICT |
|---|---|---|---|---|---|---|---|
| T1 | Refund, sparse — below the minimum field | 14 | Closed | 12 | PR 132, 2026-09-16T00:07:24Z | 2026-09-16T14:04Z | **PASS** |
| T2 | Refund at the boundary (39) | — | not started | — | — | — | — |
| T3 | Seal at the minimum field (40) + pause | — | not started | — | — | — | — |
| T4 | Full pool — UI wallet wins | 16 | Paid | 64 | PR 133, 2026-09-16T16:22:00Z | 2026-09-17T02:23Z | **PASS** |
| T5 | Full pool — headless wallet wins | 18 | Paid | 64 | 144, 2026-09-17T22:51:00Z | 2026-09-18T01:38Z | **PASS** |
| T6 | Oversubscribed + load | — | not started | — | — | — | — |
| T7 | Same device → review | — | not started | — | — | — | — |
| T8 | Verify page + non-founder recompute | — | not started | — | — | — | — |

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
