/*
 * executeTrade — the tx seam's orchestrator and the deliverable of 10.B
 * Step 2. One code path from instruction to confirmation for BOTH wallet
 * paths (embedded and external differ only in the injected `TxSigner`):
 *
 *   quote (armed) → submitting: blockhash → priority fee (§5 dynamic-fee
 *   deliverable) → simulate (CU limit + pre-broadcast error surface) →
 *   sign → send → pending: poll signature status, watching the blockhash
 *   validity window → confirmed / failed (classified per errors.ts).
 *
 * Every transition is driven through the pure §5 reducer (lifecycle.ts) and
 * emitted as a timestamped log entry — the dev page renders the log; the
 * real trade UI (Steps 3/4) consumes the same events for its states.
 *
 * Testability seams: `rpc` (TxRpc interface), `now`, `sleep`, and the
 * `holdBeforeSend` hook (dev-only lever that parks a signed transaction so
 * blockhash expiry can be reached deliberately).
 */

import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  address,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { tradeReducer, INITIAL_TRADE_STATE, type TradeState } from "./lifecycle";
import {
  classifyRpcError,
  classifySigningError,
  errorText,
  makeFailure,
} from "./errors";
import {
  cuLimitFromSimulation,
  estimatePriorityFeeMicroLamports,
} from "./priority-fee";
import { writableAccounts } from "./instruction-accounts";
import type { TxRpc } from "./tx-rpc";
import type { LifecycleLogEntry, TxFailure, TxSigner } from "./types";

export interface ExecuteTradeParams {
  rpc: TxRpc;
  signer: TxSigner;
  /** The transaction's single program instruction — or use `instructions`
   * when the program requires companions in the same transaction (the
   * `register` entry rides behind its Ed25519 packet verification). */
  instruction?: Instruction;
  /** Ordered instruction list; wins over `instruction` when present. */
  instructions?: readonly Instruction[];
  /** Receives every lifecycle transition, timestamped. */
  onEvent: (entry: LifecycleLogEntry) => void;
  /** Injectable clock (tests); defaults to Date.now. */
  now?: () => number;
  /** Injectable sleep (tests); defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Dev-only hook: awaited between signing and sending. The spike page uses
   * it to hold a signed transaction past its blockhash validity window
   * (receives the blockhash so it can poll `isBlockhashValid` precisely).
   */
  holdBeforeSend?: (context: { blockhash: string }) => Promise<void>;
  /**
   * Additional LOCAL keypairs whose signatures the transaction requires
   * beyond the wallet's — e.g. pack_open's fresh `nft_asset` signer
   * (`CreateV2` requires the new asset account's signature; 10.C Step 5b).
   *
   * ORDER IS LOAD-BEARING (founder-resolved Gate 1 ruling, 10.C Step 5b):
   * the WALLET signs FIRST, these keypairs partial-sign LOCALLY AFTER, via
   * @solana/kit's `partiallySignTransaction` — which merges signatures by
   * documented contract. This removes the external-wallet signature-
   * PRESERVATION unknown entirely: no wallet is ever handed a transaction
   * already carrying a foreign signature it might drop; each wallet only
   * signs a transaction with an empty extra signature slot (the ecosystem's
   * standard ephemeral-signer mint flow, and the Privy embedded path
   * provably splices via `addSignature` regardless). Reversing the order
   * for symmetry would reintroduce a wallet-specific preservation risk that
   * is invisible on the embedded path — do not.
   */
  localPartialSigners?: readonly CryptoKeyPair[];
  confirmTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface TradeResult {
  outcome: "confirmed" | "failed";
  signature: string | null;
  failure: TxFailure | null;
}

const DEFAULT_CONFIRM_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** Start blockhash-validity checks only after a few quiet polls. */
const BLOCKHASH_CHECK_AFTER_MS = 10_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function executeTrade(p: ExecuteTradeParams): Promise<TradeResult> {
  const instructions =
    p.instructions ?? (p.instruction ? [p.instruction] : []);
  if (instructions.length === 0) {
    throw new Error('executeTrade: no instruction(s) given');
  }
  const now = p.now ?? Date.now;
  const sleep = p.sleep ?? defaultSleep;
  const confirmTimeoutMs = p.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  const pollIntervalMs = p.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let state: TradeState = INITIAL_TRADE_STATE;
  const emit = (
    entry: Omit<LifecycleLogEntry, "at">,
    event: Parameters<typeof tradeReducer>[1],
  ) => {
    state = tradeReducer(state, event);
    p.onEvent({ ...entry, at: now() });
  };

  const fail = (failure: TxFailure): TradeResult => {
    emit(
      {
        phase: "failed",
        failure,
        signature: state.signature ?? undefined,
        detail: `${failure.kind}: ${failure.detail}`,
      },
      { kind: "fail", failure },
    );
    return { outcome: "failed", signature: state.signature, failure };
  };

  emit(
    { phase: "submitting", detail: "fetching blockhash and priority fee" },
    { kind: "submit" },
  );

  // ---- build: blockhash + dynamic priority fee + simulation-sized CU limit
  let base64SignedTx: string;
  let blockhash: string;
  try {
    const [latest, priorityFeeMicroLamports] = await Promise.all([
      p.rpc.getLatestBlockhash(),
      estimatePriorityFeeMicroLamports(
        p.rpc,
        instructions.flatMap((ix) => writableAccounts(ix))
      ),
    ]);
    blockhash = latest.blockhash;

    const messageWithoutCuLimit = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address(p.signer.address), m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: latest.blockhash as Blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          m,
        ),
      (m) =>
        appendTransactionMessageInstructions(
          [
            getSetComputeUnitPriceInstruction({
              microLamports: priorityFeeMicroLamports,
            }),
            ...instructions,
          ],
          m,
        ),
    );

    // Simulate before asking for a signature: sizes the CU limit and
    // surfaces slippage / insufficient-SOL errors before anything is signed.
    const simulation = await p.rpc.simulateTransaction(
      getBase64EncodedWireTransaction(compileTransaction(messageWithoutCuLimit)),
    );
    if (simulation.err !== null) {
      return fail(
        classifyRpcError(
          { err: simulation.err, logs: simulation.logs },
          false,
        ),
      );
    }

    const finalMessage = pipe(messageWithoutCuLimit, (m) =>
      appendTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({
            units: cuLimitFromSimulation(simulation.unitsConsumed),
          }),
        ],
        m,
      ),
    );
    const wireTx = getBase64EncodedWireTransaction(
      compileTransaction(finalMessage),
    );

    // ---- sign (the only step where the two wallet paths differ)
    let signedBytes: Uint8Array;
    try {
      signedBytes = await p.signer.signTransaction(
        new Uint8Array(getBase64Encoder().encode(wireTx)),
      );
    } catch (signingError) {
      return fail(classifySigningError(signingError));
    }
    base64SignedTx = getBase64Decoder().decode(signedBytes);

    // ---- local partial signers, AFTER the wallet (see the param doc for
    // why this order is load-bearing). Decode the wallet-signed wire bytes,
    // merge the local signatures in, and re-serialize — the wallet's
    // signature rides through `partiallySignTransaction` untouched (pinned
    // in execute.test.ts).
    if (p.localPartialSigners && p.localPartialSigners.length > 0) {
      const walletSigned = getTransactionDecoder().decode(signedBytes);
      const fullySigned = await partiallySignTransaction(
        [...p.localPartialSigners],
        walletSigned,
      );
      base64SignedTx = getBase64EncodedWireTransaction(fullySigned);
    }
  } catch (buildError) {
    return fail(
      makeFailure("rpc-failure", `building failed: ${errorText(buildError)}`, false),
    );
  }

  // Dev-only hold hook (blockhash-expiry testing) — after signing, before send.
  if (p.holdBeforeSend) await p.holdBeforeSend({ blockhash });

  // ---- send
  let txSignature: string;
  try {
    txSignature = await p.rpc.sendTransaction(base64SignedTx);
  } catch (sendError) {
    // Preflight rejected it — nothing reached a block.
    return fail(classifyRpcError(sendError, false));
  }
  emit(
    {
      phase: "pending",
      signature: txSignature,
      detail: `broadcast; awaiting confirmation`,
    },
    { kind: "broadcast", signature: txSignature },
  );

  // ---- confirm: poll status, watching the validity window
  const startedAt = now();
  while (now() - startedAt < confirmTimeoutMs) {
    let status;
    try {
      status = await p.rpc.getSignatureStatus(txSignature);
    } catch {
      status = null; // transient status-RPC failure — keep polling
    }
    if (status) {
      if (status.err !== null && status.err !== undefined) {
        return fail(classifyRpcError(status.err, true));
      }
      if (status.confirmed) {
        emit(
          { phase: "confirmed", signature: txSignature, detail: "confirmed" },
          { kind: "confirm" },
        );
        return { outcome: "confirmed", signature: txSignature, failure: null };
      }
    } else if (now() - startedAt > BLOCKHASH_CHECK_AFTER_MS) {
      let valid = true;
      try {
        valid = await p.rpc.isBlockhashValid(blockhash);
      } catch {
        // can't tell — keep polling until the timeout
      }
      if (!valid) {
        // Window lapsed and the cluster never saw the signature.
        return fail(
          makeFailure(
            "blockhash-expired",
            `validity window lapsed before ${txSignature} was seen`,
            true,
          ),
        );
      }
    }
    await sleep(pollIntervalMs);
  }

  return fail(
    makeFailure(
      "rpc-failure",
      `no confirmation within ${confirmTimeoutMs / 1000}s — status unknown, check the explorer link`,
      true,
    ),
  );
}
