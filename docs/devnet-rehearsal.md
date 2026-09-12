# Devnet dress rehearsal — runbook and results (roadmap Phase 5)

**Status: RUNBOOK. The credentialed run has not happened yet** — it needs the
founder-provisioned devnet Squads vault, the Turnkey sandbox sub-org (R21),
a funded Irys upload wallet, and a deployed frontend. The OFFLINE half of
the rehearsal (same orchestrator, same crank, same detection, `FakeChain`
instead of devnet) runs in CI today: `tests/rehearsal/` settles twenty
64-entrant pools with the pot conserved to the lamport in each, notes the
scripted bot in shadow mode, and drains the 51-entry refund fork in full.

## Prerequisites (founder-owned, once)

| Item | Source | Playbook |
|---|---|---|
| Devnet Squads vault (admin) | app.squads.so, devnet | REPO-TRANSITION-PLAYBOOK §4.1 |
| Turnkey sandbox sub-org: entry signer + settlement signer + pool-key policy | turnkey.com | §4.2 |
| Funded devnet fee payer (~10 SOL: deploy rent + fees) | `solana airdrop` on devnet | — |
| Irys devnet upload wallet | irys.xyz | — |
| Deployed app (Frankfurt/Dublin region — TECH-ARCH §11: never US) | Vercel/equivalent | — |

## Sequence

1. **Deploy the program** (C12: one script — build, deploy, migrate,
   re-derive):
   ```
   BLOTTO_PROGRAM_KEYPAIR=/path/to/blotto_cup-keypair.json \
   BLOTTO_DATABASE_URL=postgres://... \
   ./scripts/deploy-devnet.sh
   ```
   The script refuses a keypair whose pubkey differs from the program's
   `declare_id`, applies every PENDING migration in filename order (a clean
   database gets all of them; an upgraded one gets exactly the new files —
   0004 seat payouts, 0005 terms version, 0006 review decisions, ...), and
   re-derives the derived tables from the events ledger. Then transfer the
   upgrade authority to the devnet Squads vault and verify
   `solana program show` reports the Squads address (Gate 1's founder check).
2. **Initialise — the admin CLI (E3).** Every admin call runs through
   `scripts/admin.ts`, two ways:

   - **direct-signed** (devnet rehearsal — the admin is a local keypair):
     set `FEE_PAYER_KEYPAIR=/path/to/admin.json` and run the command;
   - **`--emit-proposal --admin <squads-vault>`** (mainnet, or a devnet
     Squads vault): prints the instruction's accounts + base64 data
     WITHOUT signing — paste it into the Squads proposal. The CLI cannot
     sign for a multisig, by design.

   The rehearsal sequence, direct-signed (amounts are lamports, or exact
   decimal SOL written like `6.4sol` — parsed in bigint, never a float):

   ```bash
   export FEE_PAYER_KEYPAIR=/path/to/devnet-admin.json
   A="npx ts-node --transpile-only scripts/admin.ts"

   # One-time setup: signer becomes admin. Ceilings per D2: tier 0 at
   # 6.4 SOL, every other tier its own gross intake (entry × 64).
   $A init-config \
     --entry-signer   <turnkey-entry-signer-pubkey> \
     --settlement-signer <turnkey-settlement-signer-pubkey> \
     --ceilings 6.4sol,32sol,48sol,64sol,160sol,320sol,480sol \
     --min-platform <founder-ratified-lamports>

   # Bootstrap the prize treasury before any tier can open (D-A1 revised:
   # pots pre-fund from the treasury). Permissionless — any funder.
   $A fund-platform-wallet --amount 6sol

   # Only the 0.1 tier open at launch (R6, founder-owned).
   $A set-open-tiers --tiers 1,0,0,0,0,0,0

   # Rotate a service signer later (either flag, or both):
   $A register-signers --settlement-signer <new-pubkey>

   # The ONE treasury exit — blocked on-chain below the policy floor:
   $A withdraw-platform --amount 1sol --destination <founder-wallet>

   # Sanity read at any point (no keypair needed):
   $A status
   ```

   The `--ceilings` example is each tier's gross intake (entry × 64) per
   the D2 register and the shared tier constants (0.1 / 0.5 / 0.75 / 1 /
   2.5 / 5 / 7.5 SOL entries); the founder ratifies the actual numbers at
   run time — the CLI has no defaults for founder-owned figures.
   `--min-platform` is the mainnet treasury minimum awaiting ratification
   (its devnet stand-in can be small).
3. **Services up.**
   - **Indexer** — start with `npm --prefix backend/indexer run sync`: it
     migrates, runs one BACKFILL (the fallback that catches anything missed
     while the process was down), then serves the webhook. Webhook provider
     (Helius or equivalent raw-transaction webhooks): point a webhook at
     `http://<indexer-host>:<BLOTTO_INDEXER_PORT>/` filtered to the program
     address, with the shared secret as the Authorization header — the same
     value as `BLOTTO_HELIUS_WEBHOOK_SECRET`. Deliveries are idempotent
     (`(signature, event_index)` ledger key), so provider retries and
     overlapping backfills are safe; on any suspected gap, run
     `npm --prefix backend/indexer run backfill` — same write path.
   - **Entry service** — `@blotto/packet` `serveEntryApi` with the
     `TurnkeyPacketSigner` (C11; `TURNKEY_*` + `ENTRY_SIGNER_*` env).
   - **Daemon** — `@blotto/reveal` `makeDaemon` over `Web3Chain`, Turnkey
     custody (C11), the Irys publisher (`IRYS_UPLOAD_KEY`), the Switchboard
     coordinator; it settles sealed pools AND keeps one Open pool per open
     tier (C8).
   - **Review service** — `@blotto/detection` `serveReviewApi` with
     `config/reviewers.json` filled (C10).
   - **App** — `NEXT_PUBLIC_INDEXER_URL` / `NEXT_PUBLIC_ENTRY_API_URL` /
     `NEXT_PUBLIC_REVIEW_API_URL` / `NEXT_PUBLIC_PROGRAM_ID` /
     `NEXT_PUBLIC_SOLANA_RPC_URL`.
4. **5.1 — twenty pools.** The rehearsal orchestrator drives 64 wallets per
   pool through the four strategies; at least one pool per run enters
   through the REAL frontend, **by hand**.

   *There is no automated spec for that walkthrough (audit 2026-09-11, C-29 /
   D-32).* `tests/rehearsal/playwright/entry-flow.spec.ts` claimed to be one
   and was removed on 2026-09-12: it was written against a UI this app no
   longer has — it looked for a `battle allocation pentagon` group and a
   `lock in` button, neither of which exists anywhere in `app/src` — and it
   skipped itself whenever `APP_URL` was unset, which is always. It could
   never have passed, and nothing would have told you. Writing a replacement
   needs the deployed stack in front of you, so write it on the rehearsal
   day against what is actually on screen, not before.

   The credential-free half of the journey — landing, pool page, the entry
   gate's fail-closed panel, the verify page, at 375px and 1280px — IS
   automated and runs on every change: `app/e2e/journey.spec.ts`, the
   `journey` job of `ci-fast`.
5. **5.2 — failure paths, once each:**
   - 51 entries, shortened deadline → `trigger_refund` → all 51 entry
     payments refunded in full from the platform treasury, and the pool's
     untouched pot returns to the treasury; a pool at 52 or more seals and
     plays instead (`seal_at_deadline`; `FieldReached` refuses the refund at
     or above `MIN_SEATS` = 52);
   - `set_paused` mid-fill → `register` rejects → unpause → fill resumes;
   - Turnkey export refusal on an open pool past deadline → the refund path
     runs (the crank's `export-refused` step, then `trigger_refund`).
6. **5.3 — verify.** All twenty pools green on `/verify` from the public
   page; one recompute performed by someone who is not the founder.
7. **5.4 — load.** All 64 entrants concurrently: pool full in < 5 minutes;
   crank settles in < 2 minutes from the 64th entry. Record below.

## Results (filled by the run)

| Measure | Target | Observed |
|---|---|---|
| Pools settled cleanly | 20 | — |
| Fill time under concurrency | < 5 min | — |
| Seal → paid | < 2 min | — |
| `register` compute units | (record) | — |
| Refund fork reconciles | exact | — |
| Pause path | works | — |
| Export-failure path | refund runs | — |
| Public verify, non-founder | green | — |
