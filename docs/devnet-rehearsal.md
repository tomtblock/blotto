# Devnet dress rehearsal — runbook and results (roadmap Phase 5)

**Status: RUNBOOK. The credentialed run has not happened yet** — it needs the
founder-provisioned devnet Squads vault, the Turnkey sandbox sub-org (R21),
a funded Irys upload wallet, and a deployed frontend. The OFFLINE half of
the rehearsal (same orchestrator, same crank, same detection, `FakeChain`
instead of devnet) runs in CI today: `tests/rehearsal/` settles twenty
64-entrant pools with the pot conserved to the lamport in each, notes the
scripted bot in shadow mode, and drains the 63-entry refund fork in full.

## Prerequisites (founder-owned, once)

| Item | Source | Playbook |
|---|---|---|
| Devnet Squads vault (admin) | app.squads.so, devnet | REPO-TRANSITION-PLAYBOOK §4.1 |
| Turnkey sandbox sub-org: entry signer + settlement signer + pool-key policy | turnkey.com | §4.2 |
| Funded devnet fee payer (~10 SOL: deploy rent + fees) | `solana airdrop` on devnet | — |
| Irys devnet upload wallet | irys.xyz | — |
| Deployed app (Frankfurt/Dublin region — TECH-ARCH §11: never US) | Vercel/equivalent | — |

## Sequence

1. **Deploy the program.**
   ```
   anchor build
   anchor deploy --provider.cluster devnet
   solana program show 4pspHqtbdgqKTvSxvKFT2ycEU28u3EWdxjmj3xsTHD3Y
   ```
   Then transfer the upgrade authority to the devnet Squads vault and verify
   `solana program show` reports the Squads address (Gate 1's founder check).
2. **Initialise.** `init_config` signed by the Squads vault, carrying the
   Turnkey entry-signer and settlement-signer pubkeys, the platform wallet,
   and the seven per-tier ceilings (D2): tier 0 at 6.4 SOL, every other
   tier at its own gross intake (entry × 64 — e.g. tier 6 at 480 SOL).
   Only the 0.1 tier is open at launch; the others stay gated by the R6
   switch until the founder opens them (`set_open_tiers`), and each
   ceiling moves one tier per `set_vault_ceiling` call.
3. **Services up.** Indexer (webhook + read API), entry service
   (`@blotto/packet` `serveEntryApi`) with the Turnkey `PacketSigner`, the
   crank (`@blotto/reveal` with `Web3Chain`, Turnkey custody, Irys
   publisher), app with `NEXT_PUBLIC_INDEXER_URL` / `NEXT_PUBLIC_ENTRY_API_URL`.
4. **5.1 — twenty pools.** The rehearsal orchestrator drives 64 wallets per
   pool through the four strategies; at least one pool per run enters
   through the REAL frontend via `tests/rehearsal/playwright/entry-flow.spec.ts`
   (`APP_URL=… npx playwright test`).
5. **5.2 — failure paths, once each:**
   - 63 entries, shortened deadline → `trigger_refund` → all 63 refunded in
     full including the 20% (the fees PDA drains to zero);
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
