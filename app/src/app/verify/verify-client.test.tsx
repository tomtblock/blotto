/*
 * The verify page's inputs and verdicts, rendered (audit 2026-09-11).
 *
 * `react-dom/server` needs no DOM, so this runs in the node suite;
 * next/navigation and next/link are replaced because what is under test is
 * which branch the page takes, not the router.
 *
 *  - D-04: the bundle address is PREFILLED from the link. The verify page
 *    used to open with an empty bundle field on every journey into it, and
 *    a player who did not already know the gateway address had nothing to
 *    fetch and nothing to check.
 *  - D-10 / D-29: the report has three verdicts, and the third one is drawn
 *    as neither a pass nor a mismatch.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { COPY } from '@/copy';
import { VerifyAlways } from '@/app/pools/[pool]/results/results-reveal';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const searchParams = new Map<string, string>();
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => searchParams.get(k) ?? null }),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const POOL = 'Poo1111111111111111111111111111111111111111';
const URI = 'https://gateway.example/tx/abc?x=1&y=2';

// Imported after the mocks are registered (the module reads them on render).
const { VerifyClient } = await import('./verify-client');

describe('the verify page inputs (D-04)', () => {
  it('prefills the bundle address from the link', () => {
    searchParams.clear();
    searchParams.set('pool', POOL);
    searchParams.set('bundle', URI);
    const html = renderToString(<VerifyClient />);
    expect(html).toContain(POOL);
    // The finding: this value never reached the field.
    expect(html).toContain(URI.replace(/&/g, '&amp;'));
  });

  it('still opens with an empty field when no address was carried', () => {
    searchParams.clear();
    searchParams.set('pool', POOL);
    const html = renderToString(<VerifyClient />);
    expect(html).not.toContain('gateway.example');
  });
});

describe('the results page hands the address on (D-04)', () => {
  it('carries the published bundle address into the verify link', () => {
    const html = renderToString(<VerifyAlways pool={POOL} bundleUri={URI} />);
    expect(html).toContain(`bundle=${encodeURIComponent(URI)}`);
    expect(html).toContain(`pool=${POOL}`);
  });

  it('links the pool alone when this page has no verified archive', () => {
    const html = renderToString(<VerifyAlways pool={POOL} />);
    expect(html).toContain(`/verify?pool=${POOL}`);
    expect(html).not.toContain('bundle=');
  });
});

describe('the page states the third verdict (D-10 / D-29)', () => {
  it('has copy for it that reads as neither a pass nor a mismatch', () => {
    // The verdict banner renders COPY.verify[verdict]; a missing string
    // would render an empty banner over a report that is not green.
    expect(COPY.verify.incomplete).toBeTruthy();
    expect(COPY.verify.incomplete).not.toBe(COPY.verify.match);
    expect(COPY.verify.incomplete).not.toBe(COPY.verify.mismatch);
    // The guide must tell a reader the third answer exists at all.
    expect(COPY.verify.howVerdict).toMatch(/third/i);
  });
});
