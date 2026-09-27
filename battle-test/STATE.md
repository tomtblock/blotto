# STATE — 2026-09-27 13:15 UTC — by Claude Code

Phase:            **T7 stood down; pool 36 played anyway and proved T7's central claim.** The
                  half that needs a wallet is still unproven.
Waiting on:       **the project owner's reviewer wallet.** Nothing else blocks T7.
Blocked:          T7's same-device half and its whole review path — both need a signature.
Results so far:   T1 **PASS** · T3 **PASS** · T4 **PASS** · T5 **PASS** · **T6 PASS\*** ·
                  T2 **SPOILED** · T2R **PASS (7 of 8)** · pool 22 and **pool 36** =
                  observations, not tests
Money:            W00 and W01 hold **2.003558920** each, having been paid 2 SOL apiece ·
                  pool 36 vault **650240** · treasury 7579842560 · wallets not yet swept
Open PR:          none — 189 and 191 both merged.
Parallel session: **program development** — `session_01CosZsm5MB312HdbJH6y2zJ`, branch
                  `claude/program-dev`. Separate lane, no overlap.

## What happened

T7 was stood down at 22:10Z: the reviewer wallet was unavailable, and both halves of the test —
the same-device finding and the escrow / release / forfeit path — need it. Pool 36 then sealed and
played anyway, because it had reached exactly `MIN_SEATS`.

**Pool 36 settled at 01:46:20Z and every prediction held.**

| | predicted | actual |
|---|---|---|
| **W00 / W01** | tie, identical score **and** zones, unconditionally | **537 and 797 apiece — identical, rank 1** |
| the split | 2000000000 each, zero remainder | **exact** |
| wall score | 511..539 | **537** |
| best capped seat | ceiling 320 | **313** |
| vault after | 650240 | **650240** |

**The first pool on this cluster to pay two seats.** Every scored pool before it paid one. The
results root recomputed from the 40 revealed sets **matches the chain**, all 40 allocations
reproduce their committed hashes, and all 40 ranks and amounts reproduce from published data
alone.

So **U1 — the claim T7 was built around — is demonstrated**, on a real pool with real lamports and
an entrant nobody controlled. Filed as `registry/pool-36.observation.md`; `T7.plan.json` is
byte-identical and unspent.

## A correction I owe

While the pool was open I reported that a **second stranger** had taken it to 40. **Wrong.** The
40th entrant was **UI-A, the project owner's own account.** I checked the signature against my
headless register log, did not find it, and concluded "not ours" — but UI-A enters through the
app and was never going to be in that log. The claim reached four files and a message before the
reveal corrected it. Only one stranger ever entered pool 36: the one the plan was written around.

It leaves a useful fact. **UI-A registered at 22:03:29Z, five minutes before the wallet was
reported unusable.** The app signs in through Privy with an embedded wallet; the reviewer key is a
separate external wallet. **The play path worked and the reviewer path did not** — which is
exactly why T7's flags were blocked while an entry was not.

## Still unproven, and still T7's job

- the **same-device finding** — needs both founder accounts from one browser window
- the **review path** end to end: flag → escrow → release → forfeit → next-place

§H13 recurred a fourth time: UI-A played the even split in all seven battles and came last at 185.
Every unconditional claim survived it, because an even split is five stats none above 25.

## Next

1. Sweep the wallets back to the funder.
2. When there is a working reviewer wallet: a **new plan and freeze** for a fresh pool —
  `T7.plan.json` names pool 36 and cannot be reused. Sequence it the other way round: the project
  owner's seats first, then one fast fill to capacity, so no margin sits open waiting.
3. §H34 records the two findings worth keeping — the review path fails **open** on a reviewer
  outage, and a stop-short margin only holds if I control the entrant count, which I do not.
