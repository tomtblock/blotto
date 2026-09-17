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

## Step 2 — Create a deploy token (~4 min, in the terminal)

**This must be an *organization* token, and the dashboard cannot create one.**
Since 5 Sep 2026 an organization on this account requires Single Sign On, and
Fly no longer honours account-level "personal access tokens" — the dashboard
refuses to create them and the existing ones stopped authenticating. The Fly
tokens page says as much in a yellow banner.

Open a terminal and run these four, one at a time:

```bash
fly auth login      # opens a browser; complete the sign-in there
fly auth whoami     # should print your email
fly orgs list       # note the SLUG of the org that owns the blotto apps
fly apps list       # blotto-indexer and blotto-packet should both be listed
```

Then create the token, substituting the slug from `fly orgs list`:

```bash
fly tokens create org --org <slug> --name blotto-deploy-ci
```

It prints one long line. **Copy the whole line, including the leading
`FlyV1 ` and the space after it** — a Fly token contains a space, and a copy
that starts at `fm2_` authenticates against nothing and fails exactly like a
rejected one. You'll paste it in the next step but one. Treat it like a
password: paste it only into the GitHub secret field, never into chat or
email.

The default expiry is about twenty years, so this is not a recurring chore.
What is worth writing into the key register in
`docs/devnet-rehearsal-runbook.md` is the **org slug** and the date you
created it — the org is the thing that scopes what this token may do.

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
4. Three more values are yours to set here and change later without a code
   change (each falls back to a sensible default when absent — see
   `go-live-devnet.md` for the night they were introduced):
   - Secret `BLOTTO_DEVNET_RPC_URL` — a **devnet** Helius RPC URL. Every
     service and the drift check use it; the deploy refuses a mainnet-looking one.
   - Secret `BLOTTO_HELIUS_WEBHOOK_SECRET` — the exact Auth-header string you
     typed into the Helius webhook (`hosting.md`, E6). **This one is now
     required**: without it the run stops in its checks and names it, because
     a deploy that cannot take in live data is not a deploy. The only way
     past it is the "DEV ONLY" box, for an environment that has no webhook
     yet.
   - **Variable** (the *Variables* tab, not *Secrets*) `BLOTTO_APP_ORIGINS` —
     every browser origin the services may answer, comma-separated, each
     `https://…` with no trailing slash: your domain, its www form, the
     Vercel address.

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
| `EMAIL_API_URL` | the mail provider's send endpoint, for the one-message opt-in (Resend: `https://api.resend.com/emails`) — optional, all three or none | packet |
| `EMAIL_API_KEY` | the provider's API key — optional, with the two beside it | packet |
| `EMAIL_FROM` (a **Variable**, not a secret) | the sending address on a domain the provider has verified, e.g. `Blotto Cup <hello@blotto.gg>` | packet |
| `SANCTIONS_CHAINALYSIS_API_KEY` | Chainalysis (optional — the OFAC SDN mirror runs without it) | packet |
| `SANCTIONS_OPENSANCTIONS_API_KEY` | OpenSanctions (optional, cross-check) | packet |
| `TURNKEY_USER_ID` | Turnkey console | daemon |
| `SWITCHBOARD_QUEUE` | Switchboard On-Demand queue (public config) | daemon |
| `IRYS_UPLOAD_KEY` | the funded Irys wallet's secret key, base58 | daemon |
| `SETTLEMENT_SIGNER_KEYPAIR_B64` | `base64 -w0 < settlement-keypair.json` | daemon + review |

The daemon and the review service are deployed **only once their secrets are
all present** — until then the run says which one it is waiting on and skips
them, rather than deploying something that cannot start.

## Step 5 — Run the deploy (~10 min, mostly waiting)

**Two things have to be true before anything is deployed**, and the run now
checks both itself, in a first step that runs before it touches Fly:

- **It has to be run on `main`.** Started from any other branch, the run
  stops straight away and prints the branch you gave it. There is no
  override for this one: the way to deploy a branch is to merge it first.
- **The tests for that exact commit have to have passed.** The run finds the
  `ci-fast` result for the commit it is about to deploy. If those tests are
  still queued or still going it waits for them — up to about ten minutes,
  printing which lane it is waiting on. If they failed, or if they never ran
  at all, it stops. If the on-chain tests also ran for that commit and
  failed, it stops as well.

A refusal is a red first step within a minute or so of clicking, naming
either the branch or the test lane. **Nothing is deployed and nothing on any
app is changed**, so once the branch or the tests are sorted you simply run
it again.

1. In the repository, open the **Actions** tab.
2. In the left sidebar, click **deploy-backend**.
3. Click **Run workflow** (right side). Leave the branch box on **main** →
   green **Run workflow** button.
4. Leave the **"DEV ONLY"** box UNCHECKED once every credential is in hand.
   Before then it lets the deploy fall back **only where a production
   credential is missing** — so between C1 and C2, with Turnkey set but no
   geo vendor yet, checking it keeps the real Turnkey signer and stubs only
   the geo lookup. It never downgrades something already real, and the run
   warns by name for each fallback it takes.
5. Leave the second box, **`deploy_despite_red_ci`**, UNCHECKED as well. It
   is the only override the first step has, and it covers **only the test
   half**: ticked, it lets a red or missing test result through, prints a red
   line naming the lane that was red, and records that you chose it, so the
   run says plainly what it went ahead without. It exists because `ci-fast`
   also checks the website, so a fault on the website side would otherwise
   block a backend-only fix. It does **not** let you deploy from a branch,
   and it has nothing to do with credentials — the "DEV ONLY" box above is
   the one about those.
6. Watch it run (click the job to see live logs). Green check = deployed.
   The final step prints **which signer and which randomness source each
   service actually chose** — that is the real acceptance check. A
   credentialed run reads `entry signer = TURNKEY`, shows no `GEO STUB`
   line, and reads `VRF = SWITCHBOARD On-Demand`. Anything else means a
   development path is live even though the deploy went green.
7. After the services are up the run proves two more things rather than
   assuming them: that the indexer really accepts the shared webhook secret
   it was given (see the small print below — a wrong secret used to go green
   and leave the site's data feed shut), and that the deployed on-chain
   program still matches this backend. Either one failing turns the run red
   after a successful deploy; both are in the small print.

If it fails, copy the red step's message to me and I'll fix it.

## Step 6 — Point the site at the services (~3 min)

1. Open **vercel.com** → the **blotto** project → **Settings** →
   **Environment Variables**.
2. Add these, for the **Production** environment:
   - `NEXT_PUBLIC_INDEXER_URL` → `https://blotto-indexer.fly.dev`
   - `NEXT_PUBLIC_ENTRY_API_URL` → `https://blotto-packet.fly.dev`
   - `NEXT_PUBLIC_REVIEW_API_URL` → `https://blotto-review.fly.dev`
   - `NEXT_PUBLIC_SOLANA_CLUSTER` → `devnet`
   - `NEXT_PUBLIC_SOLANA_RPC_URL` → the same devnet Helius URL as the
     `BLOTTO_DEVNET_RPC_URL` secret (this one is public — it ships in the browser)
   - `NEXT_PUBLIC_DEVNET_FAUCET` → `1` (testers' "Get test SOL" link)
   The full table, with what each does, is in `go-live-devnet.md` §3.
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
- **Sanctions screening is live at entry** (since 2026-09-07). Every run
  stages `SANCTIONS_OFAC_SDN=1`, so the packet service downloads the OFAC
  SDN list before it listens and refuses to start if it cannot; the two
  vendor keys are optional and add sources when present. A listed wallet
  gets the same generic refusal as a blocked territory. The development
  stub is never staged by this workflow.
- **One secret can be generated automatically** — the Helius webhook shared
  secret. It is ours to issue: no external party holds an authoritative copy.
  Since 2026-09-12 it is generated **only** on a "DEV ONLY" run, because a
  value generated here can never be read back out of Fly, so no webhook can
  be told it: ingest stayed shut for ever and the run said so only as a
  warning. Set it yourself (Step 4) and the run **proves** it is accepted
  before finishing (the ingest-check note below).
  Nothing else is ever generated. The deploy used to create a development entry-signer seed
  and set the geo stub on every run, which silently undid a credential swap
  at the next deploy click; both are now removed, and the workflow actively
  clears them from the app once the real credentials are staged.
- **Troubleshooting — `Unauthorized` or "You must be authenticated to view
  this":** Fly is refusing our credential outright. The tell is that the
  token still appears in the dashboard, unrevoked and unexpired — nothing
  there looks wrong, because it is the *type* of token that is no longer
  accepted, not that particular one. This is what happened on 2026-09-05:
  an organization on the account began requiring SSO and every
  account-level personal access token stopped working at once. Create an
  **org** token (Step 2) and update the secret (Step 4). The same event
  also breaks `fly` on your own laptop until you re-run `fly auth login`,
  so an empty `fly logs` while this is unfixed is not evidence about the
  service. **Nothing was deployed** and nothing was changed on any app, so
  re-running after replacing the token is safe. The run now stops for this
  in its first Fly step, naming the token; before 2026-09-05 it surfaced
  four steps later as the misleading `blotto-indexer has no public IPs`.
- **Troubleshooting — "name is taken":** Fly app names are global. If the
  log says `blotto-indexer` or `blotto-packet` is taken by someone else,
  tell me and I'll rename ours (a one-line change in `deploy/fly/`).
- **Troubleshooting — "timeout reached waiting for health checks":** the
  service is crashing or stalling at boot. Open the app's Monitoring page
  on Fly.io (the deploy log prints the link) — the last lines there name
  the actual error. Send me that message and I'll fix it.
- **Troubleshooting — the run goes red on the ingest check, saying the
  indexer refused our webhook credential:** the two ends are holding
  different secrets. The run sends the indexer one deliberately incomplete
  test message and insists the answer is "I don't like that message", not
  "I don't know you"; the second answer is this failure. It means the
  services are deployed but the site's live data feed would have stayed shut,
  which is exactly what used to pass as a green run with a warning. Nothing
  is written to the database by the test. Fix it by making
  `BLOTTO_HELIUS_WEBHOOK_SECRET` (Step 4) exactly the string in the Helius
  webhook — or, if the deploy issued the secret itself, tell me and I'll
  re-issue it — then run the deploy again. If instead the step says the
  ingest port did not answer at all, that is the indexer's second port not
  being reachable from outside rather than a wrong secret; the step prints
  the remedies in order — send me that message.
- **Troubleshooting — the run goes red at the very end, on the deployed
  program comparison:** the services deployed fine, but the on-chain program
  running on devnet is not the one this backend expects. It is the same check
  as **Actions → deployed-drift**, run again here so a mismatch surfaces in
  the same click rather than the next day. Almost always it means the program
  was upgraded and the backend was not, or the reverse. Send me the step's
  output; nothing needs undoing in the meantime.

## What comes after (the next milestone)

The devnet rehearsal (`docs/devnet-rehearsal.md`): deploy the on-chain
program's config, fund the platform treasury with devnet SOL, start the
pool-opening daemon, and a first pool opens for real entries. That step
needs a funded devnet wallet and the Squads/Turnkey sandbox setup — I'll
write its founder runbook when you're ready.
