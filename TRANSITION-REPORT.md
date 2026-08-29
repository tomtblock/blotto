# Transition Report — `anarchy-fun` → `blotto-cup`

**Phase 0, per `REPO-TRANSITION-PLAYBOOK.md` §7.** Companion to `EXTRACTION-REPORT.md`, which
records what was carried; this one records keys, infrastructure and what still has to be
decommissioned.

---

## In plain language, before any file paths

**Nothing is provisioned yet, and that is the expected state.** Phase 0 stands up the repository.
Everything in §5 of the playbook — the database, the RPC endpoint, the key custody, the hosting —
is Phase 1 and later work, and every row of the infrastructure table below says "not provisioned".
The table is filled in with *which provider* the old product used, so the founder can work through
the playbook without going back to the old repository to find out.

**One key was generated, and it needs regenerating.** A devnet program keypair was created during
extraction so the program has an identity to build against. It was generated inside a temporary
container that will not survive this session, so **its private half is gone.** Regenerating it is one
command, written out below. Until then the program builds fine; it just cannot be deployed.

**Two old keys need decommissioning.** The old repository has two Solana keypairs committed in it.
Neither was copied here, and both must be treated as compromised — one of them leaked onto the main
branch and was then allowlisted rather than rotated. Their public keys are recorded below so the
accounts can be checked for balances and retired deliberately rather than forgotten.

**Nothing has been deleted from the old repository.** It still exists, untouched, and remains the
place to look for design context. The playbook's §3 branch cleanup is not applicable here — see
below.

---

## Decision: fresh repository

**Fresh repo, components copied in.** This was pre-decided (playbook §1, brief §0) and nothing found
during extraction argues against it. Two findings actively confirm it:

- The old repository's `finalize_graduation.rs` contains a working, tested, PDA-signed instruction
  that **unfreezes an entire NFT collection**. Blotto Cup's legal position (PID §8.2) depends on the
  character pass being permanently non-transferable. In a fork, that instruction would be one
  `git revert` away forever. In a fresh repository it simply is not present.
- The old product's own documents describe it in language PID §8.7 forbids. A fork carries that in
  its history regardless of what is deleted now, and history is discoverable.

The old repository is untouched and remains available for archaeology.

---

## History audit

**Not applicable.** The source was an **unpacked zip with no `.git` directory**, so there is no
history in this repository to audit — it starts from a single initial commit — and no history in the
source to scrub.

The playbook's §2 commands assume a clone. What was done instead:

| §2 step | What was possible | Result |
|---|---|---|
| 2.1 commits and deleted files | Not possible — no `.git` in the zip | n/a |
| 2.2 secrets scan across all history | Filesystem scan of the working tree only (`gitleaks detect --no-git`) | **2 keypairs found**, both known and recorded below |
| 2.3 keypair-array grep | Run against the tree | Same two files, no others |
| 2.4 language audit across history | Not possible against history; run against the tree | Extensive, as expected — the reason for the fresh-repo decision |

**One finding worth recording.** The old repository's `.gitleaks.toml` **allowlists both committed
keypairs by path**, so running gitleaks with that config reports "no leaks found". The only scan that
means anything is the one with the custom Solana-keypair rule and *without* the allowlist. Anyone
auditing the old repository should know that.

**Full scan detail is in `EXTRACTION-REPORT.md` → Pre-scan.**

---

## Branches

**Not applicable.** No `.git` directory, therefore no branches to classify, cherry-pick or delete.

The playbook's §3 expects to find carry-class branches holding the randomness and packet work. Both
questions are answered anyway by what the zip contains:

- **Randomness** was on the main tree and is carried in full.
- **Packet work does not exist** anywhere in the zip — no branch could contain it, because there is
  no `ed25519` code in the repository at all. See `EXTRACTION-REPORT.md` → "Component: Signed-packet
  infrastructure".

If the old repository is later restored as a live clone and a branch audit becomes possible, the only
thing worth looking for is packet work that never reached the tree. **Nothing should be deleted from
the old repository yet** — it is the only remaining copy of the design context.

---

## Components carried

Summarised from `EXTRACTION-REPORT.md`, which is authoritative:

| Component | Outcome |
|---|---|
| Randomness crate | **Carried**, five-input digest, 19 tests pass, generator script now committed |
| Merkle slot table | **Did not exist** — placeholder crate created |
| Switchboard VRF | **Carried**, `anchor build` green, TS suite typechecks |
| Signed entry packet | **Did not exist** — placeholder, new work for Phase 1 |
| Metaplex Core mint + freeze | **Carried**, freeze kept, **thaw path deliberately not carried** |
| Irys / fal.ai | **Did not exist** |
| Frontend seams | **Carried** (wallet, transactions, class reveal), 114 tests pass |
| Verify page | **Did not exist** — empty scaffold created |
| Backend plumbing | **Carried** (config, database, monitoring, event ledger), 63 tests pass |
| Hygiene and CI | **Carried** (gitleaks config, audit configs, Rust + gitleaks lanes, stop-the-line) |

---

## Keys generated

**One key was generated in Phase 0. Nothing else.** Per playbook §4.2 step 2, mainnet keys are not
generated until Phase 7 is scheduled.

| Purpose | Custody | Public key | Policy |
|---|---|---|---|
| Devnet program identity (`blotto_cup`) | Local file, **outside this repository** | `5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17` | None yet — a local keypair, not a custodied signer |

**Path:** `/home/user/keys/blotto-cup-devnet-program.json`, mode `0600`, outside the repository tree
entirely. It is pinned in `Anchor.toml` (both `[programs.localnet]` and `[programs.devnet]`) and in
`programs/blotto_cup/src/lib.rs`'s `declare_id!`.

**No private material appears anywhere in this repository, this report, or any commit message.**

### ⚠ This keypair must be regenerated before any deploy

**It was generated inside an ephemeral session container. The private half will not survive that
container, so treat it as already lost.** This is not a security problem — the key has never held
authority over anything and has never touched a network — but it does mean the committed program ID
has no usable keypair behind it.

Regenerate it on a durable machine, once, before the first devnet deploy:

```bash
mkdir -p ~/keys && chmod 700 ~/keys
solana-keygen new --no-bip39-passphrase -o ~/keys/blotto-cup-devnet-program.json
solana address -k ~/keys/blotto-cup-devnet-program.json     # the new program ID
```

Then update the ID in **both** places and rebuild:

- `Anchor.toml` — `[programs.localnet]` and `[programs.devnet]`
- `programs/blotto_cup/src/lib.rs` — `declare_id!`

```bash
anchor build     # fails loudly on a mismatch, which is the behaviour you want
```

`anchor keys sync` will do the edit for you. Keep the file outside the repository; `.gitignore`
covers `keys/` and `*keypair*.json`, and `.githooks/pre-commit` rejects any staged file containing a
64-integer array — but the reliable defence is not putting it there.

### Keys still to generate (playbook §4.1)

None of these exist yet. Devnet first, mainnet only when Phase 7 is scheduled.

| Key | Purpose | Custody | When |
|---|---|---|---|
| Deploy wallet | Initial deploy and rent; authority transferred to Squads immediately after | Local keypair, funded, then destroyed or cold-stored | Phase 1 |
| Program upgrade authority | `blotto_cup` upgrades | **Squads multisig**, n-of-m, published timelock | Immediately after first deploy |
| `Config.admin` | Rotate signers, pause | Squads — same vault | Phase 1 |
| Entry-packet signer | Signs `EntryPacket` | **Turnkey**, sign-only, **no export** | Phase 1 |
| Settlement signer | `open_pool`, `reveal_pool_secret`, `commit_results`, `flag_entry` | **Turnkey**, sign-only | Phase 1 |
| Pool secret keys (X25519, one per pool) | Sealing | **Turnkey**, policy: **export only after state `Sealed` or past the deadline** | Phase 2 |
| Platform wallet | Receives the 20% | Squads or hardware | Phase 1 |
| Irys node wallet | Funding published uploads | Fresh Solana keypair | Phase 2 |

Two of these carry a rule rather than just a location:

- **The pool secret key's export policy is the sealing guarantee.** "Export only after `Sealed` or
  the deadline" is what makes the operator blind to allocations rather than merely trusted. A policy
  that permits earlier export defeats the design silently, and no test would catch it.
- **The upgrade authority must reach Squads immediately after deploy**, with the vault address and
  signer list published on the rules page (playbook §4.2 step 3). Verify with `solana program show`.

---

## Infrastructure

**Not provisioned in Phase 0 — every row.** The principle from playbook §5 is *same accounts, new
resources, new credentials*: nothing shared with the old product at the resource level.

The provider column is filled in from what the old repository actually used, so this table can be
worked through without going back to it.

| Provider | Old product used | Resource ID | Region | Credential location | Status |
|---|---|---|---|---|---|
| **RPC** | **Helius** (`HELIUS_RPC_URL`, referenced from `Anchor.toml` and the deploy scripts) | — | — | — | **Not provisioned.** New project on the same account; non-US endpoint |
| **Postgres** | Yes — the indexer's event store; local dev via a compose file | — | — | — | **Not provisioned.** New *instance*, not a new schema in the old one |
| **Irys** | **No** — referenced only as an operations decision, no client code exists | — | — | — | **Not provisioned.** New funded node wallet |
| **Turnkey** | **No** — no integration exists in the repository | — | — | — | **Not provisioned.** New sub-org, not the old product's |
| **Switchboard** | Yes — On-Demand, both cluster program IDs hardcoded in `commit_vrf_seed.rs` | Public program | n/a | No stored credential | **Reused by design.** Randomness accounts are created per pool at runtime |
| **fal.ai** | **No** — referenced only as an operations decision | — | — | — | **Not provisioned.** New API key; **prompt blocklist required before any call** (PID §10, C11) |
| **Geolocation vendor** | **No** — the old product had none | — | — | — | **Not provisioned.** Contract first, then key. **Blocks launch** (C2) |
| **KYC vendor** | **No** — the old product had none | — | — | — | **Not provisioned.** Contract first, then key. **Blocks first settlement** (C8) |
| **Hosting** | Next.js app; provider not pinned in the repository | — | — | — | **Not provisioned.** Region explicitly Frankfurt or Dublin; **confirm no US region in any environment, previews included** |
| **DNS / domain** | `anarchy.fun` | — | — | — | **Not provisioned.** New domain; old one untouched |
| **Monitoring** | Prometheus / Grafana Cloud via an Alloy agent (`services/monitoring/`) | — | — | — | **Not provisioned.** New project, region matched to hosting |
| **Upstash Redis** | Yes — a referral store in the web app | — | — | — | **Not needed.** The dependency was dropped during extraction |
| **Privy** | Yes — wallet auth in the web app (devnet-only by construction) | — | — | — | **Not provisioned.** New app |
| **CI** | GitHub Actions | This repository | — | Repository secrets | **No secrets set.** None copied from the old repository |

**`.env.example`** carries exactly the playbook §5.1 variable list with no values. Real values belong
in the hosting provider's secret manager and the shared password-manager vault — never in the
repository, never in chat.

**Two constraints that are easy to satisfy late and expensive to satisfy late** (TECH-ARCH §11, PID
§9): hosting sits outside every blocked market, and the RPC provider must offer a non-US endpoint in
contract. Both apply to **preview and staging deployments too**, not just production.

---

## Reconnection

Playbook §5.2 order. **Nothing has been started.**

| # | Step | Date | Verified by |
|---|---|---|---|
| 1 | New Postgres up; migrations applied; backend connects with the new role only | — | — |
| 2 | New RPC endpoint; backend and frontend point at it; health check passes | — | — |
| 3 | Turnkey sub-org; signers created; backend can sign a test message | — | — |
| 4 | Devnet deploy; program ID into env; authority to devnet Squads | — | — |
| 5 | Irys node funded; test upload | — | — |
| 6 | Geo and KYC vendors in sandbox mode | — | — |
| 7 | Full devnet cycle (TECH-ARCH §12, Phase 5) | — | — |
| 8 | Mainnet keys, mainnet deploy, production instances — repeating 1–6 | — | — |

Step 4 is blocked on regenerating the program keypair (above). Steps 1–3 are not blocked on anything.

---

## Old resources to decommission

Record now, revoke in one pass once the old product is formally shut down, and **record the date**.
Nothing here has been touched.

### Keys — treat all as compromised

| What | Public key | Where it was | Note |
|---|---|---|---|
| Program-identity keypair | `57goj6dMYL9BuaGa18jnnTPH7ecztk5rfxiurc4UPW9r` | `target/deploy/anarchy-keypair.json`, **committed deliberately** so every deploy reused the declared ID | **Check the balance before retiring.** If the program is deployed on devnet or mainnet, this is its upgrade authority path |
| Devnet authority keypair | `9yx765Gvs3TsD5tBUuoq25jhtDHhG9oh8HBRFD6chMGK` | `tests/fixtures/anarchy-authority.json` | **Leaked onto `main` in commit `8c792f5`** and subsequently allowlisted in `.gitleaks.toml` rather than rotated. Assume fully public |

Public keys only — derived from the committed files, which were read and never copied. **No private
material was extracted, recorded, or transmitted.**

### The old program

| What | Value |
|---|---|
| Program ID | `57goj6dMYL9BuaGa18jnnTPH7ecztk5rfxiurc4UPW9r` (localnet and devnet in `Anchor.toml`) |

**Not reused.** Blotto Cup deploys at its own freshly generated ID.

### Provider resources

| Provider | What to revoke |
|---|---|
| **Helius** | The old project's RPC API key. Leave it live until the old product is formally decommissioned, then revoke |
| **Postgres** | The old database instance and its role |
| **Privy** | The old app, its app ID and its app secret |
| **Upstash Redis** | The old instance and its token — the referral store |
| **Hosting** | The old project and its deploy tokens |
| **Monitoring** | The old Grafana Cloud / Prometheus project and its keys |
| **DNS** | `anarchy.fun` |
| **GitHub Actions** | The old repository's secrets |

**Decommissioning date: not yet set.** The playbook is explicit that this should happen deliberately
rather than by neglect.

---

## Surprises

**1. The program keypair cannot survive this session.** It was generated in an ephemeral container.
This is the only actionable item in this report and it takes one command — see above.

**2. Half the infrastructure the playbook assumes was never provisioned by the old product.** The
playbook's §5 is written as "same accounts, new resources", which implies an account exists. For
**Turnkey, Irys, fal.ai, geolocation and KYC there is no old account** — the old repository has no
code for any of them, only an operations note naming Irys and fal.ai as intended. Those five rows are
new relationships to establish, not new resources on an existing account. Two of them
(**geolocation blocks launch, KYC blocks first settlement**) have procurement lead times that are not
engineering time, and are worth starting well before Phase 5.

**3. The leaked authority key was allowlisted, not rotated.** `tests/fixtures/anarchy-authority.json`
leaked onto `main` and the response was to add it to the gitleaks allowlist so CI would go green.
Understandable for a devnet test key, and it is why this repository's `.gitleaks.toml` carries the
custom rule but **not** the old allowlist — starting clean is what makes a red gitleaks result
meaningful.

**4. The program-identity keypair was committed on purpose.** Not a leak — a documented decision, so
that every deploy reused the declared program ID and `.gitignore` re-included the file explicitly. It
is still a private key in a repository. Blotto Cup keeps the keypair outside the repository entirely
and pins the ID in `Anchor.toml` and `declare_id!` instead, which achieves the same reproducibility
without the key.

**5. Switchboard is the one thing deliberately reused, and that is correct.** It is a public on-chain
program with no stored credential; randomness accounts are created per pool at runtime. Nothing to
rotate.

**6. The `@upstash/redis` dependency is gone rather than replaced.** It backed a referral feature that
does not exist in this product. Recorded here so the old instance still gets revoked rather than
forgotten because nothing points at it.

**7. Two constraints will be cheaper to satisfy now than later**: hosting region and RPC endpoint
region, in *every* environment including preview deployments. `app/src/chain/rpc.ts` carries the
front-end half of the rule — the endpoint falls back to devnet by construction, so an environment
that forgets to configure it lands somewhere harmless — but the real control is in the hosting
provider's configuration, and it is easier to set at project creation than to retrofit.

**8. "The smoke check passed" earned less trust on 2026-08-29, and the record says why.** During the
first devnet backend bring-up, two consecutive `deploy-backend` runs went green while the indexer's
hostname did not even resolve: the app had no public IP (its first, failed deploy never allocated
one), `flyctl deploy` had updated a crash-loop-stopped machine in place without starting it, and the
smoke step's `curl --fail … && echo` inside a `set -e` shell swallowed the resolution failure. The
service was down and unreachable for 22 hours behind green runs. Two fixes shipped in that window —
the pg idle-client error handler and the 512MB machine — are sound hardening that stays, but the
root-cause claims attached to each (idle-disconnect crash; OOM) were **wrong**, made before the
machine's event record was read. The lesson is procedural, and it is why the deploy workflow now
asserts public IPs and machine state and fails the smoke step honestly, and why `backend-status`
prints the per-machine event log (exit code, OOM flag): diagnose from the event record, not from
which hypothesis fits the symptoms best — and treat any green check whose failure path has not been
watched to fail as unproven.

**Also recorded for Phase 7:** the devnet admin multisig is Squads **v3** (`squads-mpl`,
`SMPL…ZekMu`); its signing address is the index-1 *authority* PDA, not a v4 "vault" PDA. Squads v4
is the current line — revisit before a permanent mainnet admin is chosen.

## Accepted gap: sub-national territory rules are not enforceable end to end

**Decision, founder, 2026-08-29: accepted as a written gap, not fixed in code.** Recorded here
because whoever adds the first sub-national rule needs to find this before they trust it.

`config/territories.json` accepts entries in two shapes: a country (`"BE"`) and a country-region
(`"US-NY"`). `territoryAllowed()` in `backend/packet/src/territories.ts` honours both — it checks
`${country}-${region}` against the block list whenever the geo lookup supplies a region, and treats
an unparseable region as blocked.

**The failure mode.** A region-level rule only bites if the geo vendor actually returns a region for
that address. Nothing asserts that it does. So a sub-national entry can sit in the config file
looking enforced while admitting every person it names — silently, with no error, no log line, and a
config file that reads as though the rule is live. The country-level entries beside it keep working
normally, which makes the broken one harder to notice, not easier.

**Why it is acceptable today.** The schedule is `{"blocked": ["BE", "AU"]}` — country-level only, so
there is nothing for the gap to break. Building a boot-time refusal now would be guarding a case
that does not exist.

**What must happen before the first sub-national rule ships.** Either a boot assertion that the
configured vendor returns a region for a known address in that country and the service refuses to
start otherwise, or an explicit per-rule capability check at load. Adding the config entry alone is
not enough, and is the failure this note exists to prevent.
