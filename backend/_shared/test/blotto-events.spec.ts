/**
 * Byte-level pins for the event layouts added since E1 PR3a — `TiersOpened`
 * (PR3a) and the 2026-09-07 upgrade's `TierSlotFreed`, `NextPlacePaid`,
 * `KeeperSet`, `PoolTimingSet`, `ConfigMigrated` — built from the Rust
 * structs' Borsh layout by hand (pubkey = 32 raw bytes, u64/i64 = 8 bytes
 * LE, u16 = 2 bytes LE, `[bool; 7]` = seven one-byte bools) and pushed
 * through the SAME registry the indexer uses. The cross-language pin
 * against bytes the real program emitted is the indexer's
 * `projection.spec.ts` over the LiteSVM fixture; this suite exists so the
 * layout is checked the moment the decoder is written, and so
 * `Reader.end()`'s drift guard is proven to fire on a short or long body.
 */
import { expect } from 'chai';
import { anchorEventDiscriminator, decodeAnchorEvent } from '../src/events';
import { base58Encode, registerBlottoEventLayouts } from '../src/blotto-events';

before(() => registerBlottoEventLayouts());

function payload(name: string, body: Buffer): Buffer {
  return Buffer.concat([anchorEventDiscriminator(name), body]);
}
function u64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function i64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}
function u16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}
const key = (fill: number): Buffer => Buffer.alloc(32, fill);
const b58 = (b: Buffer): string => base58Encode(new Uint8Array(b));

describe('TierSlotFreed (prompt v2 §B.6 — the cooldown stamp)', () => {
  it('decodes tier + pool_id + next_open_at, the times as decimal strings', () => {
    const ev = decodeAnchorEvent(
      payload('TierSlotFreed', Buffer.concat([Buffer.from([3]), u64(41n), i64(1_788_929_242n)]))
    );
    expect(ev).to.not.equal(null);
    expect(ev!.event).to.equal('TierSlotFreed');
    expect(ev!.tier).to.equal(3);
    expect(ev!.pool_id).to.equal('41');
    expect(ev!.next_open_at).to.equal('1788929242');
    expect(typeof ev!.next_open_at).to.equal('string', 'never a float, never a number');
  });

  it('a body with a stray byte is layout drift, not a decode', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload(
        'TierSlotFreed',
        Buffer.concat([Buffer.from([0]), u64(1n), i64(0n), Buffer.from([0])])
      ),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('TierSlotFreed');
  });
});

describe('NextPlacePaid (founder ruling 4 (ii), addendum ruling 3 — one portion of a forfeited share)', () => {
  it('decodes pool, from, to, rank, amount, group_size', () => {
    const ev = decodeAnchorEvent(
      payload(
        'NextPlacePaid',
        Buffer.concat([key(1), key(2), key(3), Buffer.from([4]), u64(666_666_667n), u16(2)])
      )
    );
    expect(ev).to.not.equal(null);
    expect(ev!.event).to.equal('NextPlacePaid');
    expect(ev!.pool).to.equal(b58(key(1)));
    expect(ev!.from).to.equal(b58(key(2)));
    expect(ev!.to).to.equal(b58(key(3)));
    expect(ev!.rank).to.equal(4);
    expect(ev!.amount).to.equal('666666667');
    expect(ev!.group_size).to.equal(2);
  });

  it('the pre-split shape (no group_size) is refused as a short body', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload('NextPlacePaid', Buffer.concat([key(1), key(2), key(3), Buffer.from([1]), u64(1n)])),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('NextPlacePaid');
  });
});

describe('the 2026-09-07 admin events', () => {
  it('KeeperSet carries the keeper', () => {
    const ev = decodeAnchorEvent(payload('KeeperSet', key(9)));
    expect(ev!.event).to.equal('KeeperSet');
    expect(ev!.keeper).to.equal(b58(key(9)));
  });

  it('PoolTimingSet carries both timings as decimal strings', () => {
    const ev = decodeAnchorEvent(payload('PoolTimingSet', Buffer.concat([i64(43_200n), i64(300n)])));
    expect(ev!.event).to.equal('PoolTimingSet');
    expect(ev!.fill_deadline_seconds).to.equal('43200');
    expect(ev!.cooldown_seconds).to.equal('300');
  });

  it('ConfigMigrated carries the keeper and the seeded timings', () => {
    const ev = decodeAnchorEvent(
      payload('ConfigMigrated', Buffer.concat([key(7), i64(43_200n), i64(300n)]))
    );
    expect(ev!.event).to.equal('ConfigMigrated');
    expect(ev!.keeper).to.equal(b58(key(7)));
    expect(ev!.fill_deadline_seconds).to.equal('43200');
    expect(ev!.cooldown_seconds).to.equal('300');
  });

  it('GoTimerStarted is gone — an unknown discriminator, not a decode', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload('GoTimerStarted', Buffer.concat([key(1), i64(1n)])),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('', 'unknown events are skipped silently, not flagged as drift');
  });
});

describe('TiersOpened (set_open_tiers enablement)', () => {
  it('decodes seven bools in tier order', () => {
    const body = Buffer.from([1, 0, 1, 0, 0, 0, 1]);
    const ev = decodeAnchorEvent(payload('TiersOpened', body));
    expect(ev).to.not.equal(null);
    expect(ev!.event).to.equal('TiersOpened');
    expect(ev!.open_tiers).to.deep.equal([true, false, true, false, false, false, true]);
  });

  it('the launch posture: tier 0 only', () => {
    const ev = decodeAnchorEvent(payload('TiersOpened', Buffer.from([1, 0, 0, 0, 0, 0, 0])));
    expect(ev!.open_tiers).to.deep.equal([true, false, false, false, false, false, false]);
  });

  it('six bools is a short body — refused, not padded', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload('TiersOpened', Buffer.from([1, 0, 0, 0, 0, 0])),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('TiersOpened');
  });
});
