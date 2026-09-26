/*
 * The desk's half of the complaints route.
 *
 * The property that matters most here is the same one the player-side module
 * is tested for, and for the same reason: EVERY ENDING IS NAMED AND
 * DISTINCT. On the player's side, telling somebody their complaint was
 * refused when it never arrived is the C-04 defect at the surface where it
 * costs most. On the desk's side the mirror image is just as bad — an
 * operator who is told "recorded" when nothing was recorded believes a
 * player has been answered, and the published thirty-day window quietly
 * runs out.
 *
 * The signature is checked as bytes, not as a boolean: an answer that did
 * not cover the note would let an operator sign one thing and publish
 * another, and an answer signed over the LODGE message would be a signature
 * from a different authority entirely.
 */
import { describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';
import { base58Encode } from '@blotto/shared/blotto-events';
import {
  canonicalComplaintAnswerMessage,
  canonicalComplaintMessage,
} from '@blotto/detection/complaint-message';
import { COMPLAINT_NOTE_MAX } from '@blotto/detection/complaints';
import { complaintsQueueMessage } from './complaints-request';
import {
  answerComplaint,
  loadComplaintQueue,
  noteValid,
  type QueueRead,
} from './complaints-desk';

const API = 'https://review.example';
const keys = nacl.sign.keyPair();
const REVIEWER = base58Encode(keys.publicKey);
const REFERENCE = 'BC-7K2M4QPT';

/** A signer that really signs, so the bytes can be verified. */
const signer = {
  signMessage: async (m: Uint8Array) => nacl.sign.detached(m, keys.secretKey),
};
const declines = {
  signMessage: async () => {
    throw new Error('User rejected the request.');
  },
};

const answering = (status: number, body?: unknown): typeof fetch =>
  (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

const throwing: typeof fetch = (async () => {
  throw new Error('network');
}) as unknown as typeof fetch;

const QUEUE = {
  open: [
    {
      reference: REFERENCE,
      category: 'decision',
      pool: null,
      text: 'My prize was withheld.',
      signed: true,
      wallet: REVIEWER,
      receivedAt: '2026-09-22T01:00:00.000Z',
    },
  ],
  acknowledgeWorkingDays: 5,
  resolveDays: 30,
};

describe('reading the desk queue', () => {
  it('returns the queue and the two published windows', async () => {
    const read = await loadComplaintQueue(REVIEWER, signer, answering(200, QUEUE));
    expect(read.kind).toBe('queue');
    if (read.kind === 'queue') {
      expect(read.open).toHaveLength(1);
      expect(read.open[0].reference).toBe(REFERENCE);
      // Read from the service, never typed on the page.
      expect(read.acknowledgeWorkingDays).toBe(5);
      expect(read.resolveDays).toBe(30);
    }
  });

  it('signs the QUEUE message, not any other', async () => {
    // The signature is only as narrow as the bytes it covers. If this signed
    // the detection request's bytes, a routine detection request would also
    // open the complaints queue.
    let sent: Record<string, unknown> = {};
    const capture: typeof fetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(QUEUE), { status: 200 });
    }) as unknown as typeof fetch;
    await loadComplaintQueue(REVIEWER, signer, capture);
    const verified = nacl.sign.detached.verify(
      complaintsQueueMessage({
        reviewer: REVIEWER,
        requestedAt: String(sent.requestedAt),
      }),
      Uint8Array.from(Buffer.from(String(sent.signature), 'base64')),
      keys.publicKey
    );
    expect(verified, 'the signature covers the queue message').toBe(true);
  });

  it('names every ending distinctly', async () => {
    const cases: Array<[QueueRead['kind'], QueueRead]> = [
      ['cannot_sign', await loadComplaintQueue(null, signer, answering(200, QUEUE))],
      ['cannot_sign', await loadComplaintQueue(REVIEWER, {}, answering(200, QUEUE))],
      ['declined', await loadComplaintQueue(REVIEWER, declines, answering(200, QUEUE))],
      ['unauthorized', await loadComplaintQueue(REVIEWER, signer, answering(401, {}))],
      ['not_configured', await loadComplaintQueue(REVIEWER, signer, answering(503, {}))],
      ['unreachable', await loadComplaintQueue(REVIEWER, signer, throwing)],
      ['unreachable', await loadComplaintQueue(REVIEWER, signer, answering(500, {}))],
      // A 200 whose body is not a queue is unreachable, not an empty desk:
      // "nothing is open" and "we could not read it" must never share a
      // rendering.
      ['unreachable', await loadComplaintQueue(REVIEWER, signer, answering(200, { nope: 1 }))],
    ];
    for (const [want, got] of cases) expect(got.kind, want).toBe(want);
  });
});

describe('answering a complaint', () => {
  const answer = { reference: REFERENCE, kind: 'acknowledged' as const, note: 'A person has this.' };

  it('records an answer, signing the note along with it', async () => {
    let sent: Record<string, unknown> = {};
    const capture: typeof fetch = (async (url: string, init: RequestInit) => {
      expect(url).toBe(`${API}/complaints/answer`);
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    expect(await answerComplaint(API, REVIEWER, signer, answer, capture)).toBe('recorded');
    expect(sent.decidedBy).toBe(REVIEWER);
    expect(sent.kind).toBe('acknowledged');
    // THE NOTE IS INSIDE THE SIGNED BYTES. An operator who could change it
    // afterwards could answer one thing and publish another.
    const verified = nacl.sign.detached.verify(
      canonicalComplaintAnswerMessage({
        reference: REFERENCE,
        kind: 'acknowledged',
        decidedBy: REVIEWER,
        note: answer.note,
        signedAt: String(sent.decidedAt),
      }),
      Uint8Array.from(Buffer.from(String(sent.signature), 'base64')),
      keys.publicKey
    );
    expect(verified).toBe(true);
  });

  it('does not produce a signature a LODGE message would verify', async () => {
    // Domain separation from the other direction: the bytes this signs are
    // not the bytes a player signs, so neither authority can borrow the
    // other's signature.
    let sent: Record<string, unknown> = {};
    const capture: typeof fetch = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await answerComplaint(API, REVIEWER, signer, answer, capture);
    const asLodge = nacl.sign.detached.verify(
      canonicalComplaintMessage({
        reference: REFERENCE,
        wallet: REVIEWER,
        category: 'decision',
        pool: null,
        text: answer.note,
        signedAt: String(sent.decidedAt),
      }),
      Uint8Array.from(Buffer.from(String(sent.signature), 'base64')),
      keys.publicKey
    );
    expect(asLodge).toBe(false);
  });

  it('names every ending distinctly', async () => {
    const cases: Array<[string, unknown]> = [
      ['not_configured', await answerComplaint(undefined, REVIEWER, signer, answer, answering(204))],
      ['not_configured', await answerComplaint(API, REVIEWER, signer, answer, answering(503, {}))],
      ['cannot_sign', await answerComplaint(API, null, signer, answer, answering(204))],
      ['cannot_sign', await answerComplaint(API, REVIEWER, {}, answer, answering(204))],
      ['declined', await answerComplaint(API, REVIEWER, declines, answer, answering(204))],
      ['unauthorized', await answerComplaint(API, REVIEWER, signer, answer, answering(401, {}))],
      ['not_found', await answerComplaint(API, REVIEWER, signer, answer, answering(404, {}))],
      [
        'already_recorded',
        await answerComplaint(API, REVIEWER, signer, answer, answering(409, { error: 'already_recorded' })),
      ],
      ['malformed', await answerComplaint(API, REVIEWER, signer, answer, answering(400, {}))],
      ['unreachable', await answerComplaint(API, REVIEWER, signer, answer, throwing)],
    ];
    for (const [want, got] of cases) expect(got, want).toBe(want);
  });

  it('refuses a bad reference or an empty note WITHOUT asking the wallet', async () => {
    // Nothing is signed and nothing is sent: a wallet prompt for a request
    // we already know is unsendable trains an operator to click through
    // prompts, which is the habit that gets a bad one signed.
    const sign = vi.fn();
    const never: typeof fetch = (async () => {
      throw new Error('should not have been called');
    }) as unknown as typeof fetch;
    for (const bad of [
      { ...answer, reference: 'nope' },
      { ...answer, note: '   ' },
      { ...answer, note: 'x'.repeat(COMPLAINT_NOTE_MAX + 1) },
    ]) {
      expect(await answerComplaint(API, REVIEWER, { signMessage: sign }, bad, never)).toBe(
        'malformed'
      );
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('bounds the note the same way the service does', () => {
    expect(noteValid('')).toBe(false);
    expect(noteValid('   ')).toBe(false);
    expect(noteValid('a')).toBe(true);
    expect(noteValid('x'.repeat(COMPLAINT_NOTE_MAX))).toBe(true);
    expect(noteValid('x'.repeat(COMPLAINT_NOTE_MAX + 1))).toBe(false);
  });
});
