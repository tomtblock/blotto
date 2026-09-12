/*
 * The header, rendered, in the failure state (audit 2026-09-11, C-03).
 *
 * `react-dom/server` needs no DOM, so this runs in the node suite. The
 * assertion is the one the audit asked for: after the deadline a REACHABLE
 * CONTROL exists — the link to /signin — where before there was an inert
 * placeholder for as long as the provider stayed silent.
 *
 * next/link is replaced by a plain anchor: what is under test is which
 * branch the header takes for a given Auth, not the router.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppHeader } from '@/components/shell/app-header';
import { AuthContext } from './auth-context';
import { INITIALIZING, selectAuth } from './auth-select';
import type { Auth } from './types';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function header(auth: Auth): string {
  // The signed-in branch reads the balance through react-query; a fresh
  // client per render keeps that branch renderable and nothing is fetched.
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider value={auth}>
        <AppHeader />
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

const base = {
  injected: null,
  live: null,
  appId: 'app-id',
  bridgeRejected: false,
  bridgeTimedOut: false,
  detected: [],
};

describe('the header after the sign-in provider goes silent', () => {
  it('while initializing there is no control — the placeholder holds the slot', () => {
    const html = header(selectAuth(base));
    expect(html).not.toContain('href="/signin"');
    expect(html).toContain('aria-hidden');
  });

  it('after the deadline the sign-in link is rendered', () => {
    const html = header(selectAuth({ ...base, bridgeTimedOut: true }));
    expect(html).toContain('href="/signin"');
    expect(html).toContain('sign in');
    expect(html).not.toContain('aria-hidden');
  });

  it('the same link a build with no credential gets', () => {
    expect(header(selectAuth({ ...base, appId: undefined }))).toContain('href="/signin"');
  });

  it('a signed-in provider still renders the wallet row, never the link', () => {
    const live: Auth = {
      ...INITIALIZING,
      status: 'signed-in',
      walletAddress: '4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1',
    };
    const html = header(selectAuth({ ...base, bridgeTimedOut: true, live }));
    expect(html).not.toContain('href="/signin"');
    expect(html).toContain('disconnect');
    expect(html).toContain('href="/wallet"');
  });
});
