# Step report — CI on-chain lane, webhook config, deploy script (`step/c12-ci-deploy`, C12)

**Status: delivered.** Item C12 of the 2026-08-27 master build prompt (D-C).

**Stacks on C11** (`step/c11-adapters`).

## What was built

- **`.github/workflows/on-chain.yml`** — the cached-toolchain lane:
  `anchor build` of the real SBF artifact, then the LiteSVM suite driving
  it (`tests/litesvm`, which lives OUTSIDE the cargo workspace and was
  therefore never covered by ci-fast's `cargo test --workspace`). Pinned
  solana-cli 3.1.10 / anchor-cli 1.0.2 — the versions this branch is
  developed against — with the Solana release, the anchor binary and both
  cargo build trees cached by version/lockfile keys. Runs only when
  on-chain code changes (paths filter) plus `workflow_dispatch`;
  superseded runs cancel. Knowledge-currency note in the file: if the
  Solana skill recommends a different Anchor install channel at execution
  time, the skill wins — the PIN matters, not the channel.
- **`scripts/deploy-devnet.sh`** — build → deploy → migrate → re-derive
  in one script. Refuses a program keypair whose pubkey differs from the
  program's `declare_id` (deploying under a different id would strand
  every client); applies every PENDING migration via the forward-only
  runner — the prompt named 0004+0005, and the runner's contract is
  strictly more correct: a clean database gets all migrations, an
  upgraded one gets exactly the new files, 0006 (C10's review log)
  included; then `re-derive` rebuilds the derived tables from the ledger.
  Skips the database steps with a loud warning when `BLOTTO_DATABASE_URL`
  is unset.
- **`indexer sync`** — the deployment entry the webhook/backfill split
  needed: migrate, then one BACKFILL (the fallback that catches anything
  missed while the process was down), then serve the webhook. The webhook
  provider setup (Helius or equivalent: raw-transaction webhook at the
  indexer's port, program-address filter, shared secret as the
  Authorization header) and the on-gap manual backfill are documented in
  `docs/devnet-rehearsal.md`, which now also lists every service's C8–C11
  wiring and env.
- **Fixed en route:** `DEFAULT_PROGRAM_ID` in the indexer config had
  drifted from the program's actual `declare_id`
  (`5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`) — a stale Phase 2
  value that would have pointed an unconfigured indexer at a nonexistent
  program.

## Judgement calls

1. **A separate workflow, not a ci-fast job.** The artifact build is
   minutes even warm and irrelevant to most PRs; a paths-filtered lane
   keeps ci-fast's four checks fast on every PR while on-chain changes
   get the full artifact + LiteSVM treatment.
2. **`cargo install anchor-cli@1.0.2 --locked` as the install channel**,
   cached by version so the compile cost is paid once per version bump.
   Flagged as shaky-confidence per CLAUDE.md's knowledge-currency rule,
   with the skill named the tiebreaker in the workflow comment.

## Tests

Indexer 28 mocha green after the `sync`/config changes; the deploy script
is `bash -n` checked and exercised end-to-end only by the credentialed
rehearsal (it needs the program keypair and a database); workflow YAML
parse-checked. The on-chain lane validates itself on this PR — it touches
`.github/workflows/on-chain.yml`, so the lane runs here.

## For the founder

Nothing new to provision beyond C11's list. When the rehearsal runs:
one command deploys and migrates (`scripts/deploy-devnet.sh`), one
command brings the indexer up with catch-up built in
(`npm --prefix backend/indexer run sync`).
