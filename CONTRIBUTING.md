# Contributing to Blotto Cup

[`CLAUDE.md`](CLAUDE.md) holds the hard rules (they bind people and AI agents alike) and
[`docs/README.md`](docs/README.md) says which document is canonical on which subject. This file is
canonical for **process**. For setting up a machine, see
[`docs/guide/GETTING-STARTED.md`](docs/guide/GETTING-STARTED.md).

## First run in a fresh clone

```bash
git config core.hooksPath .githooks    # enables the keypair pre-commit hook — do this first
npm run setup                          # installs every package the app and backend need
cp app/.env.example app/.env.local     # then fill values from your own accounts
cp backend/.env.example .env           # the REPO ROOT: docker compose reads it; no service loads a dotenv itself
```

## Keys and secrets

**No secret is ever committed here** — not a deploy keypair, a program-identity keypair, an
authority keypair, an RPC key, or a database URL with a password in it. If a key has to be named in
a document, record only its **public** key, and name it by role, not by person.

Three defences, each written after a predecessor project leaked a committed keypair:

1. **`.gitignore`** — `keys/`, `*keypair*.json`, `*.pem`, `id.json`, `.env`, and all of `target/`.
   The program keypair lives outside the repository; the program ID is pinned in `Anchor.toml` and
   `declare_id!`.
2. **`.githooks/pre-commit`** — rejects any staged file containing a 64-integer array, the shape of
   a Solana keypair on disk. It does nothing until you run the `git config` line above.
3. **`.gitleaks.toml` + the `gitleaks` CI job** — a scan of every checkout with a custom rule for the
   same shape. The gitleaks default ruleset does **not** detect Solana keypairs.
   [`.gitleaksignore`](.gitleaksignore) documents the only accepted findings (published scoring
   fixtures that share the shape) and why.

## The language gate

The product's vocabulary is part of its design, not a matter of tone: public copy describes
**mechanics** and never asserts a legal category, a trust status or a financial return. The same
rule covers code identifiers, comments, commit messages, test names and documents, because a single
careless identifier is discoverable.

> **Never:** lottery · gamble · bet · wager · casino · pull · pack · odds · jackpot · rake · deal ·
> roll · promotional · sweepstake
>
> **Use:** entry · pass · character · battle · stat · allocation · tournament · prize pool · ranking

Five further groups (decision `D-B7`), enforced by the same script:

1. **Bare status claims** — non-custodial · provably fair · licensed · regulated · compliant ·
   trustless · can't be rigged · rig-proof. A sentence that cannot prove the claim it makes must not
   make it.
2. **Anonymity marketing** — anonymous · anonymity · no-KYC · untraceable · unbannable · play from
   anywhere.
3. **Guarantee claims** — guaranteed · risk-free · free money · +EV · everyone wins.
4. **Finance framing** — yield · APY · passive income · earn · investment · early investors · number
   go up · reinvest · asset manager · AMM · advise. Entering a tournament is not investing and a
   prize is not income; the treasury is a float of prize money with published rules.
5. **Category assertions** — not gambling · just a game · skill game · skill tournament. Public copy
   describes what happens: "sealed-allocation tournament", "prizes paid by published rank",
   "randomness affects the class draw only", "funds held by program `<ID>`".

Run it from the repository root before every commit:

```bash
./scripts/check-language.sh
```

The gate greps line by line, so a banned *phrase* hard-wrapped across two lines of markdown escapes
it (single words cannot). Reviewers watch for wrapped phrases.

### The specific traps

- In the class draw, no variable is named `odds` or `weights`. The name is **`class_counters`**.
- The character is revealed from a **pass**; the verb is **reveal** or **unseal**.
- Pools do not change category when they end; they **close**.
- Ordinary English trips it too — "pull the value out", "hand-roll the bytes", "deal with it".
  Rewrite: "extract", "hand-encode", "handle". The gate is blunt on purpose.

### What is excluded, and why

| Excluded | Why |
|---|---|
| `CONTRIBUTING.md`, `CLAUDE.md`, `scripts/check-language.sh` | They quote the forbidden list in order to forbid it |
| `LICENSE`, `*.OFL.txt` | Verbatim licence texts nobody here authored ("Licensed under…") |
| `Cargo.lock`, `package-lock.json`, `yarn.lock`, `*.tsbuildinfo`, `lifecycle-logs.json` | Machine-generated; third-party package names are not ours to rename |
| `node_modules/`, `target/`, `.next/`, `.git/`, `*.so`, `*.png`, `handoff/` | Not repository content, or not text |
| `docs/archive/`, `docs/counsel-brief/`, `step-vocabulary.md` | Historical internal material scheduled for removal from the repository |

**Everything else is live and must pass.** One token is allowlisted: `pull_request`, a GitHub
Actions event name in `.github/workflows/*.yml`. A hit is fixed by rewriting it, never by widening
the exclusion list.

## The standing-rules checks

CI's `standing-rules` job runs fifteen checks, in this order. Each self-tests before it reports, so
a check that has stopped working says so instead of passing.

| Check | What it refuses |
|---|---|
| `scripts/check-language.sh` | The vocabulary above |
| `scripts/check-standing-rules.sh` | Anything named `class` in the scoring path; a vault exit outside the enumerated set; pot arithmetic over entries |
| `scripts/check-territories.ts` | A territory schedule the entry service could not actually enforce, or one that disagrees with its legend |
| `scripts/check-operator-identity.ts` | An operator-identity file with the wrong shape — and, on mainnet, any unset value |
| `scripts/check-blocked-wallets.ts` | A blocked wallet without a recorded ground the terms enumerate |
| `scripts/check-published-numbers.ts` | A number in player-facing copy that a program constant has since moved, in digits or in words |
| `scripts/check-dead-files.ts` | An app source file no route reaches, unless it is declared with a reason |
| `scripts/sim/fill-replay.ts --self-test` | A fill simulation that has drifted from the program's seal/refund boundary |
| `scripts/drain-verdict.ts --self-test` | An upgrade pre-flight that has stopped refusing while a pool is taking entries |
| `scripts/check-env-examples.sh` | An environment variable a service reads that no `.env.example` documents |
| `scripts/check-container-user.sh` | A service image that runs as root |
| `scripts/check-fixtures.sh` | A Python oracle that no longer reproduces its committed test vectors |
| `scripts/check-mirrors.py` | A constant or event layout on which Rust and TypeScript disagree |
| `scripts/ci-gate.sh --self-test` | A deploy gate that has stopped judging correctly |
| `scripts/deploy-devnet.sh --self-test` | A program deploy that can no longer tell an outage from a fresh cluster |

## Rust

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

All three run in `ci-fast`'s `rust` job. The workspace sets `overflow-checks = true` on release and
`unsafe_code = "forbid"` — an arithmetic overflow is a panic in every profile, deliberately.
**Dependency versions are pinned exactly (`=x.y.z`).** Upgrading one is its own tested change,
never a side effect of other work.

## Anchor and the program

`ci-fast` does not build SBF. The **`on-chain`** workflow does: it runs `anchor build --ignore-keys`
and the LiteSVM integration suite on every change that touches `programs/`, `crates/` or `tests/litesvm/`.
Locally:

```bash
anchor build --ignore-keys
cd tests/litesvm && cargo test
```

The LiteSVM suite loads the Metaplex Core program from `tests/fixtures/mpl_core.so` itself, so it
runs offline.

## Commits, branches and pull requests

- One logical change per commit, with a message that says what changed and why.
- Branch from the default branch; never commit to it directly.
- A commit that touches on-chain money paths, the pass mint, or a published claim says so in its body.
- A commit that touches the channel logic (the sign-in page, the wallet or tx seams, the response
  headers, the manifest) says so too, and its author has read
  [`docs/guide/MOBILE.md` §6](docs/guide/MOBILE.md#6-change-control-what-a-change-means-for-the-phone):
  the site and the Android package are one build, and that section says which changes need a
  package rebuild (almost none).
- Name branches **`<prefix>/<subject>`**, lower case and hyphenated: `feat/`, `fix/`, `docs/`,
  `review/`, `revert/`, `ops/`. Rename a machine-generated branch before opening its PR.
- Delete a branch when its PR merges (Settings → General → *Automatically delete head branches*).
  `scripts/prune-merged-branches.sh` prints a verdict for every branch, and deletes only with
  `--delete` and only on proof that the branch tip is already in `main`.
- Use the pull request template: what changed and why, how it was verified, and which hard rules it
  touches.

## CI

`ci-fast` runs on every pull request and every push to the default branch: `rust`, `node`,
`postgres`, `journey` (the browser journey at phone and desktop widths), `gitleaks` and
`standing-rules`. The `postgres` job fails if any case came back pending rather than passing it.
Other lanes: `on-chain` (the SBF build and LiteSVM), `rehearsal` (the battle-test folder's own
rules), `skill-evidence` (nightly regeneration of the study), `security-sweep`
(`cargo deny` and `cargo audit`), `deployed-drift` (the deployed program matches the source),
`app-test-signer` (no test signer in the production bundle) and the deploy and monitoring
workflows described in [`docs/guide/HOSTING.md`](docs/guide/HOSTING.md). Nothing builds the
Android package (`mobile/`): it is built by hand by the holder of its signing key, and `ci-fast`
still runs in full on any commit that touches only `mobile/`
([`docs/guide/MOBILE.md` §7](docs/guide/MOBILE.md#7-ci)).

**If the default branch goes red, fixing it outranks new work.** The `stop-the-line` workflow opens
an issue when a main-branch lane fails and closes it when the lane next passes.
