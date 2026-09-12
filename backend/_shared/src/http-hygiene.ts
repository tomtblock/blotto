/**
 * BR-005 — public-API hardening: rate limiting, CORS, and security headers for the PUBLIC read
 * surfaces. Built here in `_shared` because more than one service will need it, and
 * services must not drift on a security posture; each wires it into its own socket layer.
 *
 * ## Posture: three independent knobs, all DEFAULT OFF
 *
 * With nothing configured, every response is **byte-for-byte what it was before this module
 * existed** — no new headers, no limiter in the path. That is deliberate and it is what keeps the
 * QA Phase B evidence (which pins exact `Cache-Control` strings and exact bodies) valid in the
 * default posture, while the enabled posture is proven by its own two-state pass. Deploy ≠ go-live,
 * the same rule every BR gate follows.
 *
 * ## ⚠ DEFAULT-OFF IS NO LONGER A SAFE DEFAULT — the services are public now
 *
 * This module was written while nothing was deployed to a public URL, which is why the safe
 * default was "change nothing". Since then the indexer's read API, the packet service and the
 * review service all run on Fly behind public hostnames (`docs/hosting.md`), so **every knob left
 * unset is a public JSON API with no rate limit and no security headers**. The flags are not in
 * any committed Fly config; if they are on, they are on as deploy-time secrets, and
 * `fly secrets list` is how you find out. Turning them on for each public service is an open item
 * in `docs/AUDIT-2026-09-07.md`.
 *
 * Two things this does NOT change. The webhook stays unlimited by design (below). And the numbers
 * below remain PROPOSALS: nothing founder-ratified gives a rate limit, a window, a burst, a
 * `Retry-After`, or an allowed origin, so they are `PROPOSED_`-prefixed exported consts, reached
 * ONLY as env-overridable defaults and never inlined at a use site. **Test the MECHANISM against
 * the configured value; do not assert these numbers are canon.** (The two predecessor documents
 * this paragraph used to cite, `docs/Roadmap.md` and `docs/qa/phase-0-constants-register.md`, were
 * never carried into this repository.)
 *
 * ## What this module deliberately does NOT do
 *
 * - **It does not touch the indexer's webhook.** That surface is the authenticated Helius ingress,
 *   not a public read: rate-limiting it would drop provider retries and silently lose events,
 *   which is strictly worse than the abuse it would prevent (the sender is authenticated already).
 * - **It changes no `Cache-Control` value.** The CDN half of BR-005 is examined in the IPC-012
 *   addendum rather than implemented as header edits: the origin headers are already correct
 *   (`/metadata/:asset` caches hard when immutable; every wallet- or collection-scoped feed is
 *   deliberately `no-store` for reasons three IPC-012 addenda record), and which paths an edge
 *   caches is deploy-time CDN config on a host that does not exist yet. The ONE header this module
 *   adds for cache correctness is `Vary: Origin`, and only when a CORS header is actually emitted —
 *   because a response that varies by origin and does not say so is a cache-poisoning bug.
 */

import { optional, parseBool, parsePositiveInt } from './config';

/** A monotonic millisecond clock, injected so the limiter is testable without waiting. */
export type MonotonicClock = () => number;

// ── Rate limiting ──────────────────────────────────────────────────────────────────────────────

/**
 * PROPOSED sustained request rate per client, requests per minute — **AWAITING_RATIFICATION**
 * (founder-owned; architect proposal 600/min ≈ 10/s).
 *
 * Derivation of the proposal, so ratification has something to argue with: the frontend polls
 * a public list endpoint on a short poll, and a page that polls RPC (not us) every 3–5 s, so a
 * single honest browser tab costs well under 10 requests/min; 600 leaves ~60x headroom for a shared
 * NAT/office egress IP before anyone legitimate is touched. It is also deliberately far above what
 * the QA bench does — the §B2 idempotency folder fires 10 concurrent requests and Newman hammers
 * three collections across five passes — because a limit the bench can trip is a flake source
 * (BR_Roadmap Section 2 names exactly that trade).
 */
export const PROPOSED_RATE_LIMIT_RPM = 600;

/**
 * PROPOSED burst allowance (bucket capacity), requests — **AWAITING_RATIFICATION** (architect
 * proposal 120). A page load fans out a handful of parallel reads, and a returning user's tab can
 * refetch several feeds at once; 120 absorbs that without letting a single client sustain more than
 * {@link PROPOSED_RATE_LIMIT_RPM} over any minute.
 */
export const PROPOSED_RATE_LIMIT_BURST = 120;

/**
 * PROPOSED `Retry-After` value on a 429, seconds — **AWAITING_RATIFICATION** (architect proposal
 * 1). At the proposed refill rate a single token is back within ~100 ms, so 1 s is the smallest
 * honest integer: it never tells a client to wait materially longer than the limiter will actually
 * hold it, which is what makes the header useful rather than decorative.
 */
export const PROPOSED_RATE_LIMIT_RETRY_AFTER_SECONDS = 1;

/** Rate-limiter configuration, resolved from env by each service's config loader. */
export interface RateLimitConfig {
  /** Default OFF. When false the limiter is never consulted and adds no header. */
  enabled: boolean;
  /** Sustained requests per minute per client key. */
  requestsPerMinute: number;
  /** Bucket capacity — the most a client may spend at once. */
  burst: number;
  /** The integer seconds advertised in `Retry-After` on a 429. */
  retryAfterSeconds: number;
}

/** The decision for one request. `retryAfterSeconds` is set only when `allowed` is false. */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * A per-client token bucket, in process memory.
 *
 * **In-process is a deliberate limitation, not an oversight.** A shared store (Redis) would be
 * needed to enforce one budget across horizontally-scaled instances, and there is no such
 * dependency in this stack today; with N instances behind a load balancer the effective limit is
 * N x the configured rate. That is stated in the IPC-012 addendum rather than implied, because a
 * limit that is quietly N times looser than documented is worse than a documented one. It is
 * nonetheless a real defence for the case that matters pre-go-live: a single abusive client against
 * a single instance.
 *
 * Bucket semantics: capacity `burst`, refilled continuously at `requestsPerMinute / 60_000` tokens
 * per ms. A request spends one token; with no token available it is refused. Idle buckets are
 * evicted (see {@link RateLimiter.sweep}) so an unbounded key space — every client IP is a key —
 * cannot become an unbounded memory leak, which would turn a DoS defence into a DoS vector.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAtMs: number }>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: MonotonicClock = () => Date.now()
  ) {}

  /**
   * Spend one token for `key`. A disabled limiter always allows and records nothing, so the
   * default posture keeps no per-client state at all.
   */
  check(key: string): RateLimitDecision {
    if (!this.config.enabled) {
      return { allowed: true };
    }
    const nowMs = this.now();
    const refillPerMs = this.config.requestsPerMinute / 60_000;
    const bucket = this.buckets.get(key);

    if (bucket === undefined) {
      // A first-seen client starts full, then spends one.
      this.buckets.set(key, { tokens: this.config.burst - 1, updatedAtMs: nowMs });
      return { allowed: true };
    }

    const elapsedMs = Math.max(0, nowMs - bucket.updatedAtMs);
    const tokens = Math.min(this.config.burst, bucket.tokens + elapsedMs * refillPerMs);
    bucket.updatedAtMs = nowMs;

    if (tokens < 1) {
      // Refused: no token is spent, so the client is not pushed further into debt for retrying.
      bucket.tokens = tokens;
      return { allowed: false, retryAfterSeconds: this.config.retryAfterSeconds };
    }
    bucket.tokens = tokens - 1;
    return { allowed: true };
  }

  /**
   * Drop buckets untouched for `idleMs` AND already refilled to capacity — they carry no state a
   * fresh bucket would not reproduce, so evicting them changes no verdict. Called on a timer by
   * the socket layer (see {@link startBucketSweeper}).
   *
   * The refill condition is checked rather than assumed (2026-09-12, audit B-46). The doc comment
   * has always claimed it; the code checked only the clock, so with a short `idleMs` — or a
   * generous `burst` against a small `requestsPerMinute` — a client that was being throttled could
   * have its half-empty bucket deleted and come back with a full burst. That is a limiter bypass
   * bought with nothing but patience, and it is exactly the failure an eviction rule must not
   * introduce. {@link minimumSafeIdleMs} is the smallest `idleMs` for which the two conditions
   * coincide under the configured rate.
   */
  sweep(idleMs: number): void {
    const nowMs = this.now();
    const cutoff = nowMs - idleMs;
    const refillPerMs = this.config.requestsPerMinute / 60_000;
    for (const [key, bucket] of this.buckets) {
      if (bucket.updatedAtMs > cutoff) continue;
      const elapsedMs = Math.max(0, nowMs - bucket.updatedAtMs);
      if (bucket.tokens + elapsedMs * refillPerMs < this.config.burst) continue;
      this.buckets.delete(key);
    }
  }

  /**
   * The shortest idle time after which an empty bucket is certainly back at capacity, so a sweep
   * at or beyond it evicts every genuinely idle client: `burst / (requestsPerMinute / 60_000)` ms.
   * A caller that sweeps on a shorter idle simply retains a few buckets longer, which is the safe
   * direction to be wrong in.
   */
  minimumSafeIdleMs(): number {
    return Math.ceil(this.config.burst / (this.config.requestsPerMinute / 60_000));
  }

  /** Bucket count — for the sweep's own test, and for a gauge if one is ever wanted. */
  size(): number {
    return this.buckets.size;
  }
}

/**
 * PROPOSED sweep period, ms — architect-owned hygiene, not a founder number: it changes no
 * verdict the limiter reaches, only how long an idle client's (empty) bucket is retained. One
 * minute keeps the map small on a service that sees a burst of clients and then none.
 */
export const BUCKET_SWEEP_INTERVAL_MS = 60_000;

/**
 * PROPOSED idle time before a refilled bucket is evicted, ms — architect-owned, same reasoning.
 * Five minutes is comfortably longer than {@link RateLimiter.minimumSafeIdleMs} at any sane rate,
 * so the eviction is always of a bucket a fresh one would reproduce exactly.
 */
export const BUCKET_IDLE_EVICT_MS = 5 * 60_000;

/** A started sweeper. `stop()` is idempotent; tests and graceful shutdowns call it. */
export interface BucketSweeper {
  stop(): void;
}

/**
 * Run {@link RateLimiter.sweep} on a timer for the life of the process.
 *
 * Every client address is a key, so without this the bucket map grows without bound for as long
 * as the service runs and a DoS *defence* becomes a slow DoS *vector* (audit 2026-09-11, B-19 /
 * B-38 / B-39 / B-46: the method existed in this module from the start and had no caller anywhere
 * outside its own unit test). Each service's socket layer starts one next to its limiter.
 *
 * A disabled limiter records nothing, so no timer is started at all — the default posture keeps
 * its "adds nothing to the process" property.
 *
 * The timer is `unref`ed: a sweep must never be the reason a process stays alive.
 */
export function startBucketSweeper(
  limiter: RateLimiter,
  config: RateLimitConfig,
  options: {
    intervalMs?: number;
    idleMs?: number;
    setIntervalImpl?: (handler: () => void, ms: number) => unknown;
    clearIntervalImpl?: (handle: unknown) => void;
  } = {}
): BucketSweeper {
  if (!config.enabled) {
    return { stop: () => undefined };
  }
  const intervalMs = options.intervalMs ?? BUCKET_SWEEP_INTERVAL_MS;
  const idleMs = Math.max(options.idleMs ?? BUCKET_IDLE_EVICT_MS, limiter.minimumSafeIdleMs());
  const start = options.setIntervalImpl ?? ((h, ms) => setInterval(h, ms));
  const stop = options.clearIntervalImpl ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
  const handle = start(() => limiter.sweep(idleMs), intervalMs);
  if (handle && typeof (handle as { unref?: () => void }).unref === 'function') {
    (handle as { unref: () => void }).unref();
  }
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      stop(handle);
    },
  };
}

/**
 * The client key a limit is applied per: the left-most `X-Forwarded-For` hop when present (the
 * originating client, as set by a trusted proxy), else the socket address, else a shared `unknown`
 * bucket.
 *
 * **Trust caveat, stated because it is load-bearing:** `X-Forwarded-For` is client-supplied and
 * trivially spoofed unless a trusted proxy overwrites it. Preferring it is correct behind a CDN or
 * load balancer (otherwise every request keys to the proxy and one abusive client throttles
 * everyone), and wrong when the service is exposed directly. Since these services are not deployed
 * yet, the deployment posture — and therefore whether this header may be trusted — is a 10.F
 * decision recorded there rather than guessed here.
 */
/**
 * The client address, resolved so that the CALLER CANNOT CHOOSE IT.
 *
 * 2026-08-31, found while running the territory gate's negative cases: the
 * previous implementation took `X-Forwarded-For.split(',')[0]` — the LEFTMOST
 * entry. A proxy APPENDS to that header, it does not overwrite it, so the
 * leftmost entry is whatever the caller typed. Sending
 * `X-Forwarded-For: <a Belgian address>` made the live service report Belgium
 * and refuse the entry; sending nothing made it allow. The caller chose the
 * verdict of a gate whose whole purpose is that they cannot.
 *
 * That is a territory-gate bypass (PID §8 / CLAUDE.md tradeoff #2) and it was
 * also a rate-limit bypass, since the limiter keyed on the same value.
 *
 * Resolution order, most trustworthy first:
 *
 *   1. `Fly-Client-IP` — set by Fly Proxy from the peer it actually sees, and
 *      OVERWRITTEN on every request, so a client cannot forge it (Fly's
 *      request-headers documentation).
 *   2. The RIGHTMOST `X-Forwarded-For` entry — the address our own proxy
 *      observed and appended. Anything to its left came from the caller.
 *   3. The socket peer, when we are not behind a proxy at all.
 *
 * `trustProxy` still gates 1 and 2: exposed directly, every header is the
 * caller's and only the socket may be believed.
 */
export function clientKeyFrom(
  forwardedFor: string | string[] | undefined,
  remoteAddress: string | undefined,
  flyClientIp?: string | string[] | undefined
): string {
  const one = (v: string | string[] | undefined): string | undefined =>
    (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

  const fly = one(flyClientIp);
  if (fly) return fly;

  const raw = one(forwardedFor);
  if (raw) {
    // The LAST hop, not the first. The first is caller-supplied.
    const hops = raw
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return remoteAddress ?? 'unknown';
}

/** The 429 body every hardened surface returns — one shape, so a consumer branches once. */
export const RATE_LIMITED_BODY = { error: 'rate limited' } as const;

// ── CORS ───────────────────────────────────────────────────────────────────────────────────────

/**
 * CORS configuration. An EMPTY allowlist is the default and means "emit no CORS headers at all" —
 * there is deliberately no separate on/off flag and no wildcard support: the presence of an origin
 * IS the enablement, so a misconfiguration cannot accidentally open the surface to `*`.
 *
 * Why an allowlist rather than `*` even for public read data: the responses are public, so `*`
 * would leak nothing today — but these services will gain authenticated surfaces (BR-002's
 * sessions), and a `*` inherited from the read era is exactly how a credentialed endpoint ends up
 * readable by any origin. Starting closed costs one env var.
 */
export interface CorsConfig {
  /** Exact-match allowed origins (scheme + host + port). Empty ⇒ no CORS headers emitted. */
  allowedOrigins: readonly string[];
  /**
   * Methods advertised on the allow-header. Default `GET, OPTIONS` — the read surface. A service
   * with a browser-facing write surface (the packet service: `/packet`, `/attestation`,
   * `/ciphertexts`, `/notify` are all POSTed by the app) overrides this at wiring time; env
   * config deliberately cannot, because which methods a surface accepts is a property of the
   * code, not of a deployment.
   */
  allowMethods?: string;
  /**
   * Request headers allowed on preflight. Unset ⇒ header not emitted (the read surface sends
   * none). A JSON-POSTing surface needs at least `content-type`, or every browser preflight
   * fails and the write surface is unreachable cross-origin.
   */
  allowHeaders?: string;
}

/**
 * The CORS response headers for a request from `origin`, or `{}` when CORS is not in play.
 *
 * `Vary: Origin` accompanies every emitted allow-header: the response now genuinely differs by
 * request origin, and a shared cache that does not know that will serve one origin's response to
 * another — the cache-poisoning failure this pairing exists to prevent. The allowed methods
 * default to `GET, OPTIONS` (the read surface); a write surface widens them in code via
 * {@link CorsConfig.allowMethods}, never via env.
 */
export function corsHeadersFor(
  origin: string | string[] | undefined,
  config: CorsConfig
): Record<string, string> {
  const requested = Array.isArray(origin) ? origin[0] : origin;
  if (!requested || config.allowedOrigins.length === 0) {
    return {};
  }
  if (!config.allowedOrigins.includes(requested)) {
    // A disallowed origin gets NO allow-header: the browser then blocks the read, which is the
    // whole mechanism. The response body is unchanged — CORS is a browser policy, not auth.
    return { Vary: 'Origin' };
  }
  return {
    'Access-Control-Allow-Origin': requested,
    'Access-Control-Allow-Methods': config.allowMethods ?? 'GET, OPTIONS',
    ...(config.allowHeaders
      ? { 'Access-Control-Allow-Headers': config.allowHeaders }
      : {}),
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** True when the request is a CORS preflight (an `OPTIONS` carrying `Origin`). */
export function isPreflight(
  method: string | undefined,
  origin: string | string[] | undefined
): boolean {
  return method === 'OPTIONS' && Boolean(Array.isArray(origin) ? origin[0] : origin);
}

// ── Security headers ───────────────────────────────────────────────────────────────────────────

/**
 * Response hardening headers for a JSON API, applied only when enabled so the default posture is
 * unchanged. Deliberately minimal and JSON-appropriate:
 *
 * - `X-Content-Type-Options: nosniff` — stops a browser second-guessing `application/json`.
 * - `Referrer-Policy: no-referrer` — these URLs carry wallet addresses in the path; they should not
 *   travel in a `Referer` to anywhere else.
 * - `X-Frame-Options: DENY` — no JSON response has any business being framed.
 *
 * No `Content-Security-Policy` and no `Strict-Transport-Security`: a CSP governs documents, not
 * JSON, and HSTS is a property of the TLS-terminating host (a 10.F deployment decision), so
 * emitting either from here would be theatre.
 */
export function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  };
}

// ── The combined seam each service's socket layer uses ─────────────────────────────────────────

/** Everything BR-005 needs to decide about one request, resolved from config once at startup. */
export interface HygieneConfig {
  rateLimit: RateLimitConfig;
  cors: CorsConfig;
  /** Default OFF — when false, {@link securityHeaders} is not applied. */
  securityHeadersEnabled: boolean;
}

/** Request facts the hygiene layer reads (all supplied by the socket wiring). */
export interface HygieneRequest {
  method: string | undefined;
  forwardedFor: string | string[] | undefined;
  remoteAddress: string | undefined;
  /** Fly Proxy's own view of the peer; unforgeable because the proxy
   * overwrites it. Preferred over X-Forwarded-For — see `clientKeyFrom`. */
  flyClientIp?: string | string[] | undefined;
  origin: string | string[] | undefined;
}

/**
 * What the socket layer should do with a request before routing it.
 *
 * `kind: 'continue'` carries the headers to merge into whatever the route returns; `'preflight'`
 * and `'rate_limited'` are complete answers the socket sends without touching the router — a
 * refused request must not reach the store, which is the point of refusing it.
 */
export type HygieneOutcome =
  | { kind: 'continue'; headers: Record<string, string> }
  | { kind: 'preflight'; status: 204; headers: Record<string, string> }
  | { kind: 'rate_limited'; status: 429; headers: Record<string, string>; body: unknown };

/**
 * Apply BR-005's hygiene to one request. Order is deliberate: **preflight first** (a browser's
 * `OPTIONS` must be answerable even when the client is over its budget, or the browser reports a
 * CORS failure for what is really a rate limit — two very different bug reports), then the rate
 * limit, then the headers that decorate a normal response.
 */
export function applyHygiene(
  req: HygieneRequest,
  config: HygieneConfig,
  limiter: RateLimiter
): HygieneOutcome {
  const cors = corsHeadersFor(req.origin, config.cors);
  const security = config.securityHeadersEnabled ? securityHeaders() : {};

  // Preflights are intercepted ONLY when CORS is actually configured. With an empty allowlist we
  // are not doing CORS at all, so an OPTIONS-with-Origin must fall through to the router and get
  // the ordinary non-GET 405 — the byte-for-byte pre-BR-005 wire. (Found by the pre-Phase-C
  // closeout bench, 2026-08-22: the unconditional intercept answered a bare 204 in the default
  // posture, which the unit suites missed because their preflight specs all ran with an allowlist
  // configured. A disallowed origin against a NON-empty allowlist still gets the 204-without-
  // allow-header — the browser blocks it, which is the mechanism.)
  if (config.cors.allowedOrigins.length > 0 && isPreflight(req.method, req.origin)) {
    return { kind: 'preflight', status: 204, headers: { ...cors, ...security } };
  }

  const decision = limiter.check(
    clientKeyFrom(req.forwardedFor, req.remoteAddress, req.flyClientIp)
  );
  if (!decision.allowed) {
    return {
      kind: 'rate_limited',
      status: 429,
      headers: {
        ...cors,
        ...security,
        'Retry-After': String(decision.retryAfterSeconds),
        // Never let a shared cache hold a 429 and serve it to someone who is not over budget.
        'Cache-Control': 'no-store',
      },
      body: RATE_LIMITED_BODY,
    };
  }

  return { kind: 'continue', headers: { ...cors, ...security } };
}

// ── Config ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Env var names, shared by every hardened service (one posture, one set of knobs — a per-service
 * naming split is how two surfaces end up hardened differently by accident).
 */
export const HYGIENE_ENV = {
  /** Activation gate for the limiter. Default OFF. */
  rateLimitEnabled: 'BLOTTO_API_RATE_LIMIT_ENABLED',
  /** Sustained requests/minute/client (default {@link PROPOSED_RATE_LIMIT_RPM}, a PROPOSAL). */
  rateLimitRpm: 'BLOTTO_API_RATE_LIMIT_RPM',
  /** Burst capacity (default {@link PROPOSED_RATE_LIMIT_BURST}, a PROPOSAL). */
  rateLimitBurst: 'BLOTTO_API_RATE_LIMIT_BURST',
  /** `Retry-After` seconds (default {@link PROPOSED_RATE_LIMIT_RETRY_AFTER_SECONDS}, a PROPOSAL). */
  rateLimitRetryAfter: 'BLOTTO_API_RATE_LIMIT_RETRY_AFTER_SECONDS',
  /** Comma-separated exact-match origin allowlist. EMPTY (default) ⇒ no CORS headers at all. */
  corsOrigins: 'BLOTTO_API_CORS_ORIGINS',
  /** Activation gate for the JSON hardening headers. Default OFF. */
  securityHeadersEnabled: 'BLOTTO_API_SECURITY_HEADERS_ENABLED',
} as const;

/**
 * Resolve the hygiene posture from env. Fail-closed on a malformed number (`parsePositiveInt`
 * throws) rather than silently falling back to a proposal the operator did not choose — the same
 * rule every other numeric config key in this repo follows.
 *
 * All three knobs default to their OFF/empty state, so a service that calls this and wires the
 * result is unchanged on the wire until someone deliberately configures it.
 */
export function loadHygieneConfig(
  env: NodeJS.ProcessEnv = process.env
): HygieneConfig {
  const origins = optional(env, HYGIENE_ENV.corsOrigins, '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return {
    rateLimit: {
      enabled: parseBool(env[HYGIENE_ENV.rateLimitEnabled]),
      requestsPerMinute: parsePositiveInt(
        env,
        HYGIENE_ENV.rateLimitRpm,
        PROPOSED_RATE_LIMIT_RPM
      ),
      burst: parsePositiveInt(env, HYGIENE_ENV.rateLimitBurst, PROPOSED_RATE_LIMIT_BURST),
      retryAfterSeconds: parsePositiveInt(
        env,
        HYGIENE_ENV.rateLimitRetryAfter,
        PROPOSED_RATE_LIMIT_RETRY_AFTER_SECONDS
      ),
    },
    cors: { allowedOrigins: origins },
    securityHeadersEnabled: parseBool(env[HYGIENE_ENV.securityHeadersEnabled]),
  };
}
