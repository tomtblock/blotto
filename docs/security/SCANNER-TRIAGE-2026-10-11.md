# Automated security report: triage of 2026-10-11

**What this is.** A free automated security report was produced for the Solana hackathon
submission against commit `68bb08c` (11 October 2026). It lists 81 items against our code and
56 against our dependencies. The report says of its own code section that "nothing was confirmed
as a defect" — every code item is a pattern match. This page takes every item in turn, checks it
against the code at that commit, and records a verdict, the evidence and what we are doing about
it. It is canonical for nothing else: the threat model, the on-chain invariants and the open-items
list stay in [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md), which links here.

**Method.** Each code item was read against the cited file. Each dependency item was re-run
against the live advisory databases on 2026-10-11 — `npm audit` per package directory, and the
CI-pinned `cargo-deny` 0.20.2 and `cargo-audit` 0.22.2 — with the dependency path traced and the
vulnerable function checked for a caller. Proposed dependency fixes were trial-resolved in scratch
copies before being written down here. The program's unit tests (37) and the language and
standing-rules gates pass at this commit.

**Item numbers** below are the report's own: "#n" in its "Your code" section, "pkg n" in its
"Packages" section.

## 1. The result in brief

- **No exploitable defect in the on-chain program.** Of the 54 program items, one is real: on a
  *fresh* deployment, whoever calls `init_config` first becomes the admin (item A). The deployed
  devnet program is already initialised with the Squads vault as admin, so nothing is exposed
  today; it matters for mainnet. The rest are test code, guarded arithmetic, or checks the scanner
  did not see because they sit in the handler or in an `address =` constraint.
- **One dependency needs fixing now: `next` 16.3.0.** Live audit lists nine advisories against
  it, three critical. One the scanner missed — remote code execution in `next/og`'s
  `ImageResponse` — touches a feature the app uses (`app/src/app/card/[pool]/[player]/route.tsx`).
  16.3.8 fixes all nine and is a patch release (item B).
- **Most other dependency items are real advisories on code we never run**: test runners,
  config-file parsers, transports we do not open. Same-major fixes exist for most and are cheap
  (item C); the eight without a usable fix are recorded as accepted, each with its reason (§4.1).
- **One legal item the scanner half-saw.** It reports `mpl-core` as "unlicensed". It is not: it
  ships the *Metaplex(TM) NFT Open Source License v1.0*, not Apache-2.0, and that licence asks us
  to give recipients a copy. We ship none (item F).
- **The scanner was wrong about its own fixes.** Its "fixed in" column often names a release on
  another major line (`next` "fixed in 15.5.24", `js-yaml` 4.x "fixed in 3.14.2", `ws` 8.x "fixed in
  5.2.5"). The versions here come from the live databases.

| Report section | Items | Real, to fix | Real, accepted (no fix, or unreachable) | By design, or already recorded | Not a defect (false positive, test code, scanner error, maintenance notice) |
|---|---:|---:|---:|---:|---:|
| Your code — program | 54 | 2 (#3 and #61, one issue) | — | 8 | 44 |
| Your code — off-chain, plus pkg 5 and pkg 19 | 29 | 5 (#13–16 Dockerfiles, #17 Android backup) | — | 2 | 22 |
| Packages — npm | 22 | 1 now (`next`), 13 cheap | 8 | — | — |
| Packages — Rust | 11 | 1 at the next program release (`faster-hex`) | — | 3 | 7 (6 test-only, 1 scanner error) |
| Packages — licences and containers | 21, plus 6 notes | 1 legal (`mpl-core`, from the notes) | — | — | 17 licence items (no policy configured), 4 repeats of #13–16 |

## 2. What needs doing

Lettered for reference. A (on-chain correctness) and F (the product's legal position) rank
highest under the project's tradeoff order; B is the most urgent. "Decision" marks an item that
waits on the project owner.

| Item | What | When | Decision |
|---|---|---|---|
| **A** | `init_config` callable by anyone on a fresh deployment | Written now, shipped with the next program upgrade, before any mainnet deployment | Timing |
| **B** | `next` 16.3.0 → 16.3.8 | Before the hackathon submission | — |
| **C** | Same-major npm fixes and overrides | App: with B. Backend: with the next backend deploy | — |
| **D** | Pin the four service base images by digest | Next backend deploy | — |
| **E** | Android `allowBackup="false"` | Next Android package build | Timing |
| **F** | `mpl-core`'s licence: ship a copy, ask counsel | Notice now; counsel before mainnet | Yes |
| **G** | Close the advisory-lane gaps this triage found | Any time | Licence policy only |
| **H** | `faster-hex` 0.10.0 → 0.10.1 | Next program upgrade | — |
| **I** | Images install dev dependencies | After the submission | Yes (deployment change) |
| **J** | Move the backend off `@solana/web3.js` v1 | Tech debt, after mainnet blockers | — |
| **K** | Correct two documents on the class draw | Any time | — |
| **L** | Encode the pool id in the app's indexer paths | With B | — |

### A. `init_config` can be initialised by whoever calls it first (#3, #61)

`Config` lives at the fixed PDA `[b"config"]`, and `init_config` makes whoever signs it the
`admin`. On a fresh deployment there is a window between the program landing and our
`init_config` transaction, in which someone watching the chain could initialise `Config` first
and become its admin — choosing the keeper and both signers, and owning `withdraw_platform`. Our
own `init_config` would then fail with "already in use", so we would notice before funding
anything; the realistic damage is a burnt program ID and a redeploy, unless the runbook carried on
and funded the treasury.

Nothing is exposed today: the devnet `Config` was initialised with `admin` = the Squads vault
(`config/custody.json`), and the instruction cannot run twice. It matters for mainnet.

**Fix** — the pattern `anchor-lang` 1.0.2 itself documents (`src/accounts/account.rs`): only the
program's upgrade authority may call `init_config`, and the admin becomes an argument.

```rust
#[derive(Accounts)]
pub struct InitConfig<'info> {
    /// The program's upgrade authority: the only key that may initialise Config.
    #[account(mut)]
    pub deployer: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::BlottoCup>,
    #[account(constraint = program_data.upgrade_authority_address == Some(deployer.key())
              @ ErrorCode::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = deployer, space = Config::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,
    // `platform` and `system_program` unchanged
}
// `handle_init_config` takes `admin: Pubkey` as a new first argument.
```

The mainnet order becomes: deploy → `init_config` signed by the deploying key, naming the Squads
vault as admin → move the upgrade authority to the multisig (already a mainnet precondition in
[`SECURITY-REVIEW.md`](SECURITY-REVIEW.md) §5).

Cost, about a day with CI: a new error variant, appended (`error.rs` forbids inserting) and
mirrored in `app/src/tx/errors.ts`; `scripts/admin.ts init-config` passes the new accounts and
argument; the LiteSVM harness (`tests/litesvm/src/lib.rs`, `Env::new`) rewrites the ProgramData
account so the test admin is the upgrade authority, because LiteSVM 0.16 loads programs with no
upgrade authority; one new negative test. It changes `init_config`'s wire contract, which the
`deployed-drift` lane compares with devnet, so it lands together with a program upgrade.

**Decision — when.** (a) Write it now and ship it with the next program upgrade, before any
mainnet deployment. *Recommended*: it closes the gap where it exists, and does not upgrade the
devnet program days before judging for a gap devnet does not have. (b) Write it and upgrade devnet
now: the code and the deployment agree sooner, at the cost of an upgrade under time pressure for
no devnet benefit. (c) Runbook only (initialise in the same script as the deploy and check
`Config.admin` before funding): no code, but it leaves a race to be won every time.

### B. `next` 16.3.0 → 16.3.8 (pkg 1, and seven advisories the scanner did not list)

Live audit lists nine advisories against 16.3.0; 16.3.8 is the newest 16.3 patch and clears all
nine. Against this app:

| Advisory | Severity | Fixed in | Applies here? |
|---|---|---|---|
| GHSA-p293-qw3h-jr36 (the scanner's CVE-2026-75604): code execution on Windows-hosted servers | critical | 16.3.3 | No — Vercel runs Linux |
| GHSA-2xp9-vwfh-vxw4: code execution in the image optimiser via AVIF | critical | 16.3.3 | No — the app never imports `next/image`, `next.config.ts` has no `images` block, and on Vercel `/_next/image` is served by Vercel's optimiser |
| GHSA-vcvr-r3jv-pc5j: code execution in `next/og` `ImageResponse` | critical | 16.3.6 | **Closest.** The public result-card route renders with `ImageResponse` on the Node runtime. What it renders comes from the indexer, not raw request text, so the risk is low — but not zero |
| GHSA-cjq9-62q9-8jv4: request forgery in the image optimiser | high | 16.3.8 | No — the advisory exempts apps without `images.remotePatterns` |
| GHSA-4jqv, GHSA-mcj8 (cache poisoning), GHSA-f87g (metadata image routes), GHSA-3w37 (draft mode) | moderate | 16.3.8 | No — each needs a feature the app does not use |
| GHSA-39w2: development server | low | 16.3.8 | Development only |

None is a bypass of the request proxy, so the pre-launch gate in `app/src/proxy.ts` is not
affected. **Fix:** `next` and `eslint-config-next` to `16.3.8` in `app/package.json`; regenerate
the lockfile (see item C for the npm-version note); run typecheck, tests, lint and `next build`;
let Vercel redeploy. 16.4.0 is also clean but is a minor release — not the change to make the
week of a submission.

### C. Same-major npm fixes (13 package items)

Every one of these is a real advisory against code this project never runs (§4.1 gives each
path), and every fix below was trial-resolved and re-audited in a scratch copy.

- **App**, in the same change as B: `vitest` 4.1.11, and `overrides` for `axios` `^1.20.0`, `ws`
  `^8.21.0` (under `viem` and `@wagmi/connectors`), `sharp` `^0.35.5`, `shell-quote` `^1.11.0`,
  `hono` `^4.13.7`, `fast-copy` `^3.1.0`, `source-map-js` `^1.2.2`. Runtime audit goes from 2
  critical / 17 high to 0 / 13; the 13 left are all one package, `braces`, reached only through
  React Native's bundler, which never ships to the web.
- **`backend/reveal`**: `overrides` for `js-yaml` `^4.3.2`, `ws` `^8.21.0` under
  `@ethersproject/providers`, `jayson` `^5.0.0` under `@solana/web3.js` (drops `stream-json` and
  an old `uuid`), and `toml` `^4.3.0` (a major bump; checked that its API is a superset and that
  Switchboard still loads). The same `jayson` override in `backend/indexer`, `tests/rehearsal` and
  `battle-test`.
- **The mocha set**, in the nine backend packages and both test packages: scoped overrides for
  `serialize-javascript`, `js-yaml`, `minimatch@4`, `nanoid`, `diff`. Trial: `backend/scoring`
  installs and its 137 tests pass.
- **Do not run `npm audit fix`**: several of its suggestions are downgrades (Privy 3.37.0 → 3.6.1,
  `eslint-config-next` → 14.x) or a rewrite (`@solana/web3.js` 3.x).
- **npm version note.** The app pins `npm@11.11.0`, CI and the images use npm 10. npm 10 crashes
  writing the app's lockfile once any override exists (an existing peer conflict: x402 brings in
  `@solana-program/token-2022`, which wants `@solana/kit` 5 against our 7), and npm 10's `npm ci`
  rejects a lockfile written purely by npm 11. Tested sequence: write the lockfile with
  `npx -y npm@11.11.0 install --package-lock-only`, then run npm 10's `npm install
  --package-lock-only` once; both `npm ci`s then accept it.

The backend changes need the backend redeployed to take effect. That deploy is manual
(`deploy-backend.yml`, `workflow_dispatch`), so merging them changes nothing live until someone
chooses to deploy.

### D. Base images by digest (#13–16, and the four container rows)

All four `deploy/docker/Dockerfile.*` start `FROM node:22-slim`, a tag that moves. Pin each to
`node:22-slim@sha256:…` (resolve with `docker buildx imagetools inspect node:22-slim`), and add a
Dependabot entry for the `docker` ecosystem so the pin is refreshed weekly by a reviewed change —
a digest nobody updates stops receiving Debian and Node security fixes, which is worse than the
tag. The workflows already pin every action by commit SHA; this extends the same rule to images.

### E. Android backup (#17)

`allowBackup="true"`, but `backup_rules.xml` and `data_extraction_rules.xml` already exclude the
WebView's storage and databases from cloud backup, device transfer and pre-Android-12 backups, and
no wallet key lives in this app (keys stay in the wallet app or with the sign-in provider). So the
scanner's "a wallet file leaves with the backup" does not hold. Still, `allowBackup="false"` costs
nothing for a WebView shell, and it is one less thing to argue about with a store reviewer.

**Decision — when.** It only takes effect in a newly built and signed package. Recommended: in
the next package build; not worth a rebuild on its own.

### F. `mpl-core`'s licence (from the report's notes)

The program links `mpl-core` 0.12.0 to mint passes. Its `LICENSE` is the *Metaplex(TM) NFT Open
Source License v1.0* — "Apache-style" in its own words, but not Apache-2.0. It counts a work that
links to it as a derivative work, counts making one available on a blockchain as distribution, and
on distribution requires giving recipients a copy of the licence and keeping its notices (§4(a)).
It also forbids derivative works that compete with Metaplex Core (§4(c)); a tournament that uses
Core for passes is not that. The repository ships no copy, and nothing in the documents or the
counsel brief mentions it.

**Decision.** (a) Add a third-party notice file now carrying Metaplex's licence text and
pointing at the crate, and add the question to the counsel brief for confirmation before mainnet.
*Recommended*: it does what the licence asks at no cost and does not pre-empt counsel. (b) Wait
for counsel before doing anything: leaves the repository out of step with the licence meanwhile.
Do not record `mpl-core` as Apache-2.0 anywhere — a licence policy gate (item G) should name it as
its own exception.

### G. Advisory lanes: the gaps this triage found

- **cargo-deny ignores "unsound" advisories in dependencies by default**, which is how RUSTSEC-
  2026-0306 (`faster-hex`, published 2026-09-20) passed CI without a word. Set
  `unsound = "all"` in `deny.toml` and add 0306 to both ignore lists with its reachability note
  until H lands.
- **RUSTSEC-2026-0190 is stale** (`anyhow` 1.0.104 is patched): remove it from both lists.
  **RUSTSEC-2026-0235 is not**: `cargo-audit` reads the raw lockfile and goes red without it. Correct
  the comment in `security-sweep.yml` that calls both stale.
- **The LiteSVM workspace is never audited.** Add a job running both tools against
  `tests/litesvm/Cargo.lock` with its own triaged ignore list, and add that lockfile to the
  workflow's path filter.
- **The npm sweep skips `battle-test` and `tests/postgres`**, its comment claims the `--omit=dev`
  pass matches what the images install (it does not — item I), and its list of known findings is
  stale. Fix all three, and commit the accepted set in §4.1 as the baseline the workflow header
  already asks for, so the npm half can start blocking on anything new.
- **Licence policy — decision.** `deny.toml` says a licence policy "is a separate decision". The
  tree is all permissive (Apache-2.0, MIT, BSD-2/3-Clause, Unicode-3.0; no GPL, AGPL or MPL), plus
  `mpl-core`. Recommended: gate it — an allow-list of those five, and `mpl-core` as a named,
  hash-pinned exception so a licence change upstream fails CI. Trialed: passes today.

### H. `faster-hex` 0.10.0 → 0.10.1

Unreachable (§4.2), but it is a build input of the deployed program, so the bump goes in with the
next program upgrade (with A), with the usual rebuild and hash comparison — not as a redeploy of
its own.

### I. The service images install dev dependencies

The images run `npm ci` without `--omit=dev` because they start through `ts-node`, a dev
dependency. So mocha's tree, and its advisories, ship in every image even though nothing runs it.
**Decision**, after the submission: precompile with `tsc` and run `node`, then build with
`npm ci --omit=dev`. Recommended — smaller images, and the sweep's runtime pass would finally
describe what ships. Rejected: moving `ts-node` into `dependencies`, which keeps a compiler in
production for no benefit.

### J. `@solana/web3.js` v1 (#46–60, #80–81)

A maintenance notice, not a vulnerability. The app already ships `@solana/kit`; its web3.js is a
dev dependency kept on purpose as an independent cross-check in tests. The backend services and
scripts use v1, and the Switchboard SDK the daemon needs depends on v1 anyway. Migrating is real
work across the settlement path; schedule it after the mainnet blockers.

### K. Two documents overstate the class draw (found while verifying)

See §5. Documentation only.

### L. Encode the pool id in indexer paths (found while verifying)

`app/src/data/api.ts` builds `` `/pools/${pool}` `` from a URL parameter without
`encodeURIComponent`. The base URL is fixed and the indexer's read API is public, so the most a
crafted id reaches is another public indexer route — but it is a one-line fix and belongs with B.

## 3. Findings against our code

The report's own verdict on this section is "Nothing was confirmed as a defect"; every item is a
pattern match. Each one was read against the cited file at `68bb08c`. Line numbers below are at
that commit.

Two facts answer most of the program items at once, so they are stated once here:

- **Overflow cannot wrap in the deployed program.** The workspace release profile sets
  `overflow-checks = true` (`Cargo.toml`), and `cargo build-sbf` builds that profile. An
  arithmetic overflow aborts the transaction; it never wraps into a wrong balance.
- **Test code is not the program.** Eight items point into `#[cfg(test)]` modules or the
  `tests/` directory, which are not compiled into the deployed binary.

### 3.1 The on-chain program (54 items)

| # | Sev. | Where | Scanner's claim | Verdict | Evidence |
|---|---|---|---|---|---|
| 2 | High | `entry_packet.rs:291` | Random authority generation | **Test code** | Inside `#[cfg(test)] mod tests` (line 285). `Pubkey::new_unique()` builds a fixture |
| 3 | High | `instructions/admin.rs:33` | Fixed-seed `init_config` takes its admin from whoever calls first | **Real — deploy-time only.** See §2, item A | The devnet `Config` is already initialised with `admin` = the Squads vault (`config/custody.json`), so nothing is exposed today. A fresh deployment (mainnet) has a window between deploy and `init_config` in which anyone could initialise `Config` and become its admin |
| 4 | High | `instructions/migrate.rs:95` | Type cosplay | False positive | The handler checks owner = this program (89–93), exact size = `Config::SPACE_V2` (103), discriminator = `Config::DISCRIMINATOR` (107), the address by seeds (83), and the stored admin = the signer (111–118). That is the complete defence |
| 5 | High | `instructions/refund.rs:160` | `entry` not validated | False positive | `Account<Entry>` checks owner and discriminator; `constraint = entry.pool == pool.key()` binds it to the pool. Only `register` creates `Entry` accounts (PDA `[entry, pool, player]`). `refunded` stops a second refund (174, 194) |
| 6 | High | `instructions/register.rs:210` | Type cosplay | False positive | Every data account is a typed `Account<>` with seeds; the instructions sysvar, SlotHashes sysvar and Metaplex Core are pinned by `address =` (113, 118, 123) |
| 7 | High | `state.rs:557` | Random authority generation | **Test code** | Inside `#[cfg(test)]` (line 507) |
| 8 | High | `vault.rs:3` | PDA sharing | False positive | The prize vault's seeds include the pool id: one vault per pool. The treasury PDA is a deliberate singleton whose three debit sites are gated (keeper-only `open_pool`; `refund` to `entry.player`; admin-signed, floor-guarded `withdraw_platform`) and pinned function-by-function by `scripts/check-standing-rules.sh` |
| 9 | High | `vrf.rs:103` | `randomness_account` has no owner check | False positive | The owner is checked in the handler (131–135) against both Switchboard program IDs. Accepting either ID is the recorded accepted risk **IR-2**; it can only affect the cosmetic class |
| 19–22 | Med | `instructions/migrate.rs:85, 160, 238, 262` | Unchecked arithmetic | False positive | `required - held` runs only inside `if held < required` (129, 276). The offsets are compile-time constants into an account just resized to exactly that size; an out-of-range slice panics, it does not write elsewhere |
| 23–24 | Med | `instructions/open_pool.rs:2, 65` | Duplicate mutable accounts | False positive | The writable accounts are the keeper (a signer) and four PDAs with distinct prefixes (`config`, `pool`, `vault`, `platform`); `state.rs` tests their distinctness (TM-401). A PDA cannot sign a transaction, so no two can alias |
| 25 | Med | `instructions/refund.rs:196` | `refunded_count += 1` may overflow | False positive | At most 64 entrants, and each `Entry` can increment it once (`refunded` flag) |
| 26 | Med | `instructions/register.rs:221` | `class_counters[i] -= 1` may underflow | False positive | `weighted_class_draw` returns only an index whose counter is above zero (`crates/blotto-randomness/src/lib.rs:163–167`) |
| 27 | Med | `instructions/register.rs:261` | `entrants += 1` may overflow | False positive | Guarded by `entrants < CAPACITY` (160) |
| 28 | Med | `instructions/reveal_commit.rs:114` | `total +=` may overflow | False positive | At most 64 `u64` amounts summed in `u128` |
| 29–32 | Med | `instructions/treasury.rs:51, 60, 69, 136` | Unchecked arithmetic | False positive | Every sum is in `u128` over at most three `u64`s or a `u64` × `u8`, with `saturating_add` and a saturating down-cast — the direction that over-holds the floor |
| 33–34 | Med | `merkle.rs:71` | Unchecked arithmetic | **Test code** | `unhex` helper inside `#[cfg(test)]` (line 64) |
| 35–36 | Med | `prize_math.rs:29, 41` | Unchecked arithmetic | False positive | The module has no on-chain caller (its own header says so; no `prize_math::` call outside tests). `u128` intermediates |
| 37–41 | Med | `slot_hashes.rs:37–52` | Unchecked arithmetic | False positive | The account is pinned to the SlotHashes sysvar address, so the runtime writes the bytes. The loop stops as soon as `data.get()` runs past the data |
| 42 | Med | `state.rs:524` | Unchecked arithmetic | **Test code** | Inside `#[cfg(test)]` |
| 43–45 | Med | `tests/vault_model.rs` | Unchecked arithmetic | **Test code** | The vault property model |
| 61 | Low | `instructions/admin.rs:25` | Missing owner check | Same as item 3 | |
| 62 | Low | `instructions/escrow.rs:261` | Writable `to_player` has no constraint | False positive | `address = to.player` (262) |
| 63 | Low | `instructions/escrow.rs:53` | Missing owner check on `release_escrow` | By design | The settlement signer, or anyone once the seven-day auto-release has passed — inaction pays the player (**IR-4**). Sanctions and forfeit holds are checked first (93–106) |
| 64 | Low | `instructions/escrow.rs:77` | Writable `player` has no constraint | False positive | `address = entry.player` (78) |
| 65 | Low | `instructions/flags.rs:15` | Missing owner check | False positive | `has_one = settlement_signer` (23) |
| 66 | Low | `instructions/open_pool.rs:52` | Missing owner check | False positive | Keeper checked in the handler (134–137, `NotKeeper`) |
| 67 | Low | `instructions/pay_prizes.rs:49` | Missing owner check | False positive | `has_one = settlement_signer` (61) |
| 68 | Low | `instructions/refund.rs:162` | Writable `player` has no constraint | False positive | `address = entry.player` (163) |
| 69 | Low | `instructions/refund.rs:30` | Missing owner check on `trigger_refund` | By design | Permissionless so a vanished operator cannot strand entries (R7). Gated on state, deadline and field size; the pot can only go to the treasury PDA |
| 70 | Low | `instructions/register.rs:61` | Missing owner check | By design | The signer is the entrant. The gate is the Ed25519 entry packet signed by `Config.entry_signer` (179–186) |
| 71 | Low | `instructions/reveal_commit.rs:24` | Missing owner check | False positive | `has_one = settlement_signer` (32) |
| 72 | Low | `instructions/sanctions.rs:47` | Missing owner check | False positive | `has_one = settlement_signer` to place a hold, `has_one = admin` to lift one |
| 73 | Low | `instructions/seal.rs:31` | Missing owner check | By design | Permissionless; gated on state, deadline and the pool's own minimum field |
| 74 | Low | `instructions/treasury.rs:128` | Writable `destination` has no constraint | By design | Admin-chosen (Squads, `has_one = admin`), refused below the floor, logged in `PlatformWithdrawn` |
| 75 | Low | `instructions/treasury.rs:80` | Missing owner check | By design | `fund_platform_wallet` only adds lamports |
| 76 | Low | `pass.rs:103` | Missing owner check | By design | Permissionless and write-once; metadata derived on chain (**IR-1**, fixed); update authority fixed to the Pool PDA |
| 77–79 | Low | `vault.rs:102, 130, 160` | CPI target unresolved | False positive | `system_program` is `Program<'info, System>`, which Anchor checks equals the System Program ID before the handler runs |

### 3.2 Off-chain code (27 items, plus two from the packages table)

| # | Sev. | Where | Scanner's claim | Verdict | Evidence |
|---|---|---|---|---|---|
| 1 | High | `backend/indexer/src/treasury-report.ts:431` | SQL built by concatenation | False positive | Two string literals joined with `+` for line length. No value is interpolated; every query in the file that takes a value uses `$n` placeholders |
| 10 | Med | `app/src/battle/components/board/arena/figures.ts:9` | Hard-coded `http://` endpoint | False positive | `http://www.w3.org/2000/svg` is the SVG namespace name `createElementNS` requires. It is never fetched |
| 11–12 | Med | `battle-test/scripts/enter.ts:544`, `late-attempt.ts:280` | Preflight disabled | By design, test tooling | Devnet trial scripts, not shipped. `enter.ts:525–541` records why (preflight failures burnt trial wallets); `late-attempt.ts:9–19` sends a transaction that is meant to fail on chain, to prove it costs only the fee. No production path skips preflight |
| 13–16 | Med | `deploy/docker/Dockerfile.*:6` | Base image by tag, not digest | **Real, low.** See §2, item D | |
| 17 | Med | `mobile/blotto-cup/.../AndroidManifest.xml:16` | `allowBackup="true"` | **Mostly mitigated; one-line hardening.** See §2, item E | `backup_rules.xml` and `data_extraction_rules.xml` already exclude the WebView's storage (`app_webview`: cookies, local storage, IndexedDB) and databases from cloud backup, device transfer and pre-Android-12 backup. No wallet key lives in this app |
| 18 | Med | `AndroidManifest.xml:25` | Exported activity with no permission | False positive | It is the launcher activity, which must be exported. Its only intent filter is MAIN/LAUNCHER, and it reads no intent data — the start URL comes from `BuildConfig` |
| 46–60, 80–81 | Low | 17 files | Imports `@solana/web3.js` v1 | Not a vulnerability | A maintenance notice. The app ships `@solana/kit`; web3.js is an app **devDependency**, used in tests as a deliberately independent second implementation (`register-tx.test.ts:1–6`). The backend services and scripts use v1, and the Switchboard SDK the daemon needs depends on v1. Migration is tracked tech debt (§2, item J) |
| pkg 5 | High | `app/src/entry/device.ts:87` | A Solana secret key is written to browser storage | False positive | The value is 32 random bytes used as a salt for the per-pool device marker (a detection signal) and for opaque storage-key names. It is not a Solana key, signs nothing and controls no funds. The only keypair the app makes — the pass asset's — is WebCrypto, held in memory for one transaction (`app/src/entry/services.ts:315–319`) |
| pkg 19 | Med | `backend/packet/scripts/check-entry-signer.ts:103` | Key material passed to a logger | False positive | It prints the **length** of `TURNKEY_API_PRIVATE_KEY` and whether it is hex, to diagnose a swapped key pair. The value is never printed (60–62 print `<set>`/`<unset>`). An operator CLI, not a service |

## 4. Findings against our dependencies

### 4.1 npm packages (22 items)

Three facts frame this table:

- **What ships where.** The web app is built by Vercel; tracing every import it takes from the
  backend packages reaches only `@noble/hashes`, `tweetnacl` and `@turnkey/crypto`, so the backend
  SDKs' advisories do not reach the browser. The four service images install **all** dependencies,
  dev included (item I), so "dev only" below means "present in the image, never loaded".
- **No overrides exist yet** in any of the fourteen `package.json` files.
- **Live counts, runtime dependencies only (`npm audit --omit=dev`), today → after items B and C:**
  app 2 critical / 17 high → 0 / 13 (all `braces`, React Native's bundler only);
  `backend/reveal` 0 / 9 → 0 / 5 (all the `bigint-buffer` chain); `backend/indexer`,
  `tests/rehearsal`, `battle-test` 4 moderate → 0; every other package 0 → 0.

| Item | Sev. | Where | Path | Verdict | Fix |
|---|---|---|---|---|---|
| `next` 16.3.0 | Crit. | `app/package.json:31` | direct | **Real — fix now** | 16.3.8 (item B) |
| `ws` 8.18.0, 8.18.3 | High | `app/package-lock.json:10581, 5228`; `backend/reveal/package-lock.json:506` | Privy → wallet connectors → `viem`; Irys → `@ethersproject/providers`. Both pin `ws` exactly. (The copy under `@react-native/dev-middleware` is 7.5.13 and unaffected) | Real, unreachable: the browser build of `ws` is a stub, and the server-side code that would open these sockets is never constructed | Override `^8.21.0` (item C) |
| `axios` 1.16.0 | High | `app/package-lock.json:11788` | **Not direct**, as the report says: Privy → x402 → wagmi → `@coinbase/cdp-sdk`, which pins it | Real, not plausibly reachable: the high advisories concern Node's HTTP and proxy handling, or need a separate prototype-pollution bug first; in the browser axios uses `fetch`/XHR | Override `^1.20.0` (item C) |
| `extract-zip` 2.0.1 | High | `app/package-lock.json:14171` | lighthouse → puppeteer (dev) | Accepted: no fixed release. Unreachable: the Lighthouse gate drives the runner's own Chrome, so puppeteer never unpacks a download | lighthouse 13 (a major bump) when convenient |
| `serialize-javascript` 6.0.0 | High | 11 lockfiles | mocha (dev) | Real, unreachable: mocha uses it only with `--parallel`, which nothing uses | Override `^7.0.5` under mocha (item C) |
| `js-yaml` 4.1.0, 4.3.1 | High | 12 lockfiles | mocha, eslint (dev) — **and a runtime copy in `backend/reveal`** via Switchboard, which the report missed | Real, unreachable: every caller parses local configuration files; Switchboard parses YAML only in a helper reveal never calls | `^4.3.2`, inside the declared range (item C) |
| `bigint-buffer` 1.1.5 | High | `backend/reveal/package-lock.json:2131` | Irys and Switchboard → `@solana/spl-token` → `@solana/buffer-layout-utils` | **Accepted: no fix exists** (unmaintained since 2022; the latest `spl-token` still requires it). `toBigIntLE` runs only when decoding SPL token-account amounts, and the daemon uses native SOL; the one SPL helper Switchboard uses here derives an address and decodes nothing | None upstream; recorded |
| `toml` 3.0.0 | High | `backend/reveal/package-lock.json:4632` | Switchboard → Anchor 0.31 | Real, unreachable: parses only a local `Anchor.toml`, in a loader the daemon never touches | Override `^4.3.0` (item C) |
| `minimatch` 4.2.1 | High | 11 lockfiles | mocha (dev) | Real, unreachable: patterns are test globs we write | `minimatch@4` → `^4.2.6` under mocha (item C) |
| `nanoid` 3.3.1 | High | 11 lockfiles | mocha (dev) | Real, unreachable | `^3.3.18` under mocha (item C) |
| `decode-uri-component` 0.2.2 | Med | `app/package-lock.json:12825` | **Not direct**: wallet connectors → `query-string` 7 | Accepted: the fix (0.5.0) is ESM-only and `query-string` 7 loads it with `require`, so an override would break it. Worst case, a malformed wallet-connection link stalls the user's own tab | None safe; recorded |
| `ip-address` 10.5.0 | Med | `app/package-lock.json:15205` | lighthouse (dev) | Accepted, dev only | lighthouse 13 |
| `@opentelemetry/core` 1.30.1 | Med | `app/package-lock.json:3578` | lighthouse → Sentry (dev) | Accepted, dev only | lighthouse 13 |
| `vitest` 4.1.10 | Med | `app/package.json:50` | direct (dev) | Real, dev only | 4.1.11 (item C) |
| `stream-json` 1.9.1 | Med | 6 lockfiles | `@solana/web3.js` → `jayson` | Real, unreachable: web3.js loads only `jayson`'s browser client; `stream-json` serves its TCP transports | `jayson` 5 under web3.js drops it (item C) |
| `csv-parse` 5.6.0 | Med | `backend/reveal/package-lock.json:2559` | Irys | Accepted: the fix is a major Irys's own range excludes. Irys uses it only to resume folder uploads, with options the advisory does not cover; the daemon uploads single files | None safe; recorded |
| `uuid` 9.0.1, 8.3.2 | Med | 6 lockfiles | wallet SDKs (app); `jayson` (backend) | Real, unreachable: the bug is in `v3`/`v5`/`v6` with a caller's buffer; every caller uses `v4()`. (The report's 14.0.2 snippet is unaffected) | `jayson` 5 removes the backend copies; the app's wallet-SDK copies are recorded |
| `diff` 5.0.0 | Low | 11 lockfiles | mocha (dev) | Real, dev only | `^5.2.2` under mocha (item C) |
| `elliptic` 6.6.1 | Low | `backend/reveal/package-lock.json:2683` | Irys → `@ethersproject/signing-key` | Accepted: no fix. The flaw is in secp256k1 signing; the daemon signs Irys uploads with ed25519 | None upstream; recorded |

**Runtime advisories the report did not list** (all handled by items B and C): six more `next`
advisories; `shell-quote` (critical) and `braces` (high, no fix), both only under React Native's
bundler, an auto-installed peer of the mobile wallet library and never bundled for the web;
`sharp` (high, an optional `next` dependency); `source-map-js` (high, build time only); `hono` and
`fast-copy` (moderate).

### 4.2 Rust crates (11 items), licences and duplicates

Re-run on 2026-10-11 with the CI-pinned tools (cargo-deny 0.20.2, cargo-audit 0.22.2) against
advisory-db `7eebec69` (2026-10-09). On the root workspace — the one that builds the program —
`cargo deny check advisories` and `cargo audit` both pass today.

| Scanner item | Where | Verdict | Evidence and action |
|---|---|---|---|
| rkyv 0.7.46 | `Cargo.lock:1800` | Real advisory (RUSTSEC-2026-0235), **unreachable** | `cargo tree -i rkyv` prints nothing for any target or feature set. It sits in the lockfile only as a weak optional dependency of `rust_decimal` that Cargo records but never activates. Already ignored, with that reason, in `deny.toml` and `.cargo/audit.toml`. **Keep the ignore**: cargo-audit reads the raw lockfile and goes red without it. The comment in `security-sweep.yml` calling it stale is wrong and should be corrected |
| borsh 0.10.4 | `Cargo.lock:385` | Scanner error | RUSTSEC-2023-0033 lists `^0.10.4` as **patched**. Neither tool reports it. It arrives through `mpl-core` → `kaigan`, and `mpl-core`'s default `borsh-v1` feature compiles out every use of it |
| faster-hex 0.10.0 | `Cargo.lock:817` | Real advisory (RUSTSEC-2026-0306, "unsound"), **unreachable** | Comes through `switchboard-on-demand`, so it is in the program's build graph. The flaw is in `hex_decode_unchecked` on x86 AVX2 only; Switchboard calls only the encoder `hex_string`, and the program runs on SBF, not x86. **Why CI missed it:** cargo-deny skips "unsound" advisories in transitive crates by default (`unsound = "workspace"`), and cargo-audit reports it only as an allowed warning. Action: set `unsound = "all"`, add the id to both ignore lists with this reason, and bump to 0.10.1 (a semver-compatible `cargo update -p faster-hex`; it builds) **with the next program release**, because it changes a build input of the deployed binary |
| libsecp256k1 0.7.2 | both lockfiles | Already triaged (RUSTSEC-2025-0161, unmaintained) | Comes through Switchboard and the Agave toolchain; not ours to move. No action |
| bincode 1.3.3 | both lockfiles | Already triaged (RUSTSEC-2025-0141, unmaintained) | Comes through `anchor-lang` and the Solana crates. No action |
| ansi_term, paste, rand 0.7.3, curve25519-dalek 3.2.0, derivative, ed25519-dalek 1.0.1 | `tests/litesvm/Cargo.lock` | **Test harness only** | The LiteSVM suite is a separate workspace that loads the compiled program; none of these is in the program. The two "vulnerabilities" (curve25519-dalek timing, ed25519-dalek signing-oracle) concern signing with secret keys, which the harness does only with throwaway test keys. All come through `agave-precompiles` 4.2.1, which pins `ed25519-dalek = "=1.0.1"`. The root lockfile carries only patched versions (curve25519-dalek 4.1.3, rand 0.8/0.9). **Real gap:** CI never audits this lockfile — `security-sweep.yml` runs at the root only. Action: add a LiteSVM advisory job with its own triaged ignore list |
| RUSTSEC-2026-0190 (anyhow) | `deny.toml`, `.cargo/audit.toml` | Not a scanner item; found while checking | Genuinely stale: `anyhow` 1.0.104 is in the patched range. Remove from both lists, and drop the comment that calls it reachable |
| 17 "rejected licence expression" items, "mpl-core is unlicensed" | `Cargo.toml:1` | **Scanner artefact — plus one real legal item** | `deny.toml` has no `[licenses]` section (its header says a licence policy "is a separate decision"), so a default cargo-deny run rejects every licence. Running it locally gives exactly 17 distinct expressions, all permissive (Apache-2.0, MIT, BSD-2/3-Clause, Unicode-3.0). No GPL, AGPL or MPL anywhere. **But `mpl-core` 0.12.0 is not Apache-2.0**: its `LICENSE` is the *Metaplex(TM) NFT Open Source License v1.0*, which counts a program that links to it as a derivative work, counts making it available on a blockchain as distribution, and requires recipients to get a copy of the licence (§4(a)). The repository ships no copy. See §2, item F |
| 29 duplicate crate versions | `Cargo.toml:1` | Normal for Solana | `cargo deny check bans` passes with 29 duplicate warnings (two `solana-program` majors, three `syn`, two `borsh`, and so on). Costs program size, not security. No action |

## 5. Found while verifying, not in the report

- **ADR-026 and TM-502 overstate how unpredictable the class draw is.** Both say an entry's
  class cannot be predicted at submission. At submission the entrant already knows the pool's
  seed (published by `PoolVrfSeeded`), the pool, their own key, the likely entry index, and every
  candidate slot hash: the program uses the newest hash at least five slots older than the
  landing slot, and a transaction usually lands within a few slots, so the candidates are hashes
  that are already public. An entrant can therefore estimate their class and time the entry.
  Nothing of value follows — the class is cosmetic, the bag fixes how many of each class a pool
  hands out, and passes cannot be transferred, so there is nothing to resell — but the two
  documents should say "hard to target" rather than "unpredictable". Documentation only; no
  player-facing copy makes the claim.
- **The service images install dev dependencies.** Every `deploy/docker/Dockerfile.*` runs
  `npm ci --no-audit --no-fund` without `--omit=dev`, because the services start through
  `ts-node`. So "dev-only" advisories (mocha, eslint and the like) are present in the images even
  though nothing runs them. This is why several package items above are "present, not reachable"
  rather than "absent" (item I).
- **An unencoded path segment in the app** (`app/src/data/api.ts`): item L.
- **Two app runtime dependencies declare Node 24 or later** (`@solana-program/compute-budget`,
  `@solana-program/token`); `app/.nvmrc` says 24, but CI builds the app on Node 20. Not a security issue; worth
  aligning the next time the Node version is touched.
