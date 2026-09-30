import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyRpcError,
  classifySigningError,
  entryRecorded,
  extractCustomProgramError,
  FAILURE_COPY,
  makeFailure,
  PROGRAM_ERROR_CODES,
  BlockhashExpiredError,
} from "./errors";

/*
 * Every error surface, classified from the realistic shapes wallets and
 * RPC clients actually throw — string preflight messages, structured
 * InstructionError objects, wallet rejection variants. Offline (vitest is
 * fixtures-only): these shapes are transcripts of real devnet/wallet
 * behavior, pinned so a classification regression is caught before it can
 * dress a distinct error up as a generic failure.
 */

describe("extractCustomProgramError", () => {
  it("reads the structured InstructionError shape (status / simulation err)", () => {
    expect(
      extractCustomProgramError({ InstructionError: [2, { Custom: 6000 }] }),
    ).toBe(6000);
    expect(
      extractCustomProgramError({ InstructionError: [1, { Custom: 6004 }] }),
    ).toBe(6004);
  });

  it("reads the preflight string form (hex)", () => {
    expect(
      extractCustomProgramError(
        new Error(
          "Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1770",
        ),
      ),
    ).toBe(6000);
    expect(
      extractCustomProgramError(
        new Error("failed to send transaction: custom program error: 0x1774"),
      ),
    ).toBe(6004);
  });

  it("reads kit-parsed BigInt codes and the seam's { err, logs } wrapper", () => {
    // Regression pinned from the live devnet run: @solana/kit parses RPC
    // numbers as BigInt, and the seam wraps simulation results — both broke
    // the original classifier (everything degraded to rpc-failure).
    expect(
      extractCustomProgramError({
        err: { InstructionError: [2n, { Custom: 6000n }] },
        logs: ["Program log: AnchorError … SlippageExceeded"],
      }),
    ).toBe(6000);
    expect(
      extractCustomProgramError({ InstructionError: [1, { Custom: 6004n }] }),
    ).toBe(6004);
  });

  it("survives BigInt payloads in the detail text (no [object Object])", () => {
    const failure = classifyRpcError(
      { err: { InstructionError: [2n, { Custom: 6001n }] }, logs: [] },
      false,
    );
    expect(failure.kind).toBe("program-rejected");
    expect(failure.detail).not.toContain("[object Object]");
    expect(failure.detail).toContain("6001");
  });

  it("reads a JSON-embedded Custom code from wrapped contexts", () => {
    expect(
      extractCustomProgramError(
        new Error('server responded: {"InstructionError":[2,{"Custom":6000}]}'),
      ),
    ).toBe(6000);
  });

  it("returns null for unrelated errors", () => {
    expect(extractCustomProgramError(new Error("fetch failed"))).toBeNull();
    expect(extractCustomProgramError({ InstructionError: [0, "InvalidArgument"] })).toBeNull();
    expect(extractCustomProgramError(null)).toBeNull();
  });
});

describe("classifySigningError", () => {
  it("maps the wallet rejection message variants to user-rejected", () => {
    for (const message of [
      "User rejected the request.",
      "Signing declined by user",
      "user denied transaction signature",
      "Request cancelled",
      "User exited the flow",
    ]) {
      const failure = classifySigningError(new Error(message));
      expect(failure.kind).toBe("user-rejected");
      expect(failure.broadcast).toBe(false);
    }
  });

  it("maps the EIP-1193-style code 4001 to user-rejected", () => {
    const walletError = Object.assign(new Error("boom"), { code: 4001 });
    expect(classifySigningError(walletError).kind).toBe("user-rejected");
  });

  it("reports unrecognized wallet failures honestly as rpc-failure", () => {
    const failure = classifySigningError(new Error("iframe timeout"));
    expect(failure.kind).toBe("rpc-failure");
    expect(failure.detail).toContain("iframe timeout");
    expect(failure.broadcast).toBe(false);
  });
});

describe("classifyRpcError", () => {
  it("names a pool that left Open (PoolNotOpen, 6000) as pool-closed", () => {
    const failure = classifyRpcError(
      { err: { InstructionError: [2, { Custom: 6000 }] }, logs: [] },
      false,
    );
    expect(failure.kind).toBe("pool-closed");
    expect(failure.message).toContain("no longer taking entries");
  });

  it("names a second entry from the same wallet (the entry account 'already in use') as already-entered", () => {
    // The runtime's own text for `init` on an existing PDA — founder 2026-09-09:
    // this read as "the network request did not go through".
    const failure = classifyRpcError(
      new Error(
        "Transaction simulation failed: Error processing Instruction 1: custom program error: 0x0 — Allocate: account Address { address: 7xK…, base: None } already in use",
      ),
      false,
    );
    expect(failure.kind).toBe("already-entered");
    expect(failure.message).toContain("already entered");
  });

  it("maps a known program error code to program-rejected", () => {
    const failure = classifyRpcError(
      { err: { InstructionError: [2, { Custom: 6001 }] }, logs: [] },
      false,
    );
    expect(failure.kind).toBe("program-rejected");
    // Copy filled per v3 D-UI-3 — no placeholder may survive to a player.
    expect(failure.message).not.toContain("TODO_COPY");
    expect(failure.message.length).toBeGreaterThan(20);
    expect(failure.broadcast).toBe(false);
  });

  it("maps every code in the program map, and falls through for one that is not in it", () => {
    for (const [code, kind] of Object.entries(PROGRAM_ERROR_CODES)) {
      const failure = classifyRpcError({ InstructionError: [1, { Custom: Number(code) }] }, true);
      expect(failure.kind, `code ${code}`).toBe(kind);
      expect(failure.message.length, `code ${code} has copy`).toBeGreaterThan(20);
    }
    // An UNRECOGNISED custom code must NOT be guessed at. This is the property
    // worth pinning: a program error the client does not know about is reported
    // honestly as an unclear answer, never as a specific one that happens to be
    // wrong. The raw code stays in `detail` for debugging.
    const unknown = classifyRpcError({ InstructionError: [1, { Custom: 6999 }] }, true);
    expect(unknown.kind).toBe("rpc-failure");
    expect(unknown.detail).toContain("6999");
    expect(unknown.broadcast).toBe(true);
  });

  it("maps 'Blockhash not found' preflight rejections to blockhash-expired", () => {
    const failure = classifyRpcError(
      new Error("Transaction simulation failed: Blockhash not found"),
      false,
    );
    expect(failure.kind).toBe("blockhash-expired");
  });

  it("maps the seam's own expiry sentinel to blockhash-expired", () => {
    const failure = classifyRpcError(
      new BlockhashExpiredError("validity window lapsed"),
      true,
    );
    expect(failure.kind).toBe("blockhash-expired");
    expect(failure.broadcast).toBe(true);
  });

  it("maps the runtime's insufficient-lamports texts to insufficient-sol", () => {
    for (const text of [
      "Transfer: insufficient lamports 421, need 10000000",
      "Transaction results in an account (0) with insufficient funds for rent",
      "InsufficientFundsForFee",
      "Attempt to debit an account but found no record of a prior credit.",
    ]) {
      expect(classifyRpcError(new Error(text), false).kind).toBe("insufficient-sol");
    }
  });

  it("falls back to the honest catch-all for network noise", () => {
    for (const source of [
      new TypeError("fetch failed"),
      new Error("socket hang up"),
      "HTTP 429 Too Many Requests",
    ]) {
      expect(classifyRpcError(source, false).kind).toBe("rpc-failure");
    }
  });

  it("keeps every copy string distinct (each surface reads differently)", () => {
    const messages = Object.values(FAILURE_COPY);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("the player-reachable refusals", () => {
  it("say what happened, per refusal, instead of guessing", () => {
    const paused = classifyRpcError("custom program error: 0x1775", false); // 6005
    expect(paused.kind).toBe("entries-paused");
    expect(paused.message.toLowerCase()).toContain("paused");
    const full = classifyRpcError({ InstructionError: [1, { Custom: 6010 }] }, false);
    expect(full.kind).toBe("pool-full");
    expect(full.message.toLowerCase()).toContain("filled");
    const late = classifyRpcError({ InstructionError: [1, { Custom: 6011 }] }, false);
    expect(late.kind).toBe("deadline-passed");
    expect(late.message.toLowerCase()).toContain("deadline");
    // Audit O27 (2026-09-11): a wallet approval slower than the packet's
    // 60-second window used to read as "the network request did not go
    // through", with no way to try again.
    const stale = classifyRpcError({ InstructionError: [1, { Custom: 6019 }] }, true);
    expect(stale.kind).toBe("packet-stale");
    expect(stale.message.toLowerCase()).toContain("took longer");
    expect(stale.message.toLowerCase()).toContain("nothing was charged");
    expect(stale.retryable).toBe(true);
  });

  it("sit at the positions error.rs declares them at (Anchor numbers from 6000 in declaration order)", () => {
    // Read the Rust source rather than trusting the comment beside the map:
    // an inserted variant renumbers every later one silently.
    const source = readFileSync(
      fileURLToPath(new URL("../../../programs/blotto_cup/src/error.rs", import.meta.url)),
      "utf8",
    );
    const variants = source
      .split("\n")
      .map((line) => /^\s+([A-Z][A-Za-z0-9]*),\s*$/.exec(line)?.[1])
      .filter((v): v is string => v !== undefined);
    expect(variants.indexOf("Paused")).toBe(6005 - 6000);
    expect(variants.indexOf("PoolFull")).toBe(6010 - 6000);
    expect(variants.indexOf("DeadlinePassed")).toBe(6011 - 6000);
    expect(variants.indexOf("PacketStale")).toBe(6019 - 6000);
  });
});

/*
 * `retryable` (audit O27, 2026-09-11) — whether a fresh attempt can enter
 * twice. The reveal offers "Try again" from this field alone; before it the
 * key was `!broadcast`, which withheld the retry from every transaction the
 * chain had definitively REFUSED after broadcast.
 */
describe("retryable and entryRecorded", () => {
  it("a definitive refusal is retryable whether or not it was broadcast", () => {
    expect(classifySigningError(new Error("User rejected the request.")).retryable).toBe(true);
    // Simulation / preflight (not sent).
    expect(classifyRpcError({ InstructionError: [1, { Custom: 6001 }] }, false).retryable).toBe(true);
    // The chain confirmed the transaction as FAILED: broadcast, yet nothing landed.
    const onChain = classifyRpcError({ InstructionError: [1, { Custom: 6001 }] }, true);
    expect(onChain.broadcast).toBe(true);
    expect(onChain.retryable).toBe(true);
    expect(classifyRpcError({ InstructionError: [1, { Custom: 6019 }] }, true).retryable).toBe(true);
    expect(classifyRpcError(new BlockhashExpiredError("lapsed"), true).retryable).toBe(true);
    expect(classifyRpcError(new TypeError("fetch failed"), false).retryable).toBe(true);
  });

  it("is withheld where the program would refuse again, a seat is held, or the answer is unknown", () => {
    for (const code of [6000, 6005, 6010, 6011]) {
      expect(classifyRpcError({ InstructionError: [1, { Custom: code }] }, false).retryable, `${code}`).toBe(false);
    }
    expect(
      classifyRpcError(new Error("custom program error: 0x0 — Allocate: account already in use"), false).retryable,
    ).toBe(false);
    // The silent-cluster timeout: broadcast, status unknown, it may still land.
    expect(makeFailure("rpc-failure", "no confirmation within 90s", true, false).retryable).toBe(false);
    // Post-confirmation kinds: the entry IS recorded.
    expect(makeFailure("outcome-unreadable", "logs withheld", true).retryable).toBe(false);
    expect(makeFailure("outcome-mismatch", "event disagrees", true).retryable).toBe(false);
  });

  it("makeFailure defaults to the kind's fixed answer, else 'safe unless broadcast'", () => {
    expect(makeFailure("rpc-failure", "build failed", false).retryable).toBe(true);
    expect(makeFailure("rpc-failure", "status unknown", true).retryable).toBe(false);
    expect(makeFailure("blockhash-expired", "lapsed", true, true).retryable).toBe(true);
    expect(makeFailure("pool-full", "full", false).retryable).toBe(false);
  });

  it("entryRecorded names exactly the kinds where the player holds a seat", () => {
    const recorded = ["outcome-unreadable", "outcome-mismatch", "already-entered"];
    for (const kind of Object.keys(FAILURE_COPY) as Array<keyof typeof FAILURE_COPY>) {
      expect(entryRecorded({ kind }), kind).toBe(recorded.includes(kind));
    }
  });
});

describe("build-failed (2026-09-30, the Android shell)", () => {
  it("is the device's failure, not the network's: nothing sent, safe to retry, no seat held", () => {
    const f = makeFailure("build-failed", "pass asset keypair: ED25519_ALGORITHM_UNIMPLEMENTED", false);
    expect(f.message).toBe(
      "Your browser could not prepare the entry. Nothing was sent and nothing was charged. Try again; if it happens again, try a different browser.",
    );
    expect(f.broadcast).toBe(false);
    expect(f.retryable).toBe(true);
    expect(entryRecorded(f)).toBe(false);
    expect(f.message).not.toBe(FAILURE_COPY["rpc-failure"]);
  });
});
