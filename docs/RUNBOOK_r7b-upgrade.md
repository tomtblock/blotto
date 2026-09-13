# Deploying the fill-rule change (R7-b) — the founder's runbook

**What this covers:** the program upgrade that moves the minimum field to 40 and adds `min_seats` to
every pool, and the one-off migration each existing pool needs afterwards.

**Why it needs a runbook at all:** the upgrade makes every pool account two bytes short of what the
new program expects, and Solana programs refuse a short account rather than guessing. Between the
upgrade and the migration, **every instruction touching an existing pool fails** — including the two
that pay people (`pay_next_place` and `release_escrow`, which run on pools that have already paid).
The order below is what keeps that window to minutes.

---

## Before you start

```
npm run admin -- pools
```

This lists every pool and its state, and **exits with an error if any pool is mid-settlement**
(Sealed, Scored or Refunding). If it does, stop: finish those pools first. A pool caught mid-settlement
by an upgrade is the one case where the migration is not simply a formality.

Write down the pool ids it lists. You need every one of them in step 3.

---

## Step 1 — Upgrade the program

The usual deploy. Nothing about it is special to this change.

## Step 2 — Confirm the new program is live

```
npm run check-deployed
```

## Step 3 — Migrate every pool

Once per pool id from the list you wrote down:

```
npm run admin -- migrate-pool --pool-id 1
npm run admin -- migrate-pool --pool-id 2
…
```

It is **permissionless** — no Squads proposal, no admin key — so you can run it straight through.
It prints the account's current size first, and a pool already at the new layout is reported and
skipped, so re-running it is safe and running it on the wrong id does nothing.

Each pool is given a floor of **52** — the number its players entered under. New pools opened after
the upgrade get 40. That is deliberate: the whole point of storing the floor per pool is that a
change to the rule never moves it under people who have already entered.

## Step 4 — Check nothing was missed

```
npm run admin -- pools
```

Every pool should read normally. If one errors, it has not been migrated — go back to step 3 for
that id.

---

## What changes for players after this

- A pool now runs with **40** seated at its deadline instead of 52. It still runs the moment the
  64th seat fills, and still refunds every entry in full below the floor.
- The deadline is unchanged at 12 hours.
- The prize is unchanged: 4 SOL at the 0.1 SOL tier, to one winner.

**Forty is exactly break-even.** A pool that runs with forty players takes in precisely what it pays
out. That was your decision of 2026-09-13, on the ground that the prize is funded from the treasury
before entries open. The consequence to keep in view: pools running at the floor return nothing, so
no number of them accumulates towards opening the next tier — only seats above forty do.
`docs/CHANGE-2026-09-12_sim-report.md` measures how often pools are likely to run at all.

---

## If you need to go back

Reverting the program after step 3 is **not** a simple redeploy: the migrated pools are two bytes
longer than the old program expects, so it would refuse them exactly as the new program refuses
un-migrated ones. A rollback therefore needs every pool drained to a terminal state first. Deciding
to revert before step 3 is cheap; after it, it is not.
