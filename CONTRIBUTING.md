# Contributing to Blotto Cup

Read [`CLAUDE.md`](CLAUDE.md) for the hard rules and [`docs/INDEX.md`](docs/INDEX.md) for which
document is canonical on which subject. This file is canonical for **process** only.

## First run in a fresh clone

```bash
git config core.hooksPath .githooks    # enables the keypair pre-commit hook — do this first
cp app/.env.example app/.env.local     # then fill values from the shared vault, never from chat
cp backend/.env.example .env           # the REPO ROOT: this is docker compose's file. No service reads a dotenv itself
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

PID §8.7 forbids a specific vocabulary. This is a legal-position rule (compliance item C12, which
blocks launch), not a style preference: the old product's language is a discoverable liability, and
the failure mode is a single careless identifier surviving into this repository.

> Never: lottery · gamble · bet · wager · casino · pull · pack · odds · jackpot · rake · deal · roll.
> Use: entry · pass · character · battle · stat · allocation · tournament · prize pool · ranking.

**Amended by D-B7 (ratified 2026-08-27)** with five further groups, enforced by the same script over
code, comments, docs and copy alike:

1. **Bare status claims** — non-custodial · provably fair · licensed · regulated · compliant ·
   trustless · can't be rigged · rig-proof. Each asserts a legal or trust status; a sentence that
   cannot prove the claim it makes must not make it.
2. **Anonymity-marketing** — anonymous · anonymity · no-KYC · untraceable · unbannable · play from
   anywhere.
3. **Guarantee claims** — guaranteed · risk-free · free money · +EV · everyone wins.
4. **Finance framing** — yield · APY · passive income · earn · investment · early investors ·
   number go up · reinvest · asset manager · AMM · advise (the last four added by master prompt
   v2's D-A1 treasury vocabulary, 2026-08-27). Entering a tournament is not investing, prizes are
   not income, and the platform treasury is described as "prize treasury" / "treasury policy" /
   "treasury report" — a float of prize money with published rules, never anything that manages,
   grows or advises on anyone's assets.
5. **Category assertions** — not gambling · just a game · skill game · skill tournament (and the
   internal tell "gambling-coded"). Public copy never asserts the product's legal category, in
   either direction — it describes **mechanics**: "sealed-allocation tournament", "prizes paid by
   published rank", "randomness from Switchboard VRF affects the class draw only", "funds held by
   program `<ID>`; upgrades require `<n-of-m>` signatures".

One limit to know: the gate greps line by line, so a banned *phrase* hard-wrapped across two lines
of markdown escapes it (single banned words cannot wrap). Reviewers watch for wrapped phrases; do
not rely on the gate alone when editing prose.

Run it from the repository root before every commit:

```bash
./scripts/check-language.sh
```

The script holds the pattern and the exclusion list, each exclusion with its reason. It runs as
the **`standing-rules` CI lane on every PR** (roadmap §3 rule 4), together with
`scripts/check-standing-rules.sh` — the structural greps for roadmap rules 5 (no `class` in the
scoring path) and 6 (the vault's exits are exactly the enumerated set). Two additional forbidden
words come from roadmap R11/§6.4: **promotional** and **sweepstake** — they denote free-entry
sweepstakes and put the product in the wrong regulatory box.

### What is excluded, and why

| Excluded | Why |
|---|---|
| `docs/reference/`, `docs/archive/` | Historical by definition, and marked non-authoritative in their own headers and in `docs/INDEX.md`. |
| The five source documents in `docs/` (PID, TECH-ARCH, brief, playbook, `BUILD-ROADMAP_v1.0.md`) | Copied verbatim — inputs to this repository rather than content authored in it. PID §8.7 necessarily *lists* the words it forbids, and the roadmap's R11 discusses the forbidden word it bans. |
| `EXTRACTION-REPORT.md`, `TRANSITION-REPORT.md` | Both have to name the old product and the components that were not carried in order to be useful. |
| `CONTRIBUTING.md`, `CLAUDE.md` | Both quote the forbidden list in order to forbid it. |
| `docs/phase-reports/step-vocabulary.md` | The D-B7 step report: it documents which forbidden words were amended and to what, which requires naming them. No other report gets this exclusion. |
| `Cargo.lock`, `package-lock.json`, `yarn.lock` | Dependency metadata, machine-generated. Package names like `pump`, `escape-string-regexp` and `solana-program-pack` are not ours to rename. |
| `LICENSE` | The verbatim Apache-2.0 text ("Licensed under…"). Legal boilerplate nobody here authored; software licensing, not a gaming-licence claim. |
| `node_modules/`, `target/`, `.next/`, `.git/` | Not repository content. |

**Everything else is live and must pass.** Exactly one token is allowlisted anywhere:
`pull_request`, a GitHub Actions event name in `.github/workflows/*.yml`. It cannot be renamed and
it is not product language; workflow steps use `git fetch`, never `git pull`, so the verb itself
never appears. Nothing else is allowlisted, and a hit is fixed by rewriting it — never by widening
the exclusion list.

### The specific traps

- In the class draw, no variable is named `odds` or `weights`. The name is **`class_counters`**.
- The reveal object is a character **pass**, never an egg and never the other word. The verb is
  **reveal** or **unseal**, never crack or hatch.
- `xp\b` catches `xp` as a whole word. It does not catch `expiry` or `export`.
- `graduat` catches the whole family. Blotto Cup pools do not do that; they **close**.
- Ordinary English words trip it too — "pull the value out of", "hand-roll the bytes", "a package
  can pull this in". Rewrite them: "extract", "hand-encode", "import". The gate is blunt on
  purpose, because a gate with judgement is a gate that lets things through.

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

`ci-fast` runs on every pull request and every push to the default branch. Three jobs: `rust`,
`gitleaks`, and `standing-rules` (language gate + roadmap §3 rules 5–6).

**If the default branch goes red, fixing it outranks new work.** The `stop-the-line` workflow files
an issue assigned to the merging author automatically and closes it when the lane next runs green —
nobody transcribes anything by hand. That issue is the one alarm in this repository that always
demands action.
