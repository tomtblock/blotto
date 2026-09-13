# Deploying the fill-rule change (R7-b) — the founder's runbook

**What this covers:** the program upgrade that moves the minimum field to 40 and adds `min_seats` to
every pool, and the one-off migration each existing pool needs afterwards.

**Why it needs a runbook at all:** the upgrade makes every pool account two bytes short of what the
new program expects, and Solana programs refuse a short account rather than guessing. Between the
upgrade and the migration, **every instruction touching an existing pool fails** — `register`, which
is the one players use, and the two that pay people (`pay_next_place` and `release_escrow`, which run
on pools that have already paid). The order below is what keeps that window to minutes.

---

## Do this when no pool is taking entries

**This is the one part of the order that is not obvious, so it comes first.**

A pool that is open when the upgrade lands keeps the floor it opened under — 52, written by the
migration, because 52 is the number its players actually entered under. The site does not read that
number; it reads the shared one, 40. So for as long as such a pool stays open, **the site can say
"this pool will play" about a pool the chain is going to refund** — any pool sitting between 40 and
51 seats at its deadline.

Upgrading only when nothing is open removes the disagreement entirely: every live pool then has the
same floor the site shows. (The durable fix is to publish each pool's own floor so the site never has
to assume. That is on the list for before mainnet; until then, this order is the guarantee.)

Pools close on their own at their deadline, every twelve hours. So:

1. **Wait for the open pool to close.** `npm run admin -- pools` shows you when.
2. **Stop the daemon as soon as it does.** It opens the next pool within five minutes, and it holds
   the keeper key — so stopping it is what actually prevents a new pool. Pausing does *not*: pause
   blocks entries, not opens.
3. Now you have as long as you need.

### The calmer version, when the open pool has no entrants

Steps 1 and 2 put you in a five-minute race: the pool closes on its own, and the daemon
opens the next one **300 seconds** later (`DEFAULT_COOLDOWN_SECS`). Miss it and you wait
another twelve hours. You do not have to run that race.

`trigger-refund` is **permissionless** — any funded key may call it, and the program
checks the state and the deadline itself, so a mistimed call is refused rather than
harmful. A pool with **no entrants** goes **straight to `Closed`** in that one
transaction, with no per-player refunds to follow
(`programs/blotto_cup/src/instructions/refund.rs`). So:

1. **Stop the daemon first**, any time before the deadline. Nothing can open a new pool
   while it is down, and the pool already open simply sits there.
2. Wait for the deadline to pass. `npm run admin -- pools` shows you when.
3. Close it yourself:

   ```
   export FEE_PAYER_KEYPAIR=/path/to/deploy-keypair.json
   npm run admin -- trigger-refund --pool-id <the open pool's id>
   ```

   It returns the pool's untouched prize amount to the treasury and sets the pool to
   `Closed` in the same transaction.
4. Carry on from "Before you start". Nothing is open, nothing can open, and the timing
   is entirely yours.

**Check `entrants` first — this is only for a pool with none.** A pool holding entries
below its floor goes to `Refunding` instead and needs one `refund --player` per entrant
before it reaches `Closed`; `Refunding` is exactly what the drain check refuses. With
entrants, use steps 1–2 above and let the daemon do its own work.

## Before you start

```
npm run admin -- pools --upgrade-preflight
```

The flag matters. Without it this is the ordinary status command and it only checks for pools
**mid-settlement** (Sealed, Scored or Refunding) — a pool caught mid-settlement by an upgrade is the
one case where the migration is not simply a formality. With the flag it *also* refuses while any
pool is taking entries, which is the rule above.

Both must read CLEAR. If either refuses, it names the pool ids; clear those first.

Write down the pool ids it lists. You need every one of them in step 3.

**Have both keys to hand.** They live outside this repository and nothing here can
supply them:

- `BLOTTO_PROGRAM_KEYPAIR` — the program's own keypair. Step 1 refuses to run if its
  public key is not the program id, so a wrong file stops the deploy rather than
  stranding every client under a new id.
- `BLOTTO_DEPLOY_KEYPAIR` — the key that pays for the deploy and holds the upgrade
  authority. Step 3 needs the same key under the name `FEE_PAYER_KEYPAIR`.

**Why there is no "pause" step.** `docs/OPERATING-MANUAL.md` §4 says to pause before a
program deploy. That rule is for an upgrade landing while a pool is taking entries —
which this sequence forbids outright. With nothing open there are no entries to block,
and pausing would not help anyway: it does not stop the next pool opening. Stopping the
daemon does.

---

## Step 1 — Upgrade the program

The usual deploy — nothing about it is special to this change:

```
BLOTTO_PROGRAM_KEYPAIR=/path/to/program-keypair.json \
BLOTTO_DEPLOY_KEYPAIR=/path/to/deploy-keypair.json \
  ./scripts/deploy-devnet.sh
```

It builds, upgrades, applies any pending database migrations and re-derives the
projections. Before it touches anything it reads the program's on-chain upgrade
authority and stops if that is not the key you gave it — so the day the authority moves
to the Squads vault, this step says so in one line instead of failing deep inside the
Solana CLI. (`docs/OPERATING-MANUAL.md` §4 has the procedure that replaces it then.)

## Step 2 — Confirm the new program is live

```
npm run check-deployed
```

## Step 3 — Migrate every pool

First set `FEE_PAYER_KEYPAIR` to the same key as step 1 — the command stops with
`FEE_PAYER_KEYPAIR is not set` otherwise:

```
export FEE_PAYER_KEYPAIR=/path/to/deploy-keypair.json
```

Then once per pool id from the list you wrote down:

```
npm run admin -- migrate-pool --pool-id 1
npm run admin -- migrate-pool --pool-id 2
…
```

It is **permissionless** — no Squads proposal, no admin key — so you can run it straight
through. It prints the account's current size first, and a pool already at the new layout is reported and
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

## Step 5 — Start the daemon again

It opens the next pool on its usual cooldown. That pool, and every pool after it, gets a floor of
**40** — and because nothing was open across the upgrade, the floor the site shows is now the floor
every live pool actually has.

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
