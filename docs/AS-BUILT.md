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

Last verified against the branch: **2026-09-07**, full suite green.

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
| `backend/detection` | Fly `blotto-review` | 8083 | The review desk: computes the five published integrity signals, and records named reviewers' signed decisions in an append-only log. |
| `backend/reveal` | Fly `blotto-daemon` | 8084 health | The keeper and the crank. Opens pools, seals or refunds them at the deadline, reveals the secret, scores, commits results, pays, publishes the bundle. |

Three of the packages are libraries rather than services: `backend/_shared`
(config, Postgres, monitoring, the event decoders), `backend/scoring` (the
scoring engine, prize maths and the Merkle tree — one module, used by both the
crank and the browser), and `backend/sealing` (the sealed-box payload format and
pool-key custody).

## 3. The program

Anchor 1.0.2 on Solana 3.1.10. Program id
`5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`, deployed to devnet only.

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

*Admin (the Squads vault; devnet uses a fee-payer stand-in).* `init_config`,
`migrate_config`, `set_keeper`, `set_pool_timing`, `set_paused`,
`rotate_entry_signer`, `set_settlement_signer`, `set_open_tiers`,
`set_vault_ceiling`, `set_kyc_threshold`, `set_detection_hard_block`,
`set_tier_economics`, `set_treasury_policy`, `withdraw_platform`,
`forfeit_escrow`.

*Keeper (or anyone after the 24-hour liveness fallback).* `open_pool`.

*Anyone.* `fund_platform_wallet`, `commit_vrf_seed`, `create_pass_collection`,
`seal_at_deadline`, `trigger_refund`, `refund`, and `release_escrow` once the
seven-day safeguard window has passed.

*Players.* `register`.

*Settlement signer.* `reveal_pool_secret`, `commit_results`, `pay_prizes`,
`pay_next_place`, `flag_entry`, `clear_flag`, `release_escrow` (the reviewed
path).

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

## 6. What is not built

Stated plainly, because two of these are published as though they were.

1. **Sanctions screening.** The rules page says the winning wallet is checked
   against published sanctions lists. No screening code exists.
2. **The `Resolving` state and the 12-hour review clock.** The rules page says a
   settled pool enters resolving for up to 12 hours and that an undecided flag
   is then cleared and paid. There is no such state and no such timer; the
   program has only the seven-day permissionless safeguard.
3. **The appeal route.** Published as a 7-day window decided by a second
   reviewer. The review service records decisions but has no appeal path.
4. **The territory list** covers Belgium and Australia only. The jurisdictions
   the founder listed (Australia, Belgium, India, the United States, the UAE and
   the GCC, China, Hong Kong, Singapore, Malaysia, Indonesia, and sanctioned
   jurisdictions) are not in `config/territories.json`.
5. **Cost instrumentation and keeper thresholds.** The daemon does not measure
   what a pool cycle costs and has no balance-driven halt. Only a test seam
   exists.
6. **The live twenty-pool devnet rehearsal.** The offline rehearsal runs in CI;
   the funding-and-sweep harness for a real devnet run has no runner wired.
7. **Turnkey co-signing for settlement.** The settlement key is a keypair file
   decoded into tmpfs at boot.

Items 1–3 are tracked by `app/src/copy/published-claims.test.ts`, which fails
the build if a published promise is added without a decision about whether we
can keep it, and which will fail if the known-gap set changes without being
updated here.

## 7. Verifying it yourself

```
npm run setup                      # installs every backend package, then the app
cargo test --workspace             # program unit tests + the 10k-case vault fuzz
anchor build --ignore-keys         # the SBF artifact
cd tests/litesvm && cargo test     # the integration suite, against that artifact
cd app && npm run lint && npm run typecheck && npm test && npm run build
./scripts/check-language.sh        # the PID §8.7 lexicon
./scripts/check-standing-rules.sh  # the vault's exit set, class out of scoring
./scripts/check-env-examples.sh    # every env var a service reads is documented
```

At the time of writing that is 767 tests, all green.
