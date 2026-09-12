/**
 * The two HTTP vendors and the shared failure taxonomy, against injected
 * fetch — the convention of `backend/packet/test/geo-iplocate.spec.ts`.
 *
 * OpenSanctions' shape is from its live OpenAPI document (2026-09-07).
 * Chainalysis' 401 body is a verbatim capture; its 200 body is the
 * DOCUMENTED shape and is labelled so until a real key produces one.
 */

import { expect } from 'chai';
import { ChainalysisCheck } from '../src/chainalysis';
import { OpenSanctionsCheck } from '../src/opensanctions';
import { SanctionsAuthError, SanctionsQuotaError } from '../src/http';

type Seen = { url?: string; method?: string; headers?: Record<string, string>; body?: string };

const answering = (status: number, body: unknown, seen?: Seen, ct = 'application/json') =>
  (async (url: string, init?: RequestInit) => {
    if (seen) {
      seen.url = String(url);
      seen.method = init?.method ?? 'GET';
      seen.headers = init?.headers as Record<string, string>;
      seen.body = typeof init?.body === 'string' ? init.body : undefined;
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => ct },
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

const at = () => new Date('2026-09-07T12:00:00Z');
const instant = { sleep: async () => undefined, random: () => 0 };

// ---- OpenSanctions ---------------------------------------------------------

const OS_LISTED = {
  responses: {
    w: {
      status: 200,
      results: [
        {
          id: 'NK-abc',
          caption: 'Example Designated Wallet',
          schema: 'CryptoWallet',
          properties: { publicKey: ['42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi'] },
          datasets: ['us_ofac_sdn'],
          score: 0.99,
          match: true,
        },
      ],
      total: { value: 1, relation: 'eq' },
      query: {},
    },
  },
  limit: 5,
};
const OS_CLEAN = { responses: { w: { status: 200, results: [], total: { value: 0 }, query: {} } }, limit: 5 };

describe('OpenSanctionsCheck — the verified /match contract', () => {
  const make = (f: typeof fetch) => new OpenSanctionsCheck({ apiKey: 'k', fetchImpl: f, now: at, ...instant });

  it('POSTs a CryptoWallet.publicKey query to /match/default with the ApiKey header', async () => {
    const seen: Seen = {};
    await make(answering(200, OS_CLEAN, seen)).screen('ADDR');
    expect(seen.url).to.equal('https://api.opensanctions.org/match/default');
    expect(seen.method).to.equal('POST');
    expect(seen.headers?.authorization).to.equal('ApiKey k');
    expect(JSON.parse(seen.body!)).to.deep.equal({
      queries: { w: { schema: 'CryptoWallet', properties: { publicKey: ['ADDR'] } } },
    });
  });

  it('a result with match:true lists the address and names the dataset', async () => {
    const v = await make(answering(200, OS_LISTED)).screen('42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi');
    expect(v.listed).to.equal(true);
    expect(v.matches[0]).to.include({ source: 'opensanctions', listName: 'us_ofac_sdn', entityId: 'NK-abc' });
    expect(v.consulted).to.deep.equal(['opensanctions']);
  });

  it('DROPS the score: a high-score result with match:false is not listed', async () => {
    const body = JSON.parse(JSON.stringify(OS_LISTED));
    body.responses.w.results[0].match = false;
    body.responses.w.results[0].score = 0.999;
    const v = await make(answering(200, body)).screen('ADDR');
    expect(v.listed).to.equal(false);
    expect(JSON.stringify(v)).to.not.match(/score/);
  });

  it('a body without responses.<id>.results throws rather than reading as clean', async () => {
    for (const bad of [{}, { responses: {} }, { responses: { w: {} } }, null]) {
      let threw = false;
      try {
        await make(answering(200, bad)).screen('ADDR');
      } catch {
        threw = true;
      }
      expect(threw, JSON.stringify(bad)).to.equal(true);
    }
  });
});

// ---- Chainalysis -----------------------------------------------------------

// Verbatim from the live service, 2026-09-07, with an invalid key.
const CA_401 = { message: 'Invalid API Key' };
// The DOCUMENTED 200 shapes — replace with a verbatim capture at first key.
const CA_LISTED = {
  identifications: [
    {
      category: 'sanctions',
      name: 'SANCTIONS: OFAC SDN Example',
      description: 'Example listing',
      url: 'https://home.treasury.gov/example',
    },
  ],
};
const CA_CLEAN = { identifications: [] };

describe('ChainalysisCheck', () => {
  const make = (f: typeof fetch) => new ChainalysisCheck({ apiKey: 'k', fetchImpl: f, now: at, ...instant });

  it('GETs the PATH form with the X-API-Key header (verified live)', async () => {
    const seen: Seen = {};
    await make(answering(200, CA_CLEAN, seen)).screen('ADDR');
    expect(seen.url).to.equal('https://public.chainalysis.com/api/v1/address/ADDR');
    expect(seen.method).to.equal('GET');
    expect(seen.headers?.['X-API-Key']).to.equal('k');
  });

  it('a non-empty identifications array lists the address', async () => {
    const v = await make(answering(200, CA_LISTED)).screen('ADDR');
    expect(v.listed).to.equal(true);
    expect(v.matches[0]).to.include({ source: 'chainalysis', listName: 'sanctions' });
  });

  it('an empty identifications array is clean', async () => {
    expect((await make(answering(200, CA_CLEAN)).screen('ADDR')).listed).to.equal(false);
  });

  it('a 200 without identifications throws rather than reading as clean', async () => {
    let threw = false;
    try {
      await make(answering(200, { foo: 1 })).screen('ADDR');
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });

  it('401 with the live "Invalid API Key" body is a credential error, never retried', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return { ok: false, status: 401, json: async () => CA_401 } as unknown as Response;
    }) as unknown as typeof fetch;
    try {
      await make(f).screen('ADDR');
      expect.fail('should throw');
    } catch (e) {
      expect(e).to.be.instanceOf(SanctionsAuthError);
    }
    expect(calls).to.equal(1);
  });
});

// ---- The shared taxonomy ---------------------------------------------------

describe('the HTTP failure taxonomy (shared by both vendors)', () => {
  const statuses = (codes: number[]) => {
    let i = 0;
    const calls = { n: 0 };
    const f = (async () => {
      calls.n++;
      const s = codes[Math.min(i++, codes.length - 1)];
      return { ok: s >= 200 && s < 300, status: s, json: async () => CA_CLEAN } as unknown as Response;
    }) as unknown as typeof fetch;
    return { f, calls };
  };
  const make = (f: typeof fetch, over: object = {}) =>
    new ChainalysisCheck({ apiKey: 'k', fetchImpl: f, now: at, ...instant, ...over });

  it('429 is a quota error and is NOT retried', async () => {
    const { f, calls } = statuses([429, 200]);
    try {
      await make(f).screen('A');
      expect.fail('should throw');
    } catch (e) {
      expect(e).to.be.instanceOf(SanctionsQuotaError);
    }
    expect(calls.n).to.equal(1);
  });

  it('403 is a credential error and is NOT retried', async () => {
    const { f, calls } = statuses([403, 200]);
    await make(f).screen('A').then(() => expect.fail('should throw'), (e) => expect(e).to.be.instanceOf(SanctionsAuthError));
    expect(calls.n).to.equal(1);
  });

  it('5xx IS retried up to `attempts`, then succeeds', async () => {
    const { f, calls } = statuses([503, 502, 200]);
    const v = await make(f, { attempts: 3 }).screen('A');
    expect(v.listed).to.equal(false);
    expect(calls.n).to.equal(3);
  });

  it('5xx beyond `attempts` throws the last status', async () => {
    const { f, calls } = statuses([500]);
    await make(f, { attempts: 2 }).screen('A').then(() => expect.fail('should throw'), (e) => expect((e as Error).message).to.match(/HTTP 500/));
    expect(calls.n).to.equal(2);
  });

  it('a network fault IS retried and reports the attempt count when exhausted', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await make(f, { attempts: 2 }).screen('A').then(() => expect.fail('should throw'), (e) => expect((e as Error).message).to.match(/unreachable after 2 attempts/));
    expect(n).to.equal(2);
  });

  it('any other non-2xx throws without retry', async () => {
    const { f, calls } = statuses([418, 200]);
    await make(f).screen('A').then(() => expect.fail('should throw'), (e) => expect((e as Error).message).to.match(/HTTP 418/));
    expect(calls.n).to.equal(1);
  });
});

// ---- The deadline covers the body too (audit B-27 / G-07) ------------------

/**
 * The shape is `ofac-sdn.spec.ts`'s "a stalled BODY is bounded too": a vendor
 * that accepts the connection, answers 200, and then stops sending. The head
 * arrives, so every status branch above is satisfied and nothing has failed —
 * the promise simply never settles. At entry that hangs `issuePacket` and the
 * entrant's request with it; at settlement it hangs the daemon's tick.
 *
 * Both vendors are covered because both reach the network through the same
 * `withRetry`, and a bound proven on one of them is not a bound on the other.
 */
describe('the vendor deadline covers the whole exchange, body included', () => {
  /** 200 with headers, then silence — the body promise settles only on abort. */
  const headThenStall = (calls?: { n: number }): typeof fetch =>
    (async (_url: string, init?: RequestInit) => {
      if (calls) calls.n++;
      const signal = init?.signal ?? undefined;
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise<unknown>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason));
          }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

  /** Accepts the request and never answers at all — the head stalls. */
  const neverAnswers: typeof fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(signal.reason));
    })) as unknown as typeof fetch;

  it('chainalysis: a stalled BODY aborts on our deadline and names the phase', async () => {
    const calls = { n: 0 };
    const started = Date.now();
    const check = new ChainalysisCheck({
      apiKey: 'k',
      fetchImpl: headThenStall(calls),
      now: at,
      ...instant,
      attempts: 2,
      timeoutMs: 50,
    });
    let message = '';
    try {
      await check.screen('ADDR');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, 'the error says it timed out reading the body').to.match(
      /chainalysis: no readable answer after 2 attempts — chainalysis: timed out after 50ms reading the response body/
    );
    expect(calls.n, 'a stalled body is transient: retried like a stalled head').to.equal(2);
    expect(
      Date.now() - started,
      'it returned on its own deadline, not on the test runner giving up'
    ).to.be.lessThan(5_000);
  });

  it('opensanctions: a stalled BODY aborts on our deadline', async () => {
    const check = new OpenSanctionsCheck({
      apiKey: 'k',
      fetchImpl: headThenStall(),
      now: at,
      ...instant,
      attempts: 1,
      timeoutMs: 50,
    });
    let message = '';
    try {
      await check.screen('ADDR');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.match(/opensanctions: timed out after 50ms reading the response body/);
  });

  it('a stalled HEAD is still bounded, and says which phase stalled', async () => {
    const check = new ChainalysisCheck({
      apiKey: 'k',
      fetchImpl: neverAnswers,
      now: at,
      ...instant,
      attempts: 1,
      timeoutMs: 50,
    });
    let message = '';
    try {
      await check.screen('ADDR');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.match(/timed out after 50ms awaiting the response head/);
  });

  it('a complete but unparseable body is NOT retried as a stall', async () => {
    let calls = 0;
    const notJson = (async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const check = new ChainalysisCheck({ apiKey: 'k', fetchImpl: notJson, now: at, ...instant });
    let message = '';
    try {
      await check.screen('ADDR');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).to.match(/Unexpected token/);
    expect(calls, 'a bad answer is an answer; asking again spends the quota').to.equal(1);
  });

  it('the signal handed to fetch is live, and is the one that bounds the body', async () => {
    let seen: AbortSignal | undefined;
    const capture = (async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return { ok: true, status: 200, json: async () => CA_CLEAN } as unknown as Response;
    }) as unknown as typeof fetch;
    await new ChainalysisCheck({ apiKey: 'k', fetchImpl: capture, now: at, ...instant }).screen('A');
    expect(seen, 'fetch was given a signal').to.be.instanceOf(AbortSignal);
    expect(seen?.aborted, 'and it is live when the body is read, not already spent').to.equal(false);
  });
});
