import { expect } from 'chai';
import {
  POOL_LADDER_OFFSETS,
  POOL_MODE_OFFSET,
  POOL_OFFSETS,
  POOL_SPACE,
  POOL_SPACE_V2,
  POOL_SPACE_V3,
  decodePoolHead,
  preLadderTable,
} from '../src/pool-account';
import {
  POOL_TYPE_OFFSETS,
  POOL_TYPE_SPACE,
  compareAddressBytes,
  decodePoolTypeAccount,
  poolTypeSeeds,
} from '../src/pool-type-account';

/** A Pool account with every head field set to a distinct value at its offset. */
function poolBytes(space = POOL_SPACE, state = 2, mode = 1): Uint8Array {
  const d = new Uint8Array(space);
  const dv = new DataView(d.buffer);
  dv.setBigUint64(POOL_OFFSETS.id, 101n, true);
  d[POOL_OFFSETS.tier] = 3;
  dv.setBigUint64(POOL_OFFSETS.entryLamports, 100_000_000n, true);
  dv.setBigUint64(POOL_OFFSETS.potLamports, 4_000_000_000n, true);
  dv.setUint16(POOL_OFFSETS.entrants, 41, true);
  dv.setBigInt64(POOL_OFFSETS.openedAt, 1_792_030_000n, true);
  dv.setBigInt64(POOL_OFFSETS.fillDeadline, 1_792_053_991n, true);
  d[POOL_OFFSETS.state] = state;
  dv.setUint16(POOL_LADDER_OFFSETS.minSeats, 20, true);
  if (space > POOL_MODE_OFFSET) d[POOL_MODE_OFFSET] = mode;
  if (space === POOL_SPACE) {
    dv.setUint16(POOL_LADDER_OFFSETS.capacity, 32, true);
    d[POOL_LADDER_OFFSETS.paidPlaces] = 8;
    [8, 4, 2, 2, 1, 1, 1, 1].forEach((m, i) => (d[POOL_LADDER_OFFSETS.prizeTable + i] = m));
  }
  return d;
}

describe('pool-account: the shared Pool head layout', () => {
  it('reads each head field from its own offset', () => {
    const p = decodePoolHead(poolBytes());
    expect(p).to.deep.equal({
      id: 101n,
      tier: 3,
      entryLamports: 100_000_000n,
      potLamports: 4_000_000_000n,
      entrants: 41,
      openedAt: 1_792_030_000n,
      fillDeadline: 1_792_053_991n,
      state: 'Scored',
      mode: 1,
      minSeats: 20,
      capacity: 32,
      paidPlaces: 8,
      prizeTable: [8, 4, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      ladderPresent: true,
    });
  });

  it('the Ladder tail follows mode: capacity 2, paid_places 1, prize_table 16 — 869 in all', () => {
    expect(POOL_LADDER_OFFSETS.capacity).to.equal(POOL_MODE_OFFSET + 1);
    expect(POOL_LADDER_OFFSETS.paidPlaces).to.equal(POOL_LADDER_OFFSETS.capacity + 2);
    expect(POOL_LADDER_OFFSETS.prizeTable).to.equal(POOL_LADDER_OFFSETS.paidPlaces + 1);
    expect(POOL_LADDER_OFFSETS.prizeTable + 16).to.equal(POOL_SPACE);
  });

  it('reads a pre-Ladder pool (850 bytes) the way migrate_pool will write it', () => {
    const p = decodePoolHead(poolBytes(POOL_SPACE_V3));
    expect(p.ladderPresent).to.equal(false);
    expect(p.capacity).to.equal(64);
    expect(p.paidPlaces).to.equal(1);
    expect(p.prizeTable[0]).to.equal(40); // 4 SOL at 0.1 SOL
    expect(p.prizeTable.slice(1).every((m) => m === 0)).to.equal(true);
  });

  it('a pre-Ladder prize pool that is not a whole number of entries carries no table', () => {
    // Devnet pool #1: 5.12 SOL at 0.1 SOL.
    expect(preLadderTable(100_000_000n, 5_120_000_000n).paidPlaces).to.equal(0);
    expect(preLadderTable(100_000_000n, 4_000_000_000n)).to.deep.equal({
      paidPlaces: 1,
      prizeTable: [40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  });

  it('offsets are the running sum of the Borsh field sizes after the 8-byte discriminator', () => {
    // disc 8 | id 8 | tier 1 | entry 8 | pot 8 | entrants 2 | opened_at 8 | fill_deadline 8 | state
    const sizes: [keyof typeof POOL_OFFSETS, number][] = [
      ['id', 8],
      ['tier', 1],
      ['entryLamports', 8],
      ['potLamports', 8],
      ['entrants', 2],
      ['openedAt', 8],
      ['fillDeadline', 8],
      ['state', 1],
    ];
    let at = 8;
    for (const [name, size] of sizes) {
      expect(POOL_OFFSETS[name], name).to.equal(at);
      at += size;
    }
  });

  it('reads a pre-Phase-B pool (849 bytes) as easy', () => {
    expect(decodePoolHead(poolBytes(POOL_SPACE_V2)).mode).to.equal(0);
  });

  it('refuses an account of any other size, by name', () => {
    expect(() => decodePoolHead(new Uint8Array(228), 'pool 7')).to.throw(/pool 7 account is 228 bytes/);
  });

  it('refuses a state byte that is not a PoolState', () => {
    expect(() => decodePoolHead(poolBytes(POOL_SPACE, 6))).to.throw(/state byte 6/);
  });
});

describe('pool-type-account: the shared PoolType layout (D-E19)', () => {
  it('offsets are the running sum of the Borsh field sizes — 57 in all', () => {
    const sizes: [keyof typeof POOL_TYPE_OFFSETS, number][] = [
      ['mode', 1],
      ['tier', 1],
      ['capacity', 2],
      ['minSeats', 2],
      ['paidPlaces', 1],
      ['prizeTable', 16],
      ['potLamports', 8],
      ['enabled', 1],
      ['activePool', 8],
      ['nextOpenAt', 8],
      ['bump', 1],
    ];
    let at = 8;
    for (const [name, size] of sizes) {
      expect(POOL_TYPE_OFFSETS[name], name).to.equal(at);
      at += size;
    }
    expect(at).to.equal(POOL_TYPE_SPACE);
  });

  it('reads each field from its own offset', () => {
    const d = new Uint8Array(POOL_TYPE_SPACE);
    const dv = new DataView(d.buffer);
    const O = POOL_TYPE_OFFSETS;
    d[O.mode] = 1;
    d[O.tier] = 0;
    dv.setUint16(O.capacity, 16, true);
    dv.setUint16(O.minSeats, 10, true);
    d[O.paidPlaces] = 4;
    [5, 3, 1, 1].forEach((m, i) => (d[O.prizeTable + i] = m));
    dv.setBigUint64(O.potLamports, 1_000_000_000n, true);
    d[O.enabled] = 1;
    dv.setBigUint64(O.activePool, 190n, true);
    dv.setBigInt64(O.nextOpenAt, 1_793_000_000n, true);
    d[O.bump] = 254;
    expect(decodePoolTypeAccount(d)).to.deep.equal({
      mode: 1,
      tier: 0,
      capacity: 16,
      minSeats: 10,
      paidPlaces: 4,
      prizeTable: [5, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      potLamports: 1_000_000_000n,
      enabled: true,
      activePool: 190n,
      nextOpenAt: 1_793_000_000n,
      bump: 254,
    });
  });

  it('refuses an account of any other size', () => {
    expect(() => decodePoolTypeAccount(new Uint8Array(869))).to.throw(/869 bytes/);
  });

  it('builds the PDA seeds and refuses coordinates the program refuses', () => {
    const seeds = poolTypeSeeds(1, 0, 64);
    expect(new TextDecoder().decode(seeds[0])).to.equal('ptype');
    expect([...seeds[1], ...seeds[2], ...seeds[3]]).to.deep.equal([1, 0, 64, 0]);
    expect(() => poolTypeSeeds(2, 0, 8)).to.throw(/mode/);
    expect(() => poolTypeSeeds(0, 7, 8)).to.throw(/tier/);
    expect(() => poolTypeSeeds(0, 0, 12)).to.throw(/12 players/);
  });

  it('orders addresses by their raw bytes, as the program compares Pubkeys', () => {
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(1);
    b[31] = 2;
    expect(compareAddressBytes(a, b)).to.be.lessThan(0);
    expect(compareAddressBytes(b, a)).to.be.greaterThan(0);
    expect(compareAddressBytes(a, a)).to.equal(0);
  });
});
