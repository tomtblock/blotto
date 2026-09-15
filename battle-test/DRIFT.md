# DRIFT — manual v1.2 against the live tree (WP0)

**Tree:** `main` at `66a43d8` (2026-09-15) · **Chain read:** devnet, program `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`, 23:01 UTC 2026-09-15 (`admin.ts status` / `pools`) · **Live app:** https://www.blotto.gg (the Vercel alias `blotto-jade.vercel.app` serves the same build).

Every row: where the manual says it · what it says · what the repo actually has (file:line) · verdict · the fix. A row is *resolved* when the manual amendment in this PR carries the fix or the row is explicitly accepted as "no manual change needed". **Unresolved rows: 0** (asserted at the bottom).

Verdicts: **HOLDS** (claim true as written) · **CHANGED** (true in substance, wrong in detail) · **GONE** (claim false against this tree).

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
