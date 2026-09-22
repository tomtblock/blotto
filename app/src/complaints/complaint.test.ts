/*
 * The complaints client (2026-09-19) — the transport, pure over `fetch` and
 * the signer, so every ending is asserted without a browser or a service.
 *
 * These replace `app/src/app/pools/[pool]/results/appeal.test.ts`, which
 * went with the module it tested when the named-reviewer apparatus came out
 * of the product. What they pin is the property that mattered there and
 * matters more here: an absent or unreachable service is NEVER reported as a
 * refusal, because this is the last route a player has and telling them
 * their complaint was refused when it never arrived is the worst available
 * failure.
 */

import { describe, expect, it, vi } from 'vitest';
import { canonicalComplaintMessage } from '@blotto/detection/complaint-message';
import {
  COMPLAINT_TEXT_MAX,
  complaintTextValid,
  fetchComplaintStatus,
  mintReference,
  signatureRequired,
  submitComplaint,
} from './complaint';

const API = 'https://review.example';
const WALLET = 'So11111111111111111111111111111111111111112';
const REFERENCE = 'BC-7K2M4QPT';

const signer = { signMessage: async (m: Uint8Array) => new Uint8Array(64).fill(m.length % 251) };

const answer = (status: number, body: unknown = null) =>
  vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch;

describe('mintReference', () => {
  it('produces the shape the service accepts', () => {
    for (let i = 0; i < 50; i++) expect(mintReference()).toMatch(/^BC-[2-9A-HJ-NP-Z]{8}$/);
  });

  it('never emits a character that can be misread down a telephone', () => {
    // 0/O and 1/I are out of the alphabet on purpose: a reference is read
    // aloud and typed back in.
    const many = Array.from({ length: 200 }, () => mintReference()).join('');
    expect(many).not.toMatch(/[01OI]/);
  });

  it('is deterministic given its randomness, so a test can pin one', () => {
    const fixed = (n: number) => new Uint8Array(n).fill(0);
    expect(mintReference(fixed)).toBe('BC-22222222');
  });
});

describe('complaintTextValid', () => {
  it('needs something, and not more than the published length', () => {
    expect(complaintTextValid('')).toBe(false);
    expect(complaintTextValid('   ')).toBe(false);
    expect(complaintTextValid('something happened')).toBe(true);
    expect(complaintTextValid('x'.repeat(COMPLAINT_TEXT_MAX))).toBe(true);
    expect(complaintTextValid('x'.repeat(COMPLAINT_TEXT_MAX + 1))).toBe(false);
  });
});

describe('submitComplaint', () => {
  it('signs a decision complaint over the shared canonical bytes', async () => {
    const seen: { body?: string } = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.body = String(init?.body);
      return { status: 204, ok: true, json: async () => null };
    }) as unknown as typeof fetch;

    const result = await submitComplaint(
      API,
      { category: 'decision', text: 'Please look again.', pool: null },
      { wallet: WALLET, signer },
      fetchImpl,
      REFERENCE
    );

    expect(result.outcome).toBe('submitted');
    expect(result.reference).toBe(REFERENCE);
    const body = JSON.parse(seen.body ?? '{}');
    expect(body.reference).toBe(REFERENCE);
    expect(body.wallet).toBe(WALLET);
    expect(body.signature).toEqual(expect.any(String));
    // The bytes the signer was handed are the module's, not this file's idea
    // of them: the signature is 64 bytes filled with (length % 251), so the
    // fill proves which message was signed.
    const expected = canonicalComplaintMessage({
      reference: REFERENCE,
      wallet: WALLET,
      category: 'decision',
      pool: null,
      text: 'Please look again.',
      signedAt: body.signedAt,
    });
    expect(atob(body.signature).charCodeAt(0)).toBe(expected.length % 251);
  });

  it('sends a site complaint unsigned, with no wallet and no signature', async () => {
    const seen: { body?: string } = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.body = String(init?.body);
      return { status: 204, ok: true, json: async () => null };
    }) as unknown as typeof fetch;

    const result = await submitComplaint(
      API,
      { category: 'site', text: 'The pool page will not load.' },
      {},
      fetchImpl,
      REFERENCE
    );
    expect(result.outcome).toBe('submitted');
    const body = JSON.parse(seen.body ?? '{}');
    expect(body.wallet).toBeUndefined();
    expect(body.signature).toBeUndefined();
  });

  it('refuses to send a decision complaint with no wallet, and says which', async () => {
    const fetchImpl = answer(204);
    const result = await submitComplaint(
      API,
      { category: 'decision', text: 'look again' },
      {},
      fetchImpl,
      REFERENCE
    );
    expect(result.outcome).toBe('signature_required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('names a wallet that cannot sign separately from one that is absent', async () => {
    const result = await submitComplaint(
      API,
      { category: 'payment', text: 'no prize arrived' },
      { wallet: WALLET, signer: {} },
      answer(204),
      REFERENCE
    );
    expect(result.outcome).toBe('cannot_sign');
  });

  it('reports a declined wallet prompt as declined, not as a failure', async () => {
    const result = await submitComplaint(
      API,
      { category: 'decision', text: 'look again' },
      {
        wallet: WALLET,
        signer: {
          signMessage: async () => {
            throw new Error('user rejected');
          },
        },
      },
      answer(204),
      REFERENCE
    );
    expect(result.outcome).toBe('declined');
  });

  it('never calls an absent service, and never calls that a refusal', async () => {
    const fetchImpl = answer(204);
    const result = await submitComplaint(
      undefined,
      { category: 'site', text: 'a bug' },
      {},
      fetchImpl,
      REFERENCE
    );
    expect(result.outcome).toBe('not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a 503 as not_configured and a network failure as unreachable', async () => {
    const draft = { category: 'site' as const, text: 'a bug' };
    expect(
      (await submitComplaint(API, draft, {}, answer(503, { error: 'not_configured' }), REFERENCE))
        .outcome
    ).toBe('not_configured');
    const throwing = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect((await submitComplaint(API, draft, {}, throwing, REFERENCE)).outcome).toBe('unreachable');
  });

  it('separates a clock problem from a signature that did not verify (D-33)', async () => {
    const draft = { category: 'decision' as const, text: 'look again' };
    const identity = { wallet: WALLET, signer };
    expect(
      (
        await submitComplaint(
          API,
          draft,
          identity,
          answer(401, { error: 'unauthorized', reason: 'clock_skew' }),
          REFERENCE
        )
      ).outcome
    ).toBe('clock_skew');
    expect(
      (
        await submitComplaint(
          API,
          draft,
          identity,
          answer(401, { error: 'unauthorized', reason: 'signature' }),
          REFERENCE
        )
      ).outcome
    ).toBe('refused');
  });

  it('reports a duplicate reference and an over-long draft distinctly', async () => {
    expect(
      (
        await submitComplaint(
          API,
          { category: 'site', text: 'a bug' },
          {},
          answer(409, { error: 'already_lodged' }),
          REFERENCE
        )
      ).outcome
    ).toBe('already_lodged');
    expect(
      (
        await submitComplaint(
          API,
          { category: 'site', text: 'x'.repeat(COMPLAINT_TEXT_MAX + 1) },
          {},
          answer(204),
          REFERENCE
        )
      ).outcome
    ).toBe('too_long');
  });

  it('does not dress a service 400 up as an over-long draft', async () => {
    // The length check above ran HERE, before anything was sent. A 400 from
    // the service therefore means a shape it would not accept — in practice
    // the `pool` the calling page passed — and saying "too long" would send
    // a player round the loop shortening words that were never too long.
    // Found by the 2026-09-19 end-to-end walk.
    const result = await submitComplaint(
      API,
      { category: 'site', text: 'the results page showed my pass twice', pool: 'BCUP-0007' },
      {},
      answer(400, { error: 'bad_request' }),
      REFERENCE
    );
    expect(result).toEqual({ outcome: 'not_accepted', reference: null });
  });

  it('never returns a reference for a submission that did not land', async () => {
    for (const fetchImpl of [answer(503), answer(401, {}), answer(409, { error: 'already_lodged' })]) {
      const result = await submitComplaint(
        API,
        { category: 'decision', text: 'look again' },
        { wallet: WALLET, signer },
        fetchImpl,
        REFERENCE
      );
      expect(result.reference).toBeNull();
    }
  });
});

describe('fetchComplaintStatus', () => {
  const status = {
    reference: REFERENCE,
    status: 'received',
    category: 'decision',
    receivedAt: '2026-09-19T12:00:00.000Z',
    signed: true,
    text: 'look again',
    note: null,
    acknowledgeWorkingDays: 5,
    resolveDays: 30,
  };

  it('reads a status and passes the wallet when there is one', async () => {
    const seen: { url?: string } = {};
    const fetchImpl = vi.fn(async (url: string) => {
      seen.url = url;
      return { status: 200, ok: true, json: async () => status };
    }) as unknown as typeof fetch;
    const read = await fetchComplaintStatus(API, REFERENCE, WALLET, fetchImpl);
    expect(read).toEqual({ kind: 'status', status });
    expect(seen.url).toContain(`ref=${REFERENCE}`);
    expect(seen.url).toContain(`wallet=${WALLET}`);
  });

  it('omits the wallet parameter entirely for an unsigned lookup', async () => {
    const seen: { url?: string } = {};
    const fetchImpl = vi.fn(async (url: string) => {
      seen.url = url;
      return { status: 200, ok: true, json: async () => ({ ...status, signed: false }) };
    }) as unknown as typeof fetch;
    await fetchComplaintStatus(API, REFERENCE, null, fetchImpl);
    expect(seen.url).not.toContain('wallet');
  });

  it('names not_found, not_configured and unreachable as three different things', async () => {
    expect((await fetchComplaintStatus(API, REFERENCE, null, answer(404))).kind).toBe('not_found');
    expect((await fetchComplaintStatus(API, REFERENCE, null, answer(503))).kind).toBe(
      'not_configured'
    );
    expect((await fetchComplaintStatus(API, REFERENCE, null, answer(500))).kind).toBe('unreachable');
    expect((await fetchComplaintStatus(undefined, REFERENCE, null, answer(200))).kind).toBe(
      'not_configured'
    );
  });

  it('treats a malformed reference as not_found without calling the service', async () => {
    const fetchImpl = answer(200, status);
    expect((await fetchComplaintStatus(API, 'nope', null, fetchImpl)).kind).toBe('not_found');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats an answer of the wrong shape as unreachable, never as a status', async () => {
    expect((await fetchComplaintStatus(API, REFERENCE, null, answer(200, { hi: 1 }))).kind).toBe(
      'unreachable'
    );
  });
});

describe('the signature policy the form renders', () => {
  it('is the service’s own table, imported rather than restated', () => {
    expect(signatureRequired('decision')).toBe(true);
    expect(signatureRequired('payment')).toBe(true);
    expect(signatureRequired('site')).toBe(false);
    expect(signatureRequired('data_protection')).toBe(false);
    expect(signatureRequired('other')).toBe(false);
  });
});
