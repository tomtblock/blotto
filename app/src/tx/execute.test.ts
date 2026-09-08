import { describe, expect, it } from "vitest";
import { address } from "@solana/kit";
import { executeTrade } from "./execute";
import { AccountRole, type Instruction } from "@solana/kit";
import type { SignatureStatus, SimulationResult, TxRpc } from "./tx-rpc";
import type { LifecycleLogEntry, TradePhase, TxSigner } from "./types";

/*
 * The full seam against a scripted fake TxRpc — every lifecycle state and every
 * error transition, zero network, zero SOL. Only the RPC boundary and the signer
 * are fakes; message compilation is exercised for real.
 *
 * CHANGED IN EXTRACTION: the predecessor built its fixture from that product's
 * own instruction encoder, which was not carried. This product has no instruction
 * builders yet (Phase 1 writes the program; Phase 3 wires the client), so the
 * fixture below is a hand-built instruction with the account roles that matter to
 * this seam — a writable signer and a writable account, which is what the
 * priority-fee estimate is scoped over. Nothing here depends on the instruction
 * MEANING anything, which is exactly why the seam was worth carrying separately
 * from the encoders.
 */

const BUYER = address("8ZrMGvkzMrxdfhZC124nSqyXcRy873rh75dCQKnZ9wQg");
const BLOCKHASH = "Edi7AZ7PxGUeAB3mh4vASj8gZskgKbskZKfKNEkMQRhy";
const SIG =
  "4d3JGPWN9oafqUjv5SU8U3cBvzSwQwcmZnM4HGKr72dY8G5xhcwoG8UKQYGvqNixeYBNd8di8cfSJsfLeYCxxu3Q";

/** A stand-in program. Real base58, no deployed program behind it. */
const FIXTURE_PROGRAM = address("11111111111111111111111111111112");
/** A stand-in writable account, so `writableAccounts` has something to find. */
const FIXTURE_WRITABLE = address("3qYhACdrC4UcSGFz7grHAudwCrKVeaz2N7yeWGy9UHt2");

async function fixtureInstruction(): Promise<Instruction> {
  return {
    programAddress: FIXTURE_PROGRAM,
    accounts: [
      { address: BUYER, role: AccountRole.WRITABLE_SIGNER },
      { address: FIXTURE_WRITABLE, role: AccountRole.WRITABLE },
    ],
    data: new Uint8Array([0, 1, 2, 3]),
  };
}

const okSimulation: SimulationResult = {
  err: null,
  logs: [],
  unitsConsumed: 60_000n,
};

interface FakeRpcScript {
  simulation?: SimulationResult | Error;
  send?: string | Error;
  /** Consumed one per poll; the last value repeats. */
  statuses?: (SignatureStatus | null)[];
  blockhashValid?: boolean;
  blockhashFails?: Error;
}

function fakeRpc(script: FakeRpcScript) {
  const calls = {
    send: 0,
    simulate: 0,
    statusPolls: 0,
    /** Every base64 payload handed to sendTransaction, in order (the
     * two-signer test decodes the last one to inspect its signatures). */
    sent: [] as string[],
  };
  let statusIndex = 0;
  const rpc: TxRpc = {
    async getLatestBlockhash() {
      if (script.blockhashFails) throw script.blockhashFails;
      return { blockhash: BLOCKHASH, lastValidBlockHeight: 100n };
    },
    async getRecentPrioritizationFees() {
      return [0n, 5_000n, 12_000n];
    },
    async simulateTransaction() {
      calls.simulate += 1;
      const result = script.simulation ?? okSimulation;
      if (result instanceof Error) throw result;
      return result;
    },
    async sendTransaction(base64Tx) {
      calls.send += 1;
      calls.sent.push(base64Tx);
      const result = script.send ?? SIG;
      if (result instanceof Error) throw result;
      return result;
    },
    async getSignatureStatus() {
      calls.statusPolls += 1;
      const statuses = script.statuses ?? [{ confirmed: true, err: null }];
      const status = statuses[Math.min(statusIndex, statuses.length - 1)];
      statusIndex += 1;
      return status;
    },
    async isBlockhashValid() {
      return script.blockhashValid ?? true;
    },
    async getTransaction() {
      return null; // outcome extraction is the live source's concern
    },
    async getBalance() {
      return 0n;
    },
    async getAccountData() {
      return null;
    },
    async getTokenBalance() {
      return 0n;
    },
  };
  return { rpc, calls };
}

function fakeSigner(behavior?: { throws?: unknown }) {
  const calls = { sign: 0 };
  const signer: TxSigner = {
    address: BUYER,
    kind: "external",
    label: "Fake Wallet",
    async signTransaction(transaction) {
      calls.sign += 1;
      if (behavior?.throws) throw behavior.throws;
      return transaction; // echo — content is irrelevant to the fake rpc
    },
  };
  return { signer, calls };
}

/** Deterministic clock: advances 1000 ms per sleep, zero real waiting. */
function fakeTime() {
  let t = 1_754_700_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += Math.max(ms, 1000);
    },
  };
}

async function run(
  script: FakeRpcScript,
  signerBehavior?: { throws?: unknown },
  holdBeforeSend?: () => Promise<void>,
) {
  const { rpc, calls } = fakeRpc(script);
  const { signer, calls: signerCalls } = fakeSigner(signerBehavior);
  const events: LifecycleLogEntry[] = [];
  const time = fakeTime();
  const result = await executeTrade({
    rpc,
    signer,
    instruction: await fixtureInstruction(),
    onEvent: (e) => events.push(e),
    now: time.now,
    sleep: time.sleep,
    holdBeforeSend,
    confirmTimeoutMs: 30_000,
    pollIntervalMs: 1_000,
  });
  return { result, events, calls, signerCalls };
}

function phases(events: LifecycleLogEntry[]): TradePhase[] {
  return events.map((e) => e.phase);
}

describe("executeTrade — happy path", () => {
  it("walks submitting → pending → confirmed with a signature", async () => {
    const { result, events, calls, signerCalls } = await run({});
    expect(phases(events)).toEqual(["submitting", "pending", "confirmed"]);
    expect(result).toMatchObject({ outcome: "confirmed", signature: SIG });
    expect(calls.simulate).toBe(1);
    expect(calls.send).toBe(1);
    expect(signerCalls.sign).toBe(1);
  });

  it("timestamps transitions monotonically", async () => {
    const { events } = await run({
      statuses: [null, null, { confirmed: true, err: null }],
    });
    const stamps = events.map((e) => e.at);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    expect(phases(events)).toEqual(["submitting", "pending", "confirmed"]);
  });
});

describe("executeTrade — pre-broadcast failures (nothing sent)", () => {
  it("a simulation program error fails before the wallet is even asked to sign", async () => {
    const { result, events, calls, signerCalls } = await run({
      simulation: {
        err: { InstructionError: [2, { Custom: 6000 }] },
        logs: ["Program log: AnchorError … SlippageExceeded"],
        unitsConsumed: null,
      },
    });
    expect(phases(events)).toEqual(["submitting", "failed"]);
    expect(result.failure).toMatchObject({
      kind: "program-rejected",
      broadcast: false,
    });
    expect(signerCalls.sign).toBe(0);
    expect(calls.send).toBe(0);
  });

  it("simulation insufficient-lamports maps to insufficient-sol", async () => {
    const { result } = await run({
      simulation: {
        err: { InstructionError: [2, "ProgramFailedToComplete"] },
        logs: ["Transfer: insufficient lamports 421, need 10000000"],
        unitsConsumed: null,
      },
    });
    expect(result.failure?.kind).toBe("insufficient-sol");
    expect(result.failure?.broadcast).toBe(false);
  });

  it("wallet rejection maps to user-rejected and never sends", async () => {
    const { result, calls } = await run(
      {},
      { throws: new Error("User rejected the request.") },
    );
    expect(result.failure).toMatchObject({
      kind: "user-rejected",
      broadcast: false,
    });
    expect(calls.send).toBe(0);
  });

  it("a preflight program rejection (0x1774) maps to program-rejected", async () => {
    const { result } = await run({
      send: new Error(
        "Transaction simulation failed: Error processing Instruction 1: custom program error: 0x1774",
      ),
    });
    expect(result.failure).toMatchObject({ kind: "program-rejected", broadcast: false });
  });

  it("a held transaction whose blockhash lapsed is rejected as expired", async () => {
    const { result } = await run(
      { send: new Error("Transaction simulation failed: Blockhash not found") },
      undefined,
      async () => {}, // the dev hold hook ran; send then hits the lapsed window
    );
    expect(result.failure).toMatchObject({
      kind: "blockhash-expired",
      broadcast: false,
    });
  });

  it("an unreachable RPC during build is an honest rpc-failure", async () => {
    const { result, events } = await run({
      blockhashFails: new TypeError("fetch failed"),
    });
    expect(phases(events)).toEqual(["submitting", "failed"]);
    expect(result.failure).toMatchObject({ kind: "rpc-failure", broadcast: false });
  });
});

describe("executeTrade — post-broadcast failures", () => {
  it("an on-chain program failure after broadcast keeps the signature", async () => {
    const { result, events } = await run({
      statuses: [null, { confirmed: false, err: { InstructionError: [2, { Custom: 6000 }] } }],
    });
    expect(phases(events)).toEqual(["submitting", "pending", "failed"]);
    expect(result).toMatchObject({
      outcome: "failed",
      signature: SIG,
      failure: { kind: "program-rejected", broadcast: true },
    });
  });

  it("a lapsed validity window with no sighting is blockhash-expired", async () => {
    const { result } = await run({
      statuses: [null],
      blockhashValid: false,
    });
    expect(result.failure).toMatchObject({
      kind: "blockhash-expired",
      broadcast: true,
    });
  });

  it("a silent cluster past the timeout is an honest rpc-failure", async () => {
    const { result } = await run({
      statuses: [null],
      blockhashValid: true,
    });
    expect(result.failure).toMatchObject({ kind: "rpc-failure", broadcast: true });
    expect(result.failure?.detail).toContain("no confirmation within");
    expect(result.signature).toBe(SIG);
  });
});

describe("executeTrade — local partial signers (two-signer mint, 10.C Step 5b)", () => {
  it("wallet signs FIRST, local keypair partial-signs AFTER — both signatures on the sent tx, wallet's preserved", async () => {
    const { generateKeyPairSigner, getBase64Encoder, getTransactionDecoder } =
      await import("@solana/kit");
    const assetSigner = await generateKeyPairSigner();

    // An instruction that REQUIRES the second signer, so the compiled
    // message allocates two signature slots (fee payer + asset).
    const instruction = {
      programAddress: address("57goj6dMYL9BuaGa18jnnTPH7ecztk5rfxiurc4UPW9r"),
      accounts: [
        { address: BUYER, role: 3 as const }, // WRITABLE_SIGNER
        { address: assetSigner.address, role: 3 as const },
      ],
      data: new Uint8Array([23, 16, 13, 229, 218, 58, 87, 74]),
    };

    // A wallet fake that stamps a RECOGNIZABLE signature into its own slot
    // (fee payer = first slot; wire layout: shortvec count, then 64-byte
    // signatures). Preservation means these exact bytes reach the wire.
    const WALLET_SIG = new Uint8Array(64).fill(0xab);
    const signer: TxSigner = {
      address: BUYER,
      kind: "external",
      label: "stamping fake",
      async signTransaction(transaction) {
        const signed = new Uint8Array(transaction);
        expect(signed[0]).toBe(2); // two signature slots compiled
        signed.set(WALLET_SIG, 1);
        return signed;
      },
    };

    const { rpc, calls } = fakeRpc({});
    const time = fakeTime();
    const result = await executeTrade({
      rpc,
      signer,
      instruction,
      localPartialSigners: [assetSigner.keyPair],
      onEvent: () => {},
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.outcome).toBe("confirmed");
    const sent = getTransactionDecoder().decode(
      new Uint8Array(getBase64Encoder().encode(calls.sent[0])),
    );
    const signatures = sent.signatures as Record<string, Uint8Array | null>;
    // The wallet's stamped signature survived the local partial signing…
    expect([...(signatures[BUYER] ?? [])]).toEqual([...WALLET_SIG]);
    // …and the asset keypair's REAL signature was merged in after it.
    const assetSig = signatures[assetSigner.address];
    expect(assetSig).not.toBeNull();
    expect(assetSig?.length).toBe(64);
    expect(assetSig?.some((b) => b !== 0)).toBe(true);
  });

  it("without local partial signers the sent bytes are exactly the wallet's return (no rebuild)", async () => {
    const { result, calls } = await run({});
    expect(result.outcome).toBe("confirmed");
    expect(calls.sent).toHaveLength(1); // echo-signer path: sent as returned
  });
});

describe("multiple instructions (C9: Ed25519 packet + register in one tx)", () => {
  it("compiles every instruction and scopes the fee estimate over all of them", async () => {
    const SECOND_WRITABLE = address(
      "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
    );
    const feeQueries: string[] = [];
    const rpc: TxRpc = {
      async getLatestBlockhash() {
        return { blockhash: BLOCKHASH, lastValidBlockHeight: 100n };
      },
      async getRecentPrioritizationFees(addresses) {
        feeQueries.push(...addresses.map(String));
        return [1_000n];
      },
      async simulateTransaction() {
        return okSimulation;
      },
      async sendTransaction() {
        return SIG;
      },
      async getSignatureStatus() {
        return { confirmed: true, err: null };
      },
      async getTransaction() {
        return null;
      },
      async isBlockhashValid() {
        return true;
      },
      async getBalance() {
        return 0n;
      },
      async getTokenBalance() {
        return 0n;
      },
      async getAccountData() {
        return null;
      },
    };
    const signer: TxSigner = {
      address: BUYER,
      kind: "external",
      label: "Fake",
      async signTransaction(t) {
        return t;
      },
    };
    const companion: Instruction = {
      programAddress: FIXTURE_PROGRAM,
      accounts: [{ address: SECOND_WRITABLE, role: AccountRole.WRITABLE }],
      data: new Uint8Array([9]),
    };
    const result = await executeTrade({
      rpc,
      signer,
      instructions: [companion, await fixtureInstruction()],
      onEvent: () => {},
      sleep: async () => {},
      confirmTimeoutMs: 5_000,
      pollIntervalMs: 1,
    });
    expect(result.outcome).toBe("confirmed");
    // Writable accounts from BOTH instructions reached the fee estimate.
    expect(feeQueries).toContain(String(SECOND_WRITABLE));
    expect(feeQueries).toContain(String(FIXTURE_WRITABLE));
    expect(feeQueries).toContain(String(BUYER));
  });

  it("refuses an empty instruction set", async () => {
    await expect(
      executeTrade({
        rpc: {} as TxRpc,
        signer: { address: BUYER, kind: "external", label: "x", signTransaction: async (t) => t },
        onEvent: () => {},
      }),
    ).rejects.toThrow(/no instruction/);
  });
});
