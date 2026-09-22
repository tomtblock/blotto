# DRIFT — manual v1.2 against the live tree (WP0)

**Tree:** `main` at `66a43d8` (2026-09-15) · **Chain read:** devnet, program `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`, 23:01 UTC 2026-09-15 (`admin.ts status` / `pools`) · **Live app:** https://www.blotto.gg (the Vercel alias `blotto-jade.vercel.app` serves the same build).

Every row: where the manual says it · what it says · what the repo actually has (file:line) · verdict · the fix. A row is *resolved* when the manual amendment in this PR carries the fix or the row is explicitly accepted as "no manual change needed". **Unresolved rows: 0** (asserted at the bottom).

Verdicts: **HOLDS** (claim true as written) · **CHANGED** (true in substance, wrong in detail) · **GONE** (claim false against this tree).

**Sections A–G are the WP0 read of the manual against the tree (2026-09-15). [Section H](#h-findings-discovered-in-execution-after-wp0) carries what *running* the tests later found — read it too.**

---

## A. Headline findings (read these first)

| # | Finding | Evidence | Consequence for the test |
|---|---|---|---|
| A1 | **The 12-hour deadline is already live.** `DEFAULT_FILL_DEADLINE_SECS = 12 * 60 * 60` seeds `Config.fill_deadline_seconds`; the chain reads `fill deadline: 43200 s`. | `programs/blotto_cup/src/constants.rs:19-25`; `admin.ts status` 23:01 UTC | Manual §0.3 and §4.0 (the eleven-point product PR) are already done by D-E6 (2026-09-07). WP1's product PR is dropped (founder, P-01 Q3). §4.0.11's on-chain check stays as a Day-0 verification. |
| A2 | **The deadline is admin-settable at runtime.** `set_pool_timing(fill_deadline_seconds, cooldown_seconds)`, admin-only, applies to pools opened from then on; an open pool keeps the value it opened under. | `instructions/admin.rs:184-200`; `lib.rs:127-133`; `state.rs:222-229` | The manual's "no admin flag, devnet's clock cannot be warped, so refund tests must run back-to-back over 36 hours" is false. The founder can shorten the window for the deadline tests with one transaction. **Founder-owned number; option presented in §F below, not taken.** |
| A3 | **A pool at 40–63 seats plays; it does not refund.** `MIN_SEATS = 40`; at the deadline `seal_at_deadline` seals any pool with `entrants >= min_seats` (permissionless) and `trigger_refund` refuses it with `FieldReached` (6052). | `constants.rs:75`; `instructions/seal.rs:52-79`; `instructions/refund.rs:75` | Manual §0.1, T2 ("refund at 40") and T3 ("refund at 63") describe the opposite of the program. **Matrix remapped (founder, P-01 Q2): T2 = 39 seats → refund; T3 = 40 seats + pause → seals at the deadline and pays.** The 63 case is dropped: mechanically identical to 40. |
| A4 | **Winner takes the whole pot.** `PAID_RANKS = 1`, `PRIZE_BANDS_1024 = [1024]`. | `constants.rs:134,151`; `prize_math.rs:111-114` | No 16 paid seats, no 270/1024, no 1.35 SOL. T4 pays UI-A 4.0 SOL (tier 0 pot). The freeze PR predicts rank 1 and the full ranking, not a "top 16". |
| A5 | **`forfeit_escrow` moves nothing.** It sets `entry.forfeited = true`; the share stays in the vault until `pay_next_place` divides it among the eligible players at the next rank. `forfeit_escrow` is **admin**-signed; `release_escrow` is settlement-signer (or anyone after 7 days). | `instructions/escrow.rs:169-219, 350-552`; `constants.rs:46`; `CLAUDE.md` hard rules | Manual §9 T7 "forfeit moves B's to the treasury; vault ends at zero" is refuted. T7's pass condition, its signer split and its steps are rewritten (§E, T7). |
| A6 | **The pentagon is gone.** The allocation control is `<BlotMorph/>` + `<StatDials/>` with the dial-coupling rule in `components/blot/rebalance.ts`. | `app/src/battle/allocation.ts:1-40` | Every founder instruction that says "drag a vertex" is rewritten (§E and the manual §3.2, §7.3, §9). Selectors and steps: §C. |
| A7 | **No Playwright spec exists; CI asserts the test signer is absent from any deployable bundle.** | `tests/rehearsal/` has no `playwright/`; `.github/workflows/app-test-signer.yml:1-21` | The Playwright route is expected STRIPPED on www.blotto.gg. Live console check recorded in §C. Recorded as a reduction against roadmap 5.1. |
| A8 | **Opening a pool is three transactions, and only the keeper can start it.** `open_pool` (keeper-only, no fallback) → `commit_vrf_seed` → `create_pass_collection`; `register` reverts (`VrfSeedNotCommitted` 6004, or the mint CPI) until all three have landed. | `instructions/open_pool.rs:126-129,197`; `constants.rs:34-41`; `pass.rs:136-194`; `vrf.rs` | §4.10's "within one daemon tick" acceptance list becomes a three-step sequence; `Config.keeper` must equal the daemon's key (it does: keeper = settlement signer `EaDf…jrSD`, and the daemon opened pools 1–13). |

---

## B. On-chain program (`programs/blotto_cup/src/**`)

### B1. Fill deadline

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §0.3, §4.0.3 | `FILL_DEADLINE_SECS` in `constants.rs` | `DEFAULT_FILL_DEADLINE_SECS: i64 = 12 * 60 * 60` (`constants.rs:25`); no symbol `FILL_DEADLINE_SECS` anywhere in `programs/` | CHANGED | Rename every reference. |
| §0.3, §4.0 | "compiled constant, now 12 hours"; §4.0 changes it | Already 12 h; the constant is only the seed for `Config.fill_deadline_seconds`; live value is Config state, copied onto each Pool at open (`constants.rs:19-24`) | CHANGED | §4.0 becomes a verification, not a change (§4.0.11 kept). |
| §0.3 | "there is no admin flag" | `set_pool_timing` exists, admin-gated (`admin.rs:184-200`, `AdminOnly` at `:125-137`) | GONE | See A2 and §F. |
| §4.0.11, §4.10 | `fill_deadline − opened_at == 43200`; 259200 means the upgrade missed | `open_pool.rs:183-193` `fill_deadline = now + config.fill_deadline_seconds`; `opened_at = now` | HOLDS | State it as `== Config.fill_deadline_seconds` (43200 today). 259200 is unreachable on this tree. |
| §0.3, §12 | a pool opened before the change keeps its stored deadline | `state.rs:222-229` "never rewritten" | HOLDS | Mechanism is `set_pool_timing`, not an upgrade. |
| §4.0.4 | `refund.rs` header says "72h" | Header is "reach the minimum field or refund in full" (`refund.rs:1-2`); no "72" in `programs/` except `constants.rs:21` ("supersedes R7's 72 hours") | GONE | Delete §4.0.4 and the `programs/` half of §4.0.8. |
| §4.2 | Config field names | `Config.fill_deadline_seconds` (`state.rs:137-140`), `Pool.fill_deadline` (`state.rs:229`), `Pool.opened_at` (`:222`) | HOLDS | Use exact names in ENVIRONMENT.md / CARD.md. |

### B2. Minimum field and sealing

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §0.1 | `register.rs` seals only at 64 | True for `register.rs:277` (`SealReason::Capacity`) but `seal_at_deadline` also seals at `entrants >= pool.min_seats` (`seal.rs:64-67`), `entrants < CAPACITY` (`seal.rs:70`) | CHANGED | A3. |
| §1 T2, §9 T2 | 40 does not run and refunds | `MIN_SEATS = 40` (`constants.rs:75`); `trigger_refund` requires `entrants < min_seats` (`refund.rs:75`, `FieldReached` 6052) | GONE | T2 = 39 seats (refund). |
| §1 T3, §9 T3 | 63 refunds; "the 64th seals" | 63 ≥ 40 → seals at deadline | GONE | T3 = 40 seats + pause (seals at deadline, plays, pays 1024-lamport pot). |
| §1 T1 | 12 refunds | 12 < 40 | HOLDS | — |
| §8.7 | "at deadline the daemon triggers and refunds" | Two mutually exclusive instructions: `seal_at_deadline` (`lib.rs:273`) and `trigger_refund` (`lib.rs:397`); both permissionless (`seal.rs:33-37`, `refund.rs:31-33`) | CHANGED | §8.7 branches on `entrants` vs `min_seats`; CARD records which fired and `SealReason`. |
| — | per-pool floor | `Pool.min_seats` written from the constant at open (`open_pool.rs:214`); there is no `Config.min_seats`; changing it is a program upgrade that cannot reach an open pool | new | Record `pool.min_seats` in CARD. |
| — | pre-R7-b pools | `migrate_pool` writes `MIN_SEATS_V1 = 52` (`constants.rs:85`, `migrate.rs:213-268`); an unmigrated pool (847 bytes) is undeserialisable | new | Chain check 23:01 UTC: `admin.ts pools` deserialised all 13 pools and the indexer reports `min_seats: 40` for pool 13 → migrations done; no legacy pool is open. |

### B3. Register

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §9 T6 | nine reverts with "not-open/full" error | Gate order paused → service-key → state → deadline → capacity (`register.rs:138-174`). The 64th entry seals, so a 65th fails at the **state** gate: `PoolNotOpen` **6000** "Pool is not accepting entries". `PoolFull` 6010 is unreachable from `register` | CHANGED | T6 predicts 6000 `PoolNotOpen`. |
| §9 T3 | "expect the paused error" | First check in the handler: `Paused` **6005** "Entries are paused" (`register.rs:138`, `error.rs:24-25`); `set_paused` admin-only, blocks `register` only | HOLDS | Name the code. |
| §6.1, §8.4 | register accounts | `player` (signer), `config`, `pool`, `vault` (read-only, asserted ≥ pot), `platform` (mut), `entry` (init, `Entry::SPACE`, seeds `[b"entry", pool, player]`), `pass_collection` (`[b"pass_collection", pool]`), **`pass_asset` = fresh keypair signer**, `mpl_core_program`, `instructions_sysvar`, `slot_hashes`, `system_program` (`register.rs:61-127`); the Ed25519 packet instruction must precede register in the same tx (`entry_packet.rs:268-270`) | HOLDS | enter.ts mirrors this; two signers per register tx. |
| §4.6(c) | "80% to winners, 20% to treasury" | **100% of every entry goes to the platform treasury** (`register.rs:188-195`); the pot is pre-funded from the treasury at open (`open_pool.rs:166-172`); the old vault/fee split is gone (`prize_math.rs:45-48`) | GONE | CAPITAL.md: entry money and prize money are disjoint. |
| — | refundable tracking | `platform_refundable += entry_lamports` at register (`register.rs:199-204`), released at seal (`:313-320`) | new | Add to ENVIRONMENT.md baseline and the §8.10 diff. |
| — | gates the manual never names | `ServiceKeyCannotEnter` 6056: admin, keeper, entry signer, settlement signer can never register (`register.rs:144-150`); `VrfSeedNotCommitted` 6004; `TreasuryShortfall` 6049; packet needs `terms_version ≥ 1`, `geo_cleared`, `age_verified`, `issued_at` within 60 s (+5 s skew) (`entry_packet.rs:228-238`, `constants.rs:154,160`) | new | The funder is a separate derived key (never the admin). enter.ts requests the packet immediately before sending. |

### B4. Refund fork

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §9 T1 | `RefundTriggered` returns the pot | `vault_debit(vault → platform, pot)`; `platform_reserved -= pot` (`refund.rs:93-109`); event carries `{pool, entrants}` only (`events.rs:215-219`) | HOLDS | Pot returns **vault → treasury**; read the amount from balances, not the event. |
| §9 T1 | after = before + `entry_lamports` exactly | `refund` pays `pool.entry_lamports` **from the treasury** to the player (`refund.rs:174-184`); event `Refunded {pool, player, amount}` | HOLDS | Rent (Entry 228 bytes + pass asset) is not returned. |
| §9 T1 | "vault gone" | The vault keeps a rent cushion forever (`open_pool.rs:155-158`, `refund.rs:86-92`, `vault.rs:56-63`) | GONE | Pass: vault == rent cushion (~0.00089 SOL). |
| §9 T1 | "treasury unchanged" | Loses exactly one cushion per pool opened | CHANGED | Expected treasury delta = −cushion per refunded pool. |
| §9 T1 | state path | `Refunding` → `Closed` when `refunded_count == entrants`; a 0-entrant pool goes straight to `Closed` (`refund.rs:79-83, 195-196`) | HOLDS | Add the empty-pool shortcut (this is what pools 1–12 did). |
| §9 T1, T2 | "tier reopened … opens automatically ~21:05" | Slot frees with `tier_next_open_at = now + cooldown_seconds` (`slot.rs:28-32`); `DEFAULT_COOLDOWN_SECS = 5 * 60` (`constants.rs:32`); chain reads 300 s | CHANGED | The 5-minute cooldown is explicit in every schedule line. |

### B5. Prizes and settlement

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §9 T4 | band 1 = 270/1024 = 1.35 SOL; 16 paid | A4 | GONE | Rank 1 receives `pot_lamports` (4 SOL, tier 0). |
| §4.6 | pot = 5.12 SOL tier 0; 6.4 SOL per pool entry capital | Pots are fixed constants [4, 20, 30, 40, 100, 200, 300 SOL] (`constants.rs:122-130`); chain: tier 0 pot 4.0 SOL, price 0.1 SOL; tier 1 price 0.5 SOL, pot 25.6 SOL | CHANGED | CAPITAL.md uses the chain values. |
| §4.9 | 1024-multiple checked locally | Also on-chain: `PotNotDivisible` 6050 (`treasury.rs:184-187`); and `pot <= MIN_SEATS × price` (`PotExceedsMinimumField` 6053, `treasury.rs:200-206`); no minimum pot | CHANGED | `--tier 1 --price 0.1sol --pot 1024` lands (1024 ≤ 4 SOL). |
| §5.4, §10 | Pool fields | `state`, `entrants`, `results_root`, `results_committed`, `payouts_len`, `payouts: [Payout{entry_index,amount}; 64]`, `paid_mask` (`state.rs:198-268`) | HOLDS | — |
| §10 | "pay_prizes (sum == pot)" | Sum, shape and ascending order are enforced at **`commit_results`** (`reveal_commit.rs:97-121`, `PayoutSumMismatch` 6044); `pay_prizes(pool_id, seats)` is settlement-signer only, idempotent via `paid_mask`, sets `Paid` when every bit is set, then frees the slot (`pay_prizes.rs:52-209`) | CHANGED | Move the sum check to the commit line of the CARD. |
| §10 | "reveal (sha256(secret)==hash YES/NO)" | A wrong secret cannot land (`reveal_commit.rs:62-65`, `WrongPoolSecret`); reveal allowed once the pool leaves Open or past the deadline (`:56-60`) | HOLDS | Reword: "reveal landed". |
| — | `pay_next_place` | `(pool_id, rank, amount, proof, group_size, takes_remainder)`, settlement-signer, requires `Paid` and a forfeited source, Merkle proof against `results_root`, one eligible member per call, remainder to the lowest entry index (`escrow.rs:350-552`) | new | T7 must include these calls or its forfeited lamports never move. |

### B6. Escrow, detection, holds

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §9 T7 | forfeit → treasury; vault → 0 | A5; vault keeps the cushion | GONE | T7 rewritten (§E). |
| §9 T7 / F-29 | founder releases one, forfeits one | `release_escrow`: settlement signer, or anyone after `ESCROW_AUTO_RELEASE_SECS` = 7 days (`escrow.rs:109-141`, `AutoReleaseNotDue` 6064); `forfeit_escrow`: **admin** (`escrow.rs:169-178`) | CHANGED | Release = the review service / settlement key; forfeit = the founder's admin key. |
| §9 T7 | `flag_entry` before `pay_prizes` | `flags.rs:39-53`: settlement-signed, refused after settlement (`EntryAlreadySettled` 6033) | HOLDS | — |
| §9 T7 | "plan predicts both seats hard-blocked" | On chain a "hard block" is only `Entry.flagged` set by a `flag_entry` call; `Config.detection_hard_block` is recorded but **nothing reads it** — detection runs manual-only (`admin.rs:270-277`, D-E9) | CHANGED | T7 depends on a human (or the review service) calling `flag_entry` on the device-correlation finding. Whether the daemon does this automatically: §C/§D (backend slice). |
| — | escrow triggers | `flagged || sanctions_hold || (kyc_above > 0 && amount > kyc_above)` (`pay_prizes.rs:139-150`) | new | Record all three. |
| — | sanctions hold | `place_sanctions_hold` (settlement, allowed after settlement), `lift_sanctions_hold` (admin); blocks both release paths and next-place (`sanctions.rs`, `escrow.rs:103-106, 297-299`) | new | ENVIRONMENT.md line; `admin.ts lift-sanctions-hold` exists. |

### B7. Layouts, opening, pass asset

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §4.8 | rent on `Entry::LEN` | `Entry::LEN = 220`, `SPACE = 228` (`state.rs:419-425`); `register` allocates **228** (`register.rs:95`) | CHANGED | Quote rent for 228 bytes. |
| §4.8 | pass-asset size | Minted bare by Metaplex Core (`pass.rs:84, 220-229`), size not visible in this crate; player pays its rent | CHANGED | Measure empirically (LiteSVM balance diff around `register_as`, §4.8 option B). |
| §4.8 | 2 × 5000 fees | Two signers on register (`player`, `pass_asset`) | HOLDS | — |
| §5.4 | Pool account | `Pool::LEN = 841`, `SPACE = 849`; offsets `entrants` 33, `fill_deadline` 43, `state` 51 (`state.rs:297-325, 566-573`) | HOLDS | harvest.ts uses the Anchor decoder, offsets as a cross-check. |
| §4.2 | baseline fields | Config also has `keeper`, `cooldown_seconds`, `fill_deadline_seconds`, `tier_next_open_at`, `platform_reserved`, `platform_refundable`, `treasury_reserve_pots`, `active_pool_by_tier`, `vault_ceiling_lamports` (`state.rs:74-149`); `Config::SPACE = 484` | CHANGED | ENVIRONMENT.md template extended; "reserved" is `platform_reserved`. |
| §4.1 | "not NOT INITIALISED" | Also: Config must be 484 bytes (else `migrate_config` first, `migrate.rs:69-152`) | CHANGED | Chain check: `status` deserialised → migrated. |
| §4.10 | daemon opens a pool when a tier opens | A8: keeper-only (`NotKeeper` 6054); `set_keeper` admin-only refuses the zero key | CHANGED | Day-0 check `Config.keeper == daemon key` (true today). |
| §4.10 | "non-zero `vrf_seed` and a pass collection within one tick" | `vrf_seed = 0` sentinel at open (`open_pool.rs:197`); `commit_vrf_seed` and `create_pass_collection` are separate permissionless txs | CHANGED | Three-step acceptance; `register` fails until both land. |
| §4.10 | `PoolOpened` fields | `{pool, id, tier, entry_lamports, pot_lamports, fill_deadline, timer_seconds, sealing_pubkey, sealing_secret_hash}` — no `opened_at` (`events.rs:16-29`) | CHANGED | Read `opened_at` from the account. |
| §4.6(b) | floor = `min_platform` + reserve pots × idle-tier pots | `available = platform − platform_refundable`; `needed = pot + cushion + min_platform + Σ(enabled idle tiers except this one)(pot + cushion) × reserve_pots` (`open_pool.rs:144-162`, `treasury.rs:57-69`); `withdraw_platform` floor adds `platform_refundable` (`treasury.rs:136-142`) | CHANGED | CAPITAL.md formula corrected. |
| — | vault ceiling | `price × 64 <= vault_ceiling_lamports[tier]` at open (`open_pool.rs:133-138`, 6009); tier 0's ceiling equals its gross (6.4 SOL) | new | Any tier-0 price change needs `set-vault-ceiling` first. Not planned. |
| — | pass non-transferable | Collection-level `PermanentFreezeDelegate{frozen:true}` (`pass.rs:167-170`); a transfer fails `InvalidAuthority (0x9)` | HOLDS | — |
| — | error codes (pinned) | 6000 PoolNotOpen · 6004 VrfSeedNotCommitted · 6005 Paused · 6010 PoolFull · 6011 DeadlinePassed · 6012 DeadlineNotPassed · 6033 EntryAlreadySettled · 6044 PayoutSumMismatch · 6049 TreasuryShortfall · 6050 PotNotDivisible · 6051 FieldBelowMinimum · 6052 FieldReached · 6053 PotExceedsMinimumField · 6054 NotKeeper · 6055 TierCoolingDown · 6056 ServiceKeyCannotEnter · 6064 AutoReleaseNotDue · 6069 SanctionsHoldActive (`error.rs:209-240`) | new | reconcile.ts matches on these. |


---

## C. Chain verification — measured, not inferred (devnet, 23:07 UTC 2026-09-15)

Read directly from the cluster with `@solana/web3.js` and `admin.ts`, so these are observations rather than readings of the source.

| Check | Measured | Meaning |
|---|---|---|
| `Config` account size | **484 bytes** (= `Config::SPACE`) | `migrate_config` has run. No migration is pending; `admin.ts status` deserialises. |
| Pool 13 account size | **849 bytes** (= `Pool::SPACE`) | `migrate_pool` has run. No pool is stranded at the pre-R7-b 847-byte layout, so the 52-seat legacy floor is not in play. |
| `fill_deadline − opened_at` (pool 13) | **43200** (1789522881 − 1789479681) | The 12-hour deadline is live on chain, confirming A1 against the account rather than the constant. |
| Pool 13 state byte | **0 = Open**, entrants **0** | Nothing has entered pool 13. It is not a test pool. |
| Pool 13 vault | **4,000,650,240 lamports** = pot 4,000,000,000 + **650,240** | The pot is pre-funded at open, as B3 says: entries never reach the vault. |
| `rent_floor()` on devnet | **650,240 lamports** (`getMinimumBalanceForRentExemption(0)`) | `vault.rs:61-63` is `Rent::minimum_balance(0)`. **The often-quoted 890,880 is the mainnet figure and is wrong here.** |
| Pool 12 vault (Closed) | **650,240 lamports, 0 bytes** | Confirms the cushion is never recovered: a settled pool's vault keeps exactly one floor forever. **Sunk cost per pool opened = 0.00065024 SOL**, and it comes from the treasury. |
| Pass collection for pool 13 | exists, owner `CoREENxT6…PZNhX7d` (Metaplex Core), 105 bytes | `create_pass_collection` has landed for the open pool, so step 3 of A8 is done here. |
| `Config.keeper` | `EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD` (= the settlement signer) | Matches the key that opened pools 1–13, so A8's keeper-only constraint is satisfied today. |
| Treasury (`platform` PDA) | **1,996,748,800 lamports** (1.9967 SOL) | Against `min_platform` 0.5 SOL and `platform_reserved` 4.0 SOL. **See §F: this is short for opening a second tier.** |
| Pools 1–13 | 12 Closed (0–3 entrants each), 1 Open | Someone has been entering by hand; none of it belongs to this test. All refunded below the 40 floor. |

### C1. The treasury will not cover a second open tier tonight

`open_pool` requires `available = platform − platform_refundable ≥ (pot + cushion) + min_platform + idle-tier reserve` (`open_pool.rs:144-162`, `treasury.rs:57-69`).

With tier 1 enabled at its **current** economics (pot 25.6 SOL) the requirement is far beyond the 1.9967 SOL held. Even after `set-tier-economics --tier 1 --pot 1024`, opening tier 1's pool needs its own cushion plus the floor, and opening the **next tier-0** pool needs 4.0 SOL + cushion + 0.5 SOL floor + tier 1's idle reserve. The treasury is refilled by `fund-platform-wallet`, which is permissionless — so this is a funding action (F-05), not an admin one, and it is on the critical path before F-11. Exact figure in `CAPITAL.md` once the faucet total is known.

---

## D. Backend (`backend/**`, indexer, packet, review)

The manual names three backend packages (§2.5, §4.11). There are **nine**: `_shared`, `class-digest`, `detection`, `indexer`, `packet`, `reveal`, `sanctions`, `scoring`, `sealing`. Two of the unnamed ones own behaviour the manual attributes to `reveal`.

### D1. Scoring, sealing and the oracle

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §7.1 | stat to the larger number, ties to neither; battle at ≥3 of 5; win 2 / draw 1; rank by score then stats won; equal on both shares the rank and splits the prize | `engine.ts:41-50` `compareBattle`; `:89-94` win 2 / draw 1; `:100-111` rank; `:144` `assignPrizes` splits | **HOLDS** | The four-line rule is exactly right. Add only that a split now matters solely for a tie at rank 1. |
| §4.11.2, §5.5 | `scorePool` → `assignPrizes` → `rankOrder` + Merkle root | `scorePool(players: readonly BattleSet[]) => PlayerResult[]` (`engine.ts:78`); `assignPrizes(results, pot: bigint)` (`:144`); `rankOrder(results)` (`:126`); `merkleRoot(leaves)` (`merkle.ts:72`); `leafBytes({player, rank, amountLamports})` (`merkle.ts:35`) | HOLDS | Exact signatures for `oracle.ts`. `PlayerResult = {index, scoreHalf, zones, rank, amountLamports}`. |
| §4.13 | oracle reproduces the committed Python vectors | `backend/scoring/fixtures/vectors.json` present; `vectors.json.min_seats` is **40**, but its `rules` string still says "a pool runs with 52..64 players (D-E4)" | CHANGED | Fixture data is current; its prose is stale. Assert against the data, never the comment. |
| §0.1, §9 T2/T3 | 40 and 63 refund | `prizes.ts:35` `MIN_SEATS = 40n`; daemon `daemon.ts:279` seals at `entrants >= MIN_SEATS` | GONE | A3 (matrix remapped). |
| §9 T4 | band 1 = 270/1024 | `prizes.ts:124,127` `PAID_RANKS = 1`, `PRIZE_BANDS_1024 = [1024n]` | GONE | A4. |
| §6.1 | `enter.ts` mirrors `submit.ts`: encode → seal → putCiphertext → requestPacket → register | Pipeline confirmed; packet is **85 bytes** (`packet.ts:29` `PACKET_LEN`), though `packet/src/service.ts:113` still says "83 canonical bytes" | CHANGED | `enter.ts` reads `PACKET_LEN`, never the comment. |

### D2. The daemon — what it actually does at a deadline

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §8.7, §9 | "at the deadline the daemon triggers and refunds" | `daemon.ts:279-297`: `entrants >= MIN_SEATS` → `sealAtDeadline` then cranks in the same tick; else `triggerRefund`, then `crank.ts:179-188` refunds each entry one at a time | CHANGED | §8.7 branches. T3 (40 seats) seals **and settles in the same tick** — the founder's screenshot window is minutes, not hours. |
| §12 | "the daemon opens the next pool the instant the previous closes" | 5-minute cooldown (`prizes.ts:55`, `Config.tier_next_open_at`) | CHANGED | Five minutes, everywhere in the schedule. |
| §8.7 | "watch the daemon — `PoolSealed`, reveal, `commit_results`, `pay_prizes`" | The daemon has **no status endpoint beyond `/health`**; per-step narration, open reasons and detection JSON go to **stdout only** (`main.ts:446, 546, 582`) | CHANGED | "Watch the daemon" means reading its hosted logs. Capture them per pool as evidence or they are lost. Chain events remain the authoritative record. |
| §5.4 | harvest reads the Irys bundle | The bundle is published **after** payment; failures are swallowed and retried on a **10-minute** backoff, alerting after 3 (`crank.ts:346-351`, `daemon.ts:170-171`) | CHANGED | `harvest.ts` polls for the bundle; a Paid pool with no bundle yet is normal, not a failure. |
| §4.1 | "five services up" | The list names four. The **review service** (`detection/src/server.ts:621`) is the fifth and T7 depends on it | CHANGED | Added to the §4.1 table and the Day-0 gate. |
| — | settlement can stall on a lagging RPC | `crank.ts:417` throws unless the `Entry` account count equals `Pool.entrants` | new | A full pool may stall for a few ticks with a visible tick error. Expected; do not call it a FAIL at 8.7. |

### D3. Detection — the T7 finding

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §9 T7 | "plan predicts both seats hard-blocked"; "`flag_entry` before `pay_prizes`" | The daemon **runs** detection and **stores** the report (`main.ts:409-446`), alerts when review is recommended (`:453`), and then **returns `[]`** (`:459`) — it hard-blocks nobody. It also passes `{fullEscrowTier: false}` (`:423`), making the widening branch (`pipeline.ts:115`) unreachable | **CHANGED — decisive for T7** | Detection is **observable but never automatic**, by founder ruling D-E9 (manual-only policy). The device-correlation finding will appear in the stored report; **no `flag_entry` happens by itself.** T7 becomes a test of the *review* path: a configured reviewer must sign a decision. |
| §9 T7 | "release UI-A, forfeit UI-B; send both signatures" | `POST /decisions` with `action=forfeit` returns **202 "forfeit recorded, admin lands it"** — the review service holds no admin key; `GET /pending?pool=<pda>` lists forfeits logged but not landed (`server.ts:346`) | CHANGED | A forfeit is two steps: the reviewer's signed decision, then the founder's `admin.ts forfeit-escrow`. F-29 is re-written accordingly (§E). |
| §4.5, §9 T7 | detection signals | `signals.ts` — full list captured in §E; `population_score` fires at `\|z\| >= 3` (`signals.ts:188`) | CHANGED | **An engineered `wall` winner taking all 882 half-points is many sigma out and will trip `population_score`.** The plan must predict this finding rather than be surprised by it. |
| §4.5 | `ipHash` "populated?" | The daemon passes `ipHash: ''` unconditionally (`main.ts:420`) | GONE | No IP correlation is possible. The manual's predicted "IP-correlation note on every pool" will not appear. |
| §4.2 | VRF stub worry | The class draw is quarantined from scoring by a standing-rule grep (`class-digest/digest.ts:11-13`) | CHANGED | A stub randomness account invalidates **only** the class draw, never a rank or a payout. Scope the ENVIRONMENT.md line accordingly. |

### D4. The read APIs

| Endpoint | Shape / caveat | file:line |
|---|---|---|
| `GET /pools`, `GET /pools/:id` | Live: id, tier, entry_lamports, pot_lamports, fill_deadline, timer_seconds, state, entrants, sealing_pubkey, results_root, secret, min_seats, **`outcome_if_deadline_now`**, server_time | `indexer/src/read-api.ts:190-194` |
| `outcome_if_deadline_now` | A free, honest oracle for "will this pool seal or refund" — use it in the §8 loop instead of arithmetic | `read-api.ts:194` |
| `min_seats` | Served as the **shared constant**, not the pool's own field (`PoolOpened` carries no `min_seats`) | `read-api.ts:190` |
| `GET /pools/:pool/leaderboard` | `committed_fields: ['player','rank','amount_lamports']`, with `score_half`/`zones` under a `recomputed` sub-object | `read-api.ts:472-500` |
| `GET /pools/:pool/sealed-entries` | 403 before reveal; after reveal `{seat, ciphertext_hex}` — **the only per-seat timings source**, and an independent decrypt path for T8 | `read-api.ts:522` |
| Bundle announce | Off unless `BLOTTO_INDEXER_ANNOUNCE_URL` + `BLOTTO_HELIUS_WEBHOOK_SECRET` are set; unset means the leaderboard **404s fail-closed** until a backfill | `reveal/src/main.ts:35-41`, `read-api.ts:472` |
| Rate limiting | **Off by default** everywhere; the proposed 600 rpm / 120 burst is `AWAITING_RATIFICATION`; the limiter is per-process and in-memory | `_shared/src/http-hygiene.ts:65-108` |

**Consequence for T6.** With rate limiting off, T6 measures the app and the RPC, not a limiter. That is the honest thing to measure, but the setting must be recorded in `ENVIRONMENT.md` or the number means nothing.

### D5. Stale comments that will re-introduce the manual's error

`daemon.ts:7,187,189`, `chain.ts:229,232`, `engine.ts:174` and `vectors.json.rules` all still describe the **52**-seat D-E4 regime. The code uses `MIN_SEATS = 40` uniformly. These are repo-internal and out of scope for this PR (the battle test does not modify `backend/`); they are listed here so nobody reads a comment and reverts the matrix. **Logged as a product follow-up, not a battle-test change.**

---

## E. The web app (`app/**`) — the slice that rewrites the founder's instructions

### E1. The allocation control: the pentagon is gone

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §7.3, §2.2, §12, F-06/F-14/F-17/F-25/F-26, §9 cards | "the draggable pentagon", "vertices", "the five integers under the pentagon" | Five native sliders with per-stat **lock** buttons: `<StatDials />` (`components/blot/StatDials.tsx:151-197`); the radar geometry "had no consumer left and was removed" (`components/blot/blotGeometry.ts:9-10`); `allocation.ts:15-17` records the replacement | **GONE** | Every founder instruction rewritten (§E5). "Vertex" → "dial"; "drag to the rim" → "press End". |
| §7.3, §2.2, §9 T4 | "the 15-second timer", "let the 15s timer expire seven times" | **One 90-second clock for the whole run of seven** (`battle/run-clock.ts:54` `RUN_CLOCK_BUDGET_MS = 90_000`; `battle/machine.ts:7-11` "v4 TIMER SEMANTICS, superseding the per-screen presentation of R9's value"). The per-battle ~13 s guide is advisory display only | **CHANGED** | Replace every "15 s". `Pool.timer_seconds` (15) is still on chain and untouched — the client no longer reads it as a per-screen budget. |
| §7.2, §7.3, §9 T4 | "Touch nothing; let the timer expire × 7" → 20×5 via "R9 lock-current" | Two inversions: (a) the clock **does not start** until the first dial or lock interaction (`machine.ts:204-211`), so touching nothing waits forever; (b) expiry enters the **even split** for every unlocked battle, not the shape on screen (`machine.ts:148-160`, which explicitly flags the old "locks at exactly what it shows" wording as stale) | **CHANGED** (outcome survives, mechanism inverted) | The 20×5 target still lands. Instruction becomes: press one padlock to start the clock, then wait 90 s without locking. Cite **R9-b lock-even-split**, not R9 lock-current. |
| §5.3, §7.3 | winner target `[33,33,34,0,0]` | Free drags give `[34,33,33,0,0]` — proportional re-apportionment with largest-remainder, ties to the earlier stat (`rebalance.ts:105-117`, pinned by `rebalance.test.ts:19-22`). `[33,33,34,0,0]` is reachable **using locks** | CHANGED | Plan target becomes `[34,33,33,0,0]`, or state the tolerance only ("any three ≥ 26"). |
| §7.3 | loser: "one stat ≥ 76 (in practice it lands at 100)" | Exactly 100 in one keypress: `End` sets the dial to max (`StatDials.tsx:171`), max is 100 with no locks; `rebalance.test.ts:24-30` gives `[0,0,100,0,0]` | HOLDS, improved | "Focus a dial, press End." Drop "in practice". |
| §5.5 | `INPUT_DRIFT` "expected on UI seats (dragging is approximate)" | The dragged stat lands **exactly** on its target; the dial and its number can never disagree (`rebalance.ts:21-22`); keyboard steps are exact | **CHANGED** | UI allocations are now exact and predictable. `INPUT_DRIFT` on a UI seat becomes a FAIL like any other, provided the plan records what the founder actually locked (from the rack screenshot). **This strengthens the test.** |
| §7.3 | "screenshot every lock-in — the five integers under the pentagon" | Two places: the readout per dial row (`StatDials.tsx:181-183`) and the rack of seven tiles under the machine, each showing its five numbers with label `Battle N locked: a · b · c · d · e` (`battle/components/seven-tiles.tsx:39-76`) | CHANGED | **One screenshot of the rack captures all seven allocations.** Better evidence than seven separate shots; keep the per-lock shots as backup. |
| — | the dials have locks | `rebalance.ts:52-63`, `StatDials.tsx:184-197` — founder addition 2026-09-13 | new | Locks are the mechanism that makes exact integers reachable. The manual has never heard of them. |
| — | keyboard control | `Home` = 0, `End` = max, Arrow ±1, Shift+Arrow ±5, PageUp/Down ±10 (`StatDials.tsx:66-73,167-177`) | new | The winner is two keypresses; the pole is one. "90 seconds" is now generous. |

### E2. Sign-in, gates and the entry pipeline

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §4.5, F-02 | "three email accounts", "Privy sign-in with three email accounts" | **There is no email login.** `loginMethods: ["google","apple","twitter","wallet"]` (`wallet/privy-bridge.tsx:460`); the sign-in page renders Google as the hero button plus Apple and X (`app/signin/signin-client.tsx:40-43,174`) | **GONE** | F-02 becomes "three Google accounts" (Apple or X also work). Three Gmail addresses are Google accounts, so the founder's three email accounts are usable — via **Continue with Google**, not an email field. |
| §4.5 | "wait for the embedded wallet" | `embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } }` (`privy-bridge.tsx:475-477`) | HOLDS | A social login creates the wallet automatically. Signing in with an **already-linked external wallet** creates none. |
| §4.5 | "complete age attestation and terms clickwrap" on Profile | The clickwrap is two statement tiles plus one wallet signature, and it lives on the **play page**, not the profile (`app/play/play-client.tsx:802-891`; testids `gate-statement-1/2`, `gate-confirm`). Terms version **2**, dated 2026-09-06 (`config/terms.json`, read at `entry/attestation.ts:31-33`) | **CHANGED** | F-02 cannot complete the clickwrap without an open pool to enter. Split F-02: accounts and addresses now; clickwrap at the first entry. Record terms version 2. |
| §4.5, §4.2 | "`deviceHash` wired? Zeros → T7 not testable" | **Wired.** `entry/services.ts:229-235` → `deviceMarker(pool)`; `entry/device.ts:54-110`: 32 CSPRNG bytes in `localStorage` per browser profile, marker = `sha256("blotto:device:v2 " ‖ pool ‖ " " ‖ secret)`. Zeros only when storage is unavailable | **CHANGED, in the manual's favour** | T7 is LIVE. Two accounts in **one** profile produce an identical marker for the same pool — exactly what T7 needs. The marker is **per pool**, so markers are unlinkable across pools. Never use a private window for a T7 seat, and never clear site data between UI-A and UI-B. |
| §4.5, §4.2 | "predict an IP-correlation note on every pool" | The client never sends an ipHash (nothing in `app/src`); the crank writes `''` (`reveal/main.ts:420`) | **GONE** | Delete the prediction. Record "ipHash NOT POPULATED" in ENVIRONMENT.md. |
| §6.1 | `enter.ts` mirrors submit.ts | Exact match (`entry/submit.ts:86-102`), ciphertext before money | HOLDS | Two things `enter.ts` must also mirror: `putCiphertext` requires a **wallet signature** over `ciphertextMessage(pool, player, ciphertext)` (`entry/services.ts:112-117`, `POST {apiBase}/ciphertexts`), and `requestPacket` is `POST {apiBase}/packet` with `{wallet, pool}` (`:142-146`). |
| §4.13, F-07 | "dry run to the review screen — abandon before paying" | Payment is at the second seal step; flow ends Approved → 7 battles → "All seven made." → `Seal my allocation` → `Confirm — seal and submit` (`battle/components/battle-flow.tsx:424-443`) | HOLDS | Abandon point: stop at **Seal my allocation**, or press **Go back**. Reaching the review screen needs the balance gate: entry price + 0.01 SOL headroom (`entry/balance-gate.ts:19`). |
| §4.1 | "Pools tab showing FIXTURE means no indexer URL" | In a **production** build with no indexer URL you get "Live tournament data is temporarily unavailable" (`copy/index.ts:31`), not fixtures; fixtures need `next dev` or `NEXT_PUBLIC_FIXTURE_DATA=1` (`data/api.ts:132-179`) | CHANGED | Restate the check: pool ids are numeric, not `F1XTURE…`, and the page is not the unavailable card. |
| §4.2, §4.11.4 | "`__BLOTTO_TEST_SIGNER__` present in deployed build?" | Gated on `NEXT_PUBLIC_ALLOW_TEST_SIGNER === "1"` **and** a devnet RPC; unset inlines to `"0"` and the branch is eliminated (`next.config.ts:95-97`, `wallet/auth-provider.tsx:86-92`); mainnet refused (`chain/cluster.ts:127-128`); both directions proven in CI | **CHANGED** | It is a **build decision, not an observation**. An ordinary Vercel build cannot carry it. A second hook exists too: `window.__BLOTTO_SIGN_NO_MODAL__` (`wallet/signing-ui.ts:60`), needed to suppress the signing confirmation. |
| §4.11.4, §6.1 | "Playwright driver around `entry-flow.spec.ts`" | **`entry-flow.spec.ts` does not exist.** The only spec is `app/e2e/journey.spec.ts`, a fixture-backend visual journey with no wallet and no entry | **GONE** | The Playwright entry route must be **written from scratch** against a self-built flagged app. Decision in §F. |

### E3. What the player actually sees (evidence instructions)

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §8.4 | "screenshot pre-flight, each lock-in, review screen, seat card" (10 shots) | Real order: territory check → clickwrap → balance gate → **"You're in."** → 7× **Battle N of 7** → **"All seven made."** → seal step 1 → seal step 2 → "Sealing your battles…" → "Confirming your entry with the network." → **pass card** (`data-testid="pass-card"`, shows `Seat N of 64`, `Pool #n`) → **Sealed** panel | CHANGED | Ten shots, renamed: clickwrap · "You're in." · the rack (all seven) · "All seven made." · pass card · Sealed panel. The "seat card" is the **pass card**, and since 2026-09-15 it shows **no rarity class** — rarity is on the Profile only. |
| §8.8, §11.6 | "screenshot each UI profile" for refunded / paid / unpaid | **A refunded entry is invisible on the Profile.** It carries lifetime record, a prize-per-tournament chart, rivals, rarity and My Blotts — no refund row, no per-entry state | **CHANGED** | For T1/T2/T3 the evidence is (a) the pool page in `Refunding`/`Closed` and (b) the **wallet balance** card before and after. The only refund string a player sees is the notification "Pool #n did not reach its minimum field — refunds are open" (`copy/index.ts:636`). |
| §8.1, §8.6 | "screenshot pool page at 0/64" | Pool page has the seat ring "{n} of 64 seats filled", a server-time countdown, and the R7-b outcome line: "Enough players are seated: if the clock ran out now, this pool would run." / "Not enough players yet… 40 are needed." (`copy/index.ts:312-315`) | CHANGED, richer | **Add the outcome line to the evidence list.** At 40/64 it is the screen that proves §0.1 stale. |
| §9 T6 | "UI-C's screen shows a legible failure" | Exact strings exist per refusal (`copy/index.ts:486-501`), mapped from Anchor codes at `tx/errors.ts:44-69`: 6000 pool-closed, 6005 paused, 6010 full, 6011 deadline, 6019 packet stale. A waiting spinner names itself slow after 4 s and offers an exit after 30 s | HOLDS | Quote the exact strings into `FOUNDER-ACTIONS.md` so the founder confirms a **match** rather than judging "legible". Add `alreadyEntered` and `packetStale` (the packet is good for 60 s — a slow wallet approval is refused on chain). |
| §9 T3, F-23 | "UI-C attempts an entry while paused" | `set_paused` does not change `Pool.state`, so the play page lets her play and the refusal lands at `register` with the paused string | CHANGED | Predict `COPY.tx.entriesPaused`; she pays only the transaction fee. |
| §9 T6, F-26 | "UI-C takes the full 90 s" | Works only if she moves a dial first; `even_split` does not start the clock (`machine.ts:186-211`) | CHANGED | F-26: move one dial, then wait out the clock. |
| §1 T8, §9 T8 | verify page | `/verify` takes a **pool address** and a **published bundle address**, recomputes in the browser, three verdicts (`verify/logic.ts:203-240`); no wallet or login needed | HOLDS | The bundle address is auto-filled **only** when the pool has a verified archive. For T8, hand the recruit the bundle URI from `T<n>.actual.json` explicitly. |
| §9 T7, F-29 | "review page: release UI-A, forfeit UI-B; send both signatures" | `/admin/review` behind an admin gate; buttons **Clear · Release · Forfeit**; the **reviewer's own wallet** signs a canonical message (`app/admin/review/review-client.tsx:167-185,297-315`), accepted only if listed in `config/reviewers.json`. The page itself carries a panel "Upheld forfeits the chain does not carry yet" | **CHANGED** | F-29 is a **two-part action**: a reviewer-signed decision in the browser, then the founder's `admin.ts forfeit-escrow` on chain. What comes back from the page is a decision, not a transaction signature. The registry holds one member, so the **appeal path is not testable**. |
| — | cooldown countdown in the UI | Not built — the home page renders a status word (`Taking entries` / `Settling` / `Covered — opens next`), no `next_open_at` countdown | GONE | Do not ask for a cooldown-countdown screenshot. Use the ladder status word plus the new pool appearing on `/pools`. |
| §12 | "same browser, three emails, outside T7 — never" | Correct, and confirmed live | HOLDS | Add: never a private window for a T7 seat either. |

---

## F. Scripts, tests, config and CI

### F1. `admin.ts` — what the manual's commands actually do

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §4.9 | `set-tier-economics --tier 1 --price 0.1sol --pot 1024` | Syntax exact (`admin.ts:129-130`); local 1024-multiple check at `:810-812` | HOLDS (syntax) | But its **effect** breaks F-11 — see F2. |
| §4.9 | silent on a pot ceiling | On chain only: `pot <= MIN_SEATS × price` (`treasury.rs:200-206`, `PotExceedsMinimumField` 6053). `admin.ts` does not mirror it | CHANGED | A bad pot burns a transaction. Ceiling is `40 × price`. |
| §9 T3, F-23 | "founder `set-paused true`" | Flags are `--paused <true\|false>`; `parseBool` rejects anything else (`admin.ts:117-119, 755-762`) | CHANGED | Write it as `set-paused --paused true`. A bare `set-paused true` is invalid. |
| §9 T7, F-29 | "release UI-A, forfeit UI-B" as two `admin.ts` commands | Only one exists. `forfeit-escrow --pool-id <u64> --player <pubkey>` (admin-signed, `admin.ts:88-91`). **There is no `release-escrow` command** — release is settlement-signed and reached through the review service (`detection/src/review.ts:220-226`, `POST /decisions`) | CHANGED | F-29 is two tools; see §E3. |
| §4.2 | ENVIRONMENT.md fields | `status` prints admin, entry signer, settlement signer, paused, open tiers, tier prices, tier pots, reserve pots, min platform, reserved, refundable, kyc threshold, detection block, next pool id, keeper, fill deadline, cooldown, tier next open at, platform balance. It does **not** print VRF, geo mode, device/ip status or the RPC in use | HOLDS with additions | Template extended. The missing four come from elsewhere. |
| §4.6(b) | "floor … from `admin.ts status`" | The ingredients print; **the floor is computed nowhere in `admin.ts`** | CHANGED | CAPITAL.md does the arithmetic by hand, including the rent cushion per reserved pot and `refundable`. |
| §4.3 | tooling: `solana`, node ≥ 20, ts-node, playwright | No `solana`/`anchor` CLI in this container; `tsx` is used by newer CI scripts; Playwright is an `app/`-local dependency | CHANGED | `keys.ts` replaces `solana-keygen`; §4.12 step 4's `solana transfer` needs a web3.js transfer instead. |
| §4.3 | RPC selection unspecified | Three names, not interchangeable: `admin.ts:1087` reads **`RPC_URL` first**, then `BLOTTO_RPC_URL`; `check-deployed.ts:53` reads **`BLOTTO_RPC_URL` only**; `resolveRpcUrl` refuses a mainnet URL under devnet | CHANGED | Set **both** `BLOTTO_RPC_URL` and `RPC_URL` to the same dedicated endpoint. |
| §2.1 | founder "runs every `admin.ts` write" (direct-signed implied) | **`config/custody.json` names the devnet admin as a Squads vault** `9EEW…e34Z` (multisig `9EL1…mFyN`, threshold 1, one member). Direct signing needs `FEE_PAYER_KEYPAIR`; the vault path is `--emit-proposal --admin <vault>` plus an approval round | **CHANGED — founder question Q6** | With the plan in §G, only two admin writes remain in the whole week, so this matters twice rather than six times. |
| §4.1, §8.1 | `admin.ts pools` not mentioned | It exists and is the drain query; prints `fill_deadline` per pool; **exits 1 while any pool is Sealed, Scored or Refunding** (by design) | **NEW — add it** | The only read that shows per-pool deadlines and confirms the next pool opened. A non-zero exit during a refund is the verdict working, not a failure. |

### F2. The blocker: tier 1 cannot be opened

`set-open-tiers` refuses to open any tier whose **live** economics differ from the ratified table (`admin.ts:721-747`).

| tier | live on chain | ratified (`prizes.ts:91-121`) | can be opened? |
|---|---|---|---|
| 0 | price 0.1 SOL, pot 4.0 SOL | 0.1 / 4.0 | **yes — and it is already open** |
| 1 | price 0.5 SOL, **pot 25.6 SOL** | 0.5 / **20.0** | **no** |
| 2–6 | 38.4 / 51.2 / 128 / 256 / 384 SOL | 30 / 40 / 100 / 200 / 300 | no |

Tiers 1 to 6 still carry the superseded 80%-of-gross derivation; only tier 0 was ever updated to the ratified D-E1 value. So **F-11 (`set-open-tiers --tiers 1,1,…`) would be refused today even without the manual's tier-1 shrink** — and the shrink in §4.9 is precisely the mismatch the refusal exists to prevent. §4.9 and §4.10 are mutually exclusive as written.

Opening tier 1 properly would mean `set-tier-economics --tier 1 --price 0.5sol --pot 20sol` and then funding a **20 SOL** pot from the treasury. That is far beyond a faucet-funded devnet week. **Recommendation in §G: run every test on tier 0.**

### F3. Tests, fixtures and measured costs

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §6.1 | "`orchestrator.ts` already sequences this over `FakeChain`; the devnet version swaps in the real RPC" | **It does not.** `runOfflinePool` seals into a memory store and then **fabricates** the entry rows, writing the pool straight to `Sealed`. No `register`, no packet, no HTTP. Its own header says "The devnet rehearsal is a different thing entirely" | **GONE** | `enter.ts` gets the **sealing half only** from the orchestrator. The register leg must be mirrored from `app/src/entry/submit.ts` and `backend/reveal/src/chain-web3.ts`. **This is materially more work than the manual assumes** — it lands in WP4. |
| §4.13 | "`enter.ts` dry-runs against LiteSVM" | LiteSVM is a **Rust** crate driven by hand-encoded Rust instructions; a TypeScript script cannot dry-run against it | CHANGED | Pin `enter.ts`'s encoding against the byte layouts in `tests/litesvm/src/lib.rs` and `backend/reveal/test/chain-web3.spec.ts`, which pin the same encodings in TypeScript. |
| §4.8 | "measure the per-entry sunk cost" | **Already measured and committed.** `docs/INFRASTRUCTURE.md:120-124`, devnet 2026-09-11: the player pays **0.104436 SOL** — 0.1 entry, 0.002613 Entry rent, 0.001808 pass rent, 0.000015 fees. **Sunk per entry = 0.004436 SOL** | **CHANGED — the work is done** | Quote INFRASTRUCTURE.md; confirm with the first real entry. The manual's "2 × 5000 lamports" is 3 signatures, 0.000015 SOL. |
| §4.12 | headless target 0.2 SOL | 0.104436 × 1.2 = 0.125; 0.2 is ~1.9× | HOLDS | Generous and safe. |
| §4.4 | `solana-keygen` loop; `echo keys/ >> .gitignore` | No `solana` CLI here; and `keys/` is **already ignored twice** (root `.gitignore:21`, `battle-test/.gitignore:1`). A pre-commit hook also rejects any staged 64-integer array | CHANGED | Replaced by `keys.ts`. Verify with `git check-ignore -v battle-test/keys/wallets/00.json`. |
| §4.13 | "a sacrificial tier-4 pool" | Tier 4 is not open and cannot be opened (F2), and tier ≥ 1 has R6 preconditions including a written counsel opinion | GONE | Drop it, or accept a tier-0 pool at a 4 SOL pot. |

### F4. Config and custody — answers the manual asked for

| Question (§4.2) | Answer | Source |
|---|---|---|
| Entry signer | `9Xhw…y8TP`, **Turnkey, non-exportable** | `config/custody.json`; cross-check against `status` (they agree today) |
| Settlement signer | `EaDf…jrSD`, also the **keeper** on devnet | same |
| Admin | `9EEW…e34Z`, a **Squads vault** (threshold 1, one member) | same |
| Upgrade authority | `GXKX…agXY`, single operator key on devnet | same |
| Irys upload wallet | `HG56…w7uL` | same |
| Terms version | **2**, updated 2026-09-06 | `config/terms.json` |
| Geo posture | **block-list**, 14 codes blocked (AE AU BE BH CN HK ID IN KW MY OM QA SA SG); GB is not blocked | `config/territories.json` |
| Geo mode (stub or vendor) | **UNKNOWN from the repo** — it depends on deployment secrets. The stub "admits every address as GB" | `.github/workflows/deploy-backend.yml:85` |
| Reviewer registry | **one** member, `4ydb…wcL1` | `config/reviewers.json` |
| Tier table location | `backend/scoring/src/prizes.ts`, **not** `config/` | — |

**The geo trap.** If the deployment runs the vendor rather than the stub, an address the vendor cannot resolve is **refused in every posture**. Headless entries originate from this cloud container. That is the single most likely cause of a mass `enter.ts` failure, and it is not visible from the repo. **First WP4 task: request one packet for one derived wallet and see whether the geo gate passes.** A packet is a short-lived signed attestation; requesting one enters no pool and costs nothing.

### F5. CI — what a battle-test PR actually triggers

| manual § | says | repo has | verdict | fix |
|---|---|---|---|---|
| §2.4, §2.5 | implies only the battle-test lane runs | **`ci-fast` has no path filter at all.** A PR touching only `battle-test/**` runs the whole of it: rust, nine node packages, the app build, a real Postgres with 21 migrations, Playwright, gitleaks, and the standing-rules lane | **CHANGED** | Every freeze PR costs a full run (~20 min). **Budget it into §8.3** — the founder's merge waits on CI. Adding `battle-test/package.json` also starts firing `security-sweep` (`**/package.json`). |
| §12 | "anything under `docs/` runs through `check-language.sh`" | The gate greps the **whole tree** from the repo root, on every PR | **CHANGED** | `battle-test/**` is in scope — the manual, the log, every `CARD.md`. Confirmed by the three word swaps this session. |
| §2.4, §4.14 | "gitleaks stays green" | Keys are safe (ignored twice, absent from a clean checkout). **But** `.gitleaks.toml:18-21` has a custom rule matching **any JSON array of exactly 64 integers under 1000** — it already fires on a committed fixture. A `plan.json` holding a 64-element integer seat map, rank order or leaf order **will trip the identical rule**, and the lane scans this branch's own commits, so deleting the file later does not clear it | **CHANGED — design around it** | `plan.ts` and `harvest.ts` must never emit a bare 64-element integer array. Emit arrays of objects (`[{"seat":0,"rank":1},…]`). A `wallets.json` of base58 address strings is unaffected. |
| §11 | a results gate | Not built; belongs in the new `rehearsal.yml` | HOLDS (to build) | — |
| — | `stop-the-line.yml` | Watches ci-fast, on-chain and deployed-drift on **main** and auto-opens an issue **assigned to the merging author** | new | A freeze PR merged red files an issue against the founder. Warn in §8.3. |
| — | boundary check | Not built. Good news: `check-env-examples.sh` and `check-standing-rules.sh` do not reach a new top-level package, so battle-test needs no `.env.example` rows | HOLDS (to build) | — |

### F6. `fan-out.ts` against current conventions

Keypair loading (`FEE_PAYER_KEYPAIR`) and the amount parser are **character-identical** to `admin.ts`. Commands, batching bounds and the idempotent top-up all behave as §4.12 describes. Two fixes:

- **RPC (real divergence).** `fan-out.ts:43` hard-codes the public devnet endpoint and reads only `RPC_URL`; it does not use `resolveRpcUrl`, `BLOTTO_CLUSTER` or `BLOTTO_RPC_URL`. With only `BLOTTO_RPC_URL` set it silently uses the public endpoint — exactly the throttling that already 429'd tonight. **Until patched, always pass `--rpc` explicitly.** Fix is one import, and is in scope because the file lives in `battle-test/`.
- **Cosmetic.** Its header says "the 64 entrant wallets"; it loads every `*.json` in the directory, so 72 works. Update when next touched.

`§4.12` step 4 (`solana transfer` to the three UI wallets) cannot run here. It becomes a web3.js transfer or a `fan-out.ts` extension.

---

## G. What this means for the week

### G1. Every test runs on tier 0

Tier 1 cannot be opened (F2), and opening it properly would cost a 20 SOL pot. Tier 0 is already open, already carries ratified economics, and has a 4 SOL pot at a 0.1 SOL entry. So the manual's two-tier design — full pools on tier 0, the refund chain in parallel on tier 1 — collapses to **one tier, strictly sequential**, because pools per tier are sequential by D-A1.

That is not as costly as it sounds, because the founder's own cadence absorbs it. A deadline test occupies a 12-hour cycle; a full pool settles minutes after its 64th entry. Alternating them fits the 11:00 / 23:00 rhythm exactly:

| Pool | Test | Opens (local) | Settles / closes | Founder slot |
|---|---|---|---|---|
| 14 | **T1** refund, sparse (12 seats) | tonight ~22:48 | ~10:48 Wed | 23:00 and 11:00 |
| 15 | **T4** full — UI-A wins | Wed ~10:58 | ~11:40 Wed | 11:00 block |
| 16 | **T5** full — headless wins | Wed ~11:45 | ~12:30 Wed | 11:00 block |
| 17 | **T6** oversubscribed + load | Wed ~12:35 | ~13:20 Wed | 11:00 block |
| 18 | **T7** same-device → review | Wed ~13:25 | ~14:30 Wed | 11:00 block |
| 19 | **T2** refund at 39 | Wed ~22:48 | ~10:48 Thu | 23:00 and 11:00 |
| 20 | **T3** seal at 40 + pause | Thu ~10:58 | ~22:58 Thu | 11:00 and 23:00 |
| — | **T8** verify + recompute | Thu desk work | — | any |

**T3 changes character and improves.** At exactly 40 seats it seals at its deadline and pays its winner. That exercises `seal_at_deadline`, the boundary the program actually defends, and the R7-b fork the site advertises — a better test than a third refund. T2 at 39 is the boundary from below.

### G2. Founder actions that disappear

- **F-03** (merge the change-control PR, deploy): the 12-hour decision is already live. Nothing to merge. A deploy is needed only if `check-deployed` reports drift, and that check is blocked on the dedicated RPC.
- **F-04** (`set-tier-economics --tier 1`): deleted. Tier 1 is not used, and the command would make tier 1 unopenable.
- **F-11** (`set-open-tiers --tiers 1,1,…`): deleted. Tier 0 is already open; the call would be refused.
- **F-05** (`fund-platform-wallet`): probably unnecessary. When pool 13 refunds its untouched pot, the treasury returns to about 5.997 SOL, and opening the next tier-0 pool needs 4.0 pot + 0.00065 cushion + 0.5 floor = about 4.5 SOL, with no idle-tier reserve because tier 0 is the only enabled tier. Held in reserve as a contingency.

**Two admin writes remain in the whole week**: `set-paused` on and off for T3's pause test, and `forfeit-escrow` for T7. Both need the Squads question answered (Q6).

### G3. Capital, with the measured numbers

| Item | Figure | Source |
|---|---|---|
| Entry price, tier 0 | 0.1 SOL | chain |
| Pot, tier 0 | 4.0 SOL, pre-funded from the treasury at open | chain |
| Sunk per entry (not refunded) | **0.004436 SOL** — Entry rent 0.002613, pass rent 0.001808, fees 0.000015 | `docs/INFRASTRUCTURE.md:120-124`, measured devnet 2026-09-11 |
| Sunk per pool opened | **0.00065024 SOL** — the vault rent cushion, never recovered | measured tonight, §C |
| Headless top-up target | 0.2 SOL each × 72 = 14.4 SOL | §4.12, ~1.9× the measured per-entry cost |
| UI wallets | 0.5 SOL each × 3 = 1.5 SOL | §4.12 |
| **Faucet target** | **~18 SOL** including margin | — |

Money recirculates: entries flow to the treasury, refunds come back from it, prizes come from the pre-funded vault. A full pool takes in 6.4 SOL of entries and pays out a 4 SOL pot, so the treasury **grows** on played pools. Only rent and fees are ever truly spent.

### G4. Tonight — what can and cannot be frozen before pool 14

A refund test needs **no scoring oracle**: nothing is ranked, and the prediction is that every entry returns exactly `entry_lamports` while rent stays sunk. So T1's plan can be frozen tonight honestly, without waiting for `plan.ts`, the population generators or the Merkle work. The full pools need all of that and are Wednesday's work.

If `enter.ts` is not ready inside T1's 12-hour window, the nine headless seats reconcile as **ABSENT** — the verdict that exists for exactly this — and the three UI seats still prove the refund. The test degrades honestly rather than failing.

### G5. Unresolved rows

**0.** The manual was amended in place on 2026-09-15 (banner plus §0.1, §0.3, §1, §3.1, §4.0, §7.3,
§9 and §12), so every *changed* or *gone* row above is now carried in the document a reader picks up
cold. `FOUNDER-ACTIONS.md` carries the founder-facing rewrite. Every row above is either carried into the manual amendment in this PR, or recorded as an explicit founder question below. The five questions do not block WP0; they block specific later actions, named per question.

| # | Question | Blocks | Recommendation |
|---|---|---|---|
| Q6 | ~~Is the live `Config.admin` signed directly, or through the Squads vault?~~ **ANSWERED FROM THE CHAIN 2026-09-22 — the vault, and it could never have been anything else.** | T3's pause (F-23), T7's forfeit (F-29) | `Config.admin` = `9EEW…e34Z`, matching `custody.json`. It is **off the ed25519 curve**, so it is a PDA and **no private key exists for it anywhere** — it can only sign by CPI. Not a policy question: arithmetic. But the multisig is **1-of-1**, so the "approval round" is one signer, not a committee. |
| Q7 | ~~Who holds the reviewer key `4ydb…wcL1`?~~ **ANSWERED 2026-09-22 — it is the Bank wallet, and it is the SAME key as Q6's approver.** | T7 entirely | Decoded the multisig account (90 bytes): a borsh vec length of **1** at offset 54 followed by one 32-byte on-curve key ending at the tail — `4ydb…wcL1`. So the sole reviewer IS the sole multisig member. `docs/devnet-rehearsal-runbook.md` calls it the **Bank wallet** ("funds entrants; Squads member") and C0.1 has the founder connect it to Squads **through Phantom on devnet**. Holds 24.658749732 SOL, 10 transactions, last 2026-09-11. |
| Q8 | Is the packet service running the **geo stub** or a **vendor**? | every headless entry | I will test this myself with one packet request rather than ask you to find out. Recorded here because a vendor refusal would explain a mass failure. |
| Q9 | The Playwright route needs a **self-built app** with the test-signer flag, and the spec must be written from scratch. Build it, or record quota 0 against roadmap 5.1? | WP4 scope | Recommend **quota 0** and a recorded reduction. The direct route proves the chain path; the Playwright route proves the browser path, and building it would cost more than the week has. Your call. |
| Q10 | Tier 1 to 6 carry superseded economics on chain. Fix them, or leave them? | nothing in this test | Recommend **leave them** and log it as a product follow-up. Changing them is a founder-owned economics action with no bearing on a tier-0 week. |

---

## H. Findings discovered in execution (after WP0)

Section A–G above is the WP0 drift check: the manual read against the tree at `66a43d8`, finished
2026-09-15. This section is different. It carries what **running** the tests found, which WP0 could
not have found by reading — each row dated, each traced to source, and each one a product finding
rather than a manual correction.

### H1. A refunded pool never reveals its sealing secret (2026-09-16, found by T1)

**What was observed.** Pool 14 (`FZDhx4PU…afaL`) reached its deadline with 12 of 40 seats,
refunded all twelve correctly, and reached `Closed` at 13:50 UTC. Seventy-five minutes later its
secret was still unpublished — `secret_revealed` read as `0` **directly from the pool account at
offset 158**, not from the indexer. It is still `0` now.

**Why.** Not a delay, not a race. There is no code path that can do it.

| # | Link in the chain | Evidence |
|---|---|---|
| 1 | The **program permits** the reveal, and says why in its own words: *"allowed once the pool is `Sealed`, or past the fill deadline (a `Refunding` pool's entrants can then verify no one — operator included — could have read allocations before the refund)"*. The gate is `state != Open \|\| past_deadline`. | `programs/blotto_cup/src/instructions/reveal_commit.rs:43-60` |
| 2 | The **only** production caller of `revealPoolSecret` is inside `assembleBundle`. | `backend/reveal/src/crank.ts:395-397` — sole non-test call site, verified by grep across `backend/` and `scripts/` |
| 3 | `crankPool` returns for a `Refunding` pool **before** `assembleBundle` is reached… | `backend/reveal/src/crank.ts:179-188` |
| 4 | …and no-ops for a `Closed` one. `assembleBundle` is called at `:196`, after both. | `backend/reveal/src/crank.ts:189-192` |
| 5 | The daemon's own trigger list never includes `Closed`, so once refunds finish nothing re-enters the pool. | `backend/reveal/src/daemon.ts:294`, `:209` (`TERMINAL = ['Paid','Closed']`) |
| 6 | There is **no operator fallback**: `admin.ts` has 21 commands and none of them reveals a secret. | `scripts/admin.ts:1094-1140` |
| 7 | Custody is **not** what blocks it. The export policy is `state !== 'Open' \|\| now > fillDeadline`, which a closed pool satisfies. The secret would be released if anything asked. | `backend/reveal/src/main.ts:332-337` |

**Corroboration across the whole devnet history.** Every pool that has ever closed by refund — 9,
10, 11, 12, 13 and 14 — reports `secret: null`. Not one has ever revealed. This is not pool 14.

**Verdict: GONE.** The reveal_commit doc comment's promise — that a refunding pool's entrants can
verify nobody read their allocations — is not delivered by any code in this tree.

**Consequence for the test.** T1's twelve allocations stay `COMMITTED` permanently; `VERIFIED` is
unreachable for them. **T2 (39 seats) will hit the same wall** — expect it, do not re-diagnose it.
T3 onward seal and score, so `assembleBundle` runs and those allocations verify normally.

This does **not** change T1's verdict. T1 tested the refund path and every frozen prediction held.

**Proposed fix — NOT made here.** It is a few lines in `backend/`, which is outside this week's
source boundary, so it is written down and left alone: reveal before the refund fork returns. The
natural shape is to hoist steps 1's export-and-reveal out of `assembleBundle` into `crankPool`
ahead of the `Refunding` branch, so both forks pass through it, and to let the `Closed` branch
reveal too when `!pool.secretRevealed` — that second half is what would repair pools 9–14
retroactively, since the on-chain gate still accepts them today. An `admin.ts reveal-secret`
command would be the smaller alternative and would leave the promise dependent on an operator
remembering. **Founder decision, after the week (F-20).**

### H2. The 15-second per-screen timer is not what the client runs (2026-09-16, found preparing T4)

**What still says 15 seconds.** `CLAUDE.md` lists "the per-screen timer (15s, R9)" among the
founder-owned numbers with published consequences, the manual assumes it, and `Pool.timer_seconds`
reads 15 on every pool on chain. (`FOUNDER-ACTIONS.md` §F-12 already carried the real rule — it was
corrected during the manual amendment on 2026-09-15 — so this row is about the documents that still
do not, and about what the rule means for a SCORED test, which T1 did not have to care about.)

**What the live client does.** One **90-second run clock for the whole run**, started at the player's
FIRST dial interaction (never at payment confirmation, so a slow wallet does not eat it), idempotent
thereafter. On expiry every battle **not locked in — the one on screen included** — is entered as the
**even split `[20,20,20,20,20]`**.

| Evidence | |
|---|---|
| `app/src/battle/run-clock.ts:54` | `RUN_CLOCK_BUDGET_MS = 90_000` |
| `app/src/battle/run-clock.ts:36-45` | starts on first interaction; expiry enters the even split, via `machine.ts`'s `lockAllRemaining` |
| `app/src/battle/run-clock.ts:47-52` | R9 and the on-chain `Pool.timer_seconds` "remain ratified and untouched on-chain; the client simply no longer presents time per screen", and the rules-page copy does not change until counsel signs off |
| `admin.ts status` / indexer | `timer_seconds: 15` is still on every pool, and nothing reads it |

**Verdict: CHANGED.** R9 is not repealed and the field is still on chain; the client stopped
presenting it. This is a founder-and-counsel matter for the rules page, not an architect one, and it
is recorded here rather than acted on.

**Consequence for the test, which is the reason this was chased.** T4 needs UI-A to play a wall and
UI-B a pole in **all seven** battles. If the run clock expires on an unlocked battle, that battle
becomes the even split — three stats at 20, none at 26 — which is neither role and would break the
prediction for that battle. So the founder instruction is built around the real clock: **two dial
drags per battle for UI-A, one for UI-B, lock in each battle, 90 seconds for all seven.**

The exact sets that recipe produces were not chosen — they were computed by running the app's own
`rebalance` from `EVEN_SPLIT`, and `src/populations.test.ts` re-derives all fourteen drags through
`app/src/components/blot/rebalance.ts` and fails if they ever stop matching `uiWall()`/`uiPole()`.
The alternative — asking the founder to dial thirty-five arbitrary numbers under a 90-second clock —
would have failed in the pool rather than in a test.

### H3. The entry gate was closed for everyone, and `/health` said it was fine (2026-09-16, found by T4)

**RESOLVED 18:56Z, and the cause is confirmed: the Turnkey signing quota was exhausted.** The
section below is kept as written, with the correction and the evidence at the end — the reasoning
under uncertainty is part of the record, including the part I got wrong.

**What was observed.** At 18:20Z the founder's UI-A entry was refused with the generic
`entryRefused` copy. It is not their account and not the browser. Probed from this container with
wallets we control — packet requests only, nothing registered:

| probe | result |
|---|---|
| W62, fresh attestation accepted (204), pool 15 | **403** `entry_unavailable` |
| W00, which entered pool 14 successfully at 02:18Z today, pool 14 | **403** |
| W00, pool 15 | **403** |
| W00, pool 15 after re-attesting (204 accepted) | **403** |
| W63, never attested (control), both pools | **403** |
| `GET /geo` | **200 `{"allowed":true}`** |
| `GET /health` | **200 `{"ok":true,"screening":{"ofac_loaded":true}}`** |

So: every wallet, both pools, regardless of attestation. Server-side and total.

**What it rules out.** The `/attestation` route returning **204** proves the database is up and that
the deployed terms config matches `config/terms.json` exactly — the route verifies the signature
against its own `{version, updated}`, so a mismatch could not have stored. `/geo` returning
`allowed: true` clears territory, the sub-national region rule and the VPN check, which is
everything `geoVerdict` tests. Terms are still v2, unchanged since 2026-09-06.

**The mechanism, from the code.** `issuePacket` wraps every check in one try/catch and answers
`GENERIC_REJECTION` on any throw, deliberately, so the gate is not probeable
(`backend/packet/src/service.ts:312-399`). Two things inside it can throw for every caller at once:

1. **A stale OFAC mirror.** `screen()` (`service.ts:199-207`) does not catch, and
   `OfacSdnList.screen` **throws** past `maxAgeMs` — "a stale mirror is a failed source, never a
   clean answer" (`backend/sanctions/src/ofac-sdn.ts:200-208`, limit 36 h). A failed refresh
   **keeps the old list and raises no flag**: `wire.ts:355-360` logs "refresh FAILED (previous list
   kept, refuses past 36 h)". The mirror is the only source configured here — `/health` lists
   `ofac-sdn mirror` and a per-address cache, nothing else — so a throwing mirror is a throwing
   screener is a refused entry, for everybody.
2. **A signing failure.** `deps.signer.sign()` throws into the same catch. The module's own header
   says this was once indistinguishable from a blocked territory.

**And `/health` cannot tell you which, or even that anything is wrong.** `ofacLoaded` is set true at
boot and **never set back to false** (`wire.ts:275, 283, 343`) — not when a refresh fails, not when
the snapshot ages past its limit. The one endpoint an operator checks reports `ok: true,
ofac_loaded: true` while the entry gate refuses every entry on the planet.

**Verdict: this is a product finding, and a serious one.** Not drift against the manual — a live
failure mode. On devnet it costs a test. On mainnet it is a complete revenue outage that a health
check, a status page and an uptime monitor would all report as healthy, for as long as nobody tries
to enter. The staleness watch (B-28) does alert, so the alert path exists; what is missing is the
one signal the operator actually reads.

**What distinguishes the two causes: one log line.** Both throw into the same catch, which prints
`packet: entry packet NOT issued — <reason>`. A stale mirror names itself ("mirror is N h old
(limit 36 h)"); a signer fault carries the signer's error. That is a founder action — we do not hold
the deployment credentials — and it is F-22.

**Do NOT simply restart the service.** If the mirror download is what is broken, `wireScreening`
**refuses to boot** when the mirror is the only configured source — "a service that starts here
screens nobody" (`wire.ts:295-305`). A restart would turn a closed gate into a service that will not
come up at all. Read the log first, then decide.

**Consequence for the test.** T4 cannot run until the gate reopens. Pool 15's plan is frozen and its
deadline is 01:52:26Z; if the gate is still shut near it, pool 15 refunds and T4 moves to the next
pool. That is a reschedule, not a failure, and the frozen plan is reusable as-is — only `poolId`,
`poolPda` and the freeze record change.


#### The answer, from the live log

The founder read `blotto-packet`'s log. It names the cause with no ambiguity:

```
18:30:21  packet: geo ALLOW 35.239.x.x — packet issued: country=US
18:30:21  packet: entry packet NOT issued — Turnkey error 8: Resource exhausted:
          Signing is disabled because your organization is over its allotted quota.
          Please upgrade to a paid plan, or reach out to the Turnkey team.
```

**It was cause 2, the signer. Not the mirror.** I offered both, then leaned toward the stale mirror
on the strength of "release v43, three days ago". That was wrong, and the evidence against it was
already in hand when I said it: `/health` reported `ofac_loaded: true`, and — decisively — the
failing entries reached the signer at all, which means every gate check before it had already
passed, sanctions included. A boot after the restart put it beyond doubt:
`ofac-sdn mirror loaded — 19385 entries, 1043 digital-currency addresses, published 09/16/2026`,
refreshing every 540 min exactly as designed.

The warning not to restart blindly was still the right call, for the wrong reason. Once the log
showed entries reaching the signer, the boot-refusal risk was gone and the restart was safe — which
is what was then recommended, and the service came back clean.

**The log also confirmed the probe method.** The never-attested control appears as
`geo BLOCK 146.148.x.x — packet refused: attestation-missing-or-stale`, refused for precisely the
reason it was built to be refused for.

**Resolution.** The founder upgraded the Turnkey plan. Signing resumed at **18:56:02Z** — eight
consecutive `200`s on the probe, and `200` for UI-A and UI-B's own addresses. Total outage: at least
sixteen hours, from some time after T1's last entry at 02:18Z.

#### What survives, and it is the part that matters

**The health-endpoint finding stands, and the true cause sharpens it.** `/health` returns `ok: true`
with `ofac_loaded: true`, and reports **nothing whatever about the signer** — the component that
actually failed. Every check an operator or an uptime monitor would run stayed green through a total
entry outage. It was still green at 18:50, after the restart, with the gate shut. The fix is not
"report mirror staleness"; it is that **every condition which closes the gate for all callers must
be readable from the health endpoint.** The uniform rejection exists to stop a player probing the
gate; it should not also hide the gate's state from the operator. Those are different audiences and
the code answers both with one silence.

**The signer-identity boot line proved its worth.** `signer-select.ts` prints
`entry signer = TURNKEY (key 79672a…709c, org ba9f83…9414, pubkey 7ebb34…a4b6)` because a
deployment once silently fell back to the development seed and nothing looked wrong from outside.
Here it served a second purpose nobody designed it for: naming the exact organisation to upgrade, so
"did you upgrade the right org?" was answerable in seconds.

### H4. A failed packet logs that it was issued, one line before it fails (2026-09-16)

`service.ts:363` logs `packet issued: country=…` **before** calling the signer, which is the next
statement. So every failed packet emits a line claiming issuance, immediately above the line saying
it was not issued — visible twice over in the founder's screenshot at 18:30:21 and again at
18:50:04. An operator grepping for issuance gets one false positive per failure, and a rate of
"packets issued" computed from this log would have read normal throughout the outage.

**Fix:** move the line after the signature succeeds, or reword it to `packet cleared` — it is
logging that the *gate* passed, not that a packet exists. One line either way.

### H5. Two services share one Turnkey organisation, and a settlement retry spends quota (2026-09-16)

Chasing why roughly twelve signatures exhausted a quota: it was not a leak, it is the total.

| operation | Turnkey activities | where |
|---|---|---|
| `createPoolKey` at pool open | 2 (`initImportPrivateKey` + `importPrivateKey`) | `custody-turnkey.ts:250,260` |
| each entry | 1 (`signRawPayload`) | `signer-turnkey.ts:60` |
| `exportSecret` at settlement | 1 (`exportPrivateKey`) | `custody-turnkey.ts:297` |

The packet service and the settlement daemon use the **same** `TURNKEY_ORGANIZATION_ID`
(`backend/reveal/src/main.ts:161-172`). Fifteen pools and about thirty entries since late August is
on the order of seventy-five activities for the whole month — a small allowance consumed gradually,
with T1's twelve entries merely the ones that crossed the line.

Two consequences:

1. **T4 alone costs about 65 activities** — 64 entry signatures plus one export — in roughly ten
   minutes, nearly the whole month to date. The remaining matrix is ~450 more. A plan sized for
   tonight and not for the week puts the ceiling back in the middle of a filling pool, with real
   money in it.
2. **A retrying settlement spends quota.** `exportSecret` is called at the top of every crank pass
   (`crank.ts:395`), *before* the guard that refuses to settle against a short entries read — a
   guard whose whole design is to throw and retry next tick. Each retry is another Turnkey activity.
   Not a bug; worth knowing before a settlement starts looping.

### H6. A failure between sealing and registering bars that wallet from that pool forever (2026-09-16)

**The worst finding of the test so far.** It is not a theory: it happened to the founder tonight, on
both accounts, and the mechanism is measured rather than inferred.

**The order.** `app/src/entry/submit.ts:99-100` stores the sealed ciphertext and *then* requests the
entry packet:

```ts
await services.putCiphertext(input.pool, input.player, ciphertext);   // :99
const packet = await services.requestPacket(input.pool, input.player); // :100
```

**The gate.** `backend/packet/src/ciphertexts.ts` refuses a second, *different* allocation for a
seat that already has one — audit D-01, and correct on its own terms: the ciphertext write happens
before the chain's duplicate check, so without it a second run would destroy a player's own paid
entry. Re-posting the SAME bytes is idempotent, so an ordinary network retry is unaffected.

**But a replay is never the same bytes.** The salt is fresh per run, so a player who plays again
produces a different ciphertext and is refused.

Measured on W63 (outside T4's field), pool 15, 19:09Z:

| post | result |
|---|---|
| first seal | `204` stored |
| same bytes again | `204` — idempotent, as documented |
| **different bytes** | **`409 {"error":"already sealed"}`** |

**And there is no way back.** `backend/sealing/src/store.ts` gives `CiphertextStore` exactly two
methods, `put` and `get`. No delete exists anywhere in the tree — not in the store, not in the
service, not in `admin.ts`.

**What it did tonight.** During the Turnkey outage (§H3) the founder played seven battles on UI-A.
The app sealed and stored the ciphertext — successfully — and then asked for a packet and was
refused. Every retry since has produced a fresh salt, hit the 409, and rendered the SAME generic
`entryRefused` copy, whose text reads *"Trying again will not change the answer"*. That sentence is
true and for a reason neither the player nor the app can discover. Both UI accounts are permanently
barred from pool 15, having paid nothing and entered nothing.

**Why this is worse than the outage that exposed it.** The Turnkey quota was a billing fact, fixed
in an hour. This is structural: **any** transient failure after the seal — the entry service
blipping, a wallet prompt dismissed, a laptop lid closed, a browser tab crashing — permanently
removes that wallet from that pool. On mainnet, a single entry-service blip does not merely fail the
entries in flight; it bars every player who got as far as sealing from that pool for good, while
telling them nothing. A pool can be left unable to fill by players who would gladly pay.

**Verdict: GONE** — the product's implied promise that a failed entry can be retried does not hold
after the seal.

**Proposed fixes, not made here.** Two, and the second is the honest one:

1. **Reorder**: request the packet before storing the ciphertext (`submit.ts`). Cheap, and it closes
   tonight's exact sequence — but it only narrows the window, it does not remove it. A failure
   between the ciphertext write and the register still locks the seat.
2. **Gate the overwrite on the chain, not on the store.** The condition that actually distinguishes
   "paid seat, must not be overwritten" from "abandoned attempt, safe to replace" is whether an
   `Entry` PDA exists on chain for that wallet and pool — which is exactly what audit D-01 was
   reaching for. Refuse the overwrite only once the seat is really registered. That preserves the
   protection completely and removes the lockout, at the cost of one account read per ciphertext
   write.

**Consequence for the test.** T4 cannot run on pool 15: it requires UI-A to win, and UI-A cannot
enter. Pool 15 lapses at its deadline and T4 moves to the next pool. The frozen plan is reusable
unchanged — only `poolId`, `poolPda` and a new freeze record move, and no predicted rank or payout
changes. Cost: one rent cushion, 0.00065 SOL.

**Operational rule for every future test, from now on:** probe the entry gate for the exact wallets
immediately BEFORE the founder plays, never after. A seal made into a broken gate cannot be undone.

#### Guardrails built, 2026-09-16 (inside the source boundary)

The product fix belongs in `app/` and `backend/` and is specified, not applied, in
`battle-test/docs/FIX-seal-lockout.md`. What the test could defend itself with, it now has:

1. **`scripts/preflight.ts`** — the go/no-go check that must exit 0 before anybody plays. Proves the
   pool is Open and register-ready (vrf seed committed, pass collection created), that no named
   wallet is already seated, and that the entry gate issues a real packet **for each named wallet
   against this pool** — the exact call the browser is about to make, per wallet, because the gate
   decides per wallet. It requests packets and nothing else.
   **Its limit is stated in its own output:** it cannot see whether a wallet is ALREADY barred,
   because there is no read path for that. Run against pool 15 it reported GO for both founder
   accounts, which were already barred. That is why part 3 of the fix adds a wallet-authenticated
   read.
2. **`enter.ts` stops on the first burnt seat.** A `sealed` flag is set the moment a ciphertext is
   stored; a seat that sealed and then failed is named as permanently barred, and the run halts
   instead of marching into the next batch. Proven on pool 15: W64 sealed, failed to pay, the run
   stopped, and **W65 was never touched**. Against a broken gate this turns sixty-two losses into
   one.
3. **`--simulate` no longer seals** — see §H7, which is the same defect in my own tooling.

### H7. My own "safe" mode was not safe, and it burnt a wallet (2026-09-16, self-inflicted)

Found while proving the §H6 guardrail. `enter.ts --simulate` announced
`SIMULATE (no state written)` and its header said "a simulation writes no state, so it carries none
of that risk". **Both were false.** The simulate path ran `attest` → `putCiphertext` → `requestPacket`
and only then simulated — so the mode built to be safe stored a ciphertext, which under §H6 cannot
be replaced or deleted. It permanently barred every wallet it was run on.

It had already done so to **W62 on pool 15**, at 19:07Z, and I did not notice until the guardrail
run refused W62 with `409 already sealed` and I had to explain why a wallet I had only *simulated*
was sealed.

**Fixed.** `register` needs the battles hash and the entry packet; it never needs the stored
ciphertext, which is read only at reveal. So the write is skipped under `--simulate`, which costs
the simulation nothing and makes the claim true. The banner now reads
`SIMULATE (nothing sent, nothing sealed)`.

**Verified rather than asserted:** after a `--simulate` run, W66's first-ever ciphertext write
returned `204`, proving the simulate had not sealed it.

**Why this is in the record.** The same mistake in the same shape as §H6 — an action with an
invisible, irreversible side effect, behind a name that promised safety. I wrote the tool, wrote the
claim, and used it. It is here because a test whose own instrument has a landmine in it should say
so, and because the manual's rule "never dry-run against devnet" was aimed at SENDING and missed
this entirely.

**Spare wallets burnt on pool 15 in the course of this work**, none of them in T4's field
(W00–W61), and pool 15 is being abandoned: W62 (the old simulate), W63 (the §H6 proof), W64 (the
guardrail proof), W66 (the fix verification).

### H8. My own runner burnt five wallets, and the guardrail is why it was only five (2026-09-17, T4)

Five headless seats sealed and then failed to register on pool 16, barring each permanently under
§H6: **W22, W42, W43, W55, W65**. The entry gate was healthy throughout — probed `200` at every
step. The fault was this runner's transaction handling.

| # | wallet | error | cause |
|---|---|---|---|
| 1 | W22 | `Blockhash not found` | concurrency 4, Helius answering `429`; preflight simulated against a node that had not seen the blockhash |
| 2-3 | W42, W43 | `Blockhash not found` | same, at concurrency 2 — at which point I stopped guessing and read the send path |
| 4 | W55 | `block height exceeded` | **my first fix was wrong.** I took a `finalized` blockhash, which is ~32 slots old and spent most of its validity window before the send |
| 5 | W65 | `block height exceeded` | the corrected fix was in place; this one still timed out under load |

**The real cause and the real fix.** `sendAndConfirmTransaction` was left to pick its own blockhash,
and the failure was always in its **preflight simulation**, never in the send. `skipPreflight: true`
removes the entire failure class: preflight's only job is to catch a malformed transaction, this
one's shape is proven by `--simulate` and by 58 landed seats, and a transaction that fails on chain
burns the wallet either way — so preflight buys nothing here and costs seats. Paired with a
`confirmed` blockhash for the full validity window. The last six planned seats and all four
substitutes landed clean afterwards.

**Why it was five and not sixty.** The §H6 guardrail stopped the run on each first burnt seat rather
than marching into the next batch. Measured at every stop: 23 of 62 seats attempted, then 18, then
11, then 6 — each halt leaving the untouched wallets intact. Without it the first `429` storm would
have burnt every remaining seat in the field.

**Substitution, and why the prediction survived it.** Each burnt seat was replaced by a spare
playing **the burnt seat's own frozen allocation** (`enter.ts --substitute W22=W62,…`), funded by
sweeping the burnt wallets back to the funder. A rank falls out of the allocations, never the wallet
holding them, so the field the engine scored was exactly the field the plan predicted. Only the
results root moved, and it was conditional on seat order from the start.

**Recorded against myself.** This is the second time in two days my own tooling carried an
irreversible side effect (§H7 was the first). The lesson is the same both times: on a path where
failure is permanent, the runner must stop, and every "safe" mode must be proven safe rather than
named safe.

### H9. `reconcile.ts` did not check a scored pool at all — it returned MATCH unconditionally (2026-09-17, T4)

**AMENDED the same day, and the amendment is worse than the original.** This row first said harvest
could not fetch the revealed allocations, so input drift went unseen. That was true but not the
point. Reading the code to fix it showed the scored-pool branch was a **stub**:

```ts
} else {
  // Scored pools: compare money first, then rank.
  verdict = 'MATCH';
  note = 'scored-pool reconcile lands with the first full pool';
}
```

It compared **nothing**. Every seat in a scored pool was handed `MATCH` before anything was looked
at. T4's first reconcile reported `60 MATCH · 0 RANK_DRIFT · 0 PAYOUT_MISMATCH · 0 INPUT_DRIFT` and
**none of those four numbers was a measurement.** A verdict that cannot fail is not a verdict.

The headline claim survived only because it was checked by hand against the chain's own committed
payout list, the published leaderboard and the wallet balances — not because reconcile said so.

**Fixed.** `harvest.ts` now fetches the published bundle from the `uri` on
`/pools/<pda>/leaderboard` and records, per seat, the revealed `battles`, the rank, the score and
the amount paid — and recomputes `sha256(battles ‖ salt)` against the `battles_hash` the chain
recorded at entry. `reconcile.ts` now compares money, then rank, then the allocation itself, and
raises `PAYOUT_MISMATCH`, `RANK_DRIFT` or `INPUT_DRIFT` accordingly.

**T4 re-run against the real check:**

| | first run (stub) | real check |
|---|---|---|
| MATCH | 60 | **58** |
| RANK_DRIFT | 0 | **0** — every field rank exactly as predicted |
| PAYOUT_MISMATCH | 0 | **0** |
| INPUT_DRIFT | 0 | **2** — UI-A and UI-B, played by hand |
| ABSENT | 4 | 4 |
| verdict | PASS | **PASS** |

All 64 revealed allocations reproduce their committed hashes. The verdict is unchanged; what changed
is that it now rests on evidence rather than on a placeholder.

### H9-a. The original symptom, kept because it is its own defect


T4's reconcile reported **0 INPUT_DRIFT**. That number is a limitation, not a fact.

The founder's two seats were played by hand on the live dials, and the published bundle shows both
drifted from the frozen plan — **UI-A matched the plan in only 1 of 7 battles, UI-B in 4 of 7**.
`reconcile.ts` did not notice, because `harvest.ts` never fetches the published bundle: it reads the
indexer and the chain, and since PR 134 removed `/sealed-entries` there is no allocation to compare
against. It compares ranks and payouts, which matched, and reports `MATCH`.

**Fix:** `harvest.ts` should fetch the bundle from the `uri` on
`/pools/<pda>/leaderboard` — it is public, it carries every revealed `battles` — and record the
revealed allocations per seat. `reconcile.ts` can then compare them to the plan and raise a real
`INPUT_DRIFT`, and `allocations.ts` can finally move seats from `COMMITTED` to `VERIFIED`, which it
currently cannot do for the same reason (T4 shows 60 COMMITTED, 0 VERIFIED, on a pool that revealed
its secret).

**This does not weaken T4's PASS** — the verdict rests on rank and payout, both confirmed against
the chain's own committed payout list. It means the report must say "input drift not checked"
rather than "no input drift", and it is written that way.

### H10. The unconditional derivation is the finding, and it held (2026-09-17, T4)

The plan split its expectations in two: **unconditional** (UI-A rank 1 and paid the whole pot, UI-B
last, nobody else paid — derived from the shapes alone) and **conditional** (exact scores, the leaf
order, the results root — which assume the exact allocations).

The founder, dragging dials against a 90-second clock, produced a wall that matched the plan's exact
numbers in **one battle of seven**. Every conditional prediction about their allocations was
therefore wrong.

**Every unconditional one was exactly right.** All seven of UI-A's battles still held three stats at
26 or above — the only property that matters — so:

- UI-A: **rank 1**, paid **4000000000** lamports, the entire pot.
- UI-B: last, paid nothing.
- No other seat paid: the chain's committed list is `[{"seat":0,"amount":"4000000000"}]`.

The one score difference is fully explained: predicted 881 half-points, actual **882**. The plan's
wall drew its seventh battle with the pole (2 stats each, nobody reaching 3); the founder's actual
battle 7, `[36,1,33,0,30]`, carried a 1 where the plan had a 0, which won that stat and turned the
draw into a win — one extra half-point, and the theoretical maximum of 63 × 7 × 2.

**This is a better outcome than a clean match would have been.** A test where the founder reproduced
35 numbers perfectly would have proved the arithmetic. This proved the *derivation*: the claim was
"rank 1 holds for ANY wall against a field capped at 25", and a genuinely different wall, played by
a human under time pressure, took rank 1 and the whole pot.

### H11. The secret scanner caught me committing a pool secret, and the fix was to stop storing it (2026-09-17)

CI on PR 144 failed one check — `gitleaks`, one finding:

```
rule=generic-api-key
  file=battle-test/registry/T4.actual.json:17
```

Line 17 was `"revealedSecret": "2e1289d4…c5cb"` — pool 16's X25519 sealing secret, written there by
`harvest.ts`.

**Was it a leak? No, and that is not the point.** The pool secret is published BY DESIGN: the
program emits it on chain in `reveal_pool_secret`'s event, and the published bundle carries it in
its `secret` field. Anyone can read it from two public places. Committing it disclosed nothing.

**Why it was still wrong.** Nothing in this tooling uses the VALUE — `allocations.ts` reads it only
as a boolean, to decide whether a seat can move from `COMMITTED` to `VERIFIED`. So a 64-character
high-entropy string sat in a committed file, used for nothing, where a scanner must flag it and a
human must then triage it. The repo's `.gitleaksignore` header sets the bar for an exception: "an
entry states what the value is, why it is not a secret, and how that was established." That bar
could have been met. **It should not have been reached.**

The honest fix is the founder's own data-minimisation ruling applied to the test's own files: do not
store what you do not need. `harvest.ts` now writes `secretRevealed: true` — the only fact anything
consumes — and a verifier who wants the secret takes it from `sources.publishedBundle`, which the
same file records, or from the chain. The evidence chain is unbroken.

**That fix was half a fix, and I called it done.** I wrote the paragraph above, pushed, and told the
founder to merge. The lane failed again, and the log named the half I had missed:

```
Scan working tree ........ passed — no leaks found
Scan the git history ..... FAILED — leaks found: 1
  rule=generic-api-key  file=battle-test/registry/T4.actual.json:17
  commit=b64d770aa
```

Removing a value from the tip does not remove it from a commit that is already pushed. The lane has
two steps for exactly that reason, and the second is the one that matters: a scanner that read only
the working tree would let anyone launder a live credential out of view with one follow-up commit
while it stayed valid in the history. The gate is built so that cannot happen, and it caught me
doing it by accident.

**The finding was never at the commit I recorded.** I wrote `0d0a4c8` from memory. It is at
`b64d770`, the commit that recorded T4 PASSED. The log said so and I had not read the log before
writing it down. Twice in two days now: the Turnkey diagnosis (§H3) and this. Read the evidence
before recording the conclusion.

**What the value is, established three ways rather than asserted:**

1. An unauthenticated `GET https://blotto-indexer.fly.dev/pools/EgbFPxSR…` returns this exact value
   in its `secret` field. Fetched again while resolving this.
2. `sha256(value)` sits at byte offset 84 of the LIVE on-chain Pool account for
   `EgbFPxSRgtc8hd68vbxjsQ8irYAifen7Zxf5uYNkrngq` — its `sealing_secret_hash`, committed at
   `open_pool` and checked at reveal. The chain therefore commits to this value being pool 16's
   secret, and no other value can satisfy that hash.
3. The raw bytes are NOT in the Pool account (searched; offset -1). They are in the event log,
   exactly where `reveal_commit.rs`'s module doc says reveal puts them: reveal "publishes the pool's
   X25519 secret ON-CHAIN (in the event log) ... the verifiability spine".

So: published by design, nothing to rotate, and removing it from the history hides nothing from
anybody.

**Two candidate resolutions, and why the second was rejected.**

*(a) Remove it from the branch's own commits.* Chosen. The commits are strictly linear, no tracked
file references any of their hashes, and the freeze records are anchored on merged-change
timestamps, the plan's own sha256 and on-chain signatures — not on git identity. So the rewrite
costs the evidence chain nothing, and it leaves nothing behind.

*(b) A justified `.gitleaksignore` entry.* Written first, and it works — verified, history scan
clean, exit 0. Rejected on two counts. First, `.gitleaksignore` lives at the REPOSITORY ROOT, and
the `boundary` lane refuses any change outside `battle-test/`: fixing one red check would have made
another red, and shipping it separately is a second change for the founder to merge. Second and
decisively, it leaves a permanent root-level exception naming a `battle-test/` file — and the
standing constraint on this whole exercise is that deleting `battle-test/` at the end leaves the
product exactly as it was. An ignore entry is precisely that kind of leftover.

I argued the opposite first — that rewriting an evidence commit would damage what the test exists to
demonstrate — and then checked instead of assuming. Nothing references the commit hashes. The
objection was real but did not survive contact with the repository.

**How the rewrite was done, and what was proven before anything moved.** The commits were rebuilt
with git plumbing (`read-tree` / `commit-tree` against a scratch index), replacing one line in
`T4.actual.json` — `"revealedSecret": "<value>"` becomes `"secretRevealed": true`, the same form the
harvester now emits. Nothing else in any file changes. The whole operation was rehearsed first in a
throwaway clone and four things checked there before the real branch was touched:

| proof | result |
|---|---|
| final tree byte-identical to the original tip | PASS — same tree, so the working files are unchanged |
| author, committer and both dates preserved per commit | PASS — all four matched to the second |
| the value present in no commit of the new history | PASS — 0 commits add or remove it |
| gitleaks history scan, pinned v8.30.1, same range shape as CI | PASS — no leaks found, exit 0 |

The superseded commits were `b64d770 · 0d0a4c8 · 94ef10b · 7be5335`. They are written down rather
than quietly dropped, so the rewrite is auditable: anyone still holding those objects can diff them
against what the branch now carries and confirm that one line changed and nothing else.

**A note for mainnet.** A mainnet pool secret is the same kind of value and equally published, but
do not reason by analogy from this entry. The harvester no longer stores it at all, which is the
durable fix; the rewrite was cleanup after the fact.

Worth noting the likely trigger: `resultsRoot` and all 64 per-seat `battlesHash` values are 64-hex
strings too and did not fire. The rule keys on the FIELD NAME, and the field was called
`revealedSecret`. Renaming it to a boolean removed the value and the trigger together.

**Also checked, not assumed:** no salt is stored anywhere (the per-seat hash check fetches salts
from the bundle at harvest time and keeps only the boolean result), no field named secret/key/token
carries a long value, and no 64-integer array — the Solana keypair shape the `solana-keypair-json`
rule guards — appears in any registry file.

**The check did its job.** It is the second time in two days that a gate I did not write caught
something I did: the language gate on §8.7 wording, and now the secret scanner. Both are cheap and
both were right.


### H12. My runner burnt four more wallets, and again it was concurrency, not the gate (2026-09-18)

T5's headless run stopped after 52 of 62 seats with four burnt — W48, W49, W50, W51 — each
`SEALED THEN FAILED`, each barred from pool 18 permanently (§H6).

**The log names the cause and it is not the product.** A storm of `429 Too Many Requests` from the
public devnet RPC, then `Signature … has expired: block height exceeded`. Rate limiting delayed
confirmation past the blockhash window. The entry gate answered every request; nothing in `app/`,
`backend/` or `programs/` misbehaved.

This is §H8's family a second time: **the runner's own transaction handling, not the thing under
test.** §H8 was a blockhash chosen badly; this is too many senders at once. `--concurrency`
defaults to 4, and four parallel senders against `api.devnet.solana.com` is over its limit.

**The fix, and the proof it is the fix.** The remaining 14 seats — W52..W61 plus four substitutes
playing the burnt seats' own frozen allocations — were re-run at `--concurrency 1`. Result:
**14 of 14 landed, zero 429s, zero burnt.** Same gate, same RPC, same code, one knob. That is as
close to a controlled experiment as this week gets.

**The guardrail justified itself again.** The §H6 stop halted at the first casualty. Without it all
ten remaining seats would have been burnt the same way, and pool 18 would have finished short of 64.

**A second bug, found while fixing the first.** `--wallets` was silently IGNORED whenever `--plan`
was given: the plan supplied the seat list and the flag did nothing. So a part-way run could not be
resumed on the seats that were left — the only option was re-attempting all 62 and burying the real
failures in `already registered` noise. `--wallets` now SELECTS from the plan's seats, while
`fromPlan` is still built from the full list so a substitute can find its burnt seat's allocation.

**Cost:** four wallets, 0.4 SOL of devnet entries that bought nothing, and about twenty minutes of a
ninety-minute window.

---

### H13. Both founder wallets timed out into the even split — and it manufactured the strongest detection signal (2026-09-18)

Every revealed battle for UI-A and UI-B in pool 18 is `[20, 20, 20, 20, 20]`. All seven. Both
wallets. That is not a choice; it is `RUN_CLOCK_BUDGET_MS`, the ninety-second budget covering all
seven battles, expiring and defaulting every unlocked battle to the even split.

**What I told the founder beforehand, and what it was worth.** I said the clock could not break the
test, because the even split keeps every stat between 1 and 25 and the unconditional claim was
`rank 2..63`. That part held exactly: both finished **rank 62**, paid nothing, inside the range.

**What I missed in the same breath.** I also told them the two rotations differed *on purpose*,
because two identical sets trip `duplicate_sets` — the one allocation signal that hard-blocks. Then
the timer made them identical anyway. I checked the rank property and did not check the property I
had myself just named. The reassurance was right and incomplete, which is worse than either.

**Confirmed by running the product's own code**, not inferred: `duplicateSets` from
`backend/detection/src/signals.ts` over the 64 revealed sets returns exactly two findings —

```
UI-A  severity=strong  exact 35-byte duplicate battle set  correlated=["UI-B"]
UI-B  severity=strong  exact 35-byte duplicate battle set  correlated=["UI-A"]
```

`strong` is the only severity `isHardBlockFinding` accepts for this signal.

**Nobody was flagged, and that is correct.** `backend/reveal/src/main.ts:389` is explicit: detection
is computed and persisted for every pool but **nothing is flagged by the daemon**, and
`report.hardBlocks` is deliberately not returned — a flag is a reviewer's decision through
`flag_entry`. On-chain both seats read `flagged: false`, no sanctions hold. I checked before
claiming a gap, and there is no gap here.

**The finding that survives, and it is a product one.** The strongest single signal in the detection
suite — described in its own comment as "35 identical bytes between independent humans is
near-impossible" — is **manufactured by the product's own timeout default**. Two honest players who
both run out of time produce a byte-identical pair. There is no exemption for the even split in
`duplicateSets`. It scales quadratically: k timed-out players in a pool produce k(k−1) strong
findings, every one of them hard-block-eligible, every one a false positive.

A reviewer who trusts "strong / exact duplicate" would block players whose only mistake was running
out of time — players who have paid an entry. **This is for the founder and counsel, not for me:**
it touches who gets blocked and why.

Worth stating for scale: this happened on the FIRST pool where two humans played. It is not exotic.

---

### H14. A pass criterion no tool checked — and the check, run by hand, passes (2026-09-18)

T5's frozen `passCriteria` has eight items. One is:

> "The recomputed results root equals the on-chain results_root."

**Nothing verifies it.** `reconcile.ts` line 229 *prints* `Results root: …` and never recomputes
anything. This is §H9's sibling: a stated criterion whose satisfaction was being asserted by
display. §H9 was a verdict that could not fail; this is a criterion that was never tested.

**So it was computed by hand**, from published data, using the product's own canonical tree
(`backend/scoring/src/merkle.ts` — the same module the verify page bundles):

```
on-chain root   : 0e1d6b87140f8696ef9252a3d1858c48133ce196b265b6c1881668af5b193bcc
recomputed root : 0e1d6b87140f8696ef9252a3d1858c48133ce196b265b6c1881668af5b193bcc   MATCH
```

Two things had to be got right, and the first attempt got both wrong:

1. `merkleRoot()` takes **leaf bytes** and applies the `0x00`-prefixed leaf hash itself. Pre-hashing
   double-hashes and produces a plausible, wrong root.
2. **Rank order alone does not determine leaf order.** UI-A and UI-B tied at rank 62, so the tree's
   leaf sequence is ambiguous from ranks. Breaking the tie by seat index ascending reproduces the
   on-chain root; breaking it the other way does not. That is why the published bundle carries a
   `leaf_order` at all — the same field whose 64-integer shape trips the Solana-keypair rule in
   `.gitleaksignore`.

A player recomputing their own payout hits both. The verify page must break ties exactly this way,
and the rule deserves to be written down somewhere a player can read rather than inferred from a
matching root.

**FIXED 2026-09-18 — the check is now automatic and it gates the verdict.**
`reconcile.ts` rebuilds the tree from the harvested per-seat data on every run,
compares it to the chain's `results_root`, prints `VERIFIED` or `FAILED`, and
folds the result into PASS/FAIL. Proven to be capable of failing, because a
check that cannot fail is what §H9 was: one lamport was moved off the winner's
payout in a copy of `T5.actual.json` and the run reported
`FAILED — MISMATCH` and `RESULT: FAIL`. The evidence was then restored from git
and confirmed byte-identical.

Run against every settled pool: **T4's root verifies too** (a second,
independent confirmation of the scoring engine and the tree), and T1 — a refund
pool with no root — takes the no-root path and still passes.

**A correction to the paragraph below.** I wrote that the gateway "returned an
empty body twice tonight" and that the evidence chain depended on a third party
staying reachable. The gateway was fine. It answers `302` and my `curl` was not
following redirects; `harvest.ts` uses `fetch`, which follows them by default,
which is why it worked throughout. Fetched with `-L` it returns `200` and 29 KB.

The archiving point survives in weaker form and is worth stating correctly: the
bundle is not stored in the repository, and it should not be — it carries the
pool `secret`, so committing it would re-create §H11 exactly. It does not need
storing. Its contents are checkable against a root the chain committed before
anyone could read them, which is what the fix above now does on every run. A
tampered bundle cannot reproduce that root.

**Superseded, kept for the record:** the published bundle is fetched from `gateway.irys.xyz` at harvest time and
is NOT archived under `evidence/`. That gateway returned an empty body twice tonight. The evidence
chain currently depends on a third party staying reachable; it should keep its own copy.


### H15. My own fix specification had the key wrong, in the direction that fails OPEN (2026-09-18)

`docs/FIX-seal-lockout.md` part 1 — the central fix, the one the whole document calls "the actual
fix" — specified this lookup:

```ts
'SELECT 1 FROM entries WHERE pool = $1 AND player = $2 LIMIT 1',
[poolId.toString(), player]
```

**`entries.pool` does not hold the numeric pool id.** It is `TEXT` holding the pool's base58 PDA
(`backend/_shared/migrations/0003_derived_tables.sql:28`), written from `EntryRegistered.pool`
(`backend/indexer/src/projection.ts:126`) and read that way by the read API
(`backend/indexer/src/read-api.ts:286`). The ciphertext STORE is keyed by the numeric id — that is
`pool-ids.ts`'s whole reason for existing — and I carried the store's key into a query against a
different table.

**Which way it breaks matters more than that it breaks.** Passing the id matches zero rows for every
player. Zero rows reads as "this seat is not registered". "Not registered" ALLOWS the overwrite. So
the bug would have silently allowed every overwrite, including the one case the gate exists to
refuse: a player destroying their own PAID entry, whose `battles_hash` the chain already holds. The
result is an entry scored all losses. That is failing open, on a money path, in a fix whose own
document says twice that it must fail closed.

It was caught by reading the migration and both projection call sites before writing the code —
`CLAUDE.md`'s branch-state rule, which says to verify every reference against the source rather than
work from docs. The specification was a doc.

**Fixed, and pinned so it cannot come back.** `backend/packet/src/seats.ts` takes the pool ADDRESS
and says why in its module comment. A test registers a seat under the numeric id, proves the gate
stays open, then registers the same seat under the PDA and proves it closes — so the wrong key fails
the suite instead of passing it quietly.

**The general shape, which is the part worth keeping:** two keys for the same object, each correct
in its own table, and a type (`bigint` vs `string`) that does not stop you swapping them because
`.toString()` is always available. The specification read plausibly for exactly that reason.


### H16. I broke a live test by sending 1 SOL without asking what it was for (2026-09-18)

At 19:00Z the founder asked me to send 1 SOL to `CRCK62mRC4zxsFRAx41g4MbQzGqsJQD3SURM7Te4VnhW`. I
checked the address was valid base58, on-curve rather than a PDA, absent from the roster, and that
the funder could afford it. I wrote "T6 funding is unaffected" and sent it inside two minutes.

```
19:04:05Z   the transfer lands
19:07:24Z   that wallet registers into pool 20 — seat idx=39, the 40th
```

**Pool 20 was T2, and T2's entire hypothesis is "39 seats, one below the boundary."** At 40 =
MIN_SEATS the chain's `outcome_if_deadline_now` flipped from `refund` to `seal`. T2's frozen
prediction fails on its headline claims: `entrants: 39`, `sealsAtDeadline: false`,
`settlementInstruction: trigger_refund`.

**The question I did not ask was "could this affect the test that is running right now?"** I had
everything needed: I wrote the sentence "39 is the point of the test" myself, hours earlier, and
T2's own contingency section says in terms that crossing the fork "would turn this into T3." I
checked the transfer against the wrong thing — next week's budget instead of tonight's live pool.

**What it cost, and what it did not.** T2 is SPOILED, not disproved: nothing was learned that
contradicts the boundary claim, and nothing about the program misbehaved. The 39 seats and their
sealed allocations are intact; the pool simply crosses the fork and plays instead of refunding.

**The rule that follows, and it is narrow enough to keep.** While a named test's pool is open, no
wallet outside its seat list gets funded without checking the seat count first. Written into
`T2R.plan.json` as a stated limitation rather than a private habit, because the same thing can be
done by a stranger on a public devnet and no procedure of ours prevents that.

---

### H17. I recommended a partial freeze on pool 20, then reversed it — the freeze could not have failed (2026-09-18)

With pool 20 about to seal at exactly 40, I proposed freezing a partial prediction over its
settlement: `Paid` not `Closed`, `seal_at_deadline` not `trigger_refund`, one seat paid exactly
4000000000, vault 650240, per-seat sunk 4441080. The pitch was that the fork-at-40 evidence is
otherwise unavailable this week.

**Then I tested the idea against the one question that matters — could any of it have come out the
other way?**

| claim | could it fail? |
|---|---|
| `Paid`, `seal_at_deadline` | No. The pool holds 40, `MIN_SEATS` is 40, the rule is public. Already determined and readable by anyone. |
| one seat paid `4000000000` | No. `PAID_RANKS = 1`, `PRIZE_BANDS_1024 = [1024]`. Constants. |
| vault `650240` | No. Measured identically on three settled pools. |
| per-seat `4441080` | No. Same. |

Every line was already known. That is a verdict that cannot fail, dressed as a prediction — **§H9
and §H14 in a third disguise**, and I was about to write it into the record having logged both.

The one genuinely uncertain thing — who wins — is the one thing that cannot be predicted here, since
three of the forty allocations are sealed and unknown to us.

**The cost of doing it would not have been neutral.** This week's value rests on every number being
backed by a prediction frozen before the outcome could be known. A record that does not meet that
bar dilutes the ones that do: a careful reader finds a freeze that could not fail, a casual one
over-credits it.

**Pool 20 is therefore recorded as a plain observation and claims nothing.** The boundary claim is
retried properly on the next pool (`registry/T2R.plan.json`), frozen before that pool exists —
which is a stronger freeze than T2's own, and available only because the retry was forced.


### H18. THE EVEN SPLIT WON. Two players who ran out of time beat the whole field and took the pot (2026-09-19, pool 20)

This is the most serious finding of the test, and it is not a bug. Every component behaved exactly
as specified.

**What happened.** Pool 20 sealed at 40 and scored. Both founder wallets had timed out into the
even split again — all seven battles `[20,20,20,20,20]`, one distinct shape each, exactly as in
§H13. This time the even split **won**:

```
rank 1   UI-A   426 half-points   2000000000 lamports
rank 1   UI-B   426 half-points   2000000000 lamports
rank 3   W06    318 half-points            0
rank 4   W18    310 half-points            0
```

A margin of 108 half-points over the best seat that actually played. Two players who touched
nothing took the entire 4 SOL pot between them, and **the 38 players who played got nothing.**

**Verified, not inferred.** The 40 revealed sets were re-scored from the published bundle through
`backend/scoring/src/engine.ts` — the product's own engine, run independently of the daemon that
produced the result. **40 seats compared, 0 mismatches**, same ranks, same scores, same payouts.

**The tie is correct behaviour and is documented as such.** `prize_math.rs::split_group` states it
in terms: "a tie for first splits the ENTIRE pot k ways and nobody else is paid". `split_group(pot,
1, 2) = (2000000000, 0)`. The chain did what the spec says.

**WHY it won, which is the part that matters.** The 38 field seats were generated by
`poolPopulation` — `random`, `consistent` and `clustered` profiles — and every one of them
concentrates: **max stat between 44 and 88, all 38 of them above 25**, several carrying zeroes.
All-vs-all scoring rewards whatever wins the most head-to-head stat comparisons. An allocation that
dumps 67 points into one stat wins that stat and loses the other four. The even split wins four of
five against it.

**THE PUBLISHED COPY IS FALSE AS WRITTEN, and it is text a player reads.** Twice, in
`app/src/copy/index.ts` — once in the timer explanation and once in the rules:

> "The even split is the weakest allocation in the game. Against any allocation that concentrates
> points on three stats, an even split loses that battle three stats to two, every time."

The second sentence names its own condition — *three* stats — and is true under it. The first
sentence is unconditional and is **false**: against a field that concentrates on one or two stats,
the even split is strong, and here it was the strongest thing in the pool by a wide margin. One
counterexample settles an unconditional claim, and this one is on chain at 40 seats.

**WHY §H13 AND T5 SAW THE OPPOSITE.** In pool 18 the same two even-split entries ranked 62 of 64.
That field was `cappedField` — no stat above 25 — built so a "wall" would win. A capped field is
exactly the population the even split loses to. Pool 20's field was uncapped. **The same allocation
came last in one pool and first in another**, and nothing about it changed. That is the finding in
one line: the even split's strength is a property of the field, not of the allocation, and the copy
asserts it as a property of the allocation.

**FOUNDER AND COUNSEL, NOT ME.** PID §8's characterisation rests on the competition being one of
skill. "The players who did nothing beat every player who played, and split the whole prize" is a
direct attack on that, and it happened on the first pool where a realistic uncapped field met a
timeout. It also makes the timeout default a *strategy*: a player who learns this wins by closing
their laptop.

**What is NOT established, stated so the finding is not overclaimed.** This field is OUR generator,
not humans. Whether a field of real players concentrates the way `poolPopulation` does is unknown,
and that is now the question worth answering. What IS established: the unconditional sentence in
the published copy is false, the timeout default can win outright, and a tie at rank 1 pays nobody
else at all.

---

### H19. §H17 said these claims "could not fail". One of them just did (2026-09-19)

Hours before pool 20 settled I proposed freezing a partial prediction over it, then reversed on the
grounds that every claim was already knowable. One of the four was this:

> "one seat paid exactly `4000000000` — No. `PAID_RANKS = 1`, `PRIZE_BANDS_1024 = [1024]`.
> Constants."

**Two seats were paid, 2000000000 each.** Had that freeze been written, it would have FAILED on its
headline payout line.

**The constants were quoted correctly; the inference from them was wrong.** `PAID_RANKS = 1` fixes
how many *ranks* are paid, not how many *players* — `split_group` divides rank 1's band among
everyone tied for it. The payout shape is not a constant; it is conditional on there being no tie
at the top.

**And the error was visible in my own reasoning at the time.** In the same message I wrote "I cannot
predict who wins — three of the forty allocations are sealed and unknown to me", and then treated
the payout amount as independent of who wins. A tie *is* a fact about who wins. The two statements
contradict each other and I did not notice.

The decision not to freeze was still right, but for a weaker reason than I gave: three of the four
claims genuinely could not fail, and the fourth could — which means the freeze would have been
*falsifiable after all*, and would have caught something real. **I talked myself out of the right
action using an argument that was partly wrong.** Recorded because the reasoning error is more
useful than the outcome: a constant naming ranks is not a constant naming players, and "X cannot
fail" deserves the same scrutiny as "X will happen".


### H20. "4441080 per seat, measured on three pools to the lamport" was never true (2026-09-19, T2R)

T2R's frozen plan predicts a single per-seat cost and says so in the strongest terms available:

> "THIS NUMBER IS NOW MEASURED, NOT ESTIMATED … Three settled pools have since measured the same
> figure to the lamport … T2R predicts 4441080 EXACTLY for every one of the 39 seats — a single
> lamport of drift on any seat is a failure, not rounding."

**29 of the 39 seats came in at 4446160.** Ten were exact. The split is clean and it is not at a
wallet id — it is at **seat index 10**.

```
seat  8, 9   pass asset 92 bytes   rent 2617600   sunk 4441080
seat 10, 11  pass asset 93 bytes   rent 2622680   sunk 4446160
                        +1 byte         +5080         +5080
```

**The cause, measured rather than guessed.** Every entry mints a Core pass asset named
`BLOTTO PASS #<pool>-<seat>`. A two-digit seat index is one character longer than a one-digit one,
the account is one byte bigger, and one byte of rent on devnet is **5080 lamports**. The program is
behaving perfectly; rent scaling with a name is exactly right.

**IT WAS ALWAYS LIKE THIS AND I NEVER LOOKED.** Probing the earlier pools' pass assets directly:

```
T1 (pool 14, 12 seats)  seat 0: 92 bytes   seat 9: 92   seat 10: 93   seat 11: 93
T4 (pool 16, 64 seats)  seat 0: 92 bytes   seat 9: 92   seat 10: 93   seat 63: 93
T5 (pool 18, 64 seats)  seat 0: 92 bytes   seat 9: 92   seat 10: 93   seat 63: 93
```

So on T1 two seats already cost the higher figure, and on T4 and T5 **fifty-four of sixty-four did**.
The claim "three settled pools measured the same figure to the lamport" describes a measurement I
did not actually make: I read early seats, got 4441080, and generalised it to whole pools. Then I
repeated it in `STATE.md`, in `T2.plan.json`, in this file, and finally wrote it into a frozen
prediction as the sharpest claim in the document.

**This is the §H9 / §H14 family a third time** — asserting from a display rather than a measurement
— and this time it survived long enough to be frozen. What makes it worse than those two is that I
kept restating it as *more* certain each time: "estimated" became "measured", then "measured to the
lamport", then "a single lamport of drift is a failure". Nothing new was measured between those
restatements.

**The correct model, for whoever predicts this next:**

| seats | pass asset | per-seat sunk |
|---|---|---|
| 0–9 | 92 bytes | **4441080** |
| 10–63 | 93 bytes | **4446160** |

A 64-seat pool therefore sinks 10 × 4441080 + 54 × 4446160 = 284 502 440 lamports, not
64 × 4441080 = 284 229 120. The gap is 273 320 lamports a pool, which is small money and a large
hole in a claim that called itself exact.

---

### H21. reconcile printed PASS without checking the claim that failed (2026-09-19)

`reconcile.ts` reported **RESULT: PASS** for T2R — 39 MATCH, 0 drift — while 29 seats missed the
plan's per-seat prediction. It is not wrong about what it checked; it never checked this at all.
`grep` over the script finds **no occurrence** of `perSeatSunk`, `sunk`, or `4441080`. Its verdict
is built from:

```
frozenOk && PAYOUT_MISMATCH === 0 && !directDrift && stateOk && vaultOk
  && rootCheck.ok && unknownEntrants.length === 0
```

**§H14 said this exact thing about the results root** — "a stated criterion whose satisfaction was
being asserted by display" — and the fix then was to implement that one check. The general lesson
was available and I took the specific one: I verified the root and did not ask which *other* pass
criteria had no code behind them.

**Why it could not have been checked anyway, which is the deeper gap.** Per-seat cost is
`startingBalance − balanceAfter`, and the harvest records only `balanceAfter`. No plan in this
project declares a starting balance, so the sharpest numeric claim in T2R's plan was **unverifiable
from the evidence the run collects** — a criterion that could not have passed or failed. The fix is
both halves: plans declare the starting balance, and reconcile prints NOT CHECKED, loudly and
without passing, whenever a stated criterion has no data behind it.


### H22. The even split is the MIDDLE of three tiers — and the founder's question found the answer (2026-09-19)

§H18 reported that the even split won pool 20 and took the whole pot, and raised it as a threat to
the skill characterisation. The founder then asked the two questions that settled it: *"I thought we
proved the even split cannot win?"* and *"what if everyone did that?"*

**The first question was right, and the proof exists.** `docs/skill-evidence/REPORT.md` publishes a
0.000% rank-1 rate for the `uniform` class at both 64 and 40 seats, framed as *"stronger than a
statistical one"* — *"they never place first and never take a lamport."* Re-running it reproduces
exactly: **0 of 400 pools**.

**And the study's field is half the one shape the default loses to by construction.** Its ladder is
`uniform`, `random`, `heuristic`, `optimised` — and `heuristic` and `optimised` are *defined* as
three-stat concentration. So the 0.000% is a property of the FIELD, not of the allocation.

Measured over 400 pools of 40, with the product's own engine:

| the other 39 seats | default's rank-1 rate | median rank |
|---|---|---|
| the study's mixed ladder | **0.0%** (0/400) | 26th of 40 |
| three-stat concentrators only | **0.0%** (0/400) | **40th — last, every pool** |
| arbitrary free-integer allocations | **100.0%** (400/400) | **1st** |

**Three tiers: deliberate beats the default totally; the default beats careless totally.** Pool 20's
field was the bottom tier — 38 seats concentrating on one or two stats with zeroes elsewhere, which
is *worse than not playing*. The default did not beat skill. It beat unskilled play.

**Why the published metric could not show this.** Rank-1 rate and paid-seat rate are zero for every
class except the winner, so the middle tier and the bottom tier **both read 0.000% and look
identical**. The superlative was never supported by the study's own data — within those runs the
`uniform` class outscores the `random` class.

**The second question is the one that resolves the legal worry, and the answer is clean.** If every
seat leaves the default, all 40 score identically, all 40 tie for first, the pot divides 40 ways,
and each entrant receives **exactly their entry back**. Nobody profits. Introduce ONE three-stat
player and they win **outright** and take the **entire** pot — 200 of 200 pools, both classes.
**One deliberate entrant is enough to make doing nothing pay zero.**

So the correct framing for counsel is not "the players who did nothing took the pot" but **"the
default is a break-even floor that any deliberate player beats totally."** That is a stronger skill
story than the report previously told, because the gradient is total in both directions.

**What I got wrong in §H18, and it was a framing error rather than a factual one.** Every number
there is correct. But I presented the result as "doing nothing wins" and took it to counsel in those
terms, when one more measurement — the one the founder asked for — showed doing nothing cannot win
against anybody who thinks, and cannot profit even when it wins. I had the engine and the
populations in hand both times. The difference was asking "what if everyone did this?", which is the
first question anyone should ask of a claimed dominant strategy.

**Corrected in PR 154**, with four regression tests pinning all three tiers and the all-default case,
because a published claim with no code behind it rots silently and this project has had three
(§H9, §H14, §H21).

---

### §H23 — the per-seat check I wrote yesterday only worked on a pool that REFUNDED

`checkPerSeatCost` (§H21, written 2026-09-18) computed the sunk cost as
`startingBalance − balanceAfter`. That is correct for a refunded seat and **wrong for every seat in
a pool that pays**, because the entry never comes back and the winner is paid 4 SOL on top:

```
refunded   balanceAfter = start − sunk                    →  sunk = start − after
paid pool  balanceAfter = start − entry − sunk + prize    →  sunk = start − after − entry + prize
```

T2R refunded, so the only pool the check ever ran on was the one case where the naive difference
happens to be right. On T4, T5 or T6 it would have reported DRIFT on all 64 seats — including a
winner whose "sunk cost" would have come out at about **−3.9 SOL** — and the number would have been
wrong in a direction that looks like a catastrophe rather than a typo, which is its own kind of
noise in a report.

**This is §H9's family again and I am naming it as such**: a check written against the one case in
front of me, not against the cases it would next be asked about. The fix is in the same function and
the formula above is in the code.

Two other things went in with it, both from §H20 rather than new:

- `perSeatSunkLamports` may now be `{ seats0to9, seats10plus }` as well as a scalar, so a plan can
  state the two figures the cost actually has instead of one it already knows is wrong for most of
  the field. T6's plan uses the object form.
- A plan can only be checked against a **known** starting balance, so T6's plan declares one and the
  fill is preceded by `fan-out fund --target 0.155sol`, which funds every wallet UP TO a target and
  therefore leaves all of them at exactly 155000000.

- A plan may name wallets the prediction does **not** cover, with the reason, in
  `perSeatSunkExcludes`. T6 excludes `UI-A`: the founder's wallet is not funded by `fan-out`, so its
  starting balance is whatever it is on the day. The check reports its figure and grades nothing on
  it, and prints the exclusion in the reconcile line — a silent skip is the failure this check
  exists to stop.

**Proven in both directions on real data before being believed**, as §H21 was. Running the new check
over T5's harvested balances with a declared start of 150000000:

| prediction | result |
|---|---|
| `{seats0to9: 4441080, seats10plus: 4446160}` | **MATCH — all 62 headless seats, exactly** |
| the single figure T5's plan actually froze (`4436000`) | DRIFT on 62 of 62 |
| one band deliberately wrong (`4441080` for both) | DRIFT on **54** of 62 |

That 54 is §H20's own number arriving from the other side, and the 62-of-62 match means T6's two
figures are a re-test of something measured rather than a fresh guess. It also says plainly that
**T5's frozen per-seat figure was wrong for every seat in the pool** and nothing noticed at the
time; T5's verdict does not move, because that line was not one of its pass criteria, but the
number in its plan is wrong and the reconcile of the day could not have said so.

T2R's verdict is unchanged by this — it still reads `NOT CHECKED` / `RESULT: FAIL`, which remains
the honest outcome for a prediction that was unverifiable when it was frozen.

**But regenerating it found something else, and it is worse than a stale file.** The committed
`registry/T2R.reconcile.md` was written DURING yesterday's both-directions probe, with the plan
temporarily altered, and it was committed in that state. So the evidence file on the branch carried
two claims that are false:

```
-Freeze:   UNFROZEN — PLAN ALTERED SINCE THE FREEZE — sha256 on disk 7464a5ad… does not match 0b878655…
-UNFROZEN — the prediction cannot be shown to predate the outcome, so this pool proves
-nothing about prediction however well its money reconciles. This is a FAIL by itself.
```

T2R was frozen correctly — PR 151 merged at 23:47:18Z, one hour 34 minutes before pool 21 existed —
and the plan on disk hashes to the merged bytes. The committed reconcile said the opposite about our
own strongest freeze. It is regenerated here from the untouched plan and now reads `Freeze: OK`.
The lesson is narrow and worth stating: **a probe that edits an input must regenerate every output
it touched, not just the one being examined.**

---

### §H24 — a probe I wrote tonight reported the opposite of what it measured

Characterising the new Helius endpoint, I wrote a 320-call throughput probe. It printed:

```
  ok 320  failed 0
  no throttling at this rate
```

while **fifty-four HTTP 429s scrolled past above it.** `@solana/web3.js` retries a 429 internally with
500–2000 ms of backoff, so a throttled call still resolves; my probe counted only calls that
exhausted those retries, and called everything else clean. The verdict line was computed from
`failed === 0`, which is a quantity that cannot see throttling.

**This is §H9's family for the fourth time** (§H9 stub verdict, §H14 unchecked root, §H21 unchecked
per-seat cost, now this): a check whose pass condition is not connected to the thing it claims to
measure. It cost nothing because the 429s were printed by the library and I read them, but had
the library been quieter I would have recorded "no throttling" as a measured fact.

**Re-measured with raw `fetch`, no client retry in the way**, at two paces:

| pace | calls | 200 | 429 |
|---|---|---|---|
| flat out — 17.5/sec | 120 | 66 | **54** |
| the fill's real pace — ~1.6/sec | 120 | **119** | 1 |

So the endpoint is heavily rate-limited and **that is fine for what we need it for.** The pool 22
fill ran at about 3.2 s per seat at `--concurrency 1`, roughly two RPC calls a second, which sits
well inside the clean band. It would NOT be fine at high concurrency, and T6 must stay at
`--concurrency 1` for that reason rather than out of caution.

What this does not do is make the public endpoint's failure the same thing. There, the failure was
HARD — `block height exceeded`, a burnt transaction. Here a throttled call is retried and lands.
Different failure modes, and only one of them costs a seat.

---

### §H25 — the deploy trap fired, and there is now a one-command check for it

PR 157 and PR 158 merged. The web app redeployed itself. **The entry service did not**, exactly as
`deploy-backend`'s `workflow_dispatch` trigger says it will not, and exactly as it did not after the
seal fix on 2026-09-18.

The check that proves it is a **differential probe**, and it is better than anything `/health`
offers because it can fail:

```
POST /ciphertexts  {pool: <a pool at capacity>, …}   →  {"error":"pool filled"}             deployed
POST /ciphertexts  {pool: <a pool closed below 64>, …} →  {"error":"pool closed to entries"} both
```

Gate 1 (the pool's state) runs BEFORE the signature check, so a junk body is enough to read which
message the running service holds — nothing is written and no signature is needed. Run against the
live service at 23:00Z:

```
pool 22 (Paid, 64 seats — it FILLED)  → {"error":"pool closed to entries"}   ← old code
pool 21 (Closed, 39 seats)            → {"error":"pool closed to entries"}
```

Both the same, so the service is pre-157. After the deploy, pool 22 must answer `pool filled` and
pool 21 must not.

**F-2 for the third recorded time.** `/health` answered `ok: true` throughout, with its screening
sources listed, while running code two commits old. It has no signal for the build it is running,
which is the same gap that hid a sixteen-hour entry outage (§F-28) and the seal fix's
merged-but-not-live window. A `BLOTTO_BUILD_COMMIT` is baked into the image by
`Dockerfile.packet` and `/health` does not report it — the value exists and is simply not surfaced.

### §H26 — a numbered list with two founder actions in it is one instruction, not two

**What happened.** §F-35 set out what T6 needed from the founder as a four-step list: step 2 "enter
pool 23 as UI-A", step 4 "call GO for UI-B to arrive late and be refused". Steps 1 and 3 were mine.
Two days later the founder sat down, read the list, and entered **both** wallets. Pool 27 now holds
UI-A at idx 0 and UI-B at idx 1, and T6's ninth refusal — the only one a human being reads — has
nowhere to happen.

**Why it is a finding and not an accident.** The list was correct. Every word in it was true, and
the GO call was named. It still read as one instruction, because **it was delivered as one
message**, and the thing separating step 2 from step 4 was a sentence rather than a turn. Sequencing
that a document asserts is not sequencing; sequencing that the medium enforces is. Every other
founder hand-off this week that had to happen *in order* — the three merges of §F-32, the deploy of
§F-34 — survived precisely because each one was the only thing asked for in its message.

**The cost, had it not been caught.** Not the seat. The test's headline claim is unconditional —
W00 takes rank 1 whatever anyone else does — and it is unconditional *because* every field seat
stays at or below 25. UI-A was instructed inside that range and complied. UI-B was told to play as
it liked, because a refused attempt is never scored. **So a stat the founder was explicitly told
they were free to choose is now an input to a claim that says no choice can affect it.** The wall's
zero-stats are the mechanism: a 26+ stat wins the contested one and the two zeros, three of five,
and W00's floor of 875 slides toward 861 against a field ceiling of 868.

**And it is not checkable.** The allocation is sealed until the pool reveals. There is no probe, no
query and no admin path that reads it early — that is the product's central property working
exactly as specified. This is the first time in the test week that a risk has been *unmeasurable by
design* rather than merely unmeasured, and it is worth saying plainly that the correct response to
an unmeasurable risk is not to run the measurement anyway.

**The rule going forward.** One founder action per message. A hand-off that depends on my work
landing between two of the founder's steps gets the second step in its own message, sent after the
work lands, containing nothing else. §F-36 writes T6's re-run that way.

**Related:** §F-28 (a step believed done because a document said so), §H21 (a check that printed
PASS over a criterion it never evaluated). The family resemblance is a record asserting a state of
the world instead of the world being made to hold it.

### §H27 — preflight's STOP is wrong for any wallet that has never played

**What happened.** Preflighting pool 27, five wallets came back
`the entry gate REFUSED (403). Do NOT let this wallet play: it would seal, fail, and be barred
from pool 27 for good.` — W67, W68, W69, W70, W71. Refused again when probed one at a time, so not
rate limiting. Wallet-specific, persistent, and on the check whose entire job is to stop a wallet
being barred.

**It was wrong about all five.** `service.ts:330` will not issue a packet without a stored
age/terms attestation at the current version. `enter.ts:471` attests immediately before asking for
a packet — the headless equivalent of the clickwrap. **Preflight does not.** So preflight tests a
sequence no entrant ever performs, and condemns every wallet that has simply never played.

Measured, one call each, nothing registered:

```
W67  packet before 403  ->  attestation 204  ->  packet after 200
W68  packet before 403  ->  attestation 204  ->  packet after 200
W69  packet before 403  ->  attestation 204  ->  packet after 200
W70  packet before 403  ->  attestation 204  ->  packet after 200
W71  packet before 403  ->  attestation 204  ->  packet after 200
```

**Why it survived this long.** It fails SAFE — it says STOP when things are fine — so it has never
cost a wallet or a lamport, and every wallet it has ever approved had already played and so was
already attested. A check that is only ever wrong in the cautious direction produces no incident to
investigate.

**What it nearly cost here.** Five working wallets written off, and the ninth late attempt
engineered around a wallet that did not need engineering around. The 403 is deliberately generic so
that the gate is not an oracle a prober can walk (PID §8) — correct design, and it means preflight
cannot distinguish "unattested" from "refused" by reading the response. The fix is not to parse the
refusal; it is to run the same sequence `enter.ts` runs.

**And it casts doubt on an earlier reading.** During T4 a W63 refusal was logged as
`geo BLOCK … attestation-missing-or-stale` and read as a control working as designed. It may
simply have been an unattested wallet. I am not asserting that it was — the log line names the
attestation explicitly — but the reading was made without knowing preflight skips the step.

**§H9's family for the FIFTH time** (§H9, §H14, §H21, §H23, §H24, §H27): a check reporting on
something other than the thing it claims to measure. This one is the first where the check in
question is itself a safety interlock.

**Fix:** preflight should attest before requesting the packet, exactly as `enter.ts` does, and say
in its output that it did. Queued after the pool 27 run rather than before it — changing a safety
interlock while 6.2 SOL is about to move through it is the wrong order.

**FIXED 2026-09-22, and the fix is the sequence rather than the parsing.** `preflight.ts` now makes
the clickwrap attestation immediately before requesting the packet, exactly as `enter.ts` does, so
it tests the sequence an entrant actually runs. Verified live on pool 28:

```
ok    W00 clickwrap accepted at terms v2 (204)
ok    W00 the entry gate issued a packet (200)
```

Two details worth keeping:

- **It did not try to parse the refusal.** The gate answers one generic status for every reason it
  has, deliberately, so that it cannot be walked by a prober (PID §8). Reading the 403 to guess
  "unattested" would have been a fix that quietly depends on the gate staying leaky.
- **A third verdict, `WARN`, exists now.** UI-A and UI-B are Privy wallets whose keys are not on
  this disk, so no clickwrap can be made for them and their refusal is genuinely ambiguous — it may
  mean nothing worse than "has not accepted the current terms yet". Collapsing that into `ok` or
  into `STOP` is how §H27 happened in the first place. `WARN` prints, does not claim the wallet is
  clean, and does not block the run.
