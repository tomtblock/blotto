# Launching the Ladder on devnet — the one-time runbook (D-E19)

**What this does.** Takes devnet from one 64-player pool type per mode (winner takes all) to the
eight 0.1 SOL pool types of the Ladder — easy and hard × 8, 16, 32 and 64 players — with the site
open to everyone. Written 2026-11-05 for the branch that carries the Ladder. The general
procedures it uses live in [`OPERATING-MANUAL.md`](OPERATING-MANUAL.md); this page is only the
order and the values for this one launch. It touches **devnet only**. No real money is involved,
and none of this is the mainnet launch (see [ROADMAP §3](../ROADMAP.md#3-road-to-mainnet)).

**Who does it.** One person, about 45 minutes, with these to hand:

| What | Why | Public key |
|---|---|---|
| The program keypair | `deploy-devnet.sh` checks it against `declare_id!` | `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` |
| The upgrade-authority keypair | Uploads the new program (devnet's authority is a single key) | `GXKXLYHBWBAhp7LWNMEZbsuwGb3WHeoDBsmhfndwagXY` |
| The Squads v3 member keypair | Signs every admin step through `scripts/squads-v3.ts` (the v3 web interface is retired) | `4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1` |
| Any funded devnet keypair | Pays for the permissionless steps and the treasury deposit | — |
| GitHub and Fly access | The backend deploy workflow and the daemon's machine count | — |
| Vercel access | The production environment variables | — |

Devnet constants used below: multisig `9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN`, vault (the
admin) `9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z`, daemon app `blotto-daemon`.

Every command is one line, names its key, and is run from the repository root on the merged
commit, after `npm run setup && yarn install` ([OPERATING-MANUAL §2](OPERATING-MANUAL.md#2-standing-rules)).

---

## 0. Before the window

1. **Merge-ready.** CI is green on the PR — `ci-fast`, `on-chain` (the LiteSVM suite and
   the vault model) and the journey. Do not merge yet.
2. **Read the chain.** `npm run admin -- status` should say Config is the pre-Ladder layout (603
   bytes). `npm run admin -- pools` lists the two empty Open pools the old daemon opened, #182
   (easy) and #183 (hard), deadline 2026-11-06 03:09 UTC.
3. **Stop the daemon now**, so it opens no further old-style pool and does not run old code
   against the new program later:

```bash
fly scale count 0 -a blotto-daemon
```

## 1. Close the last old pools — choose one

- **(a) Clean.** Wait until 03:09 UTC, then close both (they have no entrants, so each goes
  straight to Closed and returns its 4 SOL to the treasury):

```bash
FEE_PAYER_KEYPAIR=<funded keypair> npm run admin -- trigger-refund --pool-id 182
```

```bash
FEE_PAYER_KEYPAIR=<funded keypair> npm run admin -- trigger-refund --pool-id 183
```

- **(b) Now — chosen 2026-11-05.** Skip this step. #182 and #183 stay Open until 03:09 UTC as
  64-player pools paying one place under the rules they opened with, beside the new pools. At
  their deadline the new daemon closes them through the 64-player pool types that step 4 creates,
  without touching the new 64-player pools' slots (LiteSVM:
  `a_pre_ladder_open_pool_closes_beside_a_new_pool_of_its_type`), and their 8 SOL returns to the
  treasury then. They do not appear in the lobby (which lists pool types), only in the Pools tab.
  Step 3's funding must cover the 8 SOL that stays in their vaults until then.

## 2. Merge, then upgrade the program

1. **Merge the PR to `main`.** Vercel starts building the new site; until step 6 lands
   the new backend, the lobby may say live data is unavailable. Keep the next steps moving.
2. **Upgrade the program** (it extends the program-data account by about 55,600 bytes itself):

```bash
BLOTTO_PROGRAM_KEYPAIR=<program keypair> BLOTTO_DEPLOY_KEYPAIR=<upgrade-authority keypair> ./scripts/deploy-devnet.sh
```

3. **Migrate Config immediately** — until this runs, every instruction that reads Config fails
   ([OPERATING-MANUAL §4](OPERATING-MANUAL.md#4-program-upgrades-and-account-migrations)):

```bash
npm run -s admin -- migrate-config --emit-proposal --admin 9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z > mc.json
```

```bash
npm run -s squads -- run --multisig 9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN --ix-file mc.json --dry-run
```

```bash
MEMBER_KEYPAIR=<member keypair path> npm run -s squads -- run --multisig 9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN --ix-file mc.json
```

4. **Migrate every pool** (permissionless; run it twice — the second run must report 0 migrated):

```bash
FEE_PAYER_KEYPAIR=<funded keypair> npm run admin -- migrate-pool --all
```

## 3. Fund the treasury

The eight pool types need **15.50520192 SOL** in the treasury before the first pool can open
(15 SOL of prize pools, eight rent cushions at today's 650,240 lamports, the 0.5 SOL minimum).
On 2026-11-05 at 20:15 UTC it held 7.486208 SOL. Add headroom — every cooldown re-reserves a
prize pool. After 1(b), which leaves #182 and #183 holding their 8 SOL until 03:09 UTC:

```bash
FEE_PAYER_KEYPAIR=<funded keypair> npm run admin -- fund-platform-wallet --amount 13sol
```

After 1(a), which returns that 8 SOL first, `--amount 5sol` gives the same balance, about 20.49 SOL.

## 4. Create, configure and enable the eight pool types

```bash
npm run -s admin -- ladder-launch --tier 0 --modes easy,hard --capacities 8,16,32,64
```

Read the plan: eight groups, each `init_pool_type` → `set_pool_type_economics` (the launch table
at 0.1 SOL: prize pools 0.5 / 1 / 2 / 4 SOL) → `set_pool_type_enabled`. Then:

```bash
npm run -s admin -- ladder-launch --tier 0 --modes easy,hard --capacities 8,16,32,64 --emit-proposal --admin 9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z > ladder.json
```

```bash
npm run -s squads -- run --multisig 9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN --ix-file ladder.json --dry-run
```

```bash
MEMBER_KEYPAIR=<member keypair path> npm run -s squads -- run --multisig 9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN --ix-file ladder.json
```

If a run stops after approval, finish it with `npm run -s squads -- execute --multisig
9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN --index <n>` (the index is printed). Re-running
`ladder-launch` afterwards must plan nothing.

## 5. Confirm the chain before any service runs

```bash
npm run admin -- status
```

Expect: Config 605 bytes; eight pool types, each enabled with economics "launch"; enabled pool
types 8; tier 0 open on both ladders; the treasury above 15.5052 SOL.

```bash
npm run check-deployed
```

Expect every row green (Config 605, Pool 869, PoolType 57, the new instructions present).

## 6. Deploy the backend and the watcher

1. **Actions → deploy-backend → Run workflow**, on `main` ([HOSTING](HOSTING.md)). The indexer
   applies migration 0026 and rebuilds its derived tables before it serves.
2. **Bring the daemon back** if the deploy left it at zero:

```bash
fly scale count 1 -a blotto-daemon
```

3. **Actions → deploy-watch → Run workflow**, on `main` — the watcher reads the new layouts.
4. **Location budget.** Eight pools can seat up to 240 players a round; size the packet service's
   `GEO_DAILY_CAP` for that (its default reserve covers one round only at a cap of 960 or more).

## 7. Watch the eight pools open

The daemon opens one pool per type, bounded per tick, about a minute for all eight. Check:

- `npm run admin -- pools` — eight new Open pools, one per (mode, size), each with its capacity
  (after 1(b), #182 and #183 are listed too, Open until 03:09 UTC and Closed after);
- `GET https://blotto-indexer.fly.dev/pool-types` — eight rows with `"live": true` and
  `"source": "chain"`;
- the site: the lobby's 8 · 16 · 32 · 64 toggle on both Easy and Hard, each card showing its
  players, prizes and first prize in SOL, and the test-network line at the top of every page.

If a type does not open, `status` shows why (cooldown, treasury, disabled); see
[OPERATING-MANUAL §7](OPERATING-MANUAL.md#the-treasury-will-not-fund-a-pot).

## 8. Site settings in Vercel (production)

- **Delete** `GATE_CODE` and `GATE_COOKIE_SECRET` (production, preview and development). Nothing
  reads them any more.
- **Check** `NEXT_PUBLIC_TOPUP_ENABLED`: it must not be `1` on a test-network site
  ([HOSTING](HOSTING.md) lists it among the variables that stay unset where people can reach the
  site). Delete it if it is set.
- `NEXT_PUBLIC_ALLOW_TEST_SIGNER` and `NEXT_PUBLIC_FIXTURE_DATA` were checked on 2026-11-05 and are
  not set in production. Keep it that way.
- Redeploy production after changing a variable. Then confirm on `https://www.blotto.gg/`:
  no code page, the response header `X-Robots-Tag: noindex, nofollow`, and `/gate` answering 404.

## 9. A first round, end to end

Enter the **8-player easy pool** with five or more test wallets (its minimum field is 5), let it
fill or reach its deadline, and follow it to Paid: two places paid, 0.3 SOL and 0.2 SOL, and the
verify page recomputing it from the published bundle. Every wallet is asked to accept terms
version 6 once.

## Going back

Before step 2.3 a revert is a redeploy of the previous program. After the migrations it is not:
grown accounts cannot shrink. To stop new Ladder pools without touching any pool already taking
entries, switch the pool types off (`set-pool-type-enabled --enabled false`, through the
multisig); to stop entries everywhere at once, `set-paused --paused true`
([OPERATING-MANUAL §5](OPERATING-MANUAL.md#5-opening-and-closing-a-tier)).
