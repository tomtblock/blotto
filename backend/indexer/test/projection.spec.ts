/**
 * The cross-language decode + projection suite (roadmap 2.5).
 *
 * The fixture is REAL: `fixtures/lifecycle-logs.json` holds the transaction
 * logs of the Ladder program (D-E19) executed in LiteSVM
 * (tests/litesvm/tests/dump_events.rs, whose header tells it pool by pool):
 *
 *   - the upgrade in one transaction: a real Config migration
 *     (`HardLadderAdded`) and three pool types — easy 64 and easy 16 at
 *     tier 0 configured and enabled, hard 8 configured and never enabled;
 *   - pool 1, easy, 64 seats, the Ladder table: 64 entries, flags, a
 *     two-way tie for first sharing 1st and 2nd, sixteen places paid in
 *     three batches, an escrow release, and an admin forfeit whose share is
 *     HELD (a Ladder pool pays nothing onward yet);
 *   - the admin and treasury setters, and easy 16 switched off and on;
 *   - pool 2, the refund fork, migrated through all three of
 *     `migrate_pool`'s old shapes (850, 849, 847 bytes);
 *   - pool 3, a ONE-PLACE pool (migrated from the pre-Ladder shape): 40
 *     entries sealed at the deadline, a two-way tie for first, one tied
 *     seat forfeited and paid onward to the other (`NextPlacePaid`);
 *   - pool 4, easy, 16 seats: 12 entries, sealed at the deadline, the
 *     table [5, 3, 1, 1] paid in one batch — its settlement is the last
 *     four transactions.
 *
 * So this suite checks the TypeScript
 * decoders against bytes Anchor actually emitted — not against a TS-side
 * re-encoding of themselves — and then that the projection derives the
 * expected rows, and that `rederive()` rebuilds an identical snapshot from
 * the ledger alone.
 */
import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SILENT_MONITOR, decodeEventsFromLogs } from '../src/shared';
import { base58Decode, registerBlottoEventLayouts } from '../../_shared/src/blotto-events';
import { anchorEventDiscriminator } from '../../_shared/src/events';
import { programDataLine } from './event-codec';
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

/** A 64-player tier-0 pool's prize pool (40 entries at 0.1 SOL); pools 1–3. */
const POT = '4000000000';
/** The 16-player tier-0 pool's prize pool (10 entries at 0.1 SOL); pool 4. */
const POT_16 = '1000000000';
/** The 64-player Ladder table and the 16-player one (D-E19), rank 1 first. */
const TABLE_64 = [12, 6, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1];
const TABLE_16 = [5, 3, 1, 1];
/** Each table's places in lamports at 0.1 SOL. */
const ENTRY = 100_000_000n;
const placesIn = (table: number[]): string[] => table.map((m) => (BigInt(m) * ENTRY).toString());

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
 * The fixture's last four transactions: the 16-player pool's (pool 4's)
 * deadline seal, secret reveal, results commit, and its slot release +
 * payout. Used by the
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
      // Phase B (2026-09-24): the Config migration, the hard ladder's
      // enablement, and the shapes `migrate_pool` grows.
      'HardLadderAdded',
      'HardTiersOpened',
      'PoolMigrated',
      // The Ladder (D-E19): the pool types, and the treasury's movements.
      'PoolTypeInitialized',
      'PoolTypeEconomicsSet',
      'PoolTypeEnabledSet',
      'PlatformFunded',
      'PlatformWithdrawn',
      'TierEconomicsSet',
      'TreasuryPolicySet',
    ]) {
      expect(counts.get(name) ?? 0, name).to.be.greaterThan(0);
    }
    // The retired 2026-09-07 migration's event: no path emits it any more
    // (the decoder keeps its layout for the one the devnet ledger holds).
    expect(counts.get('ConfigMigrated') ?? 0).to.equal(0);
    // Pool 2 was migrated through all three old shapes (850, 849 and 847
    // bytes) and pool 3 through the pre-Ladder one: four in all, each
    // carrying the Ladder tail.
    expect(counts.get('PoolMigrated')).to.equal(4);
    // Three pool types created and configured; four switch events (two on
    // at the upgrade, easy 16 off and on again).
    expect(counts.get('PoolTypeInitialized')).to.equal(3);
    expect(counts.get('PoolTypeEconomicsSet')).to.equal(3);
    expect(counts.get('PoolTypeEnabledSet')).to.equal(4);
    expect(counts.get('PoolOpened')).to.equal(4);
    expect(counts.get('EntryRegistered')).to.equal(118); // 64 + 2 refund pool + 40 one-place pool + 12 sixteen-player pool
    // Every slot release stamps a cooldown: pool 1 Paid, pool 2 Closed,
    // pool 3 Paid, pool 4 Paid.
    expect(counts.get('TierSlotFreed')).to.equal(4);
    // Two forfeits: pool 1's share is HELD (a Ladder pool pays nothing
    // onward until the field-moves-up payout ships), pool 3's — a one-place
    // pool — goes to its one eligible tied player. So exactly one onward
    // payment, and it is pool 3's.
    expect(counts.get('EscrowForfeited')).to.equal(2);
    expect(counts.get('NextPlacePaid')).to.equal(1);
    // The go-timer never existed on any deployment; its event is gone.
    expect(counts.get('GoTimerStarted') ?? 0).to.equal(0);
    // Three seals: pool 1's at its 64th seat (inside `register`) and the
    // deadline seals of pools 3 and 4. The refund fork never seals.
    expect(counts.get('PoolSealed')).to.equal(3);
    // Pool 1 paid sixteen places in three batches; pools 3 and 4 in one.
    expect(counts.get('PrizesPaid')).to.equal(5);
  });

  it('projects the lifecycle into the derived tables', async () => {
    const store = new InMemoryEventStore();
    await ingestAll(store);
    const snap = store.projection.snapshot();

    const pools = Object.values(snap.pools);
    expect(pools.length).to.equal(4);
    const byId = (id: string): Row => {
      const p = pools.find((x) => x.id === id);
      expect(p, `pool ${id}`).to.exist;
      return p!;
    };
    const fullPool = byId('1');
    const closedPool = byId('2');
    const onePlacePool = byId('3');
    const sixteenPool = byId('4');
    expect(fullPool).to.include({ state: 'Paid', entrants: 64 }, 'the 64-seat Ladder pool ends Paid');
    expect(closedPool.state, 'the refund pool ends Closed').to.equal('Closed');
    expect(onePlacePool).to.include({ state: 'Paid', entrants: 40 }, 'the one-place pool ends Paid at its floor');
    expect(sixteenPool).to.include({ state: 'Paid', entrants: 12 }, 'the 16-player pool ends Paid');
    // u64 seat bitmask, decimal string. Pool 1 paid sixteen places (bits
    // 0..15); pool 3 its two tied seats (bits 0..1); pool 4 its four places
    // (bits 0..3).
    expect(fullPool.paid_mask).to.equal('65535');
    expect(onePlacePool.paid_mask).to.equal('3');
    expect(sixteenPool.paid_mask).to.equal('15');
    for (const p of [fullPool, onePlacePool]) expect(p.pot_lamports).to.equal(POT);
    expect(sixteenPool.pot_lamports).to.equal(POT_16);
    for (const p of [fullPool, onePlacePool, sixteenPool]) {
      expect(p.secret).to.equal('2a'.repeat(32)); // the harness secret
    }
    // Pools 1 and 3 committed REAL results roots (pool 3's forfeited share
    // is paid onward against its root); pool 4's is the harness pin.
    for (const p of [fullPool, onePlacePool]) {
      expect(p.results_root).to.match(/^[0-9a-f]{64}$/);
      expect(p.results_root).to.not.equal('01'.repeat(32));
    }
    expect(sixteenPool.results_root).to.equal('01'.repeat(32));
    // Option A (2026-09-07): no pool carries a go-deadline — the deadline
    // set at open is the only clock.
    for (const p of pools) expect(p.go_deadline).to.equal(undefined);

    // The Ladder (D-E19, 0026): each pool carries the size, floor and table
    // it was opened (or migrated) under, never the zero padding.
    expect(fullPool).to.include({ capacity: 64, paid_places: 16, min_seats: 40, mode: 0 });
    expect(fullPool.prize_table).to.deep.equal(TABLE_64);
    expect(sixteenPool).to.include({ capacity: 16, paid_places: 4, min_seats: 10, mode: 0 });
    expect(sixteenPool.prize_table).to.deep.equal(TABLE_16);
    // `migrate_pool` records an old pool as 64 seats and ONE place worth the
    // whole prize pool — 40 entries at 0.1 SOL — and the floor its players
    // entered under: 40 for pool 3, and 52 for pool 2, whose last migration
    // was from the pre-R7-b (847-byte) shape.
    expect(onePlacePool).to.include({ capacity: 64, paid_places: 1, min_seats: 40 });
    expect(onePlacePool.prize_table).to.deep.equal([40]);
    expect(closedPool).to.include({ capacity: 64, paid_places: 1, min_seats: 52 });
    expect(closedPool.prize_table).to.deep.equal([40]);

    // Prompt v2 §B.6: the cooldown stamp, keyed by pool TYPE since D-E19 —
    // one per size that freed a slot, each from its LAST release, with the
    // pool that freed it: the 64-player type's from pool 3, the 16-player
    // type's from pool 4.
    const tierStatus = Object.values(snap.tier_status);
    expect(tierStatus.length).to.equal(2);
    const stamp64 = tierStatus.find((t) => t.capacity === 64)!;
    const stamp16 = tierStatus.find((t) => t.capacity === 16)!;
    for (const t of [stamp64, stamp16]) {
      expect(t).to.include({ tier: 0, mode: 0 });
      expect(t.next_open_at).to.be.a('string');
      expect(BigInt(t.next_open_at as string) > 0n).to.equal(true);
    }
    expect(stamp64.last_pool_id).to.equal(String(onePlacePool.id));
    expect(stamp16.last_pool_id).to.equal(String(sixteenPool.id));

    // The pool types (0026): one row per (mode, tier, capacity), each as its
    // account reads — easy 64 and easy 16 enabled (16 after its off-and-on),
    // hard 8 configured and never switched on.
    const types = Object.values(snap.pool_types);
    expect(types.length).to.equal(3);
    const type = (mode: number, capacity: number): Row => types.find((t) => t.mode === mode && t.capacity === capacity)!;
    expect(type(0, 64)).to.include({ enabled: true, min_seats: 40, paid_places: 16, pot_lamports: POT, last_pool_id: '3' });
    expect(type(0, 64).prize_table).to.deep.equal(TABLE_64);
    expect(type(0, 16)).to.include({ enabled: true, min_seats: 10, paid_places: 4, pot_lamports: POT_16, last_pool_id: '4' });
    expect(type(0, 16).prize_table).to.deep.equal(TABLE_16);
    expect(type(1, 8)).to.include({ enabled: false, min_seats: 5, paid_places: 2, pot_lamports: '500000000', next_open_at: '0' });
    expect(type(1, 8).prize_table).to.deep.equal([3, 2]);
    for (const t of types) expect(t.pool_type, 'every row names its account').to.be.a('string');

    // Pools 1, 3 and 4 had their seeds patched directly (no event); pool 2's
    // landed via a real commit_vrf_seed with value 0x4d bytes.
    for (const p of [fullPool, onePlacePool, sixteenPool]) expect(p.vrf_seed).to.equal(undefined);
    expect(closedPool.vrf_seed).to.equal('4d'.repeat(32));

    const entries = Object.values(snap.entries);
    expect(entries.length).to.equal(118);
    const refunded = entries.filter((e) => e.refunded === true);
    expect(refunded.length).to.equal(2);
    expect(refunded.every((e) => e.pool === closedPool.pool)).to.equal(true);
    // Pool 1's seat 0 released; pool 1's seat 1 and pool 3's seat 1 forfeited.
    const settled = (how: string) =>
      entries
        .filter((e) => e.escrow_settled === how)
        .map((e) => `${pools.find((p) => p.pool === e.pool)!.id}:${e.idx}`);
    expect(settled('released')).to.deep.equal(['1:0']);
    expect(settled('forfeited').sort()).to.deep.equal(['1:1', '3:1']);

    // The full pool drained the whole class bag; every smaller field drew a
    // strict sub-multiset of the SAME 64 counters — every size draws from
    // one mix (D-E19), and class decides nothing about any of it.
    const bagOf = (pool: unknown): number[] => {
      const bag = [0, 0, 0, 0, 0];
      for (const e of entries) {
        if (e.pool === pool) bag[e.class as number]++;
      }
      return bag;
    };
    expect(bagOf(fullPool.pool)).to.deep.equal([38, 15, 7, 3, 1]);
    for (const [p, n] of [
      [onePlacePool, 40],
      [sixteenPool, 12],
    ] as const) {
      const bag = bagOf(p.pool);
      expect(bag.reduce((a, b) => a + b, 0)).to.equal(n);
      bag.forEach((c, i) => expect(c, `pool ${p.id} class ${i}`).to.be.at.most([38, 15, 7, 3, 1][i]));
    }

    // The committed payout lists (D3-B): pool 1's sixteen places, its tie
    // for first sharing 1st and 2nd ((12 + 6) / 2 entries each); pool 3's
    // tie splitting its one place; pool 4's four places. Each list
    // conserves its prize pool and is mirrored by its settled payouts.
    const results = Object.values(snap.results);
    expect(results.length).to.equal(16 + 2 + 4);
    const payouts = Object.values(snap.payouts);
    expect(payouts.length).to.equal(16 + 2 + 4);
    for (const [p, pot] of [
      [fullPool, POT],
      [onePlacePool, POT],
      [sixteenPool, POT_16],
    ] as const) {
      expect(sumFor(results, p.pool), `pool ${p.id}: committed list conserves the prize pool`).to.equal(pot);
      expect(sumFor(payouts, p.pool), `pool ${p.id}: settled payouts conserve the prize pool`).to.equal(pot);
    }
    const amountsBySeat = (pool: unknown): string[] =>
      payouts
        .filter((x) => x.pool === pool)
        .sort((a, b) => (a.seat as number) - (b.seat as number))
        .map((x) => x.amount as string);
    // The tie for first shares the combined worth of 1st and 2nd; ranks 3
    // to 16 are paid their own places.
    expect(amountsBySeat(fullPool.pool)).to.deep.equal([
      ((BigInt(TABLE_64[0] + TABLE_64[1]) * ENTRY) / 2n).toString(),
      ((BigInt(TABLE_64[0] + TABLE_64[1]) * ENTRY) / 2n).toString(),
      ...placesIn(TABLE_64.slice(2)),
    ]);
    expect(amountsBySeat(onePlacePool.pool)).to.deep.equal(['2000000000', '2000000000']);
    expect(amountsBySeat(sixteenPool.pool)).to.deep.equal(placesIn(TABLE_16));

    // Profiles (R15). Pool 1: both tied seats were flagged and escrowed;
    // seat 0's escrow was released (credited via EscrowReleased), seat 1's
    // forfeited and HELD — so seat 1 no longer counts a paid seat and nobody
    // is credited its share. Pool 3: seat 0 was paid directly and then
    // received seat 1's forfeited share (NextPlacePaid), so it holds the
    // whole prize pool. Pool 4's first place was paid directly.
    const seatOf = (pool: unknown, seat: number): Row =>
      payouts.find((x) => x.pool === pool && x.seat === seat)!;
    const profileOf = (player: unknown): Row =>
      Object.values(snap.profiles).find((p) => p.player === player)!;
    const tie1 = [seatOf(fullPool.pool, 0), seatOf(fullPool.pool, 1)];
    const tie3 = [seatOf(onePlacePool.pool, 0), seatOf(onePlacePool.pool, 1)];
    expect(profileOf(tie1[0].player)).to.include({ total_won_lamports: '900000000', seats_paid: '1', pools_entered: '1' });
    expect(profileOf(tie1[1].player).total_won_lamports).to.equal(undefined);
    expect(profileOf(tie1[1].player).seats_paid).to.equal('0');
    expect(profileOf(tie3[0].player)).to.include({ total_won_lamports: POT, seats_paid: '1' });
    expect(profileOf(tie3[1].player).total_won_lamports).to.equal(undefined);
    expect(profileOf(tie3[1].player).seats_paid).to.equal('0');
    expect(profileOf(seatOf(sixteenPool.pool, 0).player).total_won_lamports).to.equal('500000000');
    const entryOf = (pool: unknown, player: unknown): Row =>
      entries.find((e) => e.pool === pool && e.player === player)!;
    expect(entryOf(onePlacePool.pool, tie3[0].player).next_place_lamports).to.equal('2000000000');
    // The held share went to nobody: no entry of pool 1 received anything.
    expect(entries.filter((e) => e.pool === fullPool.pool && e.next_place_lamports !== undefined)).to.deep.equal([]);

    // Player history (D-A2 v2): one row per entry across all four pools,
    // each carrying tier, prize pool, and the running entry count. Paid
    // rows: pool 1's fifteen settled places (seat 1's forfeited row is
    // unmarked with amount 0), pool 3's seat 0, pool 4's four places.
    const history = Object.values(snap.player_history);
    expect(history.length).to.equal(118);
    for (const h of history) {
      expect(h.entries_to_date, `entries_to_date for ${h.player}`).to.equal('1');
      expect(h.tier).to.equal(0);
      expect(h.pot_lamports).to.equal(h.pool === sixteenPool.pool ? POT_16 : POT);
    }
    const paidRows = history.filter((h) => h.paid === true);
    expect(paidRows.length).to.equal(15 + 1 + 4);
    for (const [pool, player] of [
      [fullPool.pool, tie1[1].player],
      [onePlacePool.pool, tie3[1].player],
    ]) {
      const row = history.find((h) => h.pool === pool && h.player === player)!;
      expect(row.paid).to.equal(false);
      expect(row.amount_lamports).to.equal('0');
    }
    const paidAmounts = paidRows.map((h) => ({ pool: h.pool, amount: h.amount_lamports }));
    // Pools 3 and 4's history sums to the prize pool. Pool 1's sums to it
    // LESS the held share: that 0.9 SOL sits in the pool's vault, owed to
    // its players once the field moves up, and credited to nobody yet.
    expect(sumFor(paidAmounts, onePlacePool.pool)).to.equal(POT);
    expect(sumFor(paidAmounts, sixteenPool.pool)).to.equal(POT_16);
    expect(sumFor(paidAmounts, fullPool.pool)).to.equal((BigInt(POT) - 900_000_000n).toString());
    // The history row's seat agrees with the payout's seat for each winner.
    for (const w of [tie1[0], tie3[0], seatOf(sixteenPool.pool, 0)]) {
      const h = history.find((x) => x.player === w.player && x.pool === w.pool)!;
      expect(h.seat).to.equal(0);
      expect(h.paid).to.equal(true);
    }
    const h3 = history.find((x) => x.player === tie3[0].player && x.pool === onePlacePool.pool)!;
    expect(h3.amount_lamports, 'its own half and the forfeited half').to.equal(POT);
  });

  it('rederive rebuilds an identical snapshot from the ledger alone', async () => {
    const store = new InMemoryEventStore();
    await ingestAll(store);
    const live = JSON.parse(JSON.stringify(store.projection.snapshot()));
    const replayed = await store.rederive();
    expect(replayed).to.be.greaterThan(170); // 184 rows in the current fixture
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
    expect(pools.filter((p) => p.state === 'Paid').length).to.equal(3);
    expect(pools.filter((p) => p.state === 'Closed').length).to.equal(1);
    expect(pools.find((p) => p.entrants === 64)!.state).to.equal('Paid');
  });

  it('a walk that fills a gap BELOW already-projected rows still corrupts them', async () => {
    // The unbounded `backfill` command's reason to exist: the ledger holds the
    // newest transactions and is missing older ones. Here the 16-player
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
    expect(pools.length).to.equal(4);
    // `String(...)`: the pool's PoolSealed (which writes the count as a number)
    // was applied live, and the walk's 12 replayed increments write a decimal
    // string over it. The type of that column is itself a symptom of the
    // re-application this test is about.
    const shortField = pools.find((p) => String(p.entrants) === '12')!;
    expect(shortField, 'the fixture still has a 12-seat, 16-player pool').to.exist;
    expect(shortField.capacity, 'its own size survives the reset').to.equal(16);
    expect(shortField.state, 'a pool that has paid reads as Open').to.equal('Open');
    expect(
      Object.values(store.projection.snapshot().payouts).some((p) => p.pool === shortField.pool),
      'while its payout row is right there'
    ).to.equal(true);
    // Pools 1 and 3 were walked in order and read right; pool 4 did not.
    expect(pools.filter((p) => p.state === 'Paid').length).to.equal(2);
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
    expect(pools.filter((p) => p.state === 'Paid').length).to.equal(3);
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

/**
 * Sanctions holds, decoded and projected (audit 2026-09-11, D-20 / F-08).
 *
 * The program has emitted `SanctionsHoldPlaced` / `SanctionsHoldLifted` since
 * Stage F. Nothing off chain decoded either, so no ledger row and no derived
 * column existed: `lift_sanctions_hold` — the one instruction that can free a
 * held share — could not be aimed from any operator tool, and a held player's
 * results page had nothing to say about why their prize had not moved.
 *
 * The fixture below is the REAL lifecycle dump with two hold events appended
 * as Anchor `Program data:` lines, so the hold lands on an entry the compiled
 * program actually registered, through the whole path: logs → decode →
 * ledger → projection. (The LiteSVM dump itself is regenerated by
 * `tests/litesvm/tests/dump_events.rs`, which is a program-side change and is
 * not made here.)
 */
describe('sanctions holds reach the derived tables', () => {
  before(() => registerBlottoEventLayouts());

  const holdLine = (name: string, pool: string, player: string, at: bigint): string => {
    const body = Buffer.alloc(8);
    body.writeBigInt64LE(at);
    return programDataLine(
      Buffer.concat([
        anchorEventDiscriminator(name),
        Buffer.from(base58Decode(pool)),
        Buffer.from(base58Decode(player)),
        body,
      ])
    );
  };

  /** The whole fixture, then a hold placed on one of its real entries. */
  async function heldStore(): Promise<{
    store: InMemoryEventStore;
    pool: string;
    player: string;
    other: string;
  }> {
    const store = new InMemoryEventStore();
    await ingestAll(store);
    const snap = store.projection.snapshot();
    // Seat 0 of the 64-seat pool — the one the fixture flagged and released.
    // Named by its pool rather than found as "the first seat 0": the
    // snapshot's row order follows the players' (random, per regeneration)
    // keys, and the fixture holds four seat-0 rows.
    const fullPool = Object.values(snap.pools).find((p) => p.entrants === 64)!;
    const entries = Object.values(snap.entries);
    const target = entries.find((e) => e.pool === fullPool.pool && e.idx === 0)!;
    const other = entries.find((e) => e.pool === target.pool && e.idx === 1)!;
    const pool = target.pool as string;
    const player = target.player as string;
    await ingestTransaction(store, SILENT_MONITOR, CTX, {
      signature: 'SIGHOLD00',
      slot: BigInt(fixture.transactions.length + 1),
      logs: [holdLine('SanctionsHoldPlaced', pool, player, 1_789_000_000n)],
    });
    return { store, pool, player, other: other.player as string };
  }

  it('a placed hold lands on that entry, with the time it was placed', async () => {
    const { store, pool, player } = await heldStore();
    const row = Object.values(store.projection.snapshot().entries).find(
      (e) => e.pool === pool && e.player === player
    )!;
    expect(row.sanctions_hold).to.equal(true);
    expect(row.sanctions_hold_at).to.equal('1789000000');
  });

  it('a hold is NOT a flag: the reviewer\'s own columns are untouched', async () => {
    // The fixture's seat 0 was flagged by a reviewer and its escrow released.
    // A hold placed on the same entry must disturb neither: the program keeps
    // the two mechanisms apart, and an operator who read one for the other
    // would send a release the program refuses, or tell a held player they
    // are under review when they are not.
    const before = new InMemoryEventStore();
    await ingestAll(before);
    const { store, pool, player } = await heldStore();
    const was = Object.values(before.projection.snapshot().entries).find(
      (e) => e.pool === pool && e.player === player
    )!;
    const held = Object.values(store.projection.snapshot().entries).find(
      (e) => e.pool === pool && e.player === player
    )!;
    expect(was.flagged, 'the fixture really did flag this seat').to.equal(true);
    expect(held.flagged).to.equal(was.flagged);
    expect(held.escrow_settled).to.equal(was.escrow_settled);
    expect(held.sanctions_hold, 'only its own column moved').to.equal(true);
  });

  it('holds no other entry — and every other row says "not held" rather than nothing', async () => {
    const { store, pool, player, other } = await heldStore();
    const rows = Object.values(store.projection.snapshot().entries);
    expect(rows.filter((e) => e.sanctions_hold === true).length).to.equal(1);
    const neighbour = rows.find((e) => e.pool === pool && e.player === other)!;
    expect(neighbour.sanctions_hold, 'written at registration, not left undefined').to.equal(false);
    expect(rows.every((e) => e.sanctions_hold !== undefined)).to.equal(true);
    expect(player).to.not.equal(other);
  });

  it('a lift clears it, and stamps when — the operator tool can see both states', async () => {
    const { store, pool, player } = await heldStore();
    await ingestTransaction(store, SILENT_MONITOR, CTX, {
      signature: 'SIGHOLD01',
      slot: BigInt(fixture.transactions.length + 2),
      logs: [holdLine('SanctionsHoldLifted', pool, player, 1_789_600_000n)],
    });
    const row = Object.values(store.projection.snapshot().entries).find(
      (e) => e.pool === pool && e.player === player
    )!;
    expect(row.sanctions_hold).to.equal(false);
    expect(row.sanctions_hold_at).to.equal('1789600000');
  });

  it('rederive rebuilds the hold from the ledger alone — it is derived, not stored', async () => {
    const { store } = await heldStore();
    const live = JSON.parse(JSON.stringify(store.projection.snapshot()));
    await store.rederive();
    expect(JSON.parse(JSON.stringify(store.projection.snapshot()))).to.deep.equal(live);
  });

  it('the events are ingested as themselves, not skipped as unknown', async () => {
    const { store } = await heldStore();
    const names = store.ledger().map((r) => r.name);
    expect(names, 'a recognised discriminator, appended to the ledger').to.contain(
      'SanctionsHoldPlaced'
    );
  });
});
