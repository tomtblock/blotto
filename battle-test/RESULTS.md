# RESULTS — the devnet battle test, one screen

Regenerated after every pool. A `FAIL` or `UNFROZEN` row here must have a matching
open item in the report; CI refuses the default branch otherwise.

| test | scenario | pool | state | entrants | frozen | reconciled | VERDICT |
|---|---|---|---|---|---|---|---|
| T1 | Refund, sparse — below the minimum field | 14 | Closed | 12 | PR 132, 2026-09-16T00:07:24Z | 2026-09-16T14:04Z | **PASS** |
| T2 | Refund at the boundary (39) | — | not started | — | — | — | — |
| T3 | Seal at the minimum field (40) + pause | — | not started | — | — | — | — |
| T4 | Full pool — UI wallet wins | 16 | Paid | 64 | PR 133, 2026-09-16T16:22:00Z | 2026-09-17T02:23Z | **PASS** |
| T5 | Full pool — headless wallet wins | — | not started | — | — | — | — |
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

Reconcile: **60 MATCH · 0 RANK_DRIFT · 0 PAYOUT_MISMATCH · 4 ABSENT**. Freeze **OK** — the plan's
sha256 matches the bytes merged in PR 133, and the merge preceded the first entry by 9 h 43 min.

**The plan was frozen against pool 15 and ran on pool 16, unedited.** Pool 15 was lost to the
seal-lockout (§H6); the plan was not changed, because a rank falls out of the allocations and not
the pool. A prediction frozen before its pool existed is stronger evidence, not weaker.

**Input drift was NOT checked — see §H9.** `harvest.ts` does not read the published bundle, so the
`0 INPUT_DRIFT` figure above is a limitation rather than a finding. Reading the bundle by hand
afterwards showed the founder's hand-dialled allocations matched the plan's exact numbers in **1 of
7 battles for UI-A and 4 of 7 for UI-B**.

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
