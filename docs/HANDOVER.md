# Blotto Cup — Engineering Handover

*2026-08-27 · Branch `claude/blotto-cup-phase-0-extraction-n4c204` · PR
[tomtblock/blotto#2](https://github.com/tomtblock/blotto/issues/2) · Devnet
program ID `4pspHqtbdgqKTvSxvKFT2ycEU28u3EWdxjmj3xsTHD3Y` · ~360 tests across
11 suites, all green in CI.*

The full stack for a 64-player, seven-battle, sealed-allocation skill
tournament on Solana — built to `docs/BUILD-ROADMAP_v1.0.md`, phases 1–5.
This note is the entry point for the incoming architect: what exists, what is
deliberately a seam, what is missing, and how to keep building without
breaking the load-bearing rules. Screen mockups for every surface are in
`docs/design/flows/`.

---

## 1 · System map

**Three layers, one auditable money path.**

- **Players (browser)** — `app/`: Next.js 16, Privy auth (embedded wallet +
  social login, external wallet option), the pentagon battle flow,
  pool / results / profile / rules pages, the public verify page, the OG
  share card, the admin review page. The client entry pipeline
  (`app/src/entry/submit.ts`) seals the ciphertext BEFORE any money moves.
- **Operator (Node services)** — `backend/packet` (compliance checks → signed
  entry packet, or one generic rejection), `backend/sealing` (sealed boxes,
  pool-key custody, ciphertext store), `backend/reveal` (the resumable
  settlement crank), `backend/detection` (five signals, R11 hard blocks),
  `backend/indexer` + `_shared` (event ledger → derived tables → read API),
  `backend/scoring` + `class-digest` (the one scoring engine, two runtimes).
- **Solana (on-chain)** — `programs/blotto_cup` (Anchor 1.0.2, the whole pool
  lifecycle, every lamport exit through `vault.rs`),
  `crates/blotto-randomness` (class digest + bag draw), `tests/litesvm`
  (15 integration tests driving the compiled artifact).

**One pool, end to end:** `open_pool` → `commit_vrf_seed` +
`create_pass_collection` → 64 × `register` (pay · packet check · class draw ·
frozen pass mint) → sealed, fees swept → crank: `reveal_pool_secret` →
decrypt + verify against on-chain hashes → detection flags → publish reveal
bundle → `commit_results` (root + 16 winners) → `pay_prizes` in four batches
→ paid. Fork: deadline missed → `trigger_refund` → 100% back, platform share
included.

## 2 · Repository inventory

| Path | What it is | Proof | Status |
|---|---|---|---|
| `programs/blotto_cup/` | The on-chain program: 20 instructions (admin, lifecycle, settlement, escrow, refunds). `vault.rs` is the single transfer chokepoint (CI-enforced). `entry_packet.rs` verifies the compliance packet from the instructions sysvar. | 23 unit + 10k-sequence fuzz | BUILT |
| `tests/litesvm/` | Byte-level client driving the compiled `.so` in an in-process SVM with the real mpl-core binary: full lifecycle, gates, packets, KYC switch, VRF, the pass-freeze proof (`0x9`). | 15 tests | BUILT |
| `crates/blotto-randomness/` | Class digest (130-byte sha256) + bag-without-replacement draw; Python-generated vectors are the oracle. | 19 tests | BUILT |
| `backend/scoring/` | Allocations, 35-byte encoding, all-vs-all engine in integer half-points, ranking + tie-breaks, prizes in exact 1024ths, results Merkle tree. Node and browser bundle produce identical output. | 50 specs vs Python oracle | BUILT |
| `backend/class-digest/` | The TS class-draw replay for the verify page — its own package so the scoring path can never mention "class" (standing rule 5, structural). | 10 specs | BUILT |
| `backend/sealing/` | libsodium-compatible sealed boxes, the 127-byte payload, pool-key custody seam (export policy is a type), ciphertext store with no plaintext path. | 8 specs | BUILT |
| `backend/reveal/` | The settlement crank + `FakeChain` (offline mirror of the program) + `Web3Chain` (the real client). Idempotent, resumable, detection-wired. | 8 specs | BUILT |
| `backend/packet/` | Packet encoder (Python-oracle-pinned), signer seam, issuance checks, HTTP `/packet` + `/ciphertexts`. | 8 specs | BUILT |
| `backend/detection/` | Five signals, R11 pipeline, review decision log. | 6 specs | BUILT |
| `backend/indexer/` + `_shared/` | Webhook/backfill ingest → event ledger → projection (one op-list executed identically in memory and Postgres) → read API + `/verify-record`. Decoders tested against REAL bytes the program emitted in LiteSVM. | 28 + 42 specs | BUILT |
| `app/` | Battle machine (pure reducers), pentagon radar, all pages, copy module, verify logic, entry pipeline, share card. Carried seams: Privy auth, tx pipeline, reveal machine (114 specs). | 146 vitest incl. 10k-run properties | BUILT |
| `tests/rehearsal/` | Entrant strategies + orchestrator; twenty 64-entrant pools settled through the real crank in CI; Playwright entry-flow spec for the devnet day. | 20-pool run in CI | BUILT |
| `docs/` | PID v0.5 · TECH-ARCH v0.2 · BUILD-ROADMAP v1.0 (canonical for phases + decisions) · five phase reports · internal review · devnet runbook · `INDEX.md` is the map. | — | CURRENT |

## 3 · Load-bearing rules (CI-enforced — do not break)

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
   draw 1); lamports are bigint/u128 end to end; overflow checks on in
   release.
5. **Sealing is a property, not a promise.** The ciphertext store's type has
   no plaintext accessor; custody's export policy refuses before seal. Never
   add a debug path that reads early.
6. **PID §8.7 vocabulary is CI-enforced** over code, comments and copy alike;
   every user-facing string routes through `app/src/copy/`.

## 4 · Gaps

Each is a marked seam (`PHASE-N-REVIEW` at the site) or a founder-gated item.

### A — Code still to write (architect-unblocked, rough priority order)

| Missing piece | Where the seam is | Size |
|---|---|---|
| **Crank daemon.** `crankPool()` is a library; the long-running process that watches `PoolSealed` and invokes it (idempotent, a simple poll works) does not exist. | `backend/reveal/src/crank.ts` | S |
| **Rolling pool opener (R14).** The automation that calls `open_pool` + `commit_vrf_seed` + `create_pass_collection` when a pool fills. `Web3Chain` also lacks `open_pool`/`init_config` builders. | `backend/reveal/` | S–M |
| **Review HTTP service.** `decide()` and the decision log exist; the small server the admin page POSTs to — plus Squads-member login — does not. | `backend/detection/src/review.ts` · `app/src/app/admin/review/` | M |
| **Client transaction wiring.** `sendRegister` / `requestPacket` in the app are honest stubs; connect the carried tx pipeline (`app/src/tx`) to the register instruction + entry service; the carried class-reveal machine takes over on confirmation. | `app/src/app/play/play-client.tsx` | M |
| **Privy device fingerprint** into the sealed payload (currently zeroed; detection deliberately ignores zeros). | `play-client.tsx` `deviceHash()` | S |
| **Turnkey adapters** for custody (`PoolKeyCustody`) and the packet signer (`PacketSigner`); local implementations enforce the same semantics today. | `backend/sealing/src/custody.ts` · `backend/packet/src/packet.ts` | M |
| **Irys publisher.** The bundle format is final; the seam is one method. | `backend/reveal/src/publisher.ts` | S |
| **Geo vendor adapter** behind `GeoLookup` once the vendor of record is contracted (R2). | `backend/packet/src/service.ts` | S |
| **Verify-page fetch layer.** The logic + UI take pasted JSON; auto-fetch from `/verify-record` + the Irys URI is small wiring. | `app/src/app/verify/verify-client.tsx` | S |
| **Program-CI lane.** LiteSVM suite runs locally (needs the SBF artifact); a cached-toolchain CI job for `anchor build` + LiteSVM. | `.github/workflows/` | S |
| **Indexer provider config** (Helius or equivalent webhook; the backfill walker is built). | `backend/indexer/src/webhook.ts` | S |

### B — Blocked on founder provisioning (the devnet day — runbook: `docs/devnet-rehearsal.md`)

| Item | Then what happens |
|---|---|
| Devnet Squads vault + Turnkey sandbox sub-org (R21) | Deploy, move upgrade authority, `init_config`; Turnkey adapters written; the live export-refusal test runs. |
| Funded devnet fee payer + Irys wallet | Twenty real pools per the runbook; timings recorded; Playwright drives the real UI. |
| App hosting (Frankfurt/Dublin — never a US region, TECH-ARCH §11) | Gate 3: a stranger completes a session unaided. |
| Geo vendor contract (R2) · counsel engagement (R1) · all `TODO_COPY` strings | Phase 6 — founder + counsel own the words; the rules skeleton and copy module are ready to fill. |

### C — Open decisions on the founder's desk

`docs/internal-review.md` items IR-2 (Switchboard cluster-ID pinning at
deploy), IR-3 (PDA donations strand harmlessly), IR-4 (escrow depends on
settlement-signer liveness; the 24h review commitment is the mitigation).
Founder ratifications of the Phase 1/2 judgement calls (forfeit destination,
fees-PDA custody, batched payout) are recorded in
`docs/phase-reports/phase-1-program.md`.

## 5 · For the incoming architect — reading order and first hour

1. `docs/INDEX.md` — the source-of-truth map; then `docs/BUILD-ROADMAP_v1.0.md`
   — the ratified decision register R1–R21 (wins over TECH-ARCH where they
   disagree).
2. `CLAUDE.md` — the hard rules and the tradeoff order (CI-enforced).
3. The five phase reports in `docs/phase-reports/` — every judgement call,
   deviation and deferred item.
4. `docs/internal-review.md` — the security posture and accepted risks.
5. Code, in dependency order: `programs/blotto_cup/src/state.rs` →
   `instructions/` → `backend/scoring/src/engine.ts` →
   `backend/reveal/src/crank.ts` → `app/src/battle/machine.ts`.

Run everything:

```bash
# Rust: program unit tests + 10k-sequence vault fuzz
cargo test --workspace

# The compiled program, end to end
anchor build
cargo test --manifest-path tests/litesvm/Cargo.toml

# TypeScript: each backend package, the offline 20-pool rehearsal, the app
for p in _shared scoring class-digest sealing reveal indexer packet detection; do
  (cd backend/$p && npm ci && npm test); done
(cd tests/rehearsal && npm ci && npm test)
(cd app && npm ci && npm test && npm run build)

# The two standing gates that run in CI on every push
bash scripts/check-language.sh
bash scripts/check-standing-rules.sh
```

Regenerating oracles: `python3 fixtures/gen_vectors.py --write` in
`backend/scoring`, `backend/packet`, `crates/blotto-randomness`; the
real-bytes event fixture via `DUMP_EVENT_FIXTURE=1 cargo test --test
dump_events` in `tests/litesvm`.

## 6 · Wallets, on-ramp and Irys — who holds which key

| Wallet | Held by | Purpose |
|---|---|---|
| Privy embedded wallet (social login) or Phantom (external) | Each player | Pays the entry, receives prizes. Privy is the on-ramp path (card → SOL into the embedded wallet, R19); Phantom is the power-user option. |
| Squads multisig | Founder (+ cosigners) | Program upgrade authority and admin instructions. Never touches player funds. |
| Turnkey signers (entry + settlement) | Operator, custodied | Sign entry packets and settlement transactions. Sign-only, no export, rotatable on-chain. |
| Irys upload wallet | Operator | Pays the (tiny) permanent-storage fee to publish each pool's reveal bundle — the file the verify page recomputes from. Players never touch it; it is infrastructure, like paying for hosting. |
