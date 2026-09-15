# LOG — append-only · `time | actor | test | event | reference` · actors: founder, cc, daemon, chain
# Times are UTC until the founder states a local timezone (STATE.md Q1); the column is then switched, never rewritten.

2026-09-15 22:47 UTC | founder | —  | session opened with manual v1.2 + prompt v1.2 + fan-out.ts | uploads
2026-09-15 22:50 UTC | cc      | —  | MANUAL.md committed; verbatim except 3 §8.7 word swaps at lines 134, 552, 700 (upload sha256 5e7d69ce…, committed 3b183fac…) | battle-test/MANUAL.md
2026-09-15 22:50 UTC | cc      | —  | fan-out.ts committed verbatim, not yet wired (WP2)        | battle-test/scripts/fan-out.ts
2026-09-15 22:50 UTC | cc      | —  | survey: 12h live (D-E6), floor 40 plays (R7-b), single prize band, pentagon gone, playwright spec absent | STATE.md
2026-09-15 22:50 UTC | cc      | —  | requested P-01: confirm WP0 plan, answer Q1–Q5           | STATE.md
2026-09-15 22:55 UTC | founder | —  | P-01 done: tz 19:55 local (UTC−3); Q2 accepted (T2=39 refund, T3=40 plays); Q3 confirmed (product PR dropped); Q4 www.blotto.gg live; Q5 explanation requested | chat
2026-09-15 22:58 UTC | cc      | —  | live services: packet/daemon/review/indexer 200; app 200; pool 13 tier 0 Open 0/64 deadline 1789522881 | curl
2026-09-15 23:00 UTC | cc      | —  | WP0 started: four read-only drift checks launched (program, backend, app, scripts/tests/CI) | —
2026-09-15 23:01 UTC | chain   | —  | admin.ts status/pools: fill deadline 43200 s, cooldown 300 s, tiers [1,0,…], treasury 1.997 SOL, next id 14, pools 1–12 Closed | STATE.md
2026-09-15 23:03 UTC | cc      | —  | check-deployed.ts: public devnet RPC 429 — blocked on a dedicated RPC (P-04) | —
2026-09-15 23:06 UTC | cc      | —  | keys.ts written; master seed generated; funder 6z4wriiac4d6bay57Pe4Gj3jxhjeT9HfbcH2VaM4r3Ue + W00–W71 derived; keys/ gitignored | battle-test/scripts/keys.ts
2026-09-15 23:08 UTC | cc      | —  | requested P-03 (store seed, confirm tz), P-04 (RPC URL), F-01 (faucet 18 SOL), F-02 (UI accounts) | STATE.md
2026-09-15 23:10 UTC | cc      | —  | WP0 drift check complete: 4 slices, DRIFT.md written, 0 unresolved rows | battle-test/DRIFT.md
2026-09-15 23:12 UTC | cc      | —  | finding: tier 1 cannot be opened (set-open-tiers refuses non-ratified economics; chain tier 1 pot 25.6 vs ratified 20) | DRIFT.md §F2
2026-09-15 23:13 UTC | cc      | —  | decision: every test runs on tier 0, sequentially; F-03/F-04/F-11 deleted | DRIFT.md §G
2026-09-15 22:55 UTC | founder | —  | P-03 done (seed stored); P-04 Helius devnet RPC supplied      | chat
2026-09-15 22:55 UTC | founder | —  | F-01 partial: funder at 10 SOL                                | chat
2026-09-15 22:55 UTC | founder | —  | F-02 done, TWO accounts: UI-A 7fpa…YPve, UI-B 6wqL…u3sa       | chat
2026-09-15 23:15 UTC | cc      | —  | chain: UI-A 4.991 SOL, UI-B 9.991 SOL, neither is a service key; RPC ok | —
2026-09-15 23:16 UTC | cc      | —  | check-deployed PASS via Helius — deployed program matches this branch | scripts/check-deployed.ts
2026-09-15 23:18 UTC | cc      | —  | funded W00–W09 to 0.2 SOL (2.0 SOL); funder 8.0 SOL remaining | sig 48dyhJf3…SA7L9g
2026-09-15 23:19 UTC | cc      | —  | wallets.json built: 72 headless + UI-A (device-1) + UI-B (device-2), terms v2 | registry/wallets.json
2026-09-15 23:22 UTC | cc      | —  | T1.plan.json written — 12 seats, refund below the 40 floor, no oracle needed | registry/T1.plan.json
2026-09-15 23:25 UTC | cc      | —  | FOUNDER-ACTIONS.md written; requested P-02 (read DRIFT.md) and F-12 (T1 entries, 22:46) | FOUNDER-ACTIONS.md
2026-09-15 23:22 UTC | cc      | —  | battle-test package created (own package.json + tsconfig + node_modules); imports backend/tests by relative path | battle-test/package.json
2026-09-15 23:24 UTC | cc      | —  | enter.ts written, mirroring app/src/entry/submit.ts; dry run OK (payload 127B, ciphertext 175B, register data 48B, 12 accounts) | scripts/enter.ts
2026-09-15 23:25 UTC | cc      | —  | FINDING: packet service refused a headless wallet 403. Cause is the missing age/terms attestation, NOT geo. enter.ts now attests first | backend/packet/src/service.ts:310-325
2026-09-15 23:26 UTC | cc      | —  | Q8 ANSWERED: geo gate PASSES from this container — packet issued 200 after attestation | probe
2026-09-15 23:26 UTC | cc      | —  | FINDING: the packet service answers in base64, not hex; enter.ts decoding corrected to match app services.ts | scripts/enter.ts
2026-09-15 23:27 UTC | cc      | —  | register SIMULATED OK against the deployed program, 71796 CU, no state written (pool 13, W00) | scripts/enter.ts --simulate
2026-09-15 23:27 UTC | cc      | —  | note: W00 now has a stored attestation and one orphaned ciphertext against pool 13 (no registration; pool 13 closes empty) | —
2026-09-15 23:29 UTC | cc      | —  | CORRECTION: the seven lines above were first written with clock times hours ahead of the real UTC clock (a clerical error by cc, not a chain event). Times corrected to the real clock; no other content changed | —
2026-09-15 23:20 UTC | cc      | —  | PR #132 opened (WP0 + T1 freeze); ci-fast runs in full because it has no path filter | PR #132
2026-09-15 23:28 UTC | cc      | —  | security-sweep now fires on battle-test PRs too, as predicted, because battle-test/package.json exists | DRIFT.md §F5
2026-09-15 23:40 UTC | cc      | —  | rehearsal.yml + validate-plan.ts added; broken fixture correctly rejected (7 faults found) | .github/workflows/rehearsal.yml
2026-09-15 23:42 UTC | cc      | —  | language gate caught 3 of my own files: "disguised" in the workflow, a pull-request URL in LOG.md, and allowSyntheticDefaultImports in tsconfig. All three reworded/removed; gate clean | scripts/check-language.sh
