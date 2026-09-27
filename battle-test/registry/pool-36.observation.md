# Pool 36 — an observation, not a test

**T7 did not run.** This records what pool 36 did anyway. It is filed the way pool 22 was: an
observation with no verdict, rather than a test with a pass or a fail. `T7.plan.json` is
byte-identical and unspent.

## A correction, first

While the pool was still open I reported that **a second stranger** had entered at 22:03:29Z and
taken it to 40. **That was wrong.** The 40th entrant was **UI-A — the project owner's own
account.** I had checked the registering signature against my headless register log, found it
absent, and concluded "not ours"; UI-A enters through the app, so it was never going to be in that
log. The reasoning was lazy and the claim went into four files and a message before the reveal
corrected it.

Only ever **one** stranger entered pool 36: `CRCK62mRC4zxsFRAx41g4MbQzGqsJQD3SURM7Te4VnhW`, on
chain seat 0, at 15:35:48Z — exactly the one `T7.plan.json` was written around.

## How it ended up here

| when | what |
|---|---|
| 2026-09-26 13:46:04Z | pool 36 created, tier 0, easy mode |
| 15:35:48Z | one wallet that is not ours registers |
| 19:11:47Z | `T7.plan.json` written, naming pool 36 and accounting for that stranger |
| 19:41:55Z | the freeze merges (PR 189) — **2 h 8 min before our first entry** |
| 21:50:03Z → 21:52Z | 38 headless seats land, W00..W37. **Stopped at 39 deliberately**, below `MIN_SEATS`, so the deadline would refund |
| **22:03:29Z** | **UI-A registers**, taking the pool to exactly 40 |
| ~22:08Z | the project owner reports the wallet is unavailable; T7 is stood down |
| 2026-09-27 01:46:04Z | deadline |
| 01:46:16Z → 01:46:20Z | `SealAtDeadline` → `RevealPoolSecret` → `CommitResults` → `PayPrizes` |

At 40 the refund path closed (`refund.rs:75` requires `entrants < min_seats`) and the seal path
opened (`seal.rs:64` requires `>= min_seats`). The margin I had left was removed by the project
owner's own account, not by an outsider.

UI-A entering at 22:03:29Z and the wallet being reported unusable five minutes later are
consistent: the app signs in through Privy with an embedded wallet, while the reviewer key is a
separate external wallet. **The play path worked; the reviewer path did not.** That is what
blocked T7 — not the ability to enter.

## The settlement

`SealAtDeadline` fired 12 seconds after the deadline. **`TriggerRefund` does not appear.** Four
seconds from seal to payout.

| | |
|---|---|
| state | **Paid**, 40 entrants |
| **W00** | rank **1**, score **537**, zones **797**, paid **2000000000** |
| **W01** | rank **1**, score **537**, zones **797**, paid **2000000000** |
| best non-wall | W15, rank 3, score 313 |
| the stranger | rank 39, score 193 |
| **UI-A** | rank **40**, score **185**, last |
| vault after | **650240** — exactly the rent cushion |
| treasury | 7579842560 |
| flagged / holds / refunded | **0 / 0 / 0** |

**The first pool on this cluster to pay two seats.** Every scored pool before it paid exactly one.
The pot split 2000000000 / 2000000000 with **zero remainder**.

## What was predicted before the seal, and what happened

Derived over the 38 seats then seated, with the two unknown seats left free:

| claim | predicted | actual |
|---|---|---|
| **U1** — the two walls tie, unconditionally | identical score **and** zones, whatever anyone else plays | **537 and 797, identical.** Held. |
| wall score range | 511 + 0..28 → **511..539** | **537** |
| **U2** — no capped seat outscores a wall | capped ceiling **320** vs wall floor 511 | best was **313**. Held, with room. |
| the split | 2000000000 each, zero remainder | **exact** |
| vault after | 650240 | **650240** |

**U1 is the claim T7 was built around, and it is now demonstrated on a real pool, with real
lamports, against a field containing an entrant nobody controlled.** It needed no wallet, no flags
and no plan match.

## Verifiability

- **Results root recomputed from the 40 revealed sets: `ed732b54eedf6c20227d03d9a141e6dabeaa6a28b57902cd3537886318b009c6` — MATCHES the root on chain.**
- All **40 of 40** revealed allocations reproduce the `battles_hash` the chain recorded at entry.
- All **40 of 40** seats' rank and amount reproduce from the published sets alone.
- The bundle is published at `https://gateway.irys.xyz/36Y9vL9PPQqtvXQHk4kYdwHqgNiuU31ZAU4UAsNeYibw`.

## §H13 recurs, a fourth time

**UI-A played the even split in all seven battles** — 20/20/20/20/20 throughout, the buzzer's
default for an untouched board. It came last, at 185. Every unconditional claim survived it,
because an even split is five stats none above 25 and so the capped-seat premise still applied.

The stranger, by contrast, played a genuinely varied set (maxima of 37, 31, 30, 29, 28) and scored
193 — eight half-points above the founder's seat and still rank 39 of 40.

## What this does NOT show

- **No same-device finding.** It needs both founder accounts from one browser; only UI-A entered.
- **Nothing of the review path** — no flag, no escrow, no release, no forfeit, no next-place. That
  is the whole of T7's second half and the reason T7 still has to run.
- `duplicate_sets` is expected to have fired `strong` on W00/W01 and to have named both in the
  report's `hardBlocks` with neither blocked; the detection report is reviewer-only and was not
  read, so that is **unverified here** rather than confirmed.
