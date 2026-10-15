import { expect } from 'chai';
import {
  POOL_MODE_OFFSET,
  POOL_OFFSETS,
  POOL_SPACE,
  POOL_SPACE_V2,
  decodePoolHead,
} from '../src/pool-account';

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
  if (space > POOL_MODE_OFFSET) d[POOL_MODE_OFFSET] = mode;
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
