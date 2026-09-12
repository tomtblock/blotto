/**
 * The recurring reconciliation (audit 2026-09-11, C-11 / C-21) and the skip
 * that makes it affordable.
 *
 * The finding: the only automatic repair ran once at boot, bounded by the
 * ingest watermark — so the failure it existed to catch, a delivery dropped
 * for slot N while slot N+1 arrived, was the one it could never reach. The
 * unbounded walk that can reach it was a CLI command nothing scheduled.
 *
 * Four properties, each of which the fix would be worthless without:
 *
 *   1. the walk reaches BELOW the watermark and repairs the gap;
 *   2. it fetches only what the ledger is missing, because a full-history
 *      walk every fifteen minutes that re-fetched everything would cost one
 *      `getTransaction` per historical transaction per run — the reason this
 *      was a manual command in the first place;
 *   3. a run still going when the next tick fires is skipped, not raced;
 *   4. a failure alerts and keeps serving, because this repairs the ledger
 *      rather than answering from it.
 */

import { expect } from 'chai';
import { InMemoryEventStore } from '../src/store';
import { makeReconciler } from '../src/reconcile';
import { runBackfill, type BackfillRpc, type SignatureInfo } from '../src/backfill';
import { ALERT, METRIC, type Monitor } from '../src/shared';
import { encodeTestEvent, programDataLine, registerTestEvent } from './event-codec';

const PROGRAM = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const POOL = 'PooL1111111111111111111111111111111111111111';
const CTX = { commitment: 'finalized' as const, program: PROGRAM };

before(() => registerTestEvent());

/**
 * A monitor that keeps what it was told, in order. Implements the whole
 * interface rather than the two methods these tests read: a double that is
 * missing a method fails inside the code under test, which reads as a bug in
 * the code rather than in the double.
 */
interface Recording extends Monitor {
  events: string[];
  alerts: string[];
}
function recording(): Recording {
  const events: string[] = [];
  const alerts: string[] = [];
  return {
    events,
    alerts,
    recordEvent: (name: string) => void events.push(name),
    reportGauge: () => undefined,
    alert: (reason: string) => void alerts.push(reason),
  };
}

/**
 * An RPC over a fixed history, counting what it was actually asked to fetch —
 * which is the measurement property 2 is about.
 */
function historyRpc(history: Array<{ signature: string; slot: number }>): BackfillRpc & {
  fetched: string[];
} {
  const fetched: string[] = [];
  return {
    fetched,
    async getSignatures({ before, limit }): Promise<SignatureInfo[]> {
      // Newest first, as the real one pages.
      const desc = [...history].reverse();
      const from = before ? desc.findIndex((h) => h.signature === before) + 1 : 0;
      return desc.slice(from, from + limit).map((h) => ({
        signature: h.signature,
        slot: h.slot,
        err: null,
      }));
    },
    async getTransaction(signature: string) {
      fetched.push(signature);
      const hit = history.find((h) => h.signature === signature);
      if (!hit) return null;
      return {
        slot: BigInt(hit.slot),
        logs: [programDataLine(encodeTestEvent(POOL, BigInt(hit.slot)))],
      };
    },
  };
}

describe('the reconciliation walk reaches below the watermark (C-11 / C-21)', () => {
  /** Four transactions; the webhook delivered the newest two only. */
  const HISTORY = [
    { signature: 'sigA', slot: 100 },
    { signature: 'sigB', slot: 101 },
    { signature: 'sigC', slot: 102 },
    { signature: 'sigD', slot: 103 },
  ];

  async function ledgerMissingTheOldest(): Promise<InMemoryEventStore> {
    const store = new InMemoryEventStore();
    const rpc = historyRpc(HISTORY.slice(2)); // sigC, sigD only
    await runBackfill(store, recording(), CTX, rpc);
    return store;
  }

  it('repairs a delivery dropped below the ingest watermark', async () => {
    const store = await ledgerMissingTheOldest();
    const before = store.ledger().length;
    expect(await store.lastIngestedSlot()).to.equal(103n, 'the watermark is above the gap');

    const monitor = recording();
    const rpc = historyRpc(HISTORY);
    const out = await makeReconciler({
      store,
      monitor,
      ctx: CTX,
      rpc: () => rpc,
      log: () => undefined,
    }).run();

    expect(out).to.equal('walked');
    expect(store.ledger().length).to.be.greaterThan(before, 'the gap below the watermark is filled');
    expect(monitor.events).to.contain(METRIC.indexer.reconciled);
    expect(monitor.events).to.contain(
      METRIC.indexer.reconciledGap,
      'a repaired gap is its own metric: healthy is zero for ever'
    );
  });

  it('fetches only what the ledger is missing', async () => {
    const store = await ledgerMissingTheOldest();
    const rpc = historyRpc(HISTORY);
    await makeReconciler({
      store,
      monitor: recording(),
      ctx: CTX,
      rpc: () => rpc,
      log: () => undefined,
    }).run();

    expect(rpc.fetched.sort()).to.deep.equal(
      ['sigA', 'sigB'],
      'the two already in the ledger are never fetched'
    );
  });

  it('a healthy ledger costs no transaction fetches at all', async () => {
    const store = new InMemoryEventStore();
    await runBackfill(store, recording(), CTX, historyRpc(HISTORY));

    const monitor = recording();
    const rpc = historyRpc(HISTORY);
    const out = await makeReconciler({
      store,
      monitor,
      ctx: CTX,
      rpc: () => rpc,
      log: () => undefined,
    }).run();

    expect(out).to.equal('walked');
    expect(rpc.fetched).to.deep.equal([], 'nothing missing, nothing fetched');
    expect(monitor.events).to.not.contain(
      METRIC.indexer.reconciledGap,
      'and no gap metric on a healthy feed'
    );
  });

  it('skips a tick while the previous walk is still going, rather than racing it', async () => {
    const store = new InMemoryEventStore();
    let release: (() => void) | null = null;
    const held = new Promise<void>((r) => (release = r));
    const rpc: BackfillRpc = {
      async getSignatures() {
        await held; // the first walk parks here
        return [];
      },
      async getTransaction() {
        return null;
      },
    };
    const lines: string[] = [];
    const tick = makeReconciler({
      store,
      monitor: recording(),
      ctx: CTX,
      rpc: () => rpc,
      log: (l) => lines.push(l),
    });

    const first = tick.run();
    const second = await tick.run();
    expect(second).to.equal('skipped-overlap');
    expect(lines.join(' ')).to.contain('still running');

    release!();
    expect(await first).to.equal('walked');

    // And the guard clears: the next tick runs normally.
    expect(await tick.run()).to.equal('walked');
  });

  it('alerts and keeps serving when the walk throws', async () => {
    const monitor = recording();
    const rpc: BackfillRpc = {
      async getSignatures() {
        throw new Error('RPC refused the connection');
      },
      async getTransaction() {
        return null;
      },
    };
    const out = await makeReconciler({
      store: new InMemoryEventStore(),
      monitor,
      ctx: CTX,
      rpc: () => rpc,
      log: () => undefined,
      error: () => undefined,
    }).run();

    expect(out).to.equal('failed', 'reported, never thrown: the service is still serving');
    expect(monitor.alerts).to.contain(ALERT.indexer.reconcileFailed);
  });
});

describe('skipKnown is off unless asked (the manual command still repairs a partial ingest)', () => {
  it('re-fetches everything by default', async () => {
    const history = [
      { signature: 'sig1', slot: 10 },
      { signature: 'sig2', slot: 11 },
    ];
    const store = new InMemoryEventStore();
    await runBackfill(store, recording(), CTX, historyRpc(history));

    const rpc = historyRpc(history);
    const again = await runBackfill(store, recording(), CTX, rpc);
    expect(rpc.fetched.sort()).to.deep.equal(
      ['sig1', 'sig2'],
      'the default walk re-ingests, which is how a partly-ingested transaction is repaired'
    );
    expect(again.duplicates).to.be.greaterThan(0);
    expect(again.skipped ?? 0).to.equal(0);
  });
});
