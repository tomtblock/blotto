# REPORT — devnet trial findings

A short summary of what the trial found. The scoreboard is [`RESULTS.md`](RESULTS.md). The full
account, with the method, per-test numbers, CI lanes and limits, is
[`docs/testing/TESTING-REPORT.md`](../docs/testing/TESTING-REPORT.md).

## 1. What was tested

Six scored tests and one shakedown on devnet, tier 0. Each ran against a prediction that was merged
before its pool's first entry. The refund path was tested at 12 and 39 seats (T1, T2R), full pools
paying a browser wallet and a headless wallet (T4, T5), and an oversubscribed pool with nine late
entrants (T6). T3, T7 and T8 did not run.

**Held everywhere:** money conserved to the lamport; every refund exactly the entry; every paid
pool paid exactly the predicted seat; every prize vault ended at its 650240-lamport rent cushion;
every revealed allocation re-hashed to its on-chain commitment; every recomputed results root
matched the chain.

## 2. Product findings

Status checked against the code on this branch.

| # | Finding | Status |
|---|---|---|
| F-1 | A refunded pool never reveals its pool secret. The daemon reveals only on the path for pools that played (`backend/reveal/src/crank.ts`), so refunded entrants cannot check that their allocation stayed sealed | Open |
| F-2 | `/health` on the entry service has no signer probe. A signing outage refused every entry while `/health` reported `ok` | Open |
| F-3 | `packet issued` is logged before the packet is signed (`backend/packet/src/service.ts`) | Open |
| F-4 | A failure between sealing and registering barred that wallet from the pool permanently | Fixed — an overwrite is refused only when the chain holds an `Entry` (`backend/packet/src/ciphertexts.ts`); the packet is requested before the seal (`app/src/entry/submit.ts`) |
| F-5 | A late entrant saw a hedged message instead of "this pool filled" | Fixed — the route answers `pool filled`, and `app/src/entry/outcome.ts` maps it to its own message |
| F-6 | Two timed-out players produced a "strong" duplicate-set detection finding | Fixed — default battles are excluded from the comparison (`backend/detection/src/signals.ts`) |
| F-7 | The even-split default can win against a field that concentrates on one or two stats (pool 20) | Design property, under review; the unconditional "weakest allocation" sentence was removed from the rules copy |

## 9. Open items

The CI lane `.github/workflows/rehearsal.yml` requires any failing or unfrozen verdict in
`RESULTS.md` to be carried here.

**No test is `UNFROZEN`.** Every freeze record's plan hash matches the merged bytes, and every
merge precedes its pool's first entry.

**Criteria that did not hold, or where the tool's own line reads FAIL:**

| Test | Item | Why it does not change the verdict |
|---|---|---|
| T2R | The per-seat cost criterion (exactly 4441080 for every seat) **did not hold**: 29 of 39 seats cost 4446160. `T2R.reconcile.md` prints `RESULT: FAIL` | The prediction was wrong, not the product. Pass-asset rent depends on the length of the seat number in the asset's name. The two bands were then predicted correctly in T6 |
| T5 | `T5.reconcile.md` prints `RESULT: FAIL` | The line comes from exact unpaid-field ranks, which were not a pass criterion. 44 of 62 moved by 1–5 places because both browser wallets timed out onto the even split. All eight frozen criteria held |
| T6 | `T6.reconcile.md` prints `RESULT: FAIL` | It compares against the original plan, which predicts a field that did not run. The run is judged against the pre-fill addendum (`registry/T6.deviation.json`, `registry/T6.verdict.md`) |
| T6 | "A person reads the refusal copy" was not tested | The late-entry message is fixed in code (F-5); reading it on a live pool is untested |

**Tests not run:** T3 (plan frozen), T7, T8. See the testing report §8.

**Open product items:** F-1, F-2, F-3 (above).
