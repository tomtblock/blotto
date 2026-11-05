import { expect } from 'chai';
import { CONFIG_OFFSETS, CONFIG_SPACE } from '../../_shared/src/config-account';
import { readChain } from '../src/collect';
import {
  configPda,
  decodeClockUnix,
  getAccounts,
  getPoolTypes,
  passCollectionPda,
  poolPda,
  POOL_TYPE_DISCRIMINATOR,
  PROGRAM_ID,
  rpcCall,
  RpcError,
} from '../src/solana';
import { fakeFetch, poolBytes, poolTypeBytes, T0 } from './fixtures';

describe('PDA derivation, against addresses the live program created', () => {
  // These are not this package's output: they are the accounts the program
  // itself created on devnet (indexer /pools, and the pass collections the
  // daemon created on 2026-10-15 after R22 shipped).
  it('derives pool PDAs', () => {
    expect(poolPda(100n)).to.equal('5wMRdr4bdz9VM5PtJEhKfukr14VhvZpHAdqCF1Vn4aQn');
    expect(poolPda(101n)).to.equal('BXC37YLvLn5aEnUsLzRwzxdogfF9EKs9HbDDosqtjjhd');
  });

  it('derives pass-collection PDAs from the pool PDA', () => {
    expect(passCollectionPda(poolPda(100n))).to.equal('7o5Cu1rULoQwt7tkDf24EiH1XUNb6MryNCDPAEeLvRY2');
    expect(passCollectionPda(poolPda(101n))).to.equal('GP3fgWmh9ZyyrS75kjzvn1xEd2fWmRuNCag3VXB4N6tx');
  });

  it('derives a Config PDA distinct from every pool PDA', () => {
    expect(configPda()).to.be.a('string').and.not.equal(poolPda(0n));
  });
});

describe('the JSON-RPC client', () => {
  it('keeps the HTTP status and the body of a refusal, so a cause can be read off it', async () => {
    const body = '{"jsonrpc":"2.0","error":{"code":-32429,"message":"max usage reached"},"id":1}';
    const { fetchImpl } = fakeFetch([[429, body]]);
    try {
      await rpcCall('https://rpc.example', 'getSlot', [], { fetchImpl });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).to.be.instanceOf(RpcError);
      expect((e as RpcError).status).to.equal(429);
      expect((e as RpcError).body).to.equal(body);
    }
  });

  it('decodes getMultipleAccounts in request order, missing accounts as null', async () => {
    const data = Buffer.from([1, 2, 3]).toString('base64');
    const { fetchImpl, calls } = fakeFetch([
      [200, { jsonrpc: '2.0', id: 1, result: { value: [{ lamports: 5, owner: 'o', data: [data, 'base64'] }, null] } }],
    ]);
    const out = await getAccounts('https://rpc.example', ['a', 'b'], { fetchImpl });
    expect(out[0]?.lamports).to.equal(5n);
    expect([...(out[0]?.data ?? [])]).to.deep.equal([1, 2, 3]);
    expect(out[1]).to.equal(null);
    expect((calls[0].body as { method: string }).method).to.equal('getMultipleAccounts');
  });

  it('reads Clock.unix_timestamp at offset 32', () => {
    const d = new Uint8Array(40);
    new DataView(d.buffer).setBigInt64(32, 1_792_030_114n, true);
    expect(decodeClockUnix(d)).to.equal(1_792_030_114n);
  });
});

describe('the pool-type read (D-E19)', () => {
  const b64 = (d: Uint8Array) => Buffer.from(d).toString('base64');
  const acct = (d: Uint8Array, lamports = 1) => ({ lamports, owner: PROGRAM_ID, data: [b64(d), 'base64'] });

  it('asks getProgramAccounts for the program’s 57-byte accounts and keeps only PoolTypes', async () => {
    const notAType = poolTypeBytes({ mode: 0, capacity: 32 });
    notAType.set(new Uint8Array(8).fill(9), 0);
    const { fetchImpl, calls } = fakeFetch([
      [
        200,
        {
          jsonrpc: '2.0',
          id: 1,
          result: [
            { pubkey: 'TypeA', account: acct(poolTypeBytes({ mode: 1, capacity: 16, activePool: 7n })) },
            { pubkey: 'NotAType', account: acct(notAType) },
          ],
        },
      ],
    ]);
    const types = await getPoolTypes('https://rpc.example', { fetchImpl });
    const req = calls[0].body as { method: string; params: unknown[] };
    expect(req.method).to.equal('getProgramAccounts');
    expect(req.params[0]).to.equal(PROGRAM_ID);
    expect(req.params[1]).to.deep.include({ filters: [{ dataSize: 57 }] });
    expect(types).to.have.length(1);
    expect(types[0]).to.include({ address: 'TypeA', mode: 1, tier: 0, capacity: 16, minSeats: 10, paidPlaces: 4 });
    expect(types[0].activePool).to.equal(7n);
  });

  it('the discriminator is sha256("account:PoolType")[..8]', () => {
    expect(Buffer.from(POOL_TYPE_DISCRIMINATOR).toString('hex')).to.equal('23bee6af4b720965');
  });

  /** A current (605-byte) Config: tier 0 open on both ladders, a legacy slot, the count. */
  function configBytes(enabledPoolTypes: number, legacyEasyActive = 0n): Uint8Array {
    const d = new Uint8Array(CONFIG_SPACE);
    const dv = new DataView(d.buffer);
    d[CONFIG_OFFSETS.openTiers] = 1;
    d[CONFIG_OFFSETS.hardOpenTiers] = 1;
    dv.setBigUint64(CONFIG_OFFSETS.activePoolByTier, legacyEasyActive, true);
    dv.setUint16(CONFIG_OFFSETS.enabledPoolTypes, enabledPoolTypes, true);
    return d;
  }
  const clock = (() => {
    const d = new Uint8Array(40);
    new DataView(d.buffer).setBigInt64(32, T0, true);
    return d;
  })();

  it('reads the live pools from the pool types’ slots, and from a slot a pre-Ladder pool still holds on Config', async () => {
    const { fetchImpl, calls } = fakeFetch([
      [200, { jsonrpc: '2.0', id: 1, result: { value: [acct(configBytes(2, 77n)), acct(clock)] } }],
      [
        200,
        {
          jsonrpc: '2.0',
          id: 1,
          result: [
            { pubkey: 'T8', account: acct(poolTypeBytes({ mode: 0, capacity: 8, activePool: 100n })) },
            { pubkey: 'T64', account: acct(poolTypeBytes({ mode: 1, capacity: 64 })) },
          ],
        },
      ],
      [
        200,
        {
          jsonrpc: '2.0',
          id: 1,
          result: {
            value: [
              acct(poolBytes({ id: 100n, openedAt: T0, fillDeadline: T0 + 100n, capacity: 8 })),
              acct(new Uint8Array(0), 500_890_880),
              acct(new Uint8Array(1)),
              acct(poolBytes({ id: 77n, openedAt: T0, fillDeadline: T0 + 100n, state: 'Sealed' })),
              acct(new Uint8Array(0), 4_000_890_880),
              acct(new Uint8Array(1)),
            ],
          },
        },
      ],
    ]);
    const snap = await readChain('https://rpc.example', 1000, fetchImpl);
    expect(snap.nowUnix).to.equal(T0);
    expect(snap.poolTypes.map((t) => t.capacity)).to.deep.equal([8, 64]);
    expect(snap.pools.map((p) => p.pool.id)).to.deep.equal([100n, 77n]);
    expect(snap.pools[0].pool.capacity).to.equal(8);
    expect(snap.pools[0].address).to.equal(poolPda(100n));
    const poolsCall = calls[2].body as { params: [string[]] };
    expect(poolsCall.params[0]).to.have.length(6);
  });

  it('refuses a pool-type list that does not hold every type Config counts as enabled', async () => {
    const { fetchImpl } = fakeFetch([
      [200, { jsonrpc: '2.0', id: 1, result: { value: [acct(configBytes(3)), acct(clock)] } }],
      [200, { jsonrpc: '2.0', id: 1, result: [{ pubkey: 'T8', account: acct(poolTypeBytes({ mode: 0, capacity: 8 })) }] }],
    ]);
    let error: Error | null = null;
    try {
      await readChain('https://rpc.example', 1000, fetchImpl);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.equal('read 1 enabled pool types but Config counts 3');
  });
});
