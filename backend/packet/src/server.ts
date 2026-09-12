/**
 * The entry service's HTTP face: the two endpoints a client calls at entry.
 *
 *   POST /packet       { wallet, pool }               → IssuedPacket | 403 generic
 *   POST /ciphertexts  { pool, player, ciphertext }   → 204
 *   POST /attestation  { wallet, termsVersion, signature } → 204 | 403
 *   POST /notify       { wallet, emailOptIn, atUnix, signature } → 204 | 403
 *   GET  /geo                                         → { allowed: boolean }
 *
 * `/attestation` (D-B4) stores the signature-verified clickwrap record; a
 * refusal carries no reason (a wrong version and a bad signature look
 * alike). There is deliberately NO read endpoint: the client re-prompts
 * from its own device cache, and packet issuance is the authority.
 *
 * `/geo` (D-B3) is the client pre-flight: the same lookup and schedule as
 * issuance, answering only a boolean so the play page can withhold the pay
 * path in a blocked territory without learning why. Fail-closed end to end.
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
import {
  RateLimiter,
  applyHygiene,
  clientKeyFrom,
  type HygieneConfig,
} from '../../_shared/src/http-hygiene';
import type { CiphertextStore } from '../../sealing/src';
import {
  GENERIC_REJECTION,
  geoVerdict,
  issuePacket,
  type GeoLookupResult,
  type PacketServiceDeps,
} from './service';
import { acceptAttestation } from './attestations';
import { acceptNotifyPreference, type NotifyPreferenceStore } from './notify';
import type { PoolIdResolver } from './pool-ids';

export interface EntryServerDeps {
  packet: PacketServiceDeps;
  ciphertexts: CiphertextStore;
  /**
   * Pool address → on-chain numeric pool id, the key the ciphertext store is
   * read by. Required: without it this service would have to guess a key,
   * which is exactly the defect the 2026-09-11 audit found. See `pool-ids.ts`.
   */
  poolIds: PoolIdResolver;
  /** v3 D3: the email-notification opt-in store. Optional — a deployment
   * without it answers /notify with 503 rather than pretending to record. */
  notify?: NotifyPreferenceStore;
  trustProxyHeader: boolean;
  /**
   * BR-005 hygiene (CORS / rate limit / security headers) for the socket
   * layer. Optional so the offline route suites are unchanged; a deployment
   * entry passes `loadHygieneConfig(env)` widened to the POST surface (see
   * main.ts). Without it the server emits no CORS headers at all — a
   * browser app on another origin then cannot reach this service, so every
   * real deployment must configure `BLOTTO_API_CORS_ORIGINS`.
   */
  hygiene?: HygieneConfig;
  /**
   * TEST/DEV ONLY (D-B3 stub): when true, `x-geo-country` / `x-geo-region` /
   * `x-geo-vpn: 1` request headers override the geo lookup for that request.
   * Never set behind anything a player can reach — a client-controlled
   * header would decide its own territory.
   */
  trustGeoStubHeaders?: boolean;
}

/** Per-request header override for the stub path (see trustGeoStubHeaders). */
function geoFromHeaders(headers: Record<string, string | string[] | undefined>):
  | GeoLookupResult
  | null {
  const country = headers['x-geo-country'];
  if (typeof country !== 'string' || country.length === 0) return null;
  const region = headers['x-geo-region'];
  return {
    country,
    region: typeof region === 'string' && region.length > 0 ? region : undefined,
    vpnOrProxy: headers['x-geo-vpn'] === '1',
  };
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
  ip: string,
  headers: Record<string, string | string[] | undefined> = {}
): Promise<RouteResult> {
  // The stub header path swaps the lookup for THIS request only.
  let packetDeps = deps.packet;
  if (deps.trustGeoStubHeaders === true) {
    const stub = geoFromHeaders(headers);
    if (stub) packetDeps = { ...deps.packet, geo: { lookup: async () => stub } };
  }

  // E5: the deployment liveness probe.
  if (path === '/health') {
    if (method !== 'GET') return { status: 405, body: { error: 'method' } };
    return { status: 200, body: { ok: true, service: 'packet' } };
  }

  if (path === '/geo') {
    if (method !== 'GET') return { status: 405, body: { error: 'method' } };
    return { status: 200, body: { allowed: await geoVerdict(packetDeps, ip) } };
  }

  if (method !== 'POST') return { status: 405, body: { error: 'method' } };

  if (path === '/packet') {
    const b = body as { wallet?: string; pool?: string };
    if (!b || !B58.test(b.wallet ?? '') || !B58.test(b.pool ?? '')) {
      // Malformed requests get the same generic answer as failed checks.
      return { status: 403, body: GENERIC_REJECTION };
    }
    const res = await issuePacket(packetDeps, {
      wallet: b.wallet as string,
      pool: b.pool as string,
      ip,
    });
    return res.ok ? { status: 200, body: res } : { status: 403, body: res };
  }

  if (path === '/attestation') {
    const b = body as { wallet?: string; termsVersion?: number; signature?: string };
    if (!b || !B58.test(b.wallet ?? '') || typeof b.signature !== 'string') {
      return { status: 403, body: { ok: false } };
    }
    const stored = await acceptAttestation(
      deps.packet.attestations,
      { version: deps.packet.config.termsVersion, updated: deps.packet.config.termsUpdated },
      deps.packet.now,
      {
        wallet: b.wallet as string,
        termsVersion: Number(b.termsVersion),
        signature: b.signature,
      }
    );
    return stored ? { status: 204, body: null } : { status: 403, body: { ok: false } };
  }

  if (path === '/notify') {
    if (!deps.notify) return { status: 503, body: { error: 'unconfigured' } };
    const b = body as {
      wallet?: string;
      emailOptIn?: boolean;
      atUnix?: string | number;
      signature?: string;
    };
    if (
      !b ||
      !B58.test(b.wallet ?? '') ||
      typeof b.emailOptIn !== 'boolean' ||
      typeof b.signature !== 'string' ||
      (typeof b.atUnix !== 'string' && typeof b.atUnix !== 'number')
    ) {
      return { status: 403, body: { ok: false } };
    }
    let atUnix: bigint;
    try {
      atUnix = BigInt(b.atUnix);
    } catch {
      return { status: 403, body: { ok: false } };
    }
    const stored = await acceptNotifyPreference(deps.notify, deps.packet.now, {
      wallet: b.wallet as string,
      emailOptIn: b.emailOptIn,
      atUnix,
      signature: b.signature,
    });
    return stored ? { status: 204, body: null } : { status: 403, body: { ok: false } };
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
    // The store is keyed on the pool's on-chain NUMERIC id — the key every
    // reader uses. Resolve it here rather than deriving one locally, and
    // refuse an address we cannot resolve: a refused write costs a retry, a
    // write under an unreadable key costs the player their entry (audit
    // B-01, 2026-09-11).
    const poolId = await deps.poolIds.idFor(b.pool as string);
    if (poolId === null) {
      return { status: 400, body: { error: 'unknown pool' } };
    }
    await deps.ciphertexts.put(poolId, b.player as string, new Uint8Array(bytes));
    return { status: 204, body: null };
  }

  return { status: 404, body: { error: 'not found' } };
}

/** ONE resolver for the whole service, shared with the rate limiter, so the
 * territory gate and the limiter can never disagree about who is calling.
 * See `clientKeyFrom` for why the leftmost X-Forwarded-For entry is not it. */
function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (!trustProxy) return req.socket.remoteAddress ?? '';
  const resolved = clientKeyFrom(
    req.headers['x-forwarded-for'],
    req.socket.remoteAddress ?? undefined,
    req.headers['fly-client-ip']
  );
  return resolved === 'unknown' ? '' : resolved;
}

export function serveEntryApi(deps: EntryServerDeps, port: number): Server {
  // BR-005 wiring: one hygiene decision per request, BEFORE the router. The
  // previous hand-written `access-control-allow-origin: *` is gone — the
  // allowlist (BLOTTO_API_CORS_ORIGINS) is the one CORS mechanism, and it
  // covers every response shape (JSON, 204, and the 500 catch) plus the
  // browser preflight the POST surface needs.
  const hygiene: HygieneConfig = deps.hygiene ?? {
    rateLimit: { enabled: false, requestsPerMinute: 1, burst: 1, retryAfterSeconds: 1 },
    cors: { allowedOrigins: [] },
    securityHeadersEnabled: false,
  };
  const limiter = new RateLimiter(hygiene.rateLimit);
  const server = createServer(async (req, res) => {
    const outcome = applyHygiene(
      {
        method: req.method,
        forwardedFor: deps.trustProxyHeader ? req.headers['x-forwarded-for'] : undefined,
        remoteAddress: req.socket.remoteAddress ?? undefined,
        flyClientIp: deps.trustProxyHeader ? req.headers['fly-client-ip'] : undefined,
        origin: req.headers.origin,
      },
      hygiene,
      limiter
    );
    if (outcome.kind === 'preflight') {
      res.writeHead(outcome.status, outcome.headers).end();
      return;
    }
    if (outcome.kind === 'rate_limited') {
      res
        .writeHead(outcome.status, { 'content-type': 'application/json', ...outcome.headers })
        .end(JSON.stringify(outcome.body));
      return;
    }
    const baseHeaders = outcome.headers;

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
          clientIp(req, deps.trustProxyHeader),
          req.headers
        );
        if (out === null) res.writeHead(status, baseHeaders).end();
        else
          res
            .writeHead(status, { 'content-type': 'application/json', ...baseHeaders })
            .end(JSON.stringify(out));
      } catch {
        res
          .writeHead(500, { 'content-type': 'application/json', ...baseHeaders })
          .end(JSON.stringify({ error: 'internal' }));
      }
    });
  });
  server.listen(port);
  return server;
}
