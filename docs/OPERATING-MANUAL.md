# Blotto Cup — operating manual

**Who this is for.** Whoever is running the thing: bringing it up, deploying a
change, sending an admin transaction, or working out why a pool is stuck. It
assumes you know what the product is; [`AS-BUILT.md`](AS-BUILT.md) is the
description of the system, and this is what you do to it.

**Current reality.** Devnet only. The program has never been deployed to
mainnet and no real money has ever passed through it.

---

## 1. Standing rules

These are not precautions. Each one is here because it was learned the
expensive way.

1. **Every `solana` command carries an explicit `-k <path>`.** The CLI's default
   keypair on the devnet machine is the fee payer that also holds **upgrade
   authority**. On 2026-09-05 a transfer that lost its `-k` was signed by that
   key anyway, because it is the default. The flag is the only thing between a
   dropped argument and the upgrade authority signing something nobody chose.
2. **The architect never sends an admin transaction.** Admin transactions move
   the founder's money and change the rules players entered under. The architect
   prepares them and hands them over; the founder reviews and signs. This holds
   even when it is slower.
3. **Never print, echo or log a secret value.** Confirm a key is present by its
   name, never by its content. The pre-commit hook rejects any staged file
   containing a 64-integer array — the shape of a Solana keypair — wherever it
   lives.
4. **Commands written for the founder are one line.** No backslash
   continuations. A continued command pasted into a terminal that eats the
   newline runs a different command from the one that was reviewed.
5. **Read before you overwrite.** `set_tier_economics`, `set_pool_timing` and
   `set_open_tiers` change what the next pool does. Run `admin.ts status` first
   and know what you are changing from.

## 2. What is running, and how to tell

Four backend services on Fly and one frontend on Vercel.

| Service | Fly app | Health | What it is |
|---|---|---|---|
| indexer | `blotto-indexer` | `GET /health` on 8081 | Event ingest, projections, the public read API |
| packet | `blotto-packet` | `GET /health` on 8082 | The entry gate |
| review | `blotto-review` | `GET /health` on 8083 | The review desk and its signed log |
| daemon | `blotto-daemon` | `GET /health` on 8084 | The keeper and the crank |
| app | Vercel | the site loads | The frontend |

Every service prints `BLOTTO_BUILD_COMMIT` as its first log line. **That is how
you answer "which code is running"** — not by comparing a commit on a web page
against a branch, which is what caused both deploy incidents of 2026-08-31.

The daemon's health payload carries its last tick: `at`, and counts of pools
opened, cranked and refunded, plus errors. **Alert on `at` going stale, not on a
non-200.** A hung RPC leaves the process happily answering 200 while nothing
settles.

## 3. Bringing it up from nothing

In this order. Each step assumes the previous one succeeded.

1. **Postgres up.** `docker-compose.yml` locally; a Fly Postgres in the hosted
   shape. `BLOTTO_DATABASE_URL` everywhere.
2. **Deploy the program.** `scripts/deploy-devnet.sh` with
   `BLOTTO_PROGRAM_KEYPAIR` pointing at the real program keypair, which lives
   outside this repository. The script refuses to run if the keypair's pubkey
   does not match `declare_id!` — deploying under a different id would strand
   every client. It also applies pending database migrations and re-derives the
   projections.
3. **`scripts/admin.ts init-config`**, then `fund-platform-wallet`, then
   `set-open-tiers`. Founder-signed.
4. **Indexer up.** Then create the Helius webhook exactly as `hosting.md` §
   "Creating the Helius webhook" specifies — the commitment setting must match
   `BLOTTO_INDEXER_COMMITMENT` or the ledger double-feeds or starves. The
   webhook is delivery optimisation, not truth: the ledger rebuilds from RPC
   with `backfill`, and `sync` runs one before serving.
5. **Packet service up**, then the app deployed with the three `NEXT_PUBLIC_*`
   service URLs.
6. **Daemon last.** It needs the settlement key, a funded Irys wallet, and
   either `SWITCHBOARD_QUEUE` (production VRF) or `RANDOMNESS_ACCOUNT` (the test
   stub). It refuses to start with neither.

## 4. Deploying a change

**The frontend** deploys itself: Vercel builds `main`. Nothing to do.

**The backend** is a manual GitHub Actions run (`deploy-backend.yml`) — by
policy, so a merge never moves a service on its own. `docs/deploy-backend.md` is
the step-by-step.

**The program** is `scripts/deploy-devnet.sh`, and it is the one that needs
care:

- Drain first. `scripts/admin.ts pools` must show no pool in `Sealed`, `Scored`
  or `Refunding`. A pool caught mid-settlement by an upgrade is the one shape
  that can strand money.
- `set_paused(true)` before, `set_paused(false)` after. Pausing blocks new
  entries only — settlement and refunds keep working, so pausing can never
  strand funds.
- **If the upgrade changes an account layout, the migration transaction is part
  of the deploy, not a follow-up.** Between the upgrade and
  `admin.ts migrate-config`, every instruction that touches `Config` fails —
  including `set_paused(false)`. That is why the runbook puts it immediately
  after the deploy.
- An open pool keeps the terms it opened under: its pot, its deadline and its
  timer were copied onto the `Pool` account at open and no config change
  reaches them. You cannot shorten a live pool's deadline, and you should not
  want to.

`docs/devnet-rehearsal-runbook.md` is the current, sequenced runbook for the
next upgrade window, with the live devnet state recorded in it.

### Upgrading once the authority is a Squads vault

Today the upgrade authority is a single fee-payer key and
`scripts/deploy-devnet.sh` does the whole upgrade. The moment that authority
moves to the Squads vault — §8, and a mainnet precondition — **that script can
no longer upgrade the program**, because the transaction the loader accepts
must be signed by the authority and the authority is then a multisig. Since
2026-09-12 the script says so in one line rather than failing inside the CLI:
it reads the program's on-chain authority before doing anything and refuses if
it is not the key it was asked to sign with.

The procedure below is what replaces it. Everything in the list above still
applies unchanged — drain first, `set_paused(true)` before and `(false)`
after, and the migration transaction is part of the same window, not a
follow-up. What changes is only *how the new bytes get there*: instead of one
command, the upload and the switch are separated, and only the switch needs
the multisig.

1. **Drain, pause, and build.** As above. Build from the exact commit you
   intend to ship — `anchor build` — and keep the terminal open: every step
   below refers to `target/deploy/blotto_cup.so` from this build.

2. **Upload the new bytes to a buffer.** A buffer is an ordinary account that
   holds a candidate program. Writing one changes nothing about the live
   program, costs only rent and fees, and can be done by anybody — no
   multisig involved:

       solana program write-buffer target/deploy/blotto_cup.so \
         -k <deploy keypair> --url <rpc> --max-sign-attempts 100

   It prints a **buffer address**. Write it down; everything after this needs
   it. If the upload dies part-way the CLI prints the buffer's seed phrase —
   recover it with `solana-keygen recover` and rerun with `--buffer <file>`
   rather than starting over.

3. **Check the size, and extend first if the build grew.** The loader will
   refuse an upgrade whose bytes do not fit the existing programdata account,
   and it refuses an extension smaller than 10,240 bytes. Compare
   `solana program show <program id> --url <rpc>`'s *Data Length* against the
   built `.so`, and if the build is larger:

       solana program extend <program id> <bytes, at least 10240> \
         -k <deploy keypair> --url <rpc>

   Do this **before** proposing the upgrade. A proposal that fails on
   execution has to be made again, and the members have to approve twice.

4. **Hand the buffer to the vault.** The loader requires the buffer's
   authority and the program's upgrade authority to be the same signer, so
   the buffer must belong to the vault before the vault can consume it:

       solana program set-buffer-authority <buffer address> \
         --new-buffer-authority <squads vault address> \
         -k <deploy keypair> --url <rpc>

   After this you can no longer close the buffer yourself — see step 7.

5. **Propose the upgrade in Squads.** Create a transaction whose single
   instruction is the BPF upgradeable loader's `Upgrade`, with the program,
   its programdata account, the buffer from step 2, a spill account for the
   reclaimed rent (the deploy keypair is fine), and the vault as the
   authority. Squads' own "program upgrade" flow builds this for you from the
   program id and the buffer address; build it by hand only if that flow is
   unavailable.

   **Before approving, every member checks the same two things:** the buffer
   address in the proposal is the one step 2 printed, and the program id is
   ours. An approval is a signature on whatever bytes that buffer holds.

6. **Approve to the threshold and execute.** Then confirm:
   `solana program show <program id> --url <rpc>` — *Last Deployed Slot* has
   moved, and *Authority* is still the vault. If the authority changed,
   stop and escalate; nothing else in this manual can put it back.

7. **Finish the window.** Run the migration transaction if the upgrade
   changed an account layout (`npm run admin -- migrate-config`), then
   `set_paused(false)`, then the smoke checks in
   `docs/devnet-rehearsal-runbook.md`. If the proposal was abandoned instead,
   the buffer still holds its rent and now belongs to the vault: reclaim it
   with a second Squads transaction carrying the loader's `Close`, or leave
   it — it is a few SOL of rent, not a risk.

**Two properties worth being explicit about.** The bytes are uploaded by one
person and authorised by several, which is the point: the upload is
reviewable (anyone can fetch the buffer and compare its hash against a build
of the commit) and the switch is not unilateral. And nothing in this procedure
gives the vault a way to reach a prize vault — the loader's `Upgrade` touches
the program account only.

*Command currency: the Solana CLI moves faster than this document. Check each
command against `solana program --help` on the version pinned in
`.github/workflows/on-chain.yml` before a mainnet window, and where the
Solana Foundation skill and this text differ, the skill wins (CLAUDE.md,
knowledge currency).*

## 5. Admin transactions

`npm run admin -- <command>` from the repo root. `status` and `pools` are reads
and safe. Everything else is founder-signed.

| Command | What it changes |
|---|---|
| `status` | Reads Config: keys, tiers, prices, pots, switches, treasury, timings |
| `pools` | Reads every pool and its state — the drain check |
| `init-config` | One-time setup. Signer becomes admin |
| `migrate-config` | One-shot Config growth after a layout upgrade. Self-disabling |
| `migrate-pool` | One-shot POOL growth after the R7-b upgrade (2026-09-12). Permissionless, self-disabling, once per existing pool. Until it runs, every instruction touching that pool fails on the short account |
| `set-keeper` | Rotates the key allowed to open pools |
| `set-pool-timing` | The fill deadline and cooldown for **future** pools |
| `set-open-tiers` | Which tiers may open a pool |
| `set-tier-economics` | One tier's price and pot. Refuses a pot ABOVE the minimum field's intake (40 × price). Exactly equal is allowed — that is the launch relationship (R7-b) |
| `set-treasury-policy` | The reserve and the minimum balance |
| `set-vault-ceiling` | One tier's gross-intake ceiling |
| `set-paused` | Blocks new entries |
| `set-kyc-threshold` | The KYC-at-claim switch. **0 = off, and it is off** |
| `set-detection-hard-block` | The full-escrow-tier switch |
| `fund-platform-wallet` | Deposits into the treasury. Anyone can |
| `withdraw-platform` | The one treasury exit, floor-guarded on-chain |
| `forfeit-escrow` | Records that review upheld a flag. **Moves no lamports** |
| `lift-sanctions-hold` | Clears a hold review found to be a false positive. **Moves no lamports** |
| `register-signers` | Rotates the entry and settlement signers |
| `seal-at-deadline` | **Permissionless.** Seals a pool whose deadline has passed with its floor seated. The daemon does this; the command is the manual fallback when the daemon is down |
| `trigger-refund` | **Permissionless.** Starts the refund of a pool that reached its deadline under its floor — returns the untouched pot to the treasury. Refuses at the floor and above (`FieldReached`) |
| `refund` | **Permissionless.** Repays one entry in full, from the treasury, after `trigger-refund`. One call per entry |

**`--emit-proposal` works on every founder-signed command.** It prints the
instruction — accounts plus base64 data — and signs and sends nothing, which is
what goes into a Squads proposal. On mainnet the admin *is* the Squads vault, so
this is the normal path and direct signing is the devnet-only one. Nothing in
this script can sign for a multisig, by design. `set-open-tiers` in particular
is expected to be run this way; `--dry-run` on it runs every check and prints
current-versus-proposed without sending.

Three worth thinking twice about:

**`set-kyc-threshold`.** Under one paid place the winner's payout *is* the whole
pot, so any threshold below the smallest pot (4 SOL) escrows **every** payout at
**every** tier. It is an all-or-nothing gate now, not a large-prize gate. Two
payment paths — the seven-day auto-release and the next-place split — present no
KYC packet at all; turning the switch on means revisiting both first.

**`forfeit-escrow`.** It takes a prize away from the player who won it. It is
admin-signed for that reason and it is the only admin action that touches a
player's money. The share does not come to us: it stays in that pool's vault
until `pay_next_place` divides it among the other eligible players at that rank.

**`lift-sanctions-hold`.** The only way a held share ever moves again. Use it
when a review establishes the match was a false positive — the entry returns to
the ordinary path and the player is paid, by review or by the seven-day
safeguard, which by then has usually already run. Do not use it to release a
match you believe is real: that is counsel's call, not an operator's, and the
share is safe where it is. There is no command to *place* a hold; the crank
places one from a screening, and an operator withholding a prize by hand is the
thing the published sentence promises we do not do.

## 6. Watching a pool through its life

```
open_pool → commit_vrf_seed → create_pass_collection → register × n
   ↓
64th seat, or the deadline with ≥ 40          the deadline with < 40
   ↓                                                    ↓
Sealed → reveal_pool_secret → commit_results → Scored   Refunding
   ↓                                                    ↓
pay_prizes (batched) → Paid                          refund × n → Closed
   ↓                                                    ↓
              the tier slot frees, cooldown starts (5 min)
```

The daemon does all of it on a tick (default 15 s), in three phases it prints as
banners: SETTLE, KEEP, OPEN. Each phase is idempotent — a crashed tick resumes
by re-reading the chain, and `pay_prizes` re-sending a settled seat reverts
rather than double-paying.

**Sealing and refunding are permissionless.** If the daemon is down, anyone can
call `seal_at_deadline` or `trigger_refund`, so a pool that took money always
either settles or refunds without us. Opening a pool is not in that set:
`open_pool` is the keeper's alone (the 24-hour liveness fallback was removed on
2026-09-07 — it let a stranger choose a pool's sealing key). A dead keeper stops
new pools starting; it strands nothing that is already running.

## 7. When something is wrong

**A pool is stuck in `Sealed`.** The daemon is not cranking. Check its health
`at` field first, then its logs for `export-refused` — that means custody and
the chain disagree about whether the pool may be revealed, and the daemon
deliberately does nothing rather than fight it. Re-check both.

**A pool is stuck in `Scored`.** `pay_prizes` is failing on a seat. It settles
by seat against the committed list, so the failure names the seat. The usual
cause is a wallet account that cannot receive the transfer.

**The daemon's `/health` answers 503 while it says `ready: true`.** Since
2026-09-12 that means no tick has completed within the staleness budget
(fifteen minutes, `STALE_TICK_MS`): the loop is wedged on something that will
not answer — a vendor socket, an RPC. Fly restarts a machine whose check fails,
and `backend-watch` probes all four services every fifteen minutes and starts a
stopped one. The log's last `phase=` and step lines say where it stopped.

**A pool is `Paid` but the results page has no standings and `/verify` finds no
bundle.** The publish failed after payment. Since 2026-09-12 the daemon owes
that bundle rather than forgetting it: it records every upload in
`published_bundles` (migration 0016), retries a Paid pool with no record every
ten minutes through a publish-only path, announces it when it lands, and raises
`reveal settled pool still unpublished` after three failures. A pool in this
state holds the sweep's floor until its bundle is on record, which is deliberate.

**An entry was scored as all losses.** The published lost-ciphertext rule
applied: the sealed entry could not be read back (missing, undecryptable, or a
hash mismatch) and was scored zero. The bundle lists the player under
`scored_as_all_losses`, and since 2026-09-12 the daemon raises `reveal entry
refund owed after lost ciphertext` naming the pool, how many, and — since
2026-09-16 — the players in truncated form; the bundle is the full list. The entry
fee is OWED to each from the platform treasury — an off-chain payment nobody
else makes. Until the indexer carries a table and the admin CLI a command for
it (plan batch I1), the alert and the bundle are the record; pay it by hand and
note the signature beside the pool in the runbook.

**A prize is held.** That is escrow. Two different things put a share there and
they leave by different doors, so read the entry before acting: `flagged` is an
integrity flag, `sanctions_hold` is a list match. `admin.ts pools` and the
daemon's log line at payout both say which.

*A sanctions hold* (Stage F). The crank screened the wallet against published
lists before paying and would not send the share. It leaves by exactly one
door: `lift-sanctions-hold`, admin-signed, after a review establishes the match
was a false positive — then the ordinary flagged-entry doors below apply and
the seven-day safeguard has usually already run, so the player is paid
immediately. Nothing else moves it: not the twelve-hour clock, not the
seven-day release, not a forfeit, not us. If the reason logged was
`screening_unavailable` rather than `listed`, no list matched anything — the
screener could not answer. Fix the screener, re-screen the wallet by hand, and
lift if it is clean. Where a *confirmed* match's money finally goes is
counsel's question, still open; until it is answered the share stays in the
pool's vault, which is the safest place for it.

*An integrity flag.* Correct behaviour for a flagged entry. It leaves by one of
three doors: the settlement signer releases it after
review — and the daemon does this itself at twelve hours if no decision has been
made (the published rule; Stage D) — anyone releases it after seven days, or the
admin forfeits it and it is divided among the other eligible players at that
rank. Two things stop the twelve-hour clock (2026-09-12): a sanctions hold on
the same entry, which the program refuses to release on either path, and a
forfeit already logged by a reviewer — the daemon reads the decision log before
it releases, and once the window has passed with the on-chain `forfeit-escrow`
still unlanded it raises `reveal forfeit logged but not landed on chain`: the
multisig is late, and the share waits in the vault until it signs. It cannot come to us. A forfeit decided on the review page is logged at
once and answers "recorded"; you then land `forfeit-escrow` with the admin key.
The player may appeal within seven days from the results page; a *different*
reviewer decides it on the review page, which needs a second member in
`config/reviewers.json`. The daemon
drives `pay_next_place` itself (audit O23): on the tick after a forfeit it
divides the share among the eligible players at the rank it passes to, and
holds off while any other committed seat is still under review. A pool with a
held or forfeited share never reads as settled to the sweep, so it keeps being
revisited until the last lamport has reached a player.

**The treasury will not fund a pot.** `open_pool` refuses unless, after funding,
the treasury still holds the minimum balance plus one further pot for every
other idle enabled tier, plus every refundable entry. `admin.ts status` prints
all four numbers. Fund the treasury or disable a tier.

**Entries are being refused.** In order of likelihood: the pool is paused; the
territory check failed (it is fail-closed — no geo vendor configured, a lookup
failure, or an undetermined location all refuse); the terms version was bumped
and this wallet has not re-accepted; the packet expired (60 seconds); or the
wallet is one of the four service keys, which the program refuses by design.

**The site says no tournament is open.** Check whether a tier is in cooldown
(`GET /tiers` gives `next_open_at` per tier) before assuming a fault.

**Deploy went to the wrong commit.** Read the first log line of the service.
That is what `BLOTTO_BUILD_COMMIT` is for.

## 8. Keys — who holds what

| Key | Holder | Can |
|---|---|---|
| Program upgrade authority | The devnet fee payer today; a Squads vault before mainnet | Replace the program |
| Admin | Same, today | Every admin instruction, including `forfeit_escrow` and the one treasury exit |
| Keeper | The settlement key today | Open pools. No discretion over whether one opens — the program's gates decide |
| Entry signer | Turnkey, sign-only | Issue entry packets. Cannot move money |
| Settlement signer | A keypair file decoded into tmpfs at boot | Reveal, commit, pay, flag, clear, release, pay onward. Cannot withdraw anything |
| Pool secrets | Generated in-process, imported to Turnkey, export-locked | Decrypt a pool's entries — only after it seals |
| Irys upload wallet | The daemon | Pay for bundle publishing |

**None of these keys can take money out of a prize vault to anywhere but a
player.** The admin's only exit is the treasury's, and it is floor-guarded
on-chain.

Two things to fix before mainnet, both on the checklist in the audit report: the
upgrade authority and admin should be the Squads vault rather than a single fee
payer, and the settlement key should be Turnkey co-signed rather than a file.

## 9. What must never be done

- Add an exit to a prize vault. The set is four and CI asserts it.
- Add an instruction that can thaw a pass.
- Add any path that reads an allocation before its pool closes.
- Shorten or extend a live pool's deadline.
- Skip the drain before a program upgrade.
- Deploy the program and the migration transaction separately.
- Widen the language gate's exclusion list to make a change pass.

---

*Companion documents: [`AS-BUILT.md`](AS-BUILT.md) for what the system is,
[`hosting.md`](hosting.md) for the topology and the Helius webhook settings,
[`deploy-backend.md`](deploy-backend.md) and [`deploy-vercel.md`](deploy-vercel.md)
for the two deploy paths, [`devnet-rehearsal-runbook.md`](devnet-rehearsal-runbook.md)
for the sequenced upgrade window, and [`AUDIT-2026-09-07.md`](AUDIT-2026-09-07.md)
for the open items.*
