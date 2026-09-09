# Go-live on devnet — the founder's runbook

The manual steps, in the order that works, to have a pool live on a custom
domain on devnet, with the check that tells you each step worked. Written
2026-09-08/09 from live reads of the chain, the services, Vercel and Privy;
the interactive version was published as an artifact the same night.
Authoritative for *how the founder operates the devnet environment*; the
architecture and the admin-instruction reference stay in
`OPERATING-MANUAL.md`, `hosting.md` and `deploy-backend.md`.

Times are UTC.

## The whole night in five lines

1. **Helius** — new API key, delete the exposed one, create the webhook.
2. **GitHub** — store three values, run `deploy-backend`.
3. **Vercel + Privy** — attach the domain, set the variables, allow the domain in Privy, redeploy.
4. **Squads** — one transaction: unpause. Pool 1 is enterable the moment it lands.
5. **Testers** — a devnet wallet with 0.2 test SOL each, and the link.

Order matters for 1 → 2 → 3: the deploy needs the values from step 1, the
site needs the backend from step 2. Do step 4 last so the first entries land
on a site that can show them.

## 0. Where things stood (2026-09-08 22:46 UTC)

| Thing | State | Meaning |
|---|---|---|
| Program | current | all 18 instructions match `main`; Config migrated (12 h fill deadline, 5 min cooldown) |
| Entries | **paused** | `set_paused(true)` from the upgrade night still in force |
| Pool 1 | open, 0 entrants | fully launched; deadline 2026-09-09 04:47:22 UTC; carries the old 5.12 SOL pot and 72 h deadline copied at open |
| Treasury | 0.88 SOL | pool 1's refund returns 5.12 SOL, after which pool 2 (4 SOL pot) opens itself |
| Fly apps | all healthy | daemon ticking every 15 s, keeper wallet 1.99 SOL |
| Indexer data | **empty** | read API returns `[]`; the site says "No tournament is open" while pool 1 is open. Cause (found 2026-09-09 04:30 UTC, after this table was first written): the service never registered its event layouts, so every walk decoded nothing — a code defect, fixed in `backend/indexer/src/index.ts`. Fix: merge that change, redeploy (step 2), then run the `indexer-backfill` workflow once |
| Live site | today's code | `blotto-jade.vercel.app` serves Fair play, the wallet page and Phantom sign-in; Privy app id baked in; no Helius RPC; no faucet link |
| Privy | **wrong domains** | allowed domains list holds two stale preview hostnames only |
| Helius key | **exposed** | the key pasted into chat on 2026-09-08 must be replaced |

## 1. Helius (you, ~10 min) — dashboard.helius.dev

1. **New API key; delete the exposed one** (it begins `57302ce7`). Never paste
   the new key into a chat. Your devnet RPC URL is
   `https://devnet.helius-rpc.com/?api-key=NEW-KEY`. It must say **devnet**:
   the app refuses to build on a mainnet-looking URL, and the deploy workflow
   refuses one outright. If Helius offers access-control rules for the key,
   restrict it to your domain and `blotto-jade.vercel.app`: the browser build
   carries this key in public.
2. **Make up a webhook secret**: `openssl rand -hex 32` in a terminal, or a
   password-manager generator. The same string goes into the Helius webhook
   (next) and a GitHub secret (step 2).
3. **Create the webhook** (Helius → Webhooks → New):

   | Setting | Value |
   |---|---|
   | URL | `https://blotto-indexer.fly.dev:8080/webhook` |
   | Type | Raw |
   | Transaction types | All |
   | Account addresses | `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` |
   | Commitment | finalized |
   | Auth header | the secret from 1.2, exactly, no "Bearer" |
   | Network | Devnet |

   Without the webhook the site only learns about new entries when the
   indexer restarts.

## 2. GitHub (you, ~5 min + ~15 min waiting)

Repository → Settings → Secrets and variables → Actions.

**Secrets** (New repository secret, or Update):

| Name | Value |
|---|---|
| `BLOTTO_DEVNET_RPC_URL` | the devnet Helius URL from 1.1 |
| `BLOTTO_HELIUS_WEBHOOK_SECRET` | the string from 1.2 |

**Variables** (New repository variable):

| Name | Value |
|---|---|
| `BLOTTO_APP_ORIGINS` | your domain, its www form and the Vercel address, comma-separated, each `https://…`, no trailing slash. Example: `https://blotto.example,https://www.blotto.example,https://blotto-jade.vercel.app` |

Get the origins exactly right: the backend answers only browsers whose
origin is on this list, and a missing domain shows every visitor "Blotto Cup
is not available in your region" because the location check fails closed.
The deploy refuses a trailing slash or a non-https origin at preflight.

Then **Actions → deploy-backend → Run workflow** on `main`, "allow dev
credentials" unticked. The indexer deploys first; with an empty ledger its
boot-time walk fills the ledger from the program's history (sixteen
transactions today — seconds, on any RPC).

Check: `https://blotto-indexer.fly.dev/pools` shows pool 1 within a few
minutes of the indexer step; `https://blotto-daemon.fly.dev/health` says
`"ready":true`. If `/pools` is still `[]` fifteen minutes later, run
**Actions → indexer-backfill → Run workflow** (mode `both`) and read the
`inserted` count in its log: zero on a chain with pools means the code, not
the RPC (that was the 2026-09-09 incident).

## 3. Vercel (you, ~10 min) — project `blotto`

1. **Domain**: Settings → Domains → Add. Create the DNS records Vercel shows
   at your registrar. Check: the row reads "Valid configuration".
2. **Environment variables** (Production; tick Preview too if you want
   preview links to work). All are build-time; nothing changes until 3.3.

   | Name | Value | Note |
   |---|---|---|
   | `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` | new; explicit rather than implied |
   | `NEXT_PUBLIC_SOLANA_RPC_URL` | the devnet Helius URL | otherwise the public RPC, which rate-limits a room |
   | `NEXT_PUBLIC_PROGRAM_ID` | `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` | entry cannot be built without it |
   | `NEXT_PUBLIC_INDEXER_URL` | `https://blotto-indexer.fly.dev` | already set |
   | `NEXT_PUBLIC_ENTRY_API_URL` | `https://blotto-packet.fly.dev` | already set |
   | `NEXT_PUBLIC_REVIEW_API_URL` | `https://blotto-review.fly.dev` | missing today; powers the appeal panel |
   | `NEXT_PUBLIC_DEVNET_FAUCET` | `1` | the "Get test SOL" link; testers cannot pass the balance check without it |
   | `NEXT_PUBLIC_PRIVY_APP_ID` | `cmtbyp3yk00zf0djxkym3cdqz` | already set |

   Must stay **absent**: `NEXT_PUBLIC_ALLOW_TEST_SIGNER` (on a public site it
   lets any script sign as any wallet) and `NEXT_PUBLIC_TOPUP_ENABLED`
   (funding is off in Privy; nothing sells devnet SOL).
3. **Redeploy**: Deployments → newest Production → ⋯ → Redeploy. Check:
   `/wallet` and `/fair-play` load on your domain; once step 2's indexer has
   pool 1, the landing hero shows "Enter this tournament".

## 4. Privy (you, ~5 min) — dashboard.privy.io, app "Blotto"

1. **Allowed domains**: add `https://your-domain`, `https://www.your-domain`
   if live, and `https://blotto-jade.vercel.app`. Remove the two stale
   entries. Check: "Continue with Google" completes on your domain. The page
   saying "Sign-in is not switched on for this web address yet" means the
   domain is not on the list exactly as typed.
2. **Login methods**: Google on, X on, External wallets on with Solana (all
   already on). **Apple** is off in Privy and needs an Apple developer
   account plus a Services ID; leave it off and have the button removed.
3. **Embedded wallets → Solana**: create on login = users without wallets
   (already). Confirm key export is allowed (the "Move my wallet to Phantom"
   button depends on it). Leave Funding off.

## 5. Squads (you, ~5 min) — the unpause

Phantom on **Devnet**, wallet `4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1`.
app.squads.so → multisig `9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN` →
New transaction → Custom instruction:

| Field | Value |
|---|---|
| Program | `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` |
| Account 1 | `9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z` · signer · not writable |
| Account 2 | `6Q3HReRVp4fND7wCuYSpRDPbz5KsQR7cbEwApVUhPzDa` · writable · not signer |
| Data (base58) | `2AMgDu5cpQDDq` |

Simulate → Create → Approve → Execute. **Unpause ends in `q`; pause ends in
`r`** (`2AMgDu5cpQDDr`). Pausing blocks new entries only; settlement and
refunds keep running either way.

Optional, same accounts, whenever convenient and **before any of tiers 1–6
is ever opened**: the six tier price/pot corrections (runbook §E1 step 3c):
tier 1 `kCreiVvDcePFMrTTBWdKnTA8KLqp2QNMh9` · tier 2
`kCreiVvDcePGBEWjYCzPcHtGE9e8wwG44o` · tier 3
`kCreiVvDcePGT8GMwdeqD5kQ8zFNWFDoVH` · tier 4
`kCreiVvDcePGzm4LXQWLZaixsej4wVaMHh` · tier 5
`kCreiVvDcePHYNMfdoaQtcMbncmuL3Djhh` · tier 6
`kCreiVvDcePJ5yf17XMCPBTVfQVYWeTWjh`.

## 6. Testers

Tell them: this is a test network; nothing costs or pays real money. A
wallet on Solana **devnet** with at least **0.2 test SOL** (the gate needs
0.11: 0.1 entry + 0.01 fees and rent). Sign in with Google (a wallet is made
for them) or switch Phantom to devnet (Settings → Developer settings →
Testnet mode) and tap Phantom on the sign-in page. Profile → **Get test SOL**
→ airdrop to the address shown (faucet.solana.com is rate-limited; if it
refuses, send 0.2 SOL from your Phantom on devnet). Then Enter this
tournament: seven battles, about ninety seconds. Fewer than 52 entrants at
the deadline means everyone is refunded automatically.

Location is checked by IP against `config/territories.json` (currently BE
and AU blocked); a VPN can be refused. The age/terms screen is signed once
per wallet per terms version.

**Timeline, automatic from the unpause:**

| When | What |
|---|---|
| after unpause | pool 1 takes entries; each sends 0.1 SOL to the treasury and mints a pass |
| 04:47:22 UTC, 9 Sept | pool 1 deadline; under 52 entrants the daemon triggers the refund; every entrant gets 0.1 SOL back; 5.12 SOL returns to the treasury |
| ~04:52 UTC | cooldown over; the daemon opens pool 2: 4 SOL pot, 0.1 SOL entry, 12 h deadline |
| ~16:52 UTC | pool 2 deadline: ≥52 seals, reveals, scores and pays within minutes; fewer refunds, pool 3 five minutes later |

A paid result needs 52 real entries. The first night proves sign-in,
wallets, entry, sealing and refunds.

## 7. Pausing, stopping, redeploying

| Want to | Do | Effect |
|---|---|---|
| Stop new entries | Squads, data `2AMgDu5cpQDDr` | entries refused on chain; open pools still refund or settle. Players now see "Entries are paused right now" |
| Resume | Squads, data `2AMgDu5cpQDDq` | entries accepted; the daemon resumes opening pools |
| Take the site down | Vercel → Settings → Domains → remove the domain | nothing on chain changes; prefer pausing |
| Ship a front-end change | nothing; a merge to `main` deploys to Vercel in ~3 min | variable changes need a manual Redeploy |
| Ship a backend change | Actions → deploy-backend → Run workflow | deliberately manual; a pool mid-settlement resumes |
| See what is running | Actions → backend-status → Run workflow | read-only forensics for all four apps |
| Rebuild the indexer | Actions → indexer-backfill → Run workflow | idempotent; walks the chain into the ledger and rebuilds derived tables |
| Stop the keeper | ask the architect, or `fly scale count 0 -a blotto-daemon` | also stops settlement and refunds; emergency only |

## 8. If something breaks

| What a player sees | Almost always | Fix |
|---|---|---|
| "not available in your region" for everyone | domain missing from `BLOTTO_APP_ORIGINS`, or packet down | check `blotto-packet.fly.dev/health`; fix the variable; re-run deploy-backend |
| "Sign-in is not switched on for this web address yet" | domain not in Privy allowed domains | step 4.1; immediate |
| sign-in buttons disabled, "temporarily unavailable" | Privy app id missing or rejected in the build | Vercel variable, then Redeploy |
| "No tournament is open" while a pool is open | indexer has no data | `blotto-indexer.fly.dev/pools`; if `[]`, run indexer-backfill and read its `inserted` count (zero = code defect, see the incident note in `backend/indexer/src/index.ts`) |
| "Entries are paused right now" | paused | step 5 |
| "Your wallet is not ready" after sign-in | embedded wallet creation off, or Privy still initialising | step 4.3; reload once |
| "Entering this pool takes about 0.11 SOL…" | not enough test SOL | faucet, or send from your Phantom |
| a pool past its deadline that does not refund | daemon down | `blotto-daemon.fly.dev/health`: a stale `lastTick.at` means run backend-status and send the log. Refunds are also permissionless |

## Addresses

| | |
|---|---|
| Program | `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` |
| Config | `6Q3HReRVp4fND7wCuYSpRDPbz5KsQR7cbEwApVUhPzDa` |
| Squads multisig | `9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN` |
| Squads vault = admin | `9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z` |
| Bank wallet (Phantom) | `4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1` |
| Platform treasury | `CMFfvTpbsnjMSWhjpnivQ17kWiG5qD88gPND54tZxTqh` |
| Keeper / settlement | `EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD` |
| Pool 1 | `BifGHwmQqc5ebEMsMJEq4Srg42bVizcZx4wH85rnMae4` |
| Unpause / pause data | `2AMgDu5cpQDDq` / `2AMgDu5cpQDDr` |
| Health | `blotto-{indexer,packet,review,daemon}.fly.dev/health` |
