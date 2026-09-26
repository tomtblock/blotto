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
    // The pre-Phase-B shape: no `mode` byte. Every TierSlotFreed devnet
    // emitted before 2026-09-24 looks like this, and reads as the easy
    // ladder (`mode: null`) — the only ladder there was.
    const ev = decodeAnchorEvent(
      payload('TierSlotFreed', Buffer.concat([Buffer.from([3]), u64(41n), i64(1_788_929_242n)]))
    );
    expect(ev).to.not.equal(null);
    expect(ev!.event).to.equal('TierSlotFreed');
    expect(ev!.tier).to.equal(3);
    expect(ev!.pool_id).to.equal('41');
    expect(ev!.next_open_at).to.equal('1788929242');
    expect(typeof ev!.next_open_at).to.equal('string', 'never a float, never a number');
    expect(ev!.mode).to.equal(null, 'a pre-Phase-B event carries no mode');
  });

  it('the Phase B shape carries the ladder whose slot freed', () => {
    const ev = decodeAnchorEvent(
      payload(
        'TierSlotFreed',
        Buffer.concat([Buffer.from([0]), u64(7n), i64(1_788_929_242n), Buffer.from([1])])
      )
    );
    expect(ev!.tier).to.equal(0);
    expect(ev!.pool_id).to.equal('7');
    expect(ev!.mode).to.equal(1, 'the hard ladder');
  });

  it('a body with a byte past `mode` is layout drift, not a decode', () => {
    // One trailing byte is `mode` now (Phase B appended it); two is drift.
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload(
        'TierSlotFreed',
        Buffer.concat([Buffer.from([0]), u64(1n), i64(0n), Buffer.from([0, 0])])
      ),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('TierSlotFreed');
  });
});

/**
 * Phase B (2026-09-24): the hard ladder. `mode` was APPENDED to three
 * events a ledger already held at the shorter shape, so each decodes both
 * shapes — `null` for the old one, never a guess dressed as data — and two
 * new events carry the ladder's own migration and enablement.
 */
describe('the Phase B mode tail on PoolOpened and PoolMigrated', () => {
  const opened = (tail: Buffer) =>
    Buffer.concat([
      key(1), // pool
      u64(9n), // id
      Buffer.from([0]), // tier
      u64(100_000_000n), // entry_lamports
      u64(4_000_000_000n), // pot_lamports
      i64(1_788_929_242n), // fill_deadline
      Buffer.from([15]), // timer_seconds
      key(2), // sealing_pubkey
      key(3), // sealing_secret_hash
      tail,
    ]);

  it('PoolOpened: the pre-Phase-B shape reads mode null, the new shape reads it', () => {
    const old = decodeAnchorEvent(payload('PoolOpened', opened(Buffer.alloc(0))));
    expect(old!.event).to.equal('PoolOpened');
    expect(old!.id).to.equal('9');
    expect(old!.sealing_secret_hash).to.equal('03'.repeat(32));
    expect(old!.mode).to.equal(null);
    const hard = decodeAnchorEvent(payload('PoolOpened', opened(Buffer.from([1]))));
    expect(hard!.mode).to.equal(1);
    const easy = decodeAnchorEvent(payload('PoolOpened', opened(Buffer.from([0]))));
    expect(easy!.mode).to.equal(0);
  });

  it('PoolOpened: two trailing bytes is drift', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload('PoolOpened', opened(Buffer.from([0, 0]))),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('PoolOpened');
  });

  it('PoolMigrated: the 2026-09-13 shape (pool, min_seats) and the Phase B shape (+ mode)', () => {
    const old = decodeAnchorEvent(payload('PoolMigrated', Buffer.concat([key(4), u16(52)])));
    expect(old!.event).to.equal('PoolMigrated');
    expect(old!.min_seats).to.equal(52);
    expect(old!.mode).to.equal(null);
    const now = decodeAnchorEvent(
      payload('PoolMigrated', Buffer.concat([key(4), u16(40), Buffer.from([0])]))
    );
    expect(now!.min_seats).to.equal(40);
    expect(now!.mode).to.equal(0, 'a migrated pool is always easy');
  });
});

describe('HardLadderAdded / HardTiersOpened (Phase B)', () => {
  it('HardLadderAdded carries the migration instant as a decimal string', () => {
    const ev = decodeAnchorEvent(payload('HardLadderAdded', i64(1_790_000_000n)));
    expect(ev!.event).to.equal('HardLadderAdded');
    expect(ev!.migrated_at).to.equal('1790000000');
  });

  it('HardLadderAdded with a trailing byte is drift', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload('HardLadderAdded', Buffer.concat([i64(1n), Buffer.from([0])])),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('HardLadderAdded');
  });

  it('HardTiersOpened decodes seven bools in tier order, like TiersOpened', () => {
    const ev = decodeAnchorEvent(payload('HardTiersOpened', Buffer.from([1, 0, 0, 0, 0, 0, 0])));
    expect(ev!.event).to.equal('HardTiersOpened');
    expect(ev!.open_tiers).to.deep.equal([true, false, false, false, false, false, false]);
  });

  it('HardTiersOpened and TiersOpened carry DIFFERENT discriminators — one ladder is not the other', () => {
    expect(
      anchorEventDiscriminator('HardTiersOpened').equals(anchorEventDiscriminator('TiersOpened'))
    ).to.equal(false);
  });

  it('six bools is a short body — refused, not padded', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload('HardTiersOpened', Buffer.from([1, 0, 0, 0, 0, 0])),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('HardTiersOpened');
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

  it('ConfigMigrated (the retired 2026-09-07 migration; devnet holds one) still decodes', () => {
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

/**
 * The sanctions-hold events (audit 2026-09-11, D-20 / F-08).
 *
 * The program has emitted both since Stage F and no off-chain reader could
 * decode either, so the hold existed on chain and nowhere else: no ledger
 * row, no derived column, nothing for an operator tool to aim
 * `lift_sanctions_hold` at, and nothing a held player's results page could
 * say. Pinned here the way every other post-E1 layout is — by hand from the
 * Rust struct's Borsh layout (pubkey 32 raw, i64 8 LE), through the same
 * registry the indexer uses.
 *
 * `programs/blotto_cup/src/events.rs:246-260` is the contract:
 *   SanctionsHoldPlaced { pool: Pubkey, player: Pubkey, placed_at: i64 }
 *   SanctionsHoldLifted { pool: Pubkey, player: Pubkey, lifted_at: i64 }
 */
describe('SanctionsHoldPlaced / SanctionsHoldLifted (Stage F)', () => {
  it('decodes pool, player and the placement time as a decimal string', () => {
    const ev = decodeAnchorEvent(
      payload('SanctionsHoldPlaced', Buffer.concat([key(11), key(12), i64(1_789_000_000n)]))
    );
    expect(ev).to.not.equal(null);
    expect(ev!.event).to.equal('SanctionsHoldPlaced');
    expect(ev!.pool).to.equal(b58(key(11)));
    expect(ev!.player).to.equal(b58(key(12)));
    expect(ev!.placed_at).to.equal('1789000000');
    expect(typeof ev!.placed_at).to.equal('string', 'i64 never becomes a JS number');
  });

  it('decodes the lift, and names its own timestamp field', () => {
    const ev = decodeAnchorEvent(
      payload('SanctionsHoldLifted', Buffer.concat([key(11), key(12), i64(1_789_600_000n)]))
    );
    expect(ev!.event).to.equal('SanctionsHoldLifted');
    expect(ev!.player).to.equal(b58(key(12)));
    expect(ev!.lifted_at).to.equal('1789600000');
    expect(ev!.placed_at, 'the two events are not interchangeable').to.equal(undefined);
  });

  it('the two carry DIFFERENT discriminators — a hold is not a flag', () => {
    const placed = anchorEventDiscriminator('SanctionsHoldPlaced');
    const lifted = anchorEventDiscriminator('SanctionsHoldLifted');
    const flagged = anchorEventDiscriminator('EntryFlagged');
    expect(placed.equals(lifted)).to.equal(false);
    expect(placed.equals(flagged)).to.equal(false);
  });

  it('a body missing the timestamp is layout drift, not a decode', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload('SanctionsHoldPlaced', Buffer.concat([key(1), key(2)])),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('SanctionsHoldPlaced');
  });

  it('a trailing byte is drift too — a hold must never decode half-read', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload('SanctionsHoldLifted', Buffer.concat([key(1), key(2), i64(1n), Buffer.from([0])])),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('SanctionsHoldLifted');
  });
});
