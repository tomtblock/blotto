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

Last verified against the branch: **2026-09-12**. The program, the backend
packages and the repository's gates were re-read and re-run for the
2026-09-11 audit's X1 wave; the LiteSVM suite and `anchor build` were not
re-run in that pass (they need the Solana toolchain — see §7).

---

## 1. What the product does, in one pass

A player connects a wallet, accepts the terms, and is issued a signed entry
packet by our packet service after an age and territory check. They pay a fixed
entry into an open pool and receive a non-transferable character pass whose
class is drawn on-chain — cosmetic, read by nothing that decides money. In about
ninety seconds they allocate five stats across seven battles, each battle a
distribution of exactly 100 points. The battle set is encrypted **on their
device** before payment and only a hash of it goes on-chain.

A pool has 64 seats and runs with at least 52. It closes when the 64th seat
fills, or when its 12-hour deadline passes with 52 or more seated. Below 52 at
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
"class", and **imported by nothing today**: see §6).

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
| `Pool` | `["pool", id]` | 839 (+8 = 847) | One competition: tier, prices, pot, deadline, state, the class bag, the sealing commitments, the results root and the committed payout list. |
| `Entry` | `["entry", pool, player]` | 219 (+8 = 227) | One seat: player, index, battles hash, class, flags, escrow, and the next-place split book-keeping. Keying on the player is what makes one entry per wallet per pool structural. |
| prize vault | `["vault", id]` | 0 | Zero-data, system-owned. Holds that pool's pot. |
| platform treasury | `["platform"]` | 0 | Zero-data, system-owned. Receives 100% of entry payments and funds every pot. |
| pass collection | `["pass_collection", pool]` | — | The Metaplex Core collection whose frozen state every pass inherits. |

Layouts are pinned byte-for-byte by `account_layouts_are_pinned` in `state.rs`.
The `Config` tail (`keeper`, `fill_deadline_seconds`, `cooldown_seconds`,
`tier_next_open_at`) was appended **after** `bump` on 2026-09-07 so every
existing offset reader stayed valid; `migrate_config` grows the live account
once.

### Instructions

Thirty-two instructions, by who may send them.

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
revealed, therefore never settled, and past `MIN_SEATS` it can no longer
refund either — the pot and up to 64 entries with no on-chain route to anyone.
A frozen tier strands nothing by comparison, and the admin can rotate the
keeper at any time. Sealing and refunding an *existing* pool remain
permissionless, which is what actually protects players. `tier_next_open_at`
survives as the tier's cooldown alone, and the keeper may never be the zero
key (audit A7).

*Anyone.* `fund_platform_wallet`, `commit_vrf_seed`, `create_pass_collection`,
`seal_at_deadline`, `trigger_refund`, `refund`, and `release_escrow` once the
seven-day safeguard window has passed.

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
before payment**. `sha256(battles‖salt)` goes on-chain with the entry.

The pool's secret is generated by our own process, imported into Turnkey, wiped
locally, and export-locked until the pool is sealed or past its deadline. That
is stated plainly in the rules copy, and it is the honest position: the operator
generates the key. The read API refuses to serve ciphertexts before the reveal.

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
reissue it**; the divergences are listed so the reissue is a single pass.

| Document | Says | The build |
|---|---|---|
| PID §1, §6, §2 table, §7 diagram | Top 16 paid; prize pool is 80% of entries; platform retains 20% | One paid place. Pots are fixed constants funded before entries open; the operator's margin is entries minus the pot |
| PID §2 | Prize pools 5.12 / 25.60 SOL at the first two tiers | 4 / 20 / 30 / 40 / 100 / 200 / 300 SOL across seven tiers |
| PID §2 | Fill deadline 72 hours; 32–63 run at reduced size; fewer than 32 refunds | 12 hours; 52–63 run; fewer than 52 refunds |
| PID §5 | Prose implies entry order can affect ranking | Entry order decides only the indivisible remainder and the published leaf order. Ranks come from score and zones alone |
| PID §8.3 table | "Paid 16 who are genuinely top-16" | One paid place; the skill evidence needs restating against rank-1 rate |
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
4. **The territory list** covers Belgium and Australia only. The jurisdictions
   the founder listed (Australia, Belgium, India, the United States, the UAE and
   the GCC, China, Hong Kong, Singapore, Malaysia, Indonesia, and sanctioned
   jurisdictions) are not in `config/territories.json`.
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
./scripts/check-language.sh        # the PID §8.7 lexicon
./scripts/check-standing-rules.sh  # the vault's exit set, class out of scoring
./scripts/check-env-examples.sh    # every env var a service reads is documented
./scripts/check-container-user.sh  # no service image runs as root
./scripts/check-fixtures.sh        # the Python oracles reproduce their vectors
python3 scripts/check-mirrors.py   # Rust and TypeScript constants agree
./scripts/ci-gate.sh --self-test   # the deploy gate still judges correctly
```

Every backend package additionally has `npm run typecheck` and `npm test`
(nine of them: `_shared`, `scoring`, `class-digest`, `sealing`, `sanctions`,
`reveal`, `indexer`, `packet`, `detection`).

The one step with a dependency outside this repository is `anchor build`: the
LiteSVM suite runs against the compiled `.so`, and without the Solana toolchain
installed it has no artifact to drive. The current pass counts, wave by wave,
are in `../AUDIT_2026-09-11_RESPONSE.md` rather than repeated here — a number
copied into this file is stale the next time a test is added.
