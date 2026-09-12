/**
 * C11: IrysPublisher over a fake uploader — the bundle goes up as JSON
 * with the addressing tags, and the returned URI is the permanent gateway
 * address of the transaction id.
 */
import { expect } from 'chai';
import { IrysPublisher, type IrysUploader } from '../src';
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
