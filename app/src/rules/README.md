# app/src/rules

The territory schedule as the player-facing surfaces need it. The published rules page itself lives
at `app/src/app/rules/`.

| File | What it does |
|---|---|
| `territories.ts` | Reads `config/territories.json` at build time and exposes `availability()` and `blockedTerritoryPhrase()` to the rules page, the block screen and the entry surfaces. One source, so every surface changes in the same commit. |
| `territoryNames.ts` | Display names for the territory codes, so a player never sees a bare code. `scripts/check-territories.ts` fails the build if a code in the schedule has no name here. |

This module only describes the schedule. What is blocked is decided in `config/territories.json`
(a block-list, set by the operator — see `config/territories.README.md`), and enforcement happens
server-side in `backend/packet`. Nothing in the browser gates anything.

## The rules page

`app/src/app/rules/rules.config.ts` is the page's single data source. Section wording comes from
`app/src/copy/`; every number comes from the shared constants in `@blotto/scoring`
(`TIER_ENTRY_LAMPORTS`, `POOL_CAPACITIES`, `LADDER_TABLES`, `MIN_FIELD_BY_CAPACITY`,
`DEFAULT_FILL_DEADLINE_SECS`, `DEFAULT_COOLDOWN_SECS`) or from `config/`, never typed in, so the
page cannot drift from what the program pays or enforces. `rules.config.test.ts` pins this. The
prize tables are in multiples of the entry; the page multiplies them by the entry price and shows
SOL per place, never a multiple or a percentage (D-E19).

The page states, before any payment:

- **How to enter**, and the entry price for each tier.
- **Who is paid**: the top quarter of each pool size (8, 16, 32 or 64 players), with the prize for
  every paid place in SOL; players tied across places share those places' prizes equally, even
  across the last paid place; a forfeited share is never returned to the operator — in a pool that
  pays several places it is held until the field-moves-up payout ships (D-E19).
- **How scoring works**: a stat is won by the larger number, a battle by three of five stats,
  otherwise a draw; every player faces every other player.
- **The battle timer** and what happens to unplaced points when it ends.
- **What randomness does**: it picks the cosmetic character class and nothing else.
- **Sealing**: battles are encrypted on the player's device; the wording is fixed in
  `app/src/copy/` and explained in [`backend/sealing/README.md`](../../../backend/sealing/README.md).
- **Field size and refunds**: each pool size's minimum field (`MIN_FIELD_BY_CAPACITY`: 5, 10, 20,
  40), with which a pool runs once the 12-hour fill deadline passes; below it every entry is
  refunded in full.
- **When tournaments open**, including the cooldown between pools.
- **How to verify a result**, linking to `/verify`.
- **Availability**, rendered from the territory schedule above.
- **Age** (18+), **playing responsibly**, and **detection and review**: the implemented detection
  signals (`backend/detection/src/signals.ts`) and how a decision is reviewed. A player challenges
  a decision through the complaints route (`app/src/app/complaints/`,
  `backend/detection/src/complaints.ts`).

`app/src/copy/published-claims.test.ts` holds the register of every public claim and the code that
backs it.

All wording is subject to the language gate — see [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) →
"The language gate". Final player-facing wording is pending legal review.
