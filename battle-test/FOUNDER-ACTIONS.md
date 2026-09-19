# FOUNDER ACTIONS — the catalogue

Every action Claude Code asks for is defined once here: why it exists, the exact steps, what to send
back, and what not to do. Written to be followed cold. Times are **local (UTC−3)**.

**Numbering.** `P-nn` are preparation actions invented this session. `F-nn` are the manual's §3.1
catalogue, renumbered where the drift check (`DRIFT.md`) removed or merged an action.

**Deleted from the manual's catalogue, and why** — all three from `DRIFT.md` §G2:
- **F-03** (merge the change-control PR, deploy) — the 12-hour deadline is already live on chain, and
  `check-deployed` confirms the deployed program matches this branch. Nothing to merge, nothing to deploy.
- **F-04** (`set-tier-economics --tier 1`) — tier 1 is not used, and this command would make tier 1
  permanently unopenable by putting it out of step with the ratified table.
- **F-11** (`set-open-tiers`) — tier 0 is already open and is the only tier the week uses.

---

## Done

| ID | What | Result |
|---|---|---|
| P-01 | Confirm the WP0 plan; answer Q1–Q5 | done 2026-09-15. Matrix remapped, product PR dropped, `www.blotto.gg` confirmed |
| P-03 | Store the master seed | done. `BLOTTO_BT_SEED` is in the founder's password manager |
| P-04 | Supply a dedicated devnet RPC | done. Helius devnet endpoint; recorded in the container only, provider name only in `ENVIRONMENT.md` |
| F-01 | Faucet into the funder | **partial — 10 SOL of ~18.** Enough for T1; more needed before the first full pool (see F-01b) |
| F-02 | Create the UI accounts | done, **two not three**: UI-A `7fpa…YPve` (4.99 SOL), UI-B `6wqL…u3sa` (9.99 SOL). Both already funded, so no top-up needed |

---

## F-01b — more faucet, before the first full pool

**When:** any time before Wednesday 11:00. Not urgent tonight.
**Why:** T1 needs ten headless wallets and they are funded. A **full** pool needs 64 entrants at
0.104436 SOL each, about 6.7 SOL per pool, and the wallets are topped up to 0.2 SOL each — so funding
all 64 costs about 12.8 SOL and the funder now holds 8.0. Money recirculates after each pool
(`fan-out sweep`), so this is a one-time hump, not a per-pool cost.

**Do:** more faucet rounds into `6z4wriiac4d6bay57Pe4Gj3jxhjeT9HfbcH2VaM4r3Ue` until it holds **14 SOL**.
**Send back:** "F-01b done" and the amount. Claude Code confirms the balance on chain.

---

## F-12 — T1 entries (the first real test)

**When:** from **22:46 tonight**, as soon as Claude Code confirms the new pool is open and says GO.
**Est:** 12 minutes for both accounts.
**Why now:** pool 13 closes at 22:41 with nobody in it, and the daemon opens the next tier-0 pool
about five minutes later. That new pool is **T1**, and its 12-hour clock starts the moment it opens,
so it closes about **10:46 on Wednesday**. Its plan is frozen in GitHub before any entry.

**Wait for Claude Code's GO.** The plan freeze must be merged before the first entry or the pool is
marked `UNFROZEN` and proves nothing.

**What T1 is testing.** A pool holding fewer than 40 players at its deadline refunds every entry in
full. You are two of twelve entrants, so the pool is well below the floor and must refund.

**Do, for UI-A then UI-B, each in its own browser profile:**
1. Go to `https://www.blotto.gg` and sign in with **Continue with Google** for that account.
   There is no email-and-password login: the app offers Google, Apple, X and wallet only.
2. Open the pool Claude Code names and press **Enter this tournament**.
3. First time only: the **two-statement clickwrap** appears. Tick both statements, press confirm, and
   sign the message in your wallet. Screenshot it.
4. Press **Make my first Blott**. Nothing is timed yet.
5. Play all seven battles **naturally** — there is no target shape for T1, and nothing is scored.
   The control is five sliders, not the old pentagon. Moving any dial re-apportions the other four so
   the five numbers always total 100. **The 90-second clock for all seven battles starts the instant
   you first move a dial**, so do not wander off mid-run.
6. Press **Lock in battle N** after each one. A tile fills in the rack below the machine.
7. At **"All seven made."**, screenshot the rack — that one image is the record of all seven allocations.
8. Press **Seal my allocation**, then **Confirm — seal and submit**, and approve in your wallet.
9. Screenshot the **pass card** (it shows `Seat N of 64`) and then the **Sealed** panel.

**Send back:** the two transaction signatures, the screenshots into
`battle-test/evidence/T1-pool-<id>/UI-A/` and `/UI-B/`, and the words "F-12 done".

**Do not:**
- enter any pool other than the one Claude Code names — a stray entry locks the tier for 12 hours;
- enter before the GO;
- sign in to both accounts in the **same** browser profile. They must differ for T1. (One shared
  profile is the whole point of T7, later, on purpose.)
- use a private window.

---

## F-19 — T1 deadline, about 11:00 Wednesday

**When:** from **10:46 Wednesday**, about fifteen minutes after the deadline so the refunds have landed.
**Est:** 10 minutes.
**Why:** this is the evidence that the refund reached a real player, not just the chain.

**Do:**
1. Open the T1 pool page. Screenshot it — the state pill should read **Refunding** and then **Closed**.
2. Open the Profile or wallet page for **UI-A** and screenshot the balance. Repeat for UI-B.
3. Note: a refunded entry leaves **no row on the Profile**. The balance and the pool page are the
   evidence. Do not go looking for a refund entry in your history; there is none by design.

**Send back:** the screenshots and "F-19 done". Claude Code has already harvested the balances from the
chain and will tell you whether they match.

**Expected, so you can check rather than guess:** each account is up exactly **0.1 SOL** from its
post-entry balance, and down about **0.0044 SOL** against where it started, which is the account rent
and fees the program keeps. That gap is the documented, never-recovered cost of an entry.

---

## F-21 — T4 entries: the first pool that actually pays (pool 15)

**When:** as soon as you have merged the freeze (step 1 below). Pool 15's deadline is **01:52:26Z**,
which is **22:52 Tuesday your time** — but do not wait for it: the pool seals the moment the 64th
entry lands, and settles minutes later.
**Est:** 5 minutes to merge, then about 10 minutes for the two entries.
**Why:** T4 is the first test that is scored and the first that moves a real prize. 4 SOL goes to one
wallet, and that wallet is **yours** — by arithmetic, not by luck.

### Step 1 — merge the freeze. This has to come first.

Merge **PR 133** in the repository — the one titled "battle-test: T4's plan, frozen". (Its link is
not written out here: a GitHub PR URL contains a word the §8.7 gate refuses, and the gate makes no
exception for links.)

That merge is what makes T4 evidence rather than a story: GitHub's merge timestamp proves the
prediction existed before anybody entered, and it cannot be rewritten from inside this repository.
**Nobody may enter pool 15 until it is merged** — not you, not the headless wallets.

### Step 2 — your two entries, in this order

Open **https://www.blotto.gg**, sign in as **UI-A**, and enter **pool 15**. Then do the same in the
**other browser profile** as **UI-B**. Separate profiles, as for T1. No private windows.

The clock: **90 seconds for all seven battles together**, starting the instant you first move a dial.
It is not 15 seconds a screen. If it runs out, every battle you have not locked in is entered as an
even 20/20/20/20/20 — which would break the prediction. So move, lock, move on.

**UI-A — two drags per battle. Drag the named stat to zero, then the next one, then lock in.**

| battle | drag to 0 | then drag to 0 | you should see |
|---|---|---|---|
| 1 | Strength | Speed | 0, 0, 34, 33, 33 |
| 2 | Speed | Heart | 34, 0, 0, 33, 33 |
| 3 | Heart | Wit | 34, 33, 0, 0, 33 |
| 4 | Wit | Durability | 34, 33, 33, 0, 0 |
| 5 | Durability | Strength | 0, 34, 33, 33, 0 |
| 6 | Strength | Heart | 0, 34, 0, 33, 33 |
| 7 | Speed | Wit | 34, 0, 33, 0, 33 |

**UI-B — one drag per battle. Drag the named stat to 100, then lock in.**

| battle | drag to 100 | you should see |
|---|---|---|
| 1 | Strength | 100, 0, 0, 0, 0 |
| 2 | Speed | 0, 100, 0, 0, 0 |
| 3 | Heart | 0, 0, 100, 0, 0 |
| 4 | Wit | 0, 0, 0, 100, 0 |
| 5 | Durability | 0, 0, 0, 0, 100 |
| 6 | Heart | 0, 0, 100, 0, 0 |
| 7 | Strength | 100, 0, 0, 0, 0 |

The stat order on screen is always Strength, Speed, Heart, Wit, Durability.

**If a number comes out one or two off** — say 33 where the table says 34 — that is fine and changes
nothing. What matters is the SHAPE: UI-A needs three stats at 26 or more in every battle, UI-B needs
everything on one stat. The exact numbers only affect a secondary check, and the reconciliation
records the difference rather than failing the test.

### Step 3 — send back

The two transaction signatures, screenshots of each rack at "All seven made." and of each pass card,
into `battle-test/evidence/T4-pool-15/UI-A/` and `/UI-B/`, and the words **"F-21 done"**.

Then I run the 62 headless seats. The 64th entry seals the pool on the spot and the daemon scores
and pays within minutes.

### What should happen, so you can check rather than take my word for it

- **UI-A finishes first and is paid the entire 4 SOL pot.** One paid place, not sixteen.
- **UI-B finishes 64th**, last of 64, and is paid nothing.
- UI-A ends up about **3.8956 SOL** better off than before it entered; UI-B about **0.1044** worse.
- The pool page reads **Paid**.
- You will likely see an internal review alert fire on UI-A. That is correct and expected — UI-A is
  wildly unlike the rest of the field, which is the whole point. It is an alert, not a block, and it
  does not delay the prize.

### Do not

- enter any pool other than 15 — a stray entry locks the tier for 12 hours;
- enter before PR 133 is merged;
- sign in to both accounts in the same browser profile;
- use a private window.

---

## F-20 — a decision, whenever you like. Nothing waits on it.

A refunded pool never publishes its sealing secret. The program allows it and says why in its own
code; no code path asks. Details in `REPORT.md` §2, finding F-1.

Nobody lost money and no test failed. What it costs is this: a player whose pool refunds gets their
money back but cannot check that their sealed allocation stayed sealed — they have to take our word
for it, on the one point the design exists to put beyond anyone's word.

The fix is a few lines in the settlement daemon. It is outside this test's boundary, so I have
written it down rather than made it. **Your call, after the week: product change, or accepted?**

---

## F-22 — the entry gate is refusing everyone. One log line says why. **Blocks T4.**

**When:** now, if you can. T4 cannot run until this is fixed.
**Est:** 5 minutes to read the log. The fix depends on what it says.

### What is happening

Your entry was not rejected because of anything about your account. **Every entry is being
refused** — I tested from here with wallets I control and got the same refusal for all of them,
including a wallet that entered pool 14 successfully at 03:18 your time this morning, on both
pools, with a fresh and accepted age-and-terms confirmation.

Nothing was signed, nothing was charged, and nothing entered the pool. You are not out a lamport.

### The part that matters beyond this test

The entry service's health check **says everything is fine**. It reads `ok: true` and reports its
sanctions screening as loaded, right now, while refusing every entry in the world. The flag it
reports is set once when the service starts and is never turned off again — not when a background
refresh fails, not when the data goes too old to use.

So a monitoring dashboard, a status page and an uptime check would all show green through a total
entry outage. On devnet that costs us a test. On mainnet that is every entry failing while every
instrument says the platform is healthy. I think this is the most serious thing the battle test has
turned up, and it goes in the report regardless of how quickly it is fixed.

### Do — read the log before touching anything

Open the entry service's recent logs (the `blotto-packet` service on Fly) and look for lines
containing:

- `entry packet NOT issued` — this is the refusal, printed once per attempt, with the reason
- `mirror refresh FAILED` — the background download of the sanctions list has been failing
- `mirror is` … `h old` — the list has gone past its 36-hour limit and now refuses to answer

**Send me back those lines** (or just tell me which of the three you see).

Two causes fit everything I can see from outside, and the log separates them:

1. **The sanctions list has gone stale.** It refreshes every nine hours; if those refreshes have
   been failing, the old copy keeps working until it is 36 hours old and then refuses outright —
   which closes the gate for everybody, exactly like this.
2. **The signing key for entry packets is failing.** Same generic refusal from outside.

### Do NOT just restart the service

If the sanctions list download is the broken part, restarting makes things **worse**, not better:
the service refuses to start at all when that list is its only screening source, on the principle
that a service which starts there screens nobody. You would turn a closed gate into a dead site.

Read the log first. If it is the stale list, the fix is to get the download working again and then
restart. If it is the signer, restarting may well clear it.

### What happens to T4 meanwhile

Nothing is lost. The plan is frozen and stays frozen; the 62 wallets stay funded; I have entered
nothing.

Pool 15's deadline is **22:52 tonight your time**. If the gate is still shut as that approaches,
pool 15 simply refunds and T4 runs on the next pool instead. The frozen plan is reusable exactly as
it is — only the pool id and a new freeze record change, and the prediction does not move. That is a
reschedule, not a failure, and it costs about 0.00065 SOL in pool rent.

---

## F-24 — why your retries cannot work, and what we do instead

**Nothing for you to do right now.** This is the explanation you are owed, and the plan.

### Why it keeps failing

When you played your seven battles during the outage, the app did two things in this order: it
**sealed and stored your allocation**, and *then* asked for permission to enter. The first succeeded.
The second was refused, because Turnkey had stopped signing.

The store deliberately refuses to accept a *second, different* allocation for the same wallet in the
same pool. That protection is right — without it, starting a second run could destroy your own
already-paid entry. But playing again always produces a different sealed allocation, because each
run gets fresh random data. So every retry is refused, and the app shows you the same message it
showed the first time.

There is no way to clear it. I checked: the store can only be written to and read from. Nothing in
the codebase can delete a stored allocation — not the service, not the admin tools.

**So UI-A and UI-B can never enter pool 15.** You have paid nothing and entered nothing. The message
saying "trying again will not change the answer" is, accidentally, exactly right.

### This is the most serious thing the test has found

The outage was a billing problem, fixed in an hour. This is structural: **any** brief failure after
you seal — the service hiccuping, a wallet prompt dismissed, a laptop closing — bars that wallet
from that pool permanently, and tells nobody.

On a live product that means one short entry-service blip does not just fail the entries happening at
that moment. It locks out every player who got as far as sealing, for good, and the pool may then
fail to fill with people who were willing to pay. It turns a ten-minute incident into a lasting
problem and a queue of confused, unhappy players.

It is written up in `REPORT.md` §2 as finding F-4, with two proposed fixes. The honest one: the
overwrite should be refused only once the seat is genuinely registered on the chain, which is the
thing that actually distinguishes a paid seat from an abandoned attempt. **Your call after the week
— it is F-24 in the open items.**

### What happens to T4

T4 needs UI-A to win, and UI-A cannot enter pool 15. So:

1. **Pool 15 lapses** at its deadline, 01:52:26Z — **22:52 your time**. It holds no entries, so it
   simply closes. Cost: one rent cushion, 0.00065 SOL.
2. **The daemon opens the next pool** about five minutes later, around **22:57 your time** — which
   lands almost exactly on your 23:00 cadence.
3. **T4 runs there, unchanged.** The frozen plan is reused as-is: every predicted rank, every score
   and the winner's payout stay exactly as frozen. Only the pool id and a new freeze record change,
   and I will record both.

Nothing is lost. The plan stays frozen, the 62 wallets stay funded, and no test result is affected.

### The one change to how we do it

From now on I probe the entry gate for **your exact wallets, immediately before you play** — never
after. A seal made into a broken gate cannot be undone, so the check has to come first. I will give
you an explicit go-ahead each time, seconds before you start.

**Next contact:** I will tell you when the new pool is open and the gate is confirmed healthy for
both your accounts. Around 23:00 your time.

---

## F-25 — what I built so this cannot happen again, and the one decision left to you

You asked for documentation and a guardrail fix. Both are done. Here is what changed, and the part
that needs your ratification.

### First, a correction you need before mainnet

**Payment infrastructure will not prevent this.** The dry signing quota was tonight's *trigger*, not
the defect. The lockout fires on **any** failure between sealing and registering: a wallet prompt
dismissed, a laptop lid closed, a connection dropped, a browser tab crashed. None of those care
whether the account is funded. Fixing billing removes one cause out of many and leaves the trap
exactly where it is.

Worth having it stated plainly, because "we'll have proper payment infra on mainnet" is the kind of
reassurance that quietly closes a question that is still open.

### What is now protected, inside the test (done, working, proven)

**A go/no-go check before anybody plays.** `scripts/preflight.ts` confirms the pool is open and
ready, that neither account is already seated, and — the important one — that the entry gate issues
a real entry permit **for each of your wallets, against that pool**, which is the exact request your
browser is about to make. It asks for permits and nothing else: nothing is sealed, nothing entered,
nothing spent. From now on you get a go-ahead from me only after this passes, seconds before you
play.

It tells you its own blind spot rather than hiding it: it **cannot** see whether a wallet is already
barred, because nothing in the system can answer that question. Run against pool 15 it says GO for
both your accounts — which are barred. A check that lies by omission is worse than none, so it says
so out loud.

**The headless run now stops instead of repeating the mistake.** If a wallet seals and then fails,
it is burnt, and the runner halts and names it rather than doing the same to the next sixty. I
proved it on pool 15: one wallet sealed and failed, the run stopped, and the next wallet was never
touched. During an outage that is **one loss instead of sixty-two**.

**And I found the same bug in my own tooling.** The runner's "simulate" mode announced that it wrote
no state. It did: it sealed the wallet before simulating, which barred it permanently — it had
already done that to a spare wallet earlier this evening without my noticing. Fixed, and verified by
proving a wallet was still unsealed afterwards. It is written up as a finding against myself
(`DRIFT.md` §H7), because a test whose own instrument has a landmine in it should say so.

### The product fix — specified, not applied. **This is your call.**

The real fix is in the app and the backend, which this week's rules put off limits to me. So I have
written it as a ready-to-apply patch rather than applying it: `battle-test/docs/FIX-seal-lockout.md`.

It turned out **cheaper than I expected**. The entry service already talks to the database that
records who has entered, so the central fix is one extra lookup on a connection it already holds:

1. **Refuse to replace an allocation only once the seat is actually paid for** — that is the thing
   the protection was always aiming at. An allocation with no entry behind it is an abandoned
   attempt, and replacing it harms nobody. This alone removes the lockout.
2. **Ask permission before sealing, not after** — closes tonight's exact sequence. Ship it with (1),
   not instead of it: on its own it narrows the window rather than closing it.
3. **Let a wallet ask whether it is sealed** — today nobody can find out, not you, not a player, not
   a support agent. The wallet signs the question, so this does not open the sealed allocations to
   anyone else.
4. **Stop showing a "you may not enter" message to someone whose entry simply broke.** They are
   different things and the app already has the information to tell them apart.

**▶ Your decision:** do you want me to apply that patch as a separate product PR — which means
touching `app/` and `backend/`, against the boundary you set for this week — or leave it specified
and ship it after the test week ends?

I have not touched either directory. Recommendation: **leave it until the week ends** unless the
lockout blocks another test. It is not blocking T4, the guardrails above stop it recurring inside
the test, and a product change made mid-test muddies what the test is measuring. But it should not
reach mainnet, and if you want it now, say so and I will do it properly with tests.

---

## F-25 — DONE. The seal lockout is fixed.

**Nothing for you to do here.** You said "yes fix seal" and it is written, tested and pushed. All
four parts of F-24's patch shipped as commit `41d592d`.

What changed, in plain terms:

1. **The store now refuses to replace an allocation only when the entry is actually paid for.** If
   your entry broke before it reached the chain, you can simply play again. That is the whole
   lockout, gone — and the protection that matters (nobody, not even you, can overwrite an entry
   the chain has accepted) is untouched and tested.
2. **The app asks for permission before it seals**, not after. A refusal now arrives before anything
   is stored, which is the exact sequence that struck on the 16th.
3. **A wallet can now ask whether it has already sealed.** Nobody could find that out before — not
   you, not a player, not a support agent. The wallet signs the question, so this opens nothing to
   anyone else, and the answer is one yes-or-no and never the allocation itself.
4. **A player whose entry simply broke is no longer told they are not allowed to enter.** They are
   different things and the app now says the true one.

**One thing I got wrong, and want on the record.** The specification I wrote for part 1 had the
wrong database key in it. Had I typed it in as written, it would have matched nothing for anybody,
which the code would have read as "this seat is not paid for" — and it would have allowed exactly
the overwrite the protection exists to prevent. It never shipped: I read the database's own
definition before writing the code, which is the rule for precisely this reason. There is now a test
that uses the wrong key on purpose and fails if anyone reintroduces it.

**One thing that is yours, not mine.** The new message a player sees is my wording, marked in the
code as a proposal. Change it whenever you like.

---

## F-26 — ▶ FOUNDER ACTION: two changes, one branch, and I need your say-so

**What is stuck.** The working branch now holds two unrelated things:

- `ca06c1b` — T2's freeze record. A `battle-test/` file.
- `41d592d` — the seal fix. `app/` and `backend/` files.

The safety check we built for this week fires whenever a change touches `battle-test/`, and then
**refuses that change if it touches anything else.** That check is the guarantee the whole test
rests on: it is what proves the battle test cannot have quietly altered the product it is measuring.
So I will not open one PR containing both, and I will not weaken the check to make it pass.

They need to go up as two separate changes, off two branches. **Pushing to a second branch is
something you told me never to do without asking**, so I am asking.

**▶ Pick one:**

- **(a) Say yes to a second branch (recommended).** I push the seal fix to a branch of its own,
  open both PRs, and you merge them in whatever order you like. Costs you two merges instead of one.
- **(b) Merge the battle-test commit first, from this branch, as it stands.** That PR is
  battle-test-only in content but the branch also carries the product commit, so the boundary check
  would see both and refuse. This does not actually work — I am listing it so you can see I checked.
- **(c) Leave the seal fix sitting on the branch until the test week ends**, then land it on its
  own. Nothing is lost; it just does not reach the product yet.

I recommend **(a)**. The fix is tested and the lockout is the worst thing this test has found — it
is not a defect you want sitting unmerged while the product is being shown to anyone.

**Nothing is waiting on this.** T2 settles on its own at 01:15:58Z tomorrow; no admin key and no
action from you is needed for it.

---

## F-27 — DONE. Two branches, two PRs, no mixing.

You said do the recommendation, so I did.

- **PR 147** — `claude/seal-lockout-fix`. The seal fix only: `app/` and `backend/`, nothing else.
  It does not touch `battle-test/`, so the boundary check does not even fire on it.
- **The battle-test records** stay on `claude/sharp-bohr-c8aeub` and go up as a second PR **after**
  147 merges. I am not opening it yet on purpose: that branch still carries a copy of the seal-fix
  commit, and until 147 is on main the boundary check would see both. Once 147 merges I bring main
  into the branch and its change shrinks to `battle-test/` alone, which is what the check wants.

**▶ Your action: merge PR 147.** Everything below waits on it.

---

## F-28 — ▶ FOUNDER ACTION: get us ready for T6

T6 is the next test that needs nothing from you but two browser sessions. T3 needs an admin write
(pausing entries) and is still blocked on Q6; T7 needs the reviewer key and is blocked on Q7; T8 is
desk work with no pool at all. So T6 is next.

### Step 1 — merge PR 147 (above)

### Step 2 — deploy. **This is not automatic, and I have confirmed it has not happened.**

Merging PR 147 shipped nothing to the entry service. `deploy-backend` only runs when somebody
presses the button — it is a manual workflow, by design. I probed the live service after your merge:

```
POST https://blotto-packet.fly.dev/ciphertexts/status  →  404
```

That 404 is the fix being absent. **The lockout is still live in production right now.** The web app
half does deploy automatically on a merge to main, and that half is harmless on its own — asking for
permission before sealing is strictly better whatever the service is running.

**▶ Run the `deploy-backend` workflow** — GitHub → Actions → "deploy backend" → Run workflow, on
`main`, both checkboxes left unticked.

Worth noting: `/health` answered `ok: true` throughout, exactly as it did during the sixteen-hour
entry outage. It still carries no signal about anything that actually broke. That is finding F-2 and
it has not moved.

`preflight.ts` now checks this for you. It asks the status route per wallet, and when the route is
missing it prints the old lockout warning in full instead of a clean GO — so a stale deployment
cannot be mistaken for a fixed one.

**This is worth more to T6 than it sounds.** Every run so far has lost wallets to a seal that
succeeded and a payment that did not: five in T4, four in T5, two in T2. Each one was gone for good
because it could not re-seal. After this deploys, a wallet in that state simply plays again. T6 needs
71 of our 72 wallets, so before the fix a single burnt wallet would have stopped the test — and
after it, nothing does.

### Step 3 — funding. **DONE by you, nothing further needed.**

You topped the funder up by 5 SOL. It now holds **9.253841480**, which covers T6 with a real reserve
and T3 and T7 after it. UI-A and UI-B are untouched at 8.67 and 9.67, so the sweep I asked for is no
longer needed — though that money is still sitting there when a later test wants it.

**I am holding the fan-out until after T2 refunds, on purpose.** The funding command tops every
wallet UP TO a target, and 37 of our wallets are currently light only because they are sitting in
pool 20 waiting for their 0.1 back. Funding them now and refunding them at 01:15Z would spend about
7.9 SOL where one pass afterwards spends about 4.2. Nothing is lost by waiting: T6 cannot start
until the next pool opens, which is after T2 settles anyway.

### Step 4 — T2 settles itself, then the next pool opens

Pool 20 reaches its deadline at **01:15:58Z (02:15 your time)**. Nothing for you to do: both
settlement instructions are permissionless. The 39 refunds land, and the daemon opens the next pool
about five minutes later. T6 runs there.

### Step 5 — the two browser sessions

**▶ One thing I need you to settle first.** The manual's T6 line reads "UI-A and UI-B early, then
wait", and then requires a **late entrant who sees the 'filled before your entry reached it'
message**. Those cannot both be true with two accounts: if both enter early, nobody is left to
arrive late, and the message is the thing T6 exists to check. So I am reading it as:

- **UI-A enters early**, as an ordinary seat. One of the 64.
- **UI-B arrives late**, after the pool is already full, and is refused.

Say if you want it the other way round; nothing else changes.

#### UI-A — an ordinary entry, played early

I will tell you when the pool is open. Then: **one dial drag per battle, take one stat to 25**, in
this order across the seven battles:

| Battle | Drag this stat to 25 |
|---|---|
| 1 | Strength |
| 2 | Speed |
| 3 | Heart |
| 4 | Wit |
| 5 | Durability |
| 6 | Strength |
| 7 | Heart |

Seven drags, one per screen. Lock in each battle.

**T6 predicts no ranks, so the exact numbers do not matter this time** — unlike T4 and T5, where a
stat above 25 would have broken the claim. The only thing that matters is that you actually play
rather than let the clock run out. Remember the clock is **90 seconds for all seven battles**, not
15 a screen, and it starts at your first dial touch. If it expires, every untouched battle is
entered as the even split — and seven identical even splits is the pattern our own detection reads
as machine-made. It flags nobody (that is the report-only ruling), but it puts a false finding in
the report for no reason.

#### UI-B — the late one. The timing is the test; the numbers are not.

**Do not start until I say GO.** I will call it when the pool is at 63 of 64 and the last headless
entry is going in. Then:

1. Open the pool page and start a session.
2. **Move one dial** — that starts the 90-second clock, which is the point.
3. Play the seven battles however you like. Genuinely anything.
4. **Take your time — use the full 90 seconds.** The pool must seal while you are still playing.
5. Submit.

**You should be refused, and that is the pass.** What I need from you is exactly what you see:

- Does it say something like "this pool filled before your entry reached it", or does it just hang
  on a loading indicator?
- How long before it tells you?
- **Screenshot it.** That message is a pass criterion and the screenshot is the evidence.

You will be charged a transaction fee and nothing else. No entry, no 0.1 SOL.

---

**Recap of what is yours, updated 18:30Z:**

| | |
|---|---|
| ~~merge PR 147~~ | **done** |
| ~~top up the funder~~ | **done** — 9.253841480 |
| **merge PR 148** | the battle-test records; green on all ten checks |
| **run `deploy-backend`** | the fix is merged but NOT live — confirmed by probe |
| **ratify UI-A early / UI-B late** | or counter it |
| two browser sessions | when I call them |

Everything else is mine. T2 settles itself at 01:15:58Z and I am set to pick it up.

---

## F-29 — ▶ ONE MERGE, then you can go to bed

**Merge the T2R freeze PR before ~01:21Z.** That is the whole ask. Everything after it is headless.

### What this is

T2 is spoiled and that is my fault — §H16, and I have written it up plainly. The 1 SOL you asked me
to send funded the wallet that became pool 20's 40th seat three minutes later, which crossed the
boundary T2 exists to test. I checked that transfer against next week's budget and never asked
whether it touched the test that was running right then.

**T2R is the retry, and it is stronger than the test it replaces.** T2's prediction was frozen
against a pool that was already open. This one is frozen **before its pool exists** — the pool it
will run on opens about five minutes after pool 20 closes. That is the strongest form of freeze this
test has, and we only get it here because the retry was forced.

### What happens once you merge

Nothing that needs you.

1. Pool 20 seals at 01:15:58Z and pays out. It is recorded as an **observation** — no prediction
   attached, nothing claimed. I explain below why I am not dressing it up.
2. The next pool opens ~01:21Z. I enter 39 headless wallets into it.
3. Twelve hours later it misses its deadline one seat short and refunds all 39. **No admin key and
   no action from you** — both settlement instructions are permissionless by design.
4. I harvest, reconcile and report.

All 72 wallets are funded at exactly 0.15 and nothing else is outstanding.

### Why pool 20 gets no prediction

I offered to freeze a partial one and then talked myself out of it, which is worth you knowing
because it is the second time this project has nearly recorded a check that could not fail.

Every line I would have frozen was already known before the event: the pool holds 40 and the
minimum is 40, so the outcome is public arithmetic; "one seat paid the whole pot" is a constant; the
vault figure and the per-seat cost have each been measured three times. A prediction that cannot be
wrong is not evidence, and putting one in the record makes the honest ones worth less. So pool 20
says what happened and claims nothing.

### Two things T2R does NOT claim, said here rather than buried

- **It runs headless, so it cannot show that your browser wallets are refunded on the same terms as
  the scripted ones.** T2 was going to show that. It never got the chance, so nothing we already had
  is lost — but it is owed, and I will put it on a later pool when you are around.
- **Nothing stops a stranger entering a public devnet pool.** That is what ended T2, and an outsider
  could have done it just as easily as we did. My guard is a rule, not a mechanism: fund no wallet
  outside the seat list while a test pool is open. Worth knowing it is a real exposure.

**▶ Merge the PR. Then nothing until morning.**

---

## F-30 — ▶ READ THIS ONE. The even split won, and the rules page says it cannot.

**Nothing to do right now. This is the most serious thing the test has found and it is your call,
with counsel.**

### What happened

Pool 20 sealed at 40 seats and scored. Both your browser wallets ran out of time again, so all
seven of their battles went in as the even split — 20 points in every stat, the shape the screen
starts at. **They tied for first and split the whole 4 SOL prize between them.** Everyone else got
nothing.

The best player who actually made choices scored 318. Your two timed-out entries scored 426.

### It is not a bug, and I checked rather than assumed

I re-scored all forty entries myself, using the product's own scoring code but running it separately
from the system that produced the result. Forty compared, zero disagreements. The tie-splitting is
written into the program on purpose: a tie for first divides the entire prize among those tied and
pays nobody else.

### Why it happened, and why T5 showed the opposite

In the earlier test the field was built so that nobody could put more than 25 points in one stat.
Against that, the even split came 62nd of 64 — which is what the rules page describes.

This field was not capped. Every one of the 38 other players concentrated hard: their biggest stat
ran from 44 up to 88, some with zeroes elsewhere. Scoring compares every player against every other,
stat by stat. Against someone who pours 67 points into one stat, an even split wins four of the five
comparisons. It beat nearly everyone.

**So the even split's strength depends on what everyone else does, not on the split itself.** The
same allocation came last in one pool and first in another, unchanged.

### The bit that needs you

The rules page says, twice, in words a player reads:

> "The even split is the weakest allocation in the game."

That sentence is **not true as written**. The very next sentence in your copy names the condition
under which it is true — when the other player has concentrated on *three* stats. Against one or two
stats, the even split is strong.

Two things follow, and both are yours:

1. **The copy needs changing**, because it currently tells players something false about how the
   game works. What it should say instead is brand voice and yours.
2. **It touches PID §8, so it is you and counsel, not me.** The case that this is a game of skill
   is harder to make on a pool where the two players who did nothing beat all 38 who played and took
   the whole prize. It also means the timeout is a *strategy* — someone who works this out wins by
   walking away from the screen.

**What I have NOT shown, so you do not over-read it:** the 38 opponents were generated by our test
code, not real people. Whether human players concentrate the way our generator does is unknown, and
that is now the most valuable thing left to find out.

### And a mistake of mine in the same breath

Last night I listed four things about this pool that I said "could not fail" and used that to argue
against recording a prediction. One of them was "exactly one player is paid the whole 4 SOL". Two
were paid, 2 SOL each. I had the constant right and drew the wrong conclusion from it — it fixes how
many *places* pay, not how many *people*. Had I recorded that prediction it would have failed, and
it would have caught this a few hours earlier. Not recording it was still the right call, but my
reasoning for it was partly wrong.

---

## F-31 — T2R is running, and nothing is needed from you

Pool 21 holds exactly 39 seats and the chain reads **refund**. It settles itself at **13:21:29Z**
and I will pick it up.

Worth one line: the prediction was merged at 23:47:18Z and **pool 21 did not exist until
01:21:29Z** — an hour and 34 minutes later. That is the strongest form of freeze in this test, and
we only have it because the retry was forced.

Also: two wallets failed mid-entry with the network error that cost us eleven wallets earlier in the
week. **Both simply played again and landed.** That is the fix you deployed last night doing exactly
what it was built for, on a real failure, within hours. No substitutes — the 39 seats are the 39 the
plan named.

---

## F-32 — ▶ FOUNDER ACTION: one transfer, three merges, then stand by for a GO call

You ratified both calls: **pool 22 runs as a shakedown** (an observation, not a test), and **T6 is
frozen against pool 23 with UI-A early and UI-B late**. Both are done on my side. Three things are
yours.

### 1. ▶ Send 8 SOL from UI-B to the funder

```
from:  UI-B   6wqLMAS1guarBehRDGFSAApGUBLXuuHWmy9naepzu3sa
to:    funder 6z4wriiac4d6bay57Pe4Gj3jxhjeT9HfbcH2VaM4r3Ue
amount: 8 SOL
```

**Why, in plain numbers.** The 72 test wallets each hold about 0.15 SOL, which covers exactly one
entry apiece — enough to fill pool 22 today and nothing after that. T6 needs all 71 of them topped
back up to 0.155 SOL before pool 23, which is about **7.3 SOL**, and the funder holds **0.34**.

If a test wallet wins pool 22's 4 SOL I can sweep it back and the gap drops to about 3.3 SOL. If
**UI-A** wins it instead — and UI-A is already seated in pool 22 with an allocation I did not choose
and cannot see — the 4 SOL lands in your wallet and the full 7.3 is needed. Eight SOL covers it
either way, and it means I never have to stop and ask again mid-run. UI-B keeps about 3.7 SOL and
only ever spends a transaction fee, because UI-B's job in both pools is to be refused.

The devnet faucet would also work but is rate-limited to roughly 2 SOL a day; the transfer is
instant.

### 2. ▶ Merge three PRs

- **PR 154** — the copy correction (the "weakest allocation" sentence) and the skill-evidence
  report. Open since yesterday, 8 checks green.
- **PR 155** — the §H22 record in `battle-test/`. 10 checks green.
- **The new T6 freeze PR** — link below once it is open.

**The T6 one is time-sensitive and the other two are not.** Pool 23 does not exist yet. The moment
pool 22 fills, pool 23 opens about five minutes later — and a prediction merged after that is worth
less than one merged before it. So: **merge the T6 PR, and tell me. I do not start filling pool 22
until you have.**

### 3. ▶ Then stand by. Two sessions, both on my call.

**Pool 22 — UI-B, the shakedown.** I will fill pool 22 to 63 of 64 and then say GO. You:

1. Open the pool page and start a session.
2. **Move one dial.** That starts the 90-second clock, which is the whole point.
3. Play the seven battles however you like — genuinely anything, the numbers do not matter.
4. **Take the full 90 seconds.** The pool has to seal underneath you while you are still playing.
5. Submit.

**You should be refused, and being refused is the result.** What I need is exactly what you see:
does it say something like *"this pool filled before your entry reached it"*, or does it hang on a
spinner? How long before it tells you? **Screenshot it.** You are charged a transaction fee and
nothing else — no entry, no 0.1 SOL.

**Pool 23 — UI-A first, then UI-B late.** Same as above for UI-B. UI-A goes in early, as one of the
64, the moment pool 23 opens and before I fill it:

| Battle | Drag this stat to 25 |
|---|---|
| 1 | Strength |
| 2 | Speed |
| 3 | Heart |
| 4 | Wit |
| 5 | Durability |
| 6 | Strength |
| 7 | Heart |

**One thing here does matter, unlike last time.** Keep every stat between 1 and 25 — never 0, never
above 25. The frozen plan says a test wallet wins pool 23 outright, and that claim holds for any
allocation you play inside that range and breaks if you go above 25. Seven drags, one per screen,
lock in each battle, 90 seconds for all seven starting at your first touch.

### What I am doing meanwhile

Nothing that spends money until you have merged the T6 PR. After that: fill pool 22, call GO, record
what we see, then top the wallets up and run T6 on pool 23 properly frozen.


---

## F-33 — ▶ FOUNDER ACTION: pool 22 found a real one. Two rulings and an RPC.

Pool 22 did its job. It settled cleanly — 64 seats, nine seconds from seal to payout, W00 took the
whole 4 SOL and the money is back in the test wallets. And your 90 seconds found the thing no
automated run could have.

### What you saw, and why it is wrong

Your screen said the attempt did not go through, and that it was **either** an earlier attempt from
your wallet **or** the pool having stopped taking entries.

**The server already knew which.** It answered "this pool is closed to entries" in plain words. The
app throws that away and shows a message that covers both cases, so you were asked to go and work
out for yourself something the system could simply have told you.

And the right sentence is already written, in your own copy file:

> "This pool filled before your entry reached it, so nothing settled. Another pool in this tier opens
> once this one has been paid out."

It has never been shown to anybody, and as things stand it never can be. Three separate design
decisions, each sensible on its own, stack up to block it. That is the kind of fault that only shows
up when a person actually sits in front of the screen.

**What worked:** you were charged **nothing** — not the entry, not even a network fee. I checked your
wallet against the chain and it is unchanged to the last digit. And it was a sentence, not a
spinner. Those were the two things that mattered most and both held.

### ▶ Ruling 1 — may I fix it? (I recommend yes)

This is product code, outside the battle-test boundary, so it is your call. The small fix is about
five lines: have the app read the reason the server already sends and show the message that matches.
You would then get, truthfully and without hedging:

> "This pool is no longer taking entries, so nothing settled. Open pools are listed on the Pools tab."

**I recommend taking it.** It ships as its own PR, separate from anything else, with tests.

### ▶ Ruling 2 — do you want the word "filled"? (this one is yours, it is brand voice)

"No longer taking entries" is true and costs five lines. Saying **"filled"** is warmer and more
specific, but it costs more: a pool that filled up and a pool that ran out of time both just look
"closed" to the app, so the server would have to start saying which. Worth it only if you think
"filled" reads materially better to a player. I have no strong view — this is your column.

### ▶ Ruling 3 — I need a devnet RPC before T6

Not urgent tonight, but it blocks T6. I filled pool 22 using the free public Solana endpoint, which
throttled me: every run got about fifteen entries in and then stopped. It cost nothing — every
affected wallet simply retried and landed, thanks to the fix you deployed on Thursday — but it means
**the fill took 5 minutes 20 seconds, and T6 has "under 5 minutes" as a pass criterion.** That number
would be measuring the free endpoint, not our product. Our own manual warned about this and I did not
follow it.

**What I need:** a free devnet RPC URL from **Helius**, **QuickNode** or **Triton**. All three have
free tiers, it is a sign-up rather than a payment, takes a couple of minutes, and you paste me the
URL. Any of the three is fine.

### Where that leaves T6

**T6 is frozen and safe** — merged before pool 23 existed, which is the strongest evidence standard
we have, and I have the receipts recorded. It is ready to run and needs two things first: the RPC
above, and a decision on whether the copy fix ships before it. **If the copy fix does not ship, T6
will fail its copy criterion** — correctly, because the product does have this fault. I would rather
fix it and have T6 test the fixed thing.

