# STATE — 2026-09-15 23:08 UTC = 20:08 founder local (UTC−3, inferred from P-01; confirm in P-03) — by Claude Code

Phase:            WP0 in progress (four drift checks running over the tree; DRIFT.md next) · Day 0 compressed into tonight
Waiting on:       founder — P-03 (store master seed, confirm timezone) · P-04 (dedicated devnet RPC URL) ·
                  F-01 (faucet → funder 6z4wriiac4d6bay57Pe4Gj3jxhjeT9HfbcH2VaM4r3Ue, first target 18 SOL) ·
                  F-02 (create UI-A/B/C on www.blotto.gg) — all requested 20:08 local
After that:       P-02 read DRIFT.md (~21:30 local) · F-04 + F-05 + F-11 prepared for the 22:47 local rollover (commands follow DRIFT.md)
Live deadlines:   pool 13 (tier 0, 0 entrants, NOT a test) deadline 22:41:21 local → refunds, Closed; pool 14 opens ~22:47 local
Blocked:          check-deployed.ts (public devnet RPC 429s) — needs P-04 · fan-out/enter dry-runs — no solana CLI here (WP4 decides)
Results so far:   T1–T8 not started

Chain as read 23:01 UTC (admin.ts status / pools, devnet, program 5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17):
  open tiers [1,0,0,0,0,0,0] · fill deadline 43200 s (12 h LIVE) · cooldown 300 s · paused false · kyc 0 · detection block false
  tier 0: price 0.1 SOL, pot 4.0 SOL · tier 1: price 0.5 SOL, pot 25.6 SOL (F-04 must shrink before tier 1 opens)
  treasury 1.997 SOL · min platform 0.5 SOL · reserved 4.0 SOL (pool 13's pot) · refundable 0 · next pool id 14
  pools 1–12 Closed (0–3 entrants each; pool 12 had 3), pool 13 Open 0/64 — nothing from this test has entered anything

Keys: derived from a master seed the founder holds (P-03); re-derive each session with
  BLOTTO_BT_SEED=… npx ts-node --transpile-only battle-test/scripts/keys.ts derive     (keys/ is gitignored inside battle-test/)

Survey findings (hypotheses until DRIFT.md confirms them):
  - 12-hour deadline ALREADY LIVE (D-E6, 2026-09-07; on-chain config reads 43200). Manual §4.0 / WP1 product PR dropped (P-01 Q3).
  - Floor 40 (R7-b): 40–63 seats SEAL at deadline and PAY; below 40 refunds. Matrix remapped (P-01 Q2): T2 = 39 → refund, T3 = 40 + pause → plays.
  - Single prize band (winner takes the pot). No 16 paid seats, no 270/1024, no 1.35 SOL.
  - Pentagon gone: <BlotMorph/> + <StatDials/> + rebalance.ts. Selectors TBD (WP0 app slice).
  - No Playwright spec in the tree; CI asserts the test signer is stripped from deployable bundles → Playwright route expected STRIPPED.
  - deviceHash wired (per-browser secret); ipHash rides empty.
  - Refund fork: pot vault → treasury; refunds paid FROM treasury.
  - Manual §12 "this manual passes check-language.sh" was false (3 hits, swapped); the gate greps the whole tree.
  - No solana / anchor CLI here; node 22 + cargo only.

Conventions: P-IDs for pre-catalogue founder actions; F-IDs reserved for manual §3.1.
