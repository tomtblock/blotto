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
