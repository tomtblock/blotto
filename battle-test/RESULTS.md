# RESULTS — the devnet battle test, one screen

Regenerated after every pool. A `FAIL` or `UNFROZEN` row here must have a matching
open item in the report; CI refuses the default branch otherwise.

| test | scenario | pool | state | entrants | frozen | reconciled | VERDICT |
|---|---|---|---|---|---|---|---|
| T1 | Refund, sparse — below the minimum field | 14 | Closed | 12 | PR 132, 2026-09-16T00:07:24Z | 2026-09-16T14:04Z | **PASS** |
| T2 | Refund at the boundary (39) | — | not started | — | — | — | — |
| T3 | Seal at the minimum field (40) + pause | — | not started | — | — | — | — |
| T4 | Full pool — UI wallet wins | — | not started | — | — | — | — |
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
