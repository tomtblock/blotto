/**
 * Backfill / reconciler (§4) — the recovery path for dropped webhooks (Helius is at-least-once
 * AND lossy). PAGES the program's signatures newest→oldest via read-only RPC (the only direction
 * `getSignaturesForAddress` offers), then INGESTS them oldest→newest through the SAME
 * `ingestTransaction` path as the webhook, so a signature seen by both converges on one ledger row
 * with zero double-count and the rows land in the order the chain executed them (audit F-19).
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
 * Run the backfill walk. Stops at `minSlot`, `untilSignature`, or signature exhaustion.
 *
 * TWO PHASES, AND THE SPLIT IS THE POINT (audit F-19).
 *
 *   1. COLLECT. Page the signatures newest→oldest, because `getSignaturesForAddress` offers no
 *      other direction: `before` walks backwards and there is no `after`. Termination is decided
 *      here and is unchanged (see QA-C5-001 below).
 *   2. INGEST, OLDEST FIRST. Walk the collected signatures in reverse, so every transaction is
 *      appended — and projected — in the order the chain executed it, intra-slot order included
 *      (a page is the RPC's own block ordering, so reversing it is chain order, not a guess).
 *
 * Ingesting in reverse used to be the walk's defining hazard: the projection is order-dependent,
 * so a backwards walk finished by applying each pool's OPENING event on top of its settlement.
 * `backfillAndRederive` repaired that afterwards and still does, for a narrower reason given in
 * its own comment. The ledger rows are the second, quieter reason to ingest forwards: their
 * insertion sequence (`events.seq`, 0018) is what every future replay orders by, so the order the
 * backfill writes them in becomes the order every rebuild replays them in, permanently.
 *
 * Cost of the split: the collected signature list is held in memory for the whole walk. It is one
 * small object per signature and the walk already had to reach the boundary before it could
 * finish, so nothing is fetched that was not fetched before — but on a full-history walk of a
 * very long-lived program this is the line that grows.
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

  // ── Phase 1: collect, newest→oldest ───────────────────────────────────────────────────────
  const collected: SignatureInfo[] = [];
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
      collected.push(info);
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
    // Note that the skip above still cannot affect either decision — it filters what we INGEST,
    // never what the page said.
    if (reachedBoundary || page.length < pageSize) {
      break;
    }
    before = page[page.length - 1].signature;
  }

  // ── Phase 2: ingest, oldest→newest ────────────────────────────────────────────────────────
  for (let i = collected.length - 1; i >= 0; i--) {
    const info = collected[i];
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

  // Bare counter — the per-run transaction/insert counts are values, not metric dimensions, and
  // are already printed to the CLI log (cardinality hygiene, T3).
  monitor.recordEvent(METRIC.indexer.backfillComplete);
  return result;
}

/**
 * The catch-up floor for a boot-time backfill: the ingest watermark, or
 * `undefined` when the ledger is empty.
 *
 * `undefined` deliberately means "no floor" — `runBackfill` then walks the whole
 * history, which is the right thing on a first run against an empty ledger and
 * the wrong thing to make a service's health depend on. That is why `cmdSync`
 * serves BEFORE it calls this (`index.ts`, incident 2026-09-08).
 *
 * `runBackfill` stops at `slot < minSlot`, strictly, so passing the watermark
 * re-walks the watermark slot itself. A slot can hold more than one of our
 * transactions, and only some of them may have been ingested before the process
 * died, so the overlap is load-bearing: an off-by-one the other way would leave
 * a permanent hole that only a full `backfill` run could repair.
 */
export async function catchUpFloor(store: EventStore): Promise<bigint | undefined> {
  return (await store.lastIngestedSlot()) ?? undefined;
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

/**
 * A backfill walk followed by the re-derive the walk's ORDER can still make
 * necessary.
 *
 * HISTORY (audit B-05). The walk used to ingest in the order it paged —
 * newest→oldest — and the projection is order-dependent: `PoolOpened` is a full
 * upsert that resets state, entrants, paid_mask and refunded_count, so replaying
 * a pool's history backwards ended with the pool marked Open and empty, the
 * oldest event applied last overwriting the truth the later ones had already
 * written. On a first boot against an empty ledger `catchUpFloor` returns
 * `undefined`, so that was the WHOLE history: a settled pool read as Open with
 * zero entrants, dropped out of the archive list, and drove a live countdown for
 * a pool that had already paid. This function was the repair.
 *
 * `runBackfill` now ingests oldest-first (audit F-19), which removes that
 * failure — and the repair stays, because it addresses a case the walk's own
 * order cannot: the rows a walk inserts are in chain order RELATIVE TO EACH
 * OTHER, not relative to rows already in the ledger. The unbounded `backfill`
 * command exists precisely to fill a gap BELOW the ingest watermark, and those
 * recovered events are older than rows the live webhook already projected, so
 * they arrive after their own future. A concurrent webhook delivery during a
 * walk lands the same way.
 *
 * The ledger itself is append-only and was always correct — only the derived
 * tables were ever wrong. `rederive` replays them from that ledger in
 * (slot, seq) order, so running it after any insert is both the cheapest repair
 * and the most obviously correct one. Nothing was inserted means nothing was
 * mis-ordered, so the replay is skipped; a walk that only re-reads duplicates is
 * free.
 *
 * This lives here, beside the walk it repairs, rather than inline in the CLI
 * command, so that the pairing is testable without a database.
 */
export async function backfillAndRederive(
  store: EventStore,
  monitor: Monitor,
  ctx: IngestContext,
  rpc: BackfillRpc,
  opts: BackfillOptions = {}
): Promise<BackfillResult & { rederived: number }> {
  const result = await runBackfill(store, monitor, ctx, rpc, opts);
  if (result.inserted === 0) {
    return { ...result, rederived: 0 };
  }
  const rederived = await store.rederive();
  monitor.recordEvent(METRIC.indexer.rederive);
  return { ...result, rederived };
}
