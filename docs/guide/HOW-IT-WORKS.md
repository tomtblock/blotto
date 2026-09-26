# How Blotto Cup works

**One page, no code.** Written for someone who needs to understand the mechanism accurately —
counsel, an adviser, a candidate — without reading the repository.

Every figure below comes from a value the program itself enforces. Where a number is a founder
decision, it says so.

---

## The shape of it

Up to **64 players** enter a pool. Each pays the same entry — **0.1 SOL** at the tier open today.
The prize is **4 SOL**, fixed in advance, and it is moved into the pool's own account **before the
first player enters**. It does not grow or shrink with the number of entries.

**One player is paid.** The player ranked first receives the whole 4 SOL. Everyone else receives
nothing. If players tie for first, they divide it evenly.

A pool takes entries for **12 hours**. It concludes early the moment the 64th seat fills. If the 12
hours end with **40 or more** players seated, the pool runs. With fewer than 40, every player is
repaid their entry in full and the pool closes.

---

## What a player actually does

About ninety seconds, once, and then nothing until the pool concludes.

1. **They pay the entry** and receive a character pass — a non-transferable token with one of five
   classes on it. The class is decorative. It is read by nothing that decides the result: a Mythic's
   Strength is worth exactly what a Common's is.
2. **They set seven battles.** In an easy pool each battle distributes **100 points** across five
   stats — Strength, Speed, Heart, Wit, Durability — as whole numbers adding to exactly 100. In a
   hard pool the player places **700 points anywhere** across the seven battles' thirty-five stats,
   and a battle may hold nothing. A pool plays one rule or the other and says which; the two are
   separate pools with separate prizes. Any distribution is allowed. There are no presets and no
   suggested splits.
3. **They submit.** The seven battles are sealed at that moment and cannot be changed.

There is no second session, no upgrade to buy, and nothing that costs money after the entry.

---

## How the winner is decided

When the pool concludes, every player's seven battles are compared against **every other player's
corresponding battle**. In a full pool that is 441 comparisons per player and 14,112 in total.

Each comparison is decided stat by stat: the higher number takes that stat. Whoever takes more
stats takes the battle. Equal on stats, the battle is drawn.

There is no pairing, no bracket, no clock, and no random element anywhere in the result. **Every
player faces the identical field**, so the only difference between two players is the quality of
their seven decisions.

---

## Why nobody has to take our word for it

**The battles are sealed until the pool closes.** They are encrypted to a key generated for that
pool, so no entry can be read — by us or by anyone — while the pool is still taking entries. Nobody
can see what to play against.

**The result can be recomputed.** After a pool concludes we publish every battle set, the key the
entries were sealed to, and the ranking. The scoring engine is a single published module, and it is
the same code the website runs and the settlement process runs. Anyone who wants to can take the
published data, recompute the ranking themselves, and check that the player we paid is the player
who won.

**The money is held by the program, not by us.** The prize sits in the pool's own account from the
moment the pool opens. There is **no instruction anywhere in the program that lets an operator
withdraw a prize**. The only ways money leaves that account are: paying the winner, repaying entries
when a pool does not fill, and two narrow paths used when a result is under review. A prize is
always paid to a player.

Entry payments are separate. They go to a program-controlled account that also funds the prizes, and
**that** account does have an operator withdrawal — it is how the business takes its margin. It is
signed by a multi-signature wallet rather than one key, and the program refuses any withdrawal that
would dip into money still owed: the prizes of every open pool, and every entry that might still
have to be repaid. So the margin can be taken; the players' money cannot.

---

## When something goes wrong

**The pool does not fill.** Fewer than 40 players at the 12-hour mark: every entry is repaid in
full, automatically. Anyone can trigger it — it does not depend on us being available.

**A result is disputed or a player is flagged.** Entries are screened for a small number of
integrity signals. A flag does not decide anything by itself; a person reviews it and records a
signed decision.

That player's share is held rather than paid while the review runs — and **if nobody reviews it, the
player is paid anyway**: after seven days, any signer may release a held share to its owner.
Inaction pays the player, never the operator. There is an appeal, decided by someone other than
whoever raised the flag. If a flag is upheld, the share is not returned to us either — it passes to
the next eligible player.

**We disappear.** The pool-closing and repayment steps can be run by anyone, not only by us. A pool
that has taken money cannot be left stranded because our servers are down.

---

## Where it runs, and who cannot enter

The service is not available in a list of territories, published on the rules page and enforced at
entry. Wallets are also screened against published sanctions lists. Both checks refuse when they
cannot get an answer — an unresolvable location is treated as blocked rather than allowed.

Entry is 18+, confirmed by the player before they can pay.

**Enforcement is on entry, never on payment.** Someone who entered lawfully and later travels is
still paid, and is still repaid if their pool does not fill.

---

## What is built, and what is not

**Built and running on a test network:** the program, the entry gate, the sealing, the scoring, the
settlement process, the website, and the published-results pages.

**Not done:** it has never run on the main network, and no real money has ever entered it. No
outside opinion has been obtained on the characterisation in §8 of the product document: the
decision to proceed on the operator's own analysis, with opinions pursued in parallel rather than
as a precondition, is register row R1 and was reaffirmed on 2026-09-16. One written opinion remains
a precondition for the 0.5 SOL tier and above (R6). An independent security review of the program
is planned after the first ten settled pools rather than before — a decision taken deliberately,
and the reason the entry price is capped at 0.1 SOL until then.

**Founder-set numbers**, changeable without new code: the entry prices, the prize amounts, the
12-hour window, the 40-player minimum, the territory list, and which entry tiers are open. Only the
0.1 SOL tier is open.

---

*Canonical sources: `docs/AS-BUILT.md` for what exists · `docs/PID_Blotto-Cup_v0.5.md` for the
product intent · `docs/BUILD-ROADMAP_v1.0.md` for the decisions behind every number above.*
