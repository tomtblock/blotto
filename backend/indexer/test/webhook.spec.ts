/**
 * Webhook handler specs (offline; pure handler, no socket). Authentication is a
 * hard gate; malformed bodies are rejected; redelivery is a no-op via the ledger
 * idempotency key.
 *
 * Carried from the predecessor repository, with its product events replaced by the
 * fixture one in `./event-codec` and its projection assertions dropped. Every
 * property asserted here is about the HANDLER, so all of it survived the change of
 * product.
 */
import { expect } from 'chai';
import { ALERT, SILENT_MONITOR, type Monitor } from '../src/shared';
import { InMemoryEventStore, type EventStore } from '../src/store';
import {
  authorize,
  extractTxContexts,
  handleWebhookPayload,
  type WebhookDeps,
} from '../src/webhook';
import { encodeTestEvent, programDataLine, registerTestEvent } from './event-codec';

const POOL = 'PooL1111111111111111111111111111111111111111';
const PROGRAM = '4pspHqtbdgqKTvSxvKFT2ycEU28u3EWdxjmj3xsTHD3Y';
const SECRET = 'topsecret-shared-key';

before(() => registerTestEvent());

function deps(store: InMemoryEventStore): WebhookDeps {
  return {
    store,
    monitor: SILENT_MONITOR,
    secret: SECRET,
    commitment: 'finalized',
    program: PROGRAM,
  };
}

/** One raw delivery carrying a single fixture event. */
function delivery(signature: string, slot: number): string {
  const raw = encodeTestEvent(POOL, BigInt(slot));
  return JSON.stringify([
    { signature, slot, meta: { logMessages: [programDataLine(raw)] } },
  ]);
}

describe('authorize', () => {
  it('accepts the exact secret, rejects wrong/missing/short', () => {
    expect(authorize(SECRET, SECRET)).to.equal(true);
    expect(authorize('wrong', SECRET)).to.equal(false);
    expect(authorize(undefined, SECRET)).to.equal(false);
    expect(authorize('', SECRET)).to.equal(false);
  });
});

describe('extractTxContexts', () => {
  it('reads signature/slot/logs from the raw delivery shape', () => {
    const ctxs = extractTxContexts([
      { signature: 'sig', slot: 7, meta: { logMessages: ['Program data: AA=='] } },
    ]);
    expect(ctxs).to.have.length(1);
    expect(ctxs[0].signature).to.equal('sig');
    expect(ctxs[0].slot).to.equal(7n);
  });

  it('skips items missing a signature, slot, or logs', () => {
    const ctxs = extractTxContexts([
      { slot: 1, meta: { logMessages: [] } }, // no signature
      { signature: 's', meta: { logMessages: [] } }, // no slot
      { signature: 's', slot: 1 }, // no logs
    ]);
    expect(ctxs).to.have.length(0);
  });
});

describe('handleWebhookPayload', () => {
  it('rejects an unauthenticated delivery with 401 and ingests nothing', async () => {
    const store = new InMemoryEventStore();
    const r = await handleWebhookPayload(deps(store), 'bad-secret', delivery('s', 1));
    expect(r.status).to.equal(401);
    expect(store.ledger()).to.have.length(0);
  });

  it('rejects an unparseable body with 400', async () => {
    const store = new InMemoryEventStore();
    const r = await handleWebhookPayload(deps(store), SECRET, '{not json');
    expect(r.status).to.equal(400);
    expect(store.ledger()).to.have.length(0);
  });

  it('ingests an authenticated delivery (200) and appends to the ledger', async () => {
    const store = new InMemoryEventStore();
    const r = await handleWebhookPayload(deps(store), SECRET, delivery('s1', 10));
    expect(r.status).to.equal(200);
    expect(r.stats.inserted).to.equal(1);
    expect(store.ledger()).to.have.length(1);
  });

  it('treats a redelivery as a no-op (200, duplicate, single row)', async () => {
    const store = new InMemoryEventStore();
    await handleWebhookPayload(deps(store), SECRET, delivery('s2', 11));
    const r = await handleWebhookPayload(deps(store), SECRET, delivery('s2', 11));
    expect(r.status).to.equal(200);
    expect(r.stats.duplicates).to.equal(1);
    expect(r.stats.inserted).to.equal(0);
    expect(store.ledger()).to.have.length(1);
  });

  it('returns 500 and alerts ingestFailed when the store throws (the sender will redeliver)', async () => {
    const inner = new InMemoryEventStore();
    const throwing: EventStore = {
      ingest: () => Promise.reject(new Error('injected store failure')),
      lastIngestedSlot: () => inner.lastIngestedSlot(),
      rederive: () => inner.rederive(),
      close: () => inner.close(),
    };
    const alerts: Array<{ reason: string; detail: Record<string, unknown> }> = [];
    const monitor: Monitor = {
      recordEvent: () => undefined,
      reportGauge: () => undefined,
      alert: (reason, detail) => alerts.push({ reason, detail }),
    };
    const r = await handleWebhookPayload(
      { store: throwing, monitor, secret: SECRET, commitment: 'finalized', program: PROGRAM },
      SECRET,
      delivery('s500', 12)
    );
    expect(r.status).to.equal(500);
    // The failed tx's partial stats are lost by design — `totals` accumulates only on success.
    expect(r.stats).to.deep.equal({ decoded: 0, inserted: 0, duplicates: 0 });
    expect(alerts).to.have.length(1);
    expect(alerts[0].reason).to.equal(ALERT.indexer.ingestFailed);
    expect(alerts[0].detail.signature).to.equal('s500');
    expect(inner.ledger()).to.have.length(0);
  });
});
