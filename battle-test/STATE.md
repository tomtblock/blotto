# STATE — 2026-09-24 14:25 UTC — by Claude Code

Phase:            **T3 is frozen, funded and ready — and BLOCKED at the entry gate.**
                  Everything on my side is done. Nothing can enter pool 29 from this container.
Waiting on:       **the founder: F-38, a decision on the country-level US block.** It is the only
                  thing standing between here and a finished battle test.
Blocked:          **T3 and T7, both, on DRIFT §H28.** The entry gate screens this container as
                  `US`; version 5 of the territory schedule blocks `US` at country level. The gate
                  is working correctly. No wallet was risked and nothing was sealed.
Results so far:   T1 **PASS** · T4 **PASS** · T5 **PASS** · **T6 PASS\*** · T2 **SPOILED** ·
                  T2R **PASS (7 of 8)** · pool 22 = observation, not a test
Money:            funder **2.329831040** (after funding 38 seats) · W00 **7.936676760** ·
                  settlement signer **9.989225364** · treasury 11.586344960
Open PR:          **171** — the T3 freeze. Safe to merge either way; a frozen plan that does not
                  run is a plan that did not run, not a wrong one.
Parallel session: **program development** — `session_01CosZsm5MB312HdbJH6y2zJ`, branch
                  `claude/program-dev`, cut from `main` at `50383cb`. Separate lane, no overlap.

## The blocker, in one paragraph

Preflighting pool 29 refused **every** wallet — all 39 headless and both UI accounts — with
`403 entry_unavailable`, after each headless wallet's clickwrap returned `204`. That rules out
§H27. `GET /geo` answers `{"allowed":false}`, this container's egress IP resolves to **Columbus,
Ohio, US**, and `config/territories.json` version 5 carries `US`. The gate is refusing the battle
test for exactly the reason the founder instructed it to refuse traffic.

It worked two days ago because the block was committed at **00:13Z on 09-22 — during T6's fill**
— and `deploy-backend` is manual, so it only went live on the next deploy, the one run for Resend.
**I wrote that deploy instruction and did not notice it would stage a screening change too.**

## What the founder has to decide (F-38)

Restoring the old behaviour is **not** a matter of ticking `allow_dev_credentials`:
`deploy-backend.yml:346` reaches the dev branch only when a vendor variable is *missing*, so the
GB stub comes back only if `GEO_VENDOR_URL` and `GEO_VENDOR_API_KEY` are **deleted** — and GitHub
secrets cannot be read back afterwards.

The four options, with what each costs, are in the message accompanying this file. The
blocked-territory list is founder-and-counsel-owned without exception (PID §8/§9), so I have
changed nothing and will not.

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
