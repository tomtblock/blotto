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
