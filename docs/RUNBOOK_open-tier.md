# Opening a tier — the founder's runbook

**Owns:** the exact sequence for making a new entry tier able to open pools, and the checks either
side of it. **Does not own** the preconditions themselves (roadmap R6 and R1 do) or the tier table
(`programs/blotto_cup/src/constants.rs` does).

Only tier 0 — the 0.1 SOL entry, 4 SOL prize pool — can open a pool today. That is
`Config.open_tiers`, and `set-open-tiers` is the only thing that changes it. This page is what to do
when you want to change it.

---

## Before you start: why this is careful

`open_pool` funds a pool's prize vault from the treasury at **whatever the on-chain config says**,
before anyone enters, and then publishes that figure as the prize. A prize once published cannot be
un-published.

Six tiers on devnet currently hold the **wrong pot** — they were set before the prize amounts were
ratified on 2026-09-06 and have not been corrected:

| Tier | Entry | Pot on chain | Pot it should be |
|---|---|---|---|
| 1 | 0.5 SOL | 25.6 SOL | **20 SOL** |
| 2 | 0.75 SOL | 38.4 SOL | **30 SOL** |
| 3 | 1 SOL | 51.2 SOL | **40 SOL** |
| 4 | 2.5 SOL | 128 SOL | **100 SOL** |
| 5 | 5 SOL | 256 SOL | **200 SOL** |
| 6 | 7.5 SOL | 384 SOL | **300 SOL** |

`open_tiers` is the only thing stopping a pool being opened at one of those figures. Opening tier 1
today, without step 3 below, would take 25.6 SOL from the treasury instead of 20 and pay it to one
player.

The tool will not let you do it — `set-open-tiers` refuses to open a tier whose on-chain numbers
disagree with the ratified table, and refuses to open more than one tier at a time. The steps below
are the order that keeps that refusal from ever firing.

---

## Step 1 — Check the preconditions (roadmap R6)

Opening **tier 1 (0.5 SOL) or above** needs both of these first. They are your call to make, but the
roadmap records them as conditions, not preferences:

- [ ] The audit findings are closed (R5).
- [ ] At least one written counsel opinion has been received for the launch territory (R1, roadmap
      step 6.5).

Tiers 4, 5 and 6 pay a first place of 100, 200 and 300 SOL. Check where that sits against the KYC
threshold (R3, `set-kyc-threshold`) before opening them — the switch is off at launch, and these are
the tiers it was built for.

If you are opening tier 1 and either box is unticked, stop here.

---

## Step 2 — Read what is on chain now

```
npm run admin -- status
```

Write down the three lines you will be checking against afterwards:

```
open tiers:        [1, 0, 0, 0, 0, 0, 0]
tier prices:       [...] lamports
tier pots:         [...] lamports
```

This is standing rule 5 of the operating manual — read before you overwrite. Every number below is
compared against what you just read.

---

## Step 3 — Fix the tier's prize pool first, if it is wrong

Compare the tier's pot from step 2 against the table at the top of this page. If it disagrees, send
`set-tier-economics` for that tier **before** opening it.

The six proposals are already prepared, one per tier, with their exact account lists and data —
`docs/devnet-rehearsal-runbook.md` §E2. Use those rather than composing new ones.

```
npm run admin -- set-tier-economics --tier 1 --price 0.5sol --pot 20sol --emit-proposal
```

Take the printed payload into Squads, get it signed, then confirm:

```
npm run admin -- status
```

The tier's pot must now match the table. **Do not continue until it does.**

---

## Step 4 — Dry-run the change

```
npm run admin -- set-open-tiers --tiers 1,1,0,0,0,0,0 --dry-run
```

Seven values, one per tier, in order: `1` means the tier may open pools, `0` means it may not. The
first is tier 0. Keep the tiers that are already open as `1` — this command sets the whole list at
once, so a `0` where you meant `1` closes that tier.

The dry run sends nothing. It prints what is there now, what you are proposing, and which tiers that
opens and closes, then either passes or refuses:

```
current:  [1, 0, 0, 0, 0, 0, 0]
proposed: [1, 1, 0, 0, 0, 0, 0]
opening:  1
closing:  (none)

dry run: checks passed, nothing sent.
```

If it refuses, the message says which check and what to do. The two refusals are:

- **the tier's economics disagree with the ratified table** — go back to step 3;
- **more than one additional tier at once** — open them one at a time, each with its own proposal
  and its own verification. This is the guard against typing `1,1,1,1,1,1,1`.

Closing tiers is never refused.

---

## Step 5 — Send it as a Squads proposal

The admin key is the Squads vault, so nothing here can sign for you:

```
npm run admin -- set-open-tiers --tiers 1,1,0,0,0,0,0 --emit-proposal
```

The same two checks run again before the payload is printed, so a proposal that reaches the signers
has already passed them. Take the payload into Squads and get it approved.

---

## Step 6 — Verify, in three places

**On chain** — the authority:

```
npm run admin -- status
```

`open tiers` must read exactly what you proposed.

**The read API** — what the site is told:

```
curl -s https://<indexer-host>/tiers | jq '.enablement_source, .tiers'
```

Every configured tier appears, each with `enabled` and `status`. The tier you opened must read
`"status": "open"`. Check `enablement_source` says `"chain"` — if it says `"ledger"` or
`"launch_default"`, the indexer could not read the config account and is answering from events or
from the launch defaults, so it may be stale.

**The site** — what a player sees: load the landing page. The tier should now appear in the prize
pools list. A tier that is closed is not listed at all, so the change is visible as a row appearing.

---

## Step 7 — Watch the first pool open

The daemon opens pools itself, lowest enabled tier first, and only when the treasury can fund the
pot while keeping the floor. So a newly opened tier does not necessarily open a pool immediately.

```
npm run admin -- pools
```

When its first pool appears, check the pot on that row is the ratified figure. This is the last
point at which a wrong number is still cheap to fix — before the pool has entrants.

---

## Closing a tier

Same command, `0` in that position. Closing is never refused and takes effect at once, but note what
it does and does not do:

- **It stops the next pool opening in that tier.**
- **It does not touch a pool that is already open.** `open_tiers` gates `open_pool` and nothing
  else — `register` never reads it — so a pool that is taking entries keeps taking them, and the
  site keeps listing it, until it seals or refunds on its own. That is deliberate: players already
  seated must not have the rules changed under them.

To stop entries everywhere and immediately, the kill switch is a different command:

```
npm run admin -- set-paused --paused true
```

That blocks `register` and only `register` — reveal, payout and refund keep working, so a pause
never strands anyone's money.

---

## If something looks wrong

| What you see | What it means |
|---|---|
| `set-open-tiers` refuses on economics | The tier's on-chain pot or price disagrees with the ratified table. Step 3. |
| `set-open-tiers` refuses on the count | More than one tier would open. Send them one at a time. |
| `status` shows a tier you did not intend | The list is absolute, not a change — a `0` you left in place closed that tier. Re-send with the full list correct. |
| `/tiers` says `enablement_source: "ledger"` | The indexer cannot read the config account. The site may be showing a stale answer; the chain is still correct and `open_pool` still enforces it. |
| A tier is open but no pool appears | The treasury cannot fund the pot while holding the floor, or the tier is still cooling down. `npm run admin -- status` shows both. |
