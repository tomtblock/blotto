# Repo Extraction Brief — `anarchy-fun` → `blotto-cup`

**Version:** 1.1 · **Date:** 2026-08-26 · **For:** Claude Code, working from a zip of `anarchy-fun` into a fresh, empty `blotto-cup` repo
**v1.1:** §8 corrected to seven battles and the pentagon radar; §0 rewritten for zip input; §1 adds dependency-pinning instructions; §7 adds the secrets pre-scan.
**Pair with:** `REPO-TRANSITION-PLAYBOOK.md` (keys and infrastructure) · `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` (what to build) · `PID_Blotto-Cup_v0.5.md` (why)

> Written without direct access to the repo. Every "expected location" is inferred from the PRD, the rarity-and-randomization doc and the handover prompts. **Verify each before acting.** Record what you actually found.

---

## 0. How to use this brief

You are working from an **unpacked zip** of the old repo, not a live clone. Assume no `.git` directory unless you find one. The target is a **fresh repo with empty history** — the fork-versus-fresh decision in the playbook has been made: fresh.

Order of operations:
1. **Secrets pre-scan of the zip before reading anything else** (§7.0). Nothing is copied until this is done.
2. Inventory the zip: top-level tree, `Cargo.toml` workspace members, `package.json` workspaces, `Anchor.toml`, any `docs/` or `adr/` directories.
3. Work through §1–§6 in order. For each component: locate, verify against the description, apply the listed change, copy into the target path, **run the carried tests**.
4. Do not copy anything not listed. Do not copy directories wholesale unless the whole directory is listed.
5. Run the §7 grep. Must return nothing.
6. Write `EXTRACTION-REPORT.md` (§9).

---

## 1. Randomness crate — carry, with one change

**Expected:** `crates/randomness/src/lib.rs` — `derive_open_randomness(vrf_seed, slot_hash, open_index, collection_pubkey) -> [u8; 32]`, SHA-256 over 98 bytes in that order, LE `u16` index. Known-vector tests with hashes precomputed in Python `hashlib`; determinism tests; per-input avalanche tests (Hamming > 96/256). A call-site known-vector test (IPC-001) matching on-chain serialisation.

**Verify:** signature and byte order; that fixtures are Python-generated, not captured from Rust output (look for a `fixtures/` or `vectors.json` with a generator script).

**Change:** add `player_pubkey: &[u8; 32]` as the fifth input. New canonical order:
```
vrf_seed(32) ‖ slot_hash(32) ‖ entry_index(2, LE) ‖ pool_pubkey(32) ‖ player_pubkey(32)  = 130 bytes
```
Regenerate every known vector in Python for the new order and commit the generator script alongside the fixtures. Rename `collection_pubkey` → `pool_pubkey`, `open_index` → `entry_index`. Keep avalanche and determinism tests; add an avalanche test on the new input.

**Dependencies:** carry the exact `sha2` version from the old `Cargo.lock`. Pin it. Do not upgrade during extraction; upgrades are a separate, tested change.

**Also carry:** `weighted_tier_draw` (bag-without-replacement, ADR-021). Verify it handles a counter reaching zero and that the modulo is over the *remaining* total. If it uses `rng % total` directly, note the modulo bias and either accept (negligible at these magnitudes) or use rejection sampling — record the decision.

**Target:** `crates/blotto-randomness/`

---

## 2. Merkle slot-table commitment — carry

**Expected:** a module that shuffles a slot table, computes a Merkle root, produces per-slot proofs, and an encryption step for the table stored on Irys; a verifier matching the on-chain root.

**Verify:** hash function, leaf encoding, whether proofs are sorted-pair or ordered, and that the off-chain root computation matches the on-chain verifier byte for byte.

**Change:** table size 64; five cosmetic classes. Nothing else.

**Target:** `crates/blotto-merkle/` — and reuse the same code for the **results tree** (leaf = `sha256(player ‖ rank ‖ amount_lamports)`).

---

## 3. Switchboard VRF integration — carry

**Expected:** the request/callback flow that produced `vrf_seed` at collection launch (Switchboard On-Demand, program `RANDMo5g…`), plus the account plumbing that stores the result.

**Verify:** Switchboard SDK version; whether the seed is read from a randomness account by CPI or copied into the collection account after settlement. Pin the SDK version from the old lockfile.

**Change:** trigger on `open_pool`. Store in `Pool.vrf_seed`.

**Target:** `programs/blotto_cup/src/vrf.rs`

---

## 4. Signed-packet infrastructure — carry the plumbing, replace the payload

**Expected:** the `XpBoostPacket` path — an ed25519-signed struct requested from a backend service, verified on-chain against a config pubkey, rejected if older than 60 seconds; Turnkey-custodied signer; admin instruction to rotate. Backend endpoint that issues packets.

**Verify — this is the critical one:** how the on-chain verification is done. If it reads a flag or trusts a boolean, it is broken. It must load the instructions sysvar, confirm an `Ed25519Program` instruction exists in the transaction, and confirm that instruction's pubkey, message and signature match the config signer and the canonical packet encoding. **Quote the relevant code in the report.** If it is wrong, carry the plumbing and rewrite the verification — do not carry the bug.

**Change:** replace the payload with `EntryPacket` per `01_PRODUCT_FACTS/SPEC_Entry-Packet_v1.md`: `wallet, pool, nonce, geo_cleared, age_verified, kyc_tier, issued_at, signature`. Delete every odds-related field and every reference to boost, multiplier, or XP. Backend endpoint performs geo, VPN, sanctions, age and KYC checks at issuance; returns a generic rejection.

**Target:** `programs/blotto_cup/src/entry_packet.rs` · `backend/src/packet/`

---

## 5. Metaplex Core minting and reveal — carry, freeze transfers

**Expected:** mint of an mpl-core asset with a placeholder URI; a reveal authority that later updates the URI; the reveal authority key in Turnkey.

**Verify:** the plugin set on mint; whether transfer is currently unrestricted (it will be — the old product listed on Magic Eden). Pin the `mpl-core` version.

**Change:** add the permanent transfer restriction at mint (Core `PermanentFreezeDelegate` or equivalent; or migrate the pass to Token-2022 `NonTransferable`). Confirm no instruction can lift it. The pass must never be listable.

**Target:** `programs/blotto_cup/src/pass.rs` · `backend/src/reveal/`

---

## 6. Irys, image generation, frontend scaffolding — carry selectively

**Irys upload:** carry as-is → `backend/src/irys.rs`.
**fal.ai generation:** carry the client; **add a prompt blocklist** before any call → `backend/src/art/`.
**Frontend:** carry wallet connect, the reveal animation and the verify-page scaffold only. **Do not carry** the pack-open flow, any curve UI, the trending view, or any copy. → `app/src/wallet/`, `app/src/reveal/`, `app/src/verify/`

---

## 7. Do not carry — and scan before, grep after

### 7.0 Secrets pre-scan of the zip (before anything is copied)
```bash
gitleaks detect --source ./anarchy-fun --no-git --report-path pre-scan.json
find ./anarchy-fun -name '.env*' -o -name '*.pem' -o -name '*keypair*' -o -name 'id.json'
grep -rlE '^\s*\[\s*[0-9]{1,3}(\s*,\s*[0-9]{1,3}){63}\s*\]' ./anarchy-fun   # Solana keypair JSON arrays
```
Anything found: **do not copy it**, record the path in the report (never the value), and flag it for rotation in the transition playbook's key table. If a `.git` directory is present in the zip, also run `gitleaks detect --source ./anarchy-fun --log-opts="--all"`.

### 7.1 Components never carried
Bonding-curve program and maths · `synthetic_sell` and the 40/40/20 split · XP odds boost, `XpBoostPacket` payload fields, `MAX_BOOST_BPS`, any per-user odds modifier · trending algorithm · end-of-life redemption · community-treasury reward logic · any transferable SPL mint · Magic Eden listing integration · any `.env`, keypair, or credential file.

### 7.2 Terms — grep the new repo before first commit
```bash
grep -rniE 'casino|gambling|disguised|dopamine|shill|degen|the house|pump|bonding|lottery|jackpot|\bodds\b|\bpack\b|\bpull\b|\bbet\b|wager|rake|\broll\b' ./blotto-cup --exclude-dir=node_modules --exclude-dir=target
```
Must return nothing. In the cosmetic draw, rename any `odds`/`weights` variable to `class_weights`.

---

## 8. New — not in the old repo

`programs/blotto_cup/` — `Config`, `Pool`, `Entry`, vault PDA, state machine, `register` / `reveal_pool_secret` / `commit_results` / `claim` / `flag_entry` / `clear_flag` / `trigger_refund` / `refund` / `sweep_unclaimed`. **The vault has no withdraw instruction.**
`crates/blotto-scoring/` — allocation encoding (5 × `u8` summing to 100, fixed stat order Strength/Speed/Heart/Wit/Durability), seven-battle set encoding (35 bytes), all-vs-all scoring, ranking, Merkle leaves; WASM target; Python-precomputed known vectors including the draw-rate sanity check (~7% on random integer allocations).
`backend/src/sealing/` — Turnkey X25519 pool-key lifecycle with export policy; ciphertext store; reveal; hash verification.
`backend/src/detection/` — entropy, timing, duplicate, correlation, population signals; flag/clear; review page.
`app/src/battle/` — **seven screens, pentagon radar with five draggable vertices, even-split default, live normalisation to 100 with rounding remainder on the largest stat, "Even split" as the only button, per-screen timing capture, client-side encryption.** Reference: PID v0.5 §4 and the interactive mockup in the design thread.
`app/src/rules/`, `app/src/leaderboard/`, `app/src/claim/`.

---

## 9. Report format

`EXTRACTION-REPORT.md` in the new repo root:

```
## Pre-scan
Secrets found (paths only): …
Keypair files found (paths only): …

## Inventory
Top-level tree; workspace members; Anchor.toml programs; docs found

## Component: <name>
Expected location: …
Found at: …
Matches description: yes / partly / no — <what differed>
Change applied: …
Dependencies pinned: <crate@version> …
Tests carried: … / regenerated: … / result: pass|fail
Notes: …

## §7.2 grep result: (must be empty)

## Things I found that this brief did not anticipate
```

---

*Filed: 10_BLOTTO_CUP.*
