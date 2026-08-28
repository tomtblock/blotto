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
  6000: "program-rejected", // PoolNotOpen
  6001: "program-rejected", // VrfSeedAlreadyCommitted
  6002: "program-rejected", // InvalidRandomnessAccount
  6003: "program-rejected", // RandomnessNotResolved
  6004: "program-rejected", // VrfSeedNotCommitted
};

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
): TxFailure {
  return { kind, message: FAILURE_COPY[kind], detail, broadcast };
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
  const customCode = extractCustomProgramError(source);
  if (customCode !== null) {
    const kind = PROGRAM_ERROR_CODES[customCode];
    if (kind) return makeFailure(kind, text, broadcast);
  }

  if (source instanceof BlockhashExpiredError || BLOCKHASH_PATTERN.test(text)) {
    return makeFailure("blockhash-expired", text, broadcast);
  }
  if (INSUFFICIENT_PATTERN.test(text)) {
    return makeFailure("insufficient-sol", text, broadcast);
  }
  return makeFailure("rpc-failure", text, broadcast);
}
