/*
 * Failure classification for the transaction seam — every error surface maps to
 * exactly one `TxFailureKind`, each with its own plain-language message.
 *
 * Carried from the predecessor repository. The CLASSIFICATION is what was worth
 * carrying; the program-specific codes and every string were not, and are
 * replaced below.
 *
 * Classification sources, in the order execute.ts encounters them:
 *  - wallet / signing errors (the person closed or declined the prompt);
 *  - simulation and preflight send errors (program custom codes arrive as
 *    "custom program error: 0x…" strings or InstructionError objects, plus the
 *    runtime's "Blockhash not found" / "insufficient lamports" texts);
 *  - confirmation-status errors (structured `TransactionError` objects);
 *  - the seam's own expiry sentinel (the validity window lapsed while waiting).
 *
 * The matching is deliberately tolerant about error SHAPE — wallet SDKs and RPC
 * clients wrap errors differently — and strict about never guessing: anything
 * unrecognised is an honest "rpc-failure" rather than a confident wrong answer.
 *
 * TODO(phase-1): keep PROGRAM_ERROR_CODES in step with
 * programs/blotto_cup/src/error.rs, and split "program-rejected" into distinct
 * kinds as Phase 1 adds errors a player can actually hit. Anchor numbers custom
 * errors from 6000 in DECLARATION ORDER, so the map must be regenerated whenever
 * a variant is inserted rather than appended — an off-by-one here shows someone
 * the wrong reason for a failure, confidently.
 */

import { COPY } from "@/copy";
import type { TxFailure, TxFailureKind } from "./types";

/**
 * Anchor custom error codes from programs/blotto_cup/src/error.rs (Anchor
 * numbers them from 6000 in declaration order).
 *
 * Every entry maps to the generic "program-rejected" today. That is deliberate
 * rather than lazy: none of these five can currently reach a player's screen —
 * they are raised by instructions only a settlement signer calls, or by a
 * malformed oracle account — so inventing distinct player-facing surfaces for
 * them would be inventing copy for states nobody can reach. Phase 1 splits the
 * kind as it adds errors a player CAN hit (capacity, deadline, packet, proof).
 */
export const PROGRAM_ERROR_CODES: Readonly<Record<number, TxFailureKind>> = {
  6000: "pool-closed", // PoolNotOpen — the pool left Open before the entry reached it
  6001: "program-rejected", // VrfSeedAlreadyCommitted
  6002: "program-rejected", // InvalidRandomnessAccount
  6003: "program-rejected", // RandomnessNotResolved
  6004: "program-rejected", // VrfSeedNotCommitted
  // The three `register` refusals a player can meet from the play screen.
  // Positions verified against error.rs on 2026-09-09: 6005 Paused, 6006
  // TierNotOpen … 6010 PoolFull, 6011 DeadlinePassed. Inserting a variant
  // above any of these in error.rs renumbers them — errors.test.ts pins the
  // three positions against the Rust source so that drift fails a test
  // instead of showing a player the wrong reason.
  6005: "entries-paused", // Paused
  6010: "pool-full", // PoolFull
  6011: "deadline-passed", // DeadlinePassed
  // 2026-09-11 (audit O27): the fourth refusal a player can meet. The packet
  // service stamps `issued_at` when the packet is requested — immediately
  // before the transaction is built — and the program refuses a packet older
  // than 60 s, so a wallet prompt approved slowly lands a transaction the
  // chain rejects. Nothing is charged; a retry with a fresh packet is safe.
  6019: "packet-stale", // PacketStale
};

/**
 * Whether a fresh attempt is safe, per kind, where the answer does not depend
 * on the instance. Absent means "decide from the instance" (`makeFailure`).
 *
 *  - The program would refuse again → false (paused, full, past the
 *    deadline, closed); the page re-reads the pool instead.
 *  - A seat is already held → false; a retry would be a second entry.
 *  - The entry landed and only the read-back failed → false, for the same
 *    reason (PID §8.6: decisions are final on submission).
 */
const RETRYABLE_BY_KIND: Readonly<Partial<Record<TxFailureKind, boolean>>> = {
  "entries-paused": false,
  "pool-full": false,
  "deadline-passed": false,
  "pool-closed": false,
  "already-entered": false,
  "outcome-unreadable": false,
  "outcome-mismatch": false,
};

/**
 * The kinds where the ENTRY EXISTS ON-CHAIN despite the failure surface: the
 * transaction landed and only the read-back failed, or the wallet already
 * held a seat from an earlier entry. The reveal's exit reads this (audit O25):
 * a dismissed failure of one of these kinds leaves to the sealed panel, because
 * the player does hold a seat; any other dismissed failure must not.
 */
const ENTRY_RECORDED_KINDS: ReadonlySet<TxFailureKind> = new Set<TxFailureKind>([
  "outcome-unreadable",
  "outcome-mismatch",
  "already-entered",
]);

/** True when the player holds a seat in spite of the failure shown. */
export function entryRecorded(failure: Pick<TxFailure, "kind">): boolean {
  return ENTRY_RECORDED_KINDS.has(failure.kind);
}

/**
 * The message shown for each failure kind.
 *
 * Filled per master prompt v3 D-UI-3 (brand voice stays founder-owned; the
 * founder may re-voice). PID §8.7 makes the vocabulary a legal-position rule
 * rather than a matter of tone.
 *
 * Two properties any re-voicing must preserve, because they are correctness
 * and not style:
 *
 *  1. **Say what happened.** Describe the state plainly, offer the factual next
 *     step, add no urgency.
 *  2. **The post-confirmation kinds must never imply nothing happened.** For
 *     "outcome-unreadable" and "outcome-mismatch" the transaction LANDED — the
 *     entry is recorded and the money has moved. Copy that reads like a failure
 *     invites a retry that would enter twice, and PID §8.6 requires decisions to
 *     be final on submission. Say the entry is recorded and the display is behind.
 */
export const FAILURE_COPY: Record<TxFailureKind, string> = {
  "user-rejected":
    "The signing prompt was closed before anything was signed. Nothing was sent and nothing was charged.",
  "insufficient-sol":
    "This wallet does not hold enough SOL to cover the entry price plus transaction costs.",
  "blockhash-expired":
    "The network window for this transaction lapsed before it confirmed. Nothing settled — you can try again.",
  "program-rejected":
    "The program declined this transaction, so nothing settled. The pool may have filled or closed — check the pool page before trying again.",
  "entries-paused": COPY.tx.entriesPaused,
  "pool-full": COPY.tx.poolFull,
  "deadline-passed": COPY.tx.deadlinePassed,
  "already-entered": COPY.tx.alreadyEntered,
  "pool-closed": COPY.tx.poolClosed,
  "packet-stale": COPY.tx.packetStale,
  "rpc-failure":
    "The network request did not go through. Check your connection and try again.",
  // The transaction LANDED; only the read-back failed. See property 2 above.
  "outcome-unreadable":
    "Your entry is recorded on-chain — the money has moved and your seat is held. Only this screen is behind: the confirmation could not be read back yet. Do not enter again; your entry appears on the pool page once the network catches up.",
  "outcome-mismatch":
    "Your entry is recorded on-chain — the money has moved and your seat is held. What was read back does not yet match this screen, which can happen while the network catches up. Do not enter again; check the pool page for your entry.",
};

/** Marker error for "validity window lapsed while awaiting confirmation". */
export class BlockhashExpiredError extends Error {
  constructor(detail: string) {
    super(detail);
  }
}

export function makeFailure(
  kind: TxFailureKind,
  detail: string,
  broadcast: boolean,
  /**
   * Overrides the default: the kind's fixed answer where it has one, else
   * "safe unless broadcast". The two call sites that must override are in
   * execute.ts — a lapsed blockhash after broadcast (safe: it can never land)
   * and the confirmation timeout (unsafe: it still might).
   */
  retryable?: boolean,
): TxFailure {
  return {
    kind,
    message: FAILURE_COPY[kind],
    detail,
    broadcast,
    retryable: retryable ?? RETRYABLE_BY_KIND[kind] ?? !broadcast,
  };
}

/**
 * Extract an Anchor custom error code from any error shape we may see:
 * structured `{ InstructionError: [n, { Custom: code } ] }` objects (from
 * simulation results and signature statuses) or the runtime's string form
 * "custom program error: 0x1770" (from preflight failure messages).
 */
export function extractCustomProgramError(source: unknown): number | null {
  const fromObject = (value: unknown): number | null => {
    if (typeof value !== "object" || value === null) return null;
    const instructionError = (value as { InstructionError?: unknown })
      .InstructionError;
    if (Array.isArray(instructionError)) {
      const inner = instructionError[1];
      if (typeof inner === "object" && inner !== null) {
        // @solana/kit's RPC parser yields BigInt numbers — accept both.
        const custom = (inner as { Custom?: unknown }).Custom;
        if (typeof custom === "number") return custom;
        if (typeof custom === "bigint") return Number(custom);
      }
    }
    // The seam wraps simulation results as { err, logs } — look inside.
    const nested = (value as { err?: unknown }).err;
    if (nested !== undefined && nested !== null) return fromObject(nested);
    return null;
  };

  const direct = fromObject(source);
  if (direct !== null) return direct;

  const text = errorText(source);
  const hexMatch = /custom program error: 0x([0-9a-fA-F]+)/.exec(text);
  if (hexMatch) return parseInt(hexMatch[1], 16);
  const jsonMatch = /"Custom"\s*:\s*(\d+)/.exec(text);
  if (jsonMatch) return parseInt(jsonMatch[1], 10);
  return null;
}

/** JSON.stringify that survives the BigInts in kit-parsed RPC values. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  } catch {
    return String(value);
  }
}

/** Flatten any thrown value (Error chains, RPC error objects) to one string. */
export function errorText(source: unknown): string {
  if (source instanceof Error) {
    const parts = [source.message];
    // @solana/kit SolanaError carries a context object with server detail.
    const context = (source as { context?: unknown }).context;
    if (context !== undefined) parts.push(safeStringify(context));
    if (source.cause) parts.push(errorText(source.cause));
    return parts.join(" | ");
  }
  if (typeof source === "string") return source;
  return safeStringify(source);
}

const USER_REJECTED_PATTERN =
  /reject|declin|denied|cancell?ed|closed the (modal|prompt)|user exited/i;
const INSUFFICIENT_PATTERN =
  /insufficient (lamports|funds)|InsufficientFundsFor(Fee|Rent)|attempt to debit an account but found no record of a prior credit/i;
const BLOCKHASH_PATTERN = /blockhash ?not ?found|block height exceeded/i;
/*
 * The runtime's own words when `register` tries to create an entry account
 * that already exists — `[b"entry", pool, player]` is one per wallet per
 * pool, so this is exactly "this wallet already entered this pool". It is a
 * system-program failure, not a custom program code, so it has no entry in
 * PROGRAM_ERROR_CODES and must be matched on text.
 */
const ALREADY_IN_USE_PATTERN = /already in use/i;

/**
 * Classify an error thrown while SIGNING (the wallet prompt). Wallet SDKs
 * disagree on rejection shapes, so this matches the common EIP-1193-style
 * code 4001 and the usual message texts; anything else from the wallet is
 * still a pre-broadcast failure, reported as rpc-failure with the raw text.
 */
export function classifySigningError(source: unknown): TxFailure {
  const text = errorText(source);
  const code = (source as { code?: unknown })?.code;
  if (code === 4001 || USER_REJECTED_PATTERN.test(text)) {
    return makeFailure("user-rejected", text, false);
  }
  return makeFailure("rpc-failure", `signing failed: ${text}`, false);
}

/**
 * Classify an error surfaced by the RPC seam — a simulation `err`, a
 * preflight/send rejection, or a confirmation-status `err` object.
 * `broadcast` records whether the transaction had already been sent when
 * the error appeared (drives the "nothing was sent" honesty in the UI).
 */
export function classifyRpcError(source: unknown, broadcast: boolean): TxFailure {
  const text = errorText(source);

  // A recognised program error is the most specific answer available, so it is
  // checked before the runtime's generic text patterns. An UNrecognised custom
  // code deliberately falls through to "rpc-failure" rather than being guessed
  // at — see the module doc.
  // Everything classified here is DEFINITIVE — a simulation error, a preflight
  // rejection, or a status the chain reported as failed — so nothing landed
  // and a fresh attempt is safe unless the kind itself says otherwise
  // (`RETRYABLE_BY_KIND`). `broadcast` still records whether it was sent.
  const definitive = (kind: TxFailureKind): TxFailure =>
    makeFailure(kind, text, broadcast, RETRYABLE_BY_KIND[kind] ?? true);

  const customCode = extractCustomProgramError(source);
  if (customCode !== null) {
    const kind = PROGRAM_ERROR_CODES[customCode];
    if (kind) return definitive(kind);
  }

  if (ALREADY_IN_USE_PATTERN.test(text)) {
    return definitive("already-entered");
  }
  if (source instanceof BlockhashExpiredError || BLOCKHASH_PATTERN.test(text)) {
    return definitive("blockhash-expired");
  }
  if (INSUFFICIENT_PATTERN.test(text)) {
    return definitive("insufficient-sol");
  }
  return definitive("rpc-failure");
}
