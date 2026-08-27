# Blotto Cup — Engineering Handover

*Updated 2026-08-27 (supersedes the phases-1–5 edition) · `main` with PRs
[#2](https://github.com/tomtblock/blotto/issues/2) and
[#3](https://github.com/tomtblock/blotto/issues/3) merged · Devnet program ID
`5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` · ≈390 tests across 13 suites,
all green in CI.*

The full stack for a 64-player, seven-battle, sealed-allocation
tournament on Solana — built to `docs/BUILD-ROADMAP_v1.0.md` phases 1–5, plus
the ratified **tiers-and-ties** step. This note is the entry point for the
incoming architect: what exists, what just changed, what is deliberately a
seam, and how to keep building without breaking the load-bearing rules.
Screen mockups for every surface are in `docs/design/flows/`.

---

## 1 · Since the last handover — the tiers-and-ties step (merged)

Three founder-ratified decisions (register rows D1 / D2 / D3-B, 2026-08-27,
`docs/BUILD-ROADMAP_v1.0.md` §1.2). The step's full report — file-by-file
signatures, per-tier prize tables, judgement calls — is
`docs/phase-reports/step-tiers-and-ties.md`. Read it before touching
settlement code.

- **D1 — seven concurrent tiers.** Entry prices 0.1 / 0.5 / 0.75 / 1 / 2.5 /
  5 / 7.5 SOL; at most one Open pool per tier (R14 per-tier), all seven able
  to run at once. Only the 0.1 tier is open at launch — tiers 1–6 stay behind
  the R6 switch (`set_open_tiers`), gated on audit + counsel, and the
  KYC-at-claim switch is expected ON before any tier whose 1st-place share
  (101.25 SOL at 7.5) exceeds the founder's still-unset threshold.
- **D2 — per-tier vault ceilings on gross intake**, checked at `open_pool`
  only: tier 0 at 6.4 SOL, every other tier at its own gross (entry × 64).
  Lowering a ceiling never touches an open pool — it blocks the NEXT open in
  that tier. `set_vault_ceiling` moves one tier per call.
- **D3-B — split-pot ties, committed as a payout list.** Players equal on
  (score, zones) share a competition rank (1, 2, 2, 4) and split the combined
  band prize of their occupied positions ≤ 16 evenly; the indivisible lamport
  remainder goes to the group's lowest seat; every tied member with a nonzero
  share is paid — the paid set can exceed 16 seats. `commit_results` commits
  the full `Vec<Payout { entry_index, amount }>`, validated on-chain
  (seat-sorted, duplicate-free, sum == pot exactly); `pay_prizes` settles by
  seat against it, with the Entry account as the on-chain seat→player
  binding. Merkle leaves unchanged in shape, ordered (rank asc, seat asc).

**Judgement calls you inherit.** Rank labels are NOT on-chain and NOT in
events — `Payout` is exactly (seat, amount) per the ratified spec, so the
indexer serves seat-keyed results/payouts, the results page shows seats +
prizes with a tie note, the share card shows the prize amount, and the
profile's best-rank stat is gone (`seats_paid` replaces `ranks_paid`). Rank +
tie labels live in the published bundle; the verify page recomputes them with
the same engine. Indexer migration `0004_seat_payouts.sql` re-keys the
derived tables and requires a `rederive()`. Pool/Entry/Config are boxed in
every Anchor context (the larger Pool overflowed the 4 KiB SBF stack). CI
runs clippy with `-D warnings` and a strict gitleaks rule that flags any bare
64-integer JSON array as a keypair shape — the scoring oracle emits
`leaf_order` comma-joined for exactly that reason.

## 2 · System map

**Three layers, one auditable money path.**

- **Players (browser)** — `app/`: Next.js 16, Privy auth (embedded wallet +
  social login, external wallet option), the pentagon battle flow,
  pool / results / profile / rules pages, the public verify page, the OG
  share card, the admin review page. The client entry pipeline
  (`app/src/entry/submit.ts`) seals the ciphertext BEFORE any money moves.
- **Operator (Node services)** — `backend/packet` (compliance checks → signed
  entry packet, or one generic rejection), `backend/sealing` (sealed boxes,
  pool-key custody, ciphertext store), `backend/reveal` (the resumable
  settlement crank: reveal → decrypt+verify → publish → score + assign
  split-pot prizes → commit list → pay by seat), `backend/detection` (five
  signals, R11 hard blocks), `backend/indexer` + `_shared` (event ledger →
  seat-keyed derived tables → read API), `backend/scoring` + `class-digest`
  (the one scoring engine, two runtimes: competition ranks + `assignPrizes`).
- **Solana (on-chain)** — `programs/blotto_cup` (Anchor 1.0.2, 21
  instructions, seven tiers + per-tier ceilings + payout-list settlement,
  every lamport exit through `vault.rs`), `crates/blotto-randomness` (class
  digest + bag draw), `tests/litesvm` (19 integration tests driving the
  compiled artifact).

**One pool, end to end:** `open_pool` (tier + ceiling gates) →
`commit_vrf_seed` + `create_pass_collection` → 64 × `register` (pay · packet
check · class draw · frozen pass mint) → sealed at 64 — *the tier slot frees
here, so the next pool of that tier can open immediately* — fees swept →
crank: `reveal_pool_secret` → decrypt + verify against on-chain hashes →
detection flags → score, assign split-pot prizes → publish reveal bundle →
`commit_results` (root + the validated payout list) → `pay_prizes` by seat,
batched → paid. Fork: deadline missed → `trigger_refund` → 100% back,
platform share included.

## 3 · Repository inventory

| Path | What it is | Proof | Status |
|---|---|---|---|
| `programs/blotto_cup/` | The on-chain program: 21 instructions (admin, lifecycle, settlement, escrow, refunds). `vault.rs` is the single transfer chokepoint (CI-enforced); `prize_math.rs` carries the split-group arithmetic; `entry_packet.rs` verifies the compliance packet from the instructions sysvar. | 24 unit + 10k-sequence fuzz | BUILT |
| `tests/litesvm/` | Byte-level client driving the compiled `.so` in an in-process SVM with the real mpl-core binary: full lifecycle, gates, packets, KYC switch, VRF, freeze, seven-tiers-concurrent, per-tier settles to the lamport, the 18-seat tie-case settle. | 19 tests | BUILT |
| `crates/blotto-randomness/` | Class digest (130-byte sha256) + bag-without-replacement draw; Python-generated vectors are the oracle. | 19 tests | BUILT |
| `backend/scoring/` | Allocations, 35-byte encoding, all-vs-all engine in integer half-points, shared competition ranks, split-pot prize assignment with conservation asserted, results Merkle tree. Node and browser bundle produce identical output. | 71 specs vs Python oracle | BUILT |
| `backend/class-digest/` | The TS class-draw replay for the verify page — its own package so the scoring path can never mention "class" (standing rule 5, structural). | 10 specs | BUILT |
| `backend/sealing/` | libsodium-compatible sealed boxes, the 127-byte payload, pool-key custody seam (export policy is a type), ciphertext store with no plaintext path. | 8 specs | BUILT |
| `backend/reveal/` | The settlement crank + `FakeChain` (offline mirror of the program's commit/pay checks) + `Web3Chain` (the real client, new Pool offsets + payout-list encoding). Idempotent, resumable — resume re-checks the committed list against a recomputation before paying. | 8 specs | BUILT |
| `backend/packet/` | Packet encoder (Python-oracle-pinned), signer seam, issuance checks, HTTP `/packet` + `/ciphertexts`. | 8 specs | BUILT |
| `backend/detection/` | Five signals, R11 pipeline, review decision log. | 6 specs | BUILT |
| `backend/indexer/` + `_shared/` | Webhook/backfill ingest → event ledger → projection (one op-list executed identically in memory and Postgres; seat-keyed since migration 0004) → read API + `/verify-record`. Decoders tested against REAL bytes the program emitted in LiteSVM. | 28 + 42 specs | BUILT |
| `app/` | Battle machine (pure reducers), pentagon radar, all pages, copy module (the D3-B tie rule is SUBSTANCE FIXED), verify logic (recomputes ranks, split amounts and the committed list), entry pipeline, share card. Carried seams: Privy auth, tx pipeline, reveal machine. | 142 vitest incl. 10k-run properties | BUILT |
| `tests/rehearsal/` | Entrant strategies + orchestrator; twenty 64-entrant pools settled through the real crank in CI; Playwright entry-flow spec for the devnet day. | 20-pool run in CI | BUILT |
| `docs/` | PID v0.5 · TECH-ARCH v0.2 · BUILD-ROADMAP v1.0 (canonical: R1–R21 + D1/D2/D3-B) · six phase/step reports · internal review · devnet runbook · `INDEX.md` is the map. | — | CURRENT |

## 4 · Load-bearing rules (CI-enforced — do not break)

1. **The vault has no withdraw instruction.** Exactly four exits —
   `pay_prizes`, `release_escrow`, `refund`, `forfeit_escrow` — all through
   `vault.rs`. CI greps enforce it. Any other lamport path is a product
   decision, not a refactor.
2. **Class is cosmetic, structurally.** Nothing in the scoring path may read
   or even mention class; the digest lives in its own package because CI
   fails the build otherwise.
3. **The pass can never thaw.** Two greps must return nothing forever:
   `frozen: false` and `UpdateCollectionPluginV1`. Proven live: transferring
   a minted pass fails `InvalidAuthority (0x9)` against the real mpl-core.
4. **No floats near money or scores.** Half-points are integers (win 2,
   draw 1); lamports are bigint/u128 end to end; the split-pot division is
   integer floor with an explicit remainder rule; overflow checks on in
   release.
5. **Sealing is a property, not a promise.** The ciphertext store's type has
   no plaintext accessor; custody's export policy refuses before seal. Never
   add a debug path that reads early.
6. **PID §8.7 vocabulary is CI-enforced** over code, comments and copy alike;
   every user-facing string routes through `app/src/copy/`.

## 5 · Gaps

Each is a marked seam (`PHASE-N-REVIEW` at the site) or a founder-gated item.
The two **NEXT** rows are the founder's stated product loop (2026-08-27):
every tier's pool restarts automatically, and a player short of the entry
price is prompted to top up.

### A — Code still to write (architect-unblocked, rough priority order)

| Missing piece | Where the seam is | Size |
|---|---|---|
| **Tier keeper (rolling pool opener). NEXT.** For every open tier with no Open pool (the slot frees at seal, or at refund), call `open_pool` + `commit_vrf_seed` + `create_pass_collection`. The program already enforces one-per-tier and the ceiling; `Web3Chain` lacks the `open_pool`/`init_config` builders. Recommended home: the crank process. | `backend/reveal` | S–M |
| **Pre-flight balance check + top-up prompt. NEXT.** Check the wallet's balance against entry + fees BEFORE the ninety-second session starts; on shortfall open the Privy funding flow (card on-ramp, R19). Today an underfunded wallet only fails at broadcast — the classifier maps it to `insufficient-sol`, but the copy is TODO and there is no funding path. | `app/src/app/play/play-client.tsx` · `app/src/tx/errors.ts` | S–M |
| **Crank daemon.** `crankPool()` is a library; the long-running process that watches `PoolSealed` and invokes it (idempotent, a simple poll works) does not exist. Natural twin of the tier keeper. | `backend/reveal/src/crank.ts` | S |
| **Review HTTP service.** `decide()` and the decision log exist; the small server the admin page POSTs to — plus Squads-member login — does not. | `backend/detection/src/review.ts` · `app/src/app/admin/review/` | M |
| **Client transaction wiring.** `sendRegister` / `requestPacket` in the app are honest stubs; connect the carried tx pipeline (`app/src/tx`) to the register instruction + entry service; the carried class-reveal machine takes over on confirmation. | `app/src/app/play/play-client.tsx` | M |
| **Privy device fingerprint** into the sealed payload (currently zeroed; detection deliberately ignores zeros). | `play-client.tsx` `deviceHash()` | S |
| **Turnkey adapters** for custody (`PoolKeyCustody`) and the packet signer (`PacketSigner`); local implementations enforce the same semantics today. | `backend/sealing/src/custody.ts` · `backend/packet/src/packet.ts` | M |
| **Irys publisher.** The bundle format is final (`payouts` replaced `winners`); the seam is one method. | `backend/reveal/src/publisher.ts` | S |
| **Geo vendor adapter** behind `GeoLookup` once the vendor of record is contracted (R2). | `backend/packet/src/service.ts` | S |
| **Verify-page fetch layer.** The logic + UI take pasted JSON; auto-fetch from `/verify-record` + the Irys URI is small wiring. | `app/src/app/verify/verify-client.tsx` | S |
| **Program-CI lane.** ci-fast runs fmt, clippy `-D warnings`, workspace tests, gitleaks and both standing gates; a cached-toolchain lane for `anchor build` + LiteSVM is still missing. | `.github/workflows/` | S |
| **Indexer provider config** (Helius or equivalent webhook; the backfill walker is built). First devnet deploy must also run migration 0004 + `rederive()`. | `backend/indexer/src/webhook.ts` | S |
| **Per-tier lobby layout.** The pools page lists all open pools across tiers correctly; grouping by tier with entry price and prize table per card is Phase 6 polish. | `app/src/app/pools/page.tsx` | S |

### B — Blocked on founder provisioning (the devnet day — runbook: `docs/devnet-rehearsal.md`)

| Item | Then what happens |
|---|---|
| Devnet Squads vault + Turnkey sandbox sub-org (R21) | Deploy, move upgrade authority, `init_config` with the seven per-tier ceilings; Turnkey adapters written; the live export-refusal test runs. |
| Funded devnet fee payer + Irys wallet | Twenty real pools per the runbook; timings recorded; Playwright drives the real UI. |
| App hosting (Frankfurt/Dublin — never a US region, TECH-ARCH §11) | Gate 3: a stranger completes a session unaided. |
| Geo vendor contract (R2) · counsel engagement (R1) · all `TODO_COPY` strings | Phase 6 — founder + counsel own the words; the rules skeleton and copy module are ready to fill. |

### C — Open decisions on the founder's desk

The KYC-at-claim threshold (unset; expected ON before high tiers open, per
the D1 register flag). A PID v0.6 — the PID's two-tier tables (§2/§6) are
superseded by the D1 register row until then. Whether the app should regain
rank badges by indexing the published bundle (the deliberate D3-B trade,
documented in the step report). `docs/internal-review.md` items IR-2
(Switchboard cluster-ID pinning at deploy), IR-3 (PDA donations strand
harmlessly), IR-4 (escrow depends on settlement-signer liveness; the 24h
review commitment is the mitigation). Founder ratifications of the Phase 1/2
judgement calls are recorded in `docs/phase-reports/phase-1-program.md`.

## 6 · For the incoming architect — reading order and first hour

1. `docs/INDEX.md` — the source-of-truth map; then `docs/BUILD-ROADMAP_v1.0.md`
   — the ratified decision register R1–R21 + D1/D2/D3-B (wins over TECH-ARCH
   where they disagree).
2. `CLAUDE.md` — the hard rules and the tradeoff order (CI-enforced).
3. `docs/phase-reports/step-tiers-and-ties.md` — the newest report: the tie
   definition verbatim, the per-tier tables, and the judgement calls that
   shape today's settlement path. Then the five phase reports.
4. `docs/internal-review.md` — the security posture and accepted risks.
5. Code, in dependency order: `programs/blotto_cup/src/state.rs` →
   `instructions/` → `backend/scoring/src/engine.ts` (ranks +
   `assignPrizes`) → `backend/reveal/src/crank.ts` →
   `app/src/battle/machine.ts`.

Run everything:

```bash
# Rust: program unit tests + 10k-sequence vault fuzz
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings  # CI is strict; run it strict locally

# The compiled program, end to end (the program keypair lives OUTSIDE the
# repo — copy it to target/deploy/ before building; never commit it)
anchor build
cargo test --manifest-path tests/litesvm/Cargo.toml

# TypeScript: each backend package, the offline 20-pool rehearsal, the app
for p in _shared scoring class-digest sealing reveal indexer packet detection; do
  (cd backend/$p && npm ci && npm test); done
(cd tests/rehearsal && npm ci && npm test)
(cd app && npm ci && npm test && npm run build)

# The standing gates that run in CI on every push
bash scripts/check-language.sh
bash scripts/check-standing-rules.sh
```

Regenerating oracles: `python3 fixtures/gen_vectors.py --write` in
`backend/scoring`, `backend/packet`, `crates/blotto-randomness`; the
real-bytes event fixture via `DUMP_EVENT_FIXTURE=1 cargo test --test
dump_events` in `tests/litesvm`. Note the gitleaks rule: any bare JSON array
of 64 integers reads as a Solana keypair and fails CI — keep generated
fixtures out of that shape rather than allowlisting.

## 7 · Wallets, on-ramp and Irys — who holds which key

| Wallet | Held by | Purpose |
|---|---|---|
| Privy embedded wallet (social login) or Phantom (external) | Each player | Pays the entry, receives prizes. Privy is the on-ramp path (card → SOL into the embedded wallet, R19) — and the funding flow the top-up prompt will open; Phantom is the power-user option. |
| Squads multisig | Founder (+ cosigners) | Program upgrade authority and admin instructions (tier switches, ceilings, KYC threshold). Never touches player funds. |
| Turnkey signers (entry + settlement) | Operator, custodied | Sign entry packets and settlement transactions. Sign-only, no export, rotatable on-chain. Under D3-B the settlement signer chooses only batching — the payout list itself is validated on-chain. |
| Irys upload wallet | Operator | Pays the (tiny) permanent-storage fee to publish each pool's reveal bundle — the file the verify page recomputes ranks, tie labels and amounts from. Players never touch it; it is infrastructure, like paying for hosting. |
