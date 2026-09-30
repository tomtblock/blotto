/*
 * Core types for the transaction seam (10.B Step 2).
 *
 * `TxSigner` is the "one code path, two signers" boundary: the seam builds,
 * submits, and confirms transactions identically for the Privy embedded
 * wallet and for external wallet-standard wallets — the only thing that
 * differs is who produces the signature. The adapter that turns Privy
 * wallets into `TxSigner`s lives in `src/lib/auth` (the D-08 provider
 * boundary); nothing under `src/lib/tx` may import the provider SDK.
 */

/** Where a signer's key lives — display metadata only, never a code path. */
export type WalletKind = "embedded" | "external";

/**
 * A wallet that can sign a compiled transaction. `signTransaction` takes the
 * full wire-format transaction bytes (placeholder signatures included) and
 * returns the same transaction with the wallet's signature filled in.
 */
export interface TxSigner {
  /** Base58 wallet address (the fee payer of everything it signs here). */
  address: string;
  kind: WalletKind;
  /** Human-readable wallet name ("Privy", "Phantom", …) for the picker. */
  label: string;
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
  /**
   * Ed25519 signature over an arbitrary human-readable message (the D-B4
   * attestation clickwrap). Optional: an adapter that cannot sign messages
   * simply cannot attest — the flow fails closed, never around.
   */
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * §5 lifecycle phases (frontend PRD §5 / roadmap 10.B: quote → submitting →
 * pending → confirmed / failed). "quote" is the armed idle state — a live
 * quote is on screen and nothing is in flight.
 */
export type TradePhase =
  | "quote"
  | "submitting"
  | "pending"
  | "confirmed"
  | "failed";

/**
 * The distinct failure surfaces the seam reports. Every failure is exactly one
 * of these — "rpc-failure" is the honest catch-all, never a dressing-up of a
 * classifiable error.
 *
 * CHANGED IN EXTRACTION: the predecessor had "slippage-exceeded" and
 * "rate-limited" here, both of which named that product's own mechanics (a
 * moving price quote, and a per-wallet cooldown). Neither exists here. They are
 * replaced by "program-rejected" — a recognised on-chain rejection — which
 * `errors.ts` refines as Phase 1 gives the program errors worth distinguishing.
 *
 * The two `outcome-*` kinds are POST-CONFIRMATION failures: the transaction
 * LANDED and SUCCEEDED on-chain — the entry is recorded and the money has moved
 * — but the outcome could not be read back honestly.
 *
 * ⚠ RENDERING OBLIGATION for the consumer: these must NEVER render a
 * "nothing happened, try again" surface. The entry IS recorded, and a retry
 * would enter a SECOND time — which PID §8.6 forbids, since decisions are final
 * on submission. Recovery is a re-read of the chain's own record, never a
 * resubmission.
 */
export type TxFailureKind =
  | "user-rejected"
  | "insufficient-sol"
  | "blockhash-expired"
  | "program-rejected"
  // The three program refusals a player can actually meet at `register`,
  // split out of "program-rejected" on 2026-09-09 (the generic sentence
  // guessed at "filled or closed" and was wrong for a pause).
  | "entries-paused"
  | "pool-full"
  | "deadline-passed"
  // 2026-09-09 (founder: "tried to enter again from the same wallet and got
  // a network error"): a second `register` from the same wallet fails at the
  // entry PDA's `init` ("already in use"), and the pool may have left Open
  // (PoolNotOpen). Both used to fall through to the generic network sentence.
  | "already-entered"
  | "pool-closed"
  // 2026-09-11 (audit O27): the packet is good for sixty seconds, so a wallet
  // approval slower than that is refused on-chain as `PacketStale` (6019).
  // It used to fall through to the generic network sentence with no retry.
  | "packet-stale"
  // 2026-09-11 (audit D-12): the ENTRY SERVICE declined, before anything was
  // signed — an eligibility or availability check, answered with a generic
  // refusal by design. Distinct from "rpc-failure", which is the honest
  // "we could not reach it": a refusal is an answer, and a retry repeats it.
  | "entry-refused"
  // 2026-09-18 (DRIFT.md §H6): the ciphertext store answered 409 — this
  // wallet's allocation for this pool is already settled, or the pool has
  // stopped taking entries. NOT an eligibility decision, and it used to be
  // shown as one: the player was told they were not allowed to enter, when
  // what happened is that an earlier attempt is the one that stands.
  | "seal-conflict"
  // 2026-09-30 (the Android shell, MOBILE.md §9): the entry could not be
  // BUILT on this device — the pass asset's keypair, WebCrypto Ed25519 —
  // before anything was sent. It used to fall through to the network
  // sentence, which sent a night's investigation down the wrong path.
  | "build-failed"
  | "rpc-failure"
  | "outcome-unreadable"
  | "outcome-mismatch";

export interface TxFailure {
  kind: TxFailureKind;
  /** Plain-language copy (NG-207: descriptive, no urgency). PROVISIONAL. */
  message: string;
  /** Raw underlying detail for the dev log / debugging. */
  detail: string;
  /**
   * Whether the transaction was broadcast before failing. False means the
   * wallet never spent anything; true means the failure is on-chain or
   * indeterminate and the signature (if any) is worth checking.
   */
  broadcast: boolean;
  /**
   * Whether a fresh attempt is SAFE: nothing landed and nothing can still
   * land, so entering again cannot enter twice. Distinct from `broadcast`: a
   * transaction the chain confirmed as FAILED was broadcast, yet a retry is
   * safe because the runtime never created the entry. False for the
   * indeterminate failure (a silent cluster past the timeout — it may still
   * land) and for every kind where the entry IS on-chain (the `outcome-*`
   * kinds and `already-entered`), and for refusals the program would repeat
   * (paused, full, past the deadline, closed). Set at creation by
   * `errors.ts`; the reveal offers "Try again" from this and nothing else.
   */
  retryable: boolean;
}

/** One timestamped transition, rendered verbatim by the dev state log. */
export interface LifecycleLogEntry {
  phase: TradePhase;
  /** Milliseconds since epoch (injectable clock in tests). */
  at: number;
  /** Free-form context: quote summary, signature, failure detail, … */
  detail?: string;
  signature?: string;
  failure?: TxFailure;
}
