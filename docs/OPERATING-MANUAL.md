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

## 5. Admin transactions

`npm run admin -- <command>` from the repo root. `status` and `pools` are reads
and safe. Everything else is founder-signed.

| Command | What it changes |
|---|---|
| `status` | Reads Config: keys, tiers, prices, pots, switches, treasury, timings |
| `pools` | Reads every pool and its state — the drain check |
| `init-config` | One-time setup. Signer becomes admin |
| `migrate-config` | One-shot account growth after a layout upgrade. Self-disabling |
| `set-keeper` | Rotates the key allowed to open pools |
| `set-pool-timing` | The fill deadline and cooldown for **future** pools |
| `set-open-tiers` | Which tiers may open a pool |
| `set-tier-economics` | One tier's price and pot. Refuses a pot at or above 52 × price |
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
64th seat, or the deadline with ≥ 52          the deadline with < 52
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
rank. It cannot come to us. A forfeit decided on the review page is logged at
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
