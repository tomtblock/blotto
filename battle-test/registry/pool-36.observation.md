# Pool 36 — an observation, not a test

**T7 did not run.** This file records what pool 36 does anyway, and why it is filed the way pool
22 was: an observation with no verdict, rather than a test with a pass or a fail.

## How it ended up here

| when | what |
|---|---|
| 2026-09-26 13:46:04Z | pool 36 created, tier 0, easy mode |
| 15:35:48Z | a wallet that is not ours registers — `CRCK62mRC4zxsFRAx41g4MbQzGqsJQD3SURM7Te4VnhW` |
| 19:11:47Z | `T7.plan.json` written, naming pool 36 and accounting for that one stranger |
| 19:41:55Z | the freeze merges (PR 189) — **2 h 8 min before our first entry** |
| 21:50:03Z → 21:52Z | 38 headless seats land, W00..W37. **Stopped at 39 deliberately**, below `MIN_SEATS`, so the deadline would refund |
| ~22:05Z | the project owner's wallet is unavailable; T7 is stood down |
| **22:03:29Z** | **a second stranger registers — `3VdrP4TALScfjinh4Y8fLjt1…` — taking the pool to exactly 40** |
| 2026-09-27 01:46:04Z | the pool seals at its deadline and plays |

The stand-down and the second entry crossed in the post: the entry landed two minutes before the
decision was taken, and neither of us knew.

## Why it cannot be stopped

Read from the program, not assumed:

- `refund.rs:75` — `trigger_refund` requires `pool.entrants < pool.min_seats`. At 40 it is
  unavailable.
- `seal.rs:64` — `seal_at_deadline` requires `pool.entrants >= pool.min_seats`. Satisfied.

There is no instruction that removes an entrant and no admin path that cancels a pool — by
design, and correctly so. **Pool 36 plays.**

## Why it is not T7

T7's frozen plan describes a 64-seat field: 63 named wallets and one stranger, including both
founder accounts and two flags placed before payout. Pool 36 will settle with 40 seats, **two**
strangers, no founder seats and no flags. Scoring it against `T7.plan.json` would report enormous
drift and mean nothing — the pool that ran is not the pool that was predicted.

`T7.plan.json` is therefore **unspent and byte-identical**, and T7 proper needs a new plan and a
new freeze for a later pool.

## What it still demonstrates, derived before the seal

Computed over the 38 seats actually seated (`scorePool` on the frozen sets), with both strangers
left free:

| claim | value |
|---|---|
| **W00 and W01** | **511 half-points, 756 zones each — identical** |
| **U1, unconditional** | identical battle sets return identical comparisons against every third player, so the two walls tie and share a rank **whatever the strangers played**. This is the claim T7 was built around and it holds here untouched. |
| **U2, holds at this size** | best capped seat 292, ceiling 320 with both strangers at maximum; wall floor 511. **320 < 511.** |
| the one conditional | a stranger takes rank 1 only by winning 4 of its 7 battles against a wall. Otherwise the walls are rank 1 and split the 4 SOL pot **2000000000 each, remainder zero**. |

If that holds, pool 36 is the **first pool on this cluster to pay two seats**. Every scored pool
before it paid exactly one. It is also a **deadline seal at exactly `MIN_SEATS`**, which is T3's
path re-run on the **Phase B** build — a free regression check across a program upgrade.

`duplicate_sets` should fire **strong** on W00 and W01 and name both in the report's `hardBlocks`,
and **both must be paid normally** — ruling D-E9 says that list is read by nothing that moves
money.

## To be filled in after 2026-09-27T01:46:04Z

- [ ] seal instruction and block time; `seal_at_deadline`, not `trigger_refund`
- [ ] final entrant count (40, or more if further strangers arrive)
- [ ] W00 and W01's actual scores, zones and rank; whether the tie held
- [ ] the split: amounts paid, and the remainder
- [ ] both strangers' revealed allocations, and their scores
- [ ] the detection report: `duplicate_sets`, `hardBlocks`, and that nobody was blocked
- [ ] results root recomputed from the revealed sets vs the root on chain
- [ ] the vault after settlement, and the treasury before and after
