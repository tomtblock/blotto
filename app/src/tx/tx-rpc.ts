/*
 * The narrow RPC surface the tx seam needs, as an interface so the state
 * machine and orchestrator are unit-testable offline (vitest is fixtures-
 * only — the fakes in execute.test.ts implement this). `makeTxRpc` is the
 * one live implementation, over `createSolanaRpc` like lib/chain/rpc.ts —
 * same endpoint rule (NEXT_PUBLIC_SOLANA_RPC_URL, public devnet fallback,
 * never mainnet on previews).
 */

import {
  createSolanaRpc,
  signature as asSignature,
  type Address,
  type Base64EncodedWireTransaction,
  type Blockhash,
} from "@solana/kit";

export interface LatestBlockhash {
  blockhash: string;
  lastValidBlockHeight: bigint;
}

export interface SimulationResult {
  /** Program/runtime error, null when the transaction would succeed. */
  err: unknown;
  logs: readonly string[];
  unitsConsumed: bigint | null;
}

export interface SignatureStatus {
  /** True once the cluster reports "confirmed" or "finalized". */
  confirmed: boolean;
  /** On-chain execution error (the tx landed but failed), null if ok. */
  err: unknown;
}

/** A landed transaction's outcome-bearing surface (10.C Step 5b): the log
 * messages carry the Anchor `emit!` events — the PackOpened parse's input. */
export interface ConfirmedTransaction {
  slot: bigint;
  /** On-chain execution error (null = the tx succeeded). */
  err: unknown;
  /** `meta.logMessages` — may be EMPTY if the RPC node withheld/truncated
   * logs; callers treat a missing event as an honest failure state. */
  logMessages: readonly string[];
}

export interface TxRpc {
  getLatestBlockhash(): Promise<LatestBlockhash>;
  /** Recent per-slot priority fees (micro-lamports) for these accounts. */
  getRecentPrioritizationFees(addresses: Address[]): Promise<bigint[]>;
  /** Simulate a base64 wire transaction WITHOUT signature verification. */
  simulateTransaction(base64Tx: string): Promise<SimulationResult>;
  /** Broadcast (preflight on); resolves to the signature, throws on reject. */
  sendTransaction(base64Tx: string): Promise<string>;
  /** Null until the cluster has seen the signature at all. */
  getSignatureStatus(txSignature: string): Promise<SignatureStatus | null>;
  /** The landed transaction by signature — logs included — or null when the
   * cluster does not (or no longer) serves it. Same explicit-endpoint rule
   * as every other member (never an implicit default cluster). */
  getTransaction(txSignature: string): Promise<ConfirmedTransaction | null>;
  isBlockhashValid(blockhash: string): Promise<boolean>;
  getBalance(walletAddress: Address): Promise<bigint>;
  /** Token balance of an ATA; 0n when the account does not exist yet. */
  getTokenBalance(tokenAccount: Address): Promise<bigint>;
}

export function makeTxRpc(rpcUrl: string): TxRpc {
  const rpc = createSolanaRpc(rpcUrl);
  return {
    async getLatestBlockhash() {
      const { value } = await rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send();
      return {
        blockhash: value.blockhash,
        lastValidBlockHeight: value.lastValidBlockHeight,
      };
    },

    async getRecentPrioritizationFees(addresses) {
      const fees = await rpc.getRecentPrioritizationFees(addresses).send();
      return fees.map((f) => BigInt(f.prioritizationFee));
    },

    async simulateTransaction(base64Tx) {
      const { value } = await rpc
        .simulateTransaction(base64Tx as Base64EncodedWireTransaction, {
          encoding: "base64",
          sigVerify: false,
          commitment: "confirmed",
        })
        .send();
      return {
        err: value.err,
        logs: value.logs ?? [],
        unitsConsumed:
          value.unitsConsumed === undefined ? null : BigInt(value.unitsConsumed),
      };
    },

    async sendTransaction(base64Tx) {
      const sig = await rpc
        .sendTransaction(base64Tx as Base64EncodedWireTransaction, {
          encoding: "base64",
          preflightCommitment: "confirmed",
        })
        .send();
      return sig;
    },

    async getSignatureStatus(txSignature) {
      const { value } = await rpc
        .getSignatureStatuses([asSignature(txSignature)])
        .send();
      const status = value[0];
      if (!status) return null;
      return {
        confirmed:
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized",
        err: status.err,
      };
    },

    async getTransaction(txSignature) {
      const value = await rpc
        .getTransaction(asSignature(txSignature), {
          commitment: "confirmed",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        })
        .send();
      if (!value) return null;
      return {
        slot: BigInt(value.slot),
        err: value.meta?.err ?? null,
        logMessages: value.meta?.logMessages ?? [],
      };
    },

    async isBlockhashValid(blockhash) {
      const { value } = await rpc
        .isBlockhashValid(blockhash as Blockhash, { commitment: "confirmed" })
        .send();
      return value;
    },

    async getBalance(walletAddress) {
      const { value } = await rpc.getBalance(walletAddress).send();
      return BigInt(value);
    },

    async getTokenBalance(tokenAccount) {
      try {
        const { value } = await rpc.getTokenAccountBalance(tokenAccount).send();
        return BigInt(value.amount);
      } catch {
        // ATA not created yet — a zero balance, not an error.
        return 0n;
      }
    },
  };
}
