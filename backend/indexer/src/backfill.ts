/**
 * Backfill / reconciler (§4) — the recovery path for dropped webhooks (Helius is at-least-once
 * AND lossy). Walks the program's signatures newest→oldest via read-only RPC and ingests each
 * transaction through the SAME `ingestTransaction` path as the webhook, so a signature seen by
 * both converges on one ledger row with zero double-count.
 *
 * The RPC is abstracted behind `BackfillRpc` so the walk logic is offline-testable with a fake
 * source; the production impl (`Web3BackfillRpc`) is a thin wrapper over a read-only web3.js
 * `Connection` (TM-504: read-only; the service's DB role is write-restricted to indexer tables).
 */
import { Connection, PublicKey, type Finality } from '@solana/web3.js';
import { METRIC, type Monitor } from './shared';
import type { EventStore } from './store';
import { ingestTransaction, type IngestContext, type TxContext } from './ingest';

/** A page entry from `getSignaturesForAddress`. */
export interface SignatureInfo {
  signature: string;
  slot: number;
  /**
   * The transaction's error, or `null`/absent when it succeeded.
   *
   * Carried on the page rather than filtered out by the RPC wrapper — see the QA-C5-001 note on
   * `runBackfill`. Optional so a test fake that only models successful transactions needs no change.
   */
  err?: unknown;
}

/** The read-only RPC surface backfill needs. */
export interface BackfillRpc {
  /** Signatures for the program, newest first, paginated by `before`. */
  getSignatures(opts: {
    before?: string;
    limit: number;
  }): Promise<SignatureInfo[]>;
  /** Logs + slot for a signature, or null if the tx failed / is unavailable. */
  getTransaction(
    signature: string
  ): Promise<{ slot: bigint; logs: readonly string[] } | null>;
}

export interface BackfillOptions {
  /** Stop once a signature's slot is below this floor (the catch-up start slot). */
  minSlot?: bigint;
  /** Stop when this signature is reached (already-ingested boundary). */
  untilSignature?: string;
  /** Page size for getSignaturesForAddress (max 1000 on most RPCs). */
  pageSize?: number;
}

export interface BackfillResult {
  transactions: number;
  decoded: number;
  inserted: number;
  duplicates: number;
}

/**
 * Run the backfill walk. Pages newest→oldest; for each signature, fetches logs and ingests.
 * Stops at `minSlot`, `untilSignature`, or signature exhaustion.
 */
export async function runBackfill(
  store: EventStore,
  monitor: Monitor,
  ctx: IngestContext,
  rpc: BackfillRpc,
  opts: BackfillOptions = {}
): Promise<BackfillResult> {
  const pageSize = opts.pageSize ?? 1000;
  const result: BackfillResult = {
    transactions: 0,
    decoded: 0,
    inserted: 0,
    duplicates: 0,
  };
  let before: string | undefined;

  for (;;) {
    const page = await rpc.getSignatures({ before, limit: pageSize });
    if (page.length === 0) {
      break;
    }
    let reachedBoundary = false;
    for (const info of page) {
      if (opts.untilSignature && info.signature === opts.untilSignature) {
        reachedBoundary = true;
        break;
      }
      if (opts.minSlot !== undefined && BigInt(info.slot) < opts.minSlot) {
        reachedBoundary = true;
        break;
      }
      // Failed transactions committed no events, so there is nothing to ingest — but they DO occupy
      // signature slots, so they must stay on the page for the termination decision below
      // (QA-C5-001). Skipping here rather than in the RPC wrapper also saves a `getTransaction`
      // round-trip per failure, which on a VRF-heavy history is the majority of the page.
      if (info.err !== null && info.err !== undefined) {
        continue;
      }
      const tx = await rpc.getTransaction(info.signature);
      if (!tx) {
        continue; // failed/unavailable tx — its events did not commit
      }
      result.transactions++;
      const txCtx: TxContext = {
        signature: info.signature,
        slot: tx.slot,
        logs: tx.logs,
      };
      const s = await ingestTransaction(store, monitor, ctx, txCtx);
      result.decoded += s.decoded;
      result.inserted += s.inserted;
      result.duplicates += s.duplicates;
    }
    // ── QA-C5-001: terminate on the RAW page length, never a filtered one ────────────────────
    // `getSignaturesForAddress` applies its server-side cap (1000 on most RPCs) BEFORE anything
    // here sees the page. `Web3BackfillRpc.getSignatures` used to filter failed transactions out of
    // the result, so this comparison saw a POST-filter length — and any full window containing even
    // one failure came back "short", ending the walk after a single page. Measured on the QA Phase C
    // bench: 1,159 signatures, 719 of them failed; the first window yielded 438 survivors, and
    // `438 < 1000` ended the walk with 159 signatures never reached. Backfill is the recovery path
    // for dropped webhooks, so the failure was both silent and worst-placed.
    //
    // The page is now unfiltered, so `page.length` is what the RPC actually returned and a short
    // page genuinely means signature exhaustion. `before` likewise advances to the raw last entry:
    // paging from the last SUCCESSFUL signature used to re-fetch every failure that trailed it.
    if (reachedBoundary || page.length < pageSize) {
      break;
    }
    before = page[page.length - 1].signature;
  }

  // Bare counter — the per-run transaction/insert counts are values, not metric dimensions, and
  // are already printed to the CLI log (cardinality hygiene, T3).
  monitor.recordEvent(METRIC.indexer.backfillComplete);
  return result;
}

/** Production `BackfillRpc` over a read-only web3.js `Connection`. */
/**
 * The slice of a web3.js `Connection` this wrapper actually uses.
 *
 * Declared as a narrow structural type, and injectable, for ONE reason: QA-C5-001 lived entirely in
 * `getSignatures` below — the walk was correct given an unfiltered page — and with a hard-wired
 * `new Connection(...)` there was no way to unit-pin the wrapper's contract. A defect with no
 * regression test is a defect that comes back. A real `Connection` satisfies this structurally.
 */
export interface BackfillConnection {
  getSignaturesForAddress(
    address: PublicKey,
    options?: { before?: string; limit?: number },
    commitment?: Finality
  ): Promise<readonly { signature: string; slot: number; err: unknown }[]>;
  getTransaction(
    signature: string,
    options: { commitment?: Finality; maxSupportedTransactionVersion?: number }
  ): Promise<{
    slot: number;
    meta?: { err?: unknown; logMessages?: string[] | null } | null;
  } | null>;
}

export class Web3BackfillRpc implements BackfillRpc {
  private readonly connection: BackfillConnection;
  private readonly programId: PublicKey;
  private readonly commitment: Finality;

  constructor(
    rpcUrl: string,
    programId: string,
    commitment: 'finalized' | 'confirmed',
    /** Injected only by tests (QA-C5-001's regression pin); production builds its own. */
    connection?: BackfillConnection
  ) {
    this.connection = connection ?? new Connection(rpcUrl, commitment);
    this.programId = new PublicKey(programId);
    this.commitment = commitment;
  }

  async getSignatures(opts: { before?: string; limit: number }): Promise<SignatureInfo[]> {
    const infos = await this.connection.getSignaturesForAddress(
      this.programId,
      { before: opts.before, limit: opts.limit },
      this.commitment
    );
    // Deliberately UNFILTERED (QA-C5-001). Failed transactions committed no events and are skipped
    // by the walk, but they occupy signature slots inside the RPC's server-side cap — so removing
    // them here made a full page look short and terminated the walk after one page. The wrapper's
    // job is to fetch a page; deciding what to ingest, and when the walk is done, belongs to
    // `runBackfill`.
    return infos.map((i) => ({ signature: i.signature, slot: i.slot, err: i.err }));
  }

  async getTransaction(
    signature: string
  ): Promise<{ slot: bigint; logs: string[] } | null> {
    const tx = await this.connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: this.commitment,
    });
    if (!tx || tx.meta?.err) {
      return null;
    }
    return {
      slot: BigInt(tx.slot),
      logs: tx.meta?.logMessages ?? [],
    };
  }
}
