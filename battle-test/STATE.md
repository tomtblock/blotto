# STATE — 2026-09-26 22:30 UTC — by Claude Code

Phase:            **T7 stood down — no wallet to sign with.** Pool 36 will nevertheless seal and
                  play at 01:46:04Z, because a second stranger took it to exactly MIN_SEATS.
Waiting on:       **the project owner's wallet.** Nothing else blocks T7.
Blocked:          T7's two founder entries and its two flags — both need a signature.
Results so far:   T1 **PASS** · T3 **PASS** · T4 **PASS** · T5 **PASS** · **T6 PASS\*** ·
                  T2 **SPOILED** · T2R **PASS (7 of 8)** · pool 22 and **pool 36** =
                  observations, not tests
Money:            funder **~4.3** after 38 entries · W00..W37 seated in pool 36 · the pot is
                  4 SOL and pool 36 will pay it
Open PR:          none — 189 and 191 both merged.
Parallel session: **program development** — `session_01CosZsm5MB312HdbJH6y2zJ`, branch
                  `claude/program-dev`. Separate lane, no overlap.

## Where this actually stands

**T7 is stood down and that was the right call**, but it does not mean nothing happens tonight.

The project owner's wallet is unavailable. T7 needs a signature twice — once for the two founder
entries that create the same-device finding, once for the two flags that make the prize-review
path run — so both halves are blocked. Running the rest would spend the frozen plan on the part
four earlier tests already largely proved, and skip the part that §H33 had just shown nothing has
ever exercised. So: stand down.

**Then the ground moved.** At 22:03:29Z a second wallet that is not ours registered in pool 36,
taking it from the 39 I had deliberately stopped at to exactly 40 — `MIN_SEATS`. That entry landed
two minutes before the stand-down decision; neither of us knew. At 40 the refund path closes
(`refund.rs:75` requires `entrants < min_seats`) and the seal path opens (`seal.rs:64` requires
`>= min_seats`). **Pool 36 seals and plays at 01:46:04Z and nothing anyone does can stop it.**

**It is recorded as an observation, not as T7** — `registry/pool-36.observation.md`, the way pool
22 was. Its field cannot match the frozen plan: two strangers instead of one, no founder seats, no
flags. `T7.plan.json` stays byte-identical and unspent.

## What pool 36 will show anyway

Derived over the 38 seats actually in, before the seal:

- **W00 and W01 both stand at 511 half-points and 756 zones — identical.** U1 was always
  unconditional and it survives the change of field: identical battle sets return identical
  comparisons against every third player, so the two walls tie whatever the strangers played.
- Best capped seat 292, ceiling 320; wall floor 511. **U2 holds.**
- Unless a stranger wins four of its seven battles against a wall, the walls take rank 1 and
  **split the pot 2000000000 each, remainder zero — the first pool on this cluster to pay two
  seats.** Every scored pool before it paid exactly one.
- It is also a deadline seal at exactly `MIN_SEATS`, which re-runs T3's path on the **Phase B**
  build. A free regression check across a program upgrade.

## The two findings worth keeping (§H34)

1. **A reviewer-wallet outage takes the whole review capability offline, and it fails open.** Two
   reviewers are configured but both resolve to one wallet stack. With no signer, nothing can be
   flagged, released or forfeited — and `daemon.ts`'s twelve-hour clock then **auto-releases** any
   held share to its player. On mainnet that pays a flagged winner because someone's wallet broke
   on the wrong evening. Worth a genuinely independent second reviewer, and worth ruling
   deliberately whether that clock should fail open or fail held. It currently fails open by
   omission.
2. **Naming a pool in a frozen plan inherits its strangers — and holding a pool part-filled is the
   exposure.** That second one is mine: I sequenced the fill to stop short and wait for the
   founder, and every minute a pool sits part-filled is a minute the field can change. The re-run
   wants the founder's seats first, then one fast fill to 64.

## The re-run

T7 needs a new plan and a new freeze for a fresh pool — `T7.plan.json` names pool 36 and its seat
count, so it cannot be reused. About an hour of work, once there is a wallet to sign with. The
flag control shipped and is live in production, so the blocker §H33 found is already fixed.
