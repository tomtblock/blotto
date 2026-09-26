# Blotto Cup — as built

**What this document is.** A description of the system that exists in this
repository right now: what runs, where, what talks to what, and which parts of
the intent documents have not been built yet. It is written from the code, and
it is the document to read when you need to know what the software *does*
rather than what it is *for*.

**How it differs from its neighbours.** `PID_Blotto-Cup_v0.5.md` is the
founder's product intent and is deliberately ahead of the build in places (§ [Where
the intent documents and the build disagree](#where-the-intent-documents-and-the-build-disagree)
lists every one). `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` is the architecture as
designed in August 2026 and has not been reissued since; where it and this file
disagree, **this file is right about what exists** and TECH-ARCH is right about
what was intended. `01_PRODUCT_FACTS/PRODUCT-FACTS_BlottoCup_v1.md` states the
same system for counsel and auditors, fact by fact with citations; this file is
the engineer's version of it.

Last verified against the branch: **2026-09-13**. The program, the backend
packages and the repository's gates were re-read and re-run for the
2026-09-11 audit's X1 wave and again for the 2026-09-12 founder instruction
(the tier gate, the country block and the 40-at-12h fill rule). The LiteSVM
suite and `anchor build` ran for the fill-rule change; they need the Solana
toolchain — see §7.

---

## 1. What the product does, in one pass

A player connects a wallet, accepts the terms, and is issued a signed entry
packet by our packet service after an age and territory check. They pay a fixed
entry into an open pool and receive a non-transferable character pass whose
class is drawn on-chain — cosmetic, read by nothing that decides money. In about
ninety seconds they allocate five stats across seven battles — in an EASY pool
each battle a distribution of exactly 100 points; in a HARD pool (Phase B,
2026-09-25, `Pool.mode`) 700 points placed anywhere across the thirty-five
stats. The battle set is encrypted **on their device** before payment and only
a hash of it goes on-chain.

A pool has 64 seats and runs with at least 40. It closes when the 64th seat
fills, or when its 12-hour deadline passes with 40 or more seated. Below 40 at
the deadline every entry refunds in full. Nothing an operator holds decides
which of those happens.

Once closed, the pool's decryption secret is published on-chain. Every battle
set becomes readable, the scoring is re-run by anyone who wants to, and the
player ranked first is paid the whole fixed prize pool — funded from the
treasury before entries opened, and the same size whatever the field turned out
to be.

## 2. The pieces

```
                    browser (Next.js on Vercel)
                      │        │            │
          packet ◄────┘        │            └────► indexer read API
        (entry gate)           │                    (GET /pools, /treasury…)
             │                 ▼
             │            Solana devnet ───► Helius webhook ──► indexer
             │          (program blotto_cup)                      │
             │                 ▲                                  ▼
             │                 │                              Postgres
             │                 │                            (event ledger
      reveal daemon ───────────┘                             + projections)
    (keeper + crank)                    review service ──────────┘
             │                        (named reviewers, signed log)
             ▼
        Irys (the published bundle)
```

Five deployable units. Four backend services on Fly, one frontend on Vercel:

| Unit | Where | Port | What it is |
|---|---|---|---|
| `app` | Vercel | — | The Next.js frontend. Reads the indexer, posts to the packet service, signs transactions in the browser. |
| `backend/indexer` | Fly `blotto-indexer` | 8080 webhook, 8081 read API | Ingests program events (Helius webhook + backfill), projects them into Postgres, serves the public read API and the treasury report. |
| `backend/packet` | Fly `blotto-packet` | 8082 | The entry gate. Checks the age attestation and the territory, then issues an Ed25519-signed packet the program verifies at `register`. |
| `backend/detection` | Fly `blotto-review` | 8083 | The review desk: defines the five published integrity signals (the daemon runs them at settlement and persists the report), records named reviewers' signed decisions in an append-only log, and serves that log back. `POST /decisions` (reviewer-signed), `POST /appeals` (player-signed), `GET /decisions`, `GET /appeals` and `GET /pending` are public reads of a public log; `GET /detection` serves the persisted detection report and is the one operator-token route — it names players before a human has looked at them (ruling D-E9). |
| `backend/reveal` | Fly `blotto-daemon` | 8084 health | The keeper and the crank. Opens pools, seals or refunds them at the deadline, reveals the secret, scores, commits results, pays, publishes the bundle. |

Five of the packages are libraries rather than services: `backend/_shared`
(config, Postgres, monitoring, the event decoders), `backend/scoring` (the
scoring engine, prize maths and the Merkle tree — one module, used by both the
crank and the browser), `backend/sealing` (the sealed-box payload format and
pool-key custody), `backend/sanctions` (list loading and screening, used by the
entry gate and the crank alike), and `backend/class-digest` (the class draw
replayed in TypeScript — its own package so the scoring path can never mention
"class", and **imported by no application module**: see §6).

## 3. The program

Anchor 1.0.2 on Solana 3.1.10. Program id
`5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`, deployed to devnet only.

**Where that id is written down.** `declare_id!` in
`programs/blotto_cup/src/lib.rs` is the authority; nine other non-test files
carry it as a literal, and a redeploy under a new keypair has to change all of
them in one commit. The list is not advisory: the unit test
`every_hard_coded_program_id_matches_declare_id` in `lib.rs` reads each of these
files and fails if it disagrees with `declare_id!`.

| File | What the copy is |
|---|---|
| `Anchor.toml` (×2) | `[programs.localnet]` and `[programs.devnet]` |
| `config/custody.json` | The published custody disclosure the app renders |
| `backend/indexer/src/config.ts` | `DEFAULT_PROGRAM_ID`, used when `BLOTTO_PROGRAM_ID` is unset |
| `backend/detection/src/main.ts` | The same default, review service |
| `backend/reveal/src/main.ts` | The same default, daemon |
| `scripts/admin.ts` | `--program`'s default |
| `scripts/check-deployed.ts` | The drift check's default |
| `.github/workflows/deploy-backend.yml` | `PROGRAM_ID` for the deploy |
| `app/.env.example` | Named in the comment beside `NEXT_PUBLIC_PROGRAM_ID` |

Two more copies are outside the repository and beyond any test's reach:
**Vercel's `NEXT_PUBLIC_PROGRAM_ID`**, set by hand in the project settings
(`go-live-devnet.md` §3, the Vercel step), and **Fly's `BLOTTO_PROGRAM_ID`** on
each service — that one is set by `deploy-backend.yml` from the `PROGRAM_ID` in
the table above, so it follows automatically on the next backend deploy. The
founder-facing checklists (`go-live-devnet.md`, `devnet-rehearsal-runbook.md`)
also quote the id in worked examples.

### Accounts

| PDA | Seeds | Size | Holds |
|---|---|---|---|
| `Config` | `["config"]` | 476 (+8 = 484) | The four service keys, the tier tables, the switches, the treasury book-keeping, the timings and the per-tier cooldown stamps. Singleton. |
| `Pool` | `["pool", id]` | 841 (+8 = 849) | One competition: tier, prices, pot, deadline, **the minimum field it plays by** (`min_seats`), state, the class bag, the sealing commitments, the results root and the committed payout list. |
| `Entry` | `["entry", pool, player]` | 220 (+8 = 228) | One seat: player, index, battles hash, class, flags, escrow, the sanctions hold, and the next-place split book-keeping. Keying on the player is what makes one entry per wallet per pool structural. |
| prize vault | `["vault", id]` | 0 | Zero-data, system-owned. Holds that pool's pot. |
| platform treasury | `["platform"]` | 0 | Zero-data, system-owned. Receives 100% of entry payments and funds every pot. |
| pass collection | `["pass_collection", pool]` | — | The Metaplex Core collection whose frozen state every pass inherits. |

Layouts are pinned byte-for-byte by `account_layouts_are_pinned` in `state.rs`.

**Both growths so far appended, and each has a one-shot migration.** Appending
rather than inserting is not a style preference: external readers hold byte
offsets into these accounts (`entrants` at 33, `fill_deadline` at 43, `state`
at 51), and Anchor refuses to deserialise an account shorter than its current
layout — so a live account has to be grown before the new program can read it.

| Growth | When | Field(s) | Migration |
|---|---|---|---|
| `Config` 372 → 476 | 2026-09-07 | `keeper`, `fill_deadline_seconds`, `cooldown_seconds`, `tier_next_open_at`, appended after `bump` | `migrate_config`, once |
| `Pool` 839 → 841 | 2026-09-13 | `min_seats`, appended after `vault_bump` (R7-b) | `migrate_pool`, once per existing pool |

`migrate_pool` is permissionless, moves no lamports, refuses an account already
at the current size, and writes `MIN_SEATS_V1` = 52 — the floor the players in
those pools actually entered under, not today's 40. The order it runs in is
`docs/RUNBOOK_r7b-upgrade.md`.

### Instructions

Thirty-three instructions, by who may send them.

*Admin (the Squads vault; devnet uses a fee-payer stand-in).* `init_config`,
`migrate_config`, `set_keeper`, `set_pool_timing`, `set_paused`,
`rotate_entry_signer`, `set_settlement_signer`, `set_open_tiers`,
`set_vault_ceiling`, `set_kyc_threshold`, `set_detection_hard_block`,
`set_tier_economics`, `set_treasury_policy`, `withdraw_platform`,
`forfeit_escrow`, `lift_sanctions_hold`. The last two are admin-signed for the
same reason: a hot key may stop a payment, but only a deliberate multi-party
act may uphold a forfeit or clear a list match.

*Keeper only.* `open_pool`. **Nobody else, at any idle time**, since the
founder ruling of 2026-09-07 (audit O9b/A5b). The 24-hour liveness fallback
that used to let any signer open a long-idle tier is gone: the opener supplies
the pool's sealing key, so a pool opened by anyone but us can never be
revealed, therefore never settled, and past its own `min_seats` it can no
longer refund either — the pot and up to 64 entries with no on-chain route to anyone.
A frozen tier strands nothing by comparison, and the admin can rotate the
keeper at any time. Sealing and refunding an *existing* pool remain
permissionless, which is what actually protects players. `tier_next_open_at`
survives as the tier's cooldown alone, and the keeper may never be the zero
key (audit A7).

*Anyone.* `fund_platform_wallet`, `commit_vrf_seed`, `create_pass_collection`,
`seal_at_deadline`, `trigger_refund`, `refund`, `migrate_pool`, and
`release_escrow` once the seven-day safeguard window has passed. `migrate_pool`
is permissionless on purpose: it only grows an account to the current layout
and cannot move a lamport, so gating it would add a key without adding a
protection.

*Players.* `register`.

*Settlement signer.* `reveal_pool_secret`, `commit_results`, `pay_prizes`,
`pay_next_place`, `flag_entry`, `clear_flag`, `place_sanctions_hold`,
`release_escrow` (the reviewed path). Placing a hold is settlement-signed
because it moves nothing and has to be fast — a hold placed late is a payment
made; lifting one is admin-signed, above.

### The money model

Every lamport movement in the program goes through `vault.rs`. Nothing else may
call `system_program::transfer`, and CI asserts it.

- **Entries** go 100% to the platform treasury at `register`, and are tracked in
  `Config.platform_refundable` so a refund is program-held money rather than an
  operator promise. They leave that floor when the pool seals.
- **Pots** are fixed per-tier constants moved from the treasury into the pool's
  vault at `open_pool`, before a single pass sells. A pot is never derived from
  entries or from a balance; CI greps for that arithmetic and fails on it.
- **The prize vault has exactly four exits**: `pay_prizes`, `release_escrow`,
  `pay_next_place`, and `refund` (which is where `trigger_refund`'s pot return
  also lives). There is no withdraw instruction, no admin escape hatch and no
  recover-stuck-funds path.
- **`forfeit_escrow` moves nothing.** It records that review upheld a flag. The
  share stays in that pool's own vault and can leave only by `pay_next_place`,
  which pays players. No lamport reaches the operator from a prize vault, ever.
- **The treasury has exactly one exit**, `withdraw_platform`, admin-gated and
  blocked on-chain below the policy floor: the minimum balance, plus one further
  pot for every idle enabled tier, plus every refundable entry.

### The forfeited-share split

When a winner's flag is upheld, the share is divided **equally** among the
remaining eligible players at that rank.

At first place the whole group is on-chain — under one paid place the committed
payout list *is* the rank-1 group — so the program computes the eligible set,
its size, and which member takes the indivisible remainder, and refuses any call
whose arguments disagree. One member is paid per call, tracked in
`split_paid_mask` on the forfeiter's Entry, and the last payment must empty the
share exactly.

When no first-place member is eligible, the share passes to the next competition
rank. Each member there is proven to hold that rank by a Merkle proof against
the committed results root. What the program cannot prove is that the presented
group is *complete* — that is the settlement signer's assertion, it is disclosed
on the rules page, and the published bundle names the whole group so any
deviation is visible. The signer cannot route money to itself or to the
operator: the four service keys are refused entry, and there is no treasury path
in `escrow.rs` at all.

## 4. Sealing, scoring and verification

The 127-byte payload — battles (35) + salt (32) + per-screen timings (28) +
device hash (32) — is sealed to the pool's X25519 public key **in the browser,
before payment**. `sha256(battles‖salt)` goes on-chain with the entry. A HARD
pool's payload is 162 bytes (battles as 35 × `u16` little-endian, 70 bytes) and
its commitment hashes that encoding, so the same numbers commit differently
under the two rules; the packet service holds a sealed box to the pool's
mode, the crank decodes and scores by `Pool.mode`, and the published bundle is
**version 3** and names `mode` (a version-2 bundle reads as easy). One module
holds both rules — `backend/scoring/src/allocation.ts` — and every function in
it defaults to easy.

The pool's secret is generated by our own process, imported into Turnkey, wiped
locally, and export-locked until the pool is sealed or past its deadline. That
is stated plainly in the rules copy, and it is the honest position: the operator
generates the key. The read API serves no ciphertext at all: until 2026-09-16 it
served every seat's box once the secret was on chain, which published the timings
and the device hash that bundle version 2 keeps out of the published set. The
boxes now have no public reader; the published bundle is the only public battle
set, and the browser checks it against the on-chain hashes
(`docs/CHANGE-2026-09-16_data-minimisation.md`).

At settlement the daemon exports the secret, publishes it on-chain, decrypts
every payload, and checks each against its committed hash. Anything that fails —
missing ciphertext, failed decryption, hash mismatch, or a battle set that
breaks the allocation invariant — is scored **all losses** by the published rule
in `missing.ts`, and its status is published in the bundle. One malformed entry
can therefore never halt a pool's settlement.

Scoring is identical-field: battle *k* against every other entry's battle *k*, a
battle won on at least three of five stats, otherwise a draw worth half a win to
each. Half-points are carried as integers; no float touches a score or a
lamport. Ranking is battles won, then stats won; players equal on both share a
competition rank and split the combined prize of the positions they occupy, with
the indivisible remainder going to the lowest entry number.

The same module runs in the crank and in the browser. The verify page re-derives
the results tree from the published bundle and compares its root against the
on-chain root, with the wallet disconnected and no operator involvement.

## 5. Where the intent documents and the build disagree

Nothing in this section is a bug. Each is a place where a document written
earlier has not been reissued, and where a reader trusting the document would be
misled. **`PID_Blotto-Cup_v0.5.md` is founder-owned and only the founder can
reissue it**; the divergences are listed so the reissue is a single pass. Since
2026-09-13 the PID carries a founder-authorised appendix that already annotates
the first three rows below; the rest are still unannotated in the PID itself.

| Document | Says | The build |
|---|---|---|
| PID §1, §6, §2 table, §7 diagram | Top 16 paid; prize pool is 80% of entries; platform retains 20% | One paid place. Pots are fixed constants funded before entries open; the operator's margin is entries minus the pot |
| PID §2 | Prize pools 5.12 / 25.60 SOL at the first two tiers | 4 / 20 / 30 / 40 / 100 / 200 / 300 SOL across seven tiers |
| PID §2 | Fill deadline 72 hours; 32–63 run at reduced size; fewer than 32 refunds | 12 hours (D-E6); **40–63 run; fewer than 40 refunds** (R7-b, founder ruling 2026-09-12, landed 2026-09-13 — was 52 under D-E4) |
| PID §5 | Prose implies entry order can affect ranking | Entry order decides only the indivisible remainder and the published leaf order. Ranks come from score and zones alone |
| PID §4.5 table (cited by §8.3) | "Paid 16 who are genuinely top-16" | One paid place; the skill evidence needs restating against rank-1 rate |
| TECH-ARCH §10 | Five steppers with quick-set chips | A draggable pentagon with live normalisation and an even-split button (PID §4 overrides; recorded in `INDEX.md`) |
| TECH-ARCH §3.2, §13 | A `claim` instruction and a claim step | Prizes are pushed. There is no claim step |
| TECH-ARCH table of instructions | `register` splits 80/20 into vault and platform | `register` credits 100% to the treasury; the vault is read-only to it |
| CLAUDE.md hard rules (corrected 2026-09-07) | "The program rejects" a bad allocation | The program never sees an allocation. The client and the scoring engine enforce it; see §4 |
| BUILD-ROADMAP §2.4 | "Publish plaintext set + salts + timings to Irys" | Since 2026-09-12 (bundle version 2, audit B-31) the published bundle carries battles, salts, commitments and statuses only. The timings and the device hash reach the detection pipeline through `revealEntries(...).forDetection` and are never published: the bundle is permanent, verification needs neither, and the device hash is stable across pools |

## 6. What is not built

Stated plainly, because these were once published as though they were built.

1. *Sanctions screening now runs at BOTH ends of a pool's life* (Stages A–B
   and F), so the last of the four published promises the audit recorded is
   operational. At **entry**, the packet service screens every entrant
   through `backend/sanctions/` and refuses to start with no source
   configured. At **resolving**, the crank screens every wallet in the
   committed payout list — a tie for first has several, and each is a
   winning wallet — and places an on-chain **sanctions hold**
   (`instructions/sanctions.rs`, settlement-signed to place, admin-signed to
   lift) on any it must not pay. Both services select, load and refresh
   their lists through the same wiring (`sanctions/src/wire.ts`), so the two
   ends cannot drift apart.

   What a hold does: `pay_prizes` **escrows** that share instead of sending
   it, both paths of `release_escrow` — including the seven-day
   permissionless one — refuse to let it out, and **both** of
   `pay_next_place`'s eligibility checks refuse it: `eligible()`, which
   classifies the committed peers, and the inline check on the recipient. A
   held wallet is therefore neither counted in a first-place group nor paid
   a next-place portion — and a hold on one winner does not strand a
   forfeited share, which simply passes to the next rank. The
   batch is never refused, so one held wallet cannot leave a pool short of
   `Paid` and strand its tier. A screening that **cannot answer** holds too:
   the pool settles and one payment waits for a human, because paying a
   wallet nobody could check is the one outcome the promise forbids. It is
   emphatically not a flag — list membership carries no reviewer, no
   criterion and no finding about play, and no path here moves a lamport.

   Still counsel's, not the code's: where a confirmed match's money finally
   goes. Held indefinitely as blocked property is the conventional answer,
   and the hold is built so any answer can be supplied later. What is not
   built, and will not be, is a path to the operator.
2. *Resolving, the 12-hour clock and the next-place payment are all built*
   (Stages C, D and the O23 driver). The daemon divides an upheld flag's
   share among the eligible players at the rank it passes to, recomputing
   the published ranking from the pool secret and the sealed entries to
   prove each recipient's leaf against the committed root — so the promise
   "an upheld prize is paid to the next eligible player, never to us" is
   now reachable rather than merely true on-chain. In detail (Stages C
   and D): resolving is a flag the read API derives — a pool is resolving
   while it carries a held share and `REVIEW_WINDOW_SECS` has not passed since
   the indexer saw its `PrizesPaid` — rendered as the RESOLVING badge with a
   countdown; and the daemon's review clock releases a settled, flagged,
   still-escrowed, not-forfeited share to its player once the same window has
   passed since the on-chain `escrowed_at`, holding the pool non-terminal
   until then. The flag bit stays set (`clear_flag` refuses a settled entry by
   design); the escrow reaching zero is the record that review ended without
   an upheld flag.
3. **A second reviewer.** The appeal route is built (Stage E): the affected
   wallet lodges within seven days of an upheld flag, signed over its own
   canonical message and appended to the same signed log; a registry member
   *other than the reviewer who upheld the flag* decides it; the form is on
   the results page for that wallet only; every row re-verifies from the log
   alone (`backend/detection/src/appeals.ts`). What is missing is founder-owned:
   `config/reviewers.json` holds one member, so an appeal can be lodged but
   none can be decided, and the service says so at boot (audit O24).
4. **Two rows of the founder's territory list are still not enforceable.**
   `config/territories.json` carries eighteen country codes as of schedule
   version 3 (2026-09-12) — India, Belgium, Australia, the six GCC states,
   China, Hong Kong, Singapore, Malaysia, Indonesia. The **US states** are
   held on a technical constraint, not a decision: the geo source of record
   returns a subdivision name, never an ISO 3166-2 code, so `assertRegionCapability`
   refuses to start the entry service with any sub-national code in the
   schedule — a rule that cannot be applied must not look like one that is.
   The **sanctioned jurisdictions** row waits on counsel's exact list, and
   opens nothing meanwhile: those wallets are already refused by the entry
   screening, which checks live lists rather than a country code.
   `config/territories.README.md` carries one row per code and what would
   unblock each of the two.
5. **Cost instrumentation.** The daemon does not measure what a pool cycle
   costs; only a test seam for that measurement exists. It does have a
   balance threshold, but a coarse one: `assertCanPayFees` refuses to start
   when the settlement signer holds under 0.05 SOL (`backend/reveal/src/startup.ts`),
   and `/health` re-reads the balance every tick. Nothing halts a *running*
   daemon as the balance falls — it keeps ticking and the transactions begin
   to fail.
6. **The live twenty-pool devnet rehearsal.** The offline rehearsal runs in CI;
   the funding-and-sweep harness for a real devnet run has no runner wired.
7. **Turnkey co-signing for settlement.** The settlement key is a keypair file
   decoded into tmpfs at boot.
8. **The verify page does not replay the class draw.** `backend/class-digest`
   implements the replay in TypeScript, pinned to the same Python vectors as
   the Rust crate and mirror-checked against the program's class bag by
   `scripts/check-mirrors.py` — but no application module imports it, so a
   player who wants to recompute their own class does it themselves from the
   published events (audit 2026-09-11, A-21/A-31/F-18). What is published is
   still true: the rules copy says "every class draw is replayable from
   published on-chain data", and the inputs are all on chain —
   `PoolVrfSeeded.vrf_seed` plus each `EntryRegistered`'s `index`,
   `slot_hash`, pool and player. What is missing is the convenience of a page
   that does it for you.

Items 1–3 are tracked by `app/src/copy/published-claims.test.ts`, which fails
the build if a published promise is added without a decision about whether we
can keep it, and which will fail if the known-gap set changes without being
updated here.

## 7. Verifying it yourself

```
npm run setup                      # installs every backend package, then the app
cargo test --workspace             # program unit tests + the 10k-case vault fuzz
anchor build --ignore-keys         # the SBF artifact — needs the Solana toolchain
cd tests/litesvm && cargo test     # the integration suite, against that artifact
cd app && npm run lint && npm run typecheck && npm test && npm run build
```

Then every gate CI's `standing-rules` lane runs — each one self-tests, so a
gate that has stopped working says so instead of reporting clean:

```
./scripts/check-language.sh                     # the PID §8.7 lexicon
./scripts/check-standing-rules.sh               # the vault's exit set, class out of scoring
npx tsx scripts/check-territories.ts            # the founder's schedule is enforceable
npx tsx scripts/check-published-numbers.ts      # published copy carries no superseded constant
npx tsx scripts/sim/fill-replay.ts --self-test  # the simulation still models the fill rule
npx tsx scripts/drain-verdict.ts --self-test    # the upgrade pre-flight still refuses
./scripts/check-env-examples.sh                 # every env var a service reads is documented
./scripts/check-container-user.sh               # no service image runs as root
./scripts/check-fixtures.sh                     # the Python oracles reproduce their vectors
python3 scripts/check-mirrors.py                # Rust and TypeScript constants agree
./scripts/ci-gate.sh --self-test                # the deploy gate still judges correctly
./scripts/deploy-devnet.sh --self-test          # the program deploy still reads a cluster
```

All twelve, in the lane's own order. `ci-fast` runs five further jobs —
`rust`, `node`, `postgres`, `journey` and `gitleaks`.

The sixth of the twelve drives the upgrade pre-flight's verdict through its
fixtures. The pre-flight (`pools --upgrade-preflight`) refuses a program
upgrade while any pool is Open — see §5's note on the floor the read API
serves, and `RUNBOOK_r7b-upgrade.md`. **The verdict lives in
`scripts/drain-verdict.ts`, importing nothing**, precisely so this lane can run
it: the lane installs no workspace, and `scripts/admin.ts` imports
`@solana/web3.js`. Operators reach the same fixtures through the familiar
command:

```
npx ts-node --transpile-only scripts/admin.ts pools --self-test
```

Every backend package additionally has `npm run typecheck` and `npm test`
(nine of them: `_shared`, `scoring`, `class-digest`, `sealing`, `sanctions`,
`reveal`, `indexer`, `packet`, `detection`).

The one step with a dependency outside this repository is `anchor build`: the
LiteSVM suite runs against the compiled `.so`, and without the Solana toolchain
installed it has no artifact to drive. The current pass counts, wave by wave,
are in `../AUDIT_2026-09-11_RESPONSE.md` rather than repeated here — a number
copied into this file is stale the next time a test is added.
