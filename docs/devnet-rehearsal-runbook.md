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
   default.
2. Secrets are typed into destination fields, never pasted into chat, files, commits
   or logs.
3. A service refusing to start on a missing credential is correct. Never loosen it.
4. If a verification fails, stop. Do not proceed with a half-working credential
   behind you.
5. Ask "what would distinguish this explanation from the alternatives" before
   approving any fix.

## KEY REGISTER

| Name | Address / path | Role |
|---|---|---|
| Program | `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` | deployed devnet program |
| Squads vault | `9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z` | **becomes `Config.admin`** |
| Squads multisig | `9EL1m9wvqGSznHJ8zkS5YaXQnG4gq4aNYsbGnP1TmFyN` | **never `--admin`** |
| Bank wallet | `4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1` | funds entrants; Squads member |
| Deploy keypair | `~/.config/solana/blotto/fee-payer-devnet.json` (`GXKX…`) | upgrade authority; retire after C4 |
| Program keypair | `~/.config/solana/blotto/blotto_cup-program-devnet.json` | `BLOTTO_PROGRAM_KEYPAIR` |
| Irys wallet | `~/.config/solana/blotto/irys-devnet.json` (`HG56…`) | `IRYS_UPLOAD_KEY` source |

---

# STAGE B — ARCHITECT PREREQUISITES

These are code changes, not credential steps, and every one of them gates a Stage C
step. None is on `main` today.

**B-a. `deploy-backend.yml` must stop re-seeding dev credentials.** The workflow
today sets `GEO_STUB_COUNTRY="GB"` **unconditionally on every run** (no
generate-once guard), and regenerates `ENTRY_SIGNER_SEED_HEX` whenever it is
absent. Either one silently undoes a Stage C swap at the next deploy click:

- `backend/packet/src/main.ts` `buildSigner()` prefers Turnkey only when
  `ENTRY_SIGNER_KEY_ID` is set, so a re-seeded `ENTRY_SIGNER_SEED_HEX` is inert
  *while* Turnkey is configured — but it is a live fallback the moment
  `ENTRY_SIGNER_KEY_ID` is cleared.
- `buildGeo()` prefers the vendor only when **both** `GEO_VENDOR_URL` and
  `GEO_VENDOR_API_KEY` are non-empty. Drop either and it falls through to the
  stub and admits everyone as `GB`. This is the dangerous one.

The edit stages `TURNKEY_*`/`ENTRY_SIGNER_*` and `GEO_VENDOR_*` from repository
secrets and removes both dev seeds. **Do C1 and C2 only after it lands.**

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

**B-d. `blotto-daemon` and `blotto-review` have no deploy path.**
`deploy-backend.yml` deploys the indexer and the packet service only. The Fly
configs exist (`deploy/fly/daemon.fly.toml`, `review.fly.toml`) and document a
manual `fly deploy --config …`. Decide: workflow steps, or a written manual
procedure naming who runs it and where each secret comes from. Note the review
service's image runs `backend/detection/src/main.ts` — there is no
`backend/review/` directory.

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

**End-of-rehearsal recovery:** `min_platform + reserve_pots × pot[0]` (5.62 SOL) is
locked only while tier 0 is *enabled and idle*. Running
`set-open-tiers --tiers 0,0,0,0,0,0,0` after the last pool drops the reserve term, so
the floor falls to `min_platform` alone and a final `withdraw-platform` recovers the
5.12 SOL pot reserve.

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
5. Mirror all six to Fly secrets on `blotto-packet`. These six are exactly the set
   `buildSigner()` requires; `TURNKEY_USER_ID` is daemon-only and does not go here.
6. **Remove `ENTRY_SIGNER_SEED_HEX`** from `blotto-packet` — no silent fallback

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
- **What that check does NOT prove:** the local dev-seed signer would also produce a
  self-consistent signature. Base58-encode the returned `publicKey` and compare it to
  the Turnkey key's Solana address — that comparison, and only that, distinguishes
  Turnkey from a silent seed fallback. (The startup line added alongside this now
  names the path directly, which is the cheaper check from here on.)
- **Negative:** remove `TURNKEY_API_PRIVATE_KEY` while leaving `ENTRY_SIGNER_KEY_ID`
  set → the service must refuse to start. (Removing `ENTRY_SIGNER_KEY_ID` instead
  exercises a different branch and proves less.) If it starts anyway, the
  fail-closed path is broken. Stop.

**Record `ENTRY_SIGNER_PUBLIC_KEY_HEX`** — it goes into C3. Changing it later is an
admin-signed rotation (`register-signers --entry-signer`), not a redeploy.

---

## C2 — Geo vendor

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

## C3 — `init_config` **[BOTH] ⚠⚠ THE IRREVERSIBLE ONE**

Whichever key signs becomes admin **permanently**. There is no `set_admin`.

**Preconditions:** C1 done (entry signer pubkey known) · **C6's settlement signer
generated — do C6's key generation before this step, not after** · C0.1 done
(Phantom working) · vault holds ≥ 0.05 SOL for the Config PDA's rent.

**Confirm before signing — `--min-platform` is a founder-owned number.**
`devnet-rehearsal.md` writes it as `<founder-ratified-lamports>`. 0.5 SOL is a
proposal awaiting your ratification, not a fact. It matters twice: it is the
permanent floor term, and `set_treasury_policy` (which would change it) has no CLI
today (B-c).

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
- `--min-platform` is the value you ratified

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

- daemon health endpoint green (`/health`, port 8084)
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

**Verify:** review `/health` (port 8083) · a flagged entry appears on the review page
· `clear_flag` executes and the decision log records it. Note `clear_flag` is
**settlement-signed**, not admin-signed — it is driven by the review service, not by
a Squads proposal.

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

**5.3 Public verification.** All 20 verified from the verify page, wallet
disconnected. **[YOU]** arrange one non-founder recompute from the URL alone.

**5.4 Load.** One pool fills in under 5 minutes, 64 concurrent; crank settles inside
2. **[YOU]** supply the Helius URL as an env var — public RPC will rate-limit.
Timings go into `docs/devnet-rehearsal.md`.

**Every 5 pools: `withdraw_platform` sweep, destination = the bank wallet.** That is
what makes the 18 SOL budget recycle: each pool nets the treasury about +1.28 SOL
(6.4 SOL of entries in, 5.12 SOL of pot out), so roughly 6.4 SOL is sweepable per
five pools. Each sweep is an admin instruction, so each is a Squads proposal.

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
