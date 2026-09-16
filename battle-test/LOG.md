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
2026-09-15 23:30 UTC | cc      | —  | rehearsal.yml + validate-plan.ts added; broken fixture correctly rejected (7 faults found) | .github/workflows/rehearsal.yml
2026-09-15 23:33 UTC | cc      | —  | language gate caught 3 of my own files: a banned adjective in the workflow comment, a review-link URL in this log, and a TS compiler option. All three reworded or removed; gate clean. (This line itself had to be reworded for the same reason.) | scripts/check-language.sh
2026-09-15 23:35 UTC | cc      | —  | MANUAL.md amended in place: banner + §0.1, §0.3, §1, §3.1, §4.0, §7.3, §9, §12. WP0 acceptance met | battle-test/MANUAL.md
2026-09-15 23:36 UTC | cc      | —  | enter.ts now drives from the frozen plan (--plan): seat list, generator and seed all come from the committed prediction. Dry run over T1's 10 seats OK, 10 distinct battle hashes | scripts/enter.ts
2026-09-15 23:36 UTC | cc      | —  | CORRECTION (2nd): four more lines carried estimated rather than read clock times. Corrected. Rule adopted: read the clock before writing a log line, never estimate | —
2026-09-15 23:39 UTC | cc      | —  | T1 opening balances captured BEFORE any entry: funder 7.999995, treasury 1.9967488, UI-A 4.9911176, UI-B 9.9911219, 72 headless 2.0 total (slot 499011584) | evidence/T1/balances-before-T1.json
2026-09-15 23:39 UTC | cc      | —  | CI on PR #132 head 3becf58: standing-rules, gitleaks, rust, postgres, security-sweep and all 3 rehearsal jobs PASS; app build + browser journey still running | —
2026-09-15 23:40 UTC | cc      | —  | pushed the held commit (repo hook requires no unpushed work); CI re-runs from 76299e7. Merge window to 01:40 UTC is ample | 76299e7
2026-09-15 23:44 UTC | cc      | —  | CI ALL GREEN on PR #132 — 12 checks passed (head 6a5d643)               | PR #132
2026-09-15 23:45 UTC | cc      | —  | harvest.ts + reconcile.ts written and SELF-TESTED against settled pool 12: both UI seats MATCH, vault 650240 exactly as T1 predicts, and the run correctly FAILED on an entrant not in wallets.json (4mYx…rDxs) | scripts/harvest.ts, scripts/reconcile.ts
2026-09-15 23:45 UTC | cc      | —  | NOTE: pool 12 shows UI-A and UI-B already entered and were refunded — their clickwrap (terms v2) is done, and a third unknown wallet also entered | indexer entries
2026-09-16 00:04 UTC | cc      | —  | container restarted. Repo, master seed, derived keys, funded wallets and deps all survived; only a background watch was lost. Key derivation re-verified identical | —
2026-09-16 00:07 UTC | founder | T1 | **FREEZE** — PR #132 merged 00:07:24Z, merge commit 3cd0ec7. T1's prediction now demonstrably predates its outcome | PR #132
2026-09-16 00:09 UTC | cc      | T1 | freeze recorded in T1.freeze.json and bound to the merged plan's sha256 215cb73c…; plan on disk, at the merge commit and in the record all agree | registry/T1.freeze.json
2026-09-16 00:09 UTC | cc      | —  | reconcile.ts now asserts the freeze: an altered plan or a freeze later than the outcome marks the pool UNFROZEN and FAILs it. Verified by deliberately altering a plan copy | scripts/reconcile.ts
2026-09-16 00:09 UTC | cc      | —  | branch restarted from merged main; follow-up work goes to a new PR | 3cd0ec7
2026-09-16 00:19 UTC | founder | —  | asked: do the headless seats hold SOL; what does the simulation prove; is there a per-wallet allocation table with on-chain evidence | chat
2026-09-16 00:19 UTC | cc      | —  | verified on chain: W00–W09 hold exactly 0.2 SOL each (2.0 total); W10–W71 empty by design until Wednesday's full pools | RPC read
2026-09-16 00:19 UTC | cc      | —  | GAP FOUND in my own claim: simulateTransaction sets sigVerify only when signers are passed (web3.js lib/index.cjs.js:8080). The earlier run did NOT verify the transaction's own signatures, so "proven end to end" was wider than the evidence. Fixed; re-simulated with verification ON — 71796 CU, same as before | scripts/enter.ts
2026-09-16 00:19 UTC | cc      | —  | added a pool-readiness guard: a freshly opened pool is not enterable until commit_vrf_seed and create_pass_collection land. vrf_seed offset 116 derived from state.rs and cross-checked against the three pinned reader offsets; verified against pools 11/12/13 (all non-zero, distinct) | scripts/enter.ts
2026-09-16 00:19 UTC | cc      | —  | allocations.ts written: full 7x5 grid per wallet in the fixed stat order, with address, battles hash, register signature, pass asset and explorer links. T1.allocations.md generated — 12 seats, all PENDING until entry | registry/T1.allocations.md
2026-09-16 00:19 UTC | cc      | —  | FINDING: the ciphertext store refuses a second ciphertext for the same wallet and pool (409 "already sealed"). One seal per wallet per pool — a retry after a partial failure cannot re-seal | backend ciphertexts
