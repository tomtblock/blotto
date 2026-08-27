import { describe, expect, it } from "vitest";
import {
  classifyRpcError,
  classifySigningError,
  extractCustomProgramError,
  FAILURE_COPY,
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
      { err: { InstructionError: [2n, { Custom: 6000n }] }, logs: [] },
      false,
    );
    expect(failure.kind).toBe("program-rejected");
    expect(failure.detail).not.toContain("[object Object]");
    expect(failure.detail).toContain("6000");
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
  it("maps a known program error code to program-rejected", () => {
    const failure = classifyRpcError(
      { err: { InstructionError: [2, { Custom: 6000 }] }, logs: [] },
      false,
    );
    expect(failure.kind).toBe("program-rejected");
    // Copy is a TODO_COPY placeholder until the Phase 3 language audit fills it
    // (PID §10, C12). Asserting the placeholder — rather than deleting the
    // assertion — means the audit cannot quietly skip this string.
    expect(failure.message).toMatch(/^TODO_COPY\(/);
    expect(failure.broadcast).toBe(false);
  });

  it("maps every code in the program map, and falls through for one that is not in it", () => {
    for (const code of Object.keys(PROGRAM_ERROR_CODES).map(Number)) {
      const failure = classifyRpcError({ InstructionError: [1, { Custom: code }] }, true);
      expect(failure.kind, `code ${code}`).toBe("program-rejected");
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
