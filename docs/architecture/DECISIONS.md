# Decision log

Every design decision that code comments cite by number, in one place. Code in this repository
refers to decisions as `R7-b`, `D-A1`, `D-E6` and so on; each of those identifiers resolves to a row
below. Each row gives the decision in plain words, when it was decided, whether it is still in
force, and the file that enforces it.

- **Where the code and this log disagree, the code is right** and this log is out of date.
  [`ARCHITECTURE.md`](ARCHITECTURE.md) describes the system as built.
- Numbers are carried from the program and config files. Where a number is owned by the
  operator (prices, prize pools, the fill deadline, the territory schedule), the file named in the
  last column is the live value and this log only records the decision to use it.
- A superseded row is kept so an older code comment still resolves. Read the row it points to.
- Identifiers that do not appear here were never carried as decisions.

Contents: [Product and market](#product-and-market-r1r17) ·
[Engineering](#engineering-r18r21) · [Tiers, ties and the treasury](#tiers-ties-and-the-treasury-d1d3-b-d-a) ·
[Territory, identity, rules and language](#territory-identity-rules-and-language-d-b-d-c) ·
[Prize structure and settlement](#prize-structure-and-settlement-d-e) ·
[Decisions without a register number](#decisions-without-a-register-number) ·
[Known limitations](#known-limitations-recorded-with-the-decisions) ·
[Reading citations in code comments](#reading-citations-in-code-comments) ·
[Other identifiers in code comments](#other-identifiers-in-code-comments)

---

## Product and market (R1–R17)

| ID | Decision | Decided | Status | Enforced in |
|---|---|---|---|---|
| R1 | The build and devnet operation proceed on the project's own analysis; external legal opinions are pursued in parallel rather than as a gate. One written opinion is a precondition for opening the 0.5 SOL tier (see R6). | 2026-08-26 | In force; reaffirmed 2026-09-16 (R1-b) | Process rule; the tier switch is `set_open_tiers` in `programs/blotto_cup/src/instructions/admin.rs` |
| R1-b | Restates R1 and requires public documents to say plainly that no outside opinion has yet been obtained, rather than implying one gates launch. | 2026-09-16 | In force | [`docs/guide/HOW-IT-WORKS.md`](../guide/HOW-IT-WORKS.md) |
| R2 | The launch territory is set by the operator; the first default was an allow-list of three countries. | 2026-08-26 | Superseded by D-B3-2 (block-list) | `config/territories.json` |
| R3 | Entry requires a location check and an age self-attestation. KYC is not required at launch; a KYC-at-prize switch is built and off. | 2026-08-26 | In force (see D-B4, D-E5) | `backend/packet/src/`; `Config.kyc_required_above_lamports` read in `programs/blotto_cup/src/instructions/escrow.rs` |
| R4 | A rules page, terms and privacy notice are published, stating: decisions are final, the fill deadline and refund, sealing, identical-field scoring, the allocation rules, the timer behaviour, detection criteria, and the language rules. | 2026-08-26 | In force | `app/src/app/rules/`, `app/src/app/terms/`, `app/src/app/privacy/` |
| R5 | No formal third-party audit before mainnet. Devnet with simulated entrants plus an internal review first; an independent audit after ten settled mainnet pools. | 2026-08-26 | In force | [`docs/security/SECURITY-REVIEW.md`](../security/SECURITY-REVIEW.md); vault-invariant tests in `tests/litesvm/` |
| R6 | Tiers are configured but opened one at a time: only the 0.1 SOL tier opens at launch. The 0.5 SOL tier opens only after the audit (R5) and one legal opinion (R1); higher tiers only by a later explicit decision. `Config` carries a per-tier ceiling. | 2026-08-26 | In force; tier list amended by D1 | `Config.open_tiers`, `set_open_tiers` in `programs/blotto_cup/src/instructions/admin.rs`; `tests/litesvm/tests/tier_gate.rs` |
| R7 | Pools had a 72-hour fill deadline and ran only when full, otherwise refunded. | 2026-08-26 | Superseded: deadline by D-E6 (12 hours), minimum field by R7-b (40) | — |
| R7-b | **The minimum field is 40 seats.** A pool seals at its 64th entry, or at its 12-hour deadline with at least 40 seated; below 40 every entry is refunded in full. The floor is copied onto each pool when it opens (`Pool.min_seats`) so a later change cannot move it under players already seated; pools opened before the field existed keep the 52 they opened under. At 40 seats a pool's entries exactly equal its prize, which is accepted because the prize is funded from the treasury before any entry is sold (D-A1). | 2026-09-12 (ratified 2026-09-13) | In force | `MIN_SEATS = 40`, `MIN_SEATS_V1 = 52` in `programs/blotto_cup/src/constants.rs`; `instructions/seal.rs`, `instructions/refund.rs`, `instructions/migrate.rs`; `tests/litesvm/tests/fill_rule.rs` |
| C-2 | A proposal to keep sixteen paid places was declined: one paid place stands (D-E2). Recorded so the question is not reopened against a superseded reading of the code. | 2026-09-13 | In force (no change) | `PAID_RANKS = 1` in `programs/blotto_cup/src/constants.rs` |
| R8 | Entry flow: pay, class reveal, seven battles, review, one transaction. | 2026-08-26 | Superseded: the class reveal was removed (see [below](#decisions-without-a-register-number)) and the battles are now played on the board (D-E17) before the single entry transaction | `app/src/app/play/play-client.tsx` |
| R9 | A visible 15-second timer per battle screen; on timeout the battle locks whatever is on screen. Never a random allocation, because that would put chance into the competition. | 2026-08-26 | Superseded by R9-b, then D-E17 (one three-minute clock). The "never random" rule stands. `Pool.timer_seconds` is still written (15) but the board does not use it | `TIMER_SECONDS` in `programs/blotto_cup/src/constants.rs` |
| R9-b | When time runs out, every battle the player has not locked is entered as the even split (20 in each stat). | 2026-09-07 | Superseded by D-E17's spread rule | — |
| R10 | Prizes are pushed automatically by the settlement process right after results are committed. There is no claim step. A flagged entry's share is held in escrow until review. The results root commits the full ranking. | 2026-08-26 | In force | `programs/blotto_cup/src/instructions/pay_prizes.rs`, `escrow.rs`; `backend/reveal/src/crank.ts` |
| R11 | Detection: all signals logged; an automatic hold only on exact-duplicate battle sets and same-device multi-entry; a review page for a human reviewer; the full automatic tier behind an admin switch. | 2026-08-26 | Automatic path deferred by D-E9; detection is manual-only | `backend/detection/`; `Config.detection_hard_block` (stored, no reader) |
| R12 | Passes are typographic at launch (`BLOTTO PASS #<pool>-<index>`, empty URI). Illustrated art, if ever added, is a metadata update, not a change to the competition. | 2026-08-26 | In force; no URI-update instruction exists | `programs/blotto_cup/src/pass.rs` |
| R13 | A public verify page: pool id → on-chain events → decrypt with the revealed secret → recompute in the browser → compare to the committed root. | 2026-08-26 | In force | `app/src/app/verify/` |
| R14 | Pools per tier opened continuously, the next opening the moment one fills. | 2026-08-26 | Superseded by D-A1: pools per tier are sequential | — |
| R15 | A read-only wallet profile: lifetime pools, ranks, win rate, class collection. No points system, no levels, no referral system. Nothing on it can affect a pool. | 2026-08-26 | In force | `app/src/app/profile/`; `backend/indexer/src/read-api.ts` |
| R16 | A shareable result card (image and link). No on-chain change and no reward for sharing. | 2026-08-26 | In force; the card carries no class since 2026-09-15 | `app/src/app/card/[pool]/[player]/route.tsx` |
| R17 | Success target: one 0.5 SOL pool fills within 24 hours without outreach. | 2026-08-26 | Target; not measurable until the 0.5 SOL tier opens (R6) | — |

## Engineering (R18–R22)

| ID | Decision | Decided | Status | Enforced in |
|---|---|---|---|---|
| R18 | Desktop web first; mobile after the battle interaction is proven. | 2026-08-26 | Historical scope order. The app is now tested at a 375 px mobile and a 1280 px desktop width on every change | `.github/workflows/ci-fast.yml` (`journey` lane) |
| R19 | Sign-in through an embedded-wallet provider with social login, with an external wallet as an option. | 2026-08-26 | In force. The per-pool device marker used by detection is derived in the app, not from the sign-in provider | `app/src/wallet/`; `app/src/entry/device.ts` |
| R20 | The backend is TypeScript throughout. The scoring engine and the results tree are one TypeScript module run unchanged by the settlement process and the browser. Python-generated vectors are the independent check. No Rust scoring crate, no WASM. The class-draw crate stays Rust because the program needs it, with a TypeScript twin pinned to the same vectors. | 2026-08-26 | In force | `backend/scoring/`; `backend/class-digest/`; `crates/blotto-randomness/`; `backend/scoring/fixtures/gen_vectors.py` |
| R21 | Keys are held in a multisig (admin) and a key-management service (entry signer, pool sealing keys) from devnet onward. | 2026-08-26 | Partly in force on devnet: the admin is a multisig vault; the program upgrade authority is a single operator key until before mainnet | [`config/custody.json`](../../config/custody.json); `app/src/app/custody/` |
| R22 | **No oracle seed in the class draw.** `register` no longer requires a committed VRF seed. The cosmetic class digest runs on a slot hash at least five slots old, the entry index, the pool and the player, with 32 zero bytes in the seed's position for a pool that has none. `commit_vrf_seed` remains, and refuses once a pool has an entry. The daemon commits no seed and creates the pass collection first. Reason: Switchboard shut down (support ended 2026-09-25; its devnet oracles stopped 2026-10-10), and from pool 90 on no pool could take an entry. Nothing in scoring, ranking or prizes reads the class. | 2026-10-15 | In force. Before mainnet: decide whether a live randomness provider returns as the fifth input | `programs/blotto_cup/src/instructions/register.rs`; `programs/blotto_cup/src/vrf.rs`; `backend/reveal/src/daemon.ts`; [`adr/adr-026-multi-source-randomness.md`](adr/adr-026-multi-source-randomness.md) |

## Tiers, ties and the treasury (D1–D3-B, D-A)

| ID | Decision | Decided | Status | Enforced in |
|---|---|---|---|---|
| D1 | Seven configured tiers at 0.1 / 0.5 / 0.75 / 1 / 2.5 / 5 / 7.5 SOL entry, one open pool per tier per mode; only 0.1 SOL open at launch. | 2026-08-27 | In force (prices are operator-changeable on `Config`) | `N_TIERS`, `TIER_ENTRY_LAMPORTS` in `programs/blotto_cup/src/constants.rs` |
| D2 | A per-tier ceiling on a pool's gross pass sales (price × 64), checked at `open_pool` only; lowering it never affects an already-open pool. One tier per call. | 2026-08-27 | In force | `set_vault_ceiling` in `instructions/admin.rs`; `instructions/open_pool.rs`; `tests/litesvm/tests/gates.rs` |
| D3-B | Ties: players equal on (battles won, stats won) share a rank and split the prize of the places they occupy evenly; the indivisible lamport remainder goes to the tied player with the lowest entry index. Entry order never decides who is paid or who ranks higher. | 2026-08-27 | In force (with one paid place, a tie for first splits the whole prize) | `backend/scoring/src/prizes.ts`; `programs/blotto_cup/src/prize_math.rs`; `tests/litesvm/tests/tiers_and_ties.rs` |
| D-A1 | **Two accounts, pre-funded prizes.** A treasury account receives 100% of entry payments. Each pool's prize vault is funded with the tier's fixed prize pool from the treasury at `open_pool`, before any entry is sold, so entries never touch a prize vault. Pools per tier are sequential: the next opens only after the previous is paid or refunded. A tier opens only if the treasury still covers a policy minimum plus a reserve pot for every other enabled idle tier. `withdraw_platform` (multisig-only, floor-guarded) is the treasury's one discretionary exit. | 2026-08-27 (revised same day) | In force; amounts re-set by D-E1 | `instructions/open_pool.rs`, `instructions/treasury.rs`, `programs/blotto_cup/src/vault.rs`; `scripts/check-standing-rules.sh` |
| D-A2 | Build and publish a skill-evidence study: a ladder of strategies, at least 200 offline pools through the real settlement code, published per-class outcome statistics, reproduced nightly in CI, plus live statistics from the indexer (wallet addresses only). | 2026-08-27 | In force | [`docs/skill-evidence/`](../skill-evidence/) (generated); `tests/rehearsal/strategies/`; `.github/workflows/skill-evidence.yml`; `backend/_shared/migrations/0008_player_history.sql` |

## Territory, identity, rules and language (D-B, D-C)

| ID | Decision | Decided | Status | Enforced in |
|---|---|---|---|---|
| D-B3 | Location blocking sits behind one lookup interface and fails closed: an unresolved or ambiguous location is refused. Enforced at the entry service and again in the app before entry. | 2026-08-27 | In force | `backend/packet/src/territories.ts`, `geo-*.ts`; `app/src/rules/territories.ts` |
| D-B3-2 | The territory posture is a block-list: available everywhere except the listed countries. | 2026-08-28 | In force; the list has grown since (D-B3-3, D-B3-4) | [`config/territories.json`](../../config/territories.json), legend in [`config/territories.README.md`](../../config/territories.README.md); `scripts/check-territories.ts` |
| D-B3-3 | The United States is blocked at country level (schedule version 4). State-level blocking is not enforceable with the current location source, which returns no subdivision code; the entry service refuses to start with any state-level row. | 2026-09-21 | In force | `config/territories.json`; region check in `backend/packet/src/service.ts` |
| D-B3-4 | Spain, France and Italy are blocked (schedule version 5, eighteen codes in all). | 2026-09-18 (in the software 2026-09-22) | In force | `config/territories.json` |
| D-B4 | Age is a self-attestation ("I am over 18") only. No identity or age-verification vendor. The attestation is versioned, stored server-side, and its `terms_version` travels in the signed entry packet. | 2026-08-27 | In force | [`config/terms.json`](../../config/terms.json); `backend/packet/src/attestations.ts`, `packet.ts` |
| D-B6 | Participation, entry, payout and randomness rules are published on their own page in plain language, generated from the same constants the program uses. No hand-typed numbers. | 2026-08-27 | In force | `app/src/app/rules/rules.config.ts`; CI step "Published numbers match the program" in `.github/workflows/ci-fast.yml` |
| D-B7 | The banned vocabulary extends beyond the original word list to claims of legal or trust status, marketing that promises players cannot be identified, guarantee claims, finance framing and category assertions. Public copy describes mechanics instead. | 2026-08-27 | In force | `scripts/check-language.sh`; [`CONTRIBUTING.md`](../../CONTRIBUTING.md) |
| D-C | Build the operating layer: the settlement and keeper daemon, client transaction wiring with a balance pre-flight, the review service, the key-management and permanent-storage adapters, automatic fetching on the verify page, the per-pool device marker, the CI and deploy lanes, and a custody disclosure page. | 2026-08-27 | Built | `backend/reveal/src/daemon.ts`; `backend/detection/`; `app/src/app/custody/`; `.github/workflows/` |
| D6 | Operating entity: to be confirmed before mainnet. | 2026-09-22 | Open. `config/operator.json` is all-`null` until the entity exists, and a mainnet deploy is refused while any value is unset | [`config/operator.json`](../../config/operator.json); `scripts/check-operator-identity.ts` |
| D10 | Reviewer keys are listed in the reviewer registry. The registry now has two members, so a published appeal can be decided by a different reviewer from the one who made the first decision. | 2026-09-22; second member added 2026-09-24 (registry v2) | In force | [`config/reviewers.json`](../../config/reviewers.json); `backend/detection/src/review.ts` |

## Prize structure and settlement (D-E)

| ID | Decision | Decided | Status | Enforced in |
|---|---|---|---|---|
| D-E1 | Fixed prize pools of **4 / 20 / 30 / 40 / 100 / 200 / 300 SOL** across the seven tiers. The constant is the rule; no public document states a derivation. | 2026-09-06 | In force | `TIER_POT_LAMPORTS` in `programs/blotto_cup/src/constants.rs`; `set_tier_economics` in `instructions/treasury.rs` |
| D-E2 | **Winner takes all**: one paid place (`PAID_RANKS = 1`, `PRIZE_BANDS_1024 = [1024]`). A tie for first splits the prize equally (D-E7). | 2026-09-06 | In force | `programs/blotto_cup/src/constants.rs`; `backend/scoring/src/prizes.ts` |
| D-E4 | A pool with 52–63 seated at its deadline seals (`seal_at_deadline`, permissionless) and plays; below 52 it refunds. | 2026-09-06 | Superseded by R7-b (floor 40, carried per pool). `seal_at_deadline` remains | `instructions/seal.rs` |
| D-E5 | The KYC-at-prize switch stays built and off (threshold 0). The seven-day automatic release and the next-place payout do not present a KYC packet, which is harmless while the threshold is 0; turning KYC on requires revisiting both paths first. | 2026-09-06 | In force | `set_kyc_threshold` in `instructions/admin.rs`; `instructions/escrow.rs`; `tests/litesvm/tests/kyc_switch.rs` |
| D-E6 | The reconciliation upgrade. (1) Fill deadline **12 hours**, in `Config.fill_deadline_seconds`, copied onto each pool at open. (2) One clock per pool; the deadline set at open is never shortened. (3) A pool account layout pin (then 839 bytes). (4) The vault pays first place; if first place is not eligible, the next eligible place; below the minimum field every entry is refunded. **Forfeited money never reaches the operator**: `forfeit_escrow` moves no lamports and `pay_next_place` is the exit that pays the share onward. (6) Timer expiry enters unlocked battles as the default (R9-b). (7) One entry per wallet per pool on-chain, uncapped across pools. Also: a keeper role that alone opens pools, a per-tier cooldown, and manual-only detection. | 2026-09-07 | In force, except: the layout is now 842 bytes (R7-b and D-E17 each appended a field); the keeper's 24-hour liveness fallback was removed, so only the keeper opens a pool; (6) is superseded by D-E17 | `DEFAULT_FILL_DEADLINE_SECS` in `constants.rs`; `instructions/escrow.rs` (`pay_next_place`, `forfeit_escrow`); `instructions/open_pool.rs` (keeper); Entry PDA `[b"entry", pool, player]` in `state.rs`; `scripts/check-standing-rules.sh` |
| D-E7 | (1) The **published** review window is 12 hours: a flag undecided at 12 hours is cleared and the prize paid. The program's 7-day permissionless release is a safeguard against operator failure and is not published as the deadline. (2) A prize is always paid to a player and never returns to the operator. (3) A forfeited winner's share is divided equally among the remaining eligible players tied at that rank. (4) The completeness of the next-rank group is the settlement signer's assertion, disclosed, and checkable from the published bundle. (5) Public copy states that the sealing key is generated and held by the operator's systems and export-locked. (6) No prize-pool derivation on any public surface. (8) The timer default's effect is stated as how the allocation performs. (9) Detection copy says detection is manual. | 2026-09-07 | In force, except (7) "no terms v3": the terms are now at version 4 | `ESCROW_AUTO_RELEASE_SECS` in `constants.rs`; `instructions/escrow.rs`; `app/src/copy/index.ts` (`rules.*`) |
| D-E8 | The results archive labels as verified only what the on-chain results root covers (`player ‖ rank ‖ amount`). Seat comes from the indexer's chain records; score and stats won are labelled recomputed. Bundle discovery is restricted to the operator's own storage address. | 2026-09-12 | In force | `backend/indexer/`; `backend/scoring/src/merkle.ts`; `app/src/app/pools/[pool]/results/` |
| D-E9 | Detection stays manual and is surfaced: every detection report is stored and its findings are shown to the reviewer before the review window closes. **No signal takes automatic action.** R11's automatic hold is deferred until ten settled pools of shadow data, and turning it on is a signed multisig decision. | 2026-09-12 | In force | `backend/detection/`; `app/src/app/admin/review/` |
| D-E10 | The unreadable-entry ceiling is **three**: if more than three entries in one pool cannot be decrypted at settlement, settlement stops for a human instead of scoring them as losses and paying out. | 2026-09-12 | In force. Set by `BLOTTO_MAX_UNREADABLE_ENTRIES`; required on mainnet | `backend/reveal/src/startup.ts`, `main.ts` |
| D-E11 | The email promise was removed from the app because nothing could send it; the in-app notifications stayed. | 2026-09-13 | Superseded in part: a per-pool, wallet-signed, one-message opt-in with a dispatcher returned 2026-09-17, shown only when the entry service advertises it; the address is deleted once sent | `backend/packet/src/notify-pool.ts`, `email-sender.ts`; `app/src/copy/index.ts` (`notify`) |
| D-E12 | The app's performance and accessibility floor is **90**; the app is fixed to reach it, the threshold is not lowered. Checked weekly rather than on every change. | 2026-09-13 | In force | `.github/workflows/app-lighthouse.yml`; `app/scripts/lighthouse-gate.mjs` |
| D-E13 | The reviewer action budget is **64 signed decisions per key per hour**. | 2026-09-13 | In force | `backend/detection/src/budget.ts` |
| D-E14 | A second location and screening vendor is contracted before the first pool with members of the public. Both checks run on one vendor today, behind a seam for a second; because the gate fails closed, one vendor's outage refuses every entry. | 2026-09-13 | Pending (gates the first public pool) | `backend/packet/src/geo-composite.ts` |
| D-E15 | A program-side prize-table check (who is paid what, not only that the list sums to the pot) is added in the next program upgrade window. Today the program checks the committed list sums to the pot, has the right length, seats in range and strict order; recomputation from the published bundle catches a wrong table. | 2026-09-13 | Scheduled; not built | `instructions/pay_prizes.rs`, `instructions/reveal_commit.rs` |
| D-E16 | No IP-derived value is captured, stored or sealed at entry; device correlation within a pool stays. The sealed boxes have no public reader; the published bundle is the only public battle set. | 2026-09-15 (data-minimisation ruling) | In force | `backend/detection/src/signals.ts`; `backend/reveal/src/main.ts`; [`docs/compliance/DATA-INVENTORY.md`](../compliance/DATA-INVENTORY.md) |
| D-E17 | **The battle board, and two modes on two pools.** Seven fields, five stats, one **three-minute** clock for the whole board that starts at the first point placed; per-field lock-in. **Easy (mode 0)**: 100 points in each of the seven battles. **Hard (mode 1)**: 700 points anywhere across the 35 cells, in a separate pool with its own prize at the same entry price and the same tier ladder. **Scoring is identical in both**: a stat is won by the larger number, a battle by three of five, otherwise a draw; everyone faces everyone. At submit or expiry, unplaced points spread evenly across the cells of fields not locked in, remainder in fixed order. Points left to place are always shown. | 2026-09-24 (hard mode deployed on devnet 2026-09-25) | In force | `MODE_EASY`/`MODE_HARD`, `Pool.mode`, `set_hard_open_tiers` in `programs/blotto_cup/src/`; `backend/scoring/src/allocation.ts`; `app/src/battle/board/mode.ts`, `spread.ts`, `machine.ts` |

| D-E18 | **The mobile channel: one app, delivered two ways.** The Android package for the Solana dApp Store is a WebView shell (Solana Mobile's `webshell`) that opens the deployed site and carries no copy of the product, kept in this repository under `mobile/` — never a fork, never a second codebase. Every deploy reaches both channels at once, and the play page refuses to seal an entry from a page whose build is not the one the server is serving. What differs on a phone is the closed list in [`MOBILE.md` §2](../guide/MOBILE.md#2-what-differs-on-mobile--the-complete-list); nothing on the money path, the board, sealing or scoring reads the channel. Inside the package, sign-in is by Solana wallet only (Phantom and Solflare tested; the choice is not restricted to one brand, which the mobile wallet standard cannot do). A wallet offering sign-and-send only can sign in but not enter: the entry path's signing order (wallet first, the pass asset's key after) stands, and such a wallet is told so in words. Store submission follows the mainnet launch and its legal review; the listing's copy, icon, category and package id are owner-reserved. | 2026-09-28 | In force; a package was generated, installed and run on an Android 15 emulator on 2026-09-30 ([`MOBILE.md` §5](../guide/MOBILE.md#5-testing-on-an-emulator-or-a-phone)); nothing is submitted | `app/src/channel/`, `app/src/wallet/mobile-wallet.tsx`, `app/src/wallet/direct-sign-in.ts`, `app/src/wallet/in-front.ts`, `app/src/chain/ed25519.ts`, `app/src/build/version.ts`, `app/src/app/api/version/route.ts`, `app/src/app/.well-known/assetlinks.json/route.ts`, `app/src/app/manifest.ts`, `app/src/proxy.ts`, `app/next.config.ts`; `mobile/`; [`MOBILE.md`](../guide/MOBILE.md) |

## Decisions without a register number

Standing decisions recorded outside the register. Code comments cite them by date.

| Decision | Decided | Status | Enforced in |
|---|---|---|---|
| **The program never sees an allocation** and cannot check one; it stores only `sha256(battles ‖ salt)`. The allocation rule is enforced by the client (which cannot express a violating shape) and by the scoring engine (which scores a malformed set as all losses and publishes that status). A program that could check an allocation could read one, which would defeat sealing. | 2026-09-07 | In force | `app/src/battle/allocation.ts`; `backend/scoring/src/allocation.ts` |
| The published results bundle carries battles, salts, commitments and statuses only. Per-battle timings and the device marker reach detection privately and are never published. Bundle version 3 adds the hard-mode encoding. | 2026-09-12 (v2); 2026-09-25 (v3) | In force | `backend/reveal/src/bundle.ts`, `crank.ts` |
| **No class reveal.** The class is still drawn on-chain from the `class_counters` bag and is replayable from events, but it is not announced at entry; the entry confirmation and the share card carry no class. | 2026-09-14 | In force | `app/src/reveal/machine.ts` (the visual state has no class field); `app/src/app/play/` |
| **Rarity ladder, profile only.** The five classes are labelled Common, Uncommon, Rare, Epic, Mythic (38 / 15 / 7 / 3 / 1 of 64) and shown only in the profile's collection, beside the caveat: "Rarity is decorative. It changes nothing: not your battles, not your score, not your ranking, and no prize." Any forward-looking wording about rarity needs legal review first. | 2026-09-15 | In force | `app/src/copy/index.ts` (`rarityNames`, `rarityCaveat`); `app/src/app/profile/` |

## Known limitations recorded with the decisions

- **The sealing key is operator-generated.** Each pool's sealing key is generated in the operator's
  daemon process, then imported into the key-management service and wiped locally. It is
  export-locked by custody policy until the pool seals or passes its deadline. Sealing therefore
  rests on the custody policy, not on the operator never having held the key. Generation inside the
  custody service is not built. Public copy says so (D-E7 (5)).
- **The prize-table check is not on-chain yet** (D-E15).
- **One location vendor** (D-E14).
- **KYC is off** (R3, D-E5): an upheld detection flag is the only lever against a flagged wallet.

---

## Reading citations in code comments

Code comments cite the project's original design documents as `PID §x` (the product document) and
`TECH-ARCH §x` (the technical architecture). Those documents are not published. Several of their
sections have been superseded by rows above. This table gives, for each section the code cites
most, what it establishes **today** and where that now lives publicly.

| Citation | What it establishes (current) | Public home |
|---|---|---|
| TECH-ARCH §5 | Sealing: a per-pool X25519 key, export-locked until seal or deadline; the client encrypts battles and salt to it; `sha256(battles ‖ salt)` recorded on-chain at entry; at seal the secret is revealed, every entry decrypted and checked against its hash, then scored. Failure modes are published. | [ARCHITECTURE.md](ARCHITECTURE.md) §4 · [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) |
| PID §9 | Where the service is offered. Now a block-list in `config/territories.json` (D-B3-2 to D-B3-4), eighteen country codes. | [`config/territories.README.md`](../../config/territories.README.md) · [SAFEGUARDS.md](../compliance/SAFEGUARDS.md) |
| PID §8.6 | Disclosures shown to players: decisions are final (stated before payment), the fill deadline and refund, sealing described accurately, identical-field scoring, and the allocation rules. CI checks the published numbers against the program. | [SAFEGUARDS.md](../compliance/SAFEGUARDS.md) · [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) |
| PID §8.4 | Class confers nothing of value and nothing competitive. Any proposed class reward must pass two questions: would anyone pay money for it, and does it improve the chance of winning? Both answers must be no. | [SAFEGUARDS.md](../compliance/SAFEGUARDS.md) · [adr-021](adr/adr-021-bag-without-replacement-draw.md) |
| PID §8 | The product's legal characterisation, under legal review. Code cites it wherever a mechanism exists to keep chance out of the competition and value out of the pass. This repository makes no legal claim. | [SAFEGUARDS.md](../compliance/SAFEGUARDS.md) |
| PID §8.7 | The banned vocabulary and the preferred words, amended by D-B7. | [CONTRIBUTING.md](../../CONTRIBUTING.md) ("The language gate") and `scripts/check-language.sh` |
| PID §3 | The character pass: a Metaplex Core asset, permanently non-transferable; class drawn bag-without-replacement from `class_counters` `[38, 15, 7, 3, 1]`; cosmetic only. Labels are now Common to Mythic. | [adr-003](adr/adr-003-metaplex-core.md) · [adr-021](adr/adr-021-bag-without-replacement-draw.md) · [adr-027](adr/adr-027-collection-freeze-propagation.md) |
| TECH-ARCH §3.3 | Events: every input needed to recompute a result or a class draw is in the program log. The event set is now larger than the original list. | [ARCHITECTURE.md](ARCHITECTURE.md) §3 |
| TECH-ARCH §8 | The entry packet: an ed25519-signed packet from the entry service, verified on-chain through the instructions sysvar, gating `register`; 60-second freshness. | [ARCHITECTURE.md](ARCHITECTURE.md) · `programs/blotto_cup/src/entry_packet.rs` |
| TECH-ARCH §9 | Detection signals: allocation entropy, per-battle timing, duplicate and near-duplicate battle sets, device correlation within a pool, population-relative score. Advisory only; a reviewer decides every flag (D-E9). The IP half was removed (D-E16). | [SAFEGUARDS.md](../compliance/SAFEGUARDS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) |
| PID §6 | Prizes. Now one paid place taking a fixed prize pool (D-E1, D-E2); ties split (D-E7). | [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) |
| PID §4.3 | Why the allocation space is free integers: any prominent target clusters players and clustering causes draws. Random free-integer allocations draw about 7% of battles, against about 78% on a 20-point grid (recomputed for [`../product/PRD.md`](../product/PRD.md) §4.2; the original document's 86% does not reproduce). The board's ±5 / ±10 / ±20 steps are a measured exception (D-E17). | [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) · [`docs/skill-evidence/`](../skill-evidence/) |
| TECH-ARCH §4 | The class digest `sha256(vrf_seed ‖ slot_hash ‖ entry_index ‖ pool ‖ player)`. The original shuffled-table commitment is replaced by the on-chain bag. | [adr-026](adr/adr-026-multi-source-randomness.md) |
| PID §4.6 | The allocation invariant: five non-negative integers per battle summing to exactly 100 in the fixed stat order (easy mode; hard mode is 700 across the board). Enforced by the client and the scoring engine, not the program. | [ARCHITECTURE.md](ARCHITECTURE.md) §4 |
| TECH-ARCH §6 | The scoring engine: every pair of players compared battle by battle; rank by battles won (draws count half, carried as integer half-points), then stats won. TypeScript, not Rust or WASM (R20). | [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) §4 |
| TECH-ARCH §3.1 | The account layouts (`Config`, `Pool`, `Entry`). The live layouts are in `programs/blotto_cup/src/state.rs`. | [ARCHITECTURE.md](ARCHITECTURE.md) §3 |
| TECH-ARCH §11 | Infrastructure: hosting outside blocked markets, the RPC provider, the location vendor, key management, the multisig, Postgres for ciphertext and detection, permanent storage for published bundles. | [HOSTING.md](../guide/HOSTING.md) |
| TECH-ARCH §1 | Three trust boundaries: the program holds money and enforces on-chain rules; the backend computes what is too expensive on-chain and publishes everything needed to recompute it; sealing keeps the operator blind to allocations before close. | [ARCHITECTURE.md](ARCHITECTURE.md) · [DIAGRAMS.md](DIAGRAMS.md) |
| PID §8.3 | The competition mechanism contains no random element: no pairing, no bracket, and every player faces the identical field. The skill evidence is published. | [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) · [`docs/skill-evidence/`](../skill-evidence/) |
| PID §4.4 | One comparison: a stat is won by the larger number; a battle by three or more stats; otherwise a draw worth half a win to each. | [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) |
| PID §4.2 | The allocation interaction. The original draggable pentagon is replaced by the board (D-E17), which does show points left to place. | [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) |
| TECH-ARCH §3.2 | The instruction table. The prize vault's lamport exits are `pay_prizes`, `release_escrow`, `pay_next_place`, and `trigger_refund` returning an unplayed pool's prize to the treasury; `forfeit_escrow` moves nothing. There is no claim instruction. | [ARCHITECTURE.md](ARCHITECTURE.md) §3 · `scripts/check-standing-rules.sh` |
| TECH-ARCH §2 | Constants. The live values are in `programs/blotto_cup/src/constants.rs`. | [ARCHITECTURE.md](ARCHITECTURE.md) |
| PID §8.2 | Separates the pass (drawn at random, cosmetic, no market, no competitive effect) from the competition (a prize, no random element). | [SAFEGUARDS.md](../compliance/SAFEGUARDS.md) |
| PID §5 | Sealing and scoring in summary. Entry order decides only the indivisible remainder of a tie split and the published leaf order, never rank (D3-B). | [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) |
| PID §1, §2 | The one-paragraph product summary and the pool table. Superseded in detail by R7-b, D1, D-E1, D-E2, D-E6 and D-E17. | [HOW-IT-WORKS.md](../guide/HOW-IT-WORKS.md) |

## Other identifiers in code comments

Code comments also use identifiers from other numbering schemes. None of them names a standing
decision that is not already in the tables above.

- **`PID D1`–`D8`**: the product document's list of open questions, each since answered by a row
  above. D1 fill deadline and minimum → R7-b; D2 class names and art → R12 and the rarity ladder;
  D3 per-screen timer → R9, now D-E17; D4 claim window → R10 (no claim step); D5 KYC threshold → R3
  and D-E5; D6 operating entity → D6 above.
- **`v3 D1`–`D4`**: the four parts of the interface overhaul — D1 the design system
  (`app/src/design/tokens.ts`), D2 the journey screens, D3 the profile and results features, D4 the
  performance and accessibility bar (see D-E12).
- **Bare `D3`, `D5` and similar with a date in 2026-09-16**: interface choices from that day's
  visual update, such as the seal key's colour (`SEAL_KEY_TONE` in `app/src/app/play/play-client.tsx`)
  and hiding the verify link while a pool is open.
- **`D14`, `D18`**: review notes from the prize-structure proposal (a byte-offset remark in
  `state.rs`, a layout note in `app/src/app/page.tsx`). No standing decision.
- **`C1`–`C13`**: mostly the items of the D-C build (for example C8 the daemon, C9 the play flow's
  balance pre-flight, C10 the review service, C11 verify auto-fetch and the device marker, C13 the
  custody page). A few comments use the product document's launch checklist instead (C4 published
  rules, C12 the language audit).
- **`A-nn`, `B-nn`, `C-nn`, `D-nn`, `F-nn`, `IR-n`, `O-nn`**: finding numbers from internal reviews.
  See [SECURITY-REVIEW.md](../security/SECURITY-REVIEW.md).
- **`threat-tm-401`, `-402`, `-403`, `-502`** and **`adr-0xx`**: the design records in
  [`adr/`](adr/).
