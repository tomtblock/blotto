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

## Observation 1 — the fill, and the RPC underneath it

63 of 64 seats at 19:17:46Z. 62 headless wallets landed on top of UI-A's seat 0. Every wallet the
field file named is in the pool; no substitutions.

**It took five runs, and the reason is the RPC, not the app.** Each run landed about fifteen seats
in roughly fifty seconds and then died with `Signature … has expired: block height exceeded`. The
pacing was perfectly steady right up to each failure — eight slots between consecutive seats, no
degradation — which is what rules the app out: a service degrading under load slows down first. A
throttle does not.

`MANUAL.md` §4.3 wrote this down in advance and it was not followed:

> Choose a dedicated devnet RPC (Helius, QuickNode, Triton all have free tiers) — **the public
> endpoint will throttle** T6's 73 concurrent registrations and **you would be measuring the RPC,
> not the app.**

This run used `api.devnet.solana.com`. Wall clock for the 62 seats was **5 min 20 s**, which is over
T6's five-minute threshold — and that number is a measurement of the public endpoint, so it is not
evidence about the product either way.

**This is the shakedown doing its job.** Had T6 run first, its fill-time pass criterion would have
failed against a threshold it was never testing, and the report would have carried a product finding
that was really a configuration mistake. **T6 needs a dedicated devnet RPC before it runs.**

## Observation 2 — the seal gate refused in BOTH directions, on live traffic

Unplanned, and better evidence than anything designed for it. Across 80 attempts:

| what happened | wallets | what the gate did |
|---|---|---|
| sealed, then the register expired — **no Entry on chain** | W14, W29, W43, W57 | **allowed** the re-seal; all four retried and landed |
| sealed **and** already registered, re-attempted on a sweep | W43–W56 (14) | **refused**, `409 already sealed`, nothing written |

Until now only the allowing half had been shown live (T2R, §H6). The refusing half is the one that
protects a paying entrant's allocation from being overwritten, and it had never been exercised
against a real paid seat outside a test suite. Here it refused fourteen of them.

**W43 demonstrates both halves by itself**: it burnt, retried and landed, and was then correctly
refused when a later sweep tried to seal it again. That is the exact distinction PR 147 was built to
draw — a stored ciphertext with no paid seat is an abandoned attempt, and one with a paid seat is
somebody's entry.

Before the fix, the four in the first row would have been **lost wallets**, as eleven were across
T2, T4 and T5.

## Observation 3 — the pool settled, and fast

| event | time | slot |
|---|---|---|
| W62 registers — the 64th seat, sealing the pool | 19:36:01Z | 501013613 |
| `reveal_pool_secret` | 19:36:07Z | 501013649 |
| `commit_results` | 19:36:08Z | 501013657 |
| `pay_prizes` | 19:36:10Z | 501013664 |

**Nine seconds from seal to paid**, against T6's 120-second threshold. Unlike the fill time, this
number is not contaminated by the RPC: it is the settlement daemon's own work, measured in block
times.

**W00 took rank 1 and the whole 4000000000 pot**, as the field was built for. The 4 SOL is back in
the test roster, so T6's funding does not depend on it.

**The per-seat cost came out at exactly 4441080 lamports**, confirming §H20's lower band on a third
pool: W00 started at 145558920, ended at 4041117840, and
`145558920 − 4041117840 − 100000000 + 4000000000 = 4441080`. That is the §H23 formula run by hand on
a seat that was PAID — the case the old subtraction got wrong.

## Observation 4 — the refusal works, and the sentence is wrong. THIS IS THE FINDING.

UI-B played the full session and submitted into a pool that was already `Scored`. It was refused.
This is what it saw:

> This attempt did not go through, and nothing was signed or charged this time. It was not a decision
> about you: either an earlier attempt from this wallet at this pool is the one that stands, or the
> pool stopped taking entries first. The pool page shows whether a seat was taken, and you can ask us
> about your own entry.

**What passed, and it is not nothing.** It is a sentence, not a spinner. It does not invite a retry
that cannot work. It does not imply the player was judged. And its central claim is **literally
true, verified independently**: UI-B's balance is byte-for-byte unchanged at **11.673357239** — it
was not charged an entry, and it was not even charged a transaction fee, because no transaction was
ever built.

**What failed: the app says "either / or" about something the server already told it.** That is
`COPY.tx.sealConflict`, and the player got it instead of the sentence written for this exact
situation, which exists and was not shown:

> `COPY.tx.poolFull` — "This pool filled before your entry reached it, so nothing settled. Another
> pool in this tier opens once this one has been paid out."

That is T6's pass criterion almost word for word. **Three separate layers keep it from ever
reaching a player, and each one is individually reasonable:**

1. **`submit.ts` posts the ciphertext BEFORE the register transaction** — deliberately, because a
   paid entry whose ciphertext never landed is the worse failure. So a late entrant is refused at
   the SEAL step and never reaches the chain, and no on-chain error code is ever consulted.
2. **Even if it did reach the chain, `poolFull` is unreachable.** It maps from error 6010
   (`PoolFull`), but `register.rs` checks `pool.state == Open` (6000 `PoolNotOpen`) *before*
   `entrants < CAPACITY`. The 64th entry seals the pool, so a 65th always fails the state gate.
   **6010 cannot fire for a pool that filled.** T6's own frozen plan derives this in
   `unconditionalDerivation.errorIsPoolNotOpen` — written hours before this run — and the
   consequence for the copy layer was not noticed until a person saw the screen.
3. **`outcome.ts` discards the distinction the server made.** The route answers a non-Open pool with
   `409 {"error":"pool closed to entries"}` and a genuine overwrite with
   `409 {"error":"already sealed"}` — two different causes, deliberately distinguishable. The
   client branches on **stage and status only**:

```ts
// app/src/entry/outcome.ts:110
const kind = !e.refused ? 'rpc-failure'
  : e.stage === 'ciphertext' && e.status === 409 ? 'seal-conflict'
  : 'entry-refused';
```

The body is never read, so both collapse into one message that has to hedge. **The server knew. The
app owned the right sentence. The wiring between them loses it.**

**Consequence for T6, which is the whole point of running this first.** T6's criterion is *"the late
entrant sees the legible 'filled before your entry reached it' copy, not a spinner"*. **As the
product stands today, T6 would FAIL that criterion** — and the failure would read as a copy problem
when it is a three-layer plumbing problem. The shakedown bought that for the price of one pool.

### The fix, as a proposal — this is product code and needs the founder's say-so

Smallest version: have `outcome.ts` read the 409 body's `error` field and map
`'pool closed to entries'` → `pool-closed` and `'already sealed'` → `seal-conflict`. That alone
makes `COPY.tx.poolClosed` — *"This pool is no longer taking entries, so nothing settled. Open pools
are listed on the Pools tab."* — reachable, which is true, unhedged, and already written.

Larger version, if the founder wants the word **filled**: the ciphertext route would also have to
say WHY the pool is closed, because a pool that filled and a pool that hit its deadline are both
simply not `Open`. The route already holds the pool's state and could carry the entrant count.
Worth doing only if "filled" is judged materially better for a player than "no longer taking
entries" — that is a brand-voice call, not an architecture one.

### RULED AND BUILT, 2026-09-19 — PR 157

The founder took **both** halves: fix the wiring, and use the word **filled**. Shipped as its own
product PR, outside this folder, with the boundary lane untouched.

The route now answers `pool filled` at capacity and `pool closed to entries` below it. The seat
count is the only thing that separates the two cases, since both are simply not `Open` — and it
**gates nothing**: it chooses the wording of a refusal the state has already decided, and a test
pins that an `Open` pool at capacity is still accepted, so this cannot quietly become a second gate
that turns away the 64th honest entrant.

The generic-refusal rule is intact. What PID §8 protects is the **entry packet's** refusal — geo,
sanctions, age — where naming the failing check would make `/packet` an oracle a probe could walk.
`/packet` is untouched. `EntryServiceError` carries a reason only for the ciphertext stage and drops
it for the packet stage **in the constructor**, because a rule enforced by every call site's good
manners lasts until the next call site.

Two things tightened on the way through, both about the same worry — that this field could become a
channel for text nobody vetted:

- the reason passes a **closed allowlist** of the three strings the route sends; anything else
  becomes null and the player gets the cautious message, which is true of all three cases;
- the allowlist requires an **own** property, because plain member access walks the prototype chain
  and a planted `Object.prototype.error` would otherwise be read out of a response carrying no error
  at all — letting something other than the server choose the sentence.

app **517** tests (+8), packet **201** (+6), both typecheck, both repository gates clean.

**One thing to know about the deploy, and it is the §F-28 trap again:** the web app ships
automatically on merge, the entry service does **not** — `deploy-backend` is `workflow_dispatch`
only. Until it is run the app keeps receiving the old single string and keeps showing the cautious
message, which stays correct. Nothing breaks in the gap, in either order. But **T6 must not run
until both halves are live**, or it will test the old behaviour and its copy criterion will fail for
a reason that has already been fixed.

