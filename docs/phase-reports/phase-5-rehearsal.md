# Phase 5 report — dress rehearsal and internal review

**Status: everything runnable without the founder's credentials is done and
in CI; the devnet half is a written runbook awaiting provisioning.**

## What exists

- **The offline rehearsal** (`tests/rehearsal/`, in CI): the four entrant
  strategies (random / consistent / clustered / scripted-uniform-timing),
  the pool-cycle orchestrator, and a suite that settles TWENTY 64-entrant
  pools through the real crank + real detection with the pot conserved to
  the lamport in every one; the scripted bot is noted in shadow mode and not
  blocked (R11 exactly); the 63-entry refund fork drains in full.

  The orchestrator does NOT take `Web3Chain` (audit 2026-09-11, G-16): it
  constructs its own `FakeChain` and returns that concrete type. The devnet
  run is the DAEMON over `Web3Chain`, per `docs/devnet-rehearsal.md`.
- **The Playwright entry-flow spec** (5.1's "through the real frontend"):
  REMOVED 2026-09-12 (audit 2026-09-11, C-29 / D-32). It described dragging
  a pentagon and clicking "lock in"; neither selector matches anything in
  `app/src`, and it skipped itself without `APP_URL`, so it had never run
  and could not have passed. 5.1's frontend entry is a manual walkthrough on
  the rehearsal day — see `docs/devnet-rehearsal.md` step 4. The
  credential-free journey (`app/e2e/journey.spec.ts`) is automated and runs
  in `ci-fast`.
- **`docs/devnet-rehearsal.md`**: the full runbook — prerequisites table
  (Squads, Turnkey, Irys, hosting region), deploy + init sequence, the three
  failure paths of 5.2, the 5.4 load targets, and the results table the run
  fills in.
- **`docs/internal-review.md`** (5.5, the R5 substitute): the program
  reviewed against TM-401/402/403/502 and the ten-class Anchor checklist.
  One finding FIXED during review (IR-1: permissionless
  `create_pass_collection` accepted caller metadata — now derived on-chain);
  three accepted risks documented for founder ratification (IR-2 Switchboard
  cluster-ID acceptance, IR-3 PDA donations, IR-4 escrow liveness).

## For the founder to do (the run cannot start without these)

1. Devnet Squads vault + Turnkey sandbox sub-org (playbook §4).
2. Funded devnet fee payer and Irys devnet wallet.
3. App deployed (Frankfurt/Dublin — never a US region, TECH-ARCH §11).
4. Read `docs/internal-review.md` IR-2..IR-4 and decide each.

## Judgement call

The rehearsal was split rather than deferred: the roadmap's Phase 5 is
devnet-shaped, but ~90% of its assertions (settlement correctness,
conservation, detection behaviour, refund completeness, bundle/root
equality) do not require a cluster — so they run on every push, and the
devnet day shrinks to infrastructure + timing measurements.
