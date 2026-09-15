# STATE — 2026-09-15 22:50 UTC — by Claude Code
(Times are UTC until the founder states a local timezone — open question Q1.)

Phase:            pre-WP0 · manual + fan-out.ts committed verbatim · WP0 plan awaiting founder confirmation
Waiting on:       founder — P-01 (confirm the WP0 plan; answer Q1–Q5), requested 2026-09-15 22:50 UTC
After that:       P-02 read DRIFT.md and confirm (after the WP0 PR) · F-01 faucet, 09:00 on Day 0 (date not set — Q1)
Live deadlines:   none — no test pool has been opened
Blocked:          WP0 start (needs P-01) · Day 0 date + timezone (Q1) · test-matrix remap (Q2) · live app URL for the
                  console check and the control screenshots (Q4)
Results so far:   T1–T8 not started

Survey findings (hypotheses until DRIFT.md confirms them):
  - Manual §12 says "This manual passes" check-language.sh. It did not: three uses of a §8.7 word at lines 134, 552, 700,
    swapped before commit (LOG). The gate greps the whole tree, so battle-test/ is in scope for every PR.
  - 12-hour deadline is ALREADY LIVE in code: DEFAULT_FILL_DEADLINE_SECS = 12h (D-E6, 2026-09-07), held in
    Config.fill_deadline_seconds, changeable by `admin.ts set-pool-timing`. Manual §4.0 / WP1 product PR is moot.
  - Floor is 40 (MIN_SEATS, R7-b): a pool at 40–63 SEALS at its deadline and PAYS; below 40 it refunds.
    Manual §0.1, T2 (refund at 40) and T3 (refund at 63) describe the opposite of the program.
  - Prize table is a single band: PRIZE_BANDS_1024 = [1024]. Winner takes the whole pot; no 16 paid seats, no 270/1024.
  - Pentagon is gone: <BlotMorph/> + <StatDials/> with components/blot/rebalance.ts. Selectors TBD in WP0.
  - tests/rehearsal/playwright/entry-flow.spec.ts does not exist. window.__BLOTTO_TEST_SIGNER__ exists in source
    (app/src/tx/test-signer.ts) but .github/workflows/app-test-signer.yml asserts it is stripped from any
    deployable bundle. Playwright route expected STRIPPED; live console check still owed.
  - deviceHash is wired (services.ts → deviceMarker(pool), per-browser secret). ipHash rides empty (reveal/main.ts).
  - Refund fork: pot returns vault → treasury; entries refund FROM the treasury (platform_refundable). Manual §9 T1
    "treasury unchanged" is wrong in mechanism.
  - No solana / anchor CLI in this environment (node 22, cargo present). Chain reads will go through RPC from
    TypeScript; keygen for 72 wallets will use @solana/web3.js, not solana-keygen.

Conventions fixed this session:
  - Pre-catalogue founder actions carry P-IDs (P-01, P-02…); F-IDs stay reserved for the manual §3.1 catalogue.
  - Branch for this session's records: claude/sharp-bohr-c8aeub (WP0 will open rehearsal/wp0-drift from it).
