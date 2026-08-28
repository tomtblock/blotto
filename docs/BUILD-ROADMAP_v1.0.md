# Blotto Cup — Build Roadmap

**Version:** 1.0 · **Date:** 2026-08-26 · **Status:** Ratified by founder; for build in Claude Code
**Owns:** phase order, step scope, gates, and the decision register below. Does not restate constants or mechanics — those live in `PID_Blotto-Cup_v0.5.md` and `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md`. Where this document and TECH-ARCH v0.2 disagree, **this document wins** (it is newer and reflects ratified decisions); the conflicts are listed in §1.3 so v0.3 of TECH-ARCH can absorb them.
**Companions:** `PID_Blotto-Cup_v0.5.md` · `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` · `REPO-EXTRACTION-BRIEF_v1.1.md` · `REPO-TRANSITION-PLAYBOOK.md` · `CLAUDE-CODE-PROMPT_blotto-cup-phase-0-extraction.md`

---

## 0. How to read this

Eight phases, each a set of numbered steps. Every step is one Claude Code session and one PR. Each phase ends with a **gate**: a short list of things that must be true before the next phase starts. Gates are not advisory. The founder is the only reviewer, so gates are written as things the founder can check by running a command or opening a page, not by reading code.

Team: solo founder + Claude Code. No other engineers. That shapes everything below — fewer moving parts, one language, aggressive use of the old repo's tested plumbing, and caps that limit the blast radius of any mistake until an audit exists.

---

## 1. Decision register

Ratified 2026-08-26 through a structured founder Q&A. Each row: the decision, the PID/TECH-ARCH item it settles, and any flag raised at the time. **Flags are recorded, not resolved.** A flagged decision stands unless the founder revisits it.

### 1.1 Compliance and market

| # | Decision | Settles | Flag |
|---|---|---|---|
| R1 | **Launch on own analysis in a clearly-open market; counsel opinions pursued in parallel, not as a gate.** | PID C1 | ⚠ Conflicts with PID C1 ("blocks launch") and with the stated goal of full compliance. Counsel remains a critical-path item in Phase 6 and a **hard gate for the 0.5 SOL tier and above** (see R6). |
| R2 | **Launch territory: founder-owned; default allowlist UK + Ireland + Germany** until the founder names otherwise. Everything else geoblocked. | PID §9, C2, C7 | Must be named before Phase 4 Step 2 (the packet service needs the list). |
| R3 | **Identity: geo vendor + age self-attestation at entry. No KYC at launch.** | PID C3, C8, D5 | ⚠ Removes the only lever when detection flags a wallet; incompatible with large prizes (see R6). KYC-at-claim is **built as a config switch, off by default** (Phase 4 Step 5). |
| R4 | **Rules page, Terms, Privacy written by founder now; counsel red-lines in parallel.** | PID C4, C10, C12 | Rules must state: decisions final, fill deadline and refund, sealing, identical-field scoring, allocation rules, 15s timer and lock-current behaviour (R9), detection criteria, forbidden-word audit. |
| R5 | **No formal audit before mainnet. Devnet with synthetic entrants + internal review; independent audit after 10 settled mainnet pools.** | TECH-ARCH §12 Phase 6 | ⚠ Solo founder, unaudited vault. Mitigated by R6 caps and the vault-invariant test suite (Phase 1 Step 6). |

### 1.2 Product

| # | Decision | Settles | Flag |
|---|---|---|---|
| R6 | **Tiers configured: 0.1 / 0.5 / 1 / 5 SOL. Open at launch: 0.1 only.** 0.5 opens after audit (R5) **and** at least one counsel opinion (R1). 1 and 5 open only by explicit founder decision after that. `Config` carries a per-pool vault ceiling. | PID §2 | Four rolling pools split a small launch audience four ways; opening them gradually is a product decision as much as a risk one. |
| R7 | **Pools: 72h fill deadline; full 64 or automatic full refund. No partial-fill pools in v1.** | PID D1, §2 | Simplifies scoring, prizes, and rules. Partial-fill is a v2 candidate once fill rates are known. |
| R8 | **Entry flow: pay → class reveal → seven battles → review → one transaction.** | PID §1 | As written. |
| R9 | **Per-screen timer: 15 seconds, visible. On timeout, the battle locks in whatever the pentagon currently shows** (20-20-20-20-20 if untouched). | PID D3 | ⚠ Founder's first instinct was to randomise the allocation on timeout. **Rejected:** that inserts chance into the scoring mechanism and breaks PID §8.3, the load-bearing legal claim. Lock-current is deterministic, is the player's own inaction, and is disclosed in the rules. Recorded so nobody reintroduces it. |
| R10 | **Prize delivery: automatic push payout by the settlement crank immediately after results commit. No claim step. Flagged entries' shares held in escrow until review.** | PID §7, D4; TECH-ARCH §3.2 `claim`, `sweep_unclaimed` | Removes claim window, `claim`, `sweep_unclaimed`, and the unclaimed-prize problem entirely. Merkle root of the full 64-place ranking is still committed for verifiability; the 16 `(player, amount)` pairs go on-chain in the payout transaction. |
| R11 | **Detection at launch: shadow mode on all five signals; hard block (escrow) only on exact-duplicate battle sets and same-device multi-entry; review page staffed by the founder. Full escrow tier behind an admin switch.** | PID C9; TECH-ARCH §9 | Founder asked for "whatever keeps prize distribution compliant." This is the minimum that satisfies C9's "detection + review before first settlement." The word **"promotional"** was used by the founder and is **forbidden** in rules and marketing: it denotes free-entry sweepstakes and puts the product in the wrong regulatory box. |
| R12 | **Pass art: typographic/badge passes at launch, unique per pass (class + number + per-pass seed baked into metadata). Illustrated art is a post-launch URI upgrade.** | PID D2, C11 | Because the seed is on the pass from day one, the art upgrade later is a metadata update, not a program change. No AI vendor at launch → C11 deferred. |
| R13 | **Public verify page at launch: pool id → events → decrypt with revealed secret → recompute in-browser → compare to root.** | TECH-ARCH §10 | Non-negotiable proof of "no chance in the mechanism." |
| R14 | **Pool cadence: rolling — next pool opens the instant one fills; max one open pool per tier.** | PID §2 | ⚠ Superseded by D-A1 (revised): pools per tier are SEQUENTIAL — the next opens only after the previous is Paid or Refunded, not at seal. |
| R15 | **Persistent wallet profile: lifetime record of pools, ranks, win rate, class collection. No XP, no tiers, no referral system.** | new | Read-only projection from the event ledger. Nothing on it can affect a pool. |
| R16 | **Growth loop: shareable result card (rank, class, score) as image + link. No on-chain change, no reward.** | new | Any reward attached to sharing is a PID §8.4 question and is out of scope. |
| R17 | **Launch success metric: one 0.5 SOL pool fills in under 24 hours organically.** | new | Note R6: the 0.5 tier cannot open until audit + one opinion, so this metric is measured in Phase 8, not Phase 7. |
| D1 (ratified 2026-08-27) | **Seven concurrent tiers: 0.1 / 0.5 / 0.75 / 1 / 2.5 / 5 / 7.5 SOL, one open pool per tier (R14 per-tier), only the 0.1 tier open at launch.** | step tiers-and-ties | ⚠ Tiers 2–6 remain gated by R6 (audit + counsel opinion before 0.5 SOL and above); the KYC-at-claim switch (R3) is expected ON before any tier whose 1st-place share exceeds the founder's threshold — at 7.5 SOL, 1st place is 101.25 SOL. |
| D2 (ratified 2026-08-27) | **Per-tier vault ceilings on GROSS intake, checked at `open_pool` only: tier 0 at 6.4 SOL, every other tier at its own gross (entry × 64).** | step tiers-and-ties | Lowering a ceiling never affects an already-open pool — it blocks the NEXT open in that tier. One tier per `set_vault_ceiling` call (Squads proposal readability). |
| D3-B (ratified 2026-08-27) | **Split-pot ties: players equal on (score, zones) share a competition rank (1, 2, 2, 4) and split the combined band prize of their occupied positions ≤ 16 evenly; the indivisible lamport remainder goes to the group's lowest seat; every tied member with a nonzero share is paid (the paid set can exceed 16).** | step tiers-and-ties | Supersedes the Part 3 documented order (seat as final tie-break). Entry index never decides who is paid or who ranks above whom — only where the remainder lands and the published leaf order (rank asc, seat asc). |
| D-A1 (REVISED 2026-08-27, master prompt v2 — supersedes the same-day original) | **Two-wallet pre-funded treasury.** A platform treasury PDA receives 100% of pass-sale revenue at `register`; each pool's prize vault is funded with the tier's FIXED pot from the treasury at `open_pool`, BEFORE any pass sells. Entries never touch a prize vault. Pots are constants per tier (5.12 / 25.6 / 38.4 / 51.2 / 128 / 256 / 384 SOL — initially 80% of price × 64), founder-changeable via `set_tier_economics`, never touching an open pool. Pools per tier are SEQUENTIAL: the next opens only after the previous is Paid or Refunded. Treasury policy `{reserve_pots (default 1), min_platform_lamports}`: a tier opens only if, after funding its pot, the treasury still holds the minimum plus one further pot of every other enabled idle tier. `withdraw_platform` (Squads-only) is the ONE treasury exit, floor-guarded (minimum + idle-tier reserve + refundable entries). The 80/20 sweep and all entry×64 pot derivation are REMOVED. | master build prompt v2 2026-08-27 | Supersedes R14's seal-time slot handover (the tier slot clears only at Paid/Closed). The prize vault's four exits stand; the treasury is a separate account with its own single gated exit, not a fifth vault exit. Delivered by step treasury (`docs/phase-reports/step-treasury.md`). |
| D-A2 (ratified 2026-08-27; AMENDED by master prompt v2 same day) | **Build the skill-evidence harness**: strategy ladder, ≥200 offline pools through the real crank, published per-class outcome statistics, nightly CI reproduction. **v2 amendments**: within-class uniqueness of allocation sets (jitter model documented; uniform exempt as the structural baseline); three 200-pool homogeneous-field runs (all 64 seats one class) reported as outcomes among equally-skilled entrants against the 1/64 baseline; report reordered (random-vs-optimised leads, uniform to an appendix with the loses-3–2 explanation) with a full methodology section; indexer `player_history` derived table + read-API endpoints (first-time vs repeat paid rate, paid persistence across consecutive entries, entries-per-wallet distribution — wallet addresses only, no other PII). | master build prompt v2 2026-08-27 | Delivered by steps skill-evidence + skill-evidence-v2 (`docs/skill-evidence/`, `tests/rehearsal/strategies/README.md`, migration `0008_player_history.sql`). |
| D-B3 (ratified 2026-08-27) | **Geo-blocking behind `GeoLookup`, fail-closed**, driven by `config/territories.json`; enforced at the packet service AND the client pre-flight. | master build prompt 2026-08-27 | Vendor HTTP adapter stays a seam with a local stub until the vendor of record is contracted (R2). |
| D-B4 (ratified 2026-08-27) | **Age/identity is a self-attestation clickwrap ("I am over 18") only.** No KYC provider, no age-verification vendor. The program's KYC-at-claim switch stays built, OFF, untouched. | master build prompt 2026-08-27 | Attestation is versioned, persisted server-side, and the accepted `terms_version` travels in the entry packet. |
| D-B6 (ratified 2026-08-27) | **Publish participation, entry, payout and randomness rules on a separate tab, in plain language**, config-driven from the same tier constants the program uses. | master build prompt 2026-08-27 | No hand-typed numbers on the rules tab; territories render from `config/territories.json`. |
| D-B7 (ratified 2026-08-27) | **Vocabulary reviewed and amended per the merged prohibited lexicon**; the language gate extends beyond PID §8.7 to the full list in the master prompt. | master build prompt 2026-08-27 | Delivered by step vocabulary; mechanics-describing phrasing replaces category assertions everywhere. |
| D-C (ratified 2026-08-27) | **Build all of Phase C**: daemon (crank + tier keeper), client tx wiring + balance pre-flight, review HTTP service, Turnkey/Irys adapters + verify auto-fetch + device fingerprint, CI/deploy lane, custody disclosure page. | master build prompt 2026-08-27 | One PR per item, in the master prompt's order; top-up prompt ships behind a feature flag defaulting OFF. |
| D-B3-2 (founder instruction 2026-08-28) | **Territory posture flipped to a block-list: available everywhere EXCEPT Belgium and Australia** (`config/territories.json` posture `block-list`, blocked `BE`, `AU`). Supersedes R2's default allowlist (UK/IE/DE). Fail-closed on any unresolved or ambiguous location is unchanged and posture-independent. | founder chat 2026-08-28 | ⚠ Counsel has not reviewed the open-to-everywhere posture; R1's counsel engagement should confirm it before mainnet. The schedule stays founder-owned — one config file edit reverses it. |

### 1.3 Engineering

| # | Decision | Settles | Consequence |
|---|---|---|---|
| R18 | **Surface: desktop web first; mobile after the battle UI is proven.** | TECH-ARCH §10 | The old repo was mobile-first. The pentagon radar is designed around a thumb; on desktop it is a mouse drag. Design it for pointer events generically and verify on both, but the launch layout is desktop. |
| R19 | **Auth: Privy embedded wallet + social login, external wallet as an option.** | TECH-ARCH §10 | Carried from the old repo. Privy also provides the device fingerprint the detection layer uses for same-device correlation (R11). |
| R20 | **Backend: TypeScript/Node throughout.** Scoring engine is written in TypeScript and runs identically in the crank and in the browser (verify page). **Python-generated known vectors are the independent oracle.** No Rust scoring crate, no WASM. | TECH-ARCH §6 ("shared Rust crate, WASM build") | `crates/blotto-scoring/` is dropped. `crates/blotto-randomness/` stays Rust because the program needs it; the same digest is reimplemented in TS for the verify page and pinned to the same Python vectors. |
| R21 | **Key custody: Squads multisig + Turnkey from devnet onward, exactly per the transition playbook.** | Playbook §4 | Devnet uses a devnet Squads vault and a Turnkey sub-org in sandbox; nothing is "local keys for now." |

### 1.4 What this changes in TECH-ARCH v0.2 (for v0.3)

- §3.2: remove `claim`, `sweep_unclaimed`; add `pay_prizes(pool, payouts[16], proof)` (settlement signer; escrows flagged shares); add `release_escrow(pool, entry)` / `forfeit_escrow(pool, entry)`; keep `refund` / `trigger_refund`. **Vault exits are now `pay_prizes`, `release_escrow`, `refund` only.** Forfeited escrow → next pool's vault.
- §3.1 `Config`: add `open_tiers: [bool; 4]`, `vault_ceiling_lamports`, `kyc_required_above_lamports` (0 = off), `detection_hard_block: bool`.
- §3.1 `Pool`: add `timer_seconds: u8` (15). `results_root` becomes required at `commit_results`; `payout_tx` recorded.
- §6: TypeScript engine, no WASM; Python vectors unchanged.
- §7: remove partial-fill ("top quarter, compressed") — R7.
- §8: `EntryPacket.kyc_tier` retained in the struct, always 0 at launch (R3).
- §10: replace the stale "five steppers with quick-set chips" sentence with PID v0.5 §4 (pentagon radar). Timer 15s, lock-current (R9). Desktop-first (R18).
- §12: replaced by this document.

---

## 2. Phases

Durations assume one founder working most days with Claude Code. They are estimates for sequencing, not commitments.

| Phase | Name | Weeks | Gate in one line |
|---|---|---|---|
| 0 | Extraction | 1 | Repo exists, docs uploaded, carried components' tests pass, secrets grep clean |
| 1 | Program | 2–4 | `anchor test` green incl. vault-invariant suite; devnet deploy under devnet Squads |
| 2 | Scoring + sealing | 3–5 | TS engine matches Python vectors; a sealed devnet pool reveals and pays 16 wallets automatically |
| 3 | Frontend | 4–8 | A stranger can enter a devnet pool from a fresh browser, play seven battles, see their result and verify it |
| 4 | Gates + detection | 6–9 | Packet omission reverts; geo block works; duplicate battle sets escrow; review page clears them |
| 5 | Devnet dress rehearsal | 8–10 | 20 synthetic-entrant pools settled incl. refund path; verify page confirms all 20 |
| 6 | Compliance + docs | 8–11 (parallel) | Rules/Terms/Privacy live; language audit clean; counsel engaged; territory named |
| 7 | Mainnet, restricted | 11+ | 0.1 SOL tier only, vault ceiling on, allowlisted markets; 10 pools settled with zero disputes |
| 8 | Open up | after audit | Audit + one opinion → 0.5 tier → R17 metric |

---

## Phase 0 — Extraction (1 week)

Executed by `CLAUDE-CODE-PROMPT_blotto-cup-phase-0-extraction.md`. Summarised here so the roadmap is complete.

| Step | Scope |
|---|---|
| 0.1 | Secrets pre-scan of the zip; record the two keypair paths |
| 0.2 | Repo skeleton, docs upload (`docs/`, `docs/reference/` ADR exports, `docs/archive/`), new `CLAUDE.md`, `.env.example`, hooks |
| 0.3 | Carry `crates/blotto-randomness` with five-input digest, five classes, committed Python generator |
| 0.4 | Carry `vrf.rs` (Switchboard read) into `programs/blotto_cup/` scaffold |
| 0.5 | Carry `pass.rs` (Core collection + bare mint under `PermanentFreezeDelegate`); no thaw path |
| 0.6 | Carry frontend seams: Privy auth, tx orchestration, reveal machine, tokens; strip copy and old naming |
| 0.7 | Carry backend plumbing: `_shared` config/db/monitor/http-hygiene; indexer webhook → ledger shape |
| 0.8 | Forbidden-word grep, `EXTRACTION-REPORT.md`, `TRANSITION-REPORT.md`, CI green |

**Gate 0:** `cargo test` green; `anchor build` green; `vitest` green in `app/`; grep returns nothing; CI Rust + gitleaks lanes green on `main`; both reports present. Founder reads the "surprises" sections.

**Change from the extraction prompt (R20):** `crates/blotto-scoring/` is **not** scaffolded. `backend/scoring/` is scaffolded instead.

---

## Phase 1 — Program (weeks 2–4)

The Anchor program `blotto_cup`. Everything the vault does is here; nothing else holds money.

| Step | Scope | Done when |
|---|---|---|
| 1.1 | `Config` + `init_config` + `pause` + `rotate_entry_signer` + `set_open_tiers` + `set_vault_ceiling`. Admin = devnet Squads vault from the first deploy. | Tests: non-admin reverts on every admin ix; pause blocks `register`. |
| 1.2 | `Pool` + `open_pool(tier)`: PDA `["pool", id]`, vault PDA `["vault", id]`, X25519 pubkey + secret hash written, `fill_deadline = now + 72h`, state `Open`. Rejects if tier not in `open_tiers`, or if a pool for that tier is already `Open` (R14). Wires the carried `vrf.rs` as `commit_vrf_seed`, write-once. | Tests: second open per tier reverts; closed tier reverts; VRF write-once. |
| 1.3 | `Entry` + `register(pool, battles_hash, packet)`: **packet check is stubbed to a feature flag in this phase** (real verification is 4.1); 80/20 split; `weighted_class_draw` with the five-input digest; `Entry.class` written; bare pass mint via `pass.rs`; 64th → `Sealed` + `PoolSealed` event; past deadline → reverts. Vault ceiling enforced. | Tests: 65th reverts; class counters sum to 64 and reach zero exactly at seal; digest known-vector matches Python; class is never read anywhere but the mint. |
| 1.4 | `reveal_pool_secret(pool, secret)` — `Sealed` or past deadline; `sha256(secret) == hash`. `commit_results(pool, root)` — after reveal; → `Scored`. | Tests: wrong secret reverts; commit before reveal reverts. |
| 1.5 | **`pay_prizes(pool, payouts: Vec<(Pubkey, u64)>, proofs)`** (R10): settlement signer; each `(player, rank, amount)` leaf proven against `results_root`; unflagged → transfer from vault; flagged → amount moved to `Entry.escrow_lamports`; → `Paid`. `flag_entry` / `clear_flag` before payout; `release_escrow` / `forfeit_escrow` after. Forfeit → rolls to the next open pool's vault of the same tier, or platform wallet if none. | Tests: all 16 paid in one tx on Surfpool; flagged share escrowed; double-pay reverts; total paid + escrowed + residual == vault. |
| 1.6 | `trigger_refund(pool)` (anyone; past deadline and `entrants < 64` — R7) → `Refunding`. `refund(pool, entry)`: full entry from vault **plus** the 20% from the platform wallet's pre-funded refund reserve. `Refunded` event. | Tests: before deadline reverts; 63 entrants after deadline refunds all 63 in full. |
| 1.7 | **Vault invariant suite** (the substitute for an audit, R5): for every instruction, assert lamport deltas on vault, platform wallet, player. A fuzz test over random instruction sequences asserting `vault_lamports == Σ(80% of entries) − Σ(paid) − Σ(refunded) − Σ(forfeited-out)` at every step. Grep test: no `system_program::transfer` from the vault outside `pay_prizes`, `release_escrow`, `refund`. | Fuzz runs 10k sequences clean in CI. |
| 1.8 | Events per TECH-ARCH §3.3 with `Claimed` replaced by `PrizesPaid { pool, payouts }`, plus `EscrowReleased`, `EscrowForfeited`. Devnet deploy; upgrade authority → devnet Squads; `solana program show` confirms. | Program ID in `.env.example` comment; `TRANSITION-REPORT.md` keys table updated. |

**Gate 1:** `anchor test` green including 1.7; devnet program owned by the devnet Squads vault; every acceptance criterion in TECH-ARCH §13 that concerns the program is ticked (with `claim` lines re-read as `pay_prizes`). Founder verifies by running `solana program show <id>` and seeing the Squads address.

---

## Phase 2 — Scoring and sealing (weeks 3–5)

TypeScript throughout (R20). This is the backend's core and the verify page's core — one module, two runtimes.

| Step | Scope | Done when |
|---|---|---|
| 2.1 | `backend/scoring/`: allocation type (five `u8` summing to 100, fixed stat order), 35-byte battle-set encoding, `sha256(bytes ‖ salt)`, all-vs-all engine (PID §5), ranking with tie-breaks, prize bands as bps, Merkle tree of `(player, rank, amount)` matching the on-chain leaf byte-for-byte. Pure functions, no I/O, no `Date`. | Python vector suite (`backend/scoring/fixtures/gen_vectors.py`): 20 hand-checkable 4-player pools, 5 full 64-player pools, draw-rate sanity (~7% on random integer allocations), edge cases (all-tied, all-identical). TS matches every vector. Runs in Node and in a browser bundle with identical output. |
| 2.2 | TS reimplementation of the five-input class digest + bag draw, pinned to the Phase 0 Python vectors, for the verify page. | Vectors match the Rust crate. |
| 2.3 | **Sealing — Turnkey pool-key lifecycle:** at `open_pool`, backend creates an X25519 key in the Turnkey sub-org with policy "export only after `Sealed` or past deadline"; publishes pubkey and `sha256(secret)`; client sealed-box encrypts `(35 bytes, salt, 7 timings, device hash)` to it. Ciphertext store in Postgres (ciphertext only). | Test: export before seal is refused by Turnkey policy (assert the API error); after seal succeeds. |
| 2.4 | **Reveal + verify:** export secret → `reveal_pool_secret` → decrypt every ciphertext → verify against `Entry.battles_hash` → publish plaintext set + salts + timings to Irys (new upload client; nothing to carry) → run 2.1 → build tree → `commit_results` → **`pay_prizes`** (R10). One crank process, idempotent on pool id, resumable from any step. Failure modes per TECH-ARCH §5 implemented and logged. | Devnet: a pool filled by 64 synthetic wallets reveals, scores, and pays automatically within two minutes of the 64th entry. |
| 2.5 | Event indexer: carried webhook → ledger; decoders for the eight events; derived tables `pools`, `entries`, `results`, `payouts`, `profiles` (R15 projection). Re-derive command. | Ledger replays a devnet pool to identical derived rows. |

**Gate 2:** The 2.4 devnet cycle runs end-to-end with no manual step; the published Irys bundle + on-chain root recompute in Node to the same 16 payouts that landed on-chain. Founder verifies by reading the payout transaction in the explorer and matching it to the printed ranking.

---

## Phase 3 — Frontend (weeks 4–8)

Desktop web (R18), Privy (R19). Every user-facing string goes through `app/src/copy/` and is subject to the Phase 6 language audit.

| Step | Scope | Done when |
|---|---|---|
| 3.1 | Shell: Privy login (social + embedded, external wallet option), header, three tabs (Play / Pools / Profile), age self-attestation modal before any pool renders, territory-blocked page (stub until 4.2). | Fresh browser → logged in with an embedded wallet in under 60s. |
| 3.2 | Pool page: tier, entry, entrants/64, 72h countdown, prize table, rules summary, "Decisions are final" statement above the Enter button (PID §8.6). | Reads live from the indexer; countdown correct across refresh. |
| 3.3 | **Entry + class reveal:** `register` transaction via the carried tx seam (with the packet from 4.1 stubbed); carried reveal machine adapted: entry → unsealing → tell → class → settled; typographic pass render (R12) with class + number + seed. | Reveal cannot show a class before `tx_confirmed` (type-level, as carried). |
| 3.4 | **Battle flow — pentagon radar** (PID v0.5 §4): five draggable vertices, even-split start, live normalisation to 100 with rounding remainder on the largest stat, integers shown under the pentagon, one "Even split" button, **15s visible timer, lock-current on timeout (R9)**, per-screen timing capture, seven screens, review screen, confirm, client-side sealed-box encrypt, POST ciphertext, then the hash into `register`. Client invariant: the only thing that can leave the client is five non-negative integers summing to 100 in fixed order. | Property test (`fast-check`): 10k random drag sequences never produce a sum ≠ 100; timeout always locks the displayed integers. |
| 3.5 | Results + leaderboard: after settlement, rank, score, battles won/drawn, full 64-place table, "paid automatically" state with the payout tx link, escrow state copy. | |
| 3.6 | **Verify page (R13):** pool id → fetch events + Irys bundle → decrypt with revealed secret in-browser → run 2.1 → compare to on-chain root and payouts → green/red. Works with the wallet disconnected. | An outsider can verify a devnet pool from the URL alone. |
| 3.7 | Profile (R15): lifetime pools, ranks, win rate, class collection (typographic passes). Read-only. | |
| 3.8 | Shareable result card (R16): server-rendered OG image (rank, class, score, pool id) + link to the results page. | Card renders in a Twitter/X and Discord unfurl. |
| 3.9 | Rules page skeleton: the eight statements in R4 as headed sections with `TODO_COPY`, filled in Phase 6. | |

**Gate 3:** Founder gives the devnet URL to someone who has never seen the product; they enter, play, get a result, and verify it, without help. Record what confused them.

---

## Phase 4 — Gates and detection (weeks 6–9)

| Step | Scope | Done when |
|---|---|---|
| 4.1 | **Entry packet — new work** (the old repo had none): `EntryPacket { wallet, pool, nonce, geo_cleared, age_verified, kyc_tier, issued_at }`, ed25519-signed by the Turnkey entry signer. **On-chain:** load the instructions sysvar, find an `Ed25519Program` instruction in the transaction, check its pubkey == `Config.entry_signer`, its message == canonical packet bytes, `pool` matches, `issued_at` within 60s. Remove the 1.3 feature-flag stub. | **Acceptance tests (TECH-ARCH §13):** omission reverts; wrong pool reverts; stale packet reverts; forged signer reverts. |
| 4.2 | Packet service: geo vendor lookup (vendor of record contracted in Phase 6; sandbox here), VPN/proxy check, sanctions list, age attestation flag; issues packet or returns a **generic** rejection. Territory allowlist from R2 as config. | Blocked country → generic rejection; allowlisted → packet. |
| 4.3 | Detection pipeline on revealed data (R11): entropy across seven battles, timing profile, exact/near-duplicate battle sets, device/IP correlation within a pool (Privy device hash from the sealed payload), population-relative score. **Shadow mode default: all signals logged.** Hard block config: exact-duplicate sets and same-device multi-entry → `flag_entry` before `pay_prizes`. | Synthetic pool with two colluding wallets → both flagged, 14 others paid. |
| 4.4 | Review page (admin, behind Squads-member login): flagged entries, their battles, timings, correlated entries, decision log; `clear_flag` / `forfeit_escrow` actions signed by the settlement signer. Published criteria page. | Founder can clear or forfeit from the page in under a minute. |
| 4.5 | KYC-at-claim switch (R3): `Config.kyc_required_above_lamports`; when non-zero, `pay_prizes` escrows any share above it until a `kyc_tier ≥ 1` packet is presented via `release_escrow`. **Off at launch.** No vendor integration until turned on. | Test: with the switch on, a 1st-place share escrows; with it off, it pays. |

**Gate 4:** All §13 packet criteria green; a blocked-territory browser cannot obtain a packet; 4.3's synthetic collusion case flags correctly and is resolved from 4.4.

---

## Phase 5 — Devnet dress rehearsal (weeks 8–10)

| Step | Scope | Done when |
|---|---|---|
| 5.1 | Synthetic-entrant harness: 64 devnet wallets with varied strategies (random, consistent, clustered, scripted-uniform-timing) entering through the **real** frontend flow via Playwright, not through the API. | 20 pools settled. |
| 5.2 | Refund path: a pool left at 63 past a shortened deadline refunds all 63 in full incl. the 20%. Pause path: `pause` mid-fill, resume. Turnkey export-failure path: deadline-triggered refund. | Each path exercised once, ledger balances reconcile. |
| 5.3 | Verify all 20 pools from the public verify page; one recompute done by a non-founder. | |
| 5.4 | Load: fill one pool in under five minutes with all 64 entering concurrently; crank settles inside two minutes. | Timings in `docs/devnet-rehearsal.md`. |
| 5.5 | Internal review pass (R5 substitute): Claude Code reviews the program against the threat-model entries carried in `docs/reference/`, the vault-invariant suite, and a written checklist of the ten most common Anchor vulnerabilities; findings fixed or recorded. | `docs/internal-review.md` |

**Gate 5:** 20 clean settlements + every failure path exercised + internal review written. Founder reads the review's open items and decides each.

---

## Phase 6 — Compliance and documentation (weeks 8–11, in parallel with 4–5)

Founder-owned. Claude Code drafts; founder edits; counsel red-lines when engaged.

| Step | Scope |
|---|---|
| 6.1 | **Territory named (R2).** Allowlist committed to config; restricted-territory schedule written (C7). |
| 6.2 | Rules page final: the eight R4 statements, scoring formula, prize table, 15s/lock-current, detection criteria, "no chance in the mechanism" with the PID §4.3/§4.5 tables published (PID §8.3 says publish both). |
| 6.3 | Terms of service and Privacy notice (DPIA-lite: what is stored — ciphertext, timings, device hash, geo result — for how long, and why). C10. |
| 6.4 | **Language audit (C12):** automated grep from Phase 0 extended to the copy files + a manual read of every screen. Forbidden: lottery, gamble, bet, wager, casino, pull, pack, odds, jackpot, rake, deal, roll, **promotional**, **sweepstake**. |
| 6.5 | Counsel engagement (R1, in parallel): brief pack = PID §8–10 + this register + rules page. Target: one written opinion for the launch territory. **This is the gate for the 0.5 tier (R6), not for launch.** |
| 6.6 | Vendors of record: geo (contract + production key), hosting region confirmed Frankfurt/Dublin with no US preview region, RPC non-US endpoint. Playbook §5 table filled in `TRANSITION-REPORT.md`. |
| 6.7 | Mainnet keys per playbook §4.2 — generated only when Phase 7 is scheduled: mainnet Squads vault (signer list published on the rules page), Turnkey production sub-org, platform wallet, refund reserve funded. |

**Gate 6:** Rules/Terms/Privacy live on the devnet site; language audit returns nothing; territory allowlist committed; counsel engaged with the brief pack sent (opinion not required); mainnet key table complete with public keys only.

---

## Phase 7 — Mainnet, restricted (week 11+)

| Step | Scope |
|---|---|
| 7.1 | Deploy under mainnet Squads; `init_config` with `open_tiers = [0.1 only]`, `vault_ceiling = 6.4 SOL`, `kyc_required_above = 0`, `detection_hard_block = duplicates + device`. Refund reserve funded. |
| 7.2 | Soft launch: allowlisted territory, founder's own network, one 0.1 pool. Watch the crank, the flag rate, and the verify page. |
| 7.3 | Ten settled pools with zero disputes and zero unexplained flags. Each pool verified publicly. |
| 7.4 | Commission the independent audit (R5) on the tagged commit. |

**Gate 7:** 10 clean mainnet pools + audit commissioned.

---

## Phase 8 — Open up (after audit)

| Trigger | Action |
|---|---|
| Audit findings closed **and** one counsel opinion received (R1, R6) | Open the 0.5 tier. Measure R17: one 0.5 pool fills organically in under 24h. |
| R17 met | Mobile layout (R18). Illustrated pass art via URI upgrade (R12). Partial-fill pools reconsidered (R7). |
| Founder decision after the above | 1 and 5 SOL tiers, each with its own vault ceiling; KYC switch likely turned on for these (R3). |

---

## 3. Standing rules for every step

1. **Branch from `origin/main`, one PR per step, squash-merge.** No step lands without CI green.
2. **Every step prompt names the files it will touch and quotes the current signatures** (the old repo's `CLAUDE.md` lesson on branch-state currency). If a file isn't available, ask before writing.
3. **No constant invented.** If it isn't in the PID, TECH-ARCH, or this register, the step stops and asks.
4. **Forbidden-word grep runs in CI** on every PR from Phase 0 onward, excluding `docs/reference/`, `docs/archive/`, and the two reports.
5. **Class is read by nothing in the scoring path.** A CI test greps `backend/scoring/` and `pay_prizes` for `class` and fails on any hit.
6. **The vault has exactly three exits** (`pay_prizes`, `release_escrow`, `refund`). A CI test asserts it.
7. **Never a keypair in the repo.** The pre-commit hook and gitleaks rule from Phase 0 stay.
8. **Founder reads every gate.** Gates are written to be checkable by running a command or opening a page. If a gate can't be checked that way, the step that produced it is not done.

---

*Filed: 10_BLOTTO_CUP.*
