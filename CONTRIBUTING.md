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

The script holds the pattern and the exclusion list, each exclusion with its reason. One live
directory is excluded: `docs/counsel-brief/`, the brief written for a lawyer, which has to name the
statutory tests it asks counsel to apply. Nothing in it may be quoted on a player-facing surface. It runs as the
first step of the **`standing-rules` CI lane on every PR** (roadmap §3 rule 4). Two additional
forbidden words come from roadmap R11/§6.4: **promotional** and **sweepstake** — they denote
free-entry sweepstakes and put the product in the wrong regulatory box.

That lane runs **thirteen** checks tabled here, not one, and any of them can fail your change. In its order:

| Check | What it refuses to let through |
|---|---|
| `check-language.sh` | The §8.7 lexicon, above |
| `check-standing-rules.sh` | Roadmap rules 5 (no `class` in the scoring path) and 6 (the vault's exits are exactly the enumerated set) |
| `check-territories.ts` | A founder territory schedule the entry service could not actually enforce |
| `check-published-numbers.ts` | A number in player-facing copy that a shared constant has since moved. Reads the program's own `constants.rs`, and catches the value spelled out as well as in digits — R7-b moved `MIN_SEATS` 52 → 40 and the landing page kept "fifty-two", where a digit sweep would have passed it. History in a comment beside the string is fine and is the convention; it is the rendered text that must be current |
| `check-dead-files.ts` | An app source file that no route reaches any more — production or `page.dev.tsx` — and that is not declared in the script with a reason. A file only its own test imports counts as dead. Added 2026-09-24 when the dial run left behind ~4,000 unreachable lines no gate noticed (change report §8–9) |
| `sim/fill-replay.ts --self-test` | A fill simulation that has drifted from the program's seal/refund boundary |
| `drain-verdict.ts --self-test` | An upgrade pre-flight that has quietly stopped refusing while a pool is taking entries. It imports nothing, so this lane can run it without installing a workspace; operators reach the same fixtures via `admin.ts pools --self-test` |
| `check-env-examples.sh` | An environment variable a service reads and no example documents |
| `check-container-user.sh` | A service image whose entrypoint runs as root |
| `check-fixtures.sh` | A Python oracle that no longer reproduces its committed vectors |
| `check-mirrors.py` | A constant or event layout where Rust and TypeScript disagree |
| `ci-gate.sh --self-test` | A deploy gate that has stopped judging correctly |
| `deploy-devnet.sh --self-test` | A program deploy that can no longer tell an outage from a fresh cluster |

Each one self-tests before it reports, so a gate that has stopped working says so rather than
reporting clean.

### What is excluded, and why

| Excluded | Why |
|---|---|
| `docs/reference/`, `docs/archive/` | Historical by definition, and marked non-authoritative in their own headers and in `docs/INDEX.md`. |
| The six source documents in `docs/` (PID v0.5, the **v0.6 draft**, TECH-ARCH, brief, playbook, `BUILD-ROADMAP_v1.0.md`) | Copied verbatim — inputs to this repository rather than content authored in it. PID §8.7 necessarily *lists* the words it forbids, and the roadmap's R11 discusses the forbidden word it bans. The v0.6 draft is excluded for the same reason as v0.5: it reproduces §8 word for word so the two can be diffed, and the phrases in it that would otherwise fail are all carried, not authored — each flagged inside the draft. Two of these documents now carry a **dated appendix authored here** (the PID's, founder-authorised 2026-09-13; TECH-ARCH's, architect-authored the same day). Those appendices are held to the gate like anything else — write them clean, whatever the exclusion allows. |
| `EXTRACTION-REPORT.md`, `TRANSITION-REPORT.md` | Both have to name the old product and the components that were not carried in order to be useful. |
| `CONTRIBUTING.md`, `CLAUDE.md` | Both quote the forbidden list in order to forbid it. |
| `docs/phase-reports/step-vocabulary.md` | The D-B7 step report: it documents which forbidden words were amended and to what, which requires naming them. No other report gets this exclusion. |
| `Cargo.lock`, `package-lock.json`, `yarn.lock` | Dependency metadata, machine-generated. Package names like `pump`, `escape-string-regexp` and `solana-program-pack` are not ours to rename. |
| `LICENSE` | The verbatim Apache-2.0 text ("Licensed under…"). Legal boilerplate nobody here authored; software licensing, not a gaming-licence claim. |
| `handoff/` | The founder's own working folder, untracked by design. |
| `check-language.sh` itself | It holds the pattern, so it necessarily contains every forbidden word. |
| `node_modules/`, `target/`, `.next/`, `.git/`, `*.so`, `*.png`, `*.tsbuildinfo`, `lifecycle-logs.json` | Not repository content, or not text: compiled artifacts, images, build caches and generated logs. |

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

### Branch names

A branch name says what the work is, not who or what typed it. **`<prefix>/<subject>`**, lower case,
hyphenated, and a date on anything dated:

| Prefix | For |
|---|---|
| `step/` | a build step from the roadmap |
| `fix/` | a defect |
| `docs/` | documentation only |
| `review/` | an audit or a review — date it, e.g. `review/compliance-2026-09-16` |
| `revert/` | a revert |
| `ops/` | deploy, CI and infrastructure |

Two rules matter more than the prefix, because they are what actually keeps the list readable:

- **Rename a machine-generated branch before you open its PR.** An agent session opens on a name
  like `claude/jolly-ramanujan-wgxffx`, which says nothing. Push to the real name first, confirm the
  new ref matches, then delete the old one — in that order, and while no PR points at it yet, because
  a rename is create-then-delete and there is no rename that keeps a PR's thread.
- **Delete the branch when its PR merges.** GitHub can do this for you: Settings → General →
  *Automatically delete head branches*. Turning that on is the single highest-value thing available
  here, because it makes the cleanup continuous instead of occasional.

Left alone, this drifts fast: on 2026-09-16 the repository carried 28 branches under three competing
conventions, 21 of them fully merged and simply never removed.

**The one-time catch-up is `scripts/prune-merged-branches.sh`.** With no argument it prints a
verdict for every branch and changes nothing:

```sh
scripts/prune-merged-branches.sh            # dry run — deletes nothing
scripts/prune-merged-branches.sh --delete   # remove the ones it called MERGED
```

It deletes a branch only on positive proof that its **current tip** is in `main`: the tip is an
ancestor of `main`, or `git cherry` finds every one of its patches already applied there. A branch
name appearing in an old merge commit is **not** proof and is not a test — branches here are
routinely merged, removed, and later recreated under the same name, and the first version of this
script marked a live branch deletable for exactly that reason. `--self-test` builds that case and
asserts the branch is kept, so the mistake cannot come back quietly. Run it on a full clone; it
refuses a shallow one, where ancestry is not knowable.

Agent sessions cannot run the `--delete` half: their token creates refs but is refused `403` on
deleting them. Someone with normal repository rights has to run it.

## CI

`ci-fast` runs on every pull request and every push to the default branch. Six jobs: `rust`,
`node`, `postgres`, `journey`, `gitleaks`, and `standing-rules` (the checks tabled above).
`postgres` needs a scratch database and **fails the lane if any case came back pending** rather
than passing them by; `journey` drives the browser against a fixture build.

**If the default branch goes red, fixing it outranks new work.** The `stop-the-line` workflow files
an issue assigned to the merging author automatically and closes it when the lane next runs green —
nobody transcribes anything by hand. That issue is the one alarm in this repository that always
demands action.
