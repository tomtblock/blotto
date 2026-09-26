# STATE — 2026-09-26 21:55 UTC — by Claude Code

Phase:            **T7's blocker is cleared and the fill is starting.** The freeze is merged and
                  verified; the missing flag control is merged and live in production.
Waiting on:       **the founder: F-42 — sitting one.** I will fill to 39 unattended and then stop;
                  the rest needs them at the keyboard.
Blocked:          nothing.
Results so far:   T1 **PASS** · T3 **PASS** · T4 **PASS** · T5 **PASS** · **T6 PASS\*** ·
                  T2 **SPOILED** · T2R **PASS (7 of 8)** · pool 22 = observation, not a test
Money:            funder **8.164767840** · 72 wallets at 0.108 each · T7 needs ~6.9 SOL of it
Open PR:          none — **189 and 191 both merged.**
Parallel session: **program development** — `session_01CosZsm5MB312HdbJH6y2zJ`, branch
                  `claude/program-dev`. Separate lane, no overlap.

## Where this actually stands

Three things happened today, and the first two are the reason the third took as long as it did.

**The merge came first, and it had to.** This branch was 47 commits behind main and
`backend/scoring/src/engine.ts` — which the oracle imports, and which produced every frozen root
in this test — had moved by 24 lines. If it had changed behaviour, T3, T4, T5 and T6 would all
have been invalidated retrospectively, not just T7. **All four roots reproduce byte-for-byte
through the merged engine.** The change was additive: `scorePool` gained a mode parameter that
defaults to easy.

**§H31 — the dial run does not exist any more.** The merge turned a test file red, and the reason
was not merge noise: main deleted the seven-screen dial run on 2026-09-24. The board is the only
interaction now — 35 cells on one page, **three minutes** instead of 90 seconds, a
+1/+5/+10/+20 stepper instead of a drag, and a per-field lock. Every founder recipe in every plan
from T1 to T3 describes something that is gone, and one of them is now actively unsafe: under the
board's buzzer rule, "put 25 on one stat and leave the rest" ends at 40/15/15/15/15 — above the
25 cap that all four unconditional derivations rest on. T7 is written against the board; the old
generators stay untouched so the frozen roots keep reproducing.

**§H32 — two things I had written down were wrong.** `duplicate_sets` does not hard-block
anything: `hardBlocks` is published to the reviewer and read by no code that moves money (D-E9),
and detection runs at reveal in any case. And there is **no window** in which a reviewer can flag
a winner before it is paid — the crank reveals, scores, detects, commits and pays in one tick, and
detection returns no automatic flags. Both corrections are in DRIFT; the second is a product
finding for the founder rather than anything to fix here.

## T7, and why it is not the test the manual describes

**The manual's T7 cannot produce its own stated outcome.** §9 asks for one headless seat to win AND
for two seats to have their shares escrowed. Only rank 1 is paid, and a seat paid nothing escrows
nothing — so if one seat wins alone, the review path never runs. The founder ratified the redesign
on 2026-09-26.

**What runs instead, in one pool:**

- **The device half.** Both founder accounts played from **one browser profile**, so they derive
  the same device marker and the finding appears in the detection report. Detection flags nobody by
  itself, so this half ends at the report — which is the claim being tested.
- **The review half.** W00 and W01 carry **identical** battle sets, so they score identically
  against every opponent and **tie at rank 1** for 2000000000 each. Two shares is the only way the
  escrow path can run at all. Then: flag both during the fill → `pay_prizes` escrows both →
  release W00 → forfeit W01 (which moves **nothing**) → `pay_next_place` gives W01's share to W00.
  The treasury is unchanged from start to finish, and that is the point.

**What is unconditional, and what is not.** Pool 36 already holds one wallet that is not ours, and
its allocation is sealed. So `scripts/t7-bounds.ts` separates the two:

| | claim |
|---|---|
| **U1** | W00 and W01 finish on the same score and the same zones and share a rank — whatever anyone plays |
| **U2** | no capped seat can outscore a wall: its ceiling is 854, a wall's floor is 861 |
| **U3** | the founder cannot decide this pool: best rival 505 + 14 = 519, against 861 |
| **C1** | the shared rank is **1** unless the stranger takes 8 or more of the 14 half-points on offer against one wall — four wins of seven. Every capped set, every even split and every single-stat spike gives it none. |

If C1 fails the pair still ties, at rank 2, nothing escrows, and that is reported rather than
worked around.

**No results root is frozen**, for the first time in this test. A root is a function of all 64
allocations and one of them is sealed and not ours. What is frozen is the function and 63 of its
64 inputs; `reconcile.ts` recomputes the root at reveal and checks it against the chain, which is
the claim that actually matters.

**T7 is the first battle-test pool on the Phase B program** (live 2026-09-25T01:54:32Z). T3 settled
29 minutes before that deploy, so nothing earlier is confounded — but any T7 result that differs
from its predecessors has a second candidate explanation and the report will say so. `register.rs`,
`escrow.rs` and `flags.rs` are textually untouched by Phase B, and the easy-mode sealed payload is
byte-for-byte what every earlier pool used.

## The freeze standard, stated plainly

T6's freeze merged **before its pool existed** — the strongest form. T7 cannot reach that: the
founder chose pool 36, and pool 36 already existed and held an entrant. T7's standard is T3's —
frozen before any entry **of ours** — with one thing in its favour that T3 did not have: the
pre-existing entry is **sealed**, so the plan was written in ignorance of it, says so, and makes no
claim that depends on it. Unlike T3's, this freeze file was written at freeze time.
