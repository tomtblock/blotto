/**
 * The complaints route (2026-09-19) — the way a player contests anything,
 * and the mechanism the terms clause and the published response windows
 * stand on.
 *
 * What is proven here, in the order it matters:
 *
 *   1. THE SIGNATURE POLICY IS THE TABLE. A decision or a payment complaint
 *      without a wallet signature is refused; a site, data-protection or
 *      other complaint is accepted without one, because a player locked out
 *      of their wallet is exactly the player who needs to reach us.
 *   2. A SIGNED SUBMISSION VERIFIES OVER THE SHARED MESSAGE. The bytes are
 *      `complaint-message.ts`'s, the module the browser imports, so the two
 *      ends cannot drift. A tampered field does not verify.
 *   3. AN ABSENT STORE IS `not_configured`, NOT A REFUSAL. "We did not
 *      receive your complaint" and "we refused your complaint" are
 *      different statements, and a player must not be told the second when
 *      the first is true (the C-04 lesson).
 *   4. THE STATUS IS DERIVED FROM AN APPEND-ONLY THREAD, so an operator
 *      cannot quietly rewrite the history of a complaint.
 *   5. THE STATUS ROUTE IS NOT A READ ORACLE for other people's complaints.
 */

import { expect } from 'chai';
import nacl from 'tweetnacl';
import { base58Encode } from '../../packet/src/shared';
import {
  canonicalComplaintAnswerMessage,
  canonicalComplaintMessage,
  COMPLAINT_REFERENCE_PATTERN,
} from '../src/complaint-message';
import {
  COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
  COMPLAINT_CATEGORY_KEYS,
  COMPLAINT_RESOLVE_DAYS,
  COMPLAINT_TEXT_MAX,
  MemoryComplaintStore,
  COMPLAINT_NOTE_MAX,
  COMPLAINT_QUEUE_MAX,
  answeredRow,
  complaintRuleRefusal,
  complaintSignatureRefusal,
  complaintStatus,
  lodgedRow,
  mayReadComplaint,
  signatureRequired,
  type ComplaintCategory,
  type ComplaintRow,
  type ComplaintSubmission,
} from '../src/complaints';
import { handleReviewRoute, type ReviewServerDeps } from '../src/server';

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const AT = new Date(NOW).toISOString();
const REFERENCE = 'BC-7K2M4QPT';
const POOL = base58Encode(new Uint8Array(32).fill(3));

const keys = nacl.sign.keyPair();
const WALLET = base58Encode(keys.publicKey);

function sign(c: {
  reference?: string;
  wallet?: string;
  category?: ComplaintCategory;
  pool?: string | null;
  text?: string;
  signedAt?: string;
}): ComplaintSubmission {
  const body = {
    reference: c.reference ?? REFERENCE,
    wallet: c.wallet ?? WALLET,
    category: c.category ?? ('decision' as ComplaintCategory),
    pool: c.pool ?? null,
    text: c.text ?? 'My prize was withheld and I would like the decision looked at again.',
    signedAt: c.signedAt ?? AT,
  };
  const signature = nacl.sign.detached(canonicalComplaintMessage(body), keys.secretKey);
  return { ...body, signature: Buffer.from(signature).toString('base64') };
}

/** Deps with a live store, and nothing else the complaints routes touch. */
function deps(store = new MemoryComplaintStore()): { deps: ReviewServerDeps; store: MemoryComplaintStore } {
  const d = {
    registry: { version: 1, members: [], updated: '2026-09-19' },
    actions: {} as never,
    log: {} as never,
    complaints: store,
    now: () => NOW,
  } as unknown as ReviewServerDeps;
  return { deps: d, store };
}

const post = (d: ReviewServerDeps, body: unknown) =>
  handleReviewRoute(d, 'POST', '/complaints', body, {});
const get = (d: ReviewServerDeps, query: string) =>
  handleReviewRoute(d, 'GET', `/complaints?${query}`, null, {});

describe('the complaint signature policy', () => {
  it('requires a signature for the two categories that ask us to change an outcome', () => {
    expect(signatureRequired('decision')).to.equal(true);
    expect(signatureRequired('payment')).to.equal(true);
  });

  it('allows the other three unsigned, so a locked-out player can still reach us', () => {
    expect(signatureRequired('site')).to.equal(false);
    expect(signatureRequired('data_protection')).to.equal(false);
    expect(signatureRequired('other')).to.equal(false);
  });

  it('covers exactly the five published categories', () => {
    expect([...COMPLAINT_CATEGORY_KEYS].sort()).to.deep.equal([
      'data_protection',
      'decision',
      'other',
      'payment',
      'site',
    ]);
  });
});

describe('POST /complaints', () => {
  it('accepts a signed decision complaint and records it', async () => {
    const { deps: d, store } = deps();
    const res = await post(d, sign({}));
    expect(res.status).to.equal(204);
    const thread = await store.listFor(REFERENCE);
    expect(thread).to.have.lengthOf(1);
    expect(thread[0].kind).to.equal('lodged');
    expect(thread[0].wallet).to.equal(WALLET);
    expect(thread[0].signature).to.be.a('string');
    expect(thread[0].receivedAt).to.equal(AT);
  });

  it('refuses a decision complaint with no signature, and says which it was', async () => {
    const { deps: d, store } = deps();
    const res = await post(d, {
      reference: REFERENCE,
      category: 'decision',
      text: 'please look again',
    });
    expect(res.status).to.equal(409);
    expect(res.body).to.deep.equal({ error: 'signature_required' });
    expect(await store.listFor(REFERENCE)).to.have.lengthOf(0);
  });

  it('accepts an unsigned site complaint', async () => {
    const { deps: d, store } = deps();
    const res = await post(d, {
      reference: REFERENCE,
      category: 'site',
      text: 'The pool page does not load on my phone.',
    });
    expect(res.status).to.equal(204);
    const [row] = await store.listFor(REFERENCE);
    expect(row.signature).to.equal(null);
  });

  it('records NO address for an unsigned submission, even when one is sent', async () => {
    // Unproven, and personal data we would be holding for nothing — the
    // 2026-09-15 data-minimisation ruling. A player who wants their address
    // on the record signs.
    const { deps: d, store } = deps();
    await post(d, {
      reference: REFERENCE,
      category: 'other',
      wallet: WALLET,
      text: 'a question about my entry',
    });
    const [row] = await store.listFor(REFERENCE);
    expect(row.wallet).to.equal(null);
  });

  it('refuses a tampered signed submission as a bad signature', async () => {
    const { deps: d } = deps();
    const submission = sign({});
    const res = await post(d, { ...submission, text: 'something else entirely' });
    expect(res.status).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthorized', reason: 'signature' });
  });

  it('names a clock problem as a clock problem, not as a bad signature (D-33)', async () => {
    const { deps: d } = deps();
    const stale = new Date(NOW - 60 * 60 * 1000).toISOString();
    const res = await post(d, sign({ signedAt: stale }));
    expect(res.status).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthorized', reason: 'clock_skew' });
  });

  it('refuses a second submission under the same reference', async () => {
    const { deps: d } = deps();
    expect((await post(d, sign({}))).status).to.equal(204);
    const again = await post(d, sign({}));
    expect(again.status).to.equal(409);
    expect(again.body).to.deep.equal({ error: 'already_lodged' });
  });

  it('refuses a malformed reference, category, text and address', async () => {
    const { deps: d } = deps();
    const base = { reference: REFERENCE, category: 'site', text: 'hello' };
    for (const body of [
      { ...base, reference: 'nope' },
      { ...base, reference: 'BC-0OIL1234' }, // the excluded characters
      { ...base, category: 'refund_me_now' },
      { ...base, text: '   ' },
      { ...base, text: 'x'.repeat(COMPLAINT_TEXT_MAX + 1) },
      { ...base, wallet: 'not-base58' },
      { ...base, pool: 'not-base58' },
      null,
    ]) {
      const res = await post(d, body);
      expect(res.status, JSON.stringify(body)).to.equal(400);
    }
  });

  it('carries the pool when the complaint is about one', async () => {
    const { deps: d, store } = deps();
    await post(d, sign({ pool: POOL }));
    const [row] = await store.listFor(REFERENCE);
    expect(row.pool).to.equal(POOL);
  });

  it('answers 503 not_configured with no store, never a refusal', async () => {
    const d = { registry: { version: 1, members: [], updated: 'x' }, now: () => NOW } as unknown as ReviewServerDeps;
    const res = await post(d, sign({}));
    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal({ error: 'not_configured' });
  });

  it('answers 405 for a method the route does not take', async () => {
    const { deps: d } = deps();
    const res = await handleReviewRoute(d, 'DELETE', '/complaints', null, {});
    expect(res.status).to.equal(405);
  });
});

describe('GET /complaints', () => {
  it('serves the derived status to the wallet that signed it', async () => {
    const { deps: d } = deps();
    await post(d, sign({}));
    const res = await get(d, `ref=${REFERENCE}&wallet=${WALLET}`);
    expect(res.status).to.equal(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).to.equal('received');
    expect(body.signed).to.equal(true);
    expect(body.acknowledgeWorkingDays).to.equal(COMPLAINT_ACKNOWLEDGE_WORKING_DAYS);
    expect(body.resolveDays).to.equal(COMPLAINT_RESOLVE_DAYS);
  });

  it('serves an unsigned complaint on its reference alone', async () => {
    const { deps: d } = deps();
    await post(d, { reference: REFERENCE, category: 'site', text: 'a bug' });
    const res = await get(d, `ref=${REFERENCE}`);
    expect(res.status).to.equal(200);
    expect((res.body as Record<string, unknown>).signed).to.equal(false);
  });

  it('is not a read oracle: the same 404 for a wrong wallet and an unknown reference', async () => {
    const { deps: d } = deps();
    await post(d, sign({}));
    const other = base58Encode(new Uint8Array(32).fill(9));
    const wrongWallet = await get(d, `ref=${REFERENCE}&wallet=${other}`);
    const unknownRef = await get(d, 'ref=BC-22222222');
    expect(wrongWallet.status).to.equal(404);
    expect(unknownRef.status).to.equal(404);
    expect(wrongWallet.body).to.deep.equal(unknownRef.body);
  });

  it('refuses to serve a signed complaint to a caller supplying no wallet', async () => {
    const { deps: d } = deps();
    await post(d, sign({}));
    expect((await get(d, `ref=${REFERENCE}`)).status).to.equal(404);
  });

  it('serves an unsigned complaint to a signed-in caller too', async () => {
    // The form sends the signed-in wallet with EVERY lookup, so a player who
    // complained while locked out of their wallet and then got back in was
    // told their own complaint did not exist (found by the 2026-09-19
    // end-to-end walk). The row carries no wallet, so there is nobody to
    // restrict it to, and refusing a caller who supplied one guarded nothing
    // — the identical request without the parameter already served it.
    const { deps: d } = deps();
    await post(d, { reference: REFERENCE, category: 'site', text: 'a bug' });
    const withWallet = await get(d, `ref=${REFERENCE}&wallet=${WALLET}`);
    const without = await get(d, `ref=${REFERENCE}`);
    expect(withWallet.status).to.equal(200);
    expect((withWallet.body as Record<string, unknown>).signed).to.equal(false);
    expect(withWallet.body).to.deep.equal(without.body);
  });

  it('rejects a malformed reference or wallet with a 400', async () => {
    const { deps: d } = deps();
    expect((await get(d, 'ref=nope')).status).to.equal(400);
    expect((await get(d, '')).status).to.equal(400);
    expect((await get(d, `ref=${REFERENCE}&wallet=nope`)).status).to.equal(400);
  });

  it('answers 503 not_configured with no store', async () => {
    const d = { registry: { version: 1, members: [], updated: 'x' } } as unknown as ReviewServerDeps;
    expect((await get(d, `ref=${REFERENCE}`)).status).to.equal(503);
  });
});

describe('the status is derived from an append-only thread', () => {
  const lodged: ComplaintRow = lodgedRow(sign({}), AT);
  const DESK = base58Encode(new Uint8Array(32).fill(5));
  const operatorRow = (kind: 'acknowledged' | 'resolved', body: string, at: string): ComplaintRow =>
    answeredRow(REFERENCE, kind, { decidedBy: DESK, note: body, category: 'decision' }, at);

  it('records WHOSE key answered, which is what makes the terms checkable', () => {
    // The terms undertake that a challenge is answered by someone other than
    // whoever made the original decision "wherever that is possible". The
    // predecessor of that sentence was a RULE, enforced by refusing the
    // upholding reviewer, and a one-member registry made the right it
    // protected unexercisable (audit O24). Nothing enforces the difference
    // now, so the record is the mechanism: the original decision carries its
    // `decidedBy` in the review log, this row carries whose key answered,
    // and comparing the two says whether it was kept.
    const ack = operatorRow('acknowledged', 'Looking at this.', AT);
    expect(ack.decidedBy).to.equal(DESK);
    expect(ack.kind).to.equal('acknowledged');
    // A player's own row has nobody to name, and an operator's row repeats
    // no address: the lodge already holds whatever the complaint proved.
    expect(lodged.decidedBy).to.equal(null);
    expect(ack.wallet).to.equal(null);
    expect(ack.signature).to.equal(null);
  });

  it('reads as received with only the lodge', () => {
    expect(complaintStatus([lodged])?.status).to.equal('received');
    expect(complaintStatus([lodged])?.note).to.equal(null);
  });

  it('follows the latest appended operator row', () => {
    const ack = operatorRow('acknowledged', 'Looking at this.', '2026-09-20T09:00:00.000Z');
    const done = operatorRow('resolved', 'Paid in full.', '2026-09-25T09:00:00.000Z');
    expect(complaintStatus([lodged, ack])?.status).to.equal('acknowledged');
    expect(complaintStatus([lodged, ack])?.note).to.equal('Looking at this.');
    expect(complaintStatus([lodged, ack, done])?.status).to.equal('resolved');
    expect(complaintStatus([lodged, ack, done])?.note).to.equal('Paid in full.');
  });

  it('can be re-opened by appending, never by editing', () => {
    const ack = operatorRow('acknowledged', 'Looking again.', '2026-09-26T09:00:00.000Z');
    const done = operatorRow('resolved', 'Closed.', '2026-09-25T09:00:00.000Z');
    // Appended after the resolution, so the resolution stays on the record.
    const thread = [lodged, done, ack];
    expect(complaintStatus(thread)?.status).to.equal('acknowledged');
    expect(thread.filter((r) => r.kind === 'resolved')).to.have.lengthOf(1);
  });

  it('is null for a thread with no lodge', () => {
    expect(complaintStatus([])).to.equal(null);
    expect(complaintStatus([operatorRow('acknowledged', 'orphan', AT)])).to.equal(null);
  });

  it('keeps the player’s own words as the text', () => {
    expect(complaintStatus([lodged])?.text).to.equal(lodged.body);
  });
});

describe('the rules, as pure functions', () => {
  it('refuses a duplicate reference and a missing required signature', () => {
    const submission = sign({});
    expect(complaintRuleRefusal(submission, [])).to.equal(null);
    expect(complaintRuleRefusal(submission, [lodgedRow(submission, AT)])).to.equal('already_lodged');
    expect(
      complaintRuleRefusal(
        { reference: REFERENCE, category: 'payment', text: 'where is my prize' },
        []
      )
    ).to.equal('signature_required');
  });

  it('passes an unsigned submission in a category that allows one', () => {
    expect(
      complaintRuleRefusal({ reference: REFERENCE, category: 'other', text: 'a question' }, [])
    ).to.equal(null);
  });

  it('checks nothing about the signature when there is none to check', () => {
    expect(
      complaintSignatureRefusal({ reference: REFERENCE, category: 'site', text: 'x' }, NOW)
    ).to.equal(null);
  });

  it('mayReadComplaint serves a signed thread only to its signer', () => {
    const signedThread = [lodgedRow(sign({}), AT)];
    const other = base58Encode(nacl.sign.keyPair().publicKey);
    expect(mayReadComplaint(signedThread, WALLET)).to.equal(true);
    expect(mayReadComplaint(signedThread, other)).to.equal(false);
    expect(mayReadComplaint(signedThread, null)).to.equal(false);
    expect(mayReadComplaint([], null)).to.equal(false);
  });

  it('serves an UNSIGNED thread to whoever holds the reference, wallet or not', () => {
    // The row carries no wallet, so there is nobody to restrict it to. The
    // case this exists for: a player complains while locked out of their
    // wallet, gets back in, and comes back to check the status — the form
    // sends the signed-in wallet with every lookup, and until 2026-09-19
    // that answered 404 on their own complaint (found by the end-to-end
    // walk of the form). Requiring a walletless reader guarded nothing: the
    // identical request without the parameter already read the row.
    const unsignedThread = [lodgedRow({ reference: REFERENCE, category: 'site', text: 'x' }, AT)];
    expect(mayReadComplaint(unsignedThread, null)).to.equal(true);
    expect(mayReadComplaint(unsignedThread, WALLET)).to.equal(true);
    expect(mayReadComplaint(unsignedThread, base58Encode(nacl.sign.keyPair().publicKey))).to.equal(
      true
    );
  });
});

describe('the canonical complaint message', () => {
  it('is distinct from an appeal or a decision, so no signature can cross over', () => {
    const text = new TextDecoder().decode(
      canonicalComplaintMessage({
        reference: REFERENCE,
        wallet: WALLET,
        category: 'decision',
        pool: null,
        text: 'hello',
        signedAt: AT,
      })
    );
    expect(text.startsWith('Blotto Cup complaint\n')).to.equal(true);
    expect(text).to.contain(`reference: ${REFERENCE}\n`);
    // A complaint about no pool is a literal dash, so it cannot collide with
    // a complaint about a pool whose address is absent from the bytes.
    expect(text).to.contain('pool: -\n');
  });

  it('accepts the reference shape the client mints and rejects ambiguous characters', () => {
    expect(COMPLAINT_REFERENCE_PATTERN.test('BC-7K2M4QPT')).to.equal(true);
    for (const bad of ['BC-0K2M4QPT', 'BC-OK2M4QPT', 'BC-1K2M4QPT', 'BC-IK2M4QPT', 'BC-SHORT', 'bc-7k2m4qpt']) {
      expect(COMPLAINT_REFERENCE_PATTERN.test(bad), bad).to.equal(false);
    }
  });
});

/*
 * ── THE OPERATOR'S HALF (2026-09-22) ──────────────────────────────────────
 *
 * Until this, nothing in the repository could append an `acknowledged` or a
 * `resolved` row: the store and the row shape existed and no code wrote
 * them, so a player's status read *received* however promptly a person had
 * actually answered — which made the published five-working-day and
 * thirty-day windows look unkept when they were not. Recorded in
 * PRODUCT-FACTS §9 at the time rather than left to be discovered; this
 * closes it.
 *
 * What is proven here:
 *
 *   1. AN ANSWER IS SIGNED BY A REGISTRY KEY, and the refusal is uniform, so
 *      the route is not a membership oracle for a founder-owned list.
 *   2. THE SIGNATURE IS WHAT MAKES `decidedBy` EVIDENCE. A caller cannot
 *      name a key they cannot sign for.
 *   3. THE TWO CANONICAL MESSAGES CANNOT CROSS OVER — a lodge signature is
 *      not an answer, and an answer is not a lodge.
 *   4. AN ANSWER CANNOT CONJURE A THREAD. A reference with no lodge is a
 *      404, not a row nobody can read.
 *   5. THE QUEUE IS OPERATOR-TOKEN ONLY AND FAIL-CLOSED. It returns players'
 *      own words, so an unset token is a 503 and never an open route.
 */

const DESK = base58Encode(keys.publicKey);

/** An answer, signed by `keys` unless told otherwise. */
function answer(a: {
  reference?: string;
  kind?: 'acknowledged' | 'resolved';
  decidedBy?: string;
  note?: string;
  decidedAt?: string;
  signer?: nacl.SignKeyPair;
}) {
  const body = {
    reference: a.reference ?? REFERENCE,
    kind: a.kind ?? ('acknowledged' as const),
    decidedBy: a.decidedBy ?? DESK,
    note: a.note ?? 'A person has this and will answer it.',
    decidedAt: a.decidedAt ?? AT,
  };
  const signature = nacl.sign.detached(
    canonicalComplaintAnswerMessage({ ...body, signedAt: body.decidedAt }),
    (a.signer ?? keys).secretKey
  );
  return { ...body, signature: Buffer.from(signature).toString('base64') };
}

/** Deps whose registry holds the desk key, and an operator token. */
const TOKEN = 'operator-token-for-the-complaints-queue';
function desk(store = new MemoryComplaintStore()) {
  const d = {
    registry: { version: 1, members: [DESK], updated: '2026-09-22' },
    actions: {} as never,
    log: {} as never,
    complaints: store,
    operatorToken: TOKEN,
    now: () => NOW,
  } as unknown as ReviewServerDeps;
  return { deps: d, store };
}

const answerPost = (d: ReviewServerDeps, body: unknown) =>
  handleReviewRoute(d, 'POST', '/complaints/answer', body, {});
const queue = (d: ReviewServerDeps, query = '', authorization?: string) =>
  handleReviewRoute(d, 'GET', `/complaints/open${query}`, null, { authorization });

describe('POST /complaints/answer', () => {
  it('records an acknowledgement, and the player status follows it', async () => {
    const { deps: d, store } = desk();
    await post(d, sign({}));
    expect((await answerPost(d, answer({}))).status).to.equal(204);
    const thread = await store.listFor(REFERENCE);
    expect(thread.map((r) => r.kind)).to.deep.equal(['lodged', 'acknowledged']);
    expect(complaintStatus(thread)?.status).to.equal('acknowledged');
    expect(complaintStatus(thread)?.note).to.equal('A person has this and will answer it.');
  });

  it('names WHOSE key answered, and proves it with a signature', async () => {
    // The point of the whole route: `decidedBy` has to be evidence for the
    // terms' "answered by someone other than whoever made the original one"
    // to be checkable against the decision log at all.
    const { deps: d, store } = desk();
    await post(d, sign({}));
    await answerPost(d, answer({ kind: 'resolved', note: 'Upheld; paid in full.' }));
    const [, row] = await store.listFor(REFERENCE);
    expect(row.decidedBy).to.equal(DESK);
    expect(row.signature).to.be.a('string');
    expect(row.signedAt).to.equal(AT);
    // The lodge's own category and pool are carried, never taken from the
    // caller — who could otherwise mislabel somebody else's complaint.
    expect(row.category).to.equal('decision');
    // And no player address is repeated onto the operator's row.
    expect(row.wallet).to.equal(null);
  });

  it('refuses a key that is not in the registry, and says nothing about why', async () => {
    const { deps: d, store } = desk();
    await post(d, sign({}));
    const stranger = nacl.sign.keyPair();
    const res = await answerPost(
      d,
      answer({ decidedBy: base58Encode(stranger.publicKey), signer: stranger })
    );
    expect(res.status).to.equal(401);
    // Identical to a bad signature and to a stale one: not an oracle for the
    // founder-owned member list.
    expect(res.body).to.deep.equal({ error: 'unauthorized' });
    expect(await store.listFor(REFERENCE)).to.have.lengthOf(1);
  });

  it('refuses a caller who NAMES a registry key they cannot sign for', async () => {
    const { deps: d } = desk();
    await post(d, sign({}));
    const impostor = nacl.sign.keyPair();
    const res = await answerPost(d, answer({ decidedBy: DESK, signer: impostor }));
    expect(res.status).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthorized' });
  });

  it('refuses a stale answer, uniformly with the rest', async () => {
    const { deps: d } = desk();
    await post(d, sign({}));
    const stale = new Date(NOW - 60 * 60 * 1000).toISOString();
    const res = await answerPost(d, answer({ decidedAt: stale }));
    expect(res.status).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthorized' });
  });

  it('cannot be forged from a LODGE signature, and vice versa', async () => {
    // Domain separation, asserted rather than assumed. The two messages have
    // different headers, so neither signature verifies as the other.
    const { deps: d } = desk();
    await post(d, sign({}));
    const lodge = sign({});
    const crossed = await answerPost(d, {
      ...answer({}),
      signature: lodge.signature,
    });
    expect(crossed.status).to.equal(401);

    const a = answer({});
    const crossedBack = await post(d, { ...sign({}), signature: a.signature });
    expect(crossedBack.status).to.equal(401);
  });

  it('cannot conjure a thread: a reference with no lodge is a 404', async () => {
    const { deps: d, store } = desk();
    const res = await answerPost(d, answer({}));
    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({ error: 'not_found' });
    // Nothing written. An answer with no lodge would be a row whose status
    // `complaintStatus` reports as null — unreadable by anybody.
    expect(await store.listFor(REFERENCE)).to.have.lengthOf(0);
  });

  it('refuses a replayed answer, and tells the truth about why', async () => {
    const { deps: d, store } = desk();
    await post(d, sign({}));
    const a = answer({});
    expect((await answerPost(d, a)).status).to.equal(204);
    const again = await answerPost(d, a);
    expect(again.status).to.equal(409);
    expect(again.body).to.deep.equal({ error: 'already_recorded' });
    expect(await store.listFor(REFERENCE)).to.have.lengthOf(2);
  });

  it('refuses a malformed answer with a 400, before any signature work', async () => {
    const { deps: d } = desk();
    await post(d, sign({}));
    const good = answer({});
    for (const body of [
      { ...good, reference: 'nope' },
      { ...good, kind: 'closed' },
      { ...good, decidedBy: 'not-base58-!' },
      { ...good, note: '' },
      { ...good, note: 'x'.repeat(COMPLAINT_NOTE_MAX + 1) },
      { ...good, decidedAt: 42 },
      { ...good, signature: 7 },
      {},
    ]) {
      expect((await answerPost(d, body)).status, JSON.stringify(body).slice(0, 40)).to.equal(400);
    }
  });

  it('answers 503 with no store, never a refusal', async () => {
    const d = { registry: { version: 1, members: [DESK], updated: 'x' } } as unknown as ReviewServerDeps;
    expect((await answerPost(d, answer({}))).status).to.equal(503);
  });

  it('is 405 on a method it does not serve', async () => {
    const { deps: d } = desk();
    expect((await handleReviewRoute(d, 'GET', '/complaints/answer', null, {})).status).to.equal(405);
  });
});

describe('GET /complaints/open — the desk queue', () => {
  it('serves the open queue to the operator token and to nobody else', async () => {
    const { deps: d } = desk();
    await post(d, sign({}));
    expect((await queue(d)).status, 'no token').to.equal(401);
    expect((await queue(d, '', 'not-the-token')).status, 'wrong token').to.equal(401);
    const res = await queue(d, '', TOKEN);
    expect(res.status).to.equal(200);
    const body = res.body as { open: Array<Record<string, unknown>>; resolveDays: number };
    expect(body.open).to.have.lengthOf(1);
    expect(body.open[0].reference).to.equal(REFERENCE);
    expect(body.open[0].signed).to.equal(true);
    expect(body.open[0].text).to.contain('withheld');
    // The published windows travel with the queue, so the desk page never
    // types a figure either.
    expect(body.resolveDays).to.equal(COMPLAINT_RESOLVE_DAYS);
  });

  it('is FAIL-CLOSED: an unset token is a 503, never an open route', async () => {
    // This queue is the most sensitive text the product holds — players'
    // own words about their own problems. It must never be readable by an
    // unauthenticated probe because somebody forgot to set a variable.
    const { deps: d } = desk();
    await post(d, sign({}));
    const res = await queue({ ...d, operatorToken: undefined } as ReviewServerDeps, '', TOKEN);
    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal({ error: 'not_configured' });
  });

  it('drops a complaint once it is RESOLVED, and keeps an acknowledged one', async () => {
    const { deps: d } = desk();
    await post(d, sign({}));
    await answerPost(d, answer({ kind: 'acknowledged' }));
    const still = (await queue(d, '', TOKEN)).body as { open: unknown[] };
    expect(still.open, 'acknowledged is still the desk problem').to.have.lengthOf(1);

    await answerPost(d, answer({ kind: 'resolved', note: 'Answered in full.' }));
    const gone = (await queue(d, '', TOKEN)).body as { open: unknown[] };
    expect(gone.open, 'resolved is not').to.have.lengthOf(0);
  });

  it('bounds the limit, because the rows are personal data', async () => {
    const { deps: d } = desk();
    for (const q of ['?limit=0', `?limit=${COMPLAINT_QUEUE_MAX + 1}`, '?limit=all', '?limit=1.5']) {
      expect((await queue(d, q, TOKEN)).status, q).to.equal(400);
    }
    expect((await queue(d, `?limit=${COMPLAINT_QUEUE_MAX}`, TOKEN)).status).to.equal(200);
  });

  it('is 405 on a method it does not serve', async () => {
    const { deps: d } = desk();
    expect(
      (await handleReviewRoute(d, 'POST', '/complaints/open', {}, { authorization: TOKEN })).status
    ).to.equal(405);
  });
});
