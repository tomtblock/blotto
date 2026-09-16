# Blotto Cup — Technical Architecture and Roadmap

**Version:** 0.2 · **Date:** 2026-08-26 · **For:** build in Claude Code
**v0.2 changes:** `BATTLES = 7`; zone names; class table; integer allocation; detection adjusted for seven samples.
**Companions:** `PID_Blotto-Cup_v0.4.md` · `REPO-EXTRACTION-BRIEF.md` · `REPO-TRANSITION-PLAYBOOK.md`
**Stack:** Anchor (Rust) on Solana; TypeScript/React frontend; Rust or Node backend; Postgres.

---

## 1. System overview

```
┌─────────────┐   register + sealed hash   ┌──────────────────┐
│  Frontend   │ ─────────────────────────► │  blotto_cup      │  Anchor program
│  (wallet,   │   claim w/ Merkle proof    │  ├ Config        │
│  7 battles) │ ◄───────────────────────── │  ├ Pool          │
└──────┬──────┘                            │  ├ Entry         │
       │ encrypted battles                 │  └ Prize vault   │
       ▼                                   └────────┬─────────┘
┌─────────────┐                                     │ events
│  Backend    │ ◄───────────────────────────────────┘
│  ├ entry-packet signer (geo / age / KYC)
│  ├ sealed store (ciphertext only)
│  ├ pool-key custody (Turnkey, export locked until close)
│  ├ reveal + scoring engine
│  ├ detection
│  └ Merkle builder → commit_results
└─────────────┘
```

Three trust boundaries, each stated publicly: the **program** holds money and enforces on-chain rules; the **backend** computes what is too expensive on-chain and publishes everything needed to recompute it; **sealing** makes the operator blind to allocations before close, not merely trusted.

---

## 2. Constants

```rust
pub const BATTLES: usize = 7;
pub const ZONES: usize = 5;             // Strength, Speed, Heart, Wit, Durability
pub const POINTS: u8 = 100;
pub const CAPACITY: u16 = 64;
pub const MIN_FILL: u16 = 32;
pub const POT_BPS: u16 = 8000;
pub const CLASS_COUNTS: [u16; 5] = [38, 15, 7, 3, 1];  // Goblin, Knight, Wizard, Dragon, Titan
```

An allocation is `[u8; 5]` summing to 100. A battle set is `[[u8; 5]; 7]`. Encoded for hashing as 35 bytes, zone order fixed, battle order fixed.

---

## 3. On-chain program `blotto_cup`

### 3.1 Accounts

```rust
#[account] pub struct Config {
    admin: Pubkey,               // Squads multisig
    entry_signer: Pubkey,        // rotatable
    settlement_signer: Pubkey,
    platform_wallet: Pubkey,
    paused: bool,
}

#[account] pub struct Pool {
    id: u64,
    tier: u8,
    entry_lamports: u64,
    entrants: u16,
    opened_at: i64,
    fill_deadline: i64,
    state: PoolState,            // Open | Sealed | Scored | Refunding | Closed
    pool_pubkey: [u8; 32],       // X25519, published at open
    pool_secret_hash: [u8; 32],
    vrf_seed: [u8; 32],
    class_root: [u8; 32],        // Merkle root of shuffled class table
    class_counters: [u16; 5],
    results_root: Option<[u8; 32]>,
    prize_vault: Pubkey,         // PDA ["vault", id]
}

#[account] pub struct Entry {
    pool: Pubkey,
    player: Pubkey,
    index: u16,
    battles_hash: [u8; 32],      // sha256(35 bytes ‖ 32-byte salt)
    class: u8,
    pass_mint: Pubkey,
    entered_at: i64,
    claimed: bool,
    flagged: bool,
}
```

### 3.2 Instructions

| Instruction | Signer | Effect |
|---|---|---|
| `init_config` | admin | once |
| `open_pool(tier)` | settlement | Pool + vault; pool_pubkey + secret hash; VRF request |
| `register(pool, battles_hash, packet)` | player | verify packet (precompile present + message matches); 80% → vault, 20% → platform; class draw; mint frozen pass; write Entry; 64th → Sealed |
| `reveal_pool_secret(pool, secret)` | settlement | Sealed or past deadline; `sha256(secret) == hash` |
| `commit_results(pool, root)` | settlement | after reveal; → Scored |
| `claim(pool, rank, amount, proof)` | player | proof vs root; `!flagged`; pay; mark claimed |
| `flag_entry` / `clear_flag` | settlement | escrow gate |
| `trigger_refund(pool)` | anyone | past deadline and < MIN_FILL → Refunding |
| `refund(pool, entry)` | player / crank | full entry from vault + platform share |
| `sweep_unclaimed(pool)` | settlement | after claim window → next pool vault |
| `rotate_entry_signer` / `pause` | admin | multisig |

**The vault has no withdraw instruction.** Exits are `claim`, `refund`, `sweep_unclaimed` only. Auditor confirms no other path.

### 3.3 Events
`PoolOpened` · `EntryRegistered { player, index, battles_hash, class, slot_hash }` · `PoolSealed` · `PoolSecretRevealed { secret }` · `ResultsCommitted { root }` · `Claimed` · `EntryFlagged` · `Refunded`. Every recomputation input is in the log.

---

## 4. Class draw

```
rng = SHA256(vrf_seed ‖ slot_hash_{N-5} ‖ entry_index(LE u16) ‖ pool_pubkey ‖ player_pubkey)
```
Bag-without-replacement over `class_counters`. Merkle root of the shuffled table at `open_pool`; full table published at close. Class is written to the pass and `Entry.class`; **it is read by nothing in the scoring path**.

---

## 5. Sealing

1. At `open_pool`, backend generates an X25519 keypair in Turnkey with policy: *export only after Sealed or deadline*. Publishes pubkey and `sha256(secret)` on-chain.
2. Client: seven battles → 35 bytes; 32-byte salt; `battles_hash = sha256(bytes ‖ salt)`; sealed-box encrypt `(bytes, salt, per-battle timings)` to pool pubkey; POST ciphertext; call `register` with the hash.
3. Backend stores ciphertext only.
4. At seal: export secret → `reveal_pool_secret` → decrypt all → verify each hash → publish plaintext set with salts.
5. Anyone: decrypt with the revealed secret, hash, compare, score.

**Failure modes, published:** lost ciphertext → entry scored as all losses and its fee refunded from platform share; export failure → deadline-triggered full refund.

**Public wording:** "Battles are encrypted to a key nobody holds until the pool closes, and their hash is recorded on-chain at entry."

---

## 6. Scoring engine

```
for i, j in pairs(players), i < j:
  for k in 0..7:
    zi = count(a[i][k][z] > a[j][k][z] for z in 0..5)
    zj = count(a[j][k][z] > a[i][k][z] for z in 0..5)
    if zi >= 3: score[i] += 1
    elif zj >= 3: score[j] += 1
    else: score[i] += 0.5; score[j] += 0.5
    zones[i] += zi; zones[j] += zj
rank by score desc, zones desc, entered_at asc
```
14,112 comparisons. Shared Rust crate, WASM build for the verify page, **Python-precomputed known vectors**.

Output: full battle matrix, per-player score, rank, Merkle tree of `(player, rank, amount_lamports)`.

---

## 7. Prizes
Band table (PID §6) as bps of the vault. `amount = vault × bps / 10000`. Residual rolls forward. Leaves `sha256(player ‖ rank ‖ amount)`. Partial-fill pools: top quarter, same shape compressed.

---

## 8. Entry packet
Per `01_PRODUCT_FACTS/SPEC_Entry-Packet_v1.md`, gating `register` only. **Verify the `Ed25519Program` instruction is present via the instructions sysvar and its message equals the canonical packet.** Acceptance test: omission reverts.

---

## 9. Detection — seven samples per player

Seven is workable but thin; weight signals accordingly and require two independent signals before a flag.
- **Allocation entropy** across the seven battles — reuse patterns, round-number clustering, symmetric splits.
- **Per-battle timing** — captured client-side, included in the sealed payload, revealed at close. Human sessions show a slower first battle and occasional long pauses; scripts are uniform.
- **Duplicate and near-duplicate battle sets** across entries — collusion or multi-accounting. Exact duplicates across 35 bytes are near-impossible for independent humans.
- **Device/IP correlation** within a pool.
- **Population-relative score** — far outside the field distribution.

Flag → escrow → 24h human review → clear or forfeit. Criteria published. Review page shows the flagged battles, timings, correlated entries and a decision log.

---

## 10. Frontend

Wallet connect · age gate and territory check before the pool renders · pool page (tier, price, entrants/64, deadline, prize table, rules) · **battle flow**: seven screens, five steppers with quick-set chips 0/25/50/75/100, running remainder, per-screen timer capture, review, "decisions are final" confirm, one transaction · class reveal animation · leaderboard and claim · **verify page**: pool id → events → decrypt with revealed secret → WASM recompute → compare to root · rules page.

---

## 11. Infrastructure
Hosting outside every blocked market (Frankfurt/Dublin; no US regions) · RPC provider with non-US endpoint in contract, own node as fallback · geolocation vendor of record · KYC provider · Turnkey for entry signer, settlement signer, pool secrets · Squads multisig for `Config` · Postgres for ciphertexts and detection; Irys for published battle sets and class tables. See `REPO-TRANSITION-PLAYBOOK.md` for provisioning.

---

## 12. Roadmap

| Phase | Weeks | Scope |
|---|---|---|
| 0 Extraction | 1 | Run `REPO-EXTRACTION-BRIEF.md` and `REPO-TRANSITION-PLAYBOOK.md`; new repo skeleton; fresh keys and instances |
| 1 Program | 1–3 | Accounts, instructions, events, class draw, packet check, vault; tests incl. precompile omission |
| 2 Sealing + scoring | 2–4 | Shared crate, WASM, Python vectors; Turnkey key lifecycle; ciphertext store; reveal; commit |
| 3 Frontend | 3–6 | Battle flow, pool page, leaderboard, claim, verify, rules; gates |
| 4 Detection | 5–7 | Signal pipeline on revealed data; flag/clear; review page |
| 5 Devnet | 6–8 | Full cycle with synthetic entrants; refund path; deadline path; verify against a real pool |
| 6 Audit + counsel | 7–10 | Program audit; C1 opinions; language audit; rules final |
| 7 Mainnet, restricted | 10+ | Entry tier, low cap, invited markets; watch false-positive rate |

---

## 13. Acceptance criteria

- [ ] `register` without ed25519 precompile instruction reverts
- [ ] `register` with a packet for another pool reverts
- [ ] `register` beyond capacity reverts; 64th → Sealed, event emitted
- [ ] No lamport exit from the vault except `claim`, `refund`, `sweep_unclaimed`
- [ ] `claim`: invalid proof reverts; valid proof pays exact amount once; flagged reverts until cleared
- [ ] `trigger_refund` before deadline reverts; after deadline with < 32 succeeds; `refund` returns full entry
- [ ] `reveal_pool_secret` with wrong secret reverts; `commit_results` before reveal reverts
- [ ] Allocation validation: five `u8` summing to exactly 100; anything else rejected client- and server-side
- [ ] Class draw known-vector test matches Python fixture with the five-input digest
- [ ] Scoring known-vector test matches Python fixture; WASM equals native
- [ ] Draw rate on random allocations ≈ 7% (sanity check that integer granularity is enforced)

---

*Filed: 10_BLOTTO_CUP.*

---

## Appendix A — What this document now gets wrong (added 2026-09-13)

**Everything above this line is the document as filed on 2026-08-26 and has not
been edited.** This appendix is architect-authored and dated; it does not
reissue the document, it fences it. Read the body for intent — the reasoning,
the threat model and the design tradeoffs are still the reasoning behind what
was built. Read `AS-BUILT.md` for what exists, and
`01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md` for a fact with its source.

Three months of ratified decisions sit between the body and the branch. The
list below is not everything that changed; it is everything a reader who
trusted the body would get **wrong**, which is a different and shorter list. It
supersedes the short version in `INDEX.md`.

### The line to fix first

**§3.2: "The vault has no withdraw instruction. Exits are `claim`, `refund`,
`sweep_unclaimed` only."** Two of those three instructions do not exist, and all
four real exits are missing. The exit set is `pay_prizes`, `release_escrow`,
`pay_next_place`, `refund` — with `trigger_refund`'s pot return living in the
same file — and `forfeit_escrow` moves nothing at all. The headline claim, that
there is no withdraw instruction, is still true and is asserted by
`scripts/check-standing-rules.sh` on every change. The enumeration under it is
not.

### Constants (§2)

| Says | Is |
|---|---|
| `MIN_FILL = 32` | `MIN_SEATS = 40`, and carried per pool in `Pool.min_seats` so a change cannot move the floor under seated players (R7-b) |
| `POT_BPS = 8000` | **No such constant.** A pot is a fixed per-tier amount moved from the treasury before entries open, never a proportion of anything. CI greps for pot-from-entries arithmetic and fails on it |
| `BATTLES`, `ZONES`, `POINTS` as program constants | Deliberately removed from the program on 2026-09-07: unused mirrors implied an on-chain check that does not exist. They live in `backend/scoring/src/allocation.ts` |

### Accounts and instructions (§3)

- **`Config` has five fields.** It has the four service keys, the tier price and
  pot tables, `open_tiers`, the switches, the treasury book-keeping, the
  timings and the per-tier cooldown stamps — 476 bytes.
- **`Pool` as listed** is missing `pot_lamports`, `min_seats` and `payouts[64]`,
  and `PoolState` has six variants, not five: the listed set omits `Paid`.
- **`Entry.claimed: bool`.** No such field. The tail is `escrowed_at`,
  `forfeited`, `next_place_lamports`, the split book-keeping, and
  `sanctions_hold`.
- **`open_pool` may be sent by settlement.** Keeper only, and by nobody else
  however long a tier sits idle (founder ruling 2026-09-07). The opener chooses
  the pool's sealing key, which is why.
- **`register` splits 80/20 into vault and platform.** It credits 100% to the
  treasury and cannot address a vault at all.
- **`claim` and `sweep_unclaimed`.** Neither exists. Prizes are pushed on
  settlement; there is no claim step and no claim window (R10).
- **`pause`.** The instruction is `set_paused`.
- **`trigger_refund` below `MIN_FILL`.** Below the pool's own floor, and it
  refuses at the floor and above with `FieldReached`.
- **Missing from the instruction list entirely:** `migrate_config`,
  `migrate_pool`, `seal_at_deadline`, `place_sanctions_hold`,
  `lift_sanctions_hold`, `pay_next_place`, `set_open_tiers`,
  `set_tier_economics`, `set_treasury_policy`. Thirty-three exist;
  `AS-BUILT.md` lists them by who may send them.
- **Events.** `Claimed` does not exist. Missing: `PrizesPaid`, `TierSlotFreed`,
  `PoolMigrated`, and `PoolSealed`'s `pot_lamports` and `reason` fields
  (`SealReason::Capacity` or `DeadlineMinFill`).

### Prizes (§7)

**"Band table as bps of the vault; residual rolls forward; partial-fill pools
take the top quarter."** One paid place: the player ranked first takes the pot
whole (`PRIZE_BANDS_1024 = [1024]`, `PAID_RANKS = 1`). There is no residual
roll-forward and no partial-fill compression. A tie for first splits the pot
evenly, and the indivisible remainder goes to the eligible player with the
lowest entry number.

### The engine (§6)

- **"Shared Rust crate, WASM build for the verify page"**, repeated at §11 and
  §13. The scoring engine and the results tree are **TypeScript**
  (`backend/scoring/`), one module run unchanged by the crank and by the
  browser. No WASM exists anywhere in the repository. The Rust crates
  `blotto-scoring` and `blotto-merkle` were dropped by register row R20; the
  workspace holds `crates/blotto-randomness` and the program alone.
- **"Rank by score desc, zones desc, entered\_at asc".** Entry order is not a
  tiebreak. Players equal on both criteria share a competition rank and split
  the combined prize of the positions they occupy; entry order decides only the
  indivisible remainder and the published leaf order.

### The pool's life (§5) and review (§9, §11)

- **"Publish plaintext set with salts"** and **"a lost ciphertext has its fee
  refunded from the platform share".** The published bundle (version 2, since
  2026-09-12) carries battles, salts, commitments and statuses — no timings and
  no device hash. A failed or malformed entry is scored all losses, and no fee
  is refunded.
- **"Flag → escrow → 24h human review"**, and §11's staffed-24h acceptance row.
  The **published** window is 12 hours. The program's permissionless
  `release_escrow` after **7 days** is a safeguard against our own failure, not
  the published deadline — two different windows, and conflating them
  understates the promise to the player by a factor of fourteen.
- **"Require two independent signals before a flag".** Detection is advisory
  and flags nothing automatically: the five signals are computed and logged in
  shadow mode, and a flag is only ever a named reviewer's signed decision.

### Dangling references

`PID_Blotto-Cup_v0.4.md` (current is v0.5), `REPO-EXTRACTION-BRIEF.md` (the
file is `REPO-EXTRACTION-BRIEF_v1.1.md`), `01_PRODUCT_FACTS/SPEC_Entry-Packet_v1.md`
(never existed; that directory holds `PRODUCT-FACTS_BlottoCup_v1.md` alone),
and the §1 diagram's return arrow, which is still a proof-carrying claim. The
stack line's "Rust or Node backend" was settled as Node and TypeScript
throughout. §12's "KYC provider" is a switch that is off at launch.

### What the body is still right about

The trust boundaries, the sealing construction and its failure modes, the
threat model and its mitigation ids (`threat-tm-401`, `-402`, `-403`), the
integer-only rule, the pentagon's granularity argument, and the reasoning for
distinct PDA seed prefixes. Those are why the build looks as it does, and none
of them has been superseded.

### The character pass (§4) — added 2026-09-15

- **Class names.** The body, like PID v0.5 §3, names the five classes Goblin, Knight, Wizard,
  Dragon and Titan. The founder dropped the creature names on 2026-09-15: a character is labelled
  by its rarity tier only — Common, Uncommon, Rare, Epic, Mythic — in the same index order as the
  on-chain `class_counters` bag (`38 · 15 · 7 · 3 · 1` of 64), which is unchanged. The program was
  not rebuilt for a label; the mapping is recorded here and in
  `docs/CHANGE-2026-09-15_reveal-and-rarity.md`.
- **Where a player sees it.** Nowhere in the entry flow. The reveal — the egg, the tapping, the
  class tell — was removed on the founder's instruction of 2026-09-14 ("the rarity assignment will
  happen quietly under the hood and will not be something initially broadcast to users"). The share
  card and the public card image carry the pool and the seat; the profile is the one surface that
  shows the tier, beside a line stating that it is decorative.

### Data minimisation (§5, §9) — added 2026-09-16

- **§9's "device/IP correlation" is device-only.** The IP half was never fed — the detection input
  existed and always arrived empty — and was removed on 2026-09-16 under the founder's ruling of
  2026-09-15: no IP-derived value is captured, stored or sealed at entry. The signal keeps its
  persisted name. Proposed register row, pending the founder (D-E16): *"The IP half of R11/4.3's
  device/IP correlation is removed: no IP-derived value is captured, stored or sealed at entry;
  device correlation within a pool stays. The sealed boxes have no public reader; the published
  bundle is the only public battle set."*
- **§5's sealed boxes have no public reader.** The read API served every seat's box once the secret
  was on chain, which published the timings and device hash that bundle version 2 (B-31) keeps out
  of the published set. That route is gone; the what-beat-you view reads the published bundle and
  checks each seat against its on-chain hash (`battlesCommitment`, `backend/sealing/src/payload.ts`).
- **Removed surfaces.** The profile's rivals graph and its route. The public entries route names its
  columns. Logs and alerts carry truncated identifiers only.
- **Designed, deferred, on the record:** appeal grounds private to reviewers; the timings and device
  marker sealed to a per-pool detection key. Both in `docs/CHANGE-2026-09-16_data-minimisation.md` §8.
