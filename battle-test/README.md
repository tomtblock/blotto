# battle-test — the devnet trial

This folder holds the tooling and raw evidence from the devnet trial of Blotto Cup. Real pools were
filled with real transactions from headless wallets and two browser wallets. Each test's outcome was
predicted and frozen before the pool filled, then checked against the chain.

- **Consolidated report:** [`docs/testing/TESTING-REPORT.md`](../docs/testing/TESTING-REPORT.md)
- **Scoreboard:** [`RESULTS.md`](RESULTS.md)
- **Findings and open items:** [`REPORT.md`](REPORT.md)

Everything here targets **devnet** (program `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`). The
folder imports `backend/scoring`, `backend/sealing`, `backend/packet` and `tests/rehearsal` by
relative path as read-only libraries, and changes nothing outside itself.

## Layout

| Path | Contents |
|---|---|
| `registry/wallets.json` | Roster: wallet ids (`W00`–`W71`, `UI-A`, `UI-B`) to addresses. No key material |
| `registry/<test>.plan.json` | The frozen prediction for a test. Never edited after it is merged |
| `registry/<test>.freeze.json` | The plan's PR merge timestamp and sha256, binding the freeze |
| `registry/<test>.actual.json` | The harvested outcome, with the source of each field |
| `registry/<test>.reconcile.md` | Seat-by-seat diff, prediction against outcome |
| `registry/<test>.allocations.md` | Each seat's allocations beside the chain's commitment |
| `registry/T6.deviation.json`, `T6.verdict.md` | T6's pre-fill addendum, and the verdict judged against it |
| `registry/pool-22.*` | The pool 22 shakedown (an observation, not a test) |
| `evidence/` | Pool snapshots, balance snapshots, entry logs and T6's late-attempt capture, one folder per pool |
| `scripts/` | The tooling (below) |
| `src/populations.ts` | Seeded allocation generators (capped field, wall, pole and others) |
| `ci-fixtures/broken.plan.json` | A deliberately invalid plan that CI must reject |

## Running the tooling

Requires Node 20+. Install once:

```bash
cd battle-test
npm ci
```

Every script runs through `ts-node`. The shorthand below keeps the commands readable:

```bash
TSN="npx ts-node --transpile-only --compiler-options {\"module\":\"commonjs\",\"moduleResolution\":\"node\"}"
```

`keys`, `registry`, `fan-out` and `enter` also have `npm run` aliases (see `package.json`).

### Environment

| Variable | Used by | Meaning |
|---|---|---|
| `BLOTTO_BT_SEED` | `keys`, `registry`, `harvest`, `late-attempt`, `snapshot` | 32-byte hex master seed. Every test key derives from it. Never commit it |
| `BLOTTO_RPC_URL` (or `RPC_URL`) | everything that touches the chain | Devnet RPC. Use a dedicated endpoint: the public one throttles a fill |
| `BLOTTO_INDEXER_URL`, `BLOTTO_PACKET_URL` | `enter`, `harvest`, `preflight`, `late-attempt` | The indexer and entry-service base URLs, e.g. `https://<indexer-host>` |
| `FEE_PAYER_KEYPAIR` | `fan-out` | Path to the funding keypair |

Keys are written to `keys/`, which is gitignored. CI also refuses any tracked key material in this
folder.

### The loop, per test

```bash
# 0. Keys and roster (once per session)
$TSN scripts/keys.ts derive                  # writes keys/ from BLOTTO_BT_SEED
$TSN scripts/registry.ts                     # writes registry/wallets.json (addresses only)

# 1. Predict with the product's own scoring engine. The oracle checks it
#    against the Python vectors first
$TSN scripts/oracle.ts --check-only
$TSN scripts/oracle.ts --test T4 --emit <path>
$TSN scripts/validate-plan.ts registry/T4.plan.json
#    Then merge the plan in a PR and record the merge in registry/T4.freeze.json

# 2. Fund, check the gate, snapshot, enter
$TSN scripts/fan-out.ts status
$TSN scripts/fan-out.ts fund --target 0.2sol
$TSN scripts/preflight.ts --pool <id> --wallets UI-A,UI-B   # exit 0 = go
$TSN scripts/snapshot.ts --label before --test T4 --pool <id>
$TSN scripts/enter.ts --test T4 --pool <id> --wallets W00-W61 --concurrency 1

# 3. After settlement: harvest, reconcile, render allocations
$TSN scripts/snapshot.ts --label after --test T4 --pool <id>
$TSN scripts/harvest.ts --test T4 --pool <id>
$TSN scripts/reconcile.ts --test T4
$TSN scripts/allocations.ts --test T4

# 4. Return the SOL
$TSN scripts/fan-out.ts sweep
```

| Script | What it does |
|---|---|
| `keys.ts` | Derives the funder and 72 headless keypairs from the master seed (HMAC-SHA256 per label) |
| `registry.ts` | Builds `wallets.json`; adds browser wallets with `--ui UI-A:<address>` |
| `oracle.ts` | Computes a test's prediction with `backend/scoring`, after checking the engine against the committed Python vectors |
| `validate-plan.ts` | Checks a plan: every allocation is five integers summing to 100, no duplicate seven-battle sets, internal consistency |
| `fan-out.ts` | Tops wallets up to a target and sweeps them back. Idempotent over balances; amounts parsed in bigint |
| `preflight.ts` | Go/no-go before anyone plays: the pool is ready, the named wallets are not already seated, and the entry gate issues a packet for each |
| `enter.ts` | The headless entrant. Same path as the app: seal, store the ciphertext, signed packet, `register` |
| `snapshot.ts` | Balance snapshots of wallets, treasury and prize vault, for the conservation arithmetic |
| `harvest.ts` | Writes `<test>.actual.json`. Fails rather than write a partial file |
| `reconcile.ts` | Diffs plan against actual, checks the freeze (hash and merge-before-first-entry), recomputes the results root |
| `allocations.ts` | Renders each seat's allocations beside its on-chain commitment (`PENDING` / `COMMITTED` / `VERIFIED`) |
| `late-attempt.ts` | Drives entries into an already-sealed pool and records each refusal and its cost |
| `shakedown-field.ts` | Generates the pool 22 field. A field file, not a plan: it makes no predictions |
| `t3-bounds.ts` | Re-derives T3's unconditional claims and exits non-zero if any stops holding |

The generators have their own test: `$TSN src/populations.test.ts`.

## CI

`.github/workflows/rehearsal.yml` runs on changes to this folder:

- **boundary** — a PR that touches `battle-test/` must not change anything else, and no key
  material may be tracked;
- **plans** — every `registry/*.plan.json` validates, and `ci-fixtures/broken.plan.json` must be
  rejected;
- **results** — if `RESULTS.md` contains a failing or unfrozen verdict token, `REPORT.md` §9 must
  carry the matching open item.
