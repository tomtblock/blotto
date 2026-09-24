# STATE — 2026-09-24 16:10 UTC — by Claude Code

Phase:            **T3 is frozen, funded and ready — and still BLOCKED at the entry gate.**
                  Everything on my side is finished. Nothing can enter pool 29 from this container.
Waiting on:       **the founder: F-39 — one click on `backend-status`.** Read-only, checks out
                  nothing, deploys nothing. It prints the one log line that settles this.
Blocked:          **T3 and T7, on DRIFT §H28 and now §H29.** The founder deleted the vendor secrets
                  and re-deployed with the dev box ticked — correctly, and run 39's own environment
                  proves it — but the gate is unchanged. **The deploy printed
                  `/geo -> allowed:false` and reported success.** No wallet was risked, nothing
                  sealed, no lamport moved.
Results so far:   T1 **PASS** · T4 **PASS** · T5 **PASS** · **T6 PASS\*** · T2 **SPOILED** ·
                  T2R **PASS (7 of 8)** · pool 22 = observation, not a test
Money:            funder **2.329831040** (after funding 38 seats) · W00 **7.936676760** ·
                  settlement signer **9.989225364** · treasury 11.586344960
Open PR:          none — **171 merged**. A frozen plan that does not run is a plan that did not
                  run, not a wrong one; it names no pool, so it does not expire.
Parallel session: **program development** — `session_01CosZsm5MB312HdbJH6y2zJ`, branch
                  `claude/program-dev`. Separate lane, no overlap.

## Where this actually stands

Two separate things went wrong today and only the first is understood.

**§H28 — why the gate refuses us.** This container egresses from Columbus, Ohio; version 5 of the
territory schedule blocks `US` at country level. The gate is working exactly as instructed. T6 got
through on 09-22 only because the block was committed at 00:13Z *during* its fill and deploys are
manual, so it went live later that morning — on the deploy I wrote the instruction for.

**§H29 — why the agreed fix did not take, and this one is open.** Run 39's printed environment
shows both vendor secrets empty and `DEV_CREDS: true`, so the GB stub was staged and the packet
machine rebooted mid-deploy at 15:27:35Z. The stub still is not in effect: a live GB stub allows
**every** address, because GB is not on the schedule, `regionRuleUnenforceable` is per-country and
version 5 carries no sub-national code, and `vpnOrProxy` needs a variable that was never staged.

**Two checks in that workflow cannot fail, which is why nobody saw it.** The smoke check runs
`curl --fail .../geo` and ignores the body, so `{"allowed":false}` ships green. The dev-path check
greps the boot log for `GEO STUB` while the service prints `geo = STUB (dev only)`, so it is
silent whether the dev path is live or dead. Both are in `.github/workflows/deploy-backend.yml`, outside this
session's lane — recommended to the founder, not written by me.

## F-39 — the one read that settles it

**Actions -> `backend-status` -> Run workflow.** In the `blotto-packet` section, two lines:

- **`packet: geo = ...`** — names the live lookup outright.
- **`geo BLOCK ...`** — `geoVerdict` logs a distinct sentence per reason, so it says which of its
  four refusals fired.

I am deliberately not diagnosing past this. Three wrong readings today came from reasoning around
a measurement I could have taken.

## What is ready the moment it clears

- `registry/T3.plan.json` — frozen, validated, 40 seats, four unconditional claims that hold with
  a margin of 10 against a theoretical founder ceiling and 173 against the best real rival.
- `scripts/t3-bounds.ts` — re-derives all four and exits non-zero if any stops holding.
- 38 headless wallets funded to 0.108 SOL each, shortfall zero.
- Both Squads `set_paused` payloads generated and verified against the chain-derived Config PDA
  and the Anchor discriminator. Baseline read: `Config.paused = false`.

Pool 29's deadline is **2026-09-25T01:24:50Z**. If nothing enters it, it times out at 0 entrants
and refunds nothing — no loss, and the daemon opens a successor.

## Still open, unchanged

- **§F-37** — a human reading pool 27's refusal copy. 60 seconds, needs only a browser.
- **Rotate the Helius key** after the test week.
- **Counsel, not engineering:** privacy wording for the email opt-in (PID §8); the §H22 even-split
  copy claim; and now the US/Delaware tension PR 164 already asked counsel to resolve, which
  §H28 has made concrete rather than theoretical.
