/*
 * The player's transfer out: the instruction bytes the System Program
 * expects, the pre-flight checks that keep a send from ever being built
 * wrong, and the fee headroom that keeps "Max" spendable.
 */
import { AccountRole } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  SEND_FEE_HEADROOM_LAMPORTS,
  SYSTEM_PROGRAM,
  buildTransferInstruction,
  checkSend,
  maxSendableLamports,
} from "./send-sol";
import { formatSolShort, solToLamports } from "@/data/format";

const FROM = "9XhwKrXjKwFdYJatxYMZYyfB6nFLbmdFNSuM5JTyy8TP";
const TO = "EaDfwMWwW712L4YgdhBgEqbzzpdVP17e5mvY9LPwjrSD";

describe("buildTransferInstruction", () => {
  it("encodes System Transfer as index 2 (u32 LE) then lamports (u64 LE)", () => {
    const ix = buildTransferInstruction(FROM, TO, 1_500_000_000n);
    expect(ix.programAddress).toBe(SYSTEM_PROGRAM);
    expect(Array.from(ix.data as Uint8Array)).toEqual([
      2, 0, 0, 0, // Transfer
      0x00, 0x2f, 0x68, 0x59, 0, 0, 0, 0, // 1_500_000_000 LE
    ]);
  });

  it("marks the sender as the writable signer and the destination writable", () => {
    const ix = buildTransferInstruction(FROM, TO, 1n);
    expect(ix.accounts).toEqual([
      { address: FROM, role: AccountRole.WRITABLE_SIGNER },
      { address: TO, role: AccountRole.WRITABLE },
    ]);
  });

  it("refuses a non-positive amount before anything is built", () => {
    expect(() => buildTransferInstruction(FROM, TO, 0n)).toThrow();
  });
});

describe("checkSend", () => {
  const balance = 1_000_000_000n; // 1 SOL

  it("accepts a valid address and an amount inside the headroom", () => {
    expect(checkSend(FROM, ` ${TO} `, 500_000_000n, balance)).toEqual({
      ok: true,
      to: TO,
      lamports: 500_000_000n,
    });
  });

  it("rejects an address that is not base58 or the wrong length", () => {
    expect(checkSend(FROM, "not-an-address", 1n, balance)).toEqual({
      ok: false,
      reason: "invalid-address",
    });
    expect(checkSend(FROM, "", 1n, balance).ok).toBe(false);
  });

  it("rejects sending to the same wallet", () => {
    expect(checkSend(FROM, FROM, 1n, balance)).toEqual({ ok: false, reason: "self" });
  });

  it("rejects zero, negative and unparsable amounts", () => {
    expect(checkSend(FROM, TO, 0n, balance)).toEqual({ ok: false, reason: "zero" });
    expect(checkSend(FROM, TO, -5n, balance)).toEqual({ ok: false, reason: "zero" });
    expect(checkSend(FROM, TO, null, balance)).toEqual({ ok: false, reason: "zero" });
  });

  it("rejects an amount the wallet cannot cover after transaction costs", () => {
    const max = maxSendableLamports(balance);
    expect(max).toBe(balance - SEND_FEE_HEADROOM_LAMPORTS);
    expect(checkSend(FROM, TO, max, balance).ok).toBe(true);
    expect(checkSend(FROM, TO, max + 1n, balance)).toEqual({
      ok: false,
      reason: "too-much",
    });
  });

  it("never lets the sendable maximum go negative", () => {
    expect(maxSendableLamports(0n)).toBe(0n);
    expect(maxSendableLamports(SEND_FEE_HEADROOM_LAMPORTS - 1n)).toBe(0n);
  });
});

describe("SOL text ↔ lamports, without floats", () => {
  it("parses whole and fractional SOL exactly", () => {
    expect(solToLamports("0.1")).toBe(100_000_000n);
    expect(solToLamports("2")).toBe(2_000_000_000n);
    expect(solToLamports("1.500000000")).toBe(1_500_000_000n);
    expect(solToLamports(" 0.000000001 ")).toBe(1n);
  });

  it("refuses anything that is not a plain amount", () => {
    for (const bad of ["", ".", "1.", ".5", "-1", "1e3", "1,5", "0.0000000001", "abc"]) {
      expect(solToLamports(bad), bad).toBeNull();
    }
  });

  it("formats a short figure by truncation, never rounding up", () => {
    expect(formatSolShort(1_234_999_999n)).toBe("1.234");
    expect(formatSolShort(0n)).toBe("0.000");
    expect(formatSolShort(999_999_999n, 2)).toBe("0.99");
    expect(formatSolShort(5_000_000_000n, 0)).toBe("5");
  });
});
