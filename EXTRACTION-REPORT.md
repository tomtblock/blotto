# Extraction Report — `anarchy-fun` → `blotto-cup`

**Phase 0, per `REPO-EXTRACTION-BRIEF_v1.1.md` §9 and `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §12.**
Source: an unpacked zip of `anarchy-fun`, read-only, no `.git` directory.

---

## In plain language, before any file paths

**What Phase 0 was for.** The old product and Blotto Cup share almost nothing — one was an NFT
launchpad, the other is a skill competition — but they share a chain, a toolchain and a handful of
genuinely hard pieces of engineering. The job was to take those pieces and leave everything else
behind, in a repository with no history to inherit.

**What came across and works.** Four things.

1. **The randomness engine.** The code that turns on-chain data into a fair, verifiable, cosmetic
   character class. It works, it is tested, and this time the tool that generates its test data came
   with it — in the old repo that tool was lost, which meant nobody could check the tests were
   right. 19 tests pass.
2. **The permanent freeze on the character pass.** The old product had figured out, by running real
   experiments on a test network, how to make an NFT genuinely non-transferable. That mechanism is
   carried. **The instruction that undid it is not**, deliberately: a pass that can be unfrozen has
   a resale market, and PID §8.2's legal analysis depends on it not having one.
3. **The randomness oracle plumbing.** The code that safely reads a verifiable random number from
   Switchboard, including several non-obvious constraints that cost the old team time to discover.
   The program compiles and builds.
4. **The front-end and back-end foundations.** Wallet connection, transaction handling, the
   character-reveal animation, and the database and monitoring plumbing the sealing and detection
   layers will need. 177 tests pass across the two.

**What turned out not to exist.** The brief expected four things that simply were not in the old
repository: the Merkle commitment code, the signed entry-packet code, the file-upload and image
generation clients, and the verification page. The brief was written without access to the repo and
said to check — this is the checking. Each of those is new work for Phase 1 or 2, and each now has
a directory with a README explaining what belongs there.

**What is left for Phase 1.** The program itself — the pool, the entry, the prize vault and the
money paths — is not built. Neither is the scoring, the sealing, the detection or the battle screen.
Phase 0 built the skeleton those go into, not the things themselves. Read the table in `README.md`
before assuming anything is implemented.

**The one thing to action now.** The devnet program keypair was generated inside a temporary
container and **its private half cannot survive this session.** Regenerating it takes one command
and is written out in `TRANSITION-REPORT.md`. Nothing else is blocked on it.

---

## Pre-scan

Run before any file was copied, per brief §7.0. gitleaks 8.30.1, pinned to match the old CI.

The old repository's own `.gitleaks.toml` **allowlists both of its committed keypairs**, so a scan
using it reports clean. The scan below was therefore re-run with the custom Solana-keypair rule and
**without** that allowlist, which is the only version of this scan that means anything.

**Keypair files found — paths only, contents never copied or printed:**

| Path in the old repository | What it is |
|---|---|
| `target/deploy/anarchy-keypair.json` | The program-identity keypair. Committed deliberately, so every deploy reused the declared program ID. |
| `tests/fixtures/anarchy-authority.json` | A devnet authority keypair. Leaked onto `main` in commit `8c792f5` and allowlisted thereafter. |

Both are flagged for the rotation table in `TRANSITION-REPORT.md`. **Neither was copied.** Their
public keys are derived and recorded there so the old accounts can be decommissioned deliberately.

**Other secrets found:** none.

**Other findings:** 14 `generic-api-key` hits, all in `tests/postman/{local,ci}.postman_environment.json`.
Verified false positives: Postman spells every variable as `"key": "<NAME>"`, and the rule reads the
literal property name `key` plus a high-entropy *name* as a credential. The flagged string is the
variable name; the values are synthetic. `tests/postman/` is on the do-not-carry list regardless.

**`.env` files found:** `.env.example` and `apps/web/.env.example` — templates with no values.
Neither was carried; a new `.env.example` was written from the playbook §5.1 variable list.

---

## Inventory of the source

- **Cargo workspace members:** `crates/curve`, `crates/randomness`, `programs/anarchy`, `crates/xp`.
  One of four carried.
- **Anchor.toml programs:** one, `anarchy`, at `57goj6dMYL9BuaGa18jnnTPH7ecztk5rfxiurc4UPW9r`.
- **Program instructions:** `launch_collection`, `buy`, `sell`, `pack_open`, `commit_vrf_seed`,
  `create_collection_asset`, `finalize_graduation`, `claim_conviction_xp`, `commit_trait_rareness`.
  Two carried, one of them partially.
- **Services:** eight (`_shared`, `bench`, `indexer`, `me-registration`, `metadata`, `monitoring`,
  `trait-rareness`, `trending`). Two carried, both partially.
- **Frontend:** one Next.js app under `apps/web`.
- **Docs:** 14 top-level `.md` files plus `frontend/`, `qa/`, `changelog/`, `archive/`, `ops/`.
  Eleven sections exported to `docs/reference/`; nothing else.

---

## Component: Randomness crate

**Expected location (brief §1):** `crates/randomness/src/lib.rs`, with `derive_open_randomness`
(98 bytes, LE `u16` index) and `weighted_tier_draw`, and Python-generated known vectors.

**Found at:** exactly there.

**Matches description:** **yes**, with one important gap. The vectors *were* computed in Python —
the test file says so — but the bytes were **inlined into the test file and the generator was never
committed.** So nobody after the fact could regenerate them, verify their provenance, or extend the
set. The brief told me to look for "a `fixtures/` or `vectors.json` with a generator script"; there
is neither.

Other findings against the brief's expectations: `weighted_tier_draw` takes `&[u16; 6]` (six tiers)
and uses `n % total` directly, with the modulo bias documented and accepted. `sha2` is declared as
`"0.10"` and resolved to **`0.10.9`** in `Cargo.lock`. Property tests are in
`crates/randomness/tests/properties.rs`.

**Change applied:** carried to `crates/blotto-randomness/`, package `blotto-randomness`.

| | Predecessor | Now |
|---|---|---|
| Digest function | `derive_open_randomness` | `derive_class_randomness` |
| Inputs | 4 — **98 bytes** | 5 — **130 bytes**, `player_pubkey` appended last |
| Canonical order | — | `vrf_seed(32) ‖ slot_hash(32) ‖ entry_index(2, LE) ‖ pool_pubkey(32) ‖ player_pubkey(32)` |
| Renamed parameters | `collection_pubkey`, `open_index` | `pool_pubkey`, `entry_index` |
| Draw function | `weighted_tier_draw` | `weighted_class_draw` |
| Bag | 6 tiers, `[250, 100, 50, 15, 4, 1]`, sum 420 | 5 classes, `[38, 15, 7, 3, 1]`, sum **64** |
| Draw argument | `counters` | **`class_counters`** — never `odds` or `weights` (PID §8.7) |
| Doc citations | ADR-026 / ADR-021 | PID §3 / TECH-ARCH §4 |

**`fixtures/gen_vectors.py` is written and committed**, alongside the `fixtures/vectors.json` it
produces. Standard library only — no dependency, no environment, no version drift. It generates the
three `derive` shapes the old tests used (constant bytes at the first seat, constant bytes at the
last seat, progressive bytes at index 1) re-pointed at the new 130-byte order, plus one `draw`
vector per class. The Rust side loads the JSON with `include_str!`, so the tests have no runtime
file dependency.

**Dependencies pinned:** `sha2 = "=0.10.9"`, `proptest = "=1.11.0"`.

> **Note on the proptest pin.** The brief says to pin `1.5.x` because the old `Cargo.toml` declares
> a caret range of `"1.5"`. The old **`Cargo.lock`** — the authority on what was actually built and
> tested against, and what the brief's own §1 instructs me to take the version from — resolved
> **1.11.0**. Pinned to the lockfile.

**Modulo bias:** re-examined and **accepted**, more comfortably than before. With a bag of 64 rather
than 420 the bias is on the order of 1 in 2^58. Two reasons beyond the magnitude: rejection sampling
would complicate audit replay (an auditor re-deriving an old entry would have to replay the loop
with the same retry count), and the class confers nothing a player could cash (PID §8.4), so even a
measurable bias would move nothing.

**Tests carried:** determinism; all four original avalanche cases; the lone-class and empty-bag edge
cases; the proptest invariants, with the strategy narrowed from an arbitrary `0..1000` to the real
`0..=64` domain; and both integration properties, retargeted from a 420-open collection lifetime to
a 64-seat pool.

**Tests added:**
- `avalanche_flip_player_pubkey_bit` and a direct two-players-at-the-same-seat test — the input the
  predecessor did not have, and one an implementation could forget to mix while passing every other
  test in the file.
- `canonical_stream_is_130_bytes_in_the_documented_order`, which rebuilds the input by hand and
  hashes it directly, so an input-order change cannot pass even if the fixtures were regenerated to
  match it.
- A counters-sum-to-capacity assertion in both files, since both hardcode the array.
- An assertion that the draw fixtures pin every class exactly once, so a regeneration that silently
  dropped one fails rather than quietly weakening the suite.

**Result: 19 tests pass** (16 unit, 3 integration). `cargo clippy --workspace --all-targets -D
warnings` and `cargo fmt --check` clean.

---

## Component: Merkle slot-table commitment

**Expected location (brief §2):** a module that shuffles a slot table, computes a Merkle root,
produces per-slot proofs, and encrypts the table for storage.

**Found at:** **nowhere. It does not exist.**

**Matches description: no — there is nothing to match.** The old product resolved rarity with a
bag-without-replacement draw over live counters held on the collection account, and its own decision
record **explicitly rejected** a Merkle pre-mint approach. There is no Merkle code anywhere in the
repository.

**Change applied:** `crates/blotto-merkle/` created as an empty crate with a README stating plainly
that it is new work for Phase 1/2, why nothing was carried, and what it must build — the class table
and the results tree, sharing one implementation — along with the decisions it must make explicitly
(hash function, leaf encoding, sorted-pair vs ordered proofs, odd-node handling, and domain
separation so a class-table proof can never be replayed as a results proof).

**Tests: none.** **Result: n/a.**

---

## Component: Switchboard VRF integration

**Expected location (brief §3):** the request/callback flow producing `vrf_seed` at launch.

**Found at:** `programs/anarchy/src/instructions/commit_vrf_seed.rs`, and the off-chain half in
`tests/commit-vrf-seed.ts`.

**Matches description: partly — and the difference matters.** The brief describes a
"request/callback flow". Switchboard On-Demand is **commit/reveal, not a callback**: randomness is
requested, an oracle reveals it some slots later, and the consuming program reads the revealed value.
`RandomnessAccountData::get_value(slot)` returns the value **only when the supplied slot equals the
account's `reveal_slot`**, so the caller must bundle the Switchboard reveal and the consume in one
transaction. The old file's header comment explains this and has been carried.

The account is read as an `UncheckedAccount` and parsed manually, with an owner check against both
the mainnet and devnet Switchboard program IDs, and a write-once guard on a zero-filled sentinel.

**Change applied:** carried to `programs/blotto_cup/src/vrf.rs`.

- `Collection` → `Pool` throughout; `COLLECTION_SEED` → `POOL_SEED` (`b"pool"`).
- The `has_one = mint` binding is **dropped** — a Pool has no mint. The PDA binds on
  `[b"pool", pool_id.to_le_bytes()]` instead.
- Event `VrfSeedCommitted` → `PoolVrfSeeded`.
- The write-once guard, the two-cluster owner check and the same-slot constraint are carried
  **exactly as they were**.
- The TM-502 residual-risk note is carried and extended — see "surprises" below.

**On TECH-ARCH §3.2, which lists the VRF request as part of `open_pool`:** the *request* can live
there; the *commit* cannot, for the commit/reveal reason above. Carrying it as a separate write-once
instruction is the correct shape, and it is the shape the old repo arrived at after hitting exactly
this constraint. **The Phase 1 builder decides whether `open_pool` and `commit_vrf_seed` merge** —
they cannot fully, but the request half may move.

**Dependencies pinned:** `switchboard-on-demand = "=0.12.1"` with
`default-features = false, features = ["cpi", "solana-v3"]`, and `getrandom = "=0.2.16"` with
`features = ["custom"]`. **The Cargo.toml comments explaining both are carried verbatim** — they
record why the feature selection is what it is, and each was arrived at by hitting the failure it
describes.

**Tests carried:** `tests/commit-vrf-seed.ts` → `tests/vrf.ts`, symbols renamed, all three cases
kept (happy path, double-commit rejection, wrong-owner rejection). The Switchboard randomness
account dumps under `tests/e2e/fixtures/switchboard-randomness/` are carried — public account state,
not secrets. *(Removed 2026-09-12 with the rest of `tests/e2e/`; see the note at the
end of this report.)*

**Result:** `anchor build` **green**; the TypeScript suite **typechecks clean** against the generated
IDL. `anchor test` cannot be fully green yet, because `open_pool` does not exist — the suite now
writes the Pool account directly with `surfnet_setAccount`, marked `TODO(phase-1)` in the file. The
brief anticipated this.

---

## Component: Signed-packet infrastructure

**Expected location (brief §4):** an `XpBoostPacket` ed25519 path — a backend-issued struct verified
on-chain against a config pubkey via the instructions sysvar, a Turnkey-custodied signer, and an
admin rotation instruction. The brief calls this "the critical one" and instructs me to **quote the
verification code in this report**.

**Found at:** **nowhere. None of it exists.**

There is no `ed25519` anywhere in any `.rs`, `.ts` or `.md` file. No packet of any kind. No Turnkey
integration. No signer-rotation instruction. **The brief's instruction to quote the verification
code is moot — there is no code to quote**, and therefore nothing to assess as correct or broken.

The nearest thing in the old repository is unrelated to packets: `pack_open.rs` reads the
`SlotHashes` sysvar as raw account data with an `address =` constraint pinning it to the real sysvar.
That is a useful pattern reference for reading a sysvar safely, and nothing more.

**Change applied:** none possible. `backend/packet/` created with a README recording the finding and
stating what Phase 1 must build on both sides, including the verification requirement in full:
load the instructions sysvar, confirm an `Ed25519Program` instruction is present in the same
transaction, and confirm that instruction's pubkey, message and signature match the config signer and
the canonical packet encoding. Reading a boolean flag, or trusting anything the caller passes, is the
failure mode the design exists to prevent — and TECH-ARCH §13's first acceptance criterion is that
`register` without the precompile instruction reverts.

**`entry_packet.rs` is new work for Phase 1. Nothing was fabricated here.**

**Tests: none. Result: n/a.**

---

## Component: Metaplex Core mint and freeze

**Expected location (brief §5):** a mint with a placeholder URI, a reveal authority that later
updates the URI, and unrestricted transfer.

**Found at:** `programs/anarchy/src/instructions/create_collection_asset.rs` and the
`CreateV2CpiBuilder` section of `pack_open.rs`.

**Matches description: partly, and the differences are all in our favour.**

- The brief expects transfer to be unrestricted and instructs me to *add* a permanent restriction.
  **It is already restricted.** `create_collection_asset.rs` attaches
  `PermanentFreezeDelegate { frozen: true }` at the **Collection** level, with authority
  `UpdateAuthority` resolving to the program's PDA — never a human.
- Members are minted **bare** (no member-level plugins) so they inherit that freeze. The comment
  explaining why is load-bearing and carried: in mpl-core 1.10 a post-mint `AddPlugin` against a
  collection member **panics ~3.5k CU in, before any lifecycle check**, so any member plugin must be
  attached at `CreateV2`. Minting bare sidesteps the trap.
- Propagation was verified empirically on devnet before the old repo relied on it. That run is
  carried to `docs/reference/q-016-verification-note.md` for two findings its tests depend on: a
  frozen-member transfer fails with **`InvalidAuthority` (`0x9`)**, not `AssetIsFrozen` (`0xa`); and
  the freeze holds against **transfer delegates**, not only owners.
- **There is no URI-reveal authority path.** The `uri` is minted as an empty string and nothing ever
  updates it. The brief's §5 expectation of a reveal authority, and its §6 pointer to
  `backend/src/reveal/`, both refer to something that does not exist.
- **`finalize_graduation.rs` thaws the collection** with a single `UpdateCollectionPluginV1` CPI. See
  "surprises".

**Change applied:** carried to `programs/blotto_cup/src/pass.rs` as `create_pass_collection` (the
Collection with the permanent freeze, update authority = the Pool PDA) and `mint_pass` (the bare
member mint, owner = player, empty URI).

**`finalize_graduation.rs` was NOT carried, and no thaw path exists.** `pass.rs` carries the required
doc comment stating that there is no instruction in this program that can set `frozen: false`, and
that adding one is a legal-position change (PID §8.4) requiring counsel sign-off. Verified:

```
$ grep -rn 'frozen: false\|UpdateCollectionPluginV1' programs/ | <excluding the doc comment stating the rule>
(no matches)
```

The built IDL confirms it independently — the program exposes exactly three instructions:
`commit_vrf_seed`, `create_pass_collection`, `mint_pass`.

**Dependencies pinned:** `mpl-core = "=0.12.0"`, with its explanatory comments carried verbatim.

**Tests carried:** `tests/create-collection-asset.ts` and `tests/freeze-propagation.ts` merged into
`tests/pass.ts`, with **both unfreeze cases deleted** — a test asserting that something can be
unfrozen would assert the opposite of the requirement.

**Tests added:**
- **(e) the negative case the brief asked for**: mint a real pass, attempt a transfer *as its own
  owner* through the mpl-core SDK, assert it fails and has not moved. The predecessor could not do
  this — minting a member needed a PDA-signed mint that only `pack_open` provided, so it read the
  plugin flag instead and leaned on an archived devnet run. Carrying `mint_pass` makes the whole
  loop available, and this assertion is what the legal position actually rests on.
- (f) `mint_pass` against a pool with no committed VRF seed rejects.
- (g) a structural check that no instruction in the IDL could thaw a pass — the guarantee is the
  *absence* of an instruction, which cannot be probed by calling something.

**Result:** `anchor build` green, TypeScript typechecks. Runtime execution needs `open_pool`, as
above.

---

## Component: Irys upload and image generation

**Expected location (brief §6):** an Irys upload client and a fal.ai generation client.

**Found at:** **neither exists.** Both appear only in `docs/services.md` as an operations decision.
There is no client code, no upload path, no prompt handling.

**Change applied:** none. The prompt-blocklist requirement the brief attaches to the generation
client (PID §10, C11) carries forward to whoever builds it.

**Tests: none. Result: n/a.**

---

## Component: Frontend

**Expected location (brief §6):** wallet connect, the reveal animation, and a verify-page scaffold.

**Found at:** wallet connect and the reveal animation, yes. **The verify page does not exist** — the
nearest thing, `app/design/signing/`, is a signing console for constructing and inspecting
transactions, a developer tool rather than a verifier, and was not carried.

**Change applied:** carried into `app/`, flattening `apps/web/src/lib/*` to `app/src/*`.

| Source | Target | Note |
|---|---|---|
| `lib/auth/*` | `wallet/` | Privy v3 + `@solana/kit` v7. The "mainnet unconfigured by construction" rule kept. |
| `lib/tx/{execute,lifecycle,errors,priority-fee,tx-rpc,types}` + tests | `tx/` | Instruction encoders, trade modules, event decoder and fixtures dropped. |
| `lib/reveal/{machine,exit,count-up,crack-geometry,fragment-geometry,tier-colour,constants,dev-lever,types}` + tests | `reveal/` | The pure reducer and geometries. |
| `app/open/crack-stage.tsx`, `components/egg/egg-shell.tsx` | `reveal/stages/reveal-stage.tsx`, `reveal/components/pass-shell.tsx` | |
| `lib/chain/rpc.ts` | `chain/rpc.ts` | Only the previews-never-mainnet rule; the account decoders were the old layouts. |
| `lib/query`, `styles/tokens.css`, `app/globals.css`, `app/layout.tsx`, `components/shell/*`, `back-pill`, `copyable-address` | same relative paths | |

**Renames applied during the copy:** `tier` → `class`, `egg` → `pass`, `crack` → `reveal`, `hatch` →
`unseal`, the old open-flow → `reveal`, `degen` deleted. Note that `class` is a **TypeScript reserved
word**, so bare bindings are `classIndex`; property positions stay `class`.

**No copy strings were carried.** `lib/degen/copy.ts` and `lib/reveal/copy.ts` were deleted and every
user-facing string in a carried component is a `TODO_COPY(...)` placeholder keyed by component — the
page title and description, the wordmark, the tab labels, every transaction failure message. A test
now asserts the tab labels are still placeholders, so the Phase 3 language audit (PID §10, C12)
cannot quietly skip them.

**Dependencies pinned** exactly from the old `package-lock.json`; `lightweight-charts` and
`@upstash/redis` dropped as instructed.

**Judgement calls, all marked `PHASE-0-REVIEW` in source:**

1. **`execute.ts`'s priority-fee logic — carried.** The brief names this as an example of an
   unsettled call. It is a pure function of simulation output with no product coupling, and
   re-deriving a compute-unit estimator later would be strictly worse than keeping a tested one.
2. **The tab set is a placeholder** (`play` / `pools` / `profile`), and so are its icons and labels.
   Phase 3 owns the real information architecture.
3. **Which classes get the extended tell.** The predecessor gave it to the top two of six rarity
   tiers; carried by position to the top two of five classes, `EXTENDED_TELL_MIN_CLASS = 3`. Not
   ratified. Safe to leave open: the class confers nothing (PID §8.4), so a longer animation is not
   an advantage.
4. **Class colour hues** are the predecessor's, remapped by position with its gold carried onto
   Titan. Art direction is founder-owned and unratified (PID D2).

**Two deliberate deviations from the brief's file list**, both because the content was product logic
rather than a seam:

- **`components/card/card.tsx` and `app/open/card-stage.tsx` were NOT carried.** Their substance is
  the old product's stat/trait/power-level metadata model — 37 of `card.tsx`'s 280 lines reference
  `power`, `speed`, `chaos`, `aura`, `traits`, `rareness` — and that model does not exist here. A
  Blotto Cup pass carries a cosmetic class and nothing else; the five stats belong to a *battle*, not
  to a pass. Carrying them would have imported exactly what this extraction exists to leave behind.
  Their data seam (`lib/reveal/card/*`) went with them.
- **`app/open/reveal-takeover.tsx` and its route were NOT carried** — route composition wired to the
  old product's fixtures, dev levers and navigation. Phase 3 owns routing.

`exit.ts` keeps its mechanism and loses its key list, which was entirely the old product's cache
keys; its test is rewritten to pin the mechanism and to **fail loudly** when Phase 3 fills the list
without restoring the source-pinning discipline the original had. `tx/types.ts` loses
`slippage-exceeded` and `rate-limited` — a moving price quote and a per-wallet cooldown, neither of
which exists here — in favour of a generic `program-rejected`, with the program's real error codes
(6000–6004) mapped to it and unrecognised codes deliberately falling through to an honest
`rpc-failure` rather than being guessed at.

**Result: `vitest run` passes — 114 tests across 14 files.** `tsc --noEmit` clean.

`app/src/verify/` created as an empty scaffold with a README describing what Phase 3 must build.
`app/src/{battle,rules,leaderboard,claim}/` likewise. The `battle/` README carries PID v0.5 §4 in
full, including the two things that will be proposed and must be refused.

---

## Component: Backend plumbing

**Expected location (not in the brief's numbered sections; added by the extraction prompt):**
`services/_shared/src/{config,db,http-hygiene,monitor,metrics,prometheus}.ts` and
`services/indexer/src/{webhook,ingest,store,store-pg,backfill,migrate}.ts`.

**Found at:** exactly there. **Matches description: yes.**

**Change applied:** carried to `backend/_shared/` and `backend/indexer/`.

- **Not carried:** `events.ts`'s per-event decoders, `xp.ts`, `wallet.ts`, `projection.ts`, every
  migration file, and the metric namespaces for services that do not exist here.
- **`events.ts` keeps its generic half** — discriminator derivation, `Program data:` extraction, and
  the decode pipeline — behind a **layout registry that starts empty**, with a `TODO(phase-2)`
  listing the TECH-ARCH §3.3 events. Both hard-won constraints are carried in the doc comment: there
  is no committed IDL, so the `#[event]` structs are the contract; and `u64` amounts are decoded as
  `bigint` and serialised as strings, never coerced to a number.
- **`projection.ts` deleted** and every reference removed, so the store is ledger-only, with
  `TODO(phase-2)` markers at each point a projection must re-attach — including the one that matters,
  *inside the same transaction as the ledger append*, because a row in the ledger but not projected
  is the split-brain the seam exists to prevent.
- **`0001_events_ledger.sql`** defines the generic `events` table and nothing else, with the columns
  the prompt specified: `signature, event_index, slot, program, name, raw jsonb` (plus `commitment`
  and `ingested_at`). The predecessor's first migration also created four derived tables, all of them
  describing the old product. `migrations/README.md` keeps the conventions and adds the reasoning
  behind each.
- **The ledger row now records `program`.** That threaded an `IngestContext` through the webhook and
  backfill paths; the program is recorded rather than assumed so a row can be attributed without
  consulting the config that was in force when it was written.
- Package names `@anarchy/*` → `@blotto/*`; env vars `ANARCHY_*` → `BLOTTO_*`.

**Tests rewritten, not dropped.** Every assertion about the old product's events is gone; every
assertion about the *pipeline* survived, which is most of the value: idempotency under redelivery,
webhook-and-backfill convergence on one row, `event_index` stability across an unrecognised event
from another program (registering a decoder later must never renumber ledger rows), the `minSlot`
floor, the watermark, `u64` precision through the raw-jsonb round-trip, and — carried in full — the
**QA-C5-001 regression pins**.

Those last ones deserve their own note. QA-C5-001 was a pagination defect that silently truncated the
backfill walk whenever a page contained failed transactions: measured on the old bench, 1,159
signatures with 719 failures ended the walk after one page and 159 signatures were never reached.
Backfill is the recovery path for a dropped webhook delivery, and **in this product a missed
`EntryRegistered` is a player who paid and does not appear in the field.** The pins are carried
verbatim.

**Result: typecheck clean in both packages; 63 tests pass** (42 in `_shared`, 21 in `indexer`).

`backend/{sealing,detection,reveal}/` created with READMEs. The `sealing/` one records the property
that must not be lost — the store holds ciphertext only, and no code path may read a plaintext
allocation before close — and both published failure modes from TECH-ARCH §5.

---

## Component: Hygiene and CI

**Carried:** `.gitleaks.toml` (including the custom Solana-keypair rule the default ruleset lacks —
the rule exists because the old repo leaked exactly that way; **its allowlist was deliberately not
carried**, since it excused two committed keypairs that do not exist here);
`.cargo/audit.toml` and `deny.toml`; `ci-fast.yml` (Rust and gitleaks lanes only — the services and
web lanes dropped until those exist); `stop-the-line.yml` (watching `ci-fast`); the workspace
`Cargo.toml` settings (`overflow-checks = true`, `unsafe_code = "forbid"`, clippy `all = warn`);
`Anchor.toml`'s structure including the Surfpool config, the `[[test.genesis]]` mpl-core fixture line
and the scripts block; `tests/fixtures/mpl_core.so`; and
`tests/e2e/lib/{common,validator,postgres}.sh` with every reference to the old product renamed.
*(Struck 2026-09-12, audit 2026-09-11 G-10/G-22: the rename was incomplete —
`common.sh` still pinned the predecessor's program address — and the three scripts
called stage files (`tests/e2e/lifecycle/vrf.ts`, `tests/e2e/README.md`) that were
never carried, so nothing could run them. `tests/e2e/` was removed on that date,
the randomness fixtures above with it; they had no consumer but those scripts.)*

**Audit ignore lists pruned per instruction.** All four advisories still need suppressing against
this workspace's own lockfile, re-verified with `cargo tree -i` rather than inherited on trust:
`bincode`, `libsecp256k1` and `anyhow` are reachable and ecosystem-pinned through the Anchor/Agave
tree; **`rkyv` is now recorded as a stale lock entry with no reverse dependency at all** — kept only
because cargo-audit reads the lockfile without reachability analysis.

**`Anchor.toml`'s program keypair was regenerated**, never reused. See `TRANSITION-REPORT.md`.

**`.gitignore`** carried and tightened: `keys/`, `*keypair*.json`, `*.pem`, `id.json`, `pre-scan.json`,
`.env`, `.env.*.local`, and **all of `target/` with nothing re-included** — unlike the old repo,
which re-included its program keypair there.

**`.githooks/pre-commit`** written and **verified against a synthetic keypair before use**: it
rejects any staged file containing a 64-integer array, reading the staged blob rather than the
working tree.

---

## §7.2 grep result

**Empty.** `./scripts/check-language.sh` returns clean across the repository.

```
$ ./scripts/check-language.sh
language gate: clean
```

The script holds the pattern and the exclusion list, each exclusion with its reason. Exactly one
token is allowlisted anywhere — `pull_request`, a GitHub Actions event name that cannot be renamed;
workflow steps use `git fetch`, never `git pull`, so the verb itself never appears.

Everything the gate found in *authored* content was rewritten rather than excluded, including a
number of ordinary English collisions ("pull the payloads out of", "hand-roll the bytes", "a consumer
can pull this in" → "extract", "hand-encode", "import"). In the class draw, the variable is
`class_counters`; there is no `odds` and no `weights`.

**One exclusion the brief did not anticipate, flagged because it is a real finding rather than a
convenience:** the four source documents copied verbatim into `docs/` **cannot** pass this grep.
PID §8.7 necessarily *lists* the words it forbids; the extraction brief quotes the same list and is
titled after the old repository; the playbook quotes the old PRD's language in order to warn about
it; and TECH-ARCH §12 names a Phase-5 activity the pattern matches. They are excluded on the same
reasoning as `CONTRIBUTING.md` and the two reports — they are inputs to this repository rather than
content authored in it — and the exclusion is documented in both the script and `CONTRIBUTING.md`.

---

## Things I found that this brief did not anticipate

**1. There is no packet code at all.** Not a wrong implementation to fix — nothing. The brief calls
§4 "the critical one" and asks me to quote the verification code and rewrite it if it is broken.
There is no `ed25519` anywhere in the repository, no packet struct, no Turnkey, no rotation
instruction. **The "quote the verification code" instruction is moot.** `entry_packet.rs` is new work
for Phase 1 and nothing was fabricated.

**2. There is no Merkle code.** The brief's §2 describes a slot-table module in some detail. The old
design used live counters and its own decision record explicitly rejected a Merkle pre-mint approach.

**3. There is no Irys client and no fal.ai client.** Both exist only as an operations decision in a
document.

**4. There is no verify page.** `app/design/signing/` is a signing console, not a verifier. The one
page that makes the operator checkable rather than trusted is entirely new work.

**5. `finalize_graduation.rs` thaws the collection.** The old product deliberately unfroze all its
NFTs at graduation, via a single PDA-signed `UpdateCollectionPluginV1` CPI, so they could be listed
and traded. **This is the single most dangerous thing in the old repository from Blotto Cup's point
of view**, because it is a working, tested, PDA-signed thaw sitting next to code we *do* want. It was
not carried, the decision record that adopted it was carried only in half, and the absence is now
asserted three ways: a grep documented in `pass.rs`, a doc comment stating that adding one requires
counsel sign-off, and a test that reads the built IDL.

**6. Two keypairs are committed in the zip**, one of them a program identity that was committed
*deliberately* so deploys kept the same ID. Neither was copied; both public keys are in
`TRANSITION-REPORT.md` for decommissioning.

**7. `commit_vrf_seed` cannot merge into `open_pool`, and this is a protocol constraint rather than a
design preference.** Switchboard On-Demand is commit/reveal: no single transaction can both request
and consume randomness. TECH-ARCH §3.2 lists the VRF request as part of `open_pool` — the request can
live there, the commit cannot. Phase 1 should read the header comment in `vrf.rs` before trying.

**8. TECH-ARCH §10 is stale.** It still describes "five steppers with quick-set chips
0/25/50/75/100", which **PID v0.5 §4 overrides**: the interaction is a draggable pentagon radar with
live normalisation, no chips, no presets, "Even split" as the only button. This is not cosmetic — PID
§4.3 quantifies it, and chips collapse the effective option space from 4,598,126 to something near
126 and the random-vs-random draw rate from 7% to 86%. The conflict is recorded in `docs/INDEX.md`
with instructions to build to the PID, and again in `app/src/battle/README.md` where someone will
actually be reading when they build it. **TECH-ARCH §10 should be corrected in its next revision.**

**9. The old repo's own gitleaks config makes the scan lie.** Running gitleaks with
`.gitleaks.toml` reports "no leaks found", because both committed keypairs are allowlisted by path.
The only scan that means anything is the one with the custom rule and *without* the allowlist. Worth
knowing for anyone auditing the old repository.

**10. The randomness vectors were Python-generated but the generator was never committed.** The
tests are honest about their provenance and impossible to verify. This is the specific gap the brief
told me to look for, and it is now closed.

**11. `proptest` resolves to 1.11.0, not 1.5.x.** The brief's §1 expectation reads the caret range in
`Cargo.toml`; the lockfile is the authority and says otherwise.

**12. Two carried frontend components were product logic in disguise** — the card component and its
stage. See the deviation note in the Frontend section.

**13. `class` is a TypeScript reserved word.** The instructed `tier` → `class` rename produces
syntactically invalid TypeScript wherever `tier` was a variable or parameter. Bare bindings are
`classIndex`; property positions are fine as `class`.

**14. The four source documents cannot pass the language gate.** See the §7.2 note above.

---

## Recommended follow-ups

1. **Promote the language gate to a CI lane.** `scripts/check-language.sh` exists, returns clean,
   and is one job block away from being enforced. PID §8.7 is compliance item C12, which blocks
   launch; review is a weaker gate than CI. Phase 0's brief scoped `ci-fast` to two lanes, so this
   was left as a manual step rather than widened unilaterally.
2. **Correct TECH-ARCH §10** to match PID v0.5 §4.
3. **Regenerate the devnet program keypair** on a durable machine — see `TRANSITION-REPORT.md`.
4. **Add an on-chain CI lane** (`anchor build` + `anchor test`) once `open_pool` exists and the suite
   can be green.
5. **Restore the exit-key source-pinning test** in `app/src/reveal/exit.test.ts` when Phase 3 fills
   the query-key list; the current test fails loudly to prompt exactly that.
