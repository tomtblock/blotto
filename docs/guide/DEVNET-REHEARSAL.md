# Devnet rehearsal — offline suite, deploy sequence and admin CLI

This guide covers three things: the **offline rehearsal** that runs in CI on every change, the
**devnet sequence**, which deploys the program, initialises it with the admin CLI and brings up the
services, and the **admin CLI worked examples** (`scripts/admin.ts`).

**Status: the credentialed devnet run has happened.** Six scored tests and a shakedown ran on
devnet from 2026-09-16 to 2026-09-22. Results, method and findings:
[`../testing/TESTING-REPORT.md`](../testing/TESTING-REPORT.md). The trial tooling and raw evidence
are in [`battle-test/`](../../battle-test/).

Devnet only. Program id `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`. For running a deployment
day to day, see [`OPERATING-MANUAL.md`](OPERATING-MANUAL.md); for hosting the services, see
[`HOSTING.md`](HOSTING.md).

## 1. The offline rehearsal (CI, no cluster)

`tests/rehearsal/` runs the same orchestrator, crank and detection code as a deployment, against a
simulated chain (`FakeChain`) instead of devnet. It runs in the `ci-fast` → node job on every
change:

```bash
cd tests/rehearsal && npm ci && npm run typecheck && npm test
```

It asserts that:

- **twenty 64-entrant pools** settle cleanly, with the pot conserved to the lamport in each;
- a pool at **exactly the minimum field** settles to `Paid`, with the pot conserved;
- **detection** runs and reports, and blocks nobody (shadow mode, D-E9);
- a pool **one seat under the minimum field** refunds every entry in full.

The same package produces the strategy studies (`npm run skill-evidence`, with
`SKILL_EVIDENCE_MODE=hard` for the hard board). The nightly `skill-evidence` workflow re-runs them
and diffs the output against `docs/skill-evidence/`.

The orchestrator does not take a real chain. On devnet the settlement work is done by the daemon
over `Web3Chain` (step 3 below).

## 2. Prerequisites for a devnet run

| Item | Purpose |
|---|---|
| An admin authority (a local keypair for a rehearsal, or a Squads multisig vault) | Signs every admin instruction |
| Custody for the service keys: entry signer, settlement signer, pool-secret policy | Signs entry packets and settlement; releases each pool secret only after the pool closes |
| A funded devnet fee payer (deploy rent plus fees) | Pays for the deploy |
| A funded upload wallet for the results archive | Publishes each pool's results bundle |
| A dedicated devnet RPC endpoint | The public endpoint throttles a 64-seat fill (measured in the trial) |
| A deployed app | The browser entry path |

## 3. Sequence

### Step 1 — Deploy the program

`scripts/deploy-devnet.sh` builds, deploys, applies any pending database migrations, and re-derives
the derived tables:

```bash
BLOTTO_PROGRAM_KEYPAIR=<path-to-program-keypair.json> \
BLOTTO_DEPLOY_KEYPAIR=<path-to-deploy-keypair.json> \
BLOTTO_DATABASE_URL=postgres://... \
./scripts/deploy-devnet.sh
```

The script refuses a program keypair whose pubkey differs from the program's `declare_id`. It
applies every pending migration in filename order: a clean database gets all of them, an upgraded
one gets exactly the new files. It then re-derives the derived tables from the events ledger. Once
the deploy is done, transfer the upgrade authority to the admin multisig and check that
`solana program show` reports it.

### Step 2 — Initialise with the admin CLI

Every admin call runs through `scripts/admin.ts`, in one of two ways:

- **direct-signed** (a rehearsal where the admin is a local keypair): set `FEE_PAYER_KEYPAIR` and
  run the command;
- **`--emit-proposal --admin <squads-vault>`** (a multisig admin): prints the instruction's
  accounts and base64 data **without signing**, ready to paste into a Squads proposal. The CLI
  cannot sign for a multisig, by design.

Amounts are integer lamports, or an exact decimal SOL string such as `6.4sol`. Both are parsed in
bigint, never as a float. The CLI has no defaults for values the operator sets: tier economics,
ceilings, the treasury floor and which tiers are open.

```bash
export FEE_PAYER_KEYPAIR=<path-to-devnet-admin.json>
A="npx ts-node --transpile-only scripts/admin.ts"

# Sanity read at any point (no keypair needed)
$A status
$A pools                     # every pool's state and mode

# One-time setup, signed by the program's UPGRADE AUTHORITY (the program
# refuses any other signer); --config-admin names the key that becomes admin.
# --ceilings is each tier's gross-intake ceiling (D2); the example is
# entry × 64 for the seven tiers.
$A init-config \
  --config-admin      <admin-pubkey> \
  --entry-signer      <entry-signer-pubkey> \
  --settlement-signer <settlement-signer-pubkey> \
  --keeper            <keeper-pubkey> \
  --ceilings 6.4sol,32sol,48sol,64sol,160sol,320sol,480sol \
  --min-platform <lamports>

# Pots are pre-funded from the treasury (D-A1), so fund it before any tier
# can open. Permissionless: any wallet may deposit.
$A fund-platform-wallet --amount 6sol

# Open tier 0 of the easy ladder. Refuses a tier whose on-chain price or
# pot disagrees with the ratified table, and more than one new tier per call.
$A set-open-tiers --tiers 1,0,0,0,0,0,0 --dry-run
$A set-open-tiers --tiers 1,0,0,0,0,0,0

# Hard mode (700 points anywhere across the 35 cells) has its own ladder
# and its own switch, set_hard_open_tiers. On a Config created before hard
# mode existed, grow the account first with the one-shot migration.
$A migrate-config
$A migrate-pool --all        # grow every older pool to the current layout
$A set-open-tiers --mode hard --tiers 1,0,0,0,0,0,0

# Fill deadline for newly opened pools, and the per-tier cooldown (seconds)
$A set-pool-timing --fill-deadline 43200 --cooldown <seconds>

# Rotate a service signer later (a settlement rotation carries the keeper
# with it unless --keep-keeper is given)
$A register-signers --settlement-signer <new-pubkey>

# The kill switch: blocks register only; reveal, payout and refund keep working
$A set-paused --paused true
$A set-paused --paused false

# The one treasury exit, refused on chain below the treasury floor
$A withdraw-platform --amount 1sol --destination <operator-wallet>

# The same call as a multisig proposal instead of a direct signature
$A set-open-tiers --tiers 1,0,0,0,0,0,0 --emit-proposal --admin <squads-vault>
```

The fill deadline shown (43200 s, 12 hours) is the ratified value (D-E6). Every other number above
is illustrative; the operator sets the real values.

**Permissionless fallbacks**, for when the daemon is down. The program checks state and deadline,
so a mistimed call is refused:

```bash
$A seal-at-deadline --pool-id <id>          # a pool at or above its floor, past its deadline
$A trigger-refund   --pool-id <id>          # a pool below its floor, past its deadline:
                                            # the untouched pot returns to the treasury
$A refund --pool-id <id> --player <pubkey>  # repay one entry in full from the treasury;
                                            # once per entrant
```

Run `npx ts-node --transpile-only scripts/admin.ts` with no arguments for the full command list,
including `set-vault-ceiling`, `set-kyc-threshold`, `set-detection-hard-block`,
`set-tier-economics`, `set-treasury-policy`, `set-keeper`, `forfeit-escrow` and
`lift-sanctions-hold`.

### Step 3 — Start the services

- **Indexer**: `npm --prefix backend/indexer run sync` migrates, runs one backfill, then serves the
  webhook. Point a raw-transaction webhook at `https://<indexer-host>/`, filtered to the program
  address, with the shared secret (`BLOTTO_HELIUS_WEBHOOK_SECRET`) as the Authorization header.
  Deliveries are idempotent (keyed on `(signature, event_index)`), so retries and overlapping
  backfills are safe. If a gap is suspected, run `npm --prefix backend/indexer run backfill`.
- **Entry service**: `@blotto/packet` `serveEntryApi`, with the custody-backed packet signer.
- **Daemon**: `@blotto/reveal` `makeDaemon` over `Web3Chain`, with custody, the results publisher
  and the randomness coordinator. It settles sealed pools and keeps one open pool per open tier.
- **Review service**: `@blotto/detection` `serveReviewApi`, with `config/reviewers.json`.
- **App**: `NEXT_PUBLIC_INDEXER_URL`, `NEXT_PUBLIC_ENTRY_API_URL`, `NEXT_PUBLIC_REVIEW_API_URL`,
  `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_SOLANA_RPC_URL`.

[`HOSTING.md`](HOSTING.md) covers environment variables and deployment for each service.

### Step 4 — Fill pools

Headless entrants and at least one browser entrant, entering by hand through the deployed app. The
devnet trial's headless tooling is in [`battle-test/`](../../battle-test/). There is no
automated spec for a credentialed browser entry. The credential-free half of the journey (landing,
pool page, the entry gate's fail-closed panel, the verify page, at 375 px and 1280 px) is
automated in `app/e2e/journey.spec.ts` and runs in `ci-fast` → journey.

### Step 5 — Failure paths

- **Under the floor**: let a pool reach its deadline below its `min_seats`. `trigger_refund`
  returns the untouched pot to the treasury, and `refund` repays every entry in full from the
  treasury. A pool at or above the floor seals and plays instead (`seal_at_deadline`), and the
  program refuses the refund. The floor is the pool's own `min_seats`: 40 since R7-b, and 52 on
  pools that predate that change.
- **Pause**: `set-paused --paused true` mid-fill makes `register` revert; unpausing resumes the
  fill.
- **Custody refusal**: if the pool secret cannot be exported for a pool past its deadline, the
  crank records `export-refused` and the refund path runs.

### Step 6 — Verify and measure

Check each settled pool on the public verify page and recompute its results root from the
published bundle. Record the fill time with all 64 entrants, the time from seal to payout, the
compute units used by `register`, and conservation for the treasury and each vault.

## 4. Results

Measured results from the devnet trial are in
[`../testing/TESTING-REPORT.md`](../testing/TESTING-REPORT.md) §4. It covers refund at 12 and 39
seats, full pools, oversubscription with nine late entrants, nine seconds from seal to payout on
the shakedown pool, and conservation to the lamport. §8 lists what has not been run: the pause path
on a live pool, same-device review, the independent verify-page recompute, and hard mode on
devnet.
