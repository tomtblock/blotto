# Safeguards

How Blotto Cup is designed to be fair to players and accountable to anyone who wants to check it.
Each safeguard below is stated three ways: **what it is**, in plain English; **where it is
enforced**, by file; and **what proves it**, by the automated check or test that fails if it stops
being true.

**This is not a legal opinion.** It describes mechanisms. It makes no claim about the product's
legal status in any territory, and nothing in it should be read as one. Independent legal review
is pending and is required before any launch on the main network. Blotto Cup runs today on Solana
devnet only (program `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`); no real money has entered it.

Related documents: [`PRODUCT-FACTS.md`](PRODUCT-FACTS.md) states every value with its source;
[`DATA-INVENTORY.md`](DATA-INVENTORY.md) covers personal data;
[`../guide/HOW-IT-WORKS.md`](../guide/HOW-IT-WORKS.md) is the plain-language overview; decision IDs
(`R20`, `D-E6` …) resolve in [`../architecture/DECISIONS.md`](../architecture/DECISIONS.md).

---

## How the checks run

Most safeguards below are held by a CI gate rather than by review alone. The `standing-rules` lane
of [`.github/workflows/ci-fast.yml`](../../.github/workflows/ci-fast.yml) runs on every proposed
change, fifteen checks in order:

| # | Check | What it holds |
|---|---|---|
| 1 | `scripts/check-language.sh` | the vocabulary rule over code, comments, tests and copy (§17) |
| 2 | `scripts/check-standing-rules.sh` | class read by nothing in scoring; the exact vault and treasury exits; detection never blocks (§1, §5, §7) |
| 3 | `scripts/check-territories.ts` | the territory schedule and its legend agree; no rule that cannot be applied (§11) |
| 4 | `scripts/check-operator-identity.ts` | the operator identity file is well-formed; refused on mainnet while any value is unset (§16) |
| 5 | `scripts/check-blocked-wallets.ts` | every blocked address carries an enumerated ground (§13) |
| 6 | `scripts/check-published-numbers.ts` | no rendered copy carries a value a program constant used to have (§17) |
| 7 | `scripts/check-dead-files.ts` | no unreachable app file |
| 8 | `scripts/sim/fill-replay.ts --self-test` | the fill simulation still models the seal-or-refund rule |
| 9 | `scripts/drain-verdict.ts --self-test` | the upgrade pre-flight still refuses when it should |
| 10 | `scripts/check-env-examples.sh` | every environment variable a service reads is documented |
| 11 | `scripts/check-container-user.sh` | service containers do not run as root |
| 12 | `scripts/check-fixtures.sh` | the Python oracles reproduce their committed fixtures (§2, §4) |
| 13 | `scripts/check-mirrors.py` | the program's constants and their TypeScript mirror agree |
| 14 | `scripts/ci-gate.sh --self-test` | the deploy gate still judges correctly |
| 15 | `scripts/deploy-devnet.sh --self-test` | the program deploy script still tells an outage from a fresh cluster |

`check-standing-rules.sh`, `check-language.sh`, `check-territories.ts` and
`check-blocked-wallets.ts` **test themselves**: each runs against a probe that violates every rule
and exits 2 if it fails to catch one, so a check that quietly stopped matching cannot report a
clean tree. The on-chain program is driven separately by the LiteSVM suite in
[`tests/litesvm/tests/`](../../tests/litesvm/tests/), which runs the compiled program.

---

## 1. Class is cosmetic and is read by nothing in scoring

**What it is.** Each entry's character pass shows one of five artwork classes. The class is
decoration. It affects no stat, no battle, no ranking, no tiebreak and no prize. It is the only
random draw in the product.

**Enforced by.**
- `programs/blotto_cup/src/instructions/register.rs` — `entry.class` is written once; nothing in
  the program reads it.
- `backend/reveal/src/chain-web3.ts` — the settlement process's Entry decoder skips the class byte,
  so it never holds the value.
- `backend/scoring/src/` and `programs/blotto_cup/src/instructions/pay_prizes.rs` — do not mention
  the word.

**Proven by.** `scripts/check-standing-rules.sh` rule 5: a whole-word, case-insensitive search for
`class` across `backend/scoring/src`, the Python oracle and `pay_prizes.rs` fails the build on any
hit, and fails if a target has moved.

## 2. No chance in the scoring mechanism

**What it is.** The result is decided entirely by the players' allocations. Every player's battle
*k* is compared with every other player's battle *k*: a stat is won by the larger number, a battle
by three or more of five stats, otherwise a draw. Ranking is battles won, then stats won. The
engine is integer-only (a win is 2 half-points, a draw 1 each) with no random value, no clock and
no float. The same rules apply in both modes (easy: 100 points per battle; hard: 700 across the
board — see §9). When time runs out, unplaced points are spread evenly across unlocked battles by a
fixed rule; nothing is ever chosen at random.

**Enforced by.**
- `backend/scoring/src/engine.ts` (`compareBattle`, `scorePool`), `prizes.ts`, `missing.ts` — one
  TypeScript module (R20), run by both the settlement process and the browser's verify page.
- `app/src/battle/board/spread.ts` — the deterministic time-out spread.

**Proven by.**
- `backend/scoring/fixtures/gen_vectors.py` — an **independent** Python implementation of the rule,
  including entries whose sealed battles were lost; `backend/scoring/test/vectors.spec.ts` checks
  the engine against it, and `scripts/check-fixtures.sh` fails on drift.
- `backend/scoring/test/browser-bundle.spec.ts` — bundles the engine for the browser with Node
  globals removed and reproduces a Python-computed root.
- `app/src/battle/board/spread.test.ts` — the spread is the same for the same board.
- [`../skill-evidence/REPORT.md`](../skill-evidence/REPORT.md) (easy) and
  [`../skill-evidence/hard/REPORT.md`](../skill-evidence/hard/REPORT.md) (hard) — generated,
  deterministic studies of outcomes by allocation strategy, re-run nightly in CI and diffed against
  the committed copy. Entrants who allocate at random place first 0.000% of the time in the easy
  study at both field sizes.

## 3. Sealing: nobody can read an allocation until the pool closes

**What it is.** A player's battles are encrypted on their own device, before they pay, to a key
generated for that pool. The operator cannot read any entry while the pool is taking entries, so
nobody — operator included — can play against known allocations. After close, the pool's secret is
revealed on-chain and published, so anyone can check that it matches the commitment made when the
pool opened.

**Enforced by.**
- `backend/sealing/src/payload.ts`, `sealedbox.ts` — the payload and its encryption, on the device.
- `backend/sealing/src/custody.ts` (`ExportPolicy`), `custody-turnkey.ts` — the pool secret is
  imported to custody and export-locked until the pool is sealed or past its deadline, judged from
  chain state.
- `programs/blotto_cup/src/instructions/register.rs` — takes only the pool id and
  `sha256(battles ‖ salt)`; `open_pool.rs` commits `sha256(secret)`; `reveal_commit.rs` accepts the
  secret only once entries can no longer land.
- `backend/indexer/src/read-api.ts` — has no route that serves a sealed entry, before or after the
  reveal.

**Proven by.** `backend/sealing/test/sealing.spec.ts` (the export policy refuses before close);
`backend/indexer/test/read-api.spec.ts` (the removed routes answer 404 and issue no query);
`app/src/verify/logic.ts` checks the revealed secret against its on-chain commitment for every
pool.

## 4. Every payout can be recomputed from published data

**What it is.** When a pool concludes, a results bundle is published to permanent storage: every
entry's battles and salt, every score, rank and amount, and the committed payouts. The root of the
results tree is committed on-chain. Anyone can recompute the whole result in a browser, with no
wallet and no help from the operator, and check that the player paid is the player who won.

**Enforced by.**
- `backend/reveal/src/bundle.ts`, `publisher-irys.ts` — the bundle and its publication.
- `app/src/verify/logic.ts` (the `/verify` page) — checks the secret, each entry's commitment,
  re-scores with the identical engine, rebuilds the tree, compares it with the **on-chain** root,
  then checks committed and settled payouts.
- `backend/indexer/src/archive.ts` — if a fetched bundle does not reproduce the on-chain root, the
  read API removes the rankings and serves nothing.

**Proven by.** `app/src/verify/logic.test.ts`; `backend/indexer/test/archive.spec.ts` ("rejects a
tampered bundle, records the mismatch, and clears served rankings"); the scoring oracle of §2.

## 5. The prize vault has no withdraw path; a played pool's prize only goes to players

**What it is.** Each pool's prize sits in its own program-owned vault from the moment the pool
opens. There is no withdraw instruction, no admin escape hatch and no "recover stuck funds" path.
Lamports leave a vault by exactly four instructions:

| Instruction | Where the money goes |
|---|---|
| `pay_prizes` | the winning player(s) |
| `release_escrow` | the player whose held share it is |
| `pay_next_place` | the next eligible player(s), after a flag is upheld |
| `trigger_refund` | back to the platform treasury — only for a pool that did **not** reach its minimum field and never played |

So **once a pool plays, its prize is only ever paid to players.** `forfeit_escrow` moves nothing:
an upheld flag leaves the share in the vault until `pay_next_place` divides it among the eligible
players at the rank it passes to. A withheld prize never returns to the operator.

**Enforced by.** `programs/blotto_cup/src/instructions/` — `pay_prizes.rs`, `escrow.rs`,
`refund.rs`; `programs/blotto_cup/src/vault.rs` is the only file that may call the system transfer.

**Proven by.**
- `scripts/check-standing-rules.sh` rule 6: vault debits may occur only in the four named
  `file:function` pairs (check 6(i), which splits every instruction file into function bodies);
  the transfer chokepoint stays in `vault.rs` (6(a), 6(c)); `escrow.rs` cannot address the treasury
  and `forfeit_escrow` moves no lamports (6(h)).
- `tests/litesvm/tests/lifecycle.rs` (`flagged_winners_escrow_then_release_forfeit_and_next_place`),
  `next_place.rs`, `double_payment.rs` (`a_seat_cannot_be_paid_twice_while_the_pool_is_still_payable`,
  `a_batch_cannot_redirect_a_committed_seat_to_another_wallet`), `gates.rs`
  (`malformed_payout_lists_and_wrong_recipients_reject`).

## 6. The prize pool is fixed and funded before entries open

**What it is.** Each tier's prize pool is a fixed amount. Opening a pool moves it from the platform
treasury into the pool's vault before any entry is sold. It is never computed from entries and is
the same whether 40 or 64 players enter. Entries go to the treasury, never to a prize vault. A tier
cannot open a pool unless the treasury holds the full prize pool plus its reserve floor.

**Enforced by.** `programs/blotto_cup/src/constants.rs` (`TIER_POT_LAMPORTS`);
`instructions/open_pool.rs`; `instructions/register.rs`; `instructions/treasury.rs` (the treasury's
own withdrawal, `withdraw_platform`, is multisig-gated and refused below a floor that covers every
open pool's prize and every refundable entry). D-A1, D-E1.

**Proven by.** `scripts/check-standing-rules.sh` checks 6(e) (treasury debits only in `open_pool`,
`refund` and `withdraw_platform`), 6(f) (`register` never touches a vault) and 6(g) (no prize
arithmetic over entries or balances); `tests/litesvm/tests/treasury_gates.rs`
(`open_blocked_when_the_policy_floor_is_unmet`,
`withdraw_blocked_below_the_floor_including_refundable_entries`); `fill_rule.rs`
(`set_tier_economics_accepts_break_even_and_refuses_more`).

## 7. Refund below 40 seats

**What it is.** A pool runs only with at least 40 players. If its 12-hour deadline passes with
fewer, it refunds: `trigger_refund` returns the untouched prize pool to the treasury, and `refund`
repays each entry **in full** from the treasury. Both are callable by anyone, so a refund does not
depend on the operator being available. The floor is written onto each pool when it opens, so it
cannot move under players who already entered. Sealing at the deadline with 40–63 players is also
callable by anyone.

**Enforced by.** `instructions/refund.rs`, `seal.rs`; `state.rs` `Pool.min_seats`;
`constants.rs` `MIN_SEATS`, `DEFAULT_FILL_DEADLINE_SECS`. R7-b, D-E6.

**Proven by.** `tests/litesvm/tests/fill_rule.rs`
(`below_the_minimum_field_the_pool_refunds_and_cannot_seal`,
`a_pool_seals_and_refunds_by_its_own_stored_floor`); `lifecycle.rs`
(`refund_fork_returns_the_full_entry`); `vault_dust.rs` (`a_poisoned_vault_still_refunds`).

## 8. The pass is permanently non-transferable

**What it is.** The character pass cannot be sold, traded or moved. It has no market and pays
nothing. It is frozen at mint, at collection level, and no instruction in the program can unfreeze
it.

**Enforced by.** `programs/blotto_cup/src/pass.rs` — a permanent freeze delegate set at collection
creation, with the pool account (never a person) as update authority. See
[ADR-027](../architecture/adr/adr-027-collection-freeze-propagation.md).

**Proven by.** `tests/litesvm/tests/vrf_and_freeze.rs` (`a_minted_pass_refuses_transfer`).

## 9. The allocation rule, and where it is enforced

**What it is.** Easy pools: seven battles of five stats (Strength, Speed, Heart, Wit, Durability,
in that order), each battle summing to exactly 100. Hard pools: the same thirty-five stats summing
to exactly 700 across the board. The program **cannot** check this and deliberately does not: it
receives only a commitment to the battles, and a program able to check an allocation would be able
to read one, which would end sealing (§3). The rule is enforced at two points that share one
module: the **client** at submission (a violating set cannot be encoded, so no commitment is ever
made for it) and the **scoring engine** at reveal (a malformed set is scored as all losses and its
status is published, and never halts the pool).

**Enforced by.** `backend/scoring/src/allocation.ts` (`assertBattleSet`, `encodeBattleSet`,
`decodeBattleSet`), called from `backend/sealing/src/payload.ts` and `app/src/entry/submit.ts` on
the way in, and from `backend/reveal/src/crank.ts` on the way out; the pool's mode is read from
`Pool.mode`, never inferred. D-E17.

**Proven by.** `backend/scoring/test/allocation.spec.ts`; `app/src/entry/submit.test.ts`;
`app/src/battle/board/machine.test.ts`; `backend/reveal/test/crank.spec.ts`;
`tests/litesvm/tests/hard_mode.rs`.

## 10. Age attestation and terms versioning

**What it is.** Before any paid action the player ticks two unticked boxes — 18 or older, and
acceptance of the terms at the named version — and the wallet signs that exact sentence. The record
is stored only after the signature verifies. An entry cannot be authorised without a record at the
**current** terms version, the entry packet carries that version, and the program refuses a packet
without one. Publishing a new terms edition re-prompts every wallet. This is self-attestation with a
signed record, not age verification by a third party.

**Enforced by.** `backend/_shared/src/attestation-message.ts`; `backend/packet/src/attestations.ts`,
`service.ts`; `programs/blotto_cup/src/entry_packet.rs` (`PacketTermsVersionMissing`);
[`config/terms.json`](../../config/terms.json) (the edition ledger). D-B4.

**Proven by.** `backend/packet/test/attestations.spec.ts`, `terms-editions.spec.ts`;
`app/src/entry/attestation.test.ts` (asserts the re-prompt against the current version);
`tests/litesvm/tests/gates.rs` (`bad_entry_packets_are_rejected`).

## 11. Territory blocking, fail-closed

**What it is.** The service is not available in the territories listed in
[`config/territories.json`](../../config/territories.json), set by the operator and published on the
rules page with its version. Entry is refused when the location cannot be determined, when the
lookup fails, or when no location source is configured. The entry service refuses to start if the
list names a sub-national region the location source cannot resolve, so a rule that cannot be
applied never looks like one that is. Enforcement is at entry, never at payment.

**Enforced by.** `backend/packet/src/territories.ts` (`territoryAllowed`), `service.ts`
(`assertRegionCapability`); `app/src/entry/geo-gate.ts` (the play flow stays closed until an
explicit "allowed"); [`config/territories.README.md`](../../config/territories.README.md) (one row per
code). D-B3, D-B3-3, D-B3-4.

**Proven by.** `scripts/check-territories.ts` (the JSON and its legend agree, every code has a
display name, no unresolvable sub-national code); `backend/packet/test/territories.spec.ts`; `app/src/entry/geo-gate.test.ts`.

## 12. Sanctions screening

**What it is.** Every entrant's wallet is screened against published sanctions lists when the entry
is authorised, and every wallet due a prize is screened again before the pool is paid. A match at
entry refuses the entry. A match before payment places an on-chain hold: the share is held in the
vault, cannot be released, and is excluded from any next-place split. A screening that cannot get
an answer refuses or holds rather than admits or pays. The verdict records list membership only,
never a risk score. With no source configured, the services refuse to start.

**Enforced by.** `backend/sanctions/src/` (`ofac-sdn.ts`, `composite.ts`, `seam.ts`, `wire.ts`);
`backend/packet/src/sanctions-wiring.ts`; `backend/reveal/src/winner-screening.ts`;
`programs/blotto_cup/src/instructions/sanctions.rs` (neither screening instruction moves a
lamport).

**Proven by.** `backend/sanctions/test/`; `backend/packet/test/sanctions-wiring.spec.ts`;
`backend/reveal/test/winner-screening.spec.ts`; `tests/litesvm/tests/lifecycle.rs`
(`a_sanctions_hold_blocks_both_release_paths_and_the_next_place_split`,
`a_sanctions_hold_escrows_the_share_at_payout_without_any_flag`).

## 13. Wallet blocklist with enumerated grounds

**What it is.** The operator can refuse entry from a specific address, but only on one of six
grounds the terms enumerate (integrity criteria met, multiple addresses in one tournament,
territory, under 18, sanctions-listed, other breach of the terms). The ground is recorded per
address so a player who asks can be told which one was relied on. The refusal looks the same as any
other, so the check cannot be used to test whether an address is listed. The list ships empty.

**Enforced by.** `backend/packet/src/blocked-wallets.ts`, `service.ts`;
[`config/blocked-wallets.json`](../../config/blocked-wallets.json) and its legend
[`config/blocked-wallets.README.md`](../../config/blocked-wallets.README.md).

**Proven by.** `scripts/check-blocked-wallets.ts` (every address has a row, every row an address,
every ground enumerated); `backend/packet/test/blocked-wallets.spec.ts`.

## 14. Detection is advisory; a flag is a person's signed decision

**What it is.** Five integrity signals, published on the rules page, are computed for every pool:
allocation entropy, timing profile, duplicate or near-duplicate sets, the same device behind
several entries in one pool, and population-relative score. They **report**; they never flag,
hold or take anything on their own. A flag is a decision by a named reviewer key in
[`config/reviewers.json`](../../config/reviewers.json) (two members), signed and recorded in an
append-only log with the published criterion it cites. A flagged share is held; if no decision is
made within the published 12-hour review window the flag is cleared and the prize is paid, and
after seven days anyone can release a held share to its player. Taking a prize away
(`forfeit_escrow`) needs the admin multisig, which the review service does not hold.

**Enforced by.** `backend/detection/src/signals.ts`; `backend/reveal/src/main.ts` (the detect hook
returns nothing to flag); `backend/detection/src/review.ts`, `auth.ts`, `log-pg.ts`, `budget.ts`
(64 signed decisions per key per hour); `programs/blotto_cup/src/instructions/flags.rs`,
`escrow.rs`; `backend/scoring/src/prizes.ts` (`REVIEW_WINDOW_SECS`). R11, D-E9, D-E7.

**Proven by.** `scripts/check-standing-rules.sh` rule 7 (the daemon returns no hard blocks to the
crank; the automatic escrow tier stays hard-wired off); `backend/detection/test/detection.spec.ts`,
`review-server.spec.ts`, `log-pg.spec.ts`; `backend/reveal/test/review-clock.spec.ts`;
`tests/litesvm/tests/next_place.rs`
(`a_held_share_auto_releases_to_its_player_after_seven_days_unless_forfeited`).

## 15. Complaints route

**What it is.** Any player can raise a complaint, including a challenge to a decision, at
`/complaints`, linked from every page. A person reads and answers it. The published windows are
five working days to acknowledge and thirty days to resolve. Complaints that ask for an outcome to
change must be signed by the wallet; others need not be. Every event in a complaint's life is an
append-only row, and every answer is signed by a reviewer key and records who answered.

**Enforced by.** `backend/detection/src/complaint-windows.ts` (`COMPLAINT_ACKNOWLEDGE_WORKING_DAYS`,
`COMPLAINT_RESOLVE_DAYS`), `complaints.ts` (`mayReadComplaint`), `complaints-pg.ts`; `app/src/app/complaints/`;
`app/src/app/admin/review/complaints-desk.ts`.

**Proven by.** `backend/detection/test/complaints.spec.ts`.

## 16. Data minimisation, custody disclosure and operator identity

**Data minimisation.** The platform holds no name, date of birth, document, phone number or postal
address, and no full IP address in any durable record. Everything it holds is keyed to a wallet
address. Timings and device markers are never published, and the device marker is derived per pool
so entries cannot be linked across tournaments. The full inventory, with retention, is
[`DATA-INVENTORY.md`](DATA-INVENTORY.md). Proven by `backend/indexer/test/read-api.spec.ts` (named
columns, no sealed-entry or rivals route), `app/src/entry/device.test.ts` and the privacy rows of
`app/src/copy/published-claims.test.ts`.

**Custody disclosure.** Who holds each key — program upgrade authority, admin multisig, entry
signer, settlement signer — and the multisig's threshold and timelock are declared in
[`config/custody.json`](../../config/custody.json) and rendered on the `/custody` page
(`app/src/app/custody/custody.config.ts`, tested by `custody.config.test.ts`). Values not yet in
place render as "not yet set" rather than being left out.

**Operator identity.** The legal entity behind the terms and the privacy notice is declared in
[`config/operator.json`](../../config/operator.json). It ships with every value `null`, and the
terms and privacy pages say so. `scripts/check-operator-identity.ts` requires the file on every
cluster and **refuses when the cluster is mainnet and any value is unset**; the backend deploy
workflow (`.github/workflows/deploy-backend.yml`) runs it as a gate before deploying.

## 17. Language gate and published-claims test

**Language gate.** A fixed vocabulary is enforced over every file in the repository — code
identifiers, comments, commit-facing docs, tests and UI copy. It bans chance-framing words,
unprovable trust claims, guarantee claims, finance framing, legal-category assertions and pressure
mechanics (urgency, near-miss, consecutive-play rewards). Enforced and proven by
`scripts/check-language.sh`, which tests itself against a probe on every run; the process is in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md). D-B7.

**Published numbers.** `scripts/check-published-numbers.ts` reads the program's own
`constants.rs` and refuses any rendered copy string that carries a value a shared constant used to
have, as digits or as a number word — so a changed rule cannot leave an old number on screen.

**Published claims.** `app/src/copy/published-claims.test.ts` registers every undertaking on the
rules, terms and privacy pages. Each **mechanism** row names the file that keeps the promise, and
the test fails if that file does not exist or if the registered phrase disappears from the copy.
Each **undertaking** row — a promise kept by a person rather than code — says so in its basis. A
promise cannot be added to the copy, or silently removed from it, without the register changing
with it.

---

## Disclosed residuals

These are published on the terms or rules page rather than left to be found.

- **A lost or unreadable sealed entry is refunded by hand.** The entry is scored as all losses and
  listed in the published bundle; no code pays its refund. The procedure is
  [`OPERATING-MANUAL.md`](../guide/OPERATING-MANUAL.md) §7, and `backend/reveal/src/crank.ts` says
  so in its header.
- **A pool's sealing key cannot be replaced.** If one were permanently lost after its pool closed to
  entries, that pool could not be revealed, settled or refunded (`trigger_refund` requires an open
  pool, `instructions/refund.rs`). Its custody is disclosed in full on the `/custody` page.
- **Group completeness at a later rank is asserted, not proven.** When a forfeited share passes
  below first place, each recipient is proven on-chain against the results root, but that the group
  is complete is the settlement signer's assertion — checkable from the published bundle.

## Known gaps

- **Independent legal review is pending.** No legal opinion has been obtained; one is required
  before any main-network launch.
- **The operating entity is not yet named.** `config/operator.json` is `null` throughout, and the
  mainnet gate refuses until it is filled.
- **The upgrade authority is a single key on devnet**, and the admin multisig is one-of-one with no
  timelock (`config/custody.json`). Both move before mainnet.
- **No independent security audit** of the program has been completed; the internal review is
  [`../security/SECURITY-REVIEW.md`](../security/SECURITY-REVIEW.md).
- **Location screening is IP-based**, so a network route the location provider has not catalogued
  can defeat it, and it cannot resolve sub-national regions (which is why `US` is blocked at country
  level). A second location and screening provider is not yet contracted (D-E14).
- **Multiple accounts across pools cannot be detected by design**, because device markers are per
  pool; the identity-check switch that would address it is off (R3).
- **The two reviewer keys are not yet held by two separate people**, so a decision by a different
  person is recorded where it happens rather than enforced.
- **Retention periods are policy applied by hand**, apart from the two enforced in code
  ([`DATA-INVENTORY.md`](DATA-INVENTORY.md) §3).
- **The results bundle's location is not recorded on-chain.** The read API serves it; the data is
  checkable against the on-chain root once found.
