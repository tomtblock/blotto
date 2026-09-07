/**
 * The cross-language decode + projection suite (roadmap 2.5).
 *
 * The fixture is REAL: `fixtures/lifecycle-logs.json` holds the transaction
 * logs of a full lifecycle (64 entries, flags, reveal, a two-way tie for
 * first committed, payout, escrow release + forfeit), a refund-fork pool,
 * and a minimum-field pool (52 entries start the go-timer, the deadline
 * passes, `seal_at_deadline` seals, the winner takes the pot — D-E4),
 * executed by the compiled program in LiteSVM
 * (tests/litesvm/tests/dump_events.rs). So this suite checks the TypeScript
 * decoders against bytes Anchor actually emitted — not against a TS-side
 * re-encoding of themselves — and then that the projection derives the
 * expected rows, and that `rederive()` rebuilds an identical snapshot from
 * the ledger alone.
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

/** Tier 0's pot (D-E1); every pool in the fixture is tier 0. */
const POT = '4000000000';

type Row = Record<string, unknown>;

/** Sum the `amount` column of the rows belonging to one pool, as a decimal string. */
function sumFor(rows: Row[], pool: unknown): string {
  return rows
    .filter((r) => r.pool === pool)
    .reduce((a, r) => a + BigInt(r.amount as string), 0n)
    .toString();
}

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
      'GoTimerStarted',
      'TiersOpened',
    ]) {
      expect(counts.get(name) ?? 0, name).to.be.greaterThan(0);
    }
    expect(counts.get('EntryRegistered')).to.equal(118); // 64 + 2 refund pool + 52 min-field pool
    // The go-timer starts once per pool that reaches 52 seats: the full pool
    // on its way to 64 and the minimum-field pool. It never fires for the
    // two-entry refund pool.
    expect(counts.get('GoTimerStarted')).to.equal(2);
    // Two seals: the 64th-seat seal (inside `register`) and the deadline seal.
    expect(counts.get('PoolSealed')).to.equal(2);
  });

  it('projects the lifecycle into the derived tables', async () => {
    const store = new InMemoryEventStore();
    await ingestAll(store);
    const snap = store.projection.snapshot();

    const pools = Object.values(snap.pools);
    expect(pools.length).to.equal(3);
    const fullPool = pools.find((p) => p.state === 'Paid' && p.entrants === 64);
    const minFieldPool = pools.find((p) => p.state === 'Paid' && p.entrants === 52);
    const closedPool = pools.find((p) => p.state === 'Closed');
    expect(fullPool, 'the 64-seat pool ends Paid').to.exist;
    expect(minFieldPool, 'the 52-seat pool ends Paid').to.exist;
    expect(closedPool, 'the refund pool ends Closed').to.exist;
    // u64 seat bitmask, decimal string. The full pool's fixture committed a
    // two-way tie for first (seats 0 and 1 — bits 0..1); the minimum-field
    // pool paid its single winner (bit 0). Winner-takes-all, D-E2.
    expect(fullPool!.paid_mask).to.equal('3');
    expect(minFieldPool!.paid_mask).to.equal('1');
    for (const p of [fullPool!, minFieldPool!]) {
      expect(p.pot_lamports).to.equal(POT);
      expect(p.secret).to.equal('2a'.repeat(32)); // the harness secret
      expect(p.results_root).to.equal('01'.repeat(32));
    }
    // D-E4: both pools that passed 52 seats carry the go-deadline, and the
    // effective deadline was shortened to it in place; the two-entry refund
    // pool never started a timer.
    for (const p of [fullPool!, minFieldPool!]) {
      expect(p.go_deadline, 'go_deadline set').to.be.a('string');
      expect(p.fill_deadline).to.equal(p.go_deadline);
    }
    expect(closedPool!.go_deadline).to.equal(undefined);
    // Pools 1 and 3 had their seeds patched directly (no event); pool 2's
    // landed via a real commit_vrf_seed with value 0x4d bytes.
    expect(fullPool!.vrf_seed).to.equal(undefined);
    expect(minFieldPool!.vrf_seed).to.equal(undefined);
    expect(closedPool!.vrf_seed).to.equal('4d'.repeat(32));

    const entries = Object.values(snap.entries);
    expect(entries.length).to.equal(118);
    const refunded = entries.filter((e) => e.refunded === true);
    expect(refunded.length).to.equal(2);
    expect(entries.filter((e) => e.escrow_settled === 'released').length).to.equal(1);
    expect(entries.filter((e) => e.escrow_settled === 'forfeited').length).to.equal(1);

    // The full-pool entries drained the whole class bag; the 52-seat pool
    // drew 52 of the 64 counters and its bag is a strict sub-multiset.
    const bagOf = (pool: unknown): number[] => {
      const bag = [0, 0, 0, 0, 0];
      for (const e of entries) {
        if (e.pool === pool) bag[e.class as number]++;
      }
      return bag;
    };
    expect(bagOf(fullPool!.pool)).to.deep.equal([38, 15, 7, 3, 1]);
    const minBag = bagOf(minFieldPool!.pool);
    expect(minBag.reduce((a, b) => a + b, 0)).to.equal(52);
    minBag.forEach((n, i) => expect(n, `class ${i}`).to.be.at.most([38, 15, 7, 3, 1][i]));

    // The committed payout lists (D3-B under D-E2): the full pool's tie
    // splits the pot exactly two ways; the minimum-field pool's single row
    // IS the pot. Each list is mirrored by its settled payouts.
    const results = Object.values(snap.results);
    expect(results.length).to.equal(3);
    const payouts = Object.values(snap.payouts);
    expect(payouts.length).to.equal(3);
    for (const p of [fullPool!, minFieldPool!]) {
      expect(sumFor(results, p.pool), 'committed list conserves the pot').to.equal(POT);
      expect(sumFor(payouts, p.pool), 'settled payouts conserve the pot').to.equal(POT);
    }
    const tie = payouts.filter((p) => p.pool === fullPool!.pool).map((p) => p.amount);
    expect(tie).to.deep.equal(['2000000000', '2000000000']);
    const solo = payouts.filter((p) => p.pool === minFieldPool!.pool);
    expect(solo.length).to.equal(1);
    expect(solo[0].seat).to.equal(0);
    expect(solo[0].amount).to.equal(POT);

    // Profiles (R15): in the full pool both tied seats were flagged and
    // escrowed; seat 0's escrow was released (its share credited via
    // EscrowReleased) and seat 1's forfeited (nothing credited). The
    // minimum-field winner was paid directly and holds the whole pot.
    const fullSeat0 = payouts.find((p) => p.pool === fullPool!.pool && p.seat === 0)!;
    const fullSeat1 = payouts.find((p) => p.pool === fullPool!.pool && p.seat === 1)!;
    const profileOf = (player: unknown): Row =>
      Object.values(snap.profiles).find((p) => p.player === player)!;
    expect(profileOf(fullSeat0.player).total_won_lamports).to.equal('2000000000');
    expect(profileOf(fullSeat0.player).seats_paid).to.equal('1');
    expect(profileOf(fullSeat0.player).pools_entered).to.equal('1');
    expect(profileOf(fullSeat1.player).total_won_lamports).to.equal(undefined);
    expect(profileOf(solo[0].player).total_won_lamports).to.equal(POT);
    expect(profileOf(solo[0].player).seats_paid).to.equal('1');

    // Player history (D-A2 v2): one row per entry across all three pools,
    // each carrying tier, pot, and the running entry count; exactly the
    // three committed seats are marked paid, with the pool's fixed pot
    // attached.
    const history = Object.values(snap.player_history);
    expect(history.length).to.equal(118);
    for (const h of history) {
      expect(h.entries_to_date, `entries_to_date for ${h.player}`).to.equal('1');
      expect(h.tier).to.equal(0);
      expect(h.pot_lamports).to.equal(POT);
    }
    const paidRows = history.filter((h) => h.paid === true);
    expect(paidRows.length).to.equal(3);
    const paidAmounts = paidRows.map((h) => ({ pool: h.pool, amount: h.amount_lamports }));
    expect(sumFor(paidAmounts, fullPool!.pool)).to.equal(POT);
    expect(sumFor(paidAmounts, minFieldPool!.pool)).to.equal(POT);
    // The history row's seat agrees with the payout's seat for each winner.
    const h0 = history.find((h) => h.player === fullSeat0.player && h.pool === fullSeat0.pool)!;
    expect(h0.seat).to.equal(0);
    expect(h0.paid).to.equal(true);
    const h3 = history.find((h) => h.player === solo[0].player && h.pool === solo[0].pool)!;
    expect(h3.seat).to.equal(0);
    expect(h3.paid).to.equal(true);
  });

  it('rederive rebuilds an identical snapshot from the ledger alone', async () => {
    const store = new InMemoryEventStore();
    await ingestAll(store);
    const live = JSON.parse(JSON.stringify(store.projection.snapshot()));
    const replayed = await store.rederive();
    expect(replayed).to.be.greaterThan(140); // 151 rows in the current fixture
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
