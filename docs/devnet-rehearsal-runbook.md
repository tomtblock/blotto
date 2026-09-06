# Devnet rehearsal — operating runbook (Phase 5, credentialed run)

**What this is.** The order of operations, the role split, and the verification for
the *credentialed* devnet rehearsal. It is the companion to
[`devnet-rehearsal.md`](devnet-rehearsal.md), which stays canonical for the admin
CLI's worked examples and for the OFFLINE rehearsal that runs in CI today. Numbers
are not restated here: tier prices and pots are
`programs/blotto_cup/src/constants.rs`, the territory schedule is
`config/territories.json`, phase scope and the register are `BUILD-ROADMAP_v1.0.md`.

**Legend:** **[YOU]** founder · **[ARCH]** architect · **[BOTH]** live session ·
**⚠ IRREVERSIBLE**

**Before any step:** `cd ~/blotto-cup && git fetch origin main && git status`, then
fast-forward. Use `git fetch`, never the combined fetch-and-merge command — its verb
is on the §8.7 list, and `scripts/check-language.sh` fails the standing-rules lane on
any file containing it. The original draft's standing rule 1 would not have merged.

---

## STANDING RULES

1. Every `solana` command carries an explicit `-k <path>`. The CLI default is
   `fee-payer-devnet.json` = `GXKX…`, which holds upgrade authority. Never sign by
   default. **Confirmed by incident, 2026-09-05**: a transfer that lost its `-k`
   was signed by `GXKX…` anyway, because that key IS the CLI default. The rule is
   not a precaution, it is the only thing standing between a dropped flag and the
   upgrade authority signing something nobody chose.
2. **Every command written for the founder is ONE line.** No backslash
   continuations, no multi-line blocks. Pasting a continued command into the
   terminal can insert blank lines, which end the command early: on 2026-09-05
   `solana transfer <addr> 0.5 \` + `-k …` + `-u devnet` ran as a transfer with
   NO flags, followed by two `command not found` errors. It succeeded, on whatever
   the CLI defaults happened to be. A command that loses its flags and still works
   is the worst shape available — it reports success while doing something else.
3. Secrets are typed into destination fields, never pasted into chat, files, commits
   or logs.
4. A service refusing to start on a missing credential is correct. Never loosen it.
5. If a verification fails, stop. Do not proceed with a half-working credential
   behind you.
6. Ask "what would distinguish this explanation from the alternatives" before
   approving any fix.

## KEY REGISTER

| Name | Address / path | Role |
|---|---|---|
| Program | `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` | deployed devnet program |
| Squads vault | `9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z` | **becomes `Config.admin`** |
| Squads multisig | `9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN` | **never `--admin`** |
| Bank wallet | `4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1` | funds entrants; Squads member |
| Deploy keypair | `~/.config/solana/blotto/fee-payer-devnet.json` = `GXKXLYHBWBAhp7LWNMEZbsuwGb3WHeoDBsmhfndwagXY` | upgrade authority; retire after C4. **Confirmed 2026-09-05 against the chain**, not against a document: the program's ProgramData account (`52jz82LJAuMdkiVqjat5ipqV1WXH26dutAuU3Wowfend`) names this key as upgrade authority. Verify with `solana address -k <path>` before C4 — if the file disagrees, stop |
| Program keypair | `~/.config/solana/blotto/blotto_cup-program-devnet.json` | `BLOTTO_PROGRAM_KEYPAIR` |
| Irys wallet | `~/.config/solana/blotto/irys-devnet.json` (`HG56…`) | `IRYS_UPLOAD_KEY` source |
| Fly deploy token | GitHub secret `FLY_API_TOKEN` · **must be an ORG token** (`fly tokens create org --org <slug>`) · org slug: `personal` (the only org on the account; both apps owned by it) · created: 2026-09-05 | every backend deploy. Account-level personal access tokens stopped authenticating on 2026-09-05 when an org on the account began requiring SSO; the dashboard cannot create the replacement |
| **Settlement signer** | `EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD` · staged as `SETTLEMENT_SIGNER_KEYPAIR_B64` | `Config.settlement_signer`. **MUST HOLD SOL** — it pays the fee and the account rent for every daemon instruction. Funded at C6.1; the daemon refuses to start below 0.05 SOL |
| Config PDA | `6Q3HReRVp4fND7wCuYSpRDPbz5KsQR7cbEwApVUhPzDa` | read it back with `solana account` when a value is in doubt; the chain is the register's referee |
| **Entry signer** (VERIFIED 2026-08-31) | Turnkey `blotto-entry-signer-devnet`, Ed25519, non-exportable · key id `79672a1a-3c43-481a-a304-82f0ee10709c` · address `9XhwKrXjKwFdYJatxYMZYyfB6nFLbmdFNSuM5JTyy8TP` · `ENTRY_SIGNER_PUBLIC_KEY_HEX` = `7ebb34f6a4a985b0e3fc5a2ab0488cae67e4c7577b2c75dc21eac677a922a4b6` | goes on-chain as `Config.entry_signer` at C3 |

**The entry signer is confirmed end to end**: `npm run check-signer` in
`backend/packet` had Turnkey sign a payload with that key and verified the result
against the hex above, and the address matches the console. Changing it after C3 is an
admin-signed `register-signers --entry-signer` rotation, not a redeploy.

---

# STAGE B — ARCHITECT PREREQUISITES

These are code changes, not credential steps, and every one of them gates a Stage C
step. None is on `main` today.

**B-a. Deploy-lane credential fix — LANDED.** `deploy-backend.yml` no longer creates
any credential. It stages `TURNKEY_*`/`ENTRY_SIGNER_*`/`GEO_VENDOR_*` from repository
secrets, actively clears `ENTRY_SIGNER_SEED_HEX` and `GEO_STUB_COUNTRY` from the app
once the real ones are staged, and fails in preflight naming any missing secret.
Running with development credentials is now an explicit tick-box in the Actions UI
(`allow_dev_credentials`, default off) that warns loudly — never a silent fallback.
The final step prints which signer and which randomness source each service actually
chose, so a green deploy that quietly took a dev path is visible in the run itself.

**B-b. The IPLocate adapter is not written.** `VendorHttpGeoLookup`
(`backend/packet/src/geo-adapters.ts`) is a generic seam, and says so in its own
doc comment. It sends `Authorization: Bearer <key>`, appends `?ip=<addr>` to the
URL, and expects a body of `{country, region, vpnOrProxy}`. IPLocate answers a
different shape, so the seam as-is throws on every lookup and blocks everyone.
C2 needs a concrete adapter, its known-vector tests, and the header/URL/body facts
re-derived from what actually ships.

**B-c. Admin CLI setters — LANDED.** `scripts/admin.ts` now carries `set-paused`,
`set-vault-ceiling`, `set-kyc-threshold`, `set-detection-hard-block`,
`set-tier-economics` and `set-treasury-policy`, all with `--emit-proposal`. Drill
5.2 is unblocked. Every discriminator was checked against an independent
`sha256("global:<name>")`, and the client-side guards (tier range, strict booleans,
the pot's 1024-lamport divisibility) reject before a proposal is ever raised.

**B-d. Daemon and review deployment — LANDED.** Both are in `deploy-backend.yml`,
with the same public-IP, machine-started and honest-smoke-check hardening the other
two services have. Each deploys only once all of its secrets exist; until then the run
names the one it is waiting on and skips it, rather than deploying something that
cannot start. The settlement keypair travels as `SETTLEMENT_SIGNER_KEYPAIR_B64` and is
decoded to tmpfs at boot by `deploy/docker/entrypoint-settlement.sh` (C6 option (a)) —
which refuses to start on an absent, malformed, or wrong-length secret. Note the review
service's image runs `backend/detection/src/main.ts`; there is no `backend/review/`.

**B-e. The test signer is unbuilt.** `app/src/tx/test-signer.ts` exists and is
imported by nothing; `NEXT_PUBLIC_ALLOW_TEST_SIGNER` appears nowhere; there is no
CI grep. C7 is build work, not wiring.

**B-f. The bank/recycle harness does not exist.** Budget it.

---

# STAGE C — CREDENTIAL SWAPS

## C0 — Prerequisites **[YOU]**

**C0.1 Fix Phantom ↔ Squads.** Blocks C3 and the 5.2 pause drill.

- Squads top-right must show a connected wallet, and it must be `4ydb…` — the only
  member of this 1-of-1.
- Phantom → Settings → Connected Apps → is `app.squads.so` listed, against which
  account?
- Phantom on **devnet**: Settings → Developer Settings → Change Network.
- **Success:** a 0.001 SOL vault → `4ydb…` transfer proposes, approves and executes.
  Three wallet popups.
- **Failure:** try another browser before assuming Squads is broken.

**C0.2 Fund Irys.**

```
solana transfer HG56vMbHkPHybYVLtvJqhusZfVmtbPfaZmHCYMQAw7uL 0.5 \
  -k ~/.config/solana/blotto/fee-payer-devnet.json \
  --url devnet --allow-unfunded-recipient
```

**Verify:** `solana balance HG56vMbHkPHybYVLtvJqhusZfVmtbPfaZmHCYMQAw7uL --url devnet`
→ 0.5

**C0.3 Fund the bank AND the platform treasury.** Two separate needs; the original
draft budgeted only the first.

| Purpose | Amount | Why |
|---|---|---|
| Bank wallet working capital | see the budget table below | fronts 6.4 SOL of entries **plus ~0.4 SOL of unrecoverable rent** per pool |
| Platform treasury bootstrap | ≥ 6 SOL | **`open_pool` reverts with `TreasuryShortfall` below it** |
| Irys | ~0.3 SOL | C0.2. Devnet bundles are cheap; more than this is parked, not spent |

**Rent is the only true burn, and no account is ever closed.** There is no `close =`
anywhere in the program, so every `Entry` (0.00222 SOL) and every Metaplex Core pass
(~0.004 SOL) is permanent — 64 of each per pool, paid by the entrant, plus the Pool
PDA (0.006786 SOL). That is **~0.41 SOL per pool minimum**, and the app's own balance
gate budgets 0.01 SOL per entrant (0.65 SOL per pool) as its conservative bound.
Everything else recycles: entries return via the treasury sweep, prizes return from
the winner wallets — *provided the recycle harness actually sweeps them*.

Sweep frequency is the dominant lever on how far a given balance stretches, because
it decides how fast working capital returns:

| Starting SOL | sweep every 5 | every 3 | every 2 | every 1 |
|---|---|---|---|---|
| minimum for 20 pools | 25.4 | 22.0 | 21.6 | 20.3 |

(Computed at the repo's own 0.004 SOL Core-asset estimate, with a 6 SOL treasury
bootstrap. At a pessimistic 0.006 the 20-pool minimum rises to 28.0 / 24.3 / 24.1 /
22.8.) Pool 1's measured rent decides which column is real — that is why it is
reported before pool 2 runs.

**End-of-rehearsal recovery** is step 5.2a in Stage D: `min_platform + reserve_pots ×
pot[0]` (5.62 SOL) is locked only while tier 0 is *enabled and idle*, so disabling the
tier after the last pool drops the reserve term and a final `withdraw-platform`
recovers 5.12 SOL.

The treasury floor is not a suggestion: `open_pool` requires
`platform.lamports − platform_refundable ≥ pot + min_platform + idle_tier_reserve`.
With tier 0 only, that is `5.12 + 0.5 = 5.62 SOL` before pool 1 can open at all.

```
# repeat; devnet rate-limits, so space these out over several sittings
solana airdrop 2 4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1 --url devnet
```

At 2 SOL per airdrop this is many sittings, not four requests. Before grinding the
faucet, check what is already parked: the Irys wallet only needs a fraction of a SOL
for devnet bundles, and the deploy keypair holds a residue after C4.

**C0.4 IPLocate quota.** Dashboard → monthly request cap. Need ~1,300 plus retries.

---

## C1 — Turnkey entry signer **[BOTH] ⚠ ONE-SHOT**

Book 45 uninterrupted minutes. Gates C3, which gates everything. **Requires B-a.**

**Before opening Turnkey**, have these on screen and nothing else — no notes app, no
terminal:

- GitHub → repo → Settings → Secrets and variables → Actions → **New repository
  secret**, open
- Turnkey console, logged in, on the existing org

**Order:**

1. Create the API key pair. **The private key shows once.** It goes straight into
   the open GitHub field; save before dismissing. Dismissed unsaved → generate
   another, it is cheap.
2. Capture: `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`,
   `TURNKEY_ORGANIZATION_ID`, `TURNKEY_API_BASE_URL`
3. Create the entry-signer key (Ed25519, Solana). Capture `ENTRY_SIGNER_KEY_ID` and
   `ENTRY_SIGNER_PUBLIC_KEY_HEX`
4. If `TURNKEY_USER_ID` is on screen, take it — the daemon needs it at C5 and this
   saves a second sitting
5. Mirror all six to Fly secrets on `blotto-packet`, **and to GitHub repository
   secrets** — Fly secrets cannot be read back, so GitHub is the only durable copy,
   and the deploy workflow stages from there. These six are exactly the set
   `buildSigner()` requires; `TURNKEY_USER_ID` is daemon-only and does not go here.
6. **Remove `ENTRY_SIGNER_SEED_HEX` from `blotto-packet` — BEFORE verifying, not
   after.** This ordering is load-bearing and the earlier draft had it wrong. With
   the seed still present, a missing `ENTRY_SIGNER_KEY_ID` selects the development
   signer, and every check below still passes: the service boots, answers `/health`,
   and issues packets whose signatures verify against the key it reports. That is
   exactly what happened on 2026-08-29. Remove the seed first and the same
   misconfiguration refuses to start instead of hiding.
7. **Confirm the machine actually restarted** and picked the new values up. Staged
   secrets do not reach a running process. `fly secrets list` shows when each was
   set; compare against the machine's last start.

**Screen names are expected shapes, not gospel.** The architect reads each aloud; if
it does not match, stop and re-read.

**Verify:**

- `curl -s https://blotto-packet.fly.dev/health` → ok
- A packet signature verifies against `ENTRY_SIGNER_PUBLIC_KEY_HEX`
- **The signature check that proves the key pair, without the console.** Post an
  attestation for a throwaway wallet, request a packet, and verify its `signature`
  over its `message` against the `publicKey` the response returns. `sign()` goes to
  Turnkey's `signRawPayload`; `publicKey()` returns the configured
  `ENTRY_SIGNER_PUBLIC_KEY_HEX` verbatim. So a valid signature proves the configured
  hex is the true public key of the Turnkey-held private key — a botched base58 → hex
  conversion cannot pass. Do this BEFORE C3: on-chain the same mistake surfaces only
  as a failed Ed25519 check at `register`, after the value is committed.
- **What that check does NOT prove — and this is not hypothetical.** A seed-backed
  signer produces an equally self-consistent signature, so the check passes either
  way. On 2026-08-29 it did: the service reported a public key that verified its own
  signature perfectly, and the key belonged to the CI-generated development seed, not
  to Turnkey. **Base58-encode the returned `publicKey` and compare it to the Turnkey
  key's Solana address.** That comparison, and only that, distinguishes the two. The
  startup line names the path directly and is the cheaper standing check once
  deployed — but on a first credentialed bring-up, do the address comparison.
- **Negative:** remove `TURNKEY_API_PRIVATE_KEY` while leaving `ENTRY_SIGNER_KEY_ID`
  set → the service must refuse to start. (Removing `ENTRY_SIGNER_KEY_ID` instead
  exercises a different branch and proves less.) If it starts anyway, the
  fail-closed path is broken. Stop.

**Record `ENTRY_SIGNER_PUBLIC_KEY_HEX`** — it goes into C3. Changing it later is an
admin-signed rotation (`register-signers --entry-signer`), not a redeploy.

---

## C2 — Geo vendor

**C2 status: CLOSED (2026-09-05).** The allow path is live (`geo = IPLOCATE`,
`geo ALLOW … country=AR`, no `GEO STUB` line) and the refusal path is proven in
production, not only on the bench — see "What production actually proved" below.
All four negatives run against the real vendor through the production adapter,
each distinguishable in the log:

| Case | Answer | Log |
|---|---|---|
| Belgium (real address) | `false` | `territory schedule: BE` |
| Australia (real address) | `false` | `territory schedule: AU` |
| Vendor unreachable | `false` | `LOOKUP FAILED (this is NOT a territory decision) — unreachable after N attempts` |
| Malformed answer | `false` | `LOOKUP FAILED … no usable country_code` |
| **Quota 429** | `false` | `LOOKUP FAILED … QUOTA OR RATE LIMIT (HTTP 429) — the daily request cap is spent … This is NOT a territory block` |

**What production actually proved.** These lines are from the deployed service
on 5 Sep, before the fix shipped — the bench is not involved:

```
20:51:52  geo BLOCK 81.246.x.x — territory schedule: BE
20:51:53  geo BLOCK 1.128.x.x  — territory schedule: AU
```

IPLocate genuinely resolved those addresses to BE and AU and `decide()` genuinely
refused them, in Frankfurt, in the running service. The bypass was never a defect
in the decision or in the vendor integration — it was only *which address got
looked up*. So the whole path "vendor says BE → refuse" is demonstrated in
production, and the fix changed exactly one thing: where the address comes from.

**The limit of the evidence.** No connection has originated in a blocked
territory, and none can without an exit node there — deliberately, since the
header override that would have simulated one *was* the bypass. What is
therefore assumed rather than tested is that Fly's edge reports the true origin
of a connection. That is a property of their proxy, not of our code, and no test
written here could establish it. Record it as the assumption it is.

**The bypass, found by running these negatives (2026-08-31). CLOSED IN
PRODUCTION 2026-09-05.** The gate decided on `X-Forwarded-For.split(',')[0]` —
the LEFTMOST hop, which a proxy appends to rather than overwrites, so it is
whatever the caller typed. Sending `X-Forwarded-For: <a Belgian address>` made
the live service refuse; sending nothing made it allow. **The caller chose the
verdict of the gate.** It was simultaneously a rate-limit bypass, since the
limiter keyed on the same value. Resolution is now `Fly-Client-IP` (proxy-set,
overwritten every request) then the RIGHTMOST forwarded hop, through one shared
resolver so the limiter and the gate can never disagree.

The fix merged as PR #50 on 31 Aug and **did not reach production until
5 Sep 22:00 UTC** (deploy run #11, commit `804302b`) — five days serving the
defect behind a merged fix. Two causes, both now closed: the deploy step was
skipped on the first attempt (merging is not deploying), and the second attempt
was refused by Fly when an organization on the account began requiring SSO and
account-level tokens stopped authenticating.

**Production vector, re-run independently after the deploy** — not by the person
who shipped it, from a different address than the founder's:

```
no header                            → {"allowed":true}
X-Forwarded-For: 81.246.0.1   (BE)   → {"allowed":true}
X-Forwarded-For: 1.128.0.1    (AU)   → {"allowed":true}
X-Forwarded-For: 81.246.0.1, 8.8.8.8 → {"allowed":true}
```

The fourth line is the one that matters: a forged leftmost entry with a real hop
appended, which is the actual attack rather than the single-value form. Before
the deploy the second line returned `false`. **The header no longer changes the
answer.**

The service's own log shows why, and is the stronger evidence: all four requests
resolved to the **same** address — `160.79.x.x`, `country=US`, the prober's real
egress — including the two carrying forged BE and AU headers. Compare the
pre-deploy lines above, where the forged addresses were the ones looked up. The
caller-supplied value is no longer read at all. Run #11's log independently shows `entry signer = TURNKEY` with the
key verified on 31 Aug, and **no `GEO STUB` line** — the vendor path, not the
stub that admits everyone as GB.

**RATIFIED — the 15-minute per-IP cache (founder, pending).** What it changes
about enforcement: **nothing about which addresses are allowed.** The decision is
already a pure function of the address, so two requests from one IP receive the
same verdict with or without a cache. What it changes is only how often the
vendor is asked. Three properties, each tested, keep that true: a failure is
never cached (not a throw, not a quota error, not a timeout — an unreachable
vendor can never become a stored answer); the key is the resolved address itself
and never anything the caller supplies; and the TTL is 15 minutes, so a genuine
reclassification is picked up within one pool rather than persisting for the run.
What it costs: a country that changes classification mid-run is honoured up to 15
minutes late. What it buys: at two lookups per entrant and 128 per pool against a
1,000/day cap, roughly the difference between finishing Stage D and not.

**Requires B-a and B-b.** Country-level blocks are what `config/territories.json`
carries today (`{"blocked":["BE","AU"]}`); the schedule format *also* supports
sub-national entries (`US-NY`), and `decide()` honours them when the lookup returns
a region. There is no boot check that refuses a sub-national rule the vendor cannot
answer — that is a gap to build if you ever add one, not a property you have.

1. **[ARCH]** Land the adapter PR (B-b). CI green.
2. **[YOU]** On `blotto-packet`: set `GEO_VENDOR_URL` and `GEO_VENDOR_API_KEY` to
   the values the merged adapter documents. ⚠ VERIFY both against that PR — the
   generic seam's URL and header shape are not IPLocate's.
3. **[YOU]** **Remove `GEO_STUB_COUNTRY`** — while set, one missing vendor variable
   admits everyone as GB.

**Verify:** `/geo` → true from a normal address · false for BE and AU · false when
the vendor is unreachable · false on a malformed answer. Rejections are generic by
design; do not expect them to say why.

**The acceptance criterion is the startup log, not the endpoint.** `packet: using the
GEO STUB (dev only) — country=GB` prints on every boot while the stub is live. After
the swap that line must be GONE. The endpoint tells you what an answer was; the log
line tells you which code path produced it — and only the second one catches a
vendor variable that quietly went missing.

**Not in scope, but open:** sanctions screening has no vendor wired at all —
`backend/packet/src/main.ts` ships the always-clear answer the suite pins. Record it
as a Stage E open item so it is not a surprise later.

---

## C3 — `init_config` — **DONE 2026-09-06 00:16Z**

**Executed.** Squads proposal `GW8y…Vj5i`, execution signature
`ogPsdSWbtwgW8fhby9LhpmVzYynziSENbDP8Q47Q5UPmXMWgMCDebEjYYfZ2mDNa29QuhBgVSpot7V6V2yKSUTF`,
devnet slot 493796990. `Config.admin` = `9EEWtzyu…e34Z`, the Squads vault.
Every field was read back off-chain and checked against the key register: entry
signer `9Xhw…y8TP`, settlement signer `EaDf…jrSD`, paused false, open tiers
`[1,0,0,0,0,0,0]`, ceilings = price × 64, min platform 0.5 SOL, next pool id 1 —
380 of 380 bytes decoded with no residue.

**It nearly went wrong, and the near-miss is the lesson.** The proposal was
encoded correctly, but the program deployed at `5aawXay…` was the build from
**before** commit 357a435 — nine days stale. Squads' own inspector decoded the
payload against the real IDL and showed an argument we had never sent
("Platform Wallet"); that was dismissed as a display quirk. Simulating the
instruction returned `InstructionDidNotDeserialize`, which is what actually
caught it. Had it been signed, the best case was a revert and the worst was a
`Config` written in a layout the current code cannot read, on a write-once PDA.

The program was rebuilt and redeployed (slot 493789531) and the instruction
re-simulated to `err: null` before anything was signed.

**`scripts/check-deployed.ts` now makes that check routine** — run
`npm run check-deployed` before any irreversible instruction, and
`deployed-drift.yml` runs it after every merge to main and daily.

Whichever key signs becomes admin **permanently**. There is no `set_admin`.

**Preconditions:** C1 done (entry signer pubkey known) · **C6's settlement signer
generated — do C6's key generation before this step, not after** · C0.1 done
(Phantom working) · vault holds ≥ 0.05 SOL for the Config PDA's rent.

**`--min-platform` = 0.5 SOL — RATIFIED (founder, 2026-08-29).** It is the permanent
floor term. `set-treasury-policy` can change it later, now that the command exists.

**1. [ARCH] emits the proposal** ⚠ VERIFY exact flags against `scripts/admin.ts`
USAGE:

```
npx ts-node --transpile-only scripts/admin.ts init-config --emit-proposal \
  --admin 9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z \
  --entry-signer <from C1> \
  --settlement-signer <from C6> \
  --ceilings 6.4sol,32sol,48sol,64sol,160sol,320sol,480sol \
  --min-platform 0.5sol
```

Amounts take the `<decimal>sol` form (parsed in bigint, never a float) or integer
lamports. Prefer the `sol` form — it is readable in a Squads proposal review.

**2. [YOU] read every account before executing.** Specifically:

- `--admin` reads `9EEW…` and **not** `9EL1m9wv…`
- the entry signer matches what Turnkey printed in C1
- ceilings match the confirmed table (each tier's gross intake, entry × 64)
- `--min-platform` reads `0.5sol`

**3. [YOU] paste into a Squads proposal, approve, execute.**

**Verify:**

```
npx ts-node --transpile-only scripts/admin.ts status
```

`init_config` bakes the launch policy in, so `status` should read: `admin` =
`9EEW…` · both signers correct · `paused: false` · `open tiers: [1, 0, 0, 0, 0, 0,
0]` · `reserve pots: 1` · `min platform` = your ratified value · tier prices and
pots non-zero and matching `constants.rs` · `next pool id: 1`. A second
`init_config` must revert.

**If admin is wrong:** stop the phase. Recovery is a new program deploy with a fresh
Config PDA. Nothing else.

**C3.1 Bootstrap the treasury** — permissionless, so any funded keypair signs it; no
Squads proposal needed.

```
FEE_PAYER_KEYPAIR=<bank keypair> \
  npx ts-node --transpile-only scripts/admin.ts fund-platform-wallet --amount 6sol
```

**Verify:** `status` shows `platform balance` ≥ 6 SOL. Without this, pool 1 reverts.

---

## C4 — Upgrade authority to the vault **[YOU] ⚠**

⚠ VERIFY the exact form with the architect before running. Two specific doubts, both
in territory where this repository's guidance is behind the CLI
(`docs/reference/adr-002`): the current authority is usually passed as
`--upgrade-authority <keypair>` rather than `-k`, and recent CLI versions refuse a
new authority that cannot sign — a Squads vault is a PDA, so
`--skip-new-upgrade-authority-signer-check` is likely required. Run
`solana program set-upgrade-authority --help` on the machine first.

```
solana program set-upgrade-authority 5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17 \
  --new-upgrade-authority 9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z \
  --upgrade-authority ~/.config/solana/blotto/fee-payer-devnet.json \
  --url devnet
```

**Verify:** `solana program show 5aaw… --url devnet` names `9EEW…`. Update
`config/custody.json` in the same change — the C13 custody page renders from it.

**After this, every deploy is a Squads proposal.** Decide with the architect whether
to do it before or after the rehearsal's last redeploy. Then retire `GXKX…`.

**ARCHITECT RECOMMENDATION (2026-09-06): after Stage D, not before.** Two
reasons, both from the C3 near-miss. The deployed binary drifted from source for
nine days undetected, and Stage D is the first time the program runs anything
beyond `init_config` on a real cluster — so expect fixes. Today a fix is one
command; after C4 it is a Squads proposal, on the exact path where a stale
deploy is hardest to spot. Move the authority once the code has stopped
changing, and gate it on `npm run check-deployed` passing.

**Top up `GXKX…` before running this.** It holds ~0.108 SOL after funding Irys three
times on 2026-08-29; a transfer that runs out of gas mid-authority-change is the one
failure this step must not have. A few hundredths of a SOL is enough, but check it
rather than assuming.

---

## C5 — Switchboard, Irys, daemon

**C5.1 — already landed.** The production `SwitchboardVrfCoordinator` is on `main`
(commit 2e28c81, "closes the C11 daemon stub"). Confirm it is in the deployed image;
do not re-plan it as build work.

**C5.2 [BOTH]** `IRYS_UPLOAD_KEY` — the base58 Solana secret key, not the JSON file.
The architect converts `irys-devnet.json` with you present. It never reads that file
alone.

**C5.3 [ARCH]** Set on `blotto-daemon`: **`SWITCHBOARD_QUEUE`** (the On-Demand queue,
base58), `IRYS_UPLOAD_KEY`, `IRYS_NETWORK=devnet`, `TURNKEY_API_BASE_URL`,
`TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`,
`TURNKEY_USER_ID`, `BLOTTO_DATABASE_URL`, and optionally
`BLOTTO_DAEMON_INTERVAL_MS` (default 15000) / `BLOTTO_DAEMON_HEALTH_PORT` (default
8084, already set in `daemon.fly.toml`). Deploy per B-d.

> **Do NOT set `RANDOMNESS_ACCOUNT`.** In `backend/reveal/src/main.ts`,
> `SWITCHBOARD_QUEUE` selects the production coordinator and `RANDOMNESS_ACCOUNT`
> selects `StubVrfCoordinator` ("stub, tests/bench"). Setting the latter starts the
> daemon cleanly and runs all twenty pools on the stub — the failure is silent, and
> it invalidates the class draw's whole randomness claim. The daemon refuses to
> start if neither is set, which is the behaviour you want.

**Verify:**

- daemon health endpoint reports **`"ready":true`**, not merely a 200 (`/health`,
  port 8084). It answers 200 with `"ready":false` while it is still starting — that
  is deliberate, so the platform stops killing it mid-init — so a 200 alone proves
  only that the process is alive. The `phase` field names the step it is on, and
  the endpoint turns 503 if it is still starting after two minutes. The deploy's
  "Assert the daemon reached ready" step checks this for you.
- **the log line and the reveal instruction show the Switchboard path, not the stub**
- one pool key created in Turnkey at `open_pool`
- **export before seal refused by Turnkey policy** — assert the API error. This is
  the entire security claim of the sealed box. If export succeeds before seal, stop.
- export after seal succeeds
- one bundle published to Irys and fetchable by URL

---

## C6 — Settlement signer + review service

Generate the settlement keypair **before C3** — `init_config` needs its pubkey.

Option (a): base64 Fly secret decoded to tmpfs at boot. Devnet interim; Turnkey
custody supersedes it later.

**[BOTH]** generate and stage the keypair. **[ARCH]** updates the custody page — copy
change goes through the B7 language audit. **[ARCH]** deploys `blotto-review` per
B-d. Fill `config/reviewers.json` first: it ships empty and no decision verifies
until it has member keys.

**C6.1 — FUND THE SETTLEMENT SIGNER [YOU]. Added 2026-09-06 after it was missed.**
`EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD` pays the fee AND the account rent
for every instruction the daemon sends — `open_pool`, `commit_vrf_seed`,
`create_pass_collection`, `reveal_pool_secret`, `commit_results`, `pay_prizes`.
Generated and staged is not funded. Left empty it does not fail loudly: the
keeper retries once per tick with Solana's message for an unfunded fee payer,
"Attempt to debit an account but found no record of a prior credit".

```
solana transfer EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD 2 -k /Users/tomhumber/.config/solana/blotto/fee-payer-devnet.json -u https://api.devnet.solana.com --allow-unfunded-recipient
```

**2 SOL, sized not guessed.** Per pool: `Pool` PDA rent 0.00679 (847 bytes),
its vault 0.00089, the Switchboard randomness and MPL Core collection accounts
~0.008 between them, fees ~0.00005 — about **0.016 SOL**, so twenty pools is
~0.35. Two is roughly 5x, covering the two vendor figures that are estimates
rather than quotes. Pool 1 measures the real number; replace this line with it.

Do NOT confuse this with the **platform treasury** (6.0 SOL), a different
account that funds each pool's 5.12 SOL pot at `open_pool`. The entry signer
holds nothing and should stay that way — it signs packets off-chain and never
pays a fee.

The daemon now refuses to start below **0.05 SOL** and reports
`settlementSol` on `/health` (`backend/reveal/src/startup.ts`).

**Verify:** review `/health` (port 8083) · a flagged entry appears on the review page
· `clear_flag` executes and the decision log records it. Note `clear_flag` is
**settlement-signed**, not admin-signed — it is driven by the review service, not by
a Squads proposal. · **the settlement signer's balance is above the floor** —
`solana balance EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD -u https://api.devnet.solana.com`

---

## C7 — Test-signer wiring

**Build work, not wiring (B-e).** `testSignerFromWindow()` exists in
`app/src/tx/test-signer.ts` and nothing imports it. **[ARCH]** wires it behind three
gates: `NEXT_PUBLIC_ALLOW_TEST_SIGNER` with dead-code elimination · a cluster guard
refusing non-devnet · **CI grep of a production build with the flag unset for
`__BLOTTO_TEST_SIGNER__`**.

**If the bundle gate cannot be made to hold, stop.** Fall back to a split run — a few
pools through the front end, the rest through `Web3Chain`.

---

# PRE-STAGE D

**[ARCH]** bank/recycle harness (B-f). **[BOTH]** open pool 1 as a smoke test — one
full pool end to end before committing to twenty. **[ARCH]** measures real rent on
pool 1 and **reports before pool 2 runs**.

**Pool 1 carries two explicit pass/fail gates, not observations.**

1. **The prize sweep-back works.** Every budget number assumes the harness returns
   the 5.12 SOL of prize money from the 16 winner wallets to the bank. Assert it:
   the bank's net change across pool 1 must be about **−0.41 SOL**, not −5.5. If the
   sweep-back silently does not happen the run still *looks* fine, and the bank is
   empty by pool 4. A 13× difference is impossible to miss if someone looks — so
   look, and record the number.
2. **Measured rent decides the sweep cadence** (below). Record the bank's net change
   per pool; that single figure carries rent, fees and any leak at once.

**Decision point:** if rent lands near 10 SOL, revisit the pool count before spending
it.

---

# STAGE D — THE REHEARSAL

**5.1 Twenty pools.** 64 entrants, four strategies, through the real front end. Per
pool: fill time, crank time, final state, conservation to the lamport, committed root
matching the published bundle.

**5.2 Failure paths**, ledger reconciled after each:

- 63-entry pool past a shortened deadline → all refunded in full including the 20%
- **Pause mid-fill, then resume** — two Squads proposals, **scheduled in advance with
  you at a keyboard**. **Blocked on B-c**: `admin.ts` cannot emit a `set_paused`
  proposal today.
- Turnkey export failure → deadline-triggered refund
- **One deliberate detection flag**, so `release_escrow` and `forfeit_escrow` are
  exercised once before they ever matter

**5.2a End-of-run treasury recovery.** After pool 20 settles, and before Stage E:

1. `set-open-tiers --tiers 0,0,0,0,0,0,0` — tier 0 stops being an enabled-and-idle
   tier, so the `reserve_pots × pot[0]` term leaves the withdraw floor.
2. `withdraw-platform --amount <treasury − 0.5 SOL> --destination <bank>` — recovers
   the 5.12 SOL that was locked behind the reserve.
3. `status` — confirm `open tiers: [0, 0, 0, 0, 0, 0, 0]` and the treasury at its
   `min_platform` floor.

Both are Squads proposals. This is also the only coverage `set-open-tiers` gets in the
whole rehearsal, so it is a test as much as a recovery — run it deliberately, not as
a cleanup afterthought.

**5.3 Public verification.** All 20 verified from the verify page, wallet
disconnected. **[YOU]** arrange one non-founder recompute from the URL alone.

**5.4 Load.** One pool fills in under 5 minutes, 64 concurrent; crank settles inside
2. **[YOU]** supply the Helius URL as an env var — public RPC will rate-limit.
Timings go into `docs/devnet-rehearsal.md`.

## The sweep, and what "unattended" actually means

**`withdraw_platform` sweep every 2 pools, destination = the bank wallet.** Each pool
nets the treasury about +1.28 SOL (6.4 SOL of entries in, 5.12 SOL of pot out) while
the bank bleeds the same amount, so the sweep is what keeps the bank solvent. It is
an admin instruction, so **every sweep is a Squads proposal the founder approves and
executes by hand.**

That is the honest reconciliation with 5.1's "unattended": **unattended within a
segment, not across the run.** No human is in the loop during a pool's fill-and-settle
cycle — the daemon opens, seals, reveals, scores and pays without help. The founder is
needed only at segment boundaries. Plan the run as **ten segments of two pools with a
founder-attended sweep between them**, and say so in the timings rather than
discovering it at pool 8.

Two things make the boundaries cheap:

- **Pre-stage every sweep proposal in one sitting.** The amount does not have to be
  exact — a fixed, conservative 2.5 SOL clears the floor at every boundary — so all
  ten can be created and reviewed together, then executed one per boundary. That turns
  ten reviews into one review and ten clicks.
- **Segment boundaries are natural checkpoints anyway.** The ledger reconciliation
  5.2 wants, and the rent check below, both belong exactly there.

This manual cost is bought by the decision to make the Squads vault the devnet admin.
The alternative the rehearsal doc offers — a direct-signed local keypair as admin on
devnet — would make sweeps scriptable and the run genuinely unattended, at the price
of never exercising the Squads proposal path before mainnet. That path is also what
5.2's pause drill runs on. Keeping the vault is the right call; this is what it costs.

### The cadence trigger, set in advance

Expected net bank burn is **~0.41 SOL per pool** — rent, since everything else
recycles. Measure it on pool 1 and apply this directly; no judgement on the day:

| Measured net burn per pool | Cadence |
|---|---|
| ≤ 0.42 SOL | sweep every 3 would hold, but see below |
| ≤ 0.445 SOL | **sweep every 2 — the plan** |
| ≤ 0.509 SOL | sweep every pool |
| > 0.51 SOL | stop: cut the pool count or raise more devnet SOL |

**Why every 2 rather than every 3.** At the repo's own pass-rent estimate, sweeping
every 3 clears twenty pools by about 3% — and its low-water mark, mid-pool-18, is
**0.24 SOL**. That is not a margin. Sweeping every 2 lifts the same low point to 1.52
SOL for four extra boundaries. Re-check after pool 1: if measured burn comes in at or
under 0.42 the every-3 cadence is available, but it should be a deliberate choice to
spend the margin, not the default.

Every additional ~3 SOL of devnet funding buys back one cadence step. If the faucets
cooperate and the bank reaches ~25 SOL, sweep every 5 and the run is four boundaries.

**Assert a floor-breaching withdrawal reverts first** — but note the mechanics: with
`--emit-proposal` you would be pushing a deliberately failing proposal through Squads.
Cheaper to assert the revert in the LiteSVM suite and record it, unless you want one
burned proposal as live evidence. Decide which, in advance.

Assert a floor-breaching withdrawal reverts first — but note the mechanics: with
`--emit-proposal` you would be pushing a deliberately failing proposal through
Squads. Cheaper to assert the revert in the LiteSVM suite and record it, unless you
want one burned proposal as live evidence. Decide which, in advance.

`min_platform + reserve_pots × pot[0]` stays locked behind the floor — with a
ratified 0.5 SOL minimum that is 5.62 SOL. Expected, not a leak. It reads
differently mid-pool: while tier 0 has a live pool the reserve term drops out and
the refundable term rises, so a `status` taken mid-fill will not show 5.62. That is
correct behaviour, not drift.

---

# STAGE E — INTERNAL REVIEW

**[ARCH]** re-reviews `docs/internal-review.md` against final code. IR-2/3/4 already
ratified. Stage D findings fixed or recorded. Add the sanctions-vendor gap (C2) as a
named open item.

# GATE 5

20 clean settlements · every failure path exercised · internal review written and
open items decided · **[YOU]** read and sign off.

---

## RECOVERY NOTES

**A machine that hits max restart count stays stopped even after the fault is
fixed.** `fly secrets set` bumps the version but does not start it. Symptom: 503 from
Fly's edge, `fly status` shows `stopped`.

```
fly machine start <machine-id> -a <app>
```

`deploy-backend.yml` now asserts every machine reaches `started`, and the
`backend-watch` workflow probes and restarts on a schedule — but only for
`blotto-indexer` and `blotto-packet`. The daemon and review services are not covered
until B-d lands.

**A password change breaks every app sharing it.** `BLOTTO_DATABASE_URL` is on the
indexer, the packet service, the daemon and the review service. Update all four.

**Health checks warning ≠ broken.** Machines take 30–60s. Wait before diagnosing.

**Digest matching proves two apps hold the same value, not a correct one.** Verify
against the source of truth.

**A command that loses its flags still succeeds.** On 2026-09-05 a three-line
`solana transfer` lost its `-k` and `-u` to blank lines inserted on paste. It ran
with the CLI defaults and printed a normal `Signature:` line; the giveaway was two
`command not found: -k` / `-u` errors AFTER the success, not instead of it. It
happened to be harmless — devnet, and the default key was the intended one — but
only by luck. **Read what came back, not just the last line**, and check the
signature on-chain before assuming a transfer went where it was aimed:
`getTransaction` returns `null` on any network the transaction is not on, which
is how you tell devnet from mainnet in one call.

**A dead credential can look like a missing resource.** On 2026-09-05 the deploy
announced `blotto-indexer has no public IPs — allocating` when the truth was that
it had been refused permission to ask. Fly had rejected `FLY_API_TOKEN` outright;
the step before it had already been told `You must be authenticated to view this`
and hid it behind an `|| echo "$app exists"`.

The cause was not expiry or revocation — the token was still listed in the Fly
dashboard, unrevoked, looking perfectly healthy. An organization on the account
had begun requiring **Single Sign On**, and Fly stopped honouring account-level
personal access tokens as a class. The fix is an org token,
`fly tokens create org --org <slug>`, which the dashboard cannot issue; see
`docs/deploy-backend.md` Step 2. Four rules follow:

1. **Read the step above the red one.** The first step to touch a service usually
   knows the real answer; the red step is often only the first one honest enough
   to stop.
2. **A present credential is not a working credential.** The deploy now probes
   Fly before it builds anything, and a rejection stops the run naming the token.
   The same check does not yet exist for Turnkey, the geo vendor or Neon — their
   failures still surface at boot rather than in preflight.
3. **A vendor console showing a credential as healthy is not evidence it
   authenticates.** Only a call that uses it is. This is the same lesson as the
   entry signer on 2026-08-29, where the console and the live service disagreed.
4. **The same event breaks `fly` on the founder's laptop.** Local flyctl holds
   its own token of the same kind, so `fly logs` returns nothing and looks like
   a silent service. **An empty log grep is not evidence about the service until
   `fly auth whoami` succeeds.** This was misdiagnosed as "the machine has not
   restarted" on the day.

Replacing the token is safe at any point: nothing is staged or deployed until it
authenticates, so a failed run leaves every app exactly as it was.

**A step that has never run is not a step that works.** On 2026-09-06 the deploy
got every credential right — the run printed `entry signer = TURNKEY`,
`settlement signer = DECODED FROM SECRET`, `VRF = SWITCHBOARD On-Demand`, and no
`GEO STUB` line — and still failed, at "Deploy daemon", with Fly reporting nothing
listening on `0.0.0.0:8084`.

The daemon did have a health endpoint. It bound the port **last**, after
`makeSwitchboardOps` (21 seconds on that run, from the log timestamps) and
`irysUploaderFromEnv`. Both awaits were reached for the first time that night:
`SWITCHBOARD_QUEUE` and `IRYS_UPLOAD_KEY` had been empty until C5 set them, so the
daemon had always taken the short path around them. The code did not regress —
**configuring a service correctly for the first time is also the first time its
real startup path runs.** Expect the first credentialed deploy of any service to
fail on something no previous deploy could have exposed.

The fix binds `/health` before anything else and reports the startup phase, so the
platform can tell "still starting" from "dead" (`backend/reveal/src/health.ts`).
That creates the opposite hazard, which is why the endpoint turns **503** past a
two-minute startup budget and why the deploy now asserts `"ready":true` rather than
a bare 200: a machine that answers 200 forever while wedged in initialisation would
be the same silent failure wearing the other mask.

**An unhealthy service cannot be the thing that tells you why.** The same night,
with the port bound early, the daemon deployed cleanly, logged
`VRF = SWITCHBOARD On-Demand`, and then went silent — no ready line, no ticks, no
error. Its public `/health` stopped answering entirely: past the startup budget it
returns 503, and Fly's proxy does not route to an instance whose check is failing,
so the request hangs with zero bytes. The endpoint that knew what was wrong was
unreachable *because* it was right.

Three consequences, all now in place:

1. **The log is the witness.** Every startup phase is logged with its elapsed
   time, and the daemon prints an explicit `READY` line
   (`backend/reveal/src/main.ts`). "Still starting" and "running" used to look
   identical in the log; they no longer do.
2. **A vendor call gets a budget.** `makeSwitchboardOps` and
   `irysUploaderFromEnv` each run under a named 45s limit
   (`backend/reveal/src/startup.ts`). A third party that neither answers nor
   fails now produces a named, fatal error instead of an indefinite stall. Irys
   is additionally given `BLOTTO_RPC_URL` and its own HTTP timeout, so it is no
   longer reaching an unnamed default endpoint nobody here configured.
3. **`backend-status` covers all four apps**, with public IPs and check state.
   It had covered only the indexer and the packet service, which is why the
   daemon's silence could not be read from the Actions page at all.

When the deploy reports the daemon unready, read the log lines it dumps, not the
endpoint.

**Generated and staged is not funded.** With the deploy finally green on
2026-09-06, the daemon reached `ready`, ticked on schedule — and reported one
error every fifteen seconds for forty minutes:

```
daemon: keeper:failed {"error":"... Attempt to debit an account
  but found no record of a prior credit."}
```

That is Solana's message for a **fee payer that has never been funded**. The
settlement signer held nothing. C6 said to generate and stage the keypair and
never said to fund it, while C3's preconditions carefully required the vault to
hold 0.05 SOL for one account's rent. The account that pays for every
instruction after C3 was guarded by nothing. C6.1 now exists.

Two smaller lessons from the same half hour:

- **The abbreviation in a register is for reading, not for doing.** The row
  carried `EaDf…jrSD`, so writing a single transfer command meant deriving the
  full address from `Config` on chain. Full addresses now, both here and for
  the Config PDA.
- **Read the register before guessing a path.** The first funding attempt used
  `~/.config/solana/fee-payer-devnet.json` and failed with "No default signer
  found". The register already said `~/.config/solana/blotto/…`. The keypair
  paths were right there; the guess was the only thing that wasn't.

**Correction, and the actual cause.** The paragraph above first said the empty
answer meant "unhealthy, not unreachable" — that the 503 had taken the daemon out
of the proxy's rotation. That was wrong, and the phase logging is what showed it.
The real timeline:

```
03:44:30  Out of memory: Killed process 668 (node) ... anon-rss:126312kB
03:46:26  daemon: phase=switchboard (+560ms)
03:46:40  daemon: switchboard queue: done in 13873ms
03:46:48  Health check on port 8084 has FAILED
03:52:15  daemon: phase=irys (+349127ms)
```

The daemon was **OOM-killed**, and the 5m35s gap is neither vendor call — it sits
between them, in `buildCustody`'s synchronous `require` of the Turnkey SDK. A
one-second require took five and a half minutes: a process thrashing against a
memory ceiling.

`deploy/fly/daemon.fly.toml` had no `[[vm]]` block, so it ran on Fly's 256 MB
default, while `indexer.fly.toml` declares 512 MB explicitly. The daemon is the
heaviest of the four services — Turnkey, Switchboard, Irys, `@solana/web3.js` and
the detection pipeline in one process, all under ts-node — and was the only one
with no memory declared. It is now 1 GB, and every phase line reports resident
memory so the next one is read rather than inferred.

Three things worth keeping:

1. **An in-process health endpoint cannot report a blocked event loop.** A
   synchronous require stops the HTTP server dead: the kernel accepts the
   connection and nothing ever reads it, so the caller sees zero bytes rather
   than an error. The 503 logic never ran, because nothing could run. The
   platform's own check failing is the only signal for this case.
2. **The heaviest service was the one running on a platform default.** Where a
   limit is not declared, nobody has decided it. `packet.fly.toml` and
   `review.fly.toml` are still implicit — they are running fine, so they were
   not touched mid-rehearsal, but they are unclosed.
3. **`ts-node` in production is the underlying defect**, in all four services. It
   puts the TypeScript compiler's memory cost in the runtime. Compiling at image
   build and running plain `node` is the real fix, deferred deliberately to its
   own change rather than attempted mid-rehearsal.
