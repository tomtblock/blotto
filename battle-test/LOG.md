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
