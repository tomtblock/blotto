/**
 * The cross-language decode + projection suite (roadmap 2.5).
 *
 * The fixture is REAL: `fixtures/lifecycle-logs.json` holds the transaction
 * logs of a full lifecycle (64 entries, flags, reveal, commit, batched
 * payout, escrow release + forfeit) plus a refund-fork pool, executed by the
 * compiled program in LiteSVM (tests/litesvm/tests/dump_events.rs). So this
 * suite checks the TypeScript decoders against bytes Anchor actually
 * emitted — not against a TS-side re-encoding of themselves — and then that
 * the projection derives the expected rows, and that `rederive()` rebuilds
 * an identical snapshot from the ledger alone.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SILENT_MONITOR, decodeEventsFromLogs } from '../src/shared';
import { registerBlottoEventLayouts } from '../../_shared/src/blotto-events';
import { InMemoryEventStore } from '../src/store';
import { ingestTransaction, type IngestContext } from '../src/ingest';

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'lifecycle-logs.json'), 'utf8')
) as { transactions: string[][] };

const CTX: IngestContext = { commitment: 'confirmed', program: 'blotto_cup' };

async function ingestAll(store: InMemoryEventStore): Promise<void> {
  for (let i = 0; i < fixture.transactions.length; i++) {
    await ingestTransaction(store, SILENT_MONITOR, CTX, {
      signature: `SIG${String(i).padStart(4, '0')}`,
      slot: BigInt(i + 1),
      logs: fixture.transactions[i],
    });
  }
}

describe('blotto event decoding against real emitted bytes', () => {
  // NOTE: no clearEventLayouts() here — the registry is process-global and
  // other suites in this run have their own layouts registered.
  before(() => {
    registerBlottoEventLayouts();
  });

  it('decodes every payload in the fixture — no unknown, no undecodable', () => {
    let undecodable = 0;
    const counts = new Map<string, number>();
    let payloads = 0;
    for (const logs of fixture.transactions) {
      payloads += logs.filter((l) => l.startsWith('Program data: ')).length;
      for (const { event } of decodeEventsFromLogs(logs, () => undecodable++)) {
        counts.set(event.event, (counts.get(event.event) ?? 0) + 1);
      }
    }
    expect(undecodable).to.equal(0);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).to.equal(payloads, 'every Program data payload must decode');
    // The lifecycle emits every event type at least once.
    for (const name of [
      'PoolOpened',
      'PoolVrfSeeded',
      'PassCollectionCreated',
      'EntryRegistered',
      'PoolSealed',
      'PoolSecretRevealed',
      'ResultsCommitted',
      'PrizesPaid',
      'EntryFlagged',
      'EscrowReleased',
      'EscrowForfeited',
      'RefundTriggered',
      'Refunded',
    ]) {
      expect(counts.get(name) ?? 0, name).to.be.greaterThan(0);
    }
    expect(counts.get('EntryRegistered')).to.equal(66); // 64 + 2 refund pool
  });

  it('projects the lifecycle into the derived tables', async () => {
    const store = new InMemoryEventStore();
    await ingestAll(store);
    const snap = store.projection.snapshot();

    const pools = Object.values(snap.pools);
    expect(pools.length).to.equal(2);
    const paidPool = pools.find((p) => p.state === 'Paid');
    const closedPool = pools.find((p) => p.state === 'Closed');
    expect(paidPool, 'one pool ends Paid').to.exist;
    expect(closedPool, 'the refund pool ends Closed').to.exist;
    // u64 seat bitmask, decimal string: seats 0..15 settled.
    expect(paidPool!.paid_mask).to.equal('65535');
    expect(paidPool!.entrants).to.equal(64);
    expect(paidPool!.secret).to.equal('2a'.repeat(32)); // the harness secret
    expect(paidPool!.results_root).to.equal('01'.repeat(32));
    // Pool 1's seed was patched directly (no event); pool 2's landed via a
    // real commit_vrf_seed with value 0x4d bytes.
    expect(paidPool!.vrf_seed).to.equal(undefined);
    expect(closedPool!.vrf_seed).to.equal('4d'.repeat(32));

    const entries = Object.values(snap.entries);
    expect(entries.length).to.equal(66);
    const refunded = entries.filter((e) => e.refunded === true);
    expect(refunded.length).to.equal(2);
    expect(entries.filter((e) => e.escrow_settled === 'released').length).to.equal(1);
    expect(entries.filter((e) => e.escrow_settled === 'forfeited').length).to.equal(1);

    // The full-pool entries drained the whole class bag.
    const bag = [0, 0, 0, 0, 0];
    for (const e of entries) {
      if (e.pool === paidPool!.pool) bag[e.class as number]++;
    }
    expect(bag).to.deep.equal([38, 15, 7, 3, 1]);

    // The committed payout list (D3-B): 16 seat-keyed rows summing to the
    // pot, mirrored by the 16 settled payouts.
    const results = Object.values(snap.results);
    expect(results.length).to.equal(16);
    const committedTotal = results.reduce((a, r) => a + BigInt(r.amount as string), 0n);
    expect(committedTotal.toString()).to.equal('5120000000');
    const payouts = Object.values(snap.payouts);
    expect(payouts.length).to.equal(16);
    const total = payouts.reduce((a, p) => a + BigInt(p.amount as string), 0n);
    expect(total.toString()).to.equal('5120000000'); // the whole 0.1-tier pot

    // Profiles (R15): seat 0 (the fixture's rank 1) was flagged then
    // released — its profile still ends with the full band credited (via
    // EscrowReleased).
    const seat0 = payouts.find((p) => p.seat === 0)!;
    const profile = Object.values(snap.profiles).find((p) => p.player === seat0.player)!;
    expect(profile.total_won_lamports).to.equal('1350000000');
    expect(profile.seats_paid).to.equal('1');
    expect(profile.pools_entered).to.equal('1');
  });

  it('rederive rebuilds an identical snapshot from the ledger alone', async () => {
    const store = new InMemoryEventStore();
    await ingestAll(store);
    const live = JSON.parse(JSON.stringify(store.projection.snapshot()));
    const replayed = await store.rederive();
    expect(replayed).to.be.greaterThan(80);
    const rebuilt = JSON.parse(JSON.stringify(store.projection.snapshot()));
    expect(rebuilt).to.deep.equal(live);
  });

  it('re-ingesting every transaction is a no-op (idempotency + projection)', async () => {
    const store = new InMemoryEventStore();
    await ingestAll(store);
    const before = JSON.parse(JSON.stringify(store.projection.snapshot()));
    await ingestAll(store); // all duplicates — projection must not re-apply
    const after = JSON.parse(JSON.stringify(store.projection.snapshot()));
    expect(after).to.deep.equal(before);
  });
});
