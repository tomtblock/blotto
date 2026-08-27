/**
 * The entry service's HTTP face: the two endpoints a client calls at entry.
 *
 *   POST /packet       { wallet, pool, ageAttested }  → IssuedPacket | 403 generic
 *   POST /ciphertexts  { pool, player, ciphertext }   → 204
 *
 * The ciphertext lands here (roadmap 2.3's store) because both calls happen
 * in the same client flow and share the same deployment envelope; the store
 * itself is @blotto/sealing's `CiphertextStore` and stays ciphertext-only.
 *
 * The client IP comes from the connection (or a trusted proxy header when
 * `trustProxyHeader` is on — set it ONLY behind our own proxy). Routing is a
 * pure function over parsed bodies so the suite runs without sockets.
 */

import { createServer, type IncomingMessage, type Server } from 'http';
import type { CiphertextStore } from '../../sealing/src';
import { GENERIC_REJECTION, issuePacket, type PacketServiceDeps } from './service';

export interface EntryServerDeps {
  packet: PacketServiceDeps;
  ciphertexts: CiphertextStore;
  trustProxyHeader: boolean;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

/** Sealed boxes are 48 bytes of overhead + the 127-byte payload. */
const CIPHERTEXT_LEN = 48 + 127;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function handleEntryRoute(
  deps: EntryServerDeps,
  method: string,
  path: string,
  body: unknown,
  ip: string
): Promise<RouteResult> {
  if (method !== 'POST') return { status: 405, body: { error: 'method' } };

  if (path === '/packet') {
    const b = body as { wallet?: string; pool?: string; ageAttested?: boolean };
    if (!b || !B58.test(b.wallet ?? '') || !B58.test(b.pool ?? '')) {
      // Malformed requests get the same generic answer as failed checks.
      return { status: 403, body: GENERIC_REJECTION };
    }
    const res = await issuePacket(deps.packet, {
      wallet: b.wallet as string,
      pool: b.pool as string,
      ip,
      ageAttested: b.ageAttested === true,
    });
    return res.ok ? { status: 200, body: res } : { status: 403, body: res };
  }

  if (path === '/ciphertexts') {
    const b = body as { pool?: string; player?: string; ciphertext?: string };
    if (!b || !B58.test(b.pool ?? '') || !B58.test(b.player ?? '') || typeof b.ciphertext !== 'string') {
      return { status: 400, body: { error: 'bad request' } };
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(b.ciphertext, 'base64');
    } catch {
      return { status: 400, body: { error: 'bad request' } };
    }
    if (bytes.length !== CIPHERTEXT_LEN) {
      return { status: 400, body: { error: 'bad request' } };
    }
    // The pool id key: the store keys on the numeric pool id in Postgres;
    // here the pool PDA string keys the row via a stable hash-free mapping —
    // the service layer resolves PDA → id when the indexer is attached. For
    // now the PDA string itself is the key (MemoryCiphertextStore accepts
    // bigint; we map through a registry seam at deployment).
    await deps.ciphertexts.put(poolKey(b.pool as string), b.player as string, new Uint8Array(bytes));
    return { status: 204, body: null };
  }

  return { status: 404, body: { error: 'not found' } };
}

/** Deterministic bigint key for a pool PDA string (store-key adapter). */
export function poolKey(pool: string): bigint {
  let acc = 0n;
  for (const ch of pool) acc = (acc * 131n + BigInt(ch.charCodeAt(0))) % 2n ** 62n;
  return acc;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '';
}

export function serveEntryApi(deps: EntryServerDeps, port: number): Server {
  const server = createServer(async (req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 16_384) req.destroy();
    });
    req.on('end', async () => {
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      try {
        const { status, body: out } = await handleEntryRoute(
          deps,
          req.method ?? '',
          req.url ?? '/',
          body,
          clientIp(req, deps.trustProxyHeader)
        );
        if (out === null) res.writeHead(status).end();
        else
          res
            .writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
            .end(JSON.stringify(out));
      } catch {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'internal' }));
      }
    });
  });
  server.listen(port);
  return server;
}
