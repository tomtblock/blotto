# Blotto Cup — architecture as built

What exists in this repository: what runs, what talks to what, what the program enforces, and
what is not built. It is written from the code and was verified against the code on the branch at
this change. Where this file and the code disagree, the code is right and this file is a bug.

- Pictures of the same system: [`DIAGRAMS.md`](DIAGRAMS.md).
- Why things are the way they are: [`DECISIONS.md`](DECISIONS.md) carries every decision ID this
  file cites (R7-b, D-E6 …).
- The mechanism in plain language, no code: [`../guide/HOW-IT-WORKS.md`](../guide/HOW-IT-WORKS.md).

**Status.** Devnet only. Program id `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`. Nothing is
deployed to mainnet and no real money is involved. Legal review of the product is pending.

---

## 1. The product in one pass

A player signs in with a wallet, accepts the terms, and passes an age and territory check. They
place points on a **battle board** — seven battles, five stats each (Strength, Speed, Heart, Wit,
Durability) — under one of two rules:

| Mode | `Pool.mode` | Placing rule | Payload battles |
|---|---|---|---|
| Easy | `0` | Each battle's five stats sum to exactly **100** (seven battles) | 35 × `u8` = 35 bytes |
| Hard | `1` | **700** points placed anywhere across the 35 cells | 35 × `u16` LE = 70 bytes |

The board is encrypted **on the player's device** before payment; only a hash goes on-chain. The
player pays a fixed entry and receives a non-transferable character pass whose class is drawn
on-chain — cosmetic, read by nothing that decides money or ranking.

A pool holds **8, 16, 32 or 64** players (`Pool.capacity`, the Ladder — D-E19) and plays with at
least its **minimum field**: 5, 10, 20 or 40, the break-even field for its size. It seals when its
last place fills, or when its **12-hour** deadline passes with at least the minimum field entered.
Below it at the deadline, every entry is refunded in full. No operator key decides which of those
happens.

After sealing, the pool's decryption secret is published on-chain, every board becomes readable,
the scoring is re-run by anyone who wants to, and the top quarter of the pool's capacity is paid on
the pool's fixed prize table — whole multiples of the entry, copied onto the pool at open — out of
a prize pool funded from the treasury before entries opened, the same whatever the field.

Scoring is identical in both modes: a stat is won by the larger number, a battle by winning three
of five stats (otherwise a draw), and every player is compared with every other player.

## 2. The pieces

```
                 browser (Next.js app)
                   │        │            │
       packet ◄────┘        │            └────► indexer read API
     (entry gate)           │                    (GET /pools, /pool-types, /treasury …)
          │                 ▼
          │            Solana devnet ───► RPC webhook ──► indexer
          │          (program blotto_cup)                    │
          │                 ▲                                ▼
          │                 │                            Postgres
   reveal daemon ───────────┘                          (event ledger
  (keeper + crank)                  review service ────  + projections)
          │                     (two reviewers, signed log)
          ▼
    Irys (published bundles)
```

Six deployable units — four backend services, the frontend, and the watcher (`backend/watch`, R23):
a fifth Fly app in another region that checks all of the above from outside, chain included, and
tells the founders' Telegram group when something breaks. Topology, ports and health checks in
detail: [`../guide/HOSTING.md`](../guide/HOSTING.md). The frontend is reached on two channels
that are one build: the site, and an Android WebView shell (`mobile/`, for the Solana dApp Store)
that opens the site and holds nothing of its own. The closed list of what differs on a phone, the
build check that keeps every entrant on the served build, and the package's own procedures are in
[`../guide/MOBILE.md`](../guide/MOBILE.md) (D-E18).

| Unit | Package | Port | What it does |
|---|---|---|---|
| App | `app/` | — | Next.js frontend. Reads the indexer, posts to the packet service, seals the board and signs transactions in the browser. |
| Indexer | `backend/indexer` | 8080 webhook, 8081 read API | Ingests program events (webhook at finalized, plus backfill from RPC on restart), projects them into Postgres, serves the public read API and the treasury report. Owns the database schema and runs the migrations. |
| Packet service | `backend/packet` | 8082 | The entry gate. Territory and VPN check, age/terms attestation, sanctions screening, ciphertext intake, then an Ed25519-signed entry packet the program verifies at `register`. Fails closed. |
| Review service | `backend/detection` | 8083 | The review desk: reviewer-signed decisions and player appeals in an append-only log, player complaints, and the persisted detection report. |
| Daemon | `backend/reveal` | 8084 (health) | Keeper and crank. Opens pools, seals or refunds them at the deadline, reveals the secret, scores, commits results, pays, publishes the bundle, runs the review clock. Ticks every 15 s. |

Library packages: `backend/_shared` (config, Postgres, monitoring, event decoders),
`backend/scoring` (both placing rules, the scoring engine, prize maths, the results tree — one
module used by the crank and the browser), `backend/sealing` (payload format, sealed boxes,
pool-key custody), `backend/sanctions` (list loading and screening, shared by the packet service
and the crank), and `backend/class-digest` (the class draw replayed in TypeScript; kept apart so
the scoring path never mentions class).

**External services used:** Solana RPC with webhooks (Helius), sign-in and embedded wallets
(Privy; Phantom also supported), key custody for the entry signer and pool secrets (Turnkey),
permanent publication (Irys), the admin multisig (Squads), IP
geolocation (IPLocate), sanctions lists (OFAC SDN, Chainalysis, OpenSanctions), Postgres. The
vendor map and configuration: [`../guide/HOSTING.md`](../guide/HOSTING.md).

### Service routes

| Service | Public | Restricted |
|---|---|---|
| Indexer read API | `GET /health`, `/time`, `/tiers`, `/pool-types`, `/pools` (`?state=`, `?tier=`, `?mode=`, `?capacity=`), `/pools/:pool` and its `/entries`, `/results`, `/payouts`, `/leaderboard`, `/verify-record`; `/treasury`; `/history/summary`, `/history/persistence`, `/history/entries`; `/profiles/:player`, `/profiles/:player/history` | Webhook ingest and the daemon's `POST /bundles` announce (shared secret) |
| Packet service | `GET /health`, `/geo`; `POST /attestation`, `/ciphertexts`, `/packet`, `/notify`, `/notify/pool`; `GET /ciphertexts/status` | — |
| Review service | `GET /health`, `/decisions`, `/appeals`, `/pending`; `POST /decisions` (reviewer-signed), `POST /appeals` (player-signed), `POST /complaints`; `GET /complaints?ref=` (the complainant's own thread); `POST /complaints/answer` (reviewer-signed) | `GET /detection`, `GET /complaints/open` — operator token, fail closed |

The read API serves no ciphertext. The published bundle is the only public copy of anyone's board.

## 3. The on-chain program

Anchor 1.0.2 on Solana 3.1.10, crate `programs/blotto_cup`. Deployed to devnet only.

**Where the program id is written.** `declare_id!` in `programs/blotto_cup/src/lib.rs` is the
authority. Nine other files carry it as a literal, and the unit test
`every_hard_coded_program_id_matches_declare_id` fails if any disagrees:

| File | What the copy is |
|---|---|
| `Anchor.toml` (×2) | `[programs.localnet]` and `[programs.devnet]` |
| `config/custody.json` | The published custody disclosure the app renders |
| `backend/indexer/src/config.ts` | Default when `BLOTTO_PROGRAM_ID` is unset |
| `backend/detection/src/main.ts` | The same default, review service |
| `backend/reveal/src/main.ts` | The same default, daemon |
| `scripts/admin.ts` | `--program` default |
| `scripts/check-deployed.ts` | The drift check's default |
| `.github/workflows/deploy-backend.yml` | `PROGRAM_ID` for the backend deploy |
| `app/.env.example` | Named beside `NEXT_PUBLIC_PROGRAM_ID` |

Two copies sit outside the repository: the frontend host's `NEXT_PUBLIC_PROGRAM_ID` (set by hand)
and each backend service's `BLOTTO_PROGRAM_ID` (set by `deploy-backend.yml`).

### Accounts

Every PDA type has its own seed prefix, and no prefix is the start of another: the pool type's is
`ptype`, not `pool_type`, because seeds are concatenated without a length prefix, so a prefix that
begins with another's can let two seed lists spell the same bytes
([`adr/threat-tm-401.md`](adr/threat-tm-401.md)). Layouts are pinned byte for byte by
`account_layouts_are_pinned` in `state.rs`.

| PDA | Seeds | Space (bytes) | Holds |
|---|---|---|---|
| `Config` | `["config"]` | 605 | The four service keys (admin, entry signer, settlement signer, keeper); per-tier prices, ceilings and the 64-player reference prize pool; the easy and hard ladders' tier switches (`open_tiers`, `hard_open_tiers`); pause, KYC and detection switches; treasury book-keeping (`platform_reserved`, `platform_refundable`) and policy; fill deadline and cooldown; `enabled_pool_types`, the count of enabled pool types. The per-(mode, tier) slots and cooldown stamps stay in the layout but are no longer read. Singleton. |
| `PoolType` | `["ptype", mode, tier, capacity (u16 LE)]` | 57 | One (mode, tier, capacity) — up to 2 × 7 × 4 = 56: its minimum field, paid places, prize table (`[u8; 16]`, multiples of the entry), fixed prize pool, enable switch, live-pool slot and cooldown stamp. Every pool copies the economics at open. |
| `Pool` | `["pool", id]` | 869 | One competition: tier, mode, capacity, price, prize pool, deadline, `min_seats`, `paid_places`, `prize_table`, state, the class bag, sealing commitments, the results root and the committed payout list. |
| `Entry` | `["entry", pool, player]` | 228 | One seat: player, index, battles hash, class, pass, flags, escrow, sanctions hold, and the next-place split book-keeping. Keyed by player, so one entry per wallet per pool is structural. |
| Prize vault | `["vault", id]` | 0 | Zero-data, system-owned. Holds that pool's prize pool plus a rent cushion. |
| Treasury | `["platform"]` | 0 | Zero-data, system-owned. Receives every entry payment and funds every prize pool. |
| Pass collection | `["pass_collection", pool]` | — | The Metaplex Core collection whose frozen state every pass inherits. |

Pool states: `Open → Sealed → Scored → Paid`, or `Open → Refunding → Closed` (a pool with no
entrants goes straight to `Closed`).

**Growth by appending.** External readers hold byte offsets into these accounts, and Anchor refuses
an account shorter than its current layout, so fields are only ever appended and each growth has a
one-shot migration:

| Account | Sizes (with discriminator) | Migration |
|---|---|---|
| `Config` | 380 → 484 (keeper, timings, cooldowns) → 603 (hard ladder) → 605 (`enabled_pool_types`, D-E19) | `migrate_config` (admin): 603 → 605, or 484 → 605 through both tails; a 380-byte account is refused. `enabled_pool_types` starts at 0 because every pool type starts disabled |
| `Pool` | 847 → 849 (`min_seats`, R7-b) → 850 (`mode`) → 869 (`capacity`, `paid_places`, `prize_table`, D-E19) | `migrate_pool` (permissionless, moves no lamports). A pre-R7-b pool gets `min_seats` = 52, the floor its players entered under; a pre-hard-mode pool gets `mode` = easy; a pre-Ladder pool is recorded as what its players entered: capacity 64, one paid place, table `[prize pool ÷ entry]`. A pool that never played and whose prize pool is not a whole number of entries gets no table; any other pool that cannot be represented is refused (`MigrationUnrepresentable`) |

### Instructions

Thirty-seven instructions, grouped by who may send them. Every privileged instruction checks its
signer against `Config`.

| Signer | Instructions |
|---|---|
| **Admin** (the Squads multisig vault) | `init_config`, `migrate_config`, `set_keeper`, `set_pool_timing`, `set_paused`, `rotate_entry_signer`, `set_settlement_signer`, `set_open_tiers`, `set_hard_open_tiers`, `set_vault_ceiling`, `set_kyc_threshold`, `set_detection_hard_block`, `set_tier_economics`, `set_treasury_policy`, `init_pool_type`, `set_pool_type_economics`, `set_pool_type_enabled`, `withdraw_platform`, `forfeit_escrow`, `lift_sanctions_hold` |
| **Keeper** | `open_pool` (takes `mode`: 0 easy, 1 hard, and `capacity`: 8, 16, 32 or 64) |
| **Settlement signer** | `reveal_pool_secret`, `commit_results`, `pay_prizes`, `pay_next_place`, `flag_entry`, `clear_flag`, `place_sanctions_hold`, `release_escrow` (reviewed path) |
| **Player** | `register` |
| **Anyone** | `fund_platform_wallet`, `commit_vrf_seed`, `create_pass_collection`, `seal_at_deadline`, `trigger_refund`, `refund`, `migrate_pool`, `release_escrow` (after the 7-day window) |

Notes on the split:

- **Only the keeper opens pools.** The opener supplies the pool's sealing key; a pool sealed to a
  key the operator's custody does not hold could never be revealed or settled. Sealing and refunding
  an existing pool stay permissionless, which is what protects players if the daemon stops.
- **Placing a sanctions hold is settlement-signed; lifting one is admin-signed.** A hold moves
  nothing and must be fast. Upholding a forfeit and clearing a list match both need the multisig.
- **The four service keys cannot enter a pool** — `register` refuses them.
- **Each pool type has its own slot** (D-E19). A pool type opens only when its tier is open for
  its mode (`set_open_tiers` / `set_hard_open_tiers`, R6) **and** the type is enabled
  (`set_pool_type_enabled`). Pools of one type run one at a time, with a 5-minute cooldown between
  them (`PoolType.next_open_at`); pools of different types run side by side. Both modes share each
  tier's price and ceiling.
- **Pool-type economics are checked for shape, never derived.** `set_pool_type_economics` refuses a
  table that does not pay exactly `capacity / 4` places, increases, or holds a zero inside the paid
  places; a minimum field not above the places paid or above the capacity; a stated prize pool that
  is not exactly `Σ table × price` at the tier's current price (`PrizePoolMismatch`); and a prize
  pool above `min_seats × price` (`PotExceedsMinimumField`). `open_pool` re-checks the prize pool
  against today's price and refuses a stale type (`PoolTypeEconomicsStale`), so a price change
  cannot open a pool whose published prizes no longer match. Enabling requires economics set
  (`PoolTypeEconomicsUnset`).

### The money model

Every lamport movement goes through `programs/blotto_cup/src/vault.rs`; nothing else may call
`system_program::transfer`. `scripts/check-standing-rules.sh` pins every call site by file and
function.

| Step | Instruction | From → to |
|---|---|---|
| Fund the treasury | `fund_platform_wallet` | anyone → treasury |
| Open a pool | `open_pool` | treasury → the pool's vault: the pool type's **fixed prize pool** plus a rent cushion, before any entry |
| Enter | `register` | player → treasury: the full entry price. Counted in `Config.platform_refundable` until the pool seals |
| Pay the paid places | `pay_prizes` | vault → every player on the committed payout list, by the pool's own table; ties split by D3-B |
| Release a held share | `release_escrow` | vault → that player (after review, or by anyone after 7 days) |
| Pay a forfeited share onward | `pay_next_place` | vault → the next eligible player(s) at the rank it passes to — **one-place pools only** since D-E19 |
| Refund an unplayed pool | `trigger_refund` | vault → treasury: the untouched prize pool (the rent cushion stays in the vault) |
| Refund an entry | `refund` | treasury → player: the full entry price |
| Operator withdrawal | `withdraw_platform` | treasury → admin destination, only above the floor |

The guarantees this adds up to:

- **Once a pool plays, its prize is only ever paid to players.** A vault's exits are exactly
  `pay_prizes`, `release_escrow`, `pay_next_place` and `trigger_refund`; the last applies only to an
  `Open` pool past its deadline below its `min_seats`, i.e. a pool that never played.
- **`forfeit_escrow` moves nothing.** It records that review upheld a flag. The share stays in the
  pool's vault until it is paid onward to players: by `pay_next_place` in a one-place pool, and in
  a multi-place pool by the field-moves-up payout, which is not built — until then the share is
  held (§10). There is no path from a prize vault to the operator, no admin escape hatch and no
  recover-stuck-funds instruction.
- **Prize pools are fixed per pool type** (`PoolType.pot_lamports`, copied onto `Pool.pot_lamports`
  at open) and never derived from entries or balances; CI fails on such arithmetic. The launch
  values are `LADDER_TABLES` in `constants.rs` times the tier price (`TIER_ENTRY_LAMPORTS`: 0.1 /
  0.5 / 0.75 / 1 / 2.5 / 5 / 7.5 SOL): 5, 10, 20 and 40 entries for 8, 16, 32 and 64 players, so
  0.5 / 1 / 2 / 4 SOL at 0.1 SOL. The 64-player column equals D-E1's tier pots
  (`TIER_POT_LAMPORTS`), which `Config` still records but no pool is funded from. Prices change by
  `set_tier_economics` and tables by `set_pool_type_economics`, for future pools only.
- **Refunds are program-held money.** The treasury's exits are `open_pool` (into a vault),
  `refund`, and `withdraw_platform`, which is refused below
  `min balance + reserve_pots × (prize pool + cushion) for every enabled pool type on an open tier with no live pool + every refundable entry`.
  The enabled pool types arrive as remaining accounts, strictly ascending by address; the program
  refuses unless every one is a genuine enabled `PoolType` (owner and discriminator) and there are
  exactly `Config.enabled_pool_types` of them (`open_pool` takes every other one), so leaving one
  out to shrink the reserve is refused (`PoolTypeListIncomplete`, `PoolTypeAccountInvalid`).
- **The top quarter is paid** (D-E19). A pool pays `paid_places` = `capacity / 4` places, place *r*
  worth `prize_table[r-1] × entry_lamports`, exact with no division. A tie group shares the combined
  worth of the positions it occupies, which can cross the paid line; the indivisible remainder
  goes to the tied player with the lowest entry index (D3-B). Pools from before the Ladder pay one
  place, worth the whole prize pool.

### Holds, escrow and the forfeited-share split

`pay_prizes` escrows a share in the vault instead of sending it when the entry is **flagged**, when
a **sanctions hold** stands against it, or when the KYC switch is on and the share is above its
threshold (the switch is at 0, off). The batch is never refused, so one held wallet cannot leave
a pool short of `Paid`.

| Held because | How it leaves the vault |
|---|---|
| Flag, not upheld | `release_escrow` to the player: by the daemon once the 12-hour review window has passed (`REVIEW_WINDOW_SECS`), by the settlement signer after review, or by anyone once 7 days have passed since `escrowed_at` |
| Flag upheld (`forfeit_escrow`, admin) | In a one-place pool: `pay_next_place`, divided **equally** among the eligible players at the rank it passes to. In a multi-place pool: **held** in the vault — `pay_next_place` refuses it (`NextPlaceUnsupported`) — until the field-moves-up payout ships (§10) |
| Sanctions hold | Nothing moves while it stands: both `release_escrow` paths refuse, and the entry cannot receive a next-place portion. Only `lift_sanctions_hold` (admin) clears it. No instruction moves a held share anywhere else |

`pay_next_place` serves only pools that pay one place (`paid_places <= 1`): every pool opened
before the Ladder. There, at first place the program computes the eligible group itself (under one
paid place, the committed payout list is the rank-1 group) and refuses arguments that disagree.
When no first-place member is eligible, the share passes to the next competition rank; each
recipient proves its rank with a Merkle proof against the committed results root. The program
cannot prove the presented group is *complete* — that is the settlement signer's assertion, stated
on the rules page, and the published bundle names the whole group so a deviation is visible. The four service keys can never
hold a seat, and `escrow.rs` has no treasury path at all.

### The class draw and the pass

Five classes (Goblin, Knight, Wizard, Dragon, Titan) drawn without replacement from an on-chain bag
of `[38, 15, 7, 3, 1]` (sum 64) stored on the pool as `class_counters`. Every pool, at every size,
starts from this same mix of 64 (D-E19), so no size is a route to a rarer character; a pool smaller
than 64 closes with passes left in it. The draw digest combines the pool's VRF seed, a slot hash
from at least five slots back, the pool, the entry index and the player key. Since R22 (2026-10-15) no oracle commits a seed — Switchboard shut down — so pools from
90 on hash 32 zero bytes in the seed's place; `commit_vrf_seed` remains, and refuses once a pool has
an entry
([`adr/adr-021-bag-without-replacement-draw.md`](adr/adr-021-bag-without-replacement-draw.md),
[`adr/adr-026-multi-source-randomness.md`](adr/adr-026-multi-source-randomness.md)). Every draw
replays from published events. The pass is a Metaplex Core asset in a collection frozen at creation;
no instruction can thaw it ([`adr/adr-027-collection-freeze-propagation.md`](adr/adr-027-collection-freeze-propagation.md)).
Class is read by nothing in scoring, payment or ranking; `check-standing-rules.sh` greps the scoring
path and `pay_prizes` for it.

## 4. The battle board (both modes)

The board is the only play surface (`app/src/battle/board/`, `app/src/battle/components/board/`).
Seven fields around a castle, five troops (one per stat). Rules from `mode.ts`, `machine.ts` and
`spread.ts`:

| Rule | Detail |
|---|---|
| Clock | **3 minutes**, one clock for the whole board, in both modes (`BOARD_CLOCK_BUDGET_MS`). It starts on the **first point placed**; the rule is shown on arrival. |
| Placing | Press and hold to pour points one at a time; a stepper gives ±1 and ±5 / ±10 / ±20. A placement never overshoots the field (easy) or the board (hard). |
| What is left | Always visible: per field in easy ("41 placed · 59 left"), one total in hard ("Left to place 312 / 700"). |
| Lock-in | Per field, both modes. A locked field is frozen and left out of the spread. Easy locks only a full field; hard cannot lock the last open field while points remain. |
| Unplaced points | On Submit or on expiry, unplaced points are spread evenly across every cell of the unlocked fields, remainder in fixed stat order. Deterministic, integer-only, never random. |
| Validation | The finished board is checked against the pool's rule before sealing, so the client cannot submit a board that breaks it. |

Two `fast-check` properties run 10,000 random event sequences per mode and assert every state and
every submitted board is legal (`machine.test.ts`, `spread.test.ts`).

**Where each mode shows.** The landing page has one entry card (`components/landing/PoolPicker.tsx`)
with an Easy / Hard toggle and a tier filter; the card shows the chosen pool's own pot, entry, seats
and deadline clock. When the hard ladder is enabled but no hard pool is open at that tier, the hard
side reads "Opens soon"; a tier the founder has not opened is listed greyed as "Not open yet". The
pool, pools-index, results and verify pages all name the mode. The read API serves `mode`
(`'easy' | 'hard'`) per pool with the pool's `capacity`, `min_seats`, `paid_places`, `prize_table`
and `prize_amounts` (lamports per place); every pool type, live or not, under `GET /pool-types`
(D-E19); and the per-tier view under `GET /tiers`, kept for older clients.

## 5. Sealing

| Mode | Payload | Bytes |
|---|---|---|
| Easy | battles (35) + salt (32) + seven `u32` timings (28) + device hash (32) | 127 |
| Hard | battles (70) + salt (32) + timings (28) + device hash (32) | 162 |

The payload is sealed to the pool's X25519 public key **in the browser, before payment**, and the
ciphertext is stored with the packet service before the packet is issued. The on-chain commitment is
`sha256(battles ‖ salt)` over the mode's own encoding, so the same numbers commit differently under
the two modes. The packet service holds a sealed box to the pool's mode, so a board of the wrong
length is refused before payment. Under the board, each timing slot carries the run millisecond of
that field's last change (0 if untouched).

**Pool-key custody.** The daemon generates each pool's X25519 keypair, publishes the public half and
`sha256(secret)` at `open_pool`, imports the secret into Turnkey and wipes its local copy. Export is
refused until the pool is `Sealed` or past its deadline: Turnkey policy gates *who* may export and
the adapter's chain-state check gates *when* (`backend/sealing/src/custody-turnkey.ts`). The operator
generates the key; the rules copy says so.

**The program never sees a board.** It receives only the hash, so it cannot enforce either placing
rule. The two enforcement points are the client at submission and the scoring engine at reveal.

## 6. Scoring and verification

At settlement the daemon exports the secret, publishes it on-chain with `reveal_pool_secret`
(hash-checked against the commitment made at open), decrypts every payload under `Pool.mode`, and
checks each against its committed hash. A missing ciphertext, failed decryption, hash mismatch,
wrong-length payload or a board that breaks the pool's rule is scored **all losses** by the
published rule in `backend/scoring/src/missing.ts`, and its status is published. One bad entry
never halts a pool.

- **Comparison** (`backend/scoring/src/engine.ts`, mode-blind): battle *k* against every other
  entry's battle *k*; a stat to the larger number (equal: neither); a battle to whoever wins three
  or more stats, otherwise a draw.
- **Score** in integer half-points — win 2, draw 1, loss 0. No float touches a score or a lamport.
- **Ranking**: score, then stats won. Players equal on both share a competition rank. Entry order
  never decides rank; it only places a split's indivisible remainder and the published leaf order.
- **Prizes** (`assignPrizes`): over the pool's **own** table, read from the chain
  (`prizeTableFromChain(Pool.prize_table, Pool.paid_places)`), never the launch table. A tie group
  shares the positions it occupies; positions past the table are worth zero.
- **Results tree**: one leaf per seat (player ‖ rank ‖ amount), domain-separated sha256. The root
  and the payout list are committed on-chain by `commit_results`, which refuses a list that is
  empty, unsorted, duplicated or out of range, holds a zero amount (`PayoutZero`) or one above the
  pool's first prize, `prize_table[0] × entry_lamports` (`PayoutAboveFirstPrize`), or does not sum
  to exactly the prize pool. The program does not rank (D-E15 as narrowed by D-E19): who is paid
  what is checked by recomputation.
- **The bundle** (version 4: adds the pool's `capacity`, `min_seats`, `paid_places` and
  `prize_table`; version 3 named `mode`; a version-2 bundle reads as easy, and a version-3 bundle as
  64 players with one place worth the whole prize pool) is published on Irys: the secret, every
  board, salts, commitments, statuses, results, payouts and the root. Timings and the device hash
  are never published.

The same scoring module runs in the crank and the browser. The verify page fetches the bundle,
reads the revealed secret and committed root from RPC, re-scores, rebuilds the tree and compares
roots, with the wallet disconnected and no operator service involved. Scoring and hashing vectors are
generated by a Python oracle (`backend/scoring/fixtures/gen_vectors.py`) that covers both modes.

## 7. Detection and review

**Detection is advisory.** The daemon runs five signals on every settled pool
(`backend/detection/src/signals.ts`: allocation entropy, timing profile, duplicate sets, device/IP
correlation, population score) and persists the report. It never flags anything itself; a CI
standing rule fails if the daemon returns a block to the crank. The report names players before a
human has looked, so it is readable only with the operator token.

**Review is human and signed.** `config/reviewers.json` lists **two** reviewer keys. A decision
(flag, clear, release, forfeit) is signed by a registry member over a canonical message and appended
to a public, append-only log (`GET /decisions`); every row re-verifies from the log alone. The
settlement key executes flag/clear/release; an upheld forfeit is executed by the admin multisig.

| Process | Rule |
|---|---|
| Appeal | The affected wallet lodges within 7 days of an upheld flag, signing its own canonical message. It is decided by a registry member **other than** the reviewer who upheld the flag (`backend/detection/src/appeals.ts`). The form appears on the results page for that wallet only. |
| Complaint | Anyone may lodge one (`POST /complaints`), optionally wallet-signed; the complainant reads their own thread by reference. Answers are appended, never edited, and reviewer-signed, so the answer is checkably by someone other than whoever made the original decision. |
| Sanctions | The packet service screens every entrant and refuses the entry if screening cannot answer. The crank screens every wallet in the payout list before `commit_results`: a list match places an on-chain hold; a screening that cannot answer places no hold — the crank refuses to commit and screens again on the next tick (`backend/reveal/src/crank.ts`). A hold is not a flag and carries no finding about play. |

## 8. Data held

The chain is the only source of truth; Postgres is a projection rebuilt from RPC; the Irys bundle is
published evidence; the browser keeps conveniences only. What personal data is held, where, who can
read it and for how long is canonical in
[`../compliance/DATA-INVENTORY.md`](../compliance/DATA-INVENTORY.md).

| Where | What |
|---|---|
| Chain | `Config`, `PoolType`, `Pool`, `Entry`, vaults, treasury, passes; events in transaction logs, from which every off-chain number is replayed |
| Postgres — indexer | `events`, `pools`, `pool_types`, `entries`, `results`, `payouts`, `rankings`, `profiles`, `player_history`, `tier_status`, `bundles`, `published_bundles` |
| Postgres — packet | `attestations`, `sealed_entries` (read by the daemon at settlement, served to nobody), `notify_optin`, `notify_pool_optin`, `sanctions_refusals` |
| Postgres — daemon | `published_pool_keys` (public halves only), `detection_reports` |
| Postgres — review | `review_decisions` (decisions and appeals), `complaints` |
| Turnkey | Each pool's sealing secret (export-locked) and the entry signer |
| Irys | One bundle per settled pool |

No IP address is written to a column or log line in full; the salt leaves the device only inside the
sealed box.

## 9. CI

`ci-fast` runs on every change: `rust` (format, lint, unit tests, a 10,000-case vault fuzz),
`node` (every backend package's typecheck and tests, the offline twenty-pool rehearsal, the app's
lint, typecheck, tests and production build), `postgres` (migrations against a real database),
`journey` (Playwright at 375 and 1280 px), `gitleaks`, and the **standing-rules** lane — fifteen
self-testing checks, in order:

| # | Check | Asserts |
|---|---|---|
| 1 | `scripts/check-language.sh` | The forbidden-word list |
| 2 | `scripts/check-standing-rules.sh` | The exact vault and treasury exit sets, no pot arithmetic, class out of the scoring path, detection never blocks |
| 3 | `scripts/check-territories.ts` | The territory schedule is enforceable |
| 4 | `scripts/check-operator-identity.ts` | The operator identity behind the terms and privacy notice is well formed |
| 5 | `scripts/check-blocked-wallets.ts` | Every blocked wallet has a recorded ground |
| 6 | `scripts/check-published-numbers.ts` | Player-facing copy carries no superseded constant |
| 7 | `scripts/check-dead-files.ts` | Every app file is reachable from a route |
| 8 | `scripts/sim/fill-replay.ts --self-test` | The fill simulation still models the seal/refund rule |
| 9 | `scripts/drain-verdict.ts --self-test` | The upgrade pre-flight still refuses while a pool is Open |
| 10 | `scripts/check-env-examples.sh` | Every env var a service reads is documented |
| 11 | `scripts/check-container-user.sh` | No service image runs as root |
| 12 | `scripts/check-fixtures.sh` | The Python oracles reproduce their vectors |
| 13 | `scripts/check-mirrors.py` | Rust and TypeScript constants agree |
| 14 | `scripts/ci-gate.sh --self-test` | The deploy gate still judges correctly |
| 15 | `scripts/deploy-devnet.sh --self-test` | The program deploy still reads a cluster |

`ci-fast` has no path filter, so a change under `mobile/` (the Android shell, D-E18) runs it in
full; no lane builds the package or opens an emulator ([`../guide/MOBILE.md` §7](../guide/MOBILE.md#7-ci)).

Other workflows: `on-chain` (`anchor build` and the LiteSVM integration suite, including
`hard_mode.rs`, on program changes), `deployed-drift` (daily and on program changes: simulates every
instruction against the live program), `backend-watch` (scheduled every 15 minutes, run hours apart
in practice: probes health, starts a stopped machine, and is the watcher's dead-man switch),
`diagnose` (started by the watcher: Claude's read-only diagnosis of an alert, posted to Telegram),
`skill-evidence` (nightly reproduction of the generated reports), `security-sweep`
(nightly dependency advisories and the licence policy, blocking on anything not triaged), `stop-the-line` (opens an issue when `main` goes red), and the
manual `deploy-backend` and `deploy-watch`. The live alarm is not a workflow: GitHub's scheduler is
too late for it, so the watcher runs on Fly. Running all of this locally:
[`../guide/GETTING-STARTED.md`](../guide/GETTING-STARTED.md). Results:
[`../testing/TESTING-REPORT.md`](../testing/TESTING-REPORT.md).

## 10. Not built, and known limitations

| Item | State |
|---|---|
| Mainnet | Not deployed. The upgrade authority is a single devnet key and the multisig threshold is one; both are disclosed in `config/custody.json`. |
| The admin multisig | The devnet admin is a Squads v3 multisig whose web interface has been retired; admin transactions are built and proposed with `scripts/squads-v3.ts`. The program has no `set_admin`, so the admin named at `init_config` is permanent: a mainnet deployment must be initialised with a Squads v4 multisig as admin. |
| Forfeits in multi-place pools | The field-moves-up payout (D-E19) is not built. A share forfeited after an upheld flag in a pool that pays more than one place stays held in that pool's vault — never paid wrongly, never to the operator — and `pay_next_place` refuses it (`NextPlaceUnsupported`). It is paid when the payout ships in its own program upgrade. |
| Who is paid what, on chain | The program does not rank (D-E15 as narrowed by D-E19). `commit_results` bounds every amount by the pool's first prize and checks the exact total; a list that paid the right amounts to the wrong seats would land, and recomputation from the published bundle is what catches it. |
| Pool key generation | Each pool's sealing key is generated in the operator's process, imported into the custody service and wiped locally (Turnkey offers no X25519 curve). For that instant the process holds the secret, so sealing rests on the custody policy. See [`../../backend/sealing/README.md`](../../backend/sealing/README.md). |
| Settlement key custody | The settlement signer (also the keeper on devnet) is a local keypair loaded by the daemon, not co-signed through a custody service. |
| Class-draw replay in the app | `backend/class-digest` implements the replay and is pinned to the Python vectors, but no page imports it. A player can replay their class from published events (`PoolVrfSeeded.vrf_seed`, each `EntryRegistered`'s index and slot hash, pool and player); there is no page that does it for them. |
| Timing signal under the board | The timing-profile signal was designed for per-screen times. Under the board the slots carry each field's last-change time, so the signal's meaning has shifted; its thresholds are unchanged. |
| Detection thresholds in hard mode | Unchanged from easy; not tuned for hard-mode boards. |
| Daemon fee balance | The daemon refuses to start below 0.05 SOL in the settlement signer and reports the balance on `/health`, but nothing halts a running daemon as the balance falls. |
| Cost instrumentation | The daemon does not measure what a pool cycle costs. |
| Live devnet rehearsal | The offline twenty-pool rehearsal runs in CI; a multi-pool live devnet trial is run by hand from `battle-test/`, not by CI. |
| Territory schedule | `config/territories.json` blocks at country level. Sub-national codes cannot be enforced (the geo source returns a subdivision name, not an ISO code) and the schedule refuses them. The sanctioned-jurisdictions country list is not yet in the schedule; wallet-level sanctions screening applies meanwhile. See [`../../config/territories.README.md`](../../config/territories.README.md). |
| Where a confirmed sanctions match's share finally goes | Not defined: the share stays in the vault under the hold. Any future answer will not be a path to the operator. |
| Board share image | There is no board-native "share your seven" image after a pool closes. |
| The Android package | The app-side half of the mobile channel is built (D-E18), and the package has been generated, signed and taken through sign-in and a devnet entry on an emulator ([`../testing/MOBILE-E2E.md`](../testing/MOBILE-E2E.md)); no settled pool has yet been verified from the phone. Nothing is submitted to the Solana dApp Store, and no CI lane exercises a real mobile wallet. Whether the Seeker's built-in wallet can sign an entry (rather than sign-and-send only) is unverified. [`../guide/MOBILE.md` §9](../guide/MOBILE.md#9-known-limitations-and-open-questions). |
