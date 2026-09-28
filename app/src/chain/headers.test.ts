/*
 * The app's security response headers (audit 2026-09-11, B-54).
 *
 * The finding: none shipped — no content-security policy, no
 * frame-ancestors, no clickjacking protection at all, on a site whose whole
 * purpose is prompting a wallet to sign. Loaded inside an attacker's
 * iframe, over a page of their choosing, a player reads their words while
 * approving ours.
 *
 * The policy is asserted through `next.config.ts`'s own `headers()`, so
 * this checks what the app actually serves rather than a copy of it. Both
 * directions are checked: the lines that must be present, and — the part
 * that matters for a policy nobody re-reads — that it is not so tight that
 * it breaks the entry path it has to allow.
 */
import { describe, expect, it } from 'vitest';

type HeaderEntry = { key: string; value: string };
type HeaderRule = { source: string; headers: HeaderEntry[] };

async function served(): Promise<Map<string, string>> {
  const config = (await import('../../next.config')).default;
  const rules = (await config.headers?.()) as HeaderRule[] | undefined;
  expect(rules, 'next.config.ts declares response headers').toBeTruthy();
  const all = rules!.filter((r) => r.source === '/:path*');
  expect(all.length, 'the rules apply to every path').toBe(1);
  return new Map(all[0].headers.map((h) => [h.key, h.value]));
}

const directives = async (): Promise<Map<string, string>> => {
  const csp = (await served()).get('Content-Security-Policy');
  expect(csp, 'a content-security policy is served').toBeTruthy();
  return new Map(
    csp!.split(';').map((part) => {
      const [name, ...rest] = part.trim().split(/\s+/);
      return [name, rest.join(' ')];
    })
  );
};

describe('the security headers', () => {
  it('refuses framing — the clickjacking finding, in both spellings', async () => {
    expect((await directives()).get('frame-ancestors')).toBe("'none'");
    expect((await served()).get('X-Frame-Options')).toBe('DENY');
  });

  it('serves the companions the audit named', async () => {
    const headers = await served();
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toMatch(/camera=\(\)/);
    expect(headers.get('Strict-Transport-Security')).toMatch(/max-age=\d+/);
  });

  it('allows no foreign script origin, and nothing to be embedded as an object', async () => {
    const csp = await directives();
    expect(csp.get('default-src')).toBe("'self'");
    expect(csp.get('script-src')).toMatch(/^'self'/);
    expect(csp.get('script-src')).not.toMatch(/https:/);
    expect(csp.get('object-src')).toBe("'none'");
    expect(csp.get('base-uri')).toBe("'self'");
    expect(csp.get('form-action')).toBe("'self'");
  });

  /*
   * The other half of the danger: a policy too tight to let entry happen is
   * an outage on the money path, and it would be found by a player rather
   * than by us. Each of these is something the app demonstrably does.
   */
  it('allows what the app actually contacts', async () => {
    const csp = await directives();
    // The RPC, the indexer, the entry and review services are deployment
    // variables, and the verify page fetches a bundle URI the PLAYER types
    // (R13: verification must work against a hostile or absent operator).
    expect(csp.get('connect-src')).toMatch(/https:/);
    // Solana RPC subscriptions are a websocket (privy-bridge.tsx).
    expect(csp.get('connect-src')).toMatch(/wss:/);
    // The mobile wallet standard's loopback socket on Android
    // (wallet/mobile-wallet.tsx, D-E18): the phone's own address, plain ws.
    expect(csp.get('connect-src')).toMatch(/ws:\/\/localhost:\*/);
    expect(csp.get('connect-src')).toMatch(/ws:\/\/127\.0\.0\.1:\*/);
    // …and ONLY the loopback: no plain-ws remote host may ever be listed.
    const plainWs = csp.get('connect-src')!.split(/\s+/).filter((s) => s.startsWith('ws://'));
    expect(plainWs.every((s) => /^ws:\/\/(localhost|127\.0\.0\.1):\*$/.test(s))).toBe(true);
    // The auth provider's embedded-wallet iframe.
    expect(csp.get('frame-src')).toMatch(/auth\.privy\.io/);
    // Wallet-standard wallets register their icons as data URIs, and the
    // provider's embedded-wallet screens draw from blob URLs.
    expect(csp.get('img-src')).toMatch(/data:/);
    expect(csp.get('img-src')).toMatch(/blob:/);
    // Next's framework bootstrap is inline (see the config's note on the
    // nonce alternative).
    expect(csp.get('script-src')).toMatch(/'unsafe-inline'/);
  });

  it('does not ship the dev-only eval allowance in a production build', async () => {
    // `next build` sets NODE_ENV=production, which is when this matters;
    // the suite runs as "test", so this asserts the rule the config uses
    // rather than the value it happens to produce here.
    const source = (await import('node:fs')).readFileSync(
      (await import('node:url')).fileURLToPath(new URL('../../next.config.ts', import.meta.url)),
      'utf8'
    );
    expect(source).toMatch(/NODE_ENV !== "production"/);
    expect(source).toMatch(/dev \? " 'unsafe-eval'" : ""/);
  });
});
