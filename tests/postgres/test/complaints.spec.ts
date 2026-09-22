/**
 * The complaints store against real Postgres (2026-09-19).
 *
 * Three properties migration 0024's comments promise, proven against the
 * schema the migration actually produces rather than against a memory
 * double:
 *
 *   1. APPEND-ONLY. Two rows under one reference coexist; the store offers
 *      no update and no delete, so a status change is a new row and the
 *      history of a complaint cannot be rewritten.
 *   2. THE SIGNED INSTANT SURVIVES VERBATIM, sub-second digits included.
 *      This is migration 0020's lesson (audit A-04 / B-21) applied before it
 *      can bite: a signed instant round-tripped through a TIMESTAMPTZ comes
 *      back truncated to whole seconds, and the signature over it then
 *      verifies for nothing. `signed_at` is TEXT for exactly this reason.
 *   3. AN UNSIGNED SUBMISSION STORES NO ADDRESS. The nullable columns are
 *      nullable on purpose (the 2026-09-15 data-minimisation ruling), and a
 *      NOT NULL slipped onto `wallet` would fail here rather than in
 *      production the first time a locked-out player wrote in.
 */
import { expect } from 'chai';
import type { Pool } from 'pg';

import { base58Encode } from '../../../backend/_shared/src/blotto-events';
import { PgComplaintStore } from '../../../backend/detection/src/complaints-pg';
import { answeredRow, type ComplaintRow } from '../../../backend/detection/src/complaints';
import { CONFIGURED, truncate } from '../src/db';
import { sharedDatabase } from '../src/schema';

function keyFor(fill: number): string {
  const b = new Uint8Array(32);
  b.fill(fill);
  return base58Encode(b);
}

const WALLET = keyFor(21);
const POOL = keyFor(11);
const REF = 'BC-7K2M4QPT';
/** Three sub-second digits, which a TIMESTAMPTZ round trip would lose. */
const SIGNED_AT = '2026-09-19T12:00:00.123Z';

const lodged: ComplaintRow = {
  reference: REF,
  kind: 'lodged',
  wallet: WALLET,
  category: 'decision',
  pool: POOL,
  body: 'My prize was withheld and I would like the decision looked at again.',
  signature: 'c2lnbmF0dXJl',
  signedAt: SIGNED_AT,
  decidedBy: null,
  receivedAt: '2026-09-19T12:00:01.000Z',
};

/** The desk key an operator's row names — base58, 32 bytes. */
const DESK = base58Encode(new Uint8Array(32).fill(5));

(CONFIGURED ? describe : describe.skip)('the complaints store on Postgres', () => {
  let pool: Pool;
  before(async () => {
    ({ pool } = await sharedDatabase());
  });
  beforeEach(async () => {
    await truncate(pool, ['complaints']);
  });

  it('appends a lodge and reads it back field for field', async () => {
    const store = new PgComplaintStore(pool);
    await store.append(lodged);
    const thread = await store.listFor(REF);
    expect(thread).to.have.lengthOf(1);
    expect(thread[0]).to.deep.equal(lodged);
  });

  it('keeps the signed instant verbatim, sub-second digits included (A-04 / B-21)', async () => {
    const store = new PgComplaintStore(pool);
    await store.append(lodged);
    const [row] = await store.listFor(REF);
    expect(row.signedAt).to.equal(SIGNED_AT);
  });

  it('records no address and no signature for an unsigned submission', async () => {
    const store = new PgComplaintStore(pool);
    await store.append({
      ...lodged,
      wallet: null,
      pool: null,
      signature: null,
      signedAt: null,
      category: 'site',
      body: 'The pool page does not load on my phone.',
    });
    const [row] = await store.listFor(REF);
    expect(row.wallet).to.equal(null);
    expect(row.pool).to.equal(null);
    expect(row.signature).to.equal(null);
    expect(row.signedAt).to.equal(null);
  });

  it('is append-only: a status change is a new row, oldest first, and the lodge survives', async () => {
    const store = new PgComplaintStore(pool);
    await store.append(lodged);
    await store.append(
      answeredRow(
        REF,
        'acknowledged',
        { decidedBy: DESK, note: 'Received; a person is looking at this.', category: 'decision' },
        '2026-09-20T09:00:00.000Z'
      )
    );
    await store.append(
      answeredRow(
        REF,
        'resolved',
        { decidedBy: DESK, note: 'Upheld; paid in full.', category: 'decision' },
        '2026-09-25T09:00:00.000Z'
      )
    );
    const thread = await store.listFor(REF);
    expect(thread.map((r) => r.kind)).to.deep.equal(['lodged', 'acknowledged', 'resolved']);
    // The player's own words are still the lodge's, untouched by either
    // operator row — there is no statement here that could have changed them.
    expect(thread[0].body).to.equal(lodged.body);
    // WHOSE key answered survives the round trip. That column is what makes
    // the terms' "answered by someone other than whoever made the original
    // one" checkable against the review log, rather than taken on trust —
    // nothing enforces the difference, so the record is the mechanism.
    expect(thread.map((r) => r.decidedBy)).to.deep.equal([null, DESK, DESK]);
  });

  it('serves one reference and not another', async () => {
    const store = new PgComplaintStore(pool);
    await store.append(lodged);
    await store.append({ ...lodged, reference: 'BC-22222222', body: 'a different complaint' });
    expect(await store.listFor('BC-33333333')).to.deep.equal([]);
    const other = await store.listFor('BC-22222222');
    expect(other).to.have.lengthOf(1);
    expect(other[0].body).to.equal('a different complaint');
  });
});
