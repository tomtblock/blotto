# STATE — 2026-09-16 15:34 local (18:34 UTC) — by Claude Code

Phase:            **T4 BLOCKED — the entry gate is refusing everyone.** Plan frozen (PR 133, 16:22:00Z),
                  62 wallets funded, nothing entered. The founder's UI-A entry was refused at 18:20Z and
                  so is every wallet I control. Server-side, total, and /health says it is fine.
Waiting on:       **F-22 — read the blotto-packet log.** One line ("entry packet NOT issued — <reason>")
                  separates a stale OFAC mirror from a signer fault. DO NOT restart blind: with the mirror
                  as the only source, a broken download means the service refuses to boot at all.
After that:       gate reopens → F-21 step 2 (UI-A, UI-B enter pool 15) → I run W00–W61 → seals and pays.
Live deadlines:   pool 15 deadline 01:52:26Z, ~7h15m. If the gate is still shut near it, pool 15 refunds
                  and T4 moves to the next pool. The frozen plan is reusable; only poolId/poolPda/freeze change.
Blocked:          T4 and everything after it, on F-22.
Results so far:   T1 **PASS** · T2–T8 not started

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
