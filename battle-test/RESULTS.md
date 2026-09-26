# RESULTS — the devnet trial, one screen

Tier 0 (entry 0.1 SOL, prize pool 4 SOL, minimum field 40, capacity 64), devnet, 2026-09-16 to
2026-09-22. Each prediction was merged before its pool's first entry. The full account is in
[`docs/testing/TESTING-REPORT.md`](../docs/testing/TESTING-REPORT.md); the findings are in
[`REPORT.md`](REPORT.md).

| Test | Scenario | Pool | State | Entrants | Frozen (PR, merged) | Reconciled | Verdict |
|---|---|---|---|---|---|---|---|
| T1 | Refund below the minimum field | 14 | Closed | 12 | PR 132, 2026-09-16T00:07:24Z | 2026-09-16T14:04Z | **PASS** |
| T2 | Refund at the boundary (39) | 20 | Paid | 40 | PR 146, 2026-09-18T14:42:47Z | — | **SPOILED** — a 40th wallet from outside the plan entered |
| T2R | Refund at the boundary, retried | 21 | Closed | 39 | PR 151, 2026-09-18T23:47:18Z | 2026-09-19T13:26Z | **PASS, 7 of 8** — see REPORT §9 |
| T3 | Seal at the minimum field + pause | — | not run | — | plan frozen, not run | — | — |
| T4 | Full pool — browser wallet wins | 16 | Paid | 64 | PR 133, 2026-09-16T16:22:00Z | 2026-09-17T16:48Z | **PASS** |
| T5 | Full pool — headless wallet wins | 18 | Paid | 64 | PR 144, 2026-09-17T22:51:00Z | 2026-09-18T01:05Z | **PASS** |
| T6 | Oversubscribed (64 + 9 late) | 27 | Paid | 64 | PR 156, 2026-09-19T19:11:28Z; addendum `0c77466` | 2026-09-22T00:27Z | **PASS\*** — one criterion not tested |
| T7 | Same device → review | — | not run | — | — | — | — |
| T8 | Verify page + independent recompute | — | not run | — | — | — | — |

Pool 22 was a shakedown of T6's mechanics. It is not a test and has no verdict
(`registry/pool-22.observation.md`): `Paid` at 64, nine seconds from seal to payout.

## Key numbers

| Test | Money | Chain check |
|---|---|---|
| T1 | 12 of 12 refunded exactly 100000000; treasury closes to the lamport at 1.995448320 SOL | vault 650240 |
| T2R | 39 of 39 refunded exactly 100000000; pot of 4000000000 back to the treasury | vault 650240; no results root |
| T4 | Browser wallet A rank 1, paid 4000000000; browser wallet B rank 64 | root `08675847…b156` recomputed · MATCH; vault 650240 |
| T5 | W00 rank 1, paid 4000000000; W01 rank 64; both browser wallets rank 62, unpaid | 64 of 64 hashes reproduce; root `0e1d6b87…3bcc` MATCH; vault 650240 |
| T6 | W00 rank 1, paid 4000000000; 9 late attempts refused `PoolNotOpen` (6000), 15000 lamports each; treasury +6200000000 = 62 entries | root `3caf8e13…71d7` MATCH; vault 650240 |

Per-seat cost of an unpaid or refunded seat (pass-asset rent): **4441080** for seats 0–9,
**4446160** for seats 10 and up. The seat number in the asset's name is one byte longer from seat
10 on.
