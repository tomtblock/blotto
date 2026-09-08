/*
 * Send SOL — the player's own transfer out of their wallet, on the same tx
 * seam that submits an entry (`executeTrade`: blockhash → priority fee →
 * simulate → sign → send → confirm). One code path for both wallet kinds,
 * as everywhere else: the embedded wallet and Phantom differ only in the
 * injected `TxSigner`.
 *
 * This is one of the two exits for a player who signed in socially and was
 * paid into a wallet Privy made for them (the other is key export, which is
 * the provider's and lives behind the auth seam). Until 2026-09-08 neither
 * existed: a winner could see nothing and move nothing.
 *
 * The instruction is the System Program's `Transfer` (index 2), built raw
 * in the style of `entry/register-tx.ts` rather than through a generated
 * client, because the generated client wants a kit `TransactionSigner` and
 * this app's signers sign wire bytes. Layout: u32 LE index, u64 LE lamports.
 */

import { AccountRole, address, type Instruction } from "@solana/kit";
import { executeTrade, type TradeResult } from "./execute";
import type { TxRpc } from "./tx-rpc";
import type { LifecycleLogEntry, TxSigner } from "./types";

export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

/** System Program instruction index for `Transfer`. */
const TRANSFER_INDEX = 2;

/**
 * What a transfer costs beyond the amount, over-estimated on purpose: the
 * base fee (5 000 lamports per signature) plus the dynamic priority fee
 * `executeTrade` attaches, which is bounded by `priority-fee.ts`. 0.0001 SOL
 * covers both with room; the chain itself enforces the exact figure.
 */
export const SEND_FEE_HEADROOM_LAMPORTS = 100_000n;

/** The most a wallet can send and still pay for the transaction. */
export function maxSendableLamports(balanceLamports: bigint): bigint {
  const max = balanceLamports - SEND_FEE_HEADROOM_LAMPORTS;
  return max > 0n ? max : 0n;
}

export type SendCheck =
  | { ok: true; to: string; lamports: bigint }
  | { ok: false; reason: "invalid-address" | "zero" | "too-much" | "self" };

/**
 * Validate a send before anything is built or signed. `address()` from
 * @solana/kit is the base58 + length check; amounts arrive as lamports
 * already (see `solToLamports`), never as floats.
 */
export function checkSend(
  from: string,
  to: string,
  lamports: bigint | null,
  balanceLamports: bigint,
): SendCheck {
  let destination: string;
  try {
    destination = address(to.trim());
  } catch {
    return { ok: false, reason: "invalid-address" };
  }
  if (destination === from) return { ok: false, reason: "self" };
  if (lamports === null || lamports <= 0n) return { ok: false, reason: "zero" };
  if (lamports > maxSendableLamports(balanceLamports)) {
    return { ok: false, reason: "too-much" };
  }
  return { ok: true, to: destination, lamports };
}

/** The System Program `Transfer` instruction, `from` as fee payer and signer. */
export function buildTransferInstruction(
  from: string,
  to: string,
  lamports: bigint,
): Instruction {
  if (lamports <= 0n) throw new Error("transfer amount must be positive");
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, TRANSFER_INDEX, true);
  view.setBigUint64(4, lamports, true);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: address(from), role: AccountRole.WRITABLE_SIGNER },
      { address: address(to), role: AccountRole.WRITABLE },
    ],
    data,
  };
}

export interface SendSolParams {
  rpc: TxRpc;
  signer: TxSigner;
  to: string;
  lamports: bigint;
  onEvent?: (entry: LifecycleLogEntry) => void;
}

/** Build, sign, send and confirm a transfer from `signer` to `to`. */
export function sendSol(p: SendSolParams): Promise<TradeResult> {
  return executeTrade({
    rpc: p.rpc,
    signer: p.signer,
    instruction: buildTransferInstruction(p.signer.address, p.to, p.lamports),
    onEvent: p.onEvent ?? (() => {}),
  });
}
