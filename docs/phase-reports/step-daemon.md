# Step report — the settlement-and-keeper daemon (`step/c8-daemon`, C8)

**Status: delivered.** Item C8 of the 2026-08-27 master build prompt (D-C).
The one long-running process the product loop needs: sealed pools go through
the crank to Paid; expired Open pools are refund-triggered and drained; and
every open tier always has exactly one Open, launch-complete pool — the
moment a slot frees at seal or refund, the next tick opens the successor.

**Stacks on B7** (`step/b7-vocabulary`).

## What was built

- **`backend/reveal/src/daemon.ts`** — `makeDaemon(deps)` returning
  `{ tick, run }`. A tick is two passes:
  1. *Settle*: sweep pool ids from a floor to `Config.next_pool_id`; an
     Open pool past `fill_deadline` gets `trigger_refund`; anything
     Sealed / Scored / Refunding goes through the injected crank. The floor
     advances only over a terminal (Paid/Closed) prefix, so a stuck pool is
     retried every tick and never silently skipped.
  2. *Keep*: for each tier open in `Config`, if `active_pool_by_tier` is 0,
     open the successor — sealing key from custody → `open_pool` →
     `commit_vrf_seed` → `create_pass_collection` — then complete whatever
     launch steps the tier's Open pool still misses (this same completion
     path is what makes crash resume work). Config is re-read per tier so
     `next_pool_id` is always fresh.
  Poll-based and stateless: no local database; every tick reads the chain
  and does only what is missing. Every per-pool/per-tier failure is caught
  into the tick report; one broken pool never stops the sweep. `run()`
  loops tick → sleep with an `AbortSignal`, and a throwing tick (RPC down)
  is logged and retried.
- **`KeeperChain`** (`chain.ts`) — the daemon's seam over `SettlementChain`:
  `getConfig`, `openPool`, `commitVrfSeed`, `createPassCollection`,
  `hasPassCollection`, `initConfig`. `ChainPoolView` gains `tier` and
  `vrfCommitted`; `ChainConfigView` carries `paused`, `openTiers`,
  `activePoolByTier`, `nextPoolId`.
- **`Web3Chain`** implements it: hand-encoded builders for `open_pool`,
  `commit_vrf_seed`, `create_pass_collection` and `init_config` against the
  program's wire contract (exact account orders from the instruction
  structs; `Config` offsets from the LEN-asserted layout). `init_config`
  signs with an optional `adminSigner` — a deploy-time step, absent in the
  long-running daemon. `commitVrfSeed` bundles an optional Switchboard
  reveal instruction (`makeVrfRevealIx` seam) in the same transaction,
  because the program reads the revealed value only in its exact reveal
  slot (vrf.rs).
- **`FakeChain`** mirrors all of it with the program's guards: gapless ids
  (`WrongPoolId`), R6 (`TierNotOpen`), R14 (`TierAlreadyHasOpenPool`),
  write-once VRF seed and collection PDA, entry prices from the shared D1
  table, and the slot-clearing behavior of the 64th `register`
  (`sealPool` test helper) and `trigger_refund`.
- **`VrfCoordinator`** — the daemon-facing Switchboard seam
  (`commitSeed(poolId)`), with `StubVrfCoordinator` for tests and benches.
  The production adapter (create Randomness account, commit, reveal,
  bundle) is C11 vendor work.
- **`PoolKeyCustody.getPublishedKey`** (`backend/sealing`) — read-only
  lookup of the public half, added for the crash window between
  `createPoolKey` and `open_pool` landing: on resume the daemon republishes
  the SAME key, because the on-chain hash must commit to the secret custody
  actually holds. `LocalCustody` implements it; never touches the secret.

## Judgement calls

1. **Poll, not events.** The master prompt says poll-based; it is also the
   robust choice — webhooks/logs can drop, but `Config` + the gapless pool
   ids make a full-state read cheap and complete. The floor keeps the sweep
   O(active pools) once history is terminal.
2. **A paused config holds the keeper, not settlement.** `set_paused`
   blocks `register` only; opening pools nobody can enter is pointless
   churn, while settlement and refunds must keep working precisely while
   paused (pausing never strands funds). // PHASE-C-REVIEW in daemon.ts.
3. **Double-run safety is the program's guards, not a lock.** The daemon
   holds no lease; a concurrent daemon's losing transaction is rejected
   on-chain (wrong id / occupied tier / write-once / paid-mask), the loser
   records the error, and the next tick reads the winner's state. FakeChain
   mirrors each guard so the tests exercise the real contract.
4. **The production process entry ships with C11/C12**, when Turnkey
   custody, the Irys publisher and the Switchboard coordinator exist to
   wire in — the same seam posture the crank took in Phase 2. C8 delivers
   the whole behavior behind injected deps.

## Tests

`backend/reveal` 20 passing (12 new daemon specs): first-tick launch
(open + VRF + collection, then a no-op second tick); one pool per open tier
with the D1 price per tier; paused holds the keeper only; the product loop
(seal → crank to Paid → tier reopens in one tick, pot conserved exactly);
deadline → refund-trigger → drain → replace (full 100% refunds, R7), empty
pool closes; resume-after-crash (pre-crash key republished byte-identical;
pre-crash pool completed, not duplicated; a VRF failure reported and
completed next tick); double-run (two daemons: exactly one pool per tier;
two daemons settling one sealed pool: rest state Paid, paid+escrowed equals
the pot exactly); the run loop survives a failing tick and stops on abort.
Sealing 8, rehearsal 7, scoring 72, packet 37, indexer 28, detection 6,
_shared 42, class-digest 10 all green; typechecks clean.
