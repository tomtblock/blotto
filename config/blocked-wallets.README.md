# `blocked-wallets.json` — which addresses are refused, and why each row is there

**Founder-owned.** The list in `blocked-wallets.json` is changed only on a founder instruction, and
every change lands in its own commit saying so. This file is the legend: one row per address, the
ground relied on, and the date the decision was taken.

**The schema and the fail-closed rules are not restated here.** They live in
`backend/packet/src/blocked-wallets.ts`, which is the only parser, and
`scripts/check-blocked-wallets.ts` enforces that this file and the JSON agree.

---

## Why the legend is not optional

A blocklist without recorded reasons is the first thing a regulator asks about, and the terms of
service promise something specific:

> Where we do either, we will tell you which ground we relied on. You may challenge the decision
> through our complaints route…

That promise is only keepable if the ground was written down when the decision was taken. The
address alone does not carry it, the service does not store it — a reason is for the record and for
the player who asks, not for a runtime decision — so it is recorded here, and CI refuses a build
where an address is listed without a row.

## The grounds

The only grounds available are the ones the terms enumerate. Nothing else may appear in the
`Ground` column:

| Ground | The terms' words |
|---|---|
| `integrity` | the integrity criteria published in the rules have been met |
| `multiple-addresses` | the address is one of several controlled by the same person in a single tournament |
| `territory` | entry was made from a territory where the service is not available |
| `under-18` | entry was made by a person under 18 |
| `sanctions-listed` | the address is on a published sanctions list |
| `terms-breach` | these terms have otherwise been breached |

`sanctions-listed` is worth a note: the screening in `backend/sanctions/` already refuses every
listed address at entry, from live published sources, and it needs no row here. An address arrives
on this list under that ground only where a screening source has been withdrawn or cannot be
reached and the founder has taken the decision by hand.

## What this list is not

- **Not the sanctions screening.** That is live, refreshed, and consults published sources for every
  entry (`backend/packet/src/sanctions-wiring.ts`). This file is the founder's own decisions.
- **Not a territory rule.** Those are country codes in `territories.json` and apply to everyone.
- **Not a prize hold.** Refusing an entry and withholding a settled prize are different acts with
  different mechanisms; a held prize is `flag_entry` and the escrow path, and it never comes to us
  (`programs/blotto_cup/src/instructions/escrow.rs`).

## Live — list version 1 (2026-09-19)

**Empty.** The mechanism exists and nobody is on it.

| Address | Ground | Decided | Note |
|---|---|---|---|

<!-- One row per address in blocked-wallets.json, in the same order. The
     Address cell is the base58 address in backticks; the Ground cell is one
     of the six above; Decided is the date the founder took the decision.
     scripts/check-blocked-wallets.ts reads this table. -->

## Held

Nothing is held. A decision either takes effect — the address goes in the JSON and gets a row above
— or it is not taken.
