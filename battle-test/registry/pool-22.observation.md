# Pool 22 — an OBSERVATION, not a test

**This record claims nothing and proves nothing.** It is here so that what we did on pool 22 is on
the branch alongside the tests, clearly marked as not being one of them.

## Why it cannot be a test

A frozen prediction is only evidence if it predates the thing it predicts. Every scored test in this
battle test has that property — T4's plan was merged before pool 16 existed, T5's before pool 18,
T2R's one hour 34 minutes before pool 21. Pool 22 already has an entry: **UI-A registered at seat 0
before any prediction for it was written.** A plan frozen from here would postdate the pool's first
entry, and a reader who wanted to be sceptical would be right to be.

So pool 22 is run as a **shakedown**: the founder's ratified call of 2026-09-19, after being offered
the alternative of letting it lapse.

## What it is for

T6 is the first test whose subject is a failure path — what the program does to the 65th entrant,
and what the site says to a person who was still playing when the pool filled. Nothing in T1, T4,
T5, T2 or T2R has exercised either. Running it once unfrozen tells us whether the mechanics work
**before** a frozen prediction is spent on them, and this project has now lost one pool to a spoiled
field (§H16) and one to a seal lockout (§H6) for want of exactly that.

## State before anything was done

```
pool 22   CDKBFm2DybDUrkYhZzDXpPExoL3PU2EJbcBD1JboPaF7
          Open · 1 of 64 seated · deadline 2026-09-20T01:27Z
          vrf seed committed · pass collection GzdwhT6s… exists
  seat 0  UI-A  7fpaNh8mAi9SDJyvu6sVFxsqqP8LE3whvBJ1K9ZFYPve  class 1
```

`preflight.ts --pool 22` returned GO on every check that is not "UI-A is already seated", which is
the condition this record exists to state.

## What is being looked at

Questions, not criteria. None of these is a pass or a fail.

1. Does the 65th register revert with **`PoolNotOpen` (6000)**, as `register.rs`'s gate order says it
   must, rather than `PoolFull` (6010)?
2. Does a refused attempt really move no lamports beyond the network fee?
3. **What does the browser actually say to UI-B?** A sentence, a spinner, or nothing. This is the
   half no headless run can see, and the reason a founder session is part of it.
4. How long does a 63-wallet fill take at `--concurrency 1` against this RPC, and how long does the
   settlement crank take after the seal?
5. Does the detection report contain any trace of a wallet that was refused?

## The field, and the one thing it is engineered for

`registry/pool-22.field.json` — 63 headless allocations, regenerable exactly with
`scripts/shakedown-field.ts --wall-seed 2200 --field-base 2201 --seats 63`. It is a **field file,
not a plan**: no expected ranks, no results root, no pass criteria, and CI's plan gate does not
sweep it, because there is nothing here to hold to a prediction.

One seat, W00, is a `wall` — three stats at 26 or above every battle, rotating. That is not
decoration. **It makes a wallet we hold the likely winner, so the 4 SOL pot comes back to the test
roster** rather than stopping somewhere the run cannot spend from.

**Likely, not certain, and the difference is measured rather than assumed.** UI-A is already seated
with an allocation nobody here chose or can see. Scoring this field against a range of UI-A plays:

| what UI-A might have played | W00's rank | takes the whole pot? |
|---|---|---|
| the recipe it was sent (one stat to 25, rest 18–19) | 1 | yes |
| an even split, 20×5 | 1 | yes |
| everything on one stat | 1 | yes |
| a static three-stat 34/33/33 | 1 | yes |
| a static two-stat 50/50 | 1 | yes |
| **a ROTATING three-stat wall, 300 seeds** | never worse than 2 | **only 152 of 300** |

The last row is the honest one. A rotating wall is the strongest play available and it beats or ties
W00 about half the time. UI-A was sent the capped recipe, so the first row is what we expect — but
the funding ask in §F-32 is sized so that **it does not matter which way this falls.**

## Result

Not yet run. Filled in below when it is, with the observations as observations.

