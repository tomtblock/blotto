/**
 * Ingest pipeline — the offline suite.
 *
 * Carried from the predecessor repository with its projection assertions removed
 * and its ledger assertions kept. What survives is everything that was about the
 * PIPELINE rather than about that product's events:
 *
 *   - idempotency under redelivery and replay;
 *   - convergence: a signature seen by both the webhook and the backfill walk
 *     yields exactly one ledger row;
 *   - `event_index` stability when a transaction carries events from another
 *     program;
 *   - the backfill's `minSlot` floor;
 *   - the QA-C5-001 regression pins (see the block comment further down) — the
 *     highest-value tests in this file, and the ones most worth carrying;
 *   - re-derive over the ledger alone.
 *
 * The fixture event these tests emit is defined in `./event-codec`. Nothing here
 * depends on what an event MEANS, which is exactly why this coverage outlived the
 * product it was written for.
 */

import { expect } from 'chai';
import { SILENT_MONITOR } from '../src/shared';
import { InMemoryEventStore } from '../src/store';
import { ingestTransaction, type IngestContext, type TxContext } from '../src/ingest';
import { handleWebhookPayload } from '../src/webhook';
import {
  runBackfill,
  Web3BackfillRpc,
  type BackfillConnection,
  type BackfillRpc,
  type SignatureInfo,
} from '../src/backfill';
import {
  encodeTestEvent,
  foreignProgramDataLine,
  programDataLine,
  registerTestEvent,
  TEST_EVENT,
} from './event-codec';

const PROGRAM = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const INGEST: IngestContext = { commitment: 'finalized', program: PROGRAM };
const POOL = 'PooL1111111111111111111111111111111111111111';

before(() => registerTestEvent());

/** One transaction carrying a single fixture event. */
function txCtx(signature: string, slot: bigint, amount = 1_000n): TxContext {
  return {
    signature,
    slot,
    logs: [programDataLine(encodeTestEvent(POOL, amount))],
  };
}

describe('ingestTransaction — the ledger', () => {
  it('appends one row per decoded event, with the decoded body in raw', async () => {
    const store = new InMemoryEventStore();
    const stats = await ingestTransaction(store, SILENT_MONITOR, INGEST, txCtx('sig-a', 7n));

    expect(stats).to.deep.equal({ decoded: 1, inserted: 1, duplicates: 0 });
    const rows = store.ledger();
    expect(rows).to.have.length(1);
    expect(rows[0].signature).to.equal('sig-a');
    expect(rows[0].eventIndex).to.equal(0);
    expect(rows[0].slot).to.equal(7n);
    expect(rows[0].name).to.equal(TEST_EVENT);
    expect(rows[0].commitment).to.equal(INGEST.commitment);
    expect(rows[0].program).to.equal(PROGRAM);
  });

  it('serialises u64 amounts as strings, never as numbers', async () => {
    // The precision gate. A u64 past Number.MAX_SAFE_INTEGER must survive the
    // round-trip into the raw-jsonb column intact; coerced to a float it would
    // come back wrong, and for a prize amount that is a payment bug.
    const store = new InMemoryEventStore();
    const huge = 18_446_744_073_709_551_615n; // u64::MAX
    await ingestTransaction(store, SILENT_MONITOR, INGEST, txCtx('sig-huge', 1n, huge));

    const raw = store.ledger()[0].raw;
    expect(raw.amount).to.equal(huge.toString());
    expect(typeof raw.amount).to.equal('string');
  });

  it('keeps event_index stable across an unrecognised event from another program', async () => {
    // The index is the ordinal of the `Program data` line within the transaction,
    // taken over ALL payloads rather than only recognised ones. If it were taken
    // over recognised payloads only, registering a new decoder in a later phase
    // would RENUMBER events already in the ledger — and the ledger's idempotency
    // key is (signature, event_index).
    const store = new InMemoryEventStore();
    await ingestTransaction(store, SILENT_MONITOR, INGEST, {
      signature: 'sig-mixed',
      slot: 9n,
      logs: [
        foreignProgramDataLine(),
        programDataLine(encodeTestEvent(POOL, 1n)),
      ],
    });

    const rows = store.ledger();
    expect(rows).to.have.length(1);
    expect(rows[0].eventIndex, 'the second payload is index 1, not index 0').to.equal(1);
  });

  it('reports the watermark as the highest slot seen', async () => {
    const store = new InMemoryEventStore();
    expect(await store.lastIngestedSlot()).to.equal(null);
    await ingestTransaction(store, SILENT_MONITOR, INGEST, txCtx('a', 10n));
    await ingestTransaction(store, SILENT_MONITOR, INGEST, txCtx('b', 4n));
    expect(await store.lastIngestedSlot()).to.equal(10n);
  });
});

describe('idempotency (redelivery / replay)', () => {
  it('the same transaction ingested twice yields one row, second is a duplicate', async () => {
    const store = new InMemoryEventStore();
    const ctx = txCtx('sig-dup', 42n);

    const first = await ingestTransaction(store, SILENT_MONITOR, INGEST, ctx);
    const second = await ingestTransaction(store, SILENT_MONITOR, INGEST, ctx);

    expect(first).to.deep.equal({ decoded: 1, inserted: 1, duplicates: 0 });
    expect(second).to.deep.equal({ decoded: 1, inserted: 0, duplicates: 1 });
    expect(store.ledger()).to.have.length(1);
  });
});

describe('backfill ↔ webhook convergence (same signature, both paths → one row)', () => {
  function fakeRpc(
    page: SignatureInfo[],
    txs: Map<string, { slot: bigint; logs: readonly string[] }>
  ): BackfillRpc {
    return {
      async getSignatures({ before }) {
        return before ? [] : page;
      },
      async getTransaction(signature) {
        return txs.get(signature) ?? null;
      },
    };
  }

  it('a signature seen by the webhook and by backfill is stored exactly once', async () => {
    const store = new InMemoryEventStore();
    const ctx = txCtx('sig-converge', 300n);

    // Webhook path (the raw-delivery shape).
    const webhookBody = JSON.stringify([
      { signature: ctx.signature, slot: Number(ctx.slot), meta: { logMessages: ctx.logs } },
    ]);
    const wr = await handleWebhookPayload(
      { store, monitor: SILENT_MONITOR, secret: 'topsecret', commitment: INGEST.commitment, program: PROGRAM },
      'topsecret',
      webhookBody
    );
    expect(wr.status).to.equal(200);
    expect(wr.stats.inserted).to.equal(1);

    // Backfill path over the SAME signature.
    const txs = new Map([[ctx.signature, { slot: ctx.slot, logs: ctx.logs }]]);
    const br = await runBackfill(
      store,
      SILENT_MONITOR,
      INGEST,
      fakeRpc([{ signature: ctx.signature, slot: Number(ctx.slot) }], txs)
    );
    expect(br.transactions).to.equal(1);
    expect(br.inserted).to.equal(0);
    expect(br.duplicates).to.equal(1);

    // Converged: one ledger row.
    expect(store.ledger()).to.have.length(1);
  });

  it('backfill stops at minSlot', async () => {
    const store = new InMemoryEventStore();
    const txs = new Map([
      ['new', { slot: 500n, logs: txCtx('new', 500n).logs }],
      ['old', { slot: 100n, logs: txCtx('old', 100n).logs }],
    ]);
    const page: SignatureInfo[] = [
      { signature: 'new', slot: 500 },
      { signature: 'old', slot: 100 },
    ];
    const r = await runBackfill(
      store,
      SILENT_MONITOR,
      INGEST,
      {
        async getSignatures({ before }) {
          return before ? [] : page;
        },
        async getTransaction(sig) {
          return txs.get(sig) ?? null;
        },
      },
      { minSlot: 200n }
    );
    expect(r.transactions).to.equal(1); // only 'new' (slot 500); 'old' is below the floor
    expect(store.ledger()).to.have.length(1);
  });
});

/**
 * QA-C5-001 regression pin — carried in full from the predecessor repository,
 * because the defect it pins is a property of the backfill walk and has nothing to
 * do with either product's events.
 *
 * The bug: `runBackfill` terminated on `page.length < pageSize`, and
 * `Web3BackfillRpc.getSignatures` filtered failed transactions out of the page —
 * AFTER the RPC had already applied its server-side cap. So any full window
 * containing even one failure came back "short" and the walk stopped after page 1.
 * Measured on the predecessor's own bench: 1,159 signatures, 719 failed, the first
 * window yielded 438 survivors, `438 < 1000` ended the walk, and 159 signatures
 * were never reached.
 *
 * Backfill is the recovery path for dropped webhooks, so the failure was silent
 * and in the worst possible place. In this product the same walk is what
 * reconstructs a pool's entries if a webhook delivery is lost — and a missing
 * `EntryRegistered` is a player who paid and does not appear in the field.
 *
 * These tests fail against the pre-fix code and pass after it. The first is the
 * defect itself; the rest pin the things the fix must not break.
 */
describe('Web3BackfillRpc.getSignatures must NOT filter (QA-C5-001, the defect site)', () => {
  /**
   * The defect lived entirely HERE, not in the walk: the wrapper filtered
   * `err !== null` out of the page after the RPC had applied its cap, so a full
   * window containing even one failure was handed upstream as a "short" page.
   *
   * That is why this test injects a connection rather than testing through the
   * walk: a walk-level test with a non-filtering fake CANNOT reproduce the bug,
   * because such a fake is already the fixed behaviour. If anyone re-adds a
   * `.filter(i => i.err === null)` here, this fails.
   */
  function fakeConnection(page: { signature: string; slot: number; err: unknown }[]) {
    const calls: { before?: string; limit?: number }[] = [];
    return {
      calls,
      conn: {
        async getSignaturesForAddress(
          _address: unknown,
          options?: { before?: string; limit?: number }
        ) {
          calls.push(options ?? {});
          return page;
        },
        async getTransaction() {
          return null;
        },
      } as unknown as BackfillConnection,
    };
  }

  it('returns FAILED signatures on the page, with their err preserved', async () => {
    const page = [
      { signature: 'ok-1', slot: 10, err: null },
      { signature: 'fail-1', slot: 9, err: { InstructionError: [0, 'Custom'] } },
      { signature: 'fail-2', slot: 8, err: { InstructionError: [1, 'Custom'] } },
    ];
    const { conn } = fakeConnection(page);
    const rpc = new Web3BackfillRpc('http://unused', PROGRAM, 'confirmed', conn);

    const got = await rpc.getSignatures({ limit: 3 });

    // The whole defect in one assertion: the page length upstream sees must be
    // what the RPC returned. Pre-fix this was 1.
    expect(got, 'the page must not be filtered').to.have.length(3);
    expect(got.map((g) => g.signature)).to.deep.equal(['ok-1', 'fail-1', 'fail-2']);
    // And `err` must survive, because the walk uses it to decide what to ingest.
    expect(got[0].err, 'a successful entry carries a null err').to.equal(null);
    expect(got[1].err, 'a failed entry carries its error through').to.deep.equal({
      InstructionError: [0, 'Custom'],
    });
  });

  it("passes the caller's before/limit through untouched", async () => {
    const { conn, calls } = fakeConnection([]);
    const rpc = new Web3BackfillRpc('http://unused', PROGRAM, 'confirmed', conn);
    await rpc.getSignatures({ before: 'cursor-sig', limit: 1000 });
    expect(calls).to.deep.equal([{ before: 'cursor-sig', limit: 1000 }]);
  });
});

describe('runBackfill pagination across failed transactions (QA-C5-001)', () => {
  const PAGE = 4; // stands in for the RPC's 1000 cap; the arithmetic is identical

  /** A page source that hands out fixed pages keyed by the `before` cursor. */
  function pagedRpc(
    pages: SignatureInfo[][],
    txs: Map<string, { slot: bigint; logs: readonly string[] }>
  ): { rpc: BackfillRpc; sigRequests: (string | undefined)[]; txRequests: string[] } {
    const sigRequests: (string | undefined)[] = [];
    const txRequests: string[] = [];
    let call = 0;
    const rpc: BackfillRpc = {
      async getSignatures({ before }) {
        sigRequests.push(before);
        return pages[call++] ?? [];
      },
      async getTransaction(signature) {
        txRequests.push(signature);
        return txs.get(signature) ?? null;
      },
    };
    return { rpc, sigRequests, txRequests };
  }

  it('walks PAST a full page that is mostly failed transactions', async () => {
    const store = new InMemoryEventStore();
    // A FULL first page (== pageSize) of which only one succeeded, then a second
    // page carrying the event we must not lose. Pre-fix, the filtered length was
    // 1 < 4 and the walk stopped here.
    const page1: SignatureInfo[] = [
      { signature: 'ok-1', slot: 400, err: null },
      { signature: 'fail-1', slot: 399, err: { InstructionError: [0, 'Custom'] } },
      { signature: 'fail-2', slot: 398, err: { InstructionError: [0, 'Custom'] } },
      { signature: 'fail-3', slot: 397, err: { InstructionError: [0, 'Custom'] } },
    ];
    const page2: SignatureInfo[] = [{ signature: 'ok-2', slot: 396, err: null }];
    const txs = new Map([
      ['ok-1', { slot: 400n, logs: txCtx('ok-1', 400n).logs }],
      ['ok-2', { slot: 396n, logs: txCtx('ok-2', 396n).logs }],
    ]);
    const { rpc, sigRequests, txRequests } = pagedRpc([page1, page2], txs);

    const r = await runBackfill(store, SILENT_MONITOR, INGEST, rpc, { pageSize: PAGE });

    // The claim: the walk reached the SECOND page and ingested the event beyond
    // the failures.
    expect(r.transactions, 'both successful transactions walked').to.equal(2);
    expect(r.inserted, 'the event on page 2 must not be silently dropped').to.equal(2);
    expect(store.ledger()).to.have.length(2);
    // And it paged from the RAW last entry, not the last successful one — paging
    // from 'ok-1' would have re-fetched every failure that trailed it, forever.
    expect(sigRequests, 'cursor advances past the failures').to.deep.equal([undefined, 'fail-3']);
    // Failed transactions are skipped without a getTransaction round-trip.
    expect(txRequests, 'no RPC spent on failed signatures').to.deep.equal(['ok-1', 'ok-2']);
  });

  it('still terminates on a genuinely short page (no infinite walk)', async () => {
    const store = new InMemoryEventStore();
    const page1: SignatureInfo[] = [
      { signature: 'ok-a', slot: 10, err: null },
      { signature: 'fail-a', slot: 9, err: { x: 1 } },
    ];
    const txs = new Map([['ok-a', { slot: 10n, logs: txCtx('ok-a', 10n).logs }]]);
    const { rpc, sigRequests } = pagedRpc([page1, page1, page1], txs);

    const r = await runBackfill(store, SILENT_MONITOR, INGEST, rpc, { pageSize: PAGE });

    expect(r.transactions).to.equal(1);
    // 2 < 4, so exactly ONE page was requested — the short-page exit still fires.
    expect(sigRequests).to.have.length(1);
  });

  it('a page of ONLY failed transactions still advances rather than stopping', async () => {
    const store = new InMemoryEventStore();
    // The pathological shape: a full page with zero survivors. Pre-fix the
    // filtered length was 0, which hit the `page.length === 0` guard and ended the
    // walk as if history were exhausted.
    const allFailed: SignatureInfo[] = Array.from({ length: PAGE }, (_, i) => ({
      signature: `fail-${i}`,
      slot: 500 - i,
      err: { InstructionError: [0, 'Custom'] },
    }));
    const page2: SignatureInfo[] = [{ signature: 'ok-deep', slot: 400, err: null }];
    const txs = new Map([['ok-deep', { slot: 400n, logs: txCtx('ok-deep', 400n).logs }]]);
    const { rpc } = pagedRpc([allFailed, page2], txs);

    const r = await runBackfill(store, SILENT_MONITOR, INGEST, rpc, { pageSize: PAGE });

    expect(r.transactions, 'the walk must cross a fully-failed page').to.equal(1);
    expect(r.inserted).to.equal(1);
  });
});

describe('re-derive replays the ledger alone', () => {
  it('replays every row, in (slot, signature, event_index) order', async () => {
    const store = new InMemoryEventStore();
    await ingestTransaction(store, SILENT_MONITOR, INGEST, txCtx('c', 3n));
    await ingestTransaction(store, SILENT_MONITOR, INGEST, txCtx('a', 1n));
    await ingestTransaction(store, SILENT_MONITOR, INGEST, txCtx('b', 2n));

    const replayed = await store.rederive();
    expect(replayed).to.equal(3);
    // The ledger is untouched by a re-derive — it is the source, not a product of
    // one. TODO(phase-2): assert the derived tables come back identical once they
    // exist; that comparison is what actually proves re-derivability.
    expect(store.ledger()).to.have.length(3);
  });
});
