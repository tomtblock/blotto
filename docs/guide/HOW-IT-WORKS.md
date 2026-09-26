# How Blotto Cup works

**One page, no code.** For anyone who needs the mechanism exactly — a judge, a player, a
reviewer — without reading the repository. Every figure below is a value the program or the
scoring engine enforces; where the operator can change a value, the page says so.

Blotto Cup runs on the Solana **test network (devnet) only**. No real money has ever entered it.

---

## The shape of it

Up to **64 players** enter a pool. Each pays the same entry — **0.1 SOL** at the only tier open
today. The prize is **4 SOL**, fixed in advance, and it is moved into the pool's own account
**when the pool opens, before the first player enters**. It does not grow or shrink with the
number of entries.

**One player is paid.** The player ranked first receives the whole 4 SOL; everyone else receives
nothing. Players tied for first divide it evenly (the indivisible lamport remainder goes to the
tied player who entered first).

A pool takes entries for **12 hours** and closes early the moment the 64th seat fills. If the 12
hours end with **40 or more** players seated, the pool plays. With fewer than 40, every entry is
repaid in full and the pool closes.

---

## Two modes

Every pool plays one of two placing rules, and says which before anyone pays. The two are separate
pools with separate prizes; the price, prize and seat rules are the same for both.

| | Easy | Hard |
|---|---|---|
| Battles | 7 | 7 |
| Stats per battle | Strength, Speed, Heart, Wit, Durability | the same five |
| Points to place | **100 in each battle** — whole numbers adding to exactly 100 | **700 across the whole board** — anywhere in the 35 stat cells; a battle may hold nothing |

Everything after the placing — how a battle is decided, how players are ranked — is identical in
both modes. Easy is the default; hard pools open only where the operator has switched them on.

---

## What a player does

A few minutes, once, and then nothing until the pool concludes.

1. **Pay the entry** and receive a character pass — a non-transferable token showing one of five
   classes. The class is decorative. Nothing that decides a result reads it: a Mythic's Strength
   is worth exactly what a Common's is.
2. **Fill the battle board.** The board shows the seven battles side by side. The player picks a
   stat and sends points into a battle, a point at a time or in steps of 5, 10 or 20, and can take
   points back. Counters show what is left to place. A battle can be **locked in** to freeze it (in
   easy mode, only once it holds its full 100). There are no presets and no suggested splits.
3. **One clock: three minutes.** It starts **on the first point placed** — not on arriving, not on
   choosing a stat, not while the wallet is connecting. The rule is shown before it starts.
4. **Submit, or the clock ends it.** Either way, the board as it stands becomes the entry.

**The buzzer rule.** Any points not yet placed when the entry is taken are spread evenly across the
battles that are *not* locked in, with no randomness:

- **Easy:** each unlocked battle spreads *its own* missing points evenly across its five stats. An
  untouched battle becomes 20 / 20 / 20 / 20 / 20.
- **Hard:** the board's missing points are spread evenly across every stat cell of every unlocked
  battle.
- Points that do not divide evenly go one at a time in a fixed order — battle 1 Strength, battle 1
  Speed, … battle 7 Durability — to unlocked battles only. A locked battle is never touched.

The same board and the same locks always produce the same entry. The seven battles are sealed on
the player's device at that moment and cannot be changed. There is no second session, no upgrade to
buy, and nothing that costs money after the entry.

---

## How the winner is decided

When the pool concludes, every player's seven battles are compared against **every other player's
corresponding battle**. In a full pool that is 441 comparisons per player (63 opponents × 7
battles) and 14,112 in total.

- **A stat** goes to whoever placed more on it. Equal numbers: nobody takes it.
- **A battle** is won by taking **three or more** of its five stats. Otherwise it is a draw.
- **Score:** one point per battle won, half a point per battle drawn (carried as whole
  half-points, never as a fraction).
- **Ranking:** by score; players level on score are separated by the total number of stats they
  took across every comparison. Players level on both share the rank.

A battle set that breaks its pool's rule — which the website cannot produce — is scored as losing
every comparison, and that status is published alongside the result.

There is no pairing, no bracket and no random element anywhere in the result. **Every player faces
the identical field**, so the only difference between two players is the quality of their placing.

---

## Why nobody has to take the operator's word for it

**Battles are sealed until the pool closes.** Each entry is encrypted on the player's device to a
key generated for that pool, and only a fingerprint (hash) of it goes on-chain. No entry can be
read — by the operator or anyone else — while the pool is still taking entries.

**The result can be recomputed.** After a pool closes, its decryption key is published on-chain,
and every battle set, the scoring inputs and the ranking are published. A fingerprint of the full
ranking is written on-chain before any prize moves. The scoring engine is a single open module — the
same code the website runs and the settlement process runs — so anyone can take the published data,
recompute the ranking, and check that the player paid is the player who won.

**The pool closes by rule, not by choice.** Closing at the deadline, and repaying a pool that did
not reach 40, are steps **anyone** can trigger once the conditions hold. The operator cannot choose
when a pool seals, and a pool that has taken money cannot be stranded because the operator's
servers are down.

---

## Where the money goes

Two program-controlled accounts are involved, and the program fixes every way money can leave
each of them.

**The pool's prize account (the vault).** It receives the prize — plus a small reserve that keeps
the account open on-chain — from the treasury when the pool opens. Money leaves it only
by:

- **paying the winner** (or the tied winners);
- **releasing a held share** to the player it belongs to (see *Review* below);
- **passing a forfeited share to the next eligible place**;
- **returning the untouched prize to the treasury** — only for a pool that did not reach 40 and so
  never played.

There is no instruction that lets the operator withdraw a prize. **Once a pool plays, its prize is
only ever paid to players.**

**The treasury** (also program-controlled). Entry payments go here. Apart from funding each new pool's prize, it
has exactly two exits: **repaying entries in full** when a pool does not reach 40 (anyone can trigger it, for any
seat), and a **gated operator withdrawal**. That withdrawal is signed by the program's admin key and
is refused if it would take the balance below a floor that covers a minimum balance, the prize
money reserved for tiers that are switched on, and every entry that might still have to be repaid.

---

## Review

Entries are screened for a small number of integrity signals. A signal does not decide anything by
itself: a person reviews it and records a signed decision. The review panel has **two reviewer
keys**, published in the repository (`config/reviewers.json`).

- A flagged player's share is **held** in the pool's vault, not paid, while the review runs.
- **If nobody decides within seven days, the player is paid anyway:** after that, anyone may
  release the held share to its owner. Inaction pays the player, never the operator.
- If a flag is cleared, the share is released to the player.
- If a flag is upheld, the share stays in the vault and **passes to the next eligible place**. It
  never returns to the operator.
- A player can challenge a decision; wherever possible the challenge is decided by someone other
  than whoever made the original decision. Every decision is written to a signed, append-only log.

---

## Who cannot enter

The service is not offered in a list of territories, published on the rules page and checked at
entry. Wallets are screened against published sanctions lists. Both checks refuse when they cannot
get an answer — a location that cannot be resolved is treated as blocked, not allowed. Entry is
18+, confirmed by the player before paying.

**Checks happen at entry, never at payment.** Someone who entered and later travels is still paid,
and is still repaid if their pool does not fill.

---

## What is built, and what is not

**Built and running on devnet:** the program, the entry gate, sealing, scoring, settlement, review,
the website and the published-results pages. Both modes are implemented.

**Not done:** it has never run on Solana mainnet, and no real money has entered it. An independent
external security review of the program has not yet been carried out; an internal review is
published in [`docs/security/SECURITY-REVIEW.md`](../security/SECURITY-REVIEW.md). Legal review of
the product is pending.

**Set by the operator**, changeable without new code and never for a pool already taking entries:
entry prices, prize amounts, the 12-hour window, which tiers and modes are open, the territory list
and the reviewer list. The 40-player minimum is fixed in the program. Only the 0.1 SOL tier is open.

---

*Where this comes from:* [architecture](../architecture/ARCHITECTURE.md) for what is built ·
[decision log](../architecture/DECISIONS.md) for why each number is what it is ·
[safeguards](../compliance/SAFEGUARDS.md) for the full list of player protections.
