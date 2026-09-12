/*
 * The detection proxy's gate (audit 2026-09-11, A-18 / C-07; ruling D-E9).
 *
 * The route exists because the review service's report is operator-token
 * only and that token must never reach a browser bundle. The danger it
 * creates is the one tested here: a proxy holding a privileged token is an
 * open door onto per-player detection findings unless it proves, itself,
 * that the caller is a reviewer. The page's admin gate cannot do that — it
 * decides what a browser draws, not what a server serves.
 *
 * Every refusal path is asserted, and so is the one accepted path, because
 * a gate that refuses everything would pass the refusals and ship a dead
 * panel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';
import { base58Decode, base58Encode } from '@blotto/shared/blotto-events';
import { detectionRequestMessage } from '@/app/admin/review/detection-request';

const POOL = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const OTHER_POOL = '4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1';

/** The reviewer's keypair. A seed whose public key IS the real listed
 * member is not derivable, so the list is stubbed to this key's address —
 * the route reads the same module either way. */
const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(11));
const SIGNER_ADDRESS = base58Encode(kp.publicKey);

const sign = (message: Uint8Array) =>
  Buffer.from(nacl.sign.detached(message, kp.secretKey)).toString('base64');

const body = (over: Record<string, unknown> = {}) => {
  const requestedAt = new Date().toISOString();
  const base = { pool: POOL, reviewer: SIGNER_ADDRESS, requestedAt };
  const merged = { ...base, ...over };
  return {
    ...merged,
    signature: sign(
      detectionRequestMessage({
        pool: String(merged.pool),
        reviewer: String(merged.reviewer),
        requestedAt: String(merged.requestedAt),
      })
    ),
    ...(over.signature !== undefined ? { signature: over.signature } : {}),
  };
};

const post = async (payload: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new Request('https://app.example/api/detection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

/** The route reads its config and its member list at module load, so every
 * case re-mocks and re-imports. `doMock` (not `mock`) because the member
 * list is derived from this file's own keypair. */
const withList = (members: string[]) => {
  vi.resetModules();
  vi.doMock('@config/reviewers.json', () => ({
    default: { version: 1, members, updated: '2026-09-06' },
  }));
};
const configured = () => {
  withList([SIGNER_ADDRESS]);
  vi.stubEnv('REVIEW_OPERATOR_TOKEN', 'operator-secret');
  vi.stubEnv('NEXT_PUBLIC_REVIEW_API_URL', 'https://review.example');
};

describe('POST /api/detection', () => {
  it('refuses a wallet that is not on the reviewer list', async () => {
    configured();
    const other = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(12));
    const requestedAt = new Date().toISOString();
    const res = await post({
      pool: POOL,
      reviewer: base58Encode(other.publicKey),
      requestedAt,
      signature: Buffer.from(
        nacl.sign.detached(
          detectionRequestMessage({ pool: POOL, reviewer: base58Encode(other.publicKey), requestedAt }),
          other.secretKey
        )
      ).toString('base64'),
    });
    expect(res.status).toBe(401);
  });

  it('refuses a listed reviewer whose signature does not verify', async () => {
    configured();
    const res = await post({ ...body(), signature: Buffer.alloc(64).toString('base64') });
    expect(res.status).toBe(401);
  });

  it('refuses a signature over DIFFERENT bytes — a captured request for another pool', async () => {
    configured();
    const requestedAt = new Date().toISOString();
    const forOtherPool = sign(
      detectionRequestMessage({ pool: OTHER_POOL, reviewer: SIGNER_ADDRESS, requestedAt })
    );
    const res = await post({
      pool: POOL,
      reviewer: SIGNER_ADDRESS,
      requestedAt,
      signature: forOtherPool,
    });
    expect(res.status).toBe(401);
  });

  it('refuses a stale request, so a captured body is not a permanent key', async () => {
    configured();
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const res = await post(body({ requestedAt: old }));
    expect(res.status).toBe(401);
  });

  it('refuses everything when the operator token is unset — never an open proxy', async () => {
    withList([SIGNER_ADDRESS]);
    vi.stubEnv('REVIEW_OPERATOR_TOKEN', '');
    vi.stubEnv('NEXT_PUBLIC_REVIEW_API_URL', 'https://review.example');
    const res = await post(body());
    expect(res.status).toBe(503);
  });

  it('forwards a good request with the token in the header, and never to the browser', async () => {
    configured();
    const calls: Array<{ url: string; authorization: string | undefined }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
      });
      return new Response(JSON.stringify({ pool: POOL, findings: [], hardBlocks: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/detection?pool=${POOL}`);
    // Verbatim: the service compares the WHOLE header value in constant
    // time, so a "Bearer " prefix would fail on length.
    expect(calls[0].authorization).toBe('operator-secret');
    // The token is nowhere in what the browser receives.
    expect(await res.text()).not.toContain('operator-secret');
  });

  it('passes the service’s own 404 through, so "no report yet" stays distinct', async () => {
    configured();
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'no_report' }), { status: 404 })
    );
    const res = await post(body());
    expect(res.status).toBe(404);
  });

  it('rejects a malformed body before it reaches any crypto', async () => {
    configured();
    expect((await post({ pool: 'not base58', reviewer: SIGNER_ADDRESS })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
});

/** Sanity: the address the list is stubbed with decodes to the signing key. */
it('the fixture reviewer address is the signing key', () => {
  expect(base58Decode(SIGNER_ADDRESS)).toEqual(kp.publicKey);
});
