# Blotto Cup — operating manual

**Who this is for.** Whoever runs a deployment: sending an admin transaction, upgrading the
program, opening a tier, answering a review or a complaint, or working out why a pool is stuck.
It assumes you know what the product is. [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md)
describes the system; [`HOSTING.md`](HOSTING.md) covers where it runs and how the services are
deployed. This manual covers what you do to a running deployment.

**Current reality.** The only deployment is on devnet (program
`5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17`). The program has never been deployed to mainnet
and no real money has ever passed through it.

**Contents**

1. [Roles and keys](#1-roles-and-keys)
2. [Standing rules](#2-standing-rules)
3. [The admin CLI](#3-the-admin-cli)
4. [Program upgrades and account migrations](#4-program-upgrades-and-account-migrations)
5. [Opening and closing a tier](#5-opening-and-closing-a-tier)
6. [The daemon: keeper and crank](#6-the-daemon-keeper-and-crank)
7. [When something is wrong](#7-when-something-is-wrong)
8. [Review and complaints](#8-review-and-complaints)
9. [Monitoring](#9-monitoring)
10. [Bringing up a credentialed deployment](#10-bringing-up-a-credentialed-deployment)
11. [What must never be done](#11-what-must-never-be-done)

The section numbers are stable, because comments in the code cite §4 and §7. Where you can,
cite a section by its heading.

---

## 1. Roles and keys

Each key is described by its role. The current public keys are in
[`config/custody.json`](../../config/custody.json), which the site's custody page renders.

| Role | Held as | Can | Cannot |
|---|---|---|---|
| **Program upgrade authority** | A single operator deploy key on devnet. It moves to the admin multisig before mainnet | Replace the program's code | Sign any program instruction. It has no authority inside the program |
| **Admin** | A Squads multisig vault. On devnet the threshold is 1 of 1 | Every admin instruction: tiers, prices and pots, timing, pause, signer rotation, `forfeit_escrow`, `lift_sanctions_hold`, and the treasury's one gated exit (`withdraw_platform`) | Take anything from a prize vault. No admin instruction debits a vault |
| **Keeper** | On devnet, the same key as the settlement signer | `open_pool`, and nothing else. The program's gates decide whether a pool may open. The keeper has no say | Move entries or prizes |
| **Settlement signer** | A keypair delivered to the daemon and the review service as a base64 secret, decoded into memory-backed storage at boot. It pays the fees and rent for every daemon transaction. The daemon refuses to start while it holds less than 0.05 SOL | Reveal, commit results, pay prizes, flag, clear, release escrow, place a sanctions hold, pay next place | Withdraw anything, or forfeit a share. Forfeit is an admin action |
| **Entry signer** | A Turnkey Ed25519 key that cannot be exported. It never holds SOL | Sign entry packets. `register` checks this signature | Move money |
| **Sealing custody** | Turnkey. Each pool's secret is generated in the daemon, imported at `open_pool`, and locked against export by policy until the pool seals or passes its deadline | Decrypt one pool's entries, and only after that pool closes | Be read early. The export policy is the sealing mechanism |
| **Reviewer keys** | Two wallets listed in [`config/reviewers.json`](../../config/reviewers.json) | Sign review decisions and complaint answers, and read the detection and complaints queues through the app | Send any chain transaction. The review service acts with the settlement signer, and a forfeit still needs the admin |
| **Bundle upload wallet** | A funded Irys wallet held by the daemon | Pay to publish each settled pool's results bundle | Anything on the program |

**No key can move a prize vault's lamports anywhere but to a player**, apart from
`trigger_refund`, which returns an unplayed pool's untouched pot to the treasury.
`scripts/check-standing-rules.sh` asserts the exact exit set in CI:

- The prize vault's exits are `pay_prizes`, `release_escrow`, `pay_next_place` and
  `trigger_refund`.
- The treasury's exits are `refund` and the admin-gated, floor-guarded `withdraw_platform`.
- `forfeit_escrow` moves nothing.

**Known limitations before mainnet.** The upgrade authority is still a single key on devnet. The
settlement signer is a key file rather than a Turnkey co-signed key. The devnet multisig is 1 of
1 with no timelock. [`../security/SECURITY-REVIEW.md`](../security/SECURITY-REVIEW.md) tracks all
three.

## 2. Standing rules

Each rule exists because breaking it once caused a real problem.

1. **Every `solana` command names its key with `-k <keypair>`.** A CLI's default keypair is
   often the key that holds upgrade authority. A command that loses its flag still signs, with
   whatever the default is, and still reports success. `scripts/deploy-devnet.sh` also refuses
   to run while the CLI's configured default disagrees with the key it was given.
2. **Admin transactions are prepared by one person and approved by the multisig.** Run the
   command with `--emit-proposal`, check every account against the printed payload, then approve
   the proposal in Squads. Simulate before you approve.
3. **Never print, echo or log a secret.** Confirm a key by its public key or by its name, never
   by its contents. The pre-commit hook rejects any staged file that contains a 64-integer array,
   which is the shape of a Solana keypair.
4. **Commands meant to be pasted are one line.** A command split with a backslash can lose its
   flags when pasted, then run as a different command.
5. **Read before you overwrite.** Run `status` before any setter and know the value you are
   changing.
6. **A service that refuses to start for want of a credential is behaving correctly.** Never
   loosen a fail-closed check to get a deploy through.
7. **If a verification fails, stop.** Do not go on with a half-working credential behind you.
8. **Run `npm run check-deployed` before any irreversible instruction.** It compares the
   deployed program against the branch. See [Recovery notes](#recovery-notes) for why.

## 3. The admin CLI

`npm run admin -- <command> [flags]` from the repository root runs `scripts/admin.ts`. Worked
examples for every command are in [`DEVNET-REHEARSAL.md`](DEVNET-REHEARSAL.md).

**Two ways to run a command.**

- **Direct-signed.** Set `FEE_PAYER_KEYPAIR` to the signing keypair. This is for the
  permissionless commands, and for the admin commands only on a deployment whose admin is a
  local key.
- **`--emit-proposal`.** Prints the instruction (program, accounts with their signer and
  writable flags, and the data in base64) without signing or sending it. This is the normal path
  for every admin command, because the admin is a Squads vault. Pass `--admin <vault address>`
  so the payload names the vault. Nothing in this script can sign for a multisig, by design.
  Squads' custom-instruction form may ask for the data in base58 rather than base64. Convert it
  and check that the bytes match.

Money flags take integer lamports or an exact decimal ending in `sol` (for example `0.5sol`).
They are parsed as integers, and no float ever touches an amount.

| Command | Signer | What it does |
|---|---|---|
| `status` | read | Config: keys, both tier ladders, prices, pots, switches, treasury, timings. Warns if Config is on an older layout |
| `pools` | read | Every pool with its state and mode, then the **drain verdict**. It exits 1 while any pool is Sealed, Scored or Refunding. Add `--upgrade-preflight` to also refuse while any pool is Open ([§4](#4-program-upgrades-and-account-migrations)). `--self-test` runs the verdict's fixtures |
| `init-config` | becomes admin | One-time setup. There is no `set_admin`, so whoever signs this is the admin for good |
| `migrate-config` | admin | One-shot growth of Config to the current layout after an upgrade that adds fields. Self-disabling ([§4](#4-program-upgrades-and-account-migrations)) |
| `migrate-pool` | permissionless | One-shot growth of one pool (`--pool-id`) or every pool (`--all`) to the current layout. Self-disabling, and it skips pools already current |
| `set-keeper` | admin | Sets the only key `open_pool` accepts |
| `register-signers` | admin | Rotates the entry signer and the settlement signer. A settlement rotation takes the keeper with it unless you pass `--keep-keeper`, because leaving the keeper behind stops every new pool |
| `set-pool-timing` | admin | Fill deadline and cooldown for **future** pools. An open pool keeps the terms copied onto it at open |
| `set-open-tiers` | admin | Which tiers may open pools. `--mode hard` sends `set_hard_open_tiers`, the hard ladder's own switch. Guarded ([§5](#5-opening-and-closing-a-tier)) |
| `set-tier-economics` | admin | One tier's price and pot. Refuses a pot above the minimum field's intake (40 × price). A pot exactly equal to it is the launch relationship (R7-b) |
| `set-treasury-policy` | admin | The treasury floor (`--min-platform`) and the number of idle-tier pots held in reserve |
| `set-vault-ceiling` | admin | One tier's gross-intake ceiling |
| `set-paused` | admin | The kill switch. Blocks `register` and nothing else |
| `set-kyc-threshold` | admin | The KYC-at-claim switch. `0` means off, and it is off |
| `set-detection-hard-block` | admin | An on-chain switch that **nothing off-chain reads today**. Flipping it changes nothing (see [§8](#8-review-and-complaints)) |
| `forfeit-escrow` | admin | Records that review upheld a flag. **Moves no lamports** |
| `lift-sanctions-hold` | admin | Clears a sanctions hold that review found to be a false positive. **Moves no lamports**. There is no command to *place* a hold |
| `fund-platform-wallet` | anyone | Deposits into the treasury |
| `withdraw-platform` | admin | The treasury's one gated exit. It is floor-guarded on-chain and cannot reach a prize vault |
| `seal-at-deadline` | permissionless | Seals a pool that is past its deadline with its floor seated. This is the manual fallback when the daemon is down |
| `trigger-refund` | permissionless | Starts the refund of a pool that is past its deadline and below its floor. The untouched pot goes back to the treasury. A pool with no entrants goes straight to Closed. Refuses at or above the floor (`FieldReached`) |
| `refund` | permissionless | Repays one entry in full from the treasury, for a pool in Refunding. Run it once per entrant |

Three commands need extra care.

- **`set-kyc-threshold`.** One place is paid, so the winner's payout is the whole pot. Any
  threshold below the smallest pot therefore escrows **every** payout at **every** tier. The two
  release paths, the seven-day release and the next-place split, do not check a KYC packet, so revisit
  both before turning the switch on.
- **`forfeit-escrow`.** It takes a prize away from the player who won it, which is why only the
  admin can sign it. The share does not come to the operator. It stays in that pool's vault
  until `pay_next_place` divides it among the eligible players at the rank it passes to. The
  daemon runs that step itself.
- **`lift-sanctions-hold`.** This is the only way a held share ever moves again. Use it only
  when a review has established that the match was a false positive. Where a *confirmed* match's
  share finally goes is an open question. Until it is settled, the share stays in the pool's
  vault.

## 4. Program upgrades and account migrations

This is the reusable procedure for any program upgrade. It covers the common case where the
upgrade grows `Config` or `Pool`. The current layouts are Config 603 bytes and Pool 850 bytes
(`programs/blotto_cup/src/state.rs`, pinned by unit tests).

### Why an upgrade needs a window

Solana programs refuse an account shorter than the layout they expect. From the moment a
layout-changing upgrade lands until its migration runs:

- **If Config grew**, every instruction that reads Config fails, including `set_paused`. The
  migration is therefore the first thing you do after the upgrade, not a follow-up.
- **If Pool grew**, every instruction that touches an unmigrated pool fails, including
  `register` and the payment instructions that run on already-paid pools (`release_escrow`,
  `pay_next_place`).

An open pool keeps the terms it opened under. Its pot, deadline and floor were copied onto the
`Pool` account at open, and no upgrade or config change reaches them.

### Step 1 — Drain

```
npm run admin -- pools
```

The drain verdict must read **CLEAR**: no pool Sealed, Scored or Refunding. A pool caught
mid-settlement by an upgrade is the one case that can strand money, because the engine that
settles a pool enforces its prize rule.

**When an Open pool also matters.** Use the stricter check when the upgrade changes a rule that
each pool stores for itself but that the site reads from a shared constant. The only such rule
today is the minimum field (`min_seats`): the read API serves `MIN_SEATS`, not each pool's own
value.

```
npm run admin -- pools --upgrade-preflight
```

This also refuses while any pool is Open. A pool left open across that kind of upgrade keeps its
old floor while the site shows the new one. The site could then tell players a pool will play
when the chain is going to refund it. For an upgrade that only changes layout, an Open pool with
**no entrants** does not block the window: `migrate_pool` has no state precondition, and an
empty pool has no seated floor to disagree about.

**Stop the daemon once the last pool is terminal.** It opens the next pool one cooldown (5
minutes by default) after a tier frees, and it holds the keeper key. Stopping it is what
actually prevents a new pool. Do not rely on pausing for this. The daemon skips opening while
the deployment is paused, but the program does not block `open_pool` on pause. After an upgrade
that grows Config, `set_paused` cannot run at all until the migration lands.

```
fly scale count 0 -a <daemon-app>
```

**The calmer route when the open pool has no entrants.** Stop the daemon any time before the
pool's deadline. Wait for the deadline to pass, then close the pool yourself:

```
npm run admin -- trigger-refund --pool-id <id>
```

A pool with no entrants goes straight to Closed in that one transaction, and its untouched pot
returns to the treasury. **Check `entrants` first.** A pool holding entries below its floor goes
to Refunding instead and needs one `refund` per entrant, and Refunding blocks the drain.

### Step 2 — Record what you are changing

Run `status` and `pools` and keep both outputs. `status` names an older Config layout if there is
one, which confirms you are upgrading the account you expect. Note `next pool id`, because every
pool id below it will need migrating.

### Step 3 — Upgrade the program

While the upgrade authority is a single key:

```
BLOTTO_PROGRAM_KEYPAIR=<program keypair> BLOTTO_DEPLOY_KEYPAIR=<upgrade-authority keypair> ./scripts/deploy-devnet.sh
```

The script:

1. builds the program;
2. extends the programdata account if the build grew (the loader refuses an extension under
   10,240 bytes);
3. uploads the program with the signing key named;
4. applies pending database migrations and re-derives the indexer's tables, if
   `BLOTTO_DATABASE_URL` is set.

You may leave `BLOTTO_DATABASE_URL` unset. The indexer applies migrations itself at boot and
rebuilds the derived tables before it serves ([`HOSTING.md`](HOSTING.md)). The script then warns
that it skipped those steps, which is expected.

The script **refuses** in any of these cases, and names the cause:

- the program keypair does not match `declare_id!`;
- the on-chain upgrade authority is not the deploy key;
- the CLI's default keypair disagrees with the deploy key;
- the RPC cannot say whether the program exists.

An upload that dies part-way can be resumed from the buffer the CLI names, so you do not have to
start over.

Then confirm the program is live:

```
npm run check-deployed
```

Expect every instruction to be green. The Config row stays red until Step 4 if Config grew.

### Step 4 — Migrate Config, immediately (if Config grew)

```
npm run admin -- migrate-config --emit-proposal --admin <vault address>
```

Check the payload before you approve it. The vault is signer **and writable**, because it pays
the rent top-up. The accounts are the Config PDA and the System Program. The data is the 8-byte
discriminator alone, because the instruction takes no argument. Approve and execute in Squads. A
second execution fails cleanly, so a double send cannot hurt. Verify:

```
npm run admin -- status
npm run check-deployed
```

The layout warning is gone, any new fields read their defaults, and the Config row is green at
the new size.

### Step 5 — Migrate every pool (if Pool grew)

```
FEE_PAYER_KEYPAIR=<any funded keypair> npm run admin -- migrate-pool --all
```

The command is permissionless, needs no proposal, and sends one transaction per pool. Each
output line shows the account's size before and after. A pool already current is reported and
skipped, so re-running is safe. Devnet sometimes stops the run with "Blockhash not found".
Nothing was sent for that pool, so run the command again and it carries on.

**Run it once more at the end.** "0 migrated, N already current" proves it finished. `pools` on
its own does not prove it, because the reader shows an old-size pool with default values.

Values that a migration writes are the ones the pool's players entered under, never the new
rule. For example, `min_seats` for a pool that existed before the rule changed is written as the
old floor.

### Step 6 — Redeploy the backend (if the wire contract changed)

If the upgrade changed an instruction the services send or an event they read, run
`deploy-backend` from `main` ([`HOSTING.md`](HOSTING.md), Step 5). Then watch for three things:

- the indexer's log reporting that a migration invalidated the derived tables and that they
  were rebuilt before serving;
- the daemon's `/health` reaching `"ready":true`;
- the read API serving any new fields (`GET /tiers`, `GET /pools`).

A deploy does not always restore a machine count you set to zero. If the daemon does not come
back, restore it:

```
fly scale count 1 -a <daemon-app>
```

### Step 7 — Restart the daemon and verify

Run `status` and `pools` again, and compare them with Step 2. The daemon opens the next pool on
its usual cooldown. Check that pool's pot and mode before anyone enters.

### Going back

Before the migrations, reverting is a redeploy of the previous program. After them it is not.
Grown accounts cannot shrink, and the old program refuses them exactly as the new one refused the
short ones. Reverting after Step 4 or 5 means draining every pool to a terminal state and
deploying a program that reads the new layouts. In practice that is the new program with the new
feature left switched off.

### Upgrading once the authority is a Squads vault

`scripts/deploy-devnet.sh` cannot upgrade a program whose authority is a multisig. It reads the
on-chain authority first and refuses in one line. Everything above still applies: the drain, the
migrations in the same window, and the verification. What changes is only how the new bytes get
there. The upload and the switch become separate steps, and only the switch needs the multisig.

1. **Drain and build.** Build from the exact commit you intend to ship (`anchor build`). Every
   step below uses `target/deploy/blotto_cup.so` from that build.
2. **Upload the bytes to a buffer.** A buffer is an ordinary account that holds a candidate
   program. Writing one changes nothing about the live program, and anyone can do it:

       solana program write-buffer target/deploy/blotto_cup.so -k <deploy keypair> --url <rpc> --max-sign-attempts 100

   It prints a **buffer address**. If the upload dies, recover the buffer's key from the seed
   phrase the CLI prints and rerun with `--buffer`.
3. **Extend first if the build grew.** Compare `solana program show <program id> --url <rpc>`
   (*Data Length*) with the built `.so`. If the build is larger:

       solana program extend <program id> <bytes, at least 10240> -k <deploy keypair> --url <rpc>

   Do this **before** proposing. A proposal that fails on execution has to be approved again.
4. **Hand the buffer to the vault.** The loader requires the buffer's authority to equal the
   program's upgrade authority:

       solana program set-buffer-authority <buffer address> --new-buffer-authority <vault address> -k <deploy keypair> --url <rpc>

5. **Propose the upgrade in Squads.** The proposal is one BPF upgradeable loader `Upgrade`
   instruction naming the program, its programdata account, the buffer, a spill account for the
   reclaimed rent, and the vault as authority. Squads' program-upgrade flow builds it from the
   program id and the buffer address. **Before approving, every member checks** that the buffer
   address is the one Step 2 printed and that the program id is ours. Anyone can fetch the
   buffer and compare its hash with a build of the commit.
6. **Approve, execute, confirm.** In `solana program show`, *Last Deployed Slot* has moved and
   *Authority* is still the vault. If the authority changed, stop and escalate.
7. **Finish the window.** Run the migrations, unpause if you paused, and run `check-deployed`. A
   buffer from an abandoned proposal belongs to the vault. Reclaim its rent with a Squads
   proposal carrying the loader's `Close`.

The loader's `Upgrade` touches the program account only. Nothing in this procedure gives the
vault a way to reach a prize vault.

*Command currency.* The Solana CLI changes faster than this document. Before a mainnet window,
check each command against `solana program --help` on the version pinned in
`.github/workflows/on-chain.yml`. Moving the upgrade authority to a vault needs
`solana program set-upgrade-authority`. Recent CLI versions refuse a new authority that cannot
sign, and a vault is a PDA, so expect to need `--skip-new-upgrade-authority-signer-check`.
Confirm with `--help` first.

## 5. Opening and closing a tier

`Config.open_tiers` (the easy ladder) and the hard ladder's switch are the only things that let
a tier open pools. `set-open-tiers` is the only command that changes them. The tier table (seven
prices and pots) lives in `programs/blotto_cup/src/constants.rs` and is mirrored in
`backend/scoring/src/prizes.ts`. Both ladders share it. Opening a tier matters because
`open_pool` funds the pot from the treasury at **whatever the on-chain config says**, and then
publishes that figure as the prize. A published prize cannot be withdrawn.

**Preconditions.** Opening any tier above tier 0 requires the conditions recorded in decision R6
([`../architecture/DECISIONS.md`](../architecture/DECISIONS.md)): the audit closed (R5),
and one written legal opinion received (R1). The upper tiers pay large first places.
Check where they sit against the KYC switch before opening them.

**The order.**

1. **Read the chain.** Run `npm run admin -- status` and note `open tiers`, `hard open tiers`,
   `tier prices` and `tier pots`.
2. **Fix the tier's economics first, if they are wrong.** If the tier's on-chain price or pot
   differs from the source table, send
   `set-tier-economics --tier <n> --price <p> --pot <q> --emit-proposal`, get it approved, and
   confirm with `status`. Do not go on until the two agree.
3. **Dry-run.** For example, to open tier 1 on the easy ladder while tier 0 stays open:

   ```
   npm run admin -- set-open-tiers --tiers 1,1,0,0,0,0,0 --dry-run
   ```

   Pass seven flags, tier 0 first. The list is **absolute**: a `0` where a `1` stood closes that
   tier. Add `--mode hard` to address the hard ladder. The dry run prints `current`, `proposed`,
   `opening` and `closing`, then passes or refuses.
4. **Send it as a proposal.** Run the same command with `--emit-proposal --admin <vault address>`.
   The same checks run again before the payload is printed. Approve it in Squads.
5. **Verify in three places.**
   - **On chain:** `status` shows exactly what you proposed.
   - **In the read API:** `GET https://<indexer-host>/tiers` shows the tier with
     `"status": "open"`. `enablement_source` (and `hard_enablement_source`) must read `"chain"`.
     `"ledger"` or `"launch_default"` means the indexer could not read Config and may be stale.
   - **On the site:** the tier appears in the prize-pool list. A closed tier is not listed.
6. **Watch the first pool open.** The daemon opens pools itself, and only when the treasury can
   fund the pot and still keep its floor. When the pool appears in `pools`, check its pot. This
   is the last moment a wrong number is cheap to fix.

**The refusals.**

| Refusal | Meaning | Fix |
|---|---|---|
| The tier being opened does not carry the ratified economics | Its on-chain price or pot differs from the source table | Step 2, then run the command again |
| This call would open more than one additional tier | The guard against typing `1,1,1,1,1,1,1` | Open one tier per call, each with its own proposal and verification |
| The live Config carries no hard ladder (`--mode hard`) | Config is on the pre-hard-mode layout | Run `migrate-config` first ([§4](#4-program-upgrades-and-account-migrations)) |

Closing a tier is never refused.

**Closing a tier** is the same command with `0` in that position. It takes effect at once. It
stops the **next** pool opening in that tier. It does **not** touch a pool that is already open:
`open_tiers` gates `open_pool` only, and `register` never reads it. A pool taking entries keeps
taking them until it seals or refunds, so seated players never have the rules changed under
them. To stop entries everywhere immediately, use `set-paused --paused true`. It blocks
`register` and nothing else, so reveal, payout and refund keep working.

**If something looks wrong.** `/tiers` saying `enablement_source: "ledger"` means the indexer
cannot read Config. The chain is still right, and `open_pool` still enforces it. A tier that is
open with no pool appearing means the treasury cannot fund the pot while holding its floor, or
the tier is cooling down. `status` shows both, and `GET /tiers` gives `next_open_at` per tier.

## 6. The daemon: keeper and crank

The daemon (`backend/reveal`) is the one long-running process the pool loop needs. It works in
ticks (default 15 seconds, `BLOTTO_DAEMON_INTERVAL_MS`). Each tick has three phases, printed as
banners in this order:

- **SETTLE.** Sweeps every pool that is not yet terminal:
  - It carries a Sealed pool through reveal, scoring, `commit_results` and `pay_prizes`.
  - For an Open pool past its deadline, it seals the pool if the floor is seated, and otherwise
    triggers the refund and drains it.
  - For a settled pool, it runs the review clock, the owed bundle and the next-place step
    (below).
- **KEEP.** Finishes the launch steps of every live Open pool on both ladders: the randomness
  seed and the pass collection.
- **OPEN.** For each enabled tier on each ladder whose slot is free, whose cooldown has passed,
  and which the treasury can fund, it opens the next pool. Custody creates the sealing key, then
  `open_pool`, then `commit_vrf_seed`, then `create_pass_collection`. While the deployment is
  paused, the daemon skips this phase, because nobody could enter the pool.

```
open_pool → commit_vrf_seed → create_pass_collection → register × n
   │
   ├─ 64th seat, or the deadline with ≥ the pool's floor seated
   │     Sealed → reveal_pool_secret → commit_results → Scored → pay_prizes → Paid
   │
   └─ the deadline below the floor
         Refunding → refund × n → Closed      (no entrants: straight to Closed)
                                   │
            the tier's slot frees and its cooldown starts
```

**It is idempotent.** Every tick re-reads the chain and does only what is missing. A crashed
daemon resumes by starting again. Two daemons running at once cannot corrupt anything, because
the program rejects the loser's transaction. `pay_prizes` refuses a seat it has already paid
rather than paying twice.

**Crank behaviour worth knowing.**

- **Lost ciphertexts.** If a sealed entry cannot be read back (missing, undecryptable or a hash
  mismatch), the published rule scores it as all losses. The crank raises
  `reveal entry refund owed after lost ciphertext`. See [§7](#an-entry-was-scored-as-all-losses).
- **Too many unreadable entries.** Past a ceiling (`BLOTTO_MAX_UNREADABLE_ENTRIES`, set by the
  operator), the crank refuses to commit and does not settle the pool. When the variable is
  unset, it refuses only if every entry is unreadable. That many losses suggests a fault on the
  operator's side, such as a wiped ciphertext table or a mismatched custody key, rather than
  players' doing. Paying is final, so the crank will not pay out on a result it cannot stand
  behind.
- **Detection.** The crank persists each pool's detection report for the reviewers. It never
  flags anyone itself ([§8](#8-review-and-complaints)).
- **Winner screening.** The crank screens every committed winner against the configured
  sanctions lists and places a **sanctions hold** before payment. A held share is escrowed
  rather than sent.
- **The review clock.** A flagged share that is still escrowed and has no decision is released
  to its player once the published review window has passed. The window is 12 hours
  (`REVIEW_WINDOW_SECS`, `backend/scoring/src/prizes.ts`). Two things stop the clock:
  - a sanctions hold on the same entry;
  - a forfeit already logged by a reviewer. Once the window passes with the on-chain forfeit
    still not landed, the daemon raises `reveal forfeit logged but not landed on chain`.
- **The next-place step.** On the tick after a forfeit lands, the daemon runs `pay_next_place`.
  It waits while any other committed seat in the pool is still under review.
- **The owed bundle.** A Paid pool whose results bundle is not on record is retried every ten
  minutes through a publish-only path. After three failures the daemon raises
  `reveal settled pool still unpublished`.
- **Sweep floor.** A pool with a held, forfeited or unpublished share is never treated as
  settled, so it keeps being revisited until the last lamport has reached a player.

**What is permissionless.** If the daemon is down, anyone can call `seal_at_deadline` or
`trigger_refund` and `refund`. A pool that took money therefore always settles or refunds without
the operator. `open_pool` is the keeper's alone, so a dead keeper stops new pools and strands
nothing already running.

**Startup.** The daemon binds `/health` first and reports its startup `phase`. It needs:

- the settlement key, holding at least 0.05 SOL;
- Turnkey custody;
- a funded upload wallet;
- `SWITCHBOARD_QUEUE`, the production randomness.

It refuses to start without a randomness source. **Never set `RANDOMNESS_ACCOUNT` on a real
deployment.** It selects the test stub, the daemon starts cleanly on it, and the class draw's
randomness claim is silently lost.

## 7. When something is wrong

### A pool is stuck in Sealed

The daemon is not cranking. Check the `/health` `lastTick.at` value, then the logs. An
`export-refused` line means custody and the chain disagree about whether the pool may be
revealed. The daemon deliberately does nothing rather than fight it. Re-check both before acting.
Never loosen the export policy to get past this.

### A pool is stuck in Scored

`pay_prizes` is failing on a seat. It settles seat by seat against the committed list, so the
error names the seat. The usual cause is a wallet account that cannot receive the transfer.

### The daemon answers 503 while it says `ready: true`

No tick has completed within the staleness budget: 15 minutes, `STALE_TICK_MS` in
`backend/reveal/src/health.ts`. The loop is stuck on something that will not answer, such as a
vendor socket or an RPC. Fly restarts a machine whose check fails, and `backend-watch` reports
it. The log's last `phase=` and step lines show where it stopped. A daemon still starting after
five minutes (`STARTUP_BUDGET_MS`) also answers 503.

### A pool is Paid but has no published bundle

The publish failed after payment. The daemon owes the bundle and retries it. Until the bundle
lands, the pool holds the sweep's floor. If the alert fires, check the upload wallet's balance
and the storage gateway.

### An entry was scored as all losses

The published lost-ciphertext rule applied. The bundle lists the player under
`scored_as_all_losses`. The daemon raises `reveal entry refund owed after lost ciphertext`,
naming the pool, the number of entries, and the players in shortened form. The bundle has the
full list.

**The entry fee is owed to each of those players.** It lives in the treasury, not the prize
vault, and the treasury's only discretionary exit is `withdraw_platform`. Pay each player with
one admin proposal, sent to that player's wallet, for the pool's entry amount:

```
npm run admin -- withdraw-platform --amount <entry lamports> --destination <player> --emit-proposal --admin <vault address>
```

Record the signature against the pool. No table or dedicated command tracks this obligation
yet. Until one exists, the alert and the bundle are the ledger. This is a known limitation.

### A prize is held

That is escrow. Two different things put a share there, and they are cleared in different ways.
`pools` and the daemon's payout log line say which applies.

- **Integrity flag** (`flagged`). It is cleared in one of three ways:
  - the settlement signer releases it after review, or the daemon does so itself when the
    12-hour window passes with no decision;
  - anyone releases it after seven days (`ESCROW_AUTO_RELEASE_SECS`);
  - the admin forfeits it, and it is divided among the eligible players at the rank it passes
    to.
- **Sanctions hold** (`sanctions_hold`). The crank screened the wallet before payment and did
  not send the share. `lift-sanctions-hold` is the **only** way it moves again, and it is for a
  false positive established by review. Nothing else moves it: not the 12-hour clock, not the
  seven-day release, not a forfeit. If the logged reason is `screening_unavailable` rather than
  `listed`, no list matched; the screener simply could not answer. Fix the screener, re-screen
  the wallet, and lift the hold if the wallet is clean.

### The treasury will not fund a pot

`open_pool` refuses unless, after funding, the treasury still holds all of:

- the minimum balance;
- one further pot for every other enabled tier that is idle;
- every refundable entry.

`status` prints all four numbers. Fund the treasury (`fund-platform-wallet`) or disable a tier.

### Entries are being refused

In order of likelihood:

1. the deployment is paused;
2. the territory check refused. It is fail-closed: no geo vendor configured, a lookup failure
   or an undetermined location all refuse. A vendor fault logs `LOOKUP FAILED (this is NOT a
   territory decision)`;
3. the terms version was bumped and this wallet has not accepted it again;
4. the entry packet is older than 60 seconds (`PACKET_MAX_AGE_SECS`);
5. the wallet is on the blocklist or a sanctions list;
6. the wallet is one of the service keys, which the program refuses by design.

### The site says no tournament is open

Check whether the tier is cooling down (`GET /tiers`, `next_open_at`) before assuming a fault.
If the read API returns `[]` while the chain has pools, run the `indexer-backfill` workflow and
read its `inserted` count. Zero on a chain that has pools points to a code defect, not a slow
RPC.

### Which code is running?

Every service prints `BLOTTO_BUILD_COMMIT` as its first log line. Read that line. Do not compare
a commit shown on a web page against a branch.

The app answers `GET /api/version` with the commit hash it was built from (D-E18) — the same
value on the site and inside the Android package, since the package opens the site. A player who
reports "Blotto Cup has been updated" at the seal was on a page from an older build and was
refused before signing; a reload is the whole fix ([`MOBILE.md` §2](MOBILE.md#2-what-differs-on-mobile--the-complete-list), item 5).

### A deploy refused on the database URL

Before any machine is replaced, `deploy-backend` opens one session to `BLOTTO_DATABASE_URL` and
runs `SELECT 1` (`backend/_shared/src/check-database-url.ts`). A failed preflight deploys
nothing, so the fix is one secret edit with no downtime. It checks with the same client the
services use (`pg` on Node 22), because other clients read `sslmode` differently. It never
prints the driver's error text, because that text can quote the host. Each failure prints a
fixed sentence and, for an unrecognised error, only its code.

| Condition | devnet | mainnet |
|---|---|---|
| No session opens (wrong password, database, host, port or TLS) | refuse | refuse |
| Remote host with **no TLS** | refuse | refuse |
| `sslmode` = `require` / `verify-ca` / `prefer` | warn, proceed | refuse |
| A URL naming the local machine | no opinion | refuse |
| `sslmode=verify-full`, and the session opens | silent | silent |

**The TLS posture.** On the pinned `pg` 8, `require`, `verify-ca` and `prefer` are treated as
`verify-full`, so the connection is verified today. The next major `pg` version gives them libpq's
weaker meaning. **Set `sslmode=verify-full` in the URL.** Only the URL can fix this, because it
overrides any `ssl` option in code. Services also print a boot warning about the TLS posture,
because a boot line is the only thing that speaks for a machine the platform restarts on its own.

Two lessons from a real outage:

- A credential is not configuration until something has used it.
- Services whose `/health` does not touch the database can answer `200` while every query fails.

### Recovery notes

**The deployed program does not match the branch.** `npm run check-deployed` (and the daily
`deployed-drift` workflow) simulates every instruction against the deployed program without
signing. It reports any wire-contract mismatch. The usual cause is that the program was changed
on `main` but never redeployed, or the reverse. Rebuild and redeploy ([§4](#4-program-upgrades-and-account-migrations))
before sending anything else.

An earlier devnet incident shows why this check comes before every irreversible instruction.
`solana program show` reported the right id, the right authority and a recent-looking slot, but
the binary was days older than a change to `init_config`'s arguments. An `init_config` proposal
built for the new arguments was caught only by simulating it (`InstructionDidNotDeserialize`)
minutes before signing. On a write-once account, signing it could have left Config in a layout
the code cannot read.

**Wrong admin at `init_config`.** There is no `set_admin`. Recovery is a new program deployment
with a fresh Config.

## 8. Review and complaints

### Detection review

**Detection is manual (decision D-E9).** After each reveal, the crank runs five signals and
persists a detection report (`backend/detection/src/pipeline.ts`). A recommendation needs two
independent signals to agree. No signal takes an automatic action. The report is shown only to
reviewers, on the admin review page, which reads `GET /detection` through the app's server
route. That route checks the caller is a listed reviewer before spending the operator token.
`set-detection-hard-block` is read by nothing off-chain.

**The reviewers.** [`config/reviewers.json`](../../config/reviewers.json) lists two member
wallets. The review service loads it at startup and verifies every decision against it. No
decision verifies while the list is empty. Two members means a challenge to a decision can be
decided by someone other than whoever made the original decision, which the terms undertake
wherever possible.

**The workflow.**

1. A reviewer opens the review page, reads the pool's report and the pending held shares, and
   signs a decision citing a published criterion. The service verifies the signature against the
   member list and appends it to the signed decision log (`GET /decisions` is public).
2. **Clear or release** is sent by the review service with the settlement signer.
3. **Forfeit** is written to the log first, answering "recorded". An admin then lands it on
   chain with `forfeit-escrow` as a Squads proposal. Until it lands, the daemon holds the share
   and does not release it. If the window closes first, the daemon raises an alert.
4. **The published review window is 12 hours from settlement.** If no decision is made in that
   time, the daemon releases the share to its player. A reviewer who needs longer must decide
   within the window. Holding a prize by inaction is not an option the system offers.
5. The seven-day on-chain release is a safeguard that anyone can trigger if everything above
   fails.

Every decision row names its reviewer, time and criterion, and anyone can re-verify it from the
log alone.

### Complaints: the operator's write path

Players lodge complaints through the site. Complaints about a decision must be signed; others
may be unsigned. The review service stores them in an append-only table. The published windows
are **5 working days to acknowledge and 30 days to answer**
(`COMPLAINT_ACKNOWLEDGE_WORKING_DAYS`, `COMPLAINT_RESOLVE_DAYS` in
`backend/detection/src/complaint-windows.ts`). The service serves these values, so the page never
re-types them.

| | Route | Authenticated by |
|---|---|---|
| **Read the queue** | `GET /complaints/open` | The operator token (`BLOTTO_REVIEW_OPERATOR_TOKEN`), fail-closed: unset means 503. It reaches the desk only through the app's server route, which holds the token (`REVIEW_OPERATOR_TOKEN`, server-side only) and first checks the caller is a listed reviewer |
| **Answer** | `POST /complaints/answer` | A **reviewer's signature** over the reference, the kind (acknowledge or resolve) and the note. The signature makes the stored name evidence of who answered. The note is covered too, so what the player reads is what was signed |

On the review page, the complaints desk shows each complaint's full text, whether it was signed,
and both windows. The service refuses:

- an answer to a reference that was never lodged;
- a duplicate signature;
- a malformed request, before the wallet is asked to sign.

A player sees `received`, then the operator's acknowledgement, then the answer. The desk needs
`NEXT_PUBLIC_REVIEW_API_URL` and `REVIEW_OPERATOR_TOKEN` set in the app, and the site's origin in
`BLOTTO_APP_ORIGINS` ([`HOSTING.md`](HOSTING.md)).

## 9. Monitoring

| Tool | What it does |
|---|---|
| `GET /health` on each service | `{ ok: true, … }`. The daemon's payload adds `ready`, `phase`, `settlementSol` and `lastTick` (with `at` and counts of pools opened, cranked, refunded, held and published, plus errors). **Alert on `lastTick.at` going stale.** The daemon's own 503 does this after 15 minutes |
| `backend-watch` workflow | Runs every 15 minutes. It probes all four services, **starts a stopped machine** (never more than that), and turns red naming any service that stays unhealthy. Turn on GitHub Actions failure notifications to be paged |
| `backend-status` workflow | Read-only forensics, run by hand: each app's Fly status, machine list and recent logs |
| `deployed-drift` workflow | After a merge that touches the program, and daily: does the deployed program still match `main`? Simulation only |
| `indexer-backfill` workflow | By hand: walks the chain into the ledger and rebuilds the derived tables. Idempotent. Its `archive-backfill` mode also runs daily to fill the verified-results archive |
| Metrics | Deployed services use the Prometheus sink (`BLOTTO_MONITOR_SINK=prometheus`). Every alert still writes its log line and also increments `blotto_alerts_total{reason}`. The endpoint listens on port 9090 on Fly's private network only. Nothing scrapes it yet |
| Alert reasons | Defined once in `backend/_shared/src/metrics.ts`. The ones an operator acts on: `reveal entry refund owed after lost ciphertext`, `reveal settled pool still unpublished`, `reveal forfeit logged but not landed on chain` |

## 10. Bringing up a credentialed deployment

This is the order that works for a fresh deployment. It is also the order used on devnet.
[`DEVNET-REHEARSAL.md`](DEVNET-REHEARSAL.md) has the rehearsal itself and the CLI's worked
examples. [`HOSTING.md`](HOSTING.md) has the hosting steps.

1. **Postgres, then the program.** Create the database. Deploy with
   `scripts/deploy-devnet.sh` ([§4](#4-program-upgrades-and-account-migrations)). Run
   `npm run check-deployed`.
2. **Entry signer (Turnkey).** Create the API key pair. Its private key is shown once, so put it
   straight into the GitHub secret field. Create the Ed25519 entry-signer key, then stage all six
   `TURNKEY_*` / `ENTRY_SIGNER_*` values.
   - **Remove any development seed (`ENTRY_SIGNER_SEED_HEX`) before verifying, not after.** With
     the seed present, a missing key id quietly selects the development signer, and every check
     below still passes.
   - **Verify the key pair.** Request a packet and verify its signature against the public key it
     returns. Then **base58-encode that public key and compare it with the Turnkey key's Solana
     address**. Only this comparison tells Turnkey apart from a development seed, because a seed
     also produces self-consistent signatures.
   - **Negative test.** Remove `TURNKEY_API_PRIVATE_KEY` while `ENTRY_SIGNER_KEY_ID` stays set.
     The service must refuse to start.
3. **Geo vendor.** Stage `GEO_VENDOR_URL` and `GEO_VENDOR_API_KEY`, and clear `GEO_STUB_COUNTRY`
   and `ALLOW_STUB_GEO`.
   - **The acceptance check is the startup log.** The `GEO STUB` line must be gone.
   - **Negatives.** A blocked country, an unreachable vendor, a malformed answer and a quota
     response (HTTP 429) must each refuse, each with a distinguishable log line.
   - **Client address.** The packet service decides on the proxy-set client address and never on
     a caller-supplied forwarding header. That assumes the platform's edge reports the true
     origin. This is a property of the proxy, not something a test here can establish.
4. **Settlement signer.** Generate it **before** `init_config`, because `init_config` needs its
   public key. Stage it as `SETTLEMENT_SIGNER_KEYPAIR_B64`, and fund it: it pays every daemon
   transaction.
5. **`init_config`.** Emit the proposal with the vault as `--admin`, the two signers, the
   ceilings and `--min-platform`. Before approving:
   - check that `--admin` is the **vault**, not the multisig account;
   - simulate the proposal;
   - run `npm run check-deployed`.

   Whoever signs becomes admin for good. Verify with `status`, and confirm that a second
   `init_config` reverts.
6. **Fund the treasury.** Run `fund-platform-wallet`. Pool 1 cannot open until the treasury
   covers the pot plus the floor.
7. **Services.** Deploy the indexer and create the RPC provider's webhook, then the packet
   service, then the app with its service URLs ([`HOSTING.md`](HOSTING.md)).
8. **Daemon and review.** Stage `SWITCHBOARD_QUEUE`, the Turnkey values including
   `TURNKEY_USER_ID`, `IRYS_UPLOAD_KEY` and the settlement keypair. Fill
   `config/reviewers.json` before relying on review. Then verify:
   - `/health` reads `"ready":true`, not merely a 200;
   - the log shows the Switchboard path, not the stub;
   - one pool key is created in Turnkey at `open_pool`;
   - **exporting a pool key before the pool seals is refused by Turnkey policy.** This is the
     whole of the sealing claim. If the export succeeds, stop;
   - exporting after the pool seals succeeds;
   - one bundle is published and can be fetched.
9. **Upgrade authority to the vault**, once the code has stopped changing and `check-deployed`
   passes. After this, every upgrade follows
   [Upgrading once the authority is a Squads vault](#upgrading-once-the-authority-is-a-squads-vault).
   Update `config/custody.json` in the same change.

`NEXT_PUBLIC_ALLOW_TEST_SIGNER` exists only for a driven devnet browser. It must never be set on a
site anyone can reach. The `app-test-signer` CI lane checks that a production build carries none
of its code.

## 11. What must never be done

- Add an exit to a prize vault, or an admin escape hatch. The exit set is fixed, and CI asserts
  it.
- Add an instruction that can thaw a pass.
- Add any path that reads an allocation before its pool closes, or loosen the custody export
  policy.
- Shorten or extend a live pool's deadline, or change any term a seated player entered under.
- Skip the drain before a program upgrade, or separate a layout upgrade from its migration.
- Place a sanctions hold or withhold a prize by hand.
- Widen the language gate's exclusion list to make a change pass.
- Build a second copy of the product for the phone, or sign the Android package with any key but
  the dApp Store key, or commit that key anywhere ([`MOBILE.md`](MOBILE.md) §1 and §4).
