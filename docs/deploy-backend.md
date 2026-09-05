# Deploying the backend — founder runbook

This is the click-by-click guide for putting the two backend services live
(the **indexer**, which feeds the site real pool data, and the **packet
service**, which answers the location check and authorises entries). It is
written for the founder; no terminal needed. The technical companion is
`docs/hosting.md`.

**What this unlocks:** the "Not available here" screen goes away, the site
stops showing placeholder fixture data, and sign-in → location check →
attestation all work end to end.

**What it does NOT unlock yet** (honest scope): there will be **no open
pool to enter** until the on-chain side is initialised on devnet (the
program config, a funded treasury, and the pool-opening daemon — the
devnet rehearsal, `docs/devnet-rehearsal.md`). The site will say "No
tournament is open for entries right now", which is the true state. That
is the milestone after this one.

---

## Step 1 — Create a Fly.io account (~5 min)

Fly.io is where the two services run (Frankfurt, EU — our hosting rule).

1. Go to **fly.io** and click **Sign Up** (sign up with GitHub is easiest).
2. Add a payment card when asked (Settings → Billing). The two small
   machines this deploys cost roughly **$5–10/month** total.

## Step 2 — Create a deploy token (~2 min)

1. In the Fly.io dashboard, open **Tokens** (under your account/organization
   settings), or go to **fly.io/user/personal_access_tokens**.
2. Click **Create token**, name it `blotto-deploy`, set the expiry
   explicitly to the longest option offered, and create it.
3. **Copy the whole token, including the leading `FlyV1 ` and the space
   after it.** A Fly token contains a space; a copy that starts at `fm2_`
   authenticates against nothing and fails exactly like an expired one.
   You'll paste it in the next step but one. Treat it like a password:
   paste it only into the GitHub secret field, never into chat or email.

Then write the token's **expiry date** into the key register in
`docs/devnet-rehearsal-runbook.md`. A token that lapses mid-rehearsal stops
every deploy, and the failure does not announce itself as an expiry — see the
troubleshooting note near the end of this document.

## Step 3 — Create the database (~5 min)

We use Neon, a managed Postgres with an EU region and a free tier that is
fine for devnet.

1. Go to **neon.tech** → **Sign up** (GitHub sign-in works).
2. Create a project: name `blotto`, and for the region pick
   **Europe (Frankfurt)** — this matters; our data stays in the EU.
3. On the project dashboard, find **Connection string** and copy the URI
   that starts with `postgresql://…`. (If there is a "Pooled connection"
   toggle, the pooled one is fine.) Same rule: paste it only in Step 4.

## Step 4 — Put both values into GitHub's secret store (~3 min)

GitHub encrypts these; nobody (me included) can read them back out —
the deploy automation can only *use* them.

1. Open **github.com/tomtblock/blotto** → **Settings** tab →
   **Secrets and variables** → **Actions**.
2. Click **New repository secret**:
   - Name: `FLY_API_TOKEN` — Secret: paste the token from Step 2 → **Add secret**.
3. Click **New repository secret** again:
   - Name: `BLOTTO_DATABASE_URL` — Secret: paste the connection string
     from Step 3 → **Add secret**.

### The credentialed secrets (added as each one is provisioned)

The deploy **never invents a credential**. Each of these is created by you
in the vendor's console and pasted here once; a missing one is reported by
name in the run's first step, before anything is deployed.

| Secret | From | Needed for |
|---|---|---|
| `TURNKEY_API_BASE_URL` | Turnkey console | packet + daemon |
| `TURNKEY_API_PUBLIC_KEY` | Turnkey console | packet + daemon |
| `TURNKEY_API_PRIVATE_KEY` | Turnkey console (shown once) | packet + daemon |
| `TURNKEY_ORGANIZATION_ID` | Turnkey console | packet + daemon |
| `ENTRY_SIGNER_KEY_ID` | Turnkey entry-signer key | packet |
| `ENTRY_SIGNER_PUBLIC_KEY_HEX` | that key's public key, hex | packet |
| `GEO_VENDOR_URL` | the geo vendor | packet |
| `GEO_VENDOR_API_KEY` | the geo vendor | packet |
| `TURNKEY_USER_ID` | Turnkey console | daemon |
| `SWITCHBOARD_QUEUE` | Switchboard On-Demand queue (public config) | daemon |
| `IRYS_UPLOAD_KEY` | the funded Irys wallet's secret key, base58 | daemon |
| `SETTLEMENT_SIGNER_KEYPAIR_B64` | `base64 -w0 < settlement-keypair.json` | daemon + review |

The daemon and the review service are deployed **only once their secrets are
all present** — until then the run says which one it is waiting on and skips
them, rather than deploying something that cannot start.

## Step 5 — Run the deploy (~10 min, mostly waiting)

1. In the repository, open the **Actions** tab.
2. In the left sidebar, click **deploy-backend**.
3. Click **Run workflow** (right side) → green **Run workflow** button.
4. Leave the **"DEV ONLY"** box UNCHECKED once every credential is in hand.
   Before then it lets the deploy fall back **only where a production
   credential is missing** — so between C1 and C2, with Turnkey set but no
   geo vendor yet, checking it keeps the real Turnkey signer and stubs only
   the geo lookup. It never downgrades something already real, and the run
   warns by name for each fallback it takes.
5. Watch it run (click the job to see live logs). Green check = deployed.
   The final step prints **which signer and which randomness source each
   service actually chose** — that is the real acceptance check. A
   credentialed run reads `entry signer = TURNKEY`, shows no `GEO STUB`
   line, and reads `VRF = SWITCHBOARD On-Demand`. Anything else means a
   development path is live even though the deploy went green.

If it fails, copy the red step's message to me and I'll fix it.

## Step 6 — Point the site at the services (~3 min)

1. Open **vercel.com** → the **blotto** project → **Settings** →
   **Environment Variables**.
2. Add these two, for the **Production** environment:
   - `NEXT_PUBLIC_INDEXER_URL` → `https://blotto-indexer.fly.dev`
   - `NEXT_PUBLIC_ENTRY_API_URL` → `https://blotto-packet.fly.dev`
3. Go to the **Deployments** tab, open the **⋯** menu on the newest
   deployment → **Redeploy** (env changes need a redeploy to take effect).

## Step 7 — See it

Open **blotto-jade.vercel.app**, hard-refresh (**Ctrl+Shift+R** /
**Cmd+Shift+R**), sign in. The "Not available here" screen is gone; the
site shows the real (empty) devnet state.

---

## Honest small print

- **The location check is live** (IPLocate, since 2026-08-31). Both
  `GEO_VENDOR_URL` and `GEO_VENDOR_API_KEY` are configured, so the
  development stub — which resolved every visitor as United Kingdom and
  therefore enforced nothing — is ignored, and the run's final step prints
  a line if it ever comes back. Ticking `allow_dev_credentials` would
  restore that stub wherever a production credential is absent; leave it
  unticked. A vendor outage or an exhausted quota refuses the entry and
  says so in the log as `LOOKUP FAILED (this is NOT a territory
  decision)`, which is how it tells itself apart from a real country
  block.
- **One secret is generated automatically** — the Helius webhook shared
  secret, on first deploy, kept stable across redeploys. It is ours to
  issue: no external party holds an authoritative copy. Nothing else is
  ever generated. The deploy used to create a development entry-signer seed
  and set the geo stub on every run, which silently undid a credential swap
  at the next deploy click; both are now removed, and the workflow actively
  clears them from the app once the real credentials are staged.
- **Troubleshooting — `Unauthorized` or "You must be authenticated to view
  this":** Fly is refusing our credential outright. `FLY_API_TOKEN` is
  present but no longer valid — expired, revoked, or pasted without its
  leading `FlyV1 ` prefix. Create a new token (Step 2) and update the
  secret (Step 4). **Nothing was deployed**, and nothing was changed on
  any app, so a re-run after replacing the token is safe. If a brand-new
  token fails the same way, the problem is the Fly *organization* rather
  than the token — check Billing before creating a third one. The run now
  stops for this in its first Fly step, naming the token; before
  2026-09-05 it surfaced four steps later as the misleading
  `blotto-indexer has no public IPs`.
- **Troubleshooting — "name is taken":** Fly app names are global. If the
  log says `blotto-indexer` or `blotto-packet` is taken by someone else,
  tell me and I'll rename ours (a one-line change in `deploy/fly/`).
- **Troubleshooting — "timeout reached waiting for health checks":** the
  service is crashing or stalling at boot. Open the app's Monitoring page
  on Fly.io (the deploy log prints the link) — the last lines there name
  the actual error. Send me that message and I'll fix it.

## What comes after (the next milestone)

The devnet rehearsal (`docs/devnet-rehearsal.md`): deploy the on-chain
program's config, fund the platform treasury with devnet SOL, start the
pool-opening daemon, and a first pool opens for real entries. That step
needs a funded devnet wallet and the Squads/Turnkey sandbox setup — I'll
write its founder runbook when you're ready.
