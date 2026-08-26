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
