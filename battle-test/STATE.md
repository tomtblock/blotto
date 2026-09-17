# STATE — 2026-09-17 09:21 local (12:21 UTC) — by Claude Code

Phase:            **T5 planned and funded — waiting on the freeze merge, then the founder's two entries.**
                  T4 PASSED on pool 16 (UI-A took the whole 4 SOL pot). T5 inverts it: a HEADLESS
                  wallet wins and neither founder wallet does.
Waiting on:       **merge the T5 freeze PR**, then enter as ordinary field seats (see below).
                  Also open, neither urgent: F-24/F-25 (seal-lockout fix now or after the week) and
                  the Vercel ignore step, approved and ready to apply (~85% off build minutes).
After that:       I sweep and re-fund the roster from the 10 SOL, then run 62 headless seats.
Live deadlines:   none for T5 — the plan deliberately names no pool.
Blocked:          nothing.
Results so far:   T1 **PASS** (refund) · T4 **PASS** (scored, paid) · T2, T3, T5–T8 not started

**T5 — what it tests and what the founder sets:**
  W00 takes the wall and the 4 SOL pot. W01 takes the pole and last place. BOTH founder wallets are
  ORDINARY FIELD SEATS that do not win — the claim T4 could not make, since there the operator's own
  account won and nothing ruled out that it was privileged.
  → UI-A: one drag a battle, a stat to 25, in order Strength, Speed, Heart, Wit, Durability,
    Strength, Heart. UI-B: the same but Durability, Wit, Heart, Speed, Strength, Wit, Speed.
    THE ONLY RULE THAT MATTERS: every stat between 1 and 25. Never above 25, never down to 0.
  → PROVEN over 60 seeds: such a seat loses to a wall 840/840 and beats a pole 840/840, so it lands
    in ranks 2..63 for ANY allocation in that range — not just the recipe.
  → The non-zero floor is load-bearing: two or more zeroes can DRAW with a pole, and "cannot come
    last" stops holding.
  → Founder ranks are predicted as a RANGE, not a number. T4 showed hand-dialling lands elsewhere
    (1 of 7 battles matched), so exact positions are computed at reveal. Nominally 62nd and 63rd —
    near the bottom, because a near-even spread is the weakest shape the game has.
  → Funder holds 10.049945 SOL. Roster needs sweeping and re-funding before the run.

**T4's result, and what it actually proved (2026-09-17 02:23Z):**
  UI-A net +3.895554578 SOL against +3.895564000 predicted — 9422 lamports apart. Vault 650240
  EXACTLY as predicted. The chain's own committed payout list is [{"seat":0,"amount":"4000000000"}].
  → The plan was frozen naming pool 15 and ran UNEDITED on pool 16. A prediction frozen before its
    pool existed is stronger evidence, not weaker.
  → **H10 — the finding worth keeping.** The founder's hand-dialled allocations matched the plan's
    exact numbers in 1 of 7 battles (UI-A) and 4 of 7 (UI-B). Every CONDITIONAL prediction about
    those numbers was wrong; every UNCONDITIONAL one was exactly right, because all seven UI-A
    battles still held three stats at 26+. The claim under test was "rank 1 holds for ANY wall
    against a field capped at 25" — and a different wall, played by a human under a 90-second
    clock, took rank 1 and the whole pot.
  → **H8 — five wallets burnt, and the fault was MINE.** W22, W42, W43, W55, W65 sealed then failed
    to register. The gate was healthy at every probe; my runner let sendAndConfirmTransaction pick
    its own blockhash and the failure was always in PREFLIGHT. skipPreflight + a `confirmed`
    blockhash fixed it. My first fix (a `finalized` blockhash) was WRONG and burnt W55.
    The guardrail built hours earlier stopped each run at its first casualty — five, not sixty-two.
    All five replaced by spares playing the burnt seats' own frozen allocations, so the scored field
    was exactly the planned field.
  → **H9 — reconcile's 0 INPUT_DRIFT is a limitation, not a fact.** harvest never reads the
    published bundle (PR 134 removed /sealed-entries), so it cannot compare allocations. Same reason
    allocations.ts shows 60 COMMITTED and 0 VERIFIED on a pool that DID reveal. Fix specified.

**GUARDRAILS BUILT 19:22Z, in boundary, proven:**
  1. scripts/preflight.ts — go/no-go before anybody plays: pool open and register-ready, no wallet
     already seated, and a real packet issued PER NAMED WALLET against this pool. Requests packets
     only. **Prints its own blind spot**: it cannot see whether a wallet is ALREADY barred (no read
     path exists), and says GO for pool 15 where both UI accounts ARE barred.
  2. enter.ts STOPS on the first seat that sealed and then failed. Proven: W64 sealed, failed to pay,
     run halted, W65 never touched. One loss instead of sixty-two.
  3. --simulate no longer seals (§H7 — my own bug; the "safe" mode was barring wallets, and had
     already burnt W62). Verified: W66's first-ever seal returned 204 after a simulate run.
  Product fix SPECIFIED NOT APPLIED in docs/FIX-seal-lockout.md — four parts, the central one is a
  single indexed read the packet service can already make. app/ and backend/ untouched.

**H6 — the worst finding of the test (19:09Z). A failure between sealing and registering bars that
  wallet from that pool FOREVER.**
  submit.ts:99-100 stores the ciphertext, THEN requests the packet. The store refuses a second,
  DIFFERENT allocation for a seat that already has one (audit D-01, and right on its own terms — it
  stops a second run destroying a paid entry). But a replay always has a fresh salt, so it is always
  different, so it is always refused. MEASURED on W63: first seal 204, same bytes 204 (idempotent),
  different bytes 409 "already sealed". CiphertextStore has only put and get — no delete anywhere.
  → Any transient failure after the seal permanently removes that wallet from that pool, silently.
  → On mainnet one entry-service blip bars every player who reached the seal, for good, and the pool
    may then fail to fill with people who would have paid.
  → The copy says "Trying again will not change the answer" — true, for a reason nobody can discover.
  → Fix (not made): gate the overwrite on whether an Entry PDA exists on chain, not on the store.
  DRIFT.md §H6 · REPORT.md §2 F-4 · decision F-24.

**The entry-gate outage (02:18Z–18:56Z) — the finding that exposed H6.**
  Every entry on the platform was refused for at least sixteen hours because Turnkey stopped signing:
  the organisation was over its free-tier quota. Resolved by the founder upgrading the plan.
  What survives, and matters more than the quota: **/health read `ok: true` throughout**, and carries
  no signal about the signer at all — it was still green after the restart, with the gate shut.
  Every instrument an operator or an uptime monitor would check stayed green through a total outage.
  → I named two candidate causes and leaned toward the wrong one (a stale sanctions mirror). The
    evidence against it was already in hand. Recorded as a correction in DRIFT §H3, not quietly fixed.
  → H4: a failed packet logs "packet issued" one line BEFORE it fails (service.ts:363).
  → H5: packet service and settlement daemon share one Turnkey org. T4 alone is ~65 activities, the
    week ~450, and a retrying settlement spends quota because exportSecret runs at the top of every
    crank pass. F-23 raised: size the plan for the week, not the night.
  DRIFT.md §H3–H5 · REPORT.md §2 F-2.

**The T1 reveal finding (15:08 UTC) — read this one.**
  Pool 14 refunded all twelve seats correctly but will NEVER publish its sealing secret. Traced end to
  end: the program permits the reveal and says why in its own doc comment, but `crankPool` returns for a
  Refunding pool and no-ops for a Closed one, both before `assembleBundle` — which holds the only
  production call to `revealPoolSecret`. No `admin.ts` fallback either. Custody is not the blocker.
  Corroborated across pools 9, 10, 11, 12, 13 and 14: not one refunded pool has ever revealed.
  → T1's 12 allocations are permanently COMMITTED; VERIFIED is unreachable for them.
  → T2 (39 seats) will hit the same wall. Expect it, do not re-diagnose it.
  → T3 onward seal and score, so those verify normally.
  → T1's PASS is unchanged. It tested refunds and every frozen prediction held.
  → The fix is a few lines in `backend/`, outside this week's source boundary. NOT made.
  Full evidence DRIFT.md §H1 · founder-facing REPORT.md §2 F-1 · decision F-20.

T4 readiness, all read live at 15:05 UTC:
  pool 15 Open, 0 entrants, vrf seed committed (non-sentinel), pass collection PPvM1R3B…enBRf exists
  → enter.ts's readiness guard will pass. **No founder admin write is needed to prepare the pool.**
  funder 6z4wriia…r3Ue holds 7.999995 SOL. 52 wallets at 0.15 plus fees = 7.80026, leaving 0.1997. It fits.
  W00–W09 were refunded and still hold 0.195559 each — comfortably over the 0.104443 an entry costs.
  populations.ts is written and property-tested: wall beats cappedField 11200/11200, pole loses
  11200/11200, 64 unique sets, every allocation sums to 100.

T4 work — DONE except the founder's part:
  1. DONE scripts/oracle.ts. No scoring logic of its own; it composes backend/scoring. Self-checks
     against all 36 committed Python pool vectors first, and a negative control proved that check
     can fail.
  2. DONE registry/T4.plan.json. 64 seats. UI-A rank 1 at 881 half-points paid the whole 4 SOL pot,
     UI-B rank 64, field 2..63 unpaid. Root 3950d12c…a34ac, conditional on the planned seat order.
     validate-plan accepts it and still rejects the broken fixture.
  3. DONE funding. W10–W61 at 0.15 each, 3 transactions, funder left at 0.199980 exactly.
  4. DONE freeze. PR 133 merged 16:22:00Z, merge commit 6324f615…105e9. The plan's sha256 at that
     commit is c74333f0…e064 and the working copy hashes identically.
  5. TODO F-21 step 2 — the founder's two entries. Then me: 62 headless seats, and the 64th seals it.
     8h17m left on pool 15's deadline as of 17:35Z. Below 40 seats at the deadline it refunds and T4
     moves to the next pool — that is a reschedule, not a failure.

Why UI-A must win, in one line, so nobody has to trust the oracle: a wall's score floor is 875
half-points and the best any field seat can reach is 868. Full arithmetic in the plan's
`unconditionalDerivation`. It holds for ANY wall against a field capped at 25, not just these numbers.

The one way T4 breaks: the run clock is 90 seconds for ALL SEVEN battles, not 15 a screen, and on
expiry every unlocked battle is entered as the even split — neither a wall nor a pole. So UI-A's
recipe is two dial drags a battle and UI-B's is one, and the exact sets were computed by running the
app's own rebalance.ts rather than chosen. DRIFT.md §H2.

Decisions taken since P-01 (all recorded in DRIFT.md §G):
  - **Every test runs on tier 0.** Tier 1 cannot be opened: `set-open-tiers` refuses a tier whose live
    economics differ from the ratified table, and tiers 1–6 on chain still carry the superseded
    derivation. Tier 0 is already open at ratified economics.
  - Pools per tier are sequential, so the eight tests run one after another. The 11:00/23:00 cadence
    absorbs this: a deadline test fills a 12-hour cycle, a full pool settles in minutes.
  - **T3 changes character**: at exactly 40 seats it seals at its deadline and pays. T2 at 39 is the
    boundary from below.
  - F-03, F-04 and F-11 are deleted (DRIFT.md §G2). Two admin writes remain all week: set-paused for
    T3's pause, forfeit-escrow for T7.
  - **Two UI accounts, not three.** Roles rotate per pool instead of being fixed to a wallet.
  - **Fund at 0.15 per wallet, not 0.2** (founder, 14:18 UTC), and run T4 on pool 15 rather than let it lapse.

WP4 findings (both would have failed T1 if found later):
  - the packet service refuses any wallet with no stored attestation at the current terms version; in the
    app that is the clickwrap. enter.ts attests first.
  - the packet service answers in base64, not hex. Decoding corrected against app/src/entry/services.ts.

Verified on chain (Helius devnet RPC):
  config 484 bytes and pool 849 bytes — migrations done, no legacy 52-seat pool open
  fill_deadline − opened_at = 43200 · cooldown 300 s · keeper = settlement signer
  vault rent cushion = **650240 lamports** measured (the 890880 figure is mainnet and wrong here)
  check-deployed: PASS — the deployed program matches this branch's wire contract on 19/33 instructions
  per-entry sunk cost 0.104443 SOL measured against 0.104436 predicted — within 0.007%
  treasury 1.995448320 after T1, which is what the money-conservation arithmetic predicts to the lamport

Open founder questions (DRIFT.md §G5), none blocking T4:
  Q6 admin signing — direct keypair or Squads proposal? (blocks T3's pause, T7's forfeit)
  Q7 who holds reviewer key 4ydb…wcL1? (blocks T7 entirely)
  Q8 ANSWERED — the geo gate PASSES from this container. The earlier 403 was a missing age/terms
     attestation, which enter.ts now makes for each wallet exactly as the app's clickwrap does.
  Q9 Playwright — build it, or record quota 0 against roadmap 5.1? (recommend quota 0)
  Q10 tiers 1–6 carry superseded economics — recommend leaving them, logged as a product follow-up
  F-20 NEW — does the reveal gap become a product PR after the week? Blocks nothing; T4 proceeds either way.

A faucet round is still wanted before T5: 0.15 × 52 spends 7.8 of the 8.0 available and leaves the funder
nearly empty until T4's sweep returns the money.

Conventions: P-IDs for preparation actions; F-IDs from the manual §3.1 as renumbered in FOUNDER-ACTIONS.md.
Keys: re-derive each session with
  BLOTTO_BT_SEED=… npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' battle-test/scripts/keys.ts derive
