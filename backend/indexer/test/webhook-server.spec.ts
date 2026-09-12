/**
 * The webhook SERVER, over a real socket (audit 2026-09-11, Tier 3 item 7).
 *
 * The pure handler has always checked the shared secret; the server around
 * it used to buffer the whole request body first. These three tests pin the
 * order at the wire: an unauthenticated delivery is refused at the headers
 * stage with its body unread, a body over the ceiling is refused with 413,
 * and an authenticated delivery of an ordinary size still lands.
 */

import { expect } from 'chai';
import { request, type IncomingMessage } from 'http';
import type { AddressInfo } from 'net';
import { SILENT_MONITOR } from '../src/shared';
import { InMemoryEventStore } from '../src/store';
import { createWebhookServer, MAX_WEBHOOK_BODY_BYTES } from '../src/webhook';
import { encodeTestEvent, programDataLine, registerTestEvent } from './event-codec';

const PROGRAM = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const POOL = 'PooL1111111111111111111111111111111111111111';
const SECRET = 'topsecret';

before(() => registerTestEvent());

interface Reply {
  status: number;
  body: string;
}

/** POST `body` with `auth`, resolving on the response. `body` may be a
 * function that writes to the request itself, for the partial-body case. */
function post(
  port: number,
  path: string,
  auth: string | undefined,
  body: string | ((req: ReturnType<typeof request>) => void),
  headers: Record<string, string> = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(auth !== undefined ? { authorization: auth } : {}),
          ...headers,
        },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    // A server that closes the socket after answering makes the client see
    // an error AFTER the response has been read; that is the expected shape
    // for the refusals below, so it must not reject a resolved promise.
    req.on('error', (e) => reject(e));
    if (typeof body === 'string') req.end(body);
    else body(req);
  });
}

describe('createWebhookServer — the wire order', () => {
  let port = 0;
  let store: InMemoryEventStore;
  let server: ReturnType<typeof createWebhookServer>;

  beforeEach(async () => {
    store = new InMemoryEventStore();
    server = createWebhookServer({
      store,
      monitor: SILENT_MONITOR,
      secret: SECRET,
      commitment: 'finalized',
      program: PROGRAM,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('refuses a wrong secret at the headers stage, before any of the body arrives', async () => {
    // Announce a large body and send none of it. A server that buffered
    // first would wait here forever; this one answers on the headers alone.
    const reply = await post(
      port,
      '/',
      'not-the-secret',
      (req) => {
        req.flushHeaders();
      },
      { 'content-length': String(MAX_WEBHOOK_BODY_BYTES) }
    );
    expect(reply.status).to.equal(401);
    expect(store.ledger()).to.have.length(0);
  });

  it('refuses a body over the ceiling with 413 and ingests nothing', async () => {
    const oversized = '[' + '0,'.repeat(MAX_WEBHOOK_BODY_BYTES / 2) + '0]';
    expect(oversized.length).to.be.greaterThan(MAX_WEBHOOK_BODY_BYTES);
    let reply: Reply | null = null;
    try {
      reply = await post(port, '/', SECRET, oversized);
    } catch {
      // The server may close the socket while the client is still writing;
      // the response, if it was read, is what matters.
    }
    if (reply !== null) expect(reply.status).to.equal(413);
    expect(store.ledger()).to.have.length(0);
  });

  it('ingests an authenticated delivery of an ordinary size', async () => {
    const delivery = JSON.stringify([
      {
        signature: 'sig-over-the-wire',
        slot: 42,
        meta: { logMessages: [programDataLine(encodeTestEvent(POOL, 7n))] },
      },
    ]);
    const reply = await post(port, '/', SECRET, delivery);
    expect(reply.status).to.equal(200);
    expect(JSON.parse(reply.body).inserted).to.equal(1);
    expect(store.ledger()).to.have.length(1);
  });
});
