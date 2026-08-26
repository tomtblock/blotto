# Repo Transition Playbook — forked `anarchy-fun` → `blotto-cup`

**Date:** 2026-08-26 · **For:** Claude Code, run in the forked repo
**Purpose:** audit the fork, keep what the extraction brief says to keep, remove everything else, rotate every secret and key, and provision fresh infrastructure on the existing provider accounts.
**Pair with:** `REPO-EXTRACTION-BRIEF.md` (what to carry) · `TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` (what to build).

> Written without access to the fork. Every path and branch name below is an expectation to verify, not a fact. Record what you actually find in `TRANSITION-REPORT.md`.

---

## 0. Two rules before anything

**Rule 1 — no key from the old repo is reused. Ever.** Not the program upgrade authority, not the reveal authority, not the XP signer, not any deploy wallet, not any RPC key, not any database credential. Assume all of them appear somewhere in git history, a `.env` that was committed once, a CI log, or a teammate's clipboard. Generate everything fresh (§4–§5) and treat the old material as compromised from the moment the fork is created.

**Rule 2 — the fork's history is a liability, not an asset.** The old PRD's language ("casino disguised as a creator launchpad", "gambling-coded") and the old product's design are discoverable in litigation, and a fork carries them forever. The extraction brief exists so you can take *components* without taking *history*. Decide §1 first.

---

## 1. Fork versus fresh — decide this before touching branches

| | Keep the fork | Fresh repo, copy components in |
|---|---|---|
| Git history | Carries every old commit, message and deleted file | Clean |
| Discoverable language | Present in history regardless of what you delete now | Absent |
| Secrets in history | Present; must scrub with `git filter-repo` and force-push, which is fragile | Absent |
| Effort | Lower to start, higher to clean | Higher to start, nothing to clean |
| Blame / archaeology | Useful for understanding the randomness crate | Available in the old repo, which still exists |

**Recommendation: fresh repo.** Use the fork only as a working copy to extract from. If the decision is to keep the fork anyway, §2 becomes mandatory rather than advisory.

---

## 2. History and secrets audit (mandatory if keeping the fork; advisable regardless)

```bash
# 2.1 What's in the history
git log --all --oneline | wc -l
git log --all --diff-filter=D --name-only --pretty=format: | sort -u   # every file ever deleted

# 2.2 Secrets scan across ALL history, not just HEAD
gitleaks detect --source . --log-opts="--all" --report-path gitleaks.json
trufflehog git file://. --only-verified

# 2.3 Specific patterns worth grepping the full history for
git log --all -p | grep -nE '(private_key|PRIVATE_KEY|secret|SECRET|api_key|API_KEY|\[[0-9]{1,3},[0-9]{1,3},[0-9]{1,3})' | head -100
#   the last pattern catches Solana keypair JSON arrays

# 2.4 Language audit across history
git log --all -p | grep -niE 'casino|gambling|disguised|dopamine|shill|degen|the house' | wc -l
```

Anything found in 2.2–2.3: treat that credential as burned (it is being rotated anyway under Rule 1), and record it in the report so the old accounts get the rotation too. If you are keeping the fork and want history scrubbed: `git filter-repo` with a replacements file, then force-push — and understand that every existing clone still has the old history.

---

## 3. Branch audit

```bash
git fetch --all --prune
git branch -r --sort=-committerdate --format='%(refname:short) %(committerdate:short) %(authorname)'
```

Classify every branch:

| Class | Test | Action |
|---|---|---|
| **Carry** | Contains a component listed in the extraction brief that is not already on `main` | Cherry-pick the specific commits into the new repo; do not merge the branch |
| **Reference** | Contains design context (ADRs, handover prompts, the rarity doc) | Export the documents to `10_BLOTTO_CUP/reference/` in Drive; do not carry the branch |
| **Dead** | Curve, synthetic sell, XP boost, trending, treasury, EOL, Magic Eden — or anything merged, stale, or experimental | Delete: `git push origin --delete <branch>` after recording the name and last commit hash in the report |
| **Unknown** | Can't classify from the log | Open it, read the diff against `main`, classify, record why |

Expected to find (verify): `main`, something like `phase-6/randomness` or `adr-026`, `phase-9/pack-open`, curve-related branches, XP/boost branches, frontend branches, possibly `cursor/*` agent branches. The randomness and packet-verification work is the only thing likely to be carry-class if it isn't on `main`.

Do not delete anything until the extraction brief has been fully executed and the report lists what was carried from where. Then delete in one pass.

---

## 4. Solana keys — generate fresh, custody properly

### 4.1 Keys required

| Key | Purpose | Custody | Generation |
|---|---|---|---|
| Program upgrade authority | `blotto_cup` upgrades | **Squads multisig** (n-of-m, published timelock) | Squads UI; record vault address |
| Deploy wallet | initial deploy + rent | Local keypair, funded, then **authority transferred to Squads immediately after deploy** | `solana-keygen new -o deploy.json` |
| `Config.admin` | rotate signers, pause | Squads (same vault as above) | — |
| Entry-packet signer | signs `EntryPacket` | **Turnkey**, policy: sign only, no export | Turnkey console |
| Settlement signer | `open_pool`, `reveal_pool_secret`, `commit_results`, `flag_entry` | **Turnkey**, sign only | Turnkey console |
| Pool secret keys (X25519, one per pool) | sealing | **Turnkey**, policy: export only after state Sealed or deadline | Generated by backend at `open_pool` |
| Platform wallet | receives 20% | Squads or hardware | — |
| Devnet equivalents of all of the above | testing | Local, throwaway, clearly named `devnet-*` | `solana-keygen` |

### 4.2 Procedure
1. Generate devnet keys first; build and test against them end to end.
2. Generate mainnet keys only when Phase 7 is scheduled. Never before.
3. Squads: create the vault, add signers, set threshold and timelock, **publish the vault address and signer list** on the rules page.
4. Turnkey: create a new organisation or a new sub-org for this product — do not reuse the old product's org. Create signers with explicit policies. Record policy IDs.
5. After deploy: `solana program set-upgrade-authority <program_id> --new-upgrade-authority <squads_vault>`. Verify with `solana program show`.
6. Destroy the deploy keypair's private material after authority transfer, or move it to cold storage with a note that it holds no authority.
7. Never commit a keypair file. `.gitignore` every `*.json` under `keys/` and add a pre-commit hook that rejects 64-integer arrays.

---

## 5. Infrastructure — new instances on existing provider accounts

The principle: **same accounts, new resources, new credentials.** Nothing shared with the old product at the resource level.

| Provider | Action | Credential handling |
|---|---|---|
| **RPC** (Helius / QuickNode / Triton — whichever the old repo used) | Create a **new project or endpoint** on the same account; select a non-US region if the provider offers it; record the endpoint | New API key; old key left untouched until the old product is formally decommissioned, then revoked |
| **Postgres** (Supabase / Neon / RDS / whatever) | Create a **new database instance**, not a new schema in the old one. Separate connection string, separate role, least-privilege | New password; never the old one |
| **Irys** | New funded node wallet (a fresh Solana keypair funded for uploads) | Fresh keypair; old one untouched |
| **Turnkey** | New sub-org (§4.2) | New API keys for the backend |
| **Switchboard** | Reuse the public program; new randomness accounts are created per pool at runtime | No stored credential |
| **fal.ai** | New API key on the same account | Rotate |
| **Geolocation vendor** | New — the old product had none | Contract, then key |
| **KYC vendor** | New — the old product had none | Contract, then key |
| **Hosting** (Vercel / Fly / Railway / VPS) | New project; **region explicitly set to Frankfurt or Dublin**; confirm no US region in any environment including preview deployments | New deploy tokens |
| **DNS / domain** | New domain for the product; old domain untouched | — |
| **Monitoring / logging** | New project; region matched to hosting | New keys |
| **CI** | New repository secrets; none copied from the old repo's settings | — |

### 5.1 Environment
Create `.env.example` in the new repo with every variable name and no values. Store real values in the hosting provider's secret manager and in a password manager shared vault — never in the repo, never in Slack.

```
SOLANA_CLUSTER=devnet
RPC_URL=
PROGRAM_ID=
SQUADS_VAULT=
TURNKEY_ORG_ID=
TURNKEY_API_PUBLIC_KEY=
TURNKEY_API_PRIVATE_KEY=
ENTRY_SIGNER_ID=
SETTLEMENT_SIGNER_ID=
DATABASE_URL=
IRYS_NODE_KEYPAIR_PATH=
FAL_API_KEY=
GEO_VENDOR_KEY=
KYC_VENDOR_KEY=
HOSTING_REGION=fra
```

### 5.2 Reconnection order
1. New Postgres up; migrations applied; backend connects with the new role only.
2. New RPC endpoint; backend and frontend point to it; health check passes.
3. Turnkey sub-org; signers created; backend can sign a test message.
4. Devnet deploy; program ID into env; authority to devnet Squads.
5. Irys node funded; test upload.
6. Geo and KYC vendors in sandbox mode.
7. Full devnet cycle (architecture §12 Phase 5).
8. Only then: mainnet keys, mainnet deploy, production instances — repeating 1–6 with production credentials.

---

## 6. Decommissioning the old product's resources

Not part of this build, but record the list so it happens deliberately rather than by neglect: old RPC keys, old database, old Turnkey org, old deploy wallets (check balances first), old hosting projects, old domain. Revoke in one pass once the old product is formally shut down, and record the date.

---

## 7. Report

`TRANSITION-REPORT.md` in the new repo:

```
## Decision: fork kept / fresh repo
## History audit: commits, deleted files, secrets found (redacted), language hits
## Branches: table of name · class · action · last commit · reason
## Components carried: from EXTRACTION-REPORT.md
## Keys generated: purpose · custody · public key · policy ID (never private material)
## Infrastructure: provider · resource ID · region · credential location (vault path, not value)
## Reconnection: step · date · verified by
## Old resources to decommission: list
## Surprises
```

---

*Filed: 10_BLOTTO_CUP.*
