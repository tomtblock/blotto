import { expect } from 'chai';
import { configPda, decodeClockUnix, getAccounts, passCollectionPda, poolPda, rpcCall, RpcError } from '../src/solana';
import { fakeFetch } from './fixtures';

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
