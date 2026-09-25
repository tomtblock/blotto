# The Phase B window — the founder's runbook

**What this covers:** the one drain window that puts the hard-mode pool live on devnet: the program
upgrade (`Pool.mode`, the hard ladder on `Config`), the two one-off migrations, the backend
redeploy, and the two Squads proposals — one to grow `Config`, one to switch the hard ladder on.
**Everything in it happens on a date you set, after the easy test pool (pool 29) has resolved.
Nothing in this runbook has been run.** The plan it executes is
`CHANGE-2026-09-24_battle-board.md` §11–§13 (the three merged changes); the decision is register
row D-E17.

**Who does what.** Every step is yours to run; the architect prepared the commands and the two
proposal payloads and cannot sign anything. The upgrade authority on devnet is still the single
deploy key (`config/custody.json`: `GXKX…agXY`), so the program upgrade is one script. The admin is
the Squads vault (`9EEW…e34Z`, multisig `9EL1…mFyN`, 1-of-1, approved from the Bank wallet in
Phantom on devnet), so `migrate_config` and `set_hard_open_tiers` are Squads proposals.

**Time.** About forty minutes hands-on, in one sitting, once the pool has resolved. Nothing here
needs to be fast except step 4, which is the one in which existing pools cannot be touched.

---

## Why there is a window at all

Two things change shape at once:

1. **Every pool account grows by one byte** (`Pool::SPACE` 849 → 850, the mode). Until a pool is
   migrated, **every instruction touching it fails** on the short account — `register` included.
   `migrate_pool` is permissionless and self-disabling: run it once for every pool and the outage
   is minutes long.
2. **`Config` grows by 119 bytes** (484 → 603, the hard ladder). Until it is migrated, **every
   other instruction fails**, `set_paused` included — so the migration is the first thing after
   the upgrade, not a follow-up.

And the keeper's `open_pool` now sends the appended `mode` byte the upgraded program requires, so
the backend redeploys in the same window, after the program. Merging the three PRs deployed nothing
on chain or on Fly: `deploy-backend` only runs when you click it. The app (Vercel) deployed on
merge and is safe against today's backend by construction — it renders exactly what it rendered
before until the read API starts serving a mode.

---

## Before the day

- [ ] All three Phase B PRs merged to `main`: #181 (program), #182 (backend), #183 (app).
- [ ] Your laptop: the repository on `main` at the merge commit, `yarn install --frozen-lockfile`
      at the root, `anchor` 1.0.2 and `solana` 3.1.x on the path (the versions pinned in
      `.github/workflows/on-chain.yml`), `fly auth whoami` answering, Phantom connected to Squads
      on devnet with the Bank wallet.
- [ ] The two keys to hand, outside the repository: `BLOTTO_PROGRAM_KEYPAIR` (the program's own
      keypair) and `BLOTTO_DEPLOY_KEYPAIR` (`GXKX…agXY`, the upgrade authority; it also pays the
      migrations under the name `FEE_PAYER_KEYPAIR`). Top it up to at least 1 SOL first: an
      upgrade that grows the program and twenty-nine pool migrations are more fees than usual.
- [ ] The offline hard-board evidence is in `docs/skill-evidence/hard/REPORT.md` (Phase B plan,
      decision 6: the hard tier is switched on only after that run has reported). Read its
      headline table once; if anything in it changes your mind about opening the tier, stop
      before step 9 — everything before it is mode-neutral.
- [ ] Read this whole page once before starting. Step 4 is the one you do not pause in.

---

## Step 1 — Wait for the open pool to resolve, then stop the daemon

```
npm run admin -- pools
```

The window opens when **no pool is Open, Sealed, Scored or Refunding**. Pool 29 (deadline
2026-09-25 01:24:50 UTC) refunds nothing and goes straight to `Closed` if nobody entered it; if it
took entries it plays out or refunds on its own, and the daemon does that work — so do not stop the
daemon while a pool still needs it.

The moment the last pool is `Paid` or `Closed`, stop the daemon, because it opens the next pool
**300 seconds** after a tier frees:

```
fly scale count 0 -a blotto-daemon
```

Nothing can open a pool while it is down. Then confirm the drain:

```
npm run admin -- pools --upgrade-preflight
```

It must read **CLEAR**. If it names a pool, wait for that pool; do not go on.

**The calmer version.** If the open pool has **no entrants**, stop the daemon any time before its
deadline, wait for the deadline to pass, and close it yourself — `trigger-refund` is permissionless
and the program refuses a mistimed call:

```
export FEE_PAYER_KEYPAIR=/path/to/deploy-keypair.json
npm run admin -- trigger-refund --pool-id 29
```

A pool with no entrants goes straight to `Closed` and its untouched 4 SOL returns to the treasury in
the same transaction. **Check `entrants` first** — a pool holding entries below its floor goes to
`Refunding` instead and needs one `refund --player` per entrant.

**There is no pause step.** `set_paused` blocks `register`, not `open_pool`; with nothing open
there is nothing to block, and after the upgrade `set_paused` would not even run until step 4.

## Step 2 — Record the state you are changing

```
npm run admin -- status
npm run admin -- pools
```

Keep both outputs, timestamped. `status` will say `config: PRE-PHASE-B LAYOUT (484 bytes)` — that
line is the check that you are upgrading the account this runbook expects. Write down
`next pool id` (30 at the time of writing): step 7 walks every id below it.

## Step 3 — Upgrade the program

From the `main` merge commit:

```
BLOTTO_PROGRAM_KEYPAIR=/path/to/program-keypair.json \
BLOTTO_DEPLOY_KEYPAIR=/path/to/deploy-keypair.json \
  ./scripts/deploy-devnet.sh
```

It builds, extends the program account if the build grew, upgrades, and — if `BLOTTO_DATABASE_URL`
is set on your machine — applies migration `0025_pool_mode.sql` and re-derives the indexer's
tables. **You can leave `BLOTTO_DATABASE_URL` unset**: the indexer applies the migration itself at
boot in step 8 and, because 0025 carries the rederive marker, rebuilds the derived tables before it
serves. The script warns that it skipped them; that warning is expected here.

It refuses to run if the program's on-chain upgrade authority is not the key you gave it, and if
the keypair's public key is not the program id. Either refusal means stop and read the message; it
names the cause.

Confirm the new program is live:

```
npm run check-deployed
```

Expect the Config row to say **484 bytes, pre-migration layout** and everything else green,
including the new instruction `set_hard_open_tiers`. That row goes green in step 5.

## Step 4 — Grow `Config` — the first Squads proposal, immediately

**Every instruction fails until this lands**, so it is the next thing you do. The payload was
emitted on 2026-09-25 against the live 484-byte account and does not change with time; re-emit it
on the day to see the same bytes:

```
npm run admin -- migrate-config \
  --emit-proposal --admin 9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z
```

Expected output — check every line against what Squads shows you before approving:

```json
{
  "note": "signer role: admin — the Squads vault executes this",
  "programId": "5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17",
  "accounts": [
    { "pubkey": "9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z", "isSigner": true,  "isWritable": true  },
    { "pubkey": "6Q3HReRVp4fND7wCuYSpRDPbz5KsQR7cbEwApVUhPzDa", "isSigner": false, "isWritable": true  },
    { "pubkey": "11111111111111111111111111111111",             "isSigner": false, "isWritable": false }
  ],
  "dataBase64": "XIM6adKa4ME="
}
```

Eight bytes of data and nothing else: the instruction takes no argument (the 2026-09-07 keeper
argument is retired). The vault is signer **and writable** because it pays the rent top-up for the
119 new bytes; `6Q3H…` is the Config PDA; the third account is the System Program.

**In Squads (devnet, the `9EL1…mFyN` multisig, the `9EEW…e34Z` vault):** create a transaction →
custom instruction → program id `5aaw…XH17`, the three accounts in that order with those signer
and writable flags, the data as base64 → approve from the Bank wallet → execute. Three wallet
pop-ups. A second send fails cleanly (the account is already 603 bytes), so a double-execute
cannot hurt.

Verify:

```
npm run admin -- status
```

The `config:` warning line is gone and three new lines appear:

```
hard open tiers:      [0, 0, 0, 0, 0, 0, 0]
hard active pools:    [0, 0, 0, 0, 0, 0, 0]
hard tier next open:  [<now>, <now>, …]   (unix s — the migration stamps every hard tier "not before now")
```

`open tiers` still reads `[1, 0, 0, 0, 0, 0, 0]`; every other value is what step 2 recorded.

## Step 5 — Confirm the deployed program against the source

```
npm run check-deployed
```

Every row green, the Config row at **603 bytes**. If the account size is wrong, step 4 did not
execute — check Squads before doing anything else.

## Step 6 — Migrate every pool (permissionless, direct-signed)

```
export FEE_PAYER_KEYPAIR=/path/to/deploy-keypair.json
npm run admin -- migrate-pool --all
```

One transaction per pool, ids 1 to `next pool id − 1`, in order. Each prints the account's size
before and after: an 849-byte pool gains the mode byte (easy — hard did not exist when it was
opened, so that is the truth, not a default); an 847-byte pool from before R7-b gains its floor of
52 as well; a pool already at 850 bytes is reported and skipped. Re-running it is safe.

## Step 7 — Check nothing was missed

```
npm run admin -- pools
```

Every pool reads normally, each with a `mode` column saying `easy`. A pool that errors was not
migrated — run `migrate-pool --pool-id <id>` for it.

## Step 8 — Redeploy the backend

GitHub → **Actions** → **deploy-backend** → **Run workflow** on `main`, both boxes **unticked**
(the credentialed path). It deploys the indexer, the packet service, the review service and the
daemon. Watch for:

- the indexer's log: `0025_pool_mode.sql invalidated the derived tables — rebuilding before
  serving`, then serving;
- the daemon's `/health` answering, and its first tick opening **pool 30, easy, tier 0** within
  five minutes (tier 0 has been idle since step 1, and the treasury covers a 4 SOL pot with the
  0.5 SOL floor to spare — 15.6 SOL before pool 29's pot returns, 19.6 after).

If the daemon does not come back (its machine count was set to 0 in step 1 and a deploy does not
always restore it):

```
fly scale count 1 -a blotto-daemon
```

Then, from any browser:

```
curl -s https://<indexer-host>/tiers | jq '.hard_enablement_source, .tiers[0].hard'
curl -s https://<indexer-host>/pools | jq '.[0] | {id, state, mode}'
```

`hard_enablement_source` must read `"chain"` and tier 0's `hard` must read `enabled: false`; pool
30 must read `"mode": "easy"`. The landing page shows one card, exactly as before. **Do not go on
to step 9 until this is what you see** — if the read API still answers without `hard`, the old
indexer is serving and the hard card would never appear.

## Step 9 — Switch the hard ladder on — the second Squads proposal

This is the founder's call, and the one step this runbook does not make for you: it opens a
second pool at 0.1 SOL with its own 4 SOL prize (D-E17). The command refuses until step 4 has
landed, and runs the same two checks as the easy switch (the tier's on-chain price and pot must
match the ratified table; one additional tier per call):

```
npm run admin -- set-open-tiers --tiers 1,0,0,0,0,0,0 --mode hard --dry-run
npm run admin -- set-open-tiers --tiers 1,0,0,0,0,0,0 --mode hard \
  --emit-proposal --admin 9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z
```

Expected payload (derived offline from the wire contract — the command reproduces it on the day):

```json
{
  "programId": "5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17",
  "accounts": [
    { "pubkey": "9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z", "isSigner": true,  "isWritable": false },
    { "pubkey": "6Q3HReRVp4fND7wCuYSpRDPbz5KsQR7cbEwApVUhPzDa", "isSigner": false, "isWritable": true  }
  ],
  "dataBase64": "UB9Khs8AtqgBAAAAAAAA"
}
```

Fifteen bytes: the `set_hard_open_tiers` discriminator and seven flags, tier 0 on. Two accounts —
the vault as signer (not writable this time; nothing is paid), the Config PDA writable. Same Squads
flow as step 4.

Verify, in three places:

```
npm run admin -- status                         # hard open tiers: [1, 0, 0, 0, 0, 0, 0]
curl -s https://<indexer-host>/tiers | jq '.tiers[0].hard'   # enabled: true, status: "open"
```

and the landing page, which now shows **two cards**: the easy pool on the left, and on the right
either the hard pool or, until the daemon's next tick opens it, "Opens soon". Then:

```
npm run admin -- pools
```

The hard pool appears with `mode hard`, its own deadline twelve hours out, its own 4 SOL pot,
`entrants 0`. Its page says `Hard · 700 anywhere` and "How this pool plays" describes the 700 rule.
That is the last point at which a wrong number is cheap to fix — before anyone has entered.

## Step 10 — The terms version

The rules and landing copy now describe both placing rules (drafts, `PHASE-N-REVIEW`, yours and
counsel's to ratify). Bump the terms edition **once, in this window, after step 9**, so every
wallet re-attests to the terms as they now read (Phase B plan, decision 4). Edit
`config/terms.json` — on GitHub, in the browser, is fine — so it reads:

```json
{
  "version": 4,
  "updated": "<today, YYYY-MM-DD>",
  "editions": [
    { "version": 1, "updated": "2026-08-27" },
    { "version": 2, "updated": "2026-09-06" },
    { "version": 3, "updated": "2026-09-19" },
    { "version": 4, "updated": "<today, YYYY-MM-DD>" }
  ]
}
```

Open it as a PR (the file is founder-owned, so the change is yours to make and merge). The app
redeploys on merge and prompts every wallet once; the packet service reads the same file, so an
attestation to version 3 is refused at entry from the next backend deploy — run `deploy-backend`
once more after the merge, or accept that the two disagree until the next deploy (the app prompts
for 4, the packet still accepts 3; nobody is refused, nothing is unsafe).

---

## What changes for players after this

- Two pools are open at the same price: the easy board (100 points in each battle) and the hard
  board (700 points anywhere across the seven). Each has its own clock and its own 4 SOL prize;
  a player may enter both.
- Everything else is unchanged: the deadline, the field-size rule, the scoring rule (a stat by the
  larger number, a battle by three of five), the one paid place.
- The published bundle is version 3 and names the pool's mode; the verify page reads both 2 and 3.

## If something looks wrong

| What you see | What it means |
|---|---|
| `status` says `PRE-PHASE-B LAYOUT` after step 4 | The proposal did not execute. Check Squads; nothing else will run until it does. |
| `check-deployed` shows the Config row red at 603 | You are on a checkout older than the merge; fetch `main` again, check it out, and re-run. |
| `migrate-pool` reports every pool skipped | Already done — safe. |
| `/tiers` has no `hard` key | The old indexer is serving; step 8 did not deploy it. |
| `/tiers` says `hard_enablement_source: "ledger"` | The indexer cannot read the Config account; the chain is still right and `open_pool` still enforces it. |
| Hard tier on, no hard pool after ten minutes | The treasury cannot fund a second 4 SOL pot while holding the floor, or the daemon is down. `status` shows the balance; `/health` on 8084 shows the last tick. |
| The hard card says "Opens soon" for longer than a tick | Same as above — the card is the tiers API's answer, not the app's guess. |
| `set-open-tiers --mode hard` refuses on economics | Tier 0's price or pot on chain disagrees with the ratified table. It does not today; if it does on the day, `RUNBOOK_open-tier.md` step 3. |

## If you need to go back

Before step 6, a revert is a redeploy of the previous program plus one Squads proposal is **not**
enough: the 603-byte Config cannot shrink, and the old program refuses it. After step 6 the pools
are one byte long for the old program too. A rollback therefore means draining every pool to a
terminal state and redeploying a program that reads the new layouts — which is this program with
the hard ladder left switched off. In practice: leave the hard tier off (`--tiers 0,0,0,0,0,0,0
--mode hard`) and the platform runs exactly as it did, with one easy pool at a time.
