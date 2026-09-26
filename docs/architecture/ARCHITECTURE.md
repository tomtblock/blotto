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

A pool has **64 seats** and plays with **at least 40**. It seals when the 64th seat fills, or when
its **12-hour** deadline passes with 40 or more seated. Below 40 at the deadline, every entry is
refunded in full. No operator key decides which of those happens.

After sealing, the pool's decryption secret is published on-chain, every board becomes readable,
the scoring is re-run by anyone who wants to, and the player ranked first is paid the whole fixed
prize pool — funded from the treasury before entries opened, the same size whatever the field.

Scoring is identical in both modes: a stat is won by the larger number, a battle by winning three
of five stats (otherwise a draw), and every player is compared with every other player.

## 2. The pieces

```
                 browser (Next.js app)
                   │        │            │
       packet ◄────┘        │            └────► indexer read API
     (entry gate)           │                    (GET /pools, /tiers, /treasury …)
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

Five deployable units — four backend services and the frontend. Topology, ports and health checks
in detail: [`../guide/HOSTING.md`](../guide/HOSTING.md).

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
permanent publication (Irys), randomness (Switchboard On-Demand), the admin multisig (Squads), IP
geolocation (IPLocate), sanctions lists (OFAC SDN, Chainalysis, OpenSanctions), Postgres. The
vendor map and configuration: [`../guide/HOSTING.md`](../guide/HOSTING.md).

### Service routes

| Service | Public | Restricted |
|---|---|---|
| Indexer read API | `GET /health`, `/time`, `/tiers`, `/pools` (`?state=`, `?tier=`, `?mode=`), `/pools/:pool` and its `/entries`, `/results`, `/payouts`, `/leaderboard`, `/verify-record`; `/treasury`; `/history/summary`, `/history/persistence`, `/history/entries`; `/profiles/:player`, `/profiles/:player/history` | Webhook ingest and the daemon's `POST /bundles` announce (shared secret) |
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

Every PDA type has its own seed prefix. Layouts are pinned byte for byte by
`account_layouts_are_pinned` in `state.rs`.

| PDA | Seeds | Space (bytes) | Holds |
|---|---|---|---|
| `Config` | `["config"]` | 603 | The four service keys (admin, entry signer, settlement signer, keeper); per-tier prices, pots and ceilings; the easy and hard ladders' enable switches, live-pool slots and cooldown stamps; pause, KYC and detection switches; treasury book-keeping (`platform_reserved`, `platform_refundable`) and policy; fill deadline and cooldown. Singleton. |
| `Pool` | `["pool", id]` | 850 | One competition: tier, mode, price, pot, deadline, `min_seats`, state, the class bag, sealing commitments, the results root and the committed payout list. |
| `Entry` | `["entry", pool, player]` | 228 | One seat: player, index, battles hash, class, pass, flags, escrow, sanctions hold, and the next-place split book-keeping. Keyed by player, so one entry per wallet per pool is structural. |
| Prize vault | `["vault", id]` | 0 | Zero-data, system-owned. Holds that pool's pot plus a rent cushion. |
| Treasury | `["platform"]` | 0 | Zero-data, system-owned. Receives every entry payment and funds every pot. |
| Pass collection | `["pass_collection", pool]` | — | The Metaplex Core collection whose frozen state every pass inherits. |

Pool states: `Open → Sealed → Scored → Paid`, or `Open → Refunding → Closed` (a pool with no
entrants goes straight to `Closed`).

**Growth by appending.** External readers hold byte offsets into these accounts, and Anchor refuses
an account shorter than its current layout, so fields are only ever appended and each growth has a
one-shot migration:

| Account | Sizes (with discriminator) | Migration |
|---|---|---|
| `Config` | 380 → 484 (keeper, timings, cooldowns) → 603 (hard ladder) | `migrate_config` (admin); now V2 → V3 only, a V1 account is refused |
| `Pool` | 847 → 849 (`min_seats`, R7-b) → 850 (`mode`) | `migrate_pool` (permissionless, moves no lamports). A pre-R7-b pool gets `min_seats` = 52, the floor its players entered under, and `mode` = easy; a pre-hard-mode pool gets `mode` = easy |

### Instructions

Thirty-four instructions, grouped by who may send them. Every privileged instruction checks its
signer against `Config`.

| Signer | Instructions |
|---|---|
| **Admin** (the Squads multisig vault) | `init_config`, `migrate_config`, `set_keeper`, `set_pool_timing`, `set_paused`, `rotate_entry_signer`, `set_settlement_signer`, `set_open_tiers`, `set_hard_open_tiers`, `set_vault_ceiling`, `set_kyc_threshold`, `set_detection_hard_block`, `set_tier_economics`, `set_treasury_policy`, `withdraw_platform`, `forfeit_escrow`, `lift_sanctions_hold` |
| **Keeper** | `open_pool` (takes `mode`: 0 easy, 1 hard) |
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
- **Each (mode, tier) has its own slot.** `set_open_tiers` and `set_hard_open_tiers` are separate
  switches; the two ladders share each tier's price, pot and ceiling. Pools in one (mode, tier)
  run one at a time, with a 5-minute cooldown between them.

### The money model

Every lamport movement goes through `programs/blotto_cup/src/vault.rs`; nothing else may call
`system_program::transfer`. `scripts/check-standing-rules.sh` pins every call site by file and
function.

| Step | Instruction | From → to |
|---|---|---|
| Fund the treasury | `fund_platform_wallet` | anyone → treasury |
| Open a pool | `open_pool` | treasury → the pool's vault: the tier's **fixed pot** plus a rent cushion, before any entry |
| Enter | `register` | player → treasury: the full entry price. Counted in `Config.platform_refundable` until the pool seals |
| Pay the winner | `pay_prizes` | vault → rank-1 player(s); a tie for first splits the pot |
| Release a held share | `release_escrow` | vault → that player (after review, or by anyone after 7 days) |
| Pay a forfeited share onward | `pay_next_place` | vault → the next eligible player(s) at the rank it passes to |
| Refund an unplayed pool | `trigger_refund` | vault → treasury: the untouched pot (the rent cushion stays in the vault) |
| Refund an entry | `refund` | treasury → player: the full entry price |
| Operator withdrawal | `withdraw_platform` | treasury → admin destination, only above the floor |

The guarantees this adds up to:

- **Once a pool plays, its prize is only ever paid to players.** A vault's exits are exactly
  `pay_prizes`, `release_escrow`, `pay_next_place` and `trigger_refund`; the last applies only to an
  `Open` pool past its deadline below its `min_seats`, i.e. a pool that never played.
- **`forfeit_escrow` moves nothing.** It records that review upheld a flag. The share stays in the
  pool's vault until `pay_next_place` divides it among eligible players. There is no path from a
  prize vault to the operator, no admin escape hatch and no recover-stuck-funds instruction.
- **Pots are fixed per tier** (`TIER_POT_LAMPORTS` in `constants.rs`: 4 / 20 / 30 / 40 / 100 /
  200 / 300 SOL against entry prices of 0.1 / 0.5 / 0.75 / 1 / 2.5 / 5 / 7.5 SOL) and never
  derived from entries or balances; CI fails on such arithmetic. Prices and pots can be changed
  for future pools by `set_tier_economics`; an open pool keeps what it opened with.
- **Refunds are program-held money.** The treasury's exits are `open_pool` (into a vault),
  `refund`, and `withdraw_platform`, which is refused below
  `min balance + one reserved pot (plus cushion) per idle enabled tier, per ladder + every refundable entry`.
- **One paid place** (`PAID_RANKS` = 1). Players tied for first split the pot equally; the
  indivisible remainder goes to the tied player with the lowest entry index.

### Holds, escrow and the forfeited-share split

`pay_prizes` escrows a share in the vault instead of sending it when the entry is **flagged**, when
a **sanctions hold** stands against it, or when the KYC switch is on and the share is above its
threshold (the switch is at 0, off). The batch is never refused, so one held wallet cannot leave
a pool short of `Paid`.

| Held because | How it leaves the vault |
|---|---|
| Flag, not upheld | `release_escrow` to the player: by the daemon once the 12-hour review window has passed (`REVIEW_WINDOW_SECS`), by the settlement signer after review, or by anyone once 7 days have passed since `escrowed_at` |
| Flag upheld (`forfeit_escrow`, admin) | `pay_next_place`, divided **equally** among the eligible players at the rank it passes to |
| Sanctions hold | Nothing moves while it stands: both `release_escrow` paths refuse, and the entry cannot receive a next-place portion. Only `lift_sanctions_hold` (admin) clears it. No instruction moves a held share anywhere else |

At first place the program computes the eligible group itself (under one paid place, the
committed payout list is the rank-1 group) and refuses arguments that disagree. When no first-place
member is eligible, the share passes to the next competition rank; each recipient proves its rank
with a Merkle proof against the committed results root. The program cannot prove the presented
group is *complete* — that is the settlement signer's assertion, stated on the rules page, and the
published bundle names the whole group so a deviation is visible. The four service keys can never
hold a seat, and `escrow.rs` has no treasury path at all.

### The class draw and the pass

Five classes (Goblin, Knight, Wizard, Dragon, Titan) drawn without replacement from an on-chain bag
of `[38, 15, 7, 3, 1]` (sum 64) stored on the pool as `class_counters`. The draw digest combines the
pool's Switchboard seed (`commit_vrf_seed`, required before the first entry), a slot hash from at
least five slots back, the pool, the entry index and the player key
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

**Where each mode shows.** The landing page shows one card per open pool — easy on the left, hard
on the right — each with its own seat ring, pot, entry price and deadline clock. When the hard ladder
is enabled but no hard pool is open, the right card reads "Opens soon"; when it is not enabled, the
page shows one card. The pool, pools-index, results and verify pages all name the mode. The read
API serves `mode` (`'easy' | 'hard'`) per pool and the hard ladder per tier under `GET /tiers`.

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
- **Results tree**: one leaf per seat (player ‖ rank ‖ amount), domain-separated sha256. The root
  and the payout list are committed on-chain by `commit_results`, which refuses a list that is
  unsorted, duplicated, out of range or does not sum to the pot.
- **The bundle** (version 3, names `mode`; a version-2 bundle reads as easy) is published on Irys:
  the secret, every board, salts, commitments, statuses, results, payouts and the root. Timings and
  the device hash are never published.

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
| Chain | `Config`, `Pool`, `Entry`, vaults, treasury, passes; events in transaction logs, from which every off-chain number is replayed |
| Postgres — indexer | `events`, `pools`, `entries`, `results`, `payouts`, `rankings`, `profiles`, `player_history`, `tier_status`, `bundles`, `published_bundles` |
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

Other workflows: `on-chain` (`anchor build` and the LiteSVM integration suite, including
`hard_mode.rs`, on program changes), `deployed-drift` (daily and on program changes: simulates every
instruction against the live program), `backend-watch` (every 15 minutes: probes health, restarts a
stopped machine), `skill-evidence` (nightly reproduction of the generated reports), `security-sweep`
(nightly dependency advisories), `stop-the-line` (opens an issue when `main` goes red), and the
manual `deploy-backend`. Running all of this locally:
[`../guide/GETTING-STARTED.md`](../guide/GETTING-STARTED.md). Results:
[`../testing/TESTING-REPORT.md`](../testing/TESTING-REPORT.md).

## 10. Not built, and known limitations

| Item | State |
|---|---|
| Mainnet | Not deployed. The upgrade authority is a single devnet key and the multisig threshold is one; both are disclosed in `config/custody.json`. |
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
