/**
 * Byte-level pins for the D-E4 event layouts added in E1 PR3a —
 * `GoTimerStarted` and `TiersOpened` — built from the Rust structs' Borsh
 * layout by hand (pubkey = 32 raw bytes, i64 = 8 bytes LE, `[bool; 7]` =
 * seven one-byte bools) and pushed through the SAME registry the indexer
 * uses. The cross-language pin against bytes the real program emitted is
 * the indexer's `projection.spec.ts` over the LiteSVM fixture; this suite
 * exists so the layout is checked the moment the decoder is written, and
 * so `Reader.end()`'s drift guard is proven to fire on a short or long body.
 */
import { expect } from 'chai';
import { anchorEventDiscriminator, decodeAnchorEvent } from '../src/events';
import { base58Encode, registerBlottoEventLayouts } from '../src/blotto-events';

before(() => registerBlottoEventLayouts());

function payload(name: string, body: Buffer): Buffer {
  return Buffer.concat([anchorEventDiscriminator(name), body]);
}

describe('GoTimerStarted (D-E4 §11.3, option B)', () => {
  const pool = Buffer.alloc(32, 7);
  // 1_788_929_242 — a real devnet deadline shape; LE i64.
  const deadline = Buffer.alloc(8);
  deadline.writeBigInt64LE(1_788_929_242n);

  it('decodes pool + go_deadline, the deadline as a decimal string', () => {
    const ev = decodeAnchorEvent(payload('GoTimerStarted', Buffer.concat([pool, deadline])));
    expect(ev).to.not.equal(null);
    expect(ev!.event).to.equal('GoTimerStarted');
    expect(ev!.pool).to.equal(base58Encode(new Uint8Array(pool)));
    expect(ev!.go_deadline).to.equal('1788929242');
    expect(typeof ev!.go_deadline).to.equal('string', 'never a float, never a number');
  });

  it('a negative i64 survives (the reader is signed)', () => {
    const neg = Buffer.alloc(8);
    neg.writeBigInt64LE(-1n);
    const ev = decodeAnchorEvent(payload('GoTimerStarted', Buffer.concat([pool, neg])));
    expect(ev!.go_deadline).to.equal('-1');
  });

  it('a body with a stray byte is layout drift, not a decode', () => {
    let undecodable = '';
    const ev = decodeAnchorEvent(
      payload('GoTimerStarted', Buffer.concat([pool, deadline, Buffer.from([0])])),
      (name) => (undecodable = name)
    );
    expect(ev).to.equal(null);
    expect(undecodable).to.equal('GoTimerStarted');
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
