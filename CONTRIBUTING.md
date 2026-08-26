# Contributing to Blotto Cup

Read [`CLAUDE.md`](CLAUDE.md) for the hard rules and [`docs/INDEX.md`](docs/INDEX.md) for which
document is canonical on which subject. This file is canonical for **process** only.

## First run in a fresh clone

```bash
git config core.hooksPath .githooks    # enables the keypair pre-commit hook — do this first
cp .env.example .env                   # then fill values from the shared vault, never from chat
```

## Keys and secrets

**No key from any repository is ever committed here.** Not a deploy keypair, not a program-identity
keypair, not an authority keypair, not an RPC key, not a database URL with a password in it.

The old `anarchy-fun` repository committed two Solana keypairs — a program-deploy key and a test
authority key — and had to treat both as permanently compromised. This repository was created with
none in it. Three defences keep it that way:

1. **`.gitignore`** — `keys/`, `*keypair*.json`, `*.pem`, `id.json`, `.env`, and the whole of
   `target/`. Note that unlike the old repo, nothing under `target/` is re-included: the program
   keypair lives outside the repository entirely and the program ID is pinned in `Anchor.toml` and
   `declare_id!`.
2. **`.githooks/pre-commit`** — rejects any staged file containing a 64-integer array, which is the
   shape of a Solana keypair on disk. Enable it with the `git config` line above; it does nothing
   until you do.
3. **`.gitleaks.toml` + the `gitleaks` CI lane** — a filesystem scan of every checkout, with a
   custom rule for the same 64-integer-array shape. The gitleaks default ruleset does **not** detect
   Solana keypairs; that custom rule exists because the old repo leaked exactly this way.

If a key needs to be referenced in a document, record only its **public** key.

## The language gate

PID §8.7 forbids a specific vocabulary. This is a legal-position rule (compliance item C12), not a
style preference: the old product's language is a discoverable liability, and the failure mode is a
single careless identifier surviving into the new repo. The words are:

> Never: lottery · gamble · bet · wager · casino · pull · pack · odds · jackpot · rake · deal · roll.
> Use: entry · pass · character · battle · stat · allocation · tournament · prize pool · ranking.

Run this from the repository root before every commit. **It must return nothing.**

```bash
# ALLOWLIST — exactly one token is permitted to match, nowhere else in this repository:
#   pull_request   a GitHub Actions event name in .github/workflows/*.yml. It cannot be
#                  renamed; it is not product language. Anything else that matches \bpull\b
#                  is a real hit — rewrite it. Workflow steps use `git fetch`, never
#                  `git pull`, so the verb never appears.
# Nothing else is allowlisted. Do not extend this list without the same scrutiny.
grep -rniE 'casino|gambling|disguised|dopamine|shill|degen|the house|pump|bonding|lottery|jackpot|\bodds\b|\bpack\b|\bpull\b|\bbet\b|wager|rake|\broll\b|anarchy|xp\b|graduat|trending|magic eden|synthetic' . \
  --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git \
  --exclude-dir=reference --exclude-dir=archive \
  --exclude=EXTRACTION-REPORT.md --exclude=TRANSITION-REPORT.md \
  --exclude=CONTRIBUTING.md \
| grep -vE '^\./\.github/workflows/[^:]*:[0-9]+: *pull_request:?$'
```

Four paths are excluded and each has a reason:

| Excluded | Why |
|---|---|
| `docs/reference/` | Decision records exported verbatim from the old repo. Explicitly historical, never authoritative — `docs/INDEX.md` says so. |
| `docs/archive/` | Superseded Blotto Cup documents, kept as evidence. |
| `EXTRACTION-REPORT.md`, `TRANSITION-REPORT.md` | The two Phase 0 reports have to name the old product and the components that were not carried in order to be useful. |
| `CONTRIBUTING.md` | This file lists the forbidden words in order to forbid them. |

Everything else in this repository is live and must pass.

This grep is **not yet a CI lane** — Phase 0's brief scoped `ci-fast` to the Rust and gitleaks jobs.
Promoting it is a recommended follow-up recorded in `EXTRACTION-REPORT.md`; until then it is a
manual step and a review responsibility.

### The specific traps

- In the class draw, no variable is named `odds` or `weights`. The name is **`class_counters`**.
- The reveal object is a character **pass**, never an egg and never a "pack". The verb is
  **reveal** or **unseal**, never crack or hatch.
- `xp\b` catches `xp` as a whole word. It does not catch `expiry` or `export`.
- `graduat` catches `graduation` and `graduated`. Blotto Cup pools do not graduate; they **close**.

## Rust

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

All three are gated by the `rust` job in `ci-fast`. The workspace sets
`overflow-checks = true` on release, `unsafe_code = "forbid"`, and clippy `all = warn` — an
arithmetic overflow is a panic in every profile, deliberately.

**Dependency versions are pinned exactly (`=x.y.z`), not caret-ranged.** Every version in this
repository was taken from the old repository's `Cargo.lock` at extraction time. Upgrading any of
them is a separate, tested change with its own commit — never a side effect of other work.

## Anchor

`anchor build` and `anchor test` need the Solana CLI and Anchor toolchains, which `ci-fast` does not
install (nothing in that lane builds SBF). Run them locally. `Anchor.toml` bundles the Metaplex Core
program as a genesis fixture (`tests/fixtures/mpl_core.so`) so the suite runs offline.

## Commits and branches

- One logical change per commit, with a message that says what changed and why.
- Branch from the default branch; never commit directly to it.
- A commit that touches on-chain money paths, the pass mint, or anything in PID §8 says so in its
  body.

## CI

`ci-fast` runs on every pull request and every push to the default branch. Two jobs: `rust` and
`gitleaks`.

**If the default branch goes red, fixing it outranks new work.** The `stop-the-line` workflow files
an issue assigned to the merging author automatically and closes it when the lane next runs green —
nobody transcribes anything by hand. That issue is the one alarm in this repository that always
demands action.
