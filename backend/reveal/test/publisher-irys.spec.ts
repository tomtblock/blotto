/**
 * C11: IrysPublisher over a fake uploader — the bundle goes up as JSON
 * with the addressing tags, and the returned URI is the permanent gateway
 * address of the transaction id.
 *
 * Plus the cluster cross-check (audit 2026-09-11, E-12): which Irys network
 * the daemon publishes to is decided by `BLOTTO_CLUSTER`, and a contradicting
 * `IRYS_NETWORK` refuses to start rather than quietly winning.
 */
import { expect } from 'chai';
import { IrysPublisher, irysNetworkFor, type IrysUploader } from '../src';
import type { RevealBundle } from '../src';

const bundle: RevealBundle = {
  version: 2,
  pool_id: '42',
  secret: 'aa'.repeat(32),
  entry_lamports: '100000000',
  // One entry in the version-2 shape: battles, salt and the commitment —
  // no timings and no device hash (audit B-31).
  entries: [
    {
      player: '1'.repeat(44),
      index: 0,
      battles: 'cc'.repeat(35),
      salt: 'dd'.repeat(32),
      battles_hash: 'ee'.repeat(32),
      status: 'ok',
    },
  ],
  results: [],
  payouts: [],
  results_root: 'bb'.repeat(32),
  scored_as_all_losses: [],
};

describe('IrysPublisher (C11)', () => {
  it('uploads the bundle JSON with addressing tags and returns the gateway URI', async () => {
    const uploads: { data: string; opts?: { tags?: { name: string; value: string }[] } }[] = [];
    const uploader: IrysUploader = {
      async upload(data, opts) {
        uploads.push({ data, opts });
        return { id: 'TX123' };
      },
    };
    const uri = await new IrysPublisher(uploader).publish(bundle);
    expect(uri).to.equal('https://gateway.irys.xyz/TX123');
    expect(uploads.length).to.equal(1);
    // Byte-exact round trip: what a verifier fetches parses back to the bundle.
    expect(JSON.parse(uploads[0].data)).to.deep.equal(JSON.parse(JSON.stringify(bundle)));
    // What goes to permanent storage names neither dropped field (B-31).
    expect(uploads[0].data).to.not.match(/device_hash|timings_ms/);
    const tags = Object.fromEntries(uploads[0].opts!.tags!.map((t) => [t.name, t.value]));
    expect(tags['Content-Type']).to.equal('application/json');
    expect(tags['Blotto-Pool']).to.equal('42');
    expect(tags['Blotto-Bundle-Version']).to.equal('2');
  });

  it('an id-less answer is an error, never a broken URI', async () => {
    const publisher = new IrysPublisher({
      async upload() {
        return { id: '' };
      },
    });
    try {
      await publisher.publish(bundle);
      expect.fail('empty id must throw');
    } catch (e) {
      expect(String(e)).to.contain('no transaction id');
    }
  });
});

describe('irysNetworkFor — one cluster selector, not two (E-12)', () => {
  it('follows BLOTTO_CLUSTER when IRYS_NETWORK is unset, blank or whitespace', () => {
    expect(irysNetworkFor({})).to.equal('devnet');
    expect(irysNetworkFor({ BLOTTO_CLUSTER: 'devnet' })).to.equal('devnet');
    // The case that was silently wrong before: mainnet with no IRYS_NETWORK
    // published to devnet storage. It must now follow the cluster.
    expect(irysNetworkFor({ BLOTTO_CLUSTER: 'mainnet' })).to.equal('mainnet');
    expect(irysNetworkFor({ BLOTTO_CLUSTER: 'mainnet', IRYS_NETWORK: '' })).to.equal('mainnet');
    expect(irysNetworkFor({ BLOTTO_CLUSTER: 'mainnet', IRYS_NETWORK: '  ' })).to.equal('mainnet');
  });

  it('accepts an IRYS_NETWORK that agrees with the cluster', () => {
    expect(irysNetworkFor({ BLOTTO_CLUSTER: 'mainnet', IRYS_NETWORK: 'mainnet' })).to.equal(
      'mainnet'
    );
    expect(irysNetworkFor({ BLOTTO_CLUSTER: 'devnet', IRYS_NETWORK: 'devnet' })).to.equal('devnet');
    // Case and surrounding space are a typo, not a different network.
    expect(irysNetworkFor({ BLOTTO_CLUSTER: 'mainnet', IRYS_NETWORK: ' Mainnet ' })).to.equal(
      'mainnet'
    );
  });

  it('refuses a mismatch in either direction, naming both variables', () => {
    expect(() => irysNetworkFor({ BLOTTO_CLUSTER: 'mainnet', IRYS_NETWORK: 'devnet' }))
      .to.throw(/IRYS_NETWORK is "devnet" but BLOTTO_CLUSTER is "mainnet"/);
    expect(() => irysNetworkFor({ BLOTTO_CLUSTER: 'devnet', IRYS_NETWORK: 'mainnet' }))
      .to.throw(/IRYS_NETWORK is "mainnet" but BLOTTO_CLUSTER is "devnet"/);
  });

  it('refuses a value that is neither network, instead of meaning devnet', () => {
    // `mainnet-beta` is the Solana spelling and the likeliest mistake: under
    // the old `=== 'mainnet'` test it selected devnet without a word.
    for (const bad of ['mainnet-beta', 'main', 'testnet', 'yes', '1']) {
      expect(() => irysNetworkFor({ BLOTTO_CLUSTER: 'mainnet', IRYS_NETWORK: bad }))
        .to.throw(/IRYS_NETWORK must be "devnet" or "mainnet"/);
    }
  });

  it('refuses an unreadable BLOTTO_CLUSTER rather than guessing', () => {
    expect(() => irysNetworkFor({ BLOTTO_CLUSTER: 'mainnet-beta', IRYS_NETWORK: 'mainnet' }))
      .to.throw(/BLOTTO_CLUSTER must be "devnet" or "mainnet"/);
  });
});
