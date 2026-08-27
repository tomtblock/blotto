# Step report — client transaction wiring + balance pre-flight (`step/c9-tx-wiring`, C9)

**Status: delivered.** Item C9 of the 2026-08-27 master build prompt (D-C).
The play page's placeholder stubs are gone: an entry now goes through the
real `src/tx` pipeline to a confirmed `register`, the reveal machine takes
over on the outcome, and a wallet that cannot cover the entry is told so
BEFORE the ninety-second session starts.

**Stacks on C8** (`step/c8-daemon`).

## What was built

- **`entry/register-tx.ts`** — the pure builders: the Ed25519Program
  instruction over the service-issued packet (byte-for-byte the layout
  `entry_packet.rs` verifies, mirroring `tests/litesvm`'s `ed25519_ix`);
  the `register` instruction (discriminator ‖ pool_id ‖ battles_hash, the
  13 accounts in `register.rs` order); PDA derivation for all six PDAs;
  `Config.platform_wallet` extraction from raw account bytes (program
  re-pins the address, so a stale read fails, never misroutes); and the
  `EntryRegistered` decode from confirmed-transaction logs via the shared
  `_shared` event decoders.
- **`entry/services.ts`** — the live `EntryServices`: `requestPacket`
  POSTs `/packet` and returns message/signature/signer bytes;
  `sendRegister` derives PDAs, reads config, generates the fresh
  pass-asset keypair (Core requires its signature — it partial-signs
  locally AFTER the wallet, the pipeline's load-bearing order), builds
  both instructions and drives `executeTrade`. A terminal failure throws
  `RegisterFailedError` carrying the classified `TxFailure`.
- **`executeTrade` accepts an instruction list** (`instructions`), so the
  packet verification and `register` land in one transaction; the priority
  fee is scoped over every instruction's writable accounts.
- **`TxRpc.getAccountData`** — the one new RPC surface (the config read).
- **`entry/outcome.ts`** — `submitForReveal`: resolves, never rejects,
  with the reveal seam's `RevealResult`: confirmed (class/seat/pass from
  the entry's own event), `outcome-unreadable` when the tx landed but the
  logs don't carry the event (recorded entry — the surface renders
  recovery, never "try again"), or the classified failure.
- **The reveal machine wired on confirmation** — `play/reveal-host.tsx`
  hosts the carried PURE beat machine: outcome promise → `tx_confirmed` /
  `tx_failed`; taps; the timer schedule as data (`reveal/host-timing.ts`:
  strain → stall, tell/unseal → fixed durations); dismiss/retry. Retry is
  offered ONLY for never-broadcast failures (a fresh salt + upserted
  ciphertext + new packet — nothing landed; PID §8.6 stays intact).
  The card beat renders a minimal class card (the full card-stage
  choreography remains the reveal spec's later step).
- **The balance pre-flight** (`entry/balance-gate.ts`): before the battle
  flow renders, the wallet must cover `entry + ENTRY_COST_HEADROOM`
  (0.01 SOL, over-estimating Entry rent ~0.0023 + Core asset rent ~0.004 +
  fees). Fail-closed: an unreadable balance blocks with a retry. The
  shortfall copy states both numbers plainly (`COPY.gate.*`).
- **The top-up prompt behind a flag, OFF by default** (D-C):
  `NEXT_PUBLIC_TOPUP_ENABLED=1` AND a provider funding seam
  (`Auth.addFunds`, wired to Privy's `useFundWallet` — verified against
  the installed SDK types) are both required before the button exists.

## Judgement calls

1. **The headroom constant is an implementation guard, not a founder
   number** — the chain enforces every actual lamport; the constant only
   decides who is warned before spending ninety seconds. Documented with
   its derivation in `balance-gate.ts`.
2. **PDA derivation is cross-checked against `@solana/web3.js`** — a
   second, independent findProgramAddress implementation — rather than
   pinned against itself; the devnet rehearsal (C12) exercises the same
   derivation against the deployed program.
3. **`useFundWallet` over the experimental `useAddFunds`.** The SDK marks
   `useFundWallet` deprecated in favor of `useAddFunds`, but the latter is
   flagged `@experimental` ("may change at any time"); behind a
   default-OFF flag, the stable-typed hook is the safer seam. Revisit when
   the flag turns on.
4. **The reveal card beat renders a minimal card.** The machine, stage
   beats (entry → unseal) and choreography constants are the carried
   reveal work; the card-stage component was never built (its own step in
   the reveal spec). C9's obligation is the machine wired on confirmation
   — the card shows class, seat and pass honestly and leaves the full
   card choreography where the spec has it.

## Tests

App 173 vitest (18 new): Ed25519 layout byte-pinned; PDA parity with
web3.js; register account order/roles + discriminator (node-crypto
computed, not @noble); config-slice offsets; EntryRegistered decode over
log lines assembled independently (wrong-player filtered, garbage null);
`submitForReveal`'s four terminal shapes; the balance gate's exact
boundary and fail-closed throw; the beat-timer schedule; multi-instruction
`executeTrade` (fee estimate spans all instructions; empty set refused).
Typecheck, lint, production build clean; language, standing-rules and
gitleaks gates clean.

## For the founder

- Two new environment values must be set where the app deploys:
  `NEXT_PUBLIC_PROGRAM_ID` (the program address) alongside the existing
  RPC and entry-API URLs. Absent, the submit fails with a plain "not
  configured" message before anything is signed.
- The top-up flow stays OFF until you flip `NEXT_PUBLIC_TOPUP_ENABLED=1`
  (and Privy funding is enabled in its dashboard).
