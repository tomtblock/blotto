/**
 * BR-005 public-API hardening specs.
 *
 * ⚠ **These test the MECHANISM against a CONFIGURED value — they deliberately do NOT assert that
 * 600 rpm / 120 burst / 1 s `Retry-After` are canon.** Those three numbers are architect proposals
 * carrying `AWAITING_RATIFICATION` (the `PROPOSED_FALLBACK_DELAY_MS` precedent), and a spec that
 * pinned them as canon would be exactly the false-positive the constants register logs as a
 * defect class (§D). The only assertion made about the proposals themselves is that they are the
 * DEFAULTS the loader falls back to, and — separately, and on purpose — that they are wide enough
 * not to trip the QA bench, which is a property the BR_Roadmap trade explicitly requires.
 */
import { expect } from 'chai';
import {
  PROPOSED_RATE_LIMIT_BURST,
  PROPOSED_RATE_LIMIT_RETRY_AFTER_SECONDS,
  PROPOSED_RATE_LIMIT_RPM,
  RATE_LIMITED_BODY,
  RateLimiter,
  applyHygiene,
  clientKeyFrom,
  corsHeadersFor,
  isPreflight,
  loadHygieneConfig,
  securityHeaders,
  type HygieneConfig,
} from '../src';

/** A hand-cranked clock: the limiter must be testable without sleeping. */
function fakeClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

const limitConfig = (over: Partial<HygieneConfig['rateLimit']> = {}) => ({
  enabled: true,
  requestsPerMinute: 60,
  burst: 3,
  retryAfterSeconds: 1,
  ...over,
});

describe('RateLimiter', () => {
  it('is a NO-OP when disabled — the default posture keeps no state at all', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(limitConfig({ enabled: false }), clock.now);
    for (let i = 0; i < 1_000; i++) {
      expect(limiter.check('ip')).to.deep.equal({ allowed: true });
    }
    // Nothing was recorded: a disabled limiter cannot leak memory or shape traffic.
    expect(limiter.size()).to.equal(0);
  });

  it('allows up to the burst, then refuses with the configured Retry-After', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(limitConfig({ burst: 3, retryAfterSeconds: 7 }), clock.now);
    expect(limiter.check('ip').allowed).to.equal(true);
    expect(limiter.check('ip').allowed).to.equal(true);
    expect(limiter.check('ip').allowed).to.equal(true);
    const refused = limiter.check('ip');
    expect(refused.allowed).to.equal(false);
    // The value comes from CONFIG, not from a literal in the limiter.
    expect(refused.retryAfterSeconds).to.equal(7);
  });

  it('refills continuously at the configured rate', () => {
    const clock = fakeClock();
    // 60 rpm = one token per 1000 ms.
    const limiter = new RateLimiter(limitConfig({ requestsPerMinute: 60, burst: 1 }), clock.now);
    expect(limiter.check('ip').allowed).to.equal(true);
    expect(limiter.check('ip').allowed).to.equal(false);
    clock.advance(999);
    expect(limiter.check('ip').allowed, 'just under one token').to.equal(false);
    clock.advance(1);
    expect(limiter.check('ip').allowed, 'exactly one token').to.equal(true);
  });

  it('never refills above the burst ceiling (idle time does not bank credit)', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(limitConfig({ requestsPerMinute: 60, burst: 2 }), clock.now);
    clock.advance(60 * 60 * 1000); // idle an hour
    expect(limiter.check('ip').allowed).to.equal(true);
    expect(limiter.check('ip').allowed).to.equal(true);
    expect(limiter.check('ip').allowed, 'capacity is the ceiling').to.equal(false);
  });

  it('does not charge a refused request (retrying never pushes a client further into debt)', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(limitConfig({ requestsPerMinute: 60, burst: 1 }), clock.now);
    limiter.check('ip'); // spend the only token
    for (let i = 0; i < 50; i++) {
      expect(limiter.check('ip').allowed).to.equal(false);
    }
    // One second's worth of refill is enough again, despite 50 refusals in between.
    clock.advance(1_000);
    expect(limiter.check('ip').allowed).to.equal(true);
  });

  it('budgets per client key — one abuser does not throttle anyone else', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(limitConfig({ burst: 1 }), clock.now);
    expect(limiter.check('abuser').allowed).to.equal(true);
    expect(limiter.check('abuser').allowed).to.equal(false);
    expect(limiter.check('someone-else').allowed, 'unaffected').to.equal(true);
  });

  it('sweeps idle buckets so an unbounded key space cannot become a memory leak', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(limitConfig(), clock.now);
    for (let i = 0; i < 100; i++) {
      limiter.check(`ip-${i}`);
    }
    expect(limiter.size()).to.equal(100);
    clock.advance(10_000);
    limiter.check('recent');
    limiter.sweep(5_000);
    // The 100 idle buckets are gone; the just-touched one survives.
    expect(limiter.size()).to.equal(1);
  });
});

describe('clientKeyFrom', () => {
  it('prefers the left-most X-Forwarded-For hop (the originating client behind a proxy)', () => {
    expect(clientKeyFrom('1.2.3.4, 10.0.0.1', '10.0.0.1')).to.equal('1.2.3.4');
    expect(clientKeyFrom(['5.6.7.8, 10.0.0.1'], '10.0.0.1')).to.equal('5.6.7.8');
  });

  it('falls back to the socket address, then to a shared bucket', () => {
    expect(clientKeyFrom(undefined, '9.9.9.9')).to.equal('9.9.9.9');
    expect(clientKeyFrom('', '9.9.9.9')).to.equal('9.9.9.9');
    expect(clientKeyFrom(undefined, undefined)).to.equal('unknown');
  });
});

describe('corsHeadersFor', () => {
  const config = { allowedOrigins: ['https://example.invalid'] };

  it('emits NOTHING when no origin is configured (the default posture)', () => {
    expect(corsHeadersFor('https://example.invalid', { allowedOrigins: [] })).to.deep.equal({});
    // …and nothing for a non-browser request either, even with an allowlist present.
    expect(corsHeadersFor(undefined, config)).to.deep.equal({});
  });

  it('allows an exact-match origin, and pairs every allow-header with Vary: Origin', () => {
    expect(corsHeadersFor('https://example.invalid', config)).to.deep.equal({
      'Access-Control-Allow-Origin': 'https://example.invalid',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    });
  });

  it('refuses a non-matching origin — no allow-header, but still Vary (cache correctness)', () => {
    const headers = corsHeadersFor('https://evil.example', config);
    expect(headers['Access-Control-Allow-Origin']).to.equal(undefined);
    // A response that differs by origin MUST say so, or a shared cache serves one origin's
    // answer to another. That is why the refusal still varies.
    expect(headers.Vary).to.equal('Origin');
  });

  it('never wildcards, and never matches by prefix or subdomain', () => {
    for (const origin of [
      '*',
      'https://example.invalid.evil.example',
      'https://sub.example.invalid',
      'http://example.invalid',
      'https://example.invalid/',
    ]) {
      expect(corsHeadersFor(origin, config)['Access-Control-Allow-Origin'], origin).to.equal(
        undefined
      );
    }
  });
});

describe('isPreflight', () => {
  it('is an OPTIONS carrying an Origin, and nothing else', () => {
    expect(isPreflight('OPTIONS', 'https://example.invalid')).to.equal(true);
    expect(isPreflight('OPTIONS', undefined)).to.equal(false);
    expect(isPreflight('GET', 'https://example.invalid')).to.equal(false);
  });
});

describe('securityHeaders', () => {
  it('is JSON-appropriate hardening only — no CSP, no HSTS', () => {
    const h = securityHeaders();
    expect(h).to.deep.equal({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    // A CSP governs documents, not JSON; HSTS belongs to the TLS terminator (a 10.F decision).
    expect(h['Content-Security-Policy']).to.equal(undefined);
    expect(h['Strict-Transport-Security']).to.equal(undefined);
  });
});

describe('applyHygiene', () => {
  const off: HygieneConfig = {
    rateLimit: limitConfig({ enabled: false }),
    cors: { allowedOrigins: [] },
    securityHeadersEnabled: false,
  };
  const on: HygieneConfig = {
    rateLimit: limitConfig({ burst: 1 }),
    cors: { allowedOrigins: ['https://example.invalid'] },
    securityHeadersEnabled: true,
  };
  const req = (over: Partial<Parameters<typeof applyHygiene>[0]> = {}) => ({
    method: 'GET',
    forwardedFor: undefined,
    remoteAddress: '1.1.1.1',
    origin: undefined,
    ...over,
  });

  it('adds NO headers in the fully default posture (the byte-for-byte guarantee)', () => {
    const outcome = applyHygiene(req(), off, new RateLimiter(off.rateLimit));
    expect(outcome).to.deep.equal({ kind: 'continue', headers: {} });
  });

  it('does NOT intercept an OPTIONS-with-Origin when no allowlist is configured (falls through to the router → 405)', () => {
    // The byte-for-byte guarantee includes browser preflights: pre-BR-005 an OPTIONS carrying an
    // Origin got the router's ordinary 405, and with every knob OFF it still must. Found by the
    // pre-Phase-C closeout bench — the earlier unconditional intercept served a bare 204 here.
    const outcome = applyHygiene(
      req({ method: 'OPTIONS', origin: 'https://example.invalid' }),
      off,
      new RateLimiter(off.rateLimit),
    );
    expect(outcome).to.deep.equal({ kind: 'continue', headers: {} });
  });

  it('answers a preflight with 204 + the CORS headers, without spending a token', () => {
    const limiter = new RateLimiter(on.rateLimit, fakeClock().now);
    const outcome = applyHygiene(
      req({ method: 'OPTIONS', origin: 'https://example.invalid' }),
      on,
      limiter
    );
    expect(outcome.kind).to.equal('preflight');
    if (outcome.kind !== 'preflight') throw new Error('unreachable');
    expect(outcome.status).to.equal(204);
    expect(outcome.headers['Access-Control-Allow-Origin']).to.equal('https://example.invalid');
    expect(outcome.headers['X-Content-Type-Options']).to.equal('nosniff');
    // The budget is untouched: a browser's preflight must be answerable even for a client that is
    // over its limit, or a rate limit surfaces to the user as a CORS failure.
    expect(limiter.size()).to.equal(0);
  });

  it('refuses over-budget traffic with 429 + Retry-After + no-store, and never routes it', () => {
    const limiter = new RateLimiter(on.rateLimit, fakeClock().now);
    expect(applyHygiene(req(), on, limiter).kind).to.equal('continue');
    const outcome = applyHygiene(req(), on, limiter);
    expect(outcome.kind).to.equal('rate_limited');
    if (outcome.kind !== 'rate_limited') throw new Error('unreachable');
    expect(outcome.status).to.equal(429);
    expect(outcome.body).to.deep.equal(RATE_LIMITED_BODY);
    expect(outcome.headers['Retry-After']).to.equal('1');
    // A shared cache must never hold a 429 and serve it to a client who is within budget.
    expect(outcome.headers['Cache-Control']).to.equal('no-store');
  });

  it('carries the CORS + security headers onto a 429 too (a refused browser read must still be readable)', () => {
    const limiter = new RateLimiter(on.rateLimit, fakeClock().now);
    applyHygiene(req({ origin: 'https://example.invalid' }), on, limiter);
    const outcome = applyHygiene(req({ origin: 'https://example.invalid' }), on, limiter);
    if (outcome.kind !== 'rate_limited') throw new Error('unreachable');
    // Without this, the browser reports an opaque CORS error instead of the 429 the client needs
    // to see in order to back off.
    expect(outcome.headers['Access-Control-Allow-Origin']).to.equal('https://example.invalid');
    expect(outcome.headers['X-Frame-Options']).to.equal('DENY');
  });

  it('keys the limit off the forwarded client, not the proxy', () => {
    const limiter = new RateLimiter(on.rateLimit, fakeClock().now);
    const viaProxy = (ip: string) =>
      applyHygiene(req({ forwardedFor: `${ip}, 10.0.0.1`, remoteAddress: '10.0.0.1' }), on, limiter)
        .kind;
    expect(viaProxy('2.2.2.2')).to.equal('continue');
    expect(viaProxy('2.2.2.2'), 'same client, over budget').to.equal('rate_limited');
    expect(viaProxy('3.3.3.3'), 'different client behind the same proxy').to.equal('continue');
  });
});

describe('loadHygieneConfig', () => {
  it('defaults every knob to OFF / empty (deploy ≠ go-live)', () => {
    const config = loadHygieneConfig({});
    expect(config.rateLimit.enabled).to.equal(false);
    expect(config.cors.allowedOrigins).to.deep.equal([]);
    expect(config.securityHeadersEnabled).to.equal(false);
  });

  it('falls back to the PROPOSED values as defaults (a proposal, not a canon assertion)', () => {
    const config = loadHygieneConfig({});
    expect(config.rateLimit.requestsPerMinute).to.equal(PROPOSED_RATE_LIMIT_RPM);
    expect(config.rateLimit.burst).to.equal(PROPOSED_RATE_LIMIT_BURST);
    expect(config.rateLimit.retryAfterSeconds).to.equal(
      PROPOSED_RATE_LIMIT_RETRY_AFTER_SECONDS
    );
  });

  it('enables the limiter only on an explicit truthy flag, and takes numeric overrides', () => {
    expect(loadHygieneConfig({ BLOTTO_API_RATE_LIMIT_ENABLED: 'true' }).rateLimit.enabled).to.equal(
      true
    );
    expect(loadHygieneConfig({ BLOTTO_API_RATE_LIMIT_ENABLED: 'maybe' }).rateLimit.enabled).to.equal(
      false
    );
    const tuned = loadHygieneConfig({
      BLOTTO_API_RATE_LIMIT_RPM: '30',
      BLOTTO_API_RATE_LIMIT_BURST: '5',
      BLOTTO_API_RATE_LIMIT_RETRY_AFTER_SECONDS: '9',
    });
    expect(tuned.rateLimit.requestsPerMinute).to.equal(30);
    expect(tuned.rateLimit.burst).to.equal(5);
    expect(tuned.rateLimit.retryAfterSeconds).to.equal(9);
  });

  it('fails closed on a malformed number (never silently uses the proposal)', () => {
    expect(() => loadHygieneConfig({ BLOTTO_API_RATE_LIMIT_RPM: 'lots' })).to.throw();
    expect(() => loadHygieneConfig({ BLOTTO_API_RATE_LIMIT_BURST: '0' })).to.throw();
    expect(() => loadHygieneConfig({ BLOTTO_API_RATE_LIMIT_RETRY_AFTER_SECONDS: '-1' })).to.throw();
  });

  it('parses the CORS allowlist as exact origins, trimming and dropping blanks', () => {
    const config = loadHygieneConfig({
      BLOTTO_API_CORS_ORIGINS: ' https://example.invalid , https://preview.example.invalid ,, ',
    });
    expect(config.cors.allowedOrigins).to.deep.equal([
      'https://example.invalid',
      'https://preview.example.invalid',
    ]);
  });

  it('treats an empty allowlist as CORS-off rather than as a wildcard', () => {
    const config = loadHygieneConfig({ BLOTTO_API_CORS_ORIGINS: '  ,  ' });
    expect(config.cors.allowedOrigins).to.deep.equal([]);
    expect(corsHeadersFor('https://anything.example', config.cors)).to.deep.equal({});
  });
});

describe('the proposed defaults vs the QA bench (the BR_Roadmap Section 2 trade)', () => {
  it('absorbs the §B2 idempotency storm and a Newman-shaped burst without refusing', () => {
    // The trade recorded in BR_Roadmap Section 2 is that a limit tight enough to matter is a limit
    // the bench can trip. The proposals must therefore clear the bench's own shape with room:
    // §B2 fires 10 concurrent requests (`-n 10`), and a full Newman pass is ~28 requests per
    // collection across several passes. This asserts the PROPOSALS satisfy that property — it is a
    // statement about bench-compatibility, not a claim that the numbers are canon.
    const clock = fakeClock();
    const config = loadHygieneConfig({ BLOTTO_API_RATE_LIMIT_ENABLED: 'true' });
    const limiter = new RateLimiter(config.rateLimit, clock.now);
    let refused = 0;
    for (let i = 0; i < 100; i++) {
      if (!limiter.check('bench').allowed) refused += 1;
    }
    expect(refused, '100 back-to-back bench requests must all pass').to.equal(0);
  });
});
