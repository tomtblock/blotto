# STATE — 2026-09-15 21:09 local (00:09 UTC, 16 Sep) — by Claude Code

Phase:            WP0/WP1/WP2/WP4 complete · **T1 PLAN IS FROZEN** — PR #132 merged 2026-09-16T00:07:24Z
Waiting on:       the chain — pool 13's deadline at 22:41 local, then the new pool opens ~22:46. Then founder F-12.
                  A server-side wake-up is scheduled for 22:43 local, so the GO does not depend on this container.
After that:       F-19 ~10:46 Wed (T1 deadline) · F-01b more faucet before the first full pool
Live deadlines:   pool 13 (tier 0, 0 entrants, NOT a test) closes 22:41 tonight → pool 14 opens ~22:46 = **T1**
                  T1 deadline ~10:46 Wed
Blocked:          nothing. enter.ts is built and its register leg SIMULATED OK against the deployed program
                  (71796 CU, no state written). T1's ten headless seats can land as soon as pool 14 opens.
Results so far:   T1 plan frozen, not yet entered · T2–T8 not started

Decisions taken since P-01 (all recorded in DRIFT.md §G):
  - **Every test runs on tier 0.** Tier 1 cannot be opened: `set-open-tiers` refuses a tier whose live
    economics differ from the ratified table, and tiers 1–6 on chain still carry the superseded
    derivation (tier 1 reads a 25.6 SOL pot against a ratified 20). Opening it properly would cost a
    20 SOL pot. Tier 0 is already open at ratified economics.
  - Pools per tier are sequential, so the eight tests run one after another. The founder's 11:00/23:00
    cadence absorbs this: a deadline test fills a 12-hour cycle, a full pool settles in minutes.
  - **T3 changes character**: at exactly 40 seats it seals at its deadline and pays. That exercises
    seal_at_deadline, the boundary the program actually defends. T2 at 39 is the boundary from below.
  - F-03, F-04 and F-11 are deleted (DRIFT.md §G2). Two admin writes remain all week: set-paused for
    T3's pause, forfeit-escrow for T7.
  - **Two UI accounts, not three.** Roles rotate per pool instead of being fixed to a wallet.

WP4 findings (both would have failed T1 at 22:46 if found then):
  - the packet service refuses any wallet with no stored attestation at the current terms version; the
    manual never mentions this because in the app it is the clickwrap. enter.ts attests first.
  - the packet service answers in base64, not hex. Decoding corrected against app/src/entry/services.ts.

Verified on chain tonight (Helius devnet RPC):
  config 484 bytes and pool 849 bytes — migrations done, no legacy 52-seat pool open
  fill_deadline − opened_at = 43200 on pool 13 · cooldown 300 s · keeper = settlement signer
  vault rent cushion = **650240 lamports** measured (the 890880 figure is mainnet and wrong here)
  check-deployed: PASS — the deployed program matches this branch's wire contract on 19/33 instructions
  funder 8.0 SOL after funding · UI-A 4.99 SOL · UI-B 9.99 SOL · W00–W09 at 0.2 SOL each
  treasury 1.997 SOL, reserved 4.0 (pool 13's pot, returns at its refund)

Open founder questions (DRIFT.md §G5), none blocking tonight:
  Q6 admin signing — direct keypair or Squads proposal? (blocks T3's pause, T7's forfeit)
  Q7 who holds reviewer key 4ydb…wcL1? (blocks T7 entirely)
  Q8 ANSWERED — the geo gate PASSES from this container. The earlier 403 was a missing age/terms
     attestation, which enter.ts now makes for each wallet exactly as the app's clickwrap does.
  Q9 Playwright — build it, or record quota 0 against roadmap 5.1? (recommend quota 0)
  Q10 tiers 1–6 carry superseded economics — recommend leaving them, logged as a product follow-up

Conventions: P-IDs for preparation actions; F-IDs from the manual §3.1 as renumbered in FOUNDER-ACTIONS.md.
Keys: re-derive each session with
  BLOTTO_BT_SEED=… npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' battle-test/scripts/keys.ts derive
