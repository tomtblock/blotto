# Phase 2 report — scoring, sealing, crank, indexer

**Status: complete offline; two seams await founder-owned credentials** (the
Turnkey custody live test and the Irys publisher — both wired for the Phase 5
rehearsal, both PHASE-2-REVIEW-marked at their sites). Everything else in
roadmap Phase 2 is implemented and tested.

## What exists now

| Package | Contents | Specs |
|---|---|---|
| `backend/scoring` | Allocations + 35-byte encoding + `sha256(bytes‖salt)`; the all-vs-all engine in integer half-points; ranking (score desc, zones desc, entry index asc); prizes as exact 1024ths (bigint); the results Merkle tree; Python oracle (`fixtures/gen_vectors.py`) | 50 |
| `backend/class-digest` | The class digest + bag draw in TS, pinned to the SAME Python vectors as `crates/blotto-randomness` | 10 |
| `backend/sealing` | libsodium-compatible sealed boxes; the canonical 127-byte payload; the custody seam (export policy as a type); the ciphertext store (no plaintext path) | 8 |
| `backend/reveal` | The settlement crank: reveal → decrypt+verify → publish bundle → score → tree → commit → batched pay; `FakeChain` + `Web3Chain`; the published all-losses rule | 7 |
| `backend/indexer` + `_shared` | Decoders for all 13 events; derived tables `pools/entries/results/payouts/profiles` (R15) as one op-list executed by memory and Postgres alike; migrations 0002/0003; re-derive | 25 + 42 |

## Judgement calls

1. **The class digest lives in its own package.** Standing rule 5 greps the
   scoring path for `class` and failed the build when the digest sat inside
   `@blotto/scoring` — the rule is right: `@blotto/class-digest` makes
   "class is read by nothing in the scoring path" structural.
2. **Half-points, never 0.5.** The engine scores win = 2, draw = 1 in
   integers; the no-floats rule is applied off-chain exactly as on-chain.
   Display divides by two at the edge.
3. **Tie-break "entered_at asc" is implemented as entry index asc** — the
   same order made strictly monotonic (two entries can share a timestamp,
   never a seat).
4. **A 5-0 sweep is impossible** between equal-sum allocations (winning all
   five stats needs a strictly larger sum); 4-1 is the maximum. Noted in the
   oracle so nobody writes a vector expecting one.
5. **Prize bands as 1024ths, not bps** — carried from the Phase 1 derivation
   (roadmap 2.1 says "prize bands as bps"; the bps table is the one that
   misallocates). Ranks 17–64 appear in the tree with amount 0.
6. **The Merkle scheme is defined off-chain and is canonical here**: leaf
   `sha256(0x00 ‖ player ‖ rank u8 ‖ amount u64 LE)`, node
   `sha256(0x01 ‖ l ‖ r)`, odd nodes promoted (never duplicated —
   CVE-2012-2459-shaped ambiguity), leaves in rank order. Since R10 removed
   on-chain proof verification, the tree's consumer is the verify page.
7. **The all-losses rule made precise** (TECH-ARCH §5 published failure
   mode): a lost/undecryptable/mismatched entry loses every battle to every
   present player (full win, zero zones, uniform shift — relative ranking of
   present players provably unchanged); missing-vs-missing draw; the bundle
   lists them as the auditable fee-refund obligation.
8. **Custody export policy is a type.** `LocalCustody` enforces refusal
   in-process so the sealing property is tested today; the roadmap 2.3 gate
   "refused by Turnkey policy (assert the API error)" needs the founder's
   Turnkey sandbox sub-org (R21) and runs in the Phase 5 rehearsal.
9. **Irys publisher deferred to Phase 5** (funded upload wallet needed); the
   seam and the bundle format are final now — the format is part of the
   player-recompute contract.
10. **Real bytes over self-encoding.** The decoder suite replays transaction
    logs captured from the compiled program executing in LiteSVM
    (`tests/litesvm/tests/dump_events.rs` regenerates the fixture), so Rust
    emit and TS decode check each other. The projection then derives the
    expected rows and `rederive()` rebuilds an identical snapshot.
11. **Sealed-box construction is libsodium's**, over tweetnacl + blake2b —
    any standard sodium binding can open the published reveal; players are
    not locked into our code to verify.

## Deferred to Phase 5 (rehearsal)

- Turnkey custody implementation + live policy-refusal test (needs sub-org).
- Irys publisher implementation (needs funded wallet).
- `Web3Chain` against devnet (encodings already pinned by the LiteSVM suite).
- Gate 2's end-to-end devnet cycle (64 scripted test wallets → paid in 2 min).
