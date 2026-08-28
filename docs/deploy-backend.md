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
2. Click **Create token**, name it `blotto-deploy`, create it, and **copy
   the token text** — you'll paste it in Step 4. Treat it like a password:
   paste it only where Step 4 says, never into chat or email.

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

## Step 5 — Run the deploy (~10 min, mostly waiting)

1. In the repository, open the **Actions** tab.
2. In the left sidebar, click **deploy-backend**.
3. Click **Run workflow** (right side) → green **Run workflow** button.
4. Watch it run (click the job to see live logs). Green check = deployed;
   the last step prints the two service addresses and checks their health.

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

- **The location check runs in stub mode.** No geo-lookup vendor is
  contracted yet (roadmap R2), so the deployment uses the development
  stub: every visitor's location resolves as United Kingdom, which the
  schedule allows. That means the Belgium/Australia block is **not
  actually enforced** while the stub is in — acceptable on devnet where
  no real money moves, **not acceptable for launch**. Contracting the geo
  vendor is on the founder to-do list; the moment its two credentials are
  configured, the stub is ignored and fail-closed + the real block-list
  take over.
- **Two secrets are generated automatically on first deploy** (the entry
  signer's development key and the webhook shared secret) and kept stable
  across redeploys. The development entry signer is replaced by Turnkey
  custody at the credentialed rehearsal.
- **Troubleshooting — "name is taken":** Fly app names are global. If the
  log says `blotto-indexer` or `blotto-packet` is taken by someone else,
  tell me and I'll rename ours (a one-line change in `deploy/fly/`).
- **Troubleshooting — "timeout reached waiting for health checks":** the
  service is crashing at boot, and the most common cause is the database
  connection. Check that the `BLOTTO_DATABASE_URL` secret is Neon's full
  connection string ending in `?sslmode=require...` (Neon includes it by
  default — it is what turns encryption on). Re-paste the secret and run
  the workflow again; if it still fails, send the red step's message.

## What comes after (the next milestone)

The devnet rehearsal (`docs/devnet-rehearsal.md`): deploy the on-chain
program's config, fund the platform treasury with devnet SOL, start the
pool-opening daemon, and a first pool opens for real entries. That step
needs a funded devnet wallet and the Squads/Turnkey sandbox setup — I'll
write its founder runbook when you're ready.
