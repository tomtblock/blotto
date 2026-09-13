# Pre-flight — founder instruction 2026-09-12 (launch gating, territory block, fill rule)

**Produced:** 2026-09-13, before any code, as §1 of the founder's master prompt of 2026-09-12.
**Scope:** the four-PR series — tier gate · territory block · the 40-at-12h fill rule on-chain ·
the same rule off-chain.
**Status of this document:** a survey, not a decision record. The decisions it provoked are in
`BUILD-ROADMAP_v1.0.md` §1.2; this file records what the branch and the chain actually held on the
morning of the change, so that later readers can tell what was already true from what this series
made true.

---

## 0. The headline: three of the prompt's items were already built

The master prompt was written against a reading of the code from before the founder rulings of
2026-09-06 (D-E1 … D-E4) and 2026-09-07 (D-E6). Verified against `HEAD` = `ab392ea` and against
devnet at slot 497520124:

| Master prompt §4.2 asks for | State at `HEAD` | Action |
|---|---|---|
| `FILL_DEADLINE_SECS`: `72*3600` → `12*3600` | `DEFAULT_FILL_DEADLINE_SECS: i64 = 12 * 60 * 60` — `constants.rs:25`. Live value `Config.fill_deadline_seconds` reads **43200** on devnet | **None.** Already 12 h (D-E6) |
| Add `MIN_FILL: u16 = 40` | `MIN_SEATS: u16 = 52` — `constants.rs:61` (D-E4) | A value change, 52 → 40 |
| New permissionless instruction `seal_pool` | `seal_at_deadline` — `seal.rs:30-67`, permissionless by design and by test | **None.** The identifier `seal_pool` is also already taken by the shared internal sealer, `register.rs:301` |
| `trigger_refund` gate → `entrants < min_fill` | `require!(pool.entrants < MIN_SEATS, ErrorCode::FieldReached)` — `refund.rs:73` | Reads the per-pool copy instead of the constant |
| New errors `BelowMinFill` / `AboveMinFill` | `FieldBelowMinimum` (6051) and `FieldReached` (6052) already carry exactly these two meanings | **None.** The enum is append-only with numbers pinned by `error.rs:201-231`; a synonym for an existing variant would be a defect |

Two further items in the prompt describe superseded code and are recorded here so the diff is not
mistaken for an oversight:

- **C-1** asks that the assertion `pot == price/10*8*64` be deleted. The assertion at `HEAD` is
  `pot == price/8*5*64` (`prize_math.rs:139-143`) — 62.5%, ratified D-E1, not the 80% of the
  pre-D-E1 model. Same intent, different expression; it is replaced by the `MIN_SEATS × price` pin
  that C-1 asks for.
- **C-2** describes `PAID_RANKS = 16` and asks whether to keep 16. `PAID_RANKS = 1` since D-E2
  (2026-09-06) — one paid place, the whole pot to the winner. Ticking C-2 would have reversed a
  ratified decision, so it was put back to the founder and **declined** on 2026-09-13.

### The one blocker

At every tier the pot equals exactly forty entries (`pot = price / 8 * 5 * 64 = price × 40`, D-E1),
and the program requires the minimum field to **exceed** the pot — as a test at
`prize_math.rs:145-148` and at runtime in `set_tier_economics`:

```rust
// treasury.rs:192-197
let min_field_entries = (MIN_SEATS as u64).checked_mul(price_lamports).ok_or(ErrorCode::Overflow)?;
require!(pot_lamports < min_field_entries, ErrorCode::PotExceedsMinimumField);
```

At `MIN_SEATS = 40` this reads `40 × price < 40 × price`, which is false at every tier: the suite
fails and the on-chain instruction refuses the economics. Founder ruling of 2026-09-13: the pot is
pre-funded from the treasury before any pass sells (D-A1), so a pool's ability to pay never depended
on its own entries, and break-even at the floor is accepted. The comparison becomes `<=`, which
admits exactly break-even and still refuses any pot larger than the minimum field's intake.

---

## 1. On-chain `Config` — devnet, read 2026-09-13

Program `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`, config PDA
`6Q3HReRVp4fND7wCuYSpRDPbz5KsQR7cbEwApVUhPzDa`, 484 bytes (post-migration; `Config::SPACE` = 484,
pre-migration V1 = 380).

| Field | On chain | Source constant | Agrees |
|---|---|---|---|
| `paused` | `false` | — | — |
| **`open_tiers`** | **`[1, 0, 0, 0, 0, 0, 0]`** | `init_config` seeds `[true, false × 6]` (`admin.rs:84-86`) | yes |
| `fill_deadline_seconds` | `43200` (12 h) | `DEFAULT_FILL_DEADLINE_SECS` | yes |
| `next_pool_id` | `10` — pools 1…9 exist | — | — |

Tier economics, live values against the ratified D-E1 table:

| Tier | Price (SOL) | Pot on chain (SOL) | Pot ratified (SOL) | Agrees |
|---|---|---|---|---|
| 0 | 0.10 | 4.00 | 4 | **yes** |
| 1 | 0.50 | 25.60 | 20 | no |
| 2 | 0.75 | 38.40 | 30 | no |
| 3 | 1.00 | 51.20 | 40 | no |
| 4 | 2.50 | 128.00 | 100 | no |
| 5 | 5.00 | 256.00 | 200 | no |
| 6 | 7.50 | 384.00 | 300 | no |

Prices are correct at every tier. Six pots still carry the pre-D-E1 table; `set_tier_economics` was
executed for tier 0 only, during the sitting of 2026-09-07. Six Squads proposals are prepared and
unexecuted — `devnet-rehearsal-runbook.md:1185-1240`.

**Why this matters to PR-1.** `open_tiers` is the only thing standing between the live config and a
pool published at a wrong prize: `open_pool` funds the vault from the treasury at whatever the config
says, and a prize once published cannot be un-published. The tier gate is therefore not a formality
to be verified — it is a live guard, and PR-1 adds a refusal to `set-open-tiers` for any tier whose
on-chain pot disagrees with `TIER_POT_LAMPORTS`.

**Mainnet:** not deployed. No mainnet config exists to read.

---

## 2. The tier-0 pot, everywhere it appears

Expected value **4 SOL** = `4_000_000_000` lamports (D-E1). Searched for `5_120_000_000`, `5120000000`
and `5.12`.

**Source code is uniformly 4 SOL.** No file in `programs/`, `backend/src`, `app/src`, `tests/` or
`scripts/` carries a 5.12 pot. The authoritative definitions:

| File:line | Value |
|---|---|
| `programs/blotto_cup/src/constants.rs:99` | `TIER_POT_LAMPORTS[0] = 4_000_000_000` |
| `programs/blotto_cup/src/prize_math.rs:113` | `assert_eq!(pot, 4_000_000_000, "tier-0 pot must be 4 SOL (D-E1)")` |
| `backend/scoring/src/prizes.ts:105` | `4_000_000_000n` |
| `backend/scoring/fixtures/gen_vectors.py:64` | the Python oracle's table |
| `tests/litesvm/src/lib.rs:119` | `TIER_POTS[0]` |
| `app/src/data/scenarios.ts:81` | `TIER0_POT = '4000000000'` |
| `app/src/app/page.tsx:38` | the launch-tier doc comment |

**`5_120_000_000` appears nowhere.** The literal `5120000000` occurs exactly once, as a fixture for
devnet pool 1, which was opened before the tier table changed and copied the old pot at open:

- `backend/indexer/test/registration.spec.ts:42-49` — labelled in place as the old value.

Prose still stating 5.12, all describing history or the legacy devnet pool, none of it a live
constant: `docs/PID_Blotto-Cup_v0.5.md:22` (founder-owned; the divergence is listed in
`docs/INDEX.md`), `docs/phase-reports/step-tiers-and-ties.md:45`, `docs/go-live-devnet.md:31-32,190`,
and eleven lines in `docs/devnet-rehearsal-runbook.md` (`:585`, `:623`, `:642-649`, `:690`, `:840`,
`:849`, `:904`, `:917`, `:934`, `:1195`) of which `:585` is the only one not already marked as
superseded in its own paragraph.

**Action for this series:** none in code — the pot is already 4 SOL everywhere it executes. One
uncorrected prose line (`devnet-rehearsal-runbook.md:585`) is fixed in PR-4 with the other doc work.

---

## 3. Code paths by symbol

### 3.1 `DEFAULT_FILL_DEADLINE_SECS` (the prompt's `FILL_DEADLINE_SECS`)

Definition `constants.rs:25`. The live value is `Config.fill_deadline_seconds`; the constant only
seeds it and anchors the tests.

Writers: `admin.rs:81` (`init_config`) · `admin.rs:185-196` (`set_pool_timing`, the only mutator,
bounded solely by `> 0` — audit finding B-11) · `migrate.rs:135,148`.
Readers: `open_pool.rs:183-185` — the single place a pool's deadline is computed.
Mirrors: `backend/scoring/src/prizes.ts:30-38` · `backend/reveal/src/chain.ts:10,851` ·
`app/src/app/rules/rules.config.ts:17,55` · `app/src/app/pools/[pool]/page.tsx:12,30` ·
`backend/_shared/src/config-account.ts:71,91,111,163` (byte offset 412).
Pinned by: `scripts/check-mirrors.py:67-68` · `backend/scoring/test/mirror.spec.ts:91-92`.

### 3.2 `CAPACITY` (64) and `MIN_SEATS` (52)

`CAPACITY` is defined twice in Rust — `constants.rs:8` and `crates/blotto-randomness/src/lib.rs:57` —
with equality asserted at `constants.rs:197-201`; plus `backend/scoring/src/prizes.ts:17` and two
Python oracles. There is no `MAX_PLAYERS` or `POOL_CAPACITY`.

Reads that bear on the fill rule: `register.rs:160` (entry gate) · `register.rs:277` (**seal path 1**:
the 64th entry) · `seal.rs:63` (defence in depth) · `open_pool.rs:134` (the D2 ceiling, `price × 64`)
· `state.rs:264,295` (the 64-wide payout array and the `LEN` term) · `reveal_commit.rs:98`.
One literal `64` where the constant belongs: **`pay_prizes.rs:110`** — `require!(seat < 64, InvalidRank)`.
Same in the fake chain: `backend/reveal/src/chain.ts:749`.

`MIN_SEATS` definition `constants.rs:61`. Reads: `seal.rs:60` · `refund.rs:73` · `treasury.rs:192-197`
· `prize_math.rs:146` · `backend/reveal/src/daemon.ts:70,279` · `backend/reveal/src/chain.ts:11,748,759`
· `backend/indexer/src/treasury-report.ts:46,269` · `app/src/app/rules/rules.config.ts:18,54` ·
`app/src/app/pools/[pool]/page.tsx:13,29,129` · `app/src/app/pools/page.tsx:9,104` ·
`app/src/app/page.tsx:17,310` · `app/src/components/pools/PoolStateBlot.tsx:24,42` (`FILLING_FROM`).
Pinned by `scripts/check-mirrors.py:64-65` and `backend/scoring/test/mirror.spec.ts:88-89`.

**`MIN_SEATS` is a compile-time constant. It is not a `Config` field and there is no per-pool copy.**
That is the gap PR-3 closes — see §5.

### 3.3 `PoolState` and the transition table

Definition `state.rs:176-191`; wire encoding `u8`, 0 = Open … 5 = Closed.

| From | To | Instruction | Guard |
|---|---|---|---|
| — | Open | `open_pool` | `open_pool.rs:99-162`; write `:194` |
| Open | Sealed | `register` (the 64th) | `entrants == CAPACITY` — `register.rs:277` |
| Open | Sealed | `seal_at_deadline` | `now > fill_deadline` ∧ `entrants >= MIN_SEATS` ∧ `entrants < CAPACITY` — `seal.rs:55-66` |
| Open | Refunding | `trigger_refund` | `now > fill_deadline` ∧ `entrants < MIN_SEATS` ∧ `entrants > 0` — `refund.rs:71-81` |
| Open | Closed | `trigger_refund` | same, with `entrants == 0` — `refund.rs:77-79` |
| Sealed | Scored | `commit_results` | `reveal_commit.rs:93-129` |
| Scored | Paid | `pay_prizes` | `pay_prizes.rs:86,172-176` |
| Refunding | Closed | `refund` (the last) | `refund.rs:193-194` |

Terminal: Paid and Closed (`daemon.ts:208`). The tier slot frees only there (`instructions/slot.rs:19-38`).
TypeScript union `backend/reveal/src/chain.ts:24` and `app/src/data/types.ts:19`; the fake chain
mirrors every guard at `chain.ts:427,745-785,909`.

### 3.4 `Pool.fill_deadline` and `Pool.entrants`

Struct `state.rs:206-276`. `Pool::LEN = 839`, `SPACE = 847`, both pinned at `state.rs:538-539`, with
an explicit rule at `state.rs:523-535` that **no field may be inserted** — three readers address the
account by fixed byte offsets (`entrants` @33, `fill_deadline` @43, `state` @51):
`tests/litesvm/src/lib.rs:776,801` · `backend/reveal/src/chain-web3.ts:244,265,274` ·
`scripts/admin.ts:363,385-388`.

`fill_deadline` reads: `open_pool.rs:183-193,223` (write + emit) · `register.rs:157` ·
`seal.rs:59` · `refund.rs:72` · `reveal_commit.rs:56` · `daemon.ts:278` · **`backend/reveal/src/main.ts:336`**
(the sealing-key export policy) · `projection.ts:92` · `read-api.ts:140` · two countdowns in the app.

`entrants` reads: `register.rs:160,207,261,277,304` · `seal.rs:60,63` · `refund.rs:73,77,126,193` ·
`reveal_commit.rs:101` · `daemon.ts:279` · `projection.ts:195,395,500` · the app's progress ring and
pool rows.

### 3.5 The territory schedule

`config/territories.json` at `HEAD`: `version 2`, `posture "block-list"`, `allowed []`,
`blocked ["BE","AU"]`, `updated "2026-08-28"`.

Loader and validator: `backend/packet/src/territories.ts` — `parseTerritorySchedule` (`:52-96`,
throws on any malformation), `loadTerritorySchedule` (`:98`), `territoryAllowed` (`:108-120`),
`DEFAULT_TERRITORY_SCHEDULE` (`:124-130`). Code regexes: `COUNTRY = /^[A-Z]{2}$/` (`:47`),
`COUNTRY_OR_REGION = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/` (`:48`) — the schema **already accepts
sub-national codes**.

Call site: `backend/packet/src/main.ts:210-212`, repo-root-relative, overridable by
`BLOTTO_TERRITORIES_PATH`. Injected at `main.ts:258`. Copied into the image by
`deploy/docker/Dockerfile.packet:25`.

Decision path: `service.ts:292-376` (`issuePacket`) evaluates territory, region-enforceability, VPN,
sanctions screening and age attestation, then returns one shape for every refusal —
`GENERIC_REJECTION = { ok: false, error: 'entry_unavailable' }` (`service.ts:128`). `geoVerdict`
(`:383-417`) serves `GET /geo`. Fail-closed at four layers: the pure function (`:113`, `:116`), the
service `catch` (`:362-375`), the verdict `catch` (`:405-416`), and the client
(`app/src/entry/geo-gate.ts:53-93`, where every failure returns `'blocked'` and only `allowed` is
memoised).

Frontend consumer: `app/src/app/rules/rules.config.ts:22` imports the JSON directly through the
`@config/*` alias (`app/tsconfig.json:30`) and maps codes to names with a five-entry `ISO_NAMES`
table at `:61-67`; an unmapped code renders as the bare code (`:69`).

**The constraint that shapes PR-2.** `assertRegionCapability` (`service.ts:274-290`, called at
`main.ts:240`) refuses to start the service when the schedule carries a sub-national code and the
configured lookup cannot resolve a region. The vendor of record, IPLocate, declares
`resolvesRegion = false` (`geo-iplocate.ts:123`) because it returns a subdivision *name*, never an
ISO 3166-2 code, and sets `region: undefined` on every lookup (`:221`). So any `US-XX` entry in the
schedule stops the entry service at boot. This is correct behaviour — a rule that cannot be applied
must not look like one that is — and is why the US-state rows of PID §9 are held.

---

## 4. User-facing surfaces

**No surface in `app/src` states 72 hours, and none can.** Every number is interpolated from the
shared constants, and `app/src/app/rules/rules.config.test.ts:104-121` fails the build if any rules
section contains `'72 hours'` or matches `/go-timer/i`.

| Surface | File:line | Carries |
|---|---|---|
| Rules — field size | `app/src/copy/index.ts:860-861` | 64 seats, minimum field, deadline hours — all interpolated |
| Rules — refund | `app/src/copy/index.ts:863-864` | the full-refund rule, plus "Anyone can trigger the refund once the deadline passes" |
| Rules — how to enter | `app/src/copy/index.ts:799` | 64 seats and the minimum |
| Pool page | `app/src/app/pools/[pool]/page.tsx:100-129` | progress ring `total={64}`, countdown, `COPY.pool.refundRule` |
| Pool list | `app/src/app/pools/page.tsx:104` | `n / 64 entered · N needed to run` |
| Landing | `app/src/app/page.tsx:207-209,310` | hero countdown, per-tier entrant line |
| Sealed panel | `app/src/copy/index.ts:289` | "plays when it reaches 64 players, or at its deadline with at least …" |
| Share card | `app/src/app/card/[pool]/[player]/route.tsx:117` | `seat N of 64` |
| Blot state | `app/src/components/pools/PoolStateBlot.tsx:24,42` | braces from the minimum seat |
| Territory — block screen | `app/src/app/play/play-client.tsx:393-413` + `copy/index.ts:209-210` | "not available in your region" |
| Territory — rules section | `app/src/app/rules/page.tsx:81-104` + `rules.config.ts:151-160` | the generated list and schedule version |
| Territory — standing note | `copy/index.ts:282,491` | "18+ only · not available in some territories" |

The published-claims register (`app/src/copy/published-claims.test.ts:147-149`) pins the phrase
"Anyone can trigger the refund once the deadline passes" to `refund.rs` as its proof.

Stale prose outside the app: `app/src/rules/README.md:16` still says 72 h and a minimum of 32 —
fixed in PR-4. `docs/BUILD-ROADMAP_v1.0.md:153` (step 1.2) still says `now + 72h`; its step tables
are the plan as ratified and are not updated as the build moves past them, so it is annotated rather
than rewritten. `docs/PID_Blotto-Cup_v0.5.md:25,204` says 72 h and a minimum of 32 — founder-owned,
already listed in `docs/INDEX.md`, and appended to rather than edited.

---

## 5. Tests that assert the rules being changed

Frameworks: **LiteSVM** (`tests/litesvm/`, driving the compiled `.so`), **proptest**
(`programs/blotto_cup/tests/vault_model.rs`), in-crate unit tests, and Mocha/Chai for TypeScript.
No mollusk, no solana-program-test.

| File | Tests that encode the current rule |
|---|---|
| `tests/litesvm/tests/min_field.rs` | the twelve-hour deadline and that no seat moves it (`:57`); a 52-seat pool seals and pays (`:96`); 63 seats the same (`:204`); below the minimum refunds and cannot seal (`:227`); `set_tier_economics` refuses a pot the minimum field cannot cover (`:268`). Local `const FILL_DEADLINE_SECS: i64 = 12*60*60` at `:29-31` |
| `tests/litesvm/tests/lifecycle.rs` | refund fork returns the full entry (`:338`); full lifecycle pays the pot to the lamport (`:16`) |
| `tests/litesvm/tests/keeper_and_timing.rs` | `set_pool_timing` applies to future pools only (`:317`); local deadline constant at `:25` |
| `tests/litesvm/tests/vault_dust.rs` | a poisoned vault still refunds (`:190`) and still pays (`:127`) |
| `tests/litesvm/tests/gates.rs` | pool-opening gates hold (`:91`), including the closed-tier revert |
| `tests/litesvm/tests/treasury_gates.rs` | the withdraw floor including refundable entries (`:132`) |
| `programs/blotto_cup/tests/vault_model.rs` | `refund_fork_returns_every_lamport` (`:1087`, `fill in 0..MIN`); `min_field_seals_and_pays_the_winner` (`:1123`, `fill in MIN..CAP`); the money ledger under random sequences (`:976`) |
| `programs/blotto_cup/src/prize_math.rs` | the break-even assertion (`:145-148`) and the 40-seat break-even pin (`:154-158`) |
| `backend/reveal/test/daemon.spec.ts` | the whole "minimum field (D-E4)" block, `:299-391` — including that nothing happens *at* the deadline because both instructions compare strictly (`:286`) |
| `backend/scoring/test/mirror.spec.ts` | `CAPACITY` (`:86`), `MIN_SEATS` (`:88`), the deadline (`:91`), and that the pot table clears the minimum field (`:120`) |
| `app/src/app/rules/rules.config.test.ts` | `FIELD_RULES` carries the shared values (`:37`); no rules section says 72 hours (`:104-121`) |
| `tests/rehearsal/test/rehearsal.spec.ts` | a 52-seat pool settles to Paid with the pot conserved (`:51`); the refund fork drains a 51-entry pool (`:115`) |
| `backend/packet/test/territories.spec.ts` | the block-list suite and the fail-closed cases (299 lines) |
| `app/src/app/rules/rules.config.test.ts:141-147` | the rendered territory list equals the JSON |

Every one of these encodes a rule this series replaces, so each is rewritten in place with a comment
citing the founder instruction of 2026-09-12, per standing rule 0.7 — none is deleted.

---

## 6. What the survey changed about the plan

1. **PR-3 shrank.** The deadline, the permissionless seal, the refund fork and the two error variants
   already exist and are already tested. What remains is the value 52 → 40, the relaxed break-even
   comparison, and the per-pool copy of the minimum.
2. **The per-pool copy turned out to be necessary rather than tidy.** The upgrade drain gate is
   `{Sealed, Scored, Refunding}` (`scripts/admin.ts:356`) and does **not** include `Open`, so a
   program upgrade can land while a pool is taking entries. With the minimum held only as a compile-
   time constant, such an upgrade would change the rule under players already seated. `Pool.min_seats`
   copied at open closes that, at the cost of `Pool::LEN` 839 → 841 and a one-shot `migrate_pool` for
   the nine pools already on devnet.
3. **PR-2 split in two.** The country-level rows of PID §9 can ship today; the US-state rows cannot be
   enforced by the current geo vendor and are held behind a region-capable source.
4. **PR-1 is a live guard, not a formality** — see §1.
