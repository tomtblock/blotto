/**
 * The cross-language decode + projection suite (roadmap 2.5).
 *
 * The fixture is REAL: `fixtures/lifecycle-logs.json` holds the transaction
 * logs of a full lifecycle (64 entries, flags, reveal, a two-way tie for
 * first committed, payout, an escrow release, an admin forfeit and the
 * forfeited share paid to the cleared tied player — 2026-09-07), the admin
 * events of the upgrade (keeper, timings, a real Config migration), a
 * refund-fork pool, and a minimum-field pool (52 entries, the 12 h deadline
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
import {
  backfillAndRederive,
  runBackfill,
  type BackfillRpc,
  type SignatureInfo,
} from '../src/backfill';

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

/** `SIG0000`-style name for the fixture's i-th transaction. */
function sigFor(i: number): string {
  return `SIG${String(i).padStart(4, '0')}`;
}

/**
 * The fixture served the way an RPC serves it: NEWEST FIRST, one page.
 *
 * `getSignaturesForAddress` pages newest→oldest, so a backfill walk sees the
 * whole history in reverse. That ordering is the entire point of the suite
 * below — the fake does nothing else clever.
 */
function reverseOrderRpc(): BackfillRpc {
  const page: SignatureInfo[] = fixture.transactions
    .map((_, i) => ({ signature: sigFor(i), slot: i + 1, err: null }))
    .reverse();
  return {
    async getSignatures({ before }) {
      return before ? [] : page;
    },
    async getTransaction(signature) {
      const i = Number(signature.slice(3));
      const logs = fixture.transactions[i];
      return logs ? { slot: BigInt(i + 1), logs } : null;
    },
  };
}

/** Ingest fixture transactions `[from, toExclusive)` live, one per slot, in order. */
async function ingestRange(
  store: InMemoryEventStore,
  from: number,
  toExclusive: number
): Promise<void> {
  for (let i = from; i < toExclusive; i++) {
    await ingestTransaction(store, SILENT_MONITOR, CTX, {
      signature: sigFor(i),
      slot: BigInt(i + 1),
      logs: fixture.transactions[i],
    });
  }
}

async function ingestAll(store: InMemoryEventStore): Promise<void> {
  await ingestRange(store, 0, fixture.transactions.length);
}

/**
 * The fixture's last four transactions: the minimum-field pool's seal, secret
 * reveal, results commit, and its tier-slot release + payout. Used by the
 * gap-below-the-watermark test, which ingests only these live and then walks
 * the whole history — the shape of an unbounded `backfill` run repairing a
 * long dropped-delivery gap. The test asserts what this slice produced before
 * it depends on it, so a regenerated fixture fails loudly rather than quietly
 * testing nothing.
 */
const LAST_POOL_SETTLEMENT = fixture.transactions.length - 4;

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
      'TiersOpened',
      'TierSlotFreed',
      'NextPlacePaid',
      'KeeperSet',
      'PoolTimingSet',
      'ConfigMigrated',
    ]) {
      expect(counts.get(name) ?? 0, name).to.be.greaterThan(0);
    }
    expect(counts.get('EntryRegistered')).to.equal(118); // 64 + 2 refund pool + 52 min-field pool
    // Every tier-slot release stamps a cooldown: pool 1 Paid, pool 2 Closed,
    // pool 3 Paid.
    expect(counts.get('TierSlotFreed')).to.equal(3);
    // One forfeited share, one eligible tied player: a group of one.
    expect(counts.get('NextPlacePaid')).to.equal(1);
    // The go-timer never existed on any deployment; its event is gone.
    expect(counts.get('GoTimerStarted') ?? 0).to.equal(0);
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
    }
    // The full pool committed a REAL results root (its forfeited share is
    // paid onward against it); the minimum-field pool's is the harness pin.
    expect(fullPool!.results_root).to.match(/^[0-9a-f]{64}$/);
    expect(fullPool!.results_root).to.not.equal('01'.repeat(32));
    expect(minFieldPool!.results_root).to.equal('01'.repeat(32));
    // Option A (2026-09-07): no pool carries a go-deadline — the deadline
    // set at open is the only clock.
    for (const p of pools) expect(p.go_deadline).to.equal(undefined);
    // Prompt v2 §B.6: the tier's cooldown stamp, from the LAST slot release
    // (pool 3, Paid), with the pool that freed it.
    const tierStatus = Object.values(snap.tier_status);
    expect(tierStatus.length).to.equal(1);
    expect(tierStatus[0].tier).to.equal(0);
    expect(tierStatus[0].next_open_at).to.be.a('string');
    expect(BigInt(tierStatus[0].next_open_at as string) > 0n).to.equal(true);
    expect(tierStatus[0].last_pool_id).to.equal(String(minFieldPool!.id));
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
    // EscrowReleased) and seat 1's forfeited — then paid to seat 0, the
    // one eligible tied player (NextPlacePaid), so seat 0 holds the whole
    // pot and seat 1 no longer counts a paid seat. The minimum-field winner
    // was paid directly and holds the whole pot.
    const fullSeat0 = payouts.find((p) => p.pool === fullPool!.pool && p.seat === 0)!;
    const fullSeat1 = payouts.find((p) => p.pool === fullPool!.pool && p.seat === 1)!;
    const profileOf = (player: unknown): Row =>
      Object.values(snap.profiles).find((p) => p.player === player)!;
    expect(profileOf(fullSeat0.player).total_won_lamports).to.equal(POT);
    expect(profileOf(fullSeat0.player).seats_paid).to.equal('1');
    expect(profileOf(fullSeat0.player).pools_entered).to.equal('1');
    expect(profileOf(fullSeat1.player).total_won_lamports).to.equal(undefined);
    expect(profileOf(fullSeat1.player).seats_paid).to.equal('0');
    expect(profileOf(solo[0].player).total_won_lamports).to.equal(POT);
    expect(profileOf(solo[0].player).seats_paid).to.equal('1');
    const seat0Entry = entries.find((e) => e.pool === fullPool!.pool && e.player === fullSeat0.player)!;
    expect(seat0Entry.next_place_lamports).to.equal('2000000000');

    // Player history (D-A2 v2): one row per entry across all three pools,
    // each carrying tier, pot, and the running entry count. Two rows are
    // marked paid — seat 0 of the full pool (its own share plus the
    // forfeited one) and the minimum-field winner; the forfeited seat is
    // unmarked with amount 0 — and each pool's rows still sum to the pot.
    const history = Object.values(snap.player_history);
    expect(history.length).to.equal(118);
    for (const h of history) {
      expect(h.entries_to_date, `entries_to_date for ${h.player}`).to.equal('1');
      expect(h.tier).to.equal(0);
      expect(h.pot_lamports).to.equal(POT);
    }
    const paidRows = history.filter((h) => h.paid === true);
    expect(paidRows.length).to.equal(2);
    const forfeitedRow = history.find((h) => h.pool === fullPool!.pool && h.player === fullSeat1.player)!;
    expect(forfeitedRow.paid).to.equal(false);
    expect(forfeitedRow.amount_lamports).to.equal('0');
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

/**
 * The backfill walk against the real history, served the way an RPC serves it.
 *
 * HISTORY (audit B-05). The walk used to INGEST in the order it paged —
 * newest→oldest — and the projection is order-dependent: `PoolOpened` is a
 * full upsert that resets state, entrants, paid_mask and refunded_count. So a
 * backwards walk finished by applying each pool's OPENING event on top of its
 * settlement, and every derived pool row ended Open with zero entrants. On a
 * first boot against an empty ledger there is no floor, so that was the whole
 * history: every settled pool in the archive read as live.
 *
 * The walk now pages newest→oldest but ingests oldest→newest (audit F-19), so
 * the raw walk produces correct rows AND appends them in chain order — which
 * matters twice over, because the ledger's insertion sequence is what every
 * future replay orders by.
 *
 * `backfillAndRederive` stays, for the case the walk's own order cannot fix:
 * rows inserted BELOW the watermark are older than rows the live webhook
 * already projected, so they arrive after their own future. The four tests
 * below are a set — the first pins the new ingest order, the second shows the
 * residual hazard is real (without it the third could pass against a
 * projection that was never order-dependent), the third shows the repair works
 * and the fourth that it is skipped when it cannot be needed.
 */
describe('backfill pages newest-first and ingests oldest-first (audit B-05, F-19)', () => {
  before(() => {
    registerBlottoEventLayouts();
  });

  it('the raw walk appends in chain order and needs no repair', async () => {
    const store = new InMemoryEventStore();
    const r = await runBackfill(store, SILENT_MONITOR, CTX, reverseOrderRpc());
    expect(r.transactions).to.equal(fixture.transactions.length);
    expect(r.inserted).to.be.greaterThan(0);

    // The property everything else rests on: rows were APPENDED oldest-first,
    // whatever order the pages arrived in. Their insertion sequence is what a
    // replay orders by (0018_events_seq.sql), so a walk that appends backwards
    // does not merely mis-project once — it writes the wrong replay order into
    // the ledger permanently.
    const slots = store.ledger().map((rec) => rec.slot);
    expect(slots.length).to.be.greaterThan(140);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i] >= slots[i - 1], `ledger row ${i} went backwards in slot`).to.equal(true);
    }

    // And the derived rows are already right, with no replay: identical to the
    // same events delivered live, oldest-first, by the webhook.
    const forwards = new InMemoryEventStore();
    await ingestAll(forwards);
    expect(JSON.parse(JSON.stringify(store.projection.snapshot()))).to.deep.equal(
      JSON.parse(JSON.stringify(forwards.projection.snapshot()))
    );
    const pools = Object.values(store.projection.snapshot().pools);
    expect(pools.filter((p) => p.state === 'Paid').length).to.equal(2);
    expect(pools.filter((p) => p.state === 'Closed').length).to.equal(1);
    expect(pools.find((p) => p.entrants === 64)!.state).to.equal('Paid');
  });

  it('a walk that fills a gap BELOW already-projected rows still corrupts them', async () => {
    // The unbounded `backfill` command's reason to exist: the ledger holds the
    // newest transactions and is missing older ones. Here the minimum-field
    // pool's settlement was delivered and everything before it was dropped.
    const store = new InMemoryEventStore();
    await ingestRange(store, LAST_POOL_SETTLEMENT, fixture.transactions.length);
    const settled = Object.values(store.projection.snapshot().pools);
    expect(settled.length, 'the pre-ingested slice settles exactly one pool').to.equal(1);
    expect(settled[0].state, 'and settles it').to.equal('Paid');

    const r = await runBackfill(store, SILENT_MONITOR, CTX, reverseOrderRpc());
    expect(r.inserted, 'the gap really was filled').to.be.greaterThan(0);
    expect(r.duplicates, 'and the four it already had came back as duplicates').to.be.greaterThan(0);

    // Chain order among the inserted rows does not help: the pool's own
    // PoolOpened is older than the PrizesPaid this ledger already projected, so
    // it lands on top of it and resets the row to Open.
    const pools = Object.values(store.projection.snapshot().pools);
    expect(pools.length).to.equal(3);
    // `String(...)`: the pool's PoolSealed (which writes the count as a number)
    // was applied live, and the walk's 52 replayed increments write a decimal
    // string over it. The type of that column is itself a symptom of the
    // re-application this test is about.
    const minField = pools.find((p) => String(p.entrants) === '52')!;
    expect(minField, 'the fixture still has a 52-seat pool').to.exist;
    expect(minField.state, 'a pool that has paid reads as Open').to.equal('Open');
    expect(
      Object.values(store.projection.snapshot().payouts).some((p) => p.pool === minField.pool),
      'while its payout row is right there'
    ).to.equal(true);
    expect(pools.filter((p) => p.state === 'Paid').length).to.equal(1);
  });

  it('backfillAndRederive replays the ledger in (slot, seq) order and the rows are right', async () => {
    const repaired = new InMemoryEventStore();
    await ingestRange(repaired, LAST_POOL_SETTLEMENT, fixture.transactions.length);
    const r = await backfillAndRederive(repaired, SILENT_MONITOR, CTX, reverseOrderRpc());
    expect(r.rederived, 'the replay ran').to.be.greaterThan(140);

    // The reference: the same events applied oldest-first, as the webhook
    // delivers them live.
    const forwards = new InMemoryEventStore();
    await ingestAll(forwards);

    expect(JSON.parse(JSON.stringify(repaired.projection.snapshot()))).to.deep.equal(
      JSON.parse(JSON.stringify(forwards.projection.snapshot()))
    );

    // Stated outright, so a future reader does not have to trust the deep
    // compare to know what this is about.
    const pools = Object.values(repaired.projection.snapshot().pools);
    expect(pools.filter((p) => p.state === 'Paid').length).to.equal(2);
    expect(pools.filter((p) => p.state === 'Closed').length).to.equal(1);
    expect(pools.find((p) => p.entrants === 64)!.state).to.equal('Paid');
  });

  it('a walk that inserted nothing new does not replay', async () => {
    const store = new InMemoryEventStore();
    await ingestAll(store);
    const r = await backfillAndRederive(store, SILENT_MONITOR, CTX, reverseOrderRpc());
    expect(r.inserted, 'every signature is already in the ledger').to.equal(0);
    expect(r.duplicates).to.be.greaterThan(0);
    expect(r.rederived, 'nothing inserted means nothing mis-ordered').to.equal(0);
  });
});
