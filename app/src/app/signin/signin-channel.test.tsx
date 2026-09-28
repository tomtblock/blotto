/*
 * The sign-in surface per channel (2026-09-28, D-E18).
 *
 * Rendered to a string, no DOM: what is under test is WHICH controls the
 * page draws for a given channel, not the router. The web surface is
 * asserted first and in full — the shell must change nothing there — then
 * the shell's, which is the web's wallet rows without the routes that
 * cannot open inside an embedded WebView.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AuthContext } from '@/wallet/auth-context';
import { INITIALIZING } from '@/wallet/auth-select';
import type { Auth, DetectedWallet } from '@/wallet/types';
import type { Channel } from '@/channel/channel';
import { COPY } from '@/copy';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

// The channel is a fact about the browser; the test names it.
let channel: Channel = 'web';
vi.mock('@/channel/use-channel', () => ({ useChannel: () => channel }));

const { SignInClient } = await import('./signin-client');

const PHANTOM: DetectedWallet = { id: 'phantom', name: 'Phantom', icon: 'data:image/svg+xml;base64,AA==' };

function page(auth: Auth): string {
  return renderToString(
    <AuthContext.Provider value={auth}>
      <SignInClient />
    </AuthContext.Provider>
  );
}

const signedOut: Auth = { ...INITIALIZING, status: 'signed-out', detectedWallets: [PHANTOM] };

describe('the sign-in surface by channel', () => {
  it('on the web: Google, X, the wallet divider, the detected wallet and the "more wallets" door', () => {
    channel = 'web';
    const html = page(signedOut);
    expect(html).toContain('data-testid="signin-google"');
    expect(html).toContain('data-testid="signin-twitter"');
    expect(html).toContain(COPY.signin.walletDivider);
    expect(html).toContain('data-testid="wallet-phantom"');
    expect(html).toContain('data-testid="wallet-more"');
    expect(html).toContain(COPY.signin.subtitle);
    expect(html).not.toContain(COPY.signin.webshellSubtitle);
  });

  it('in an Android browser: exactly the web surface — a browser is a browser', () => {
    channel = 'android-browser';
    const html = page(signedOut);
    channel = 'web';
    expect(html).toBe(page(signedOut));
  });

  it('inside the Solana Mobile shell: the wallet rows only, and the sentence that says so', () => {
    channel = 'webshell';
    const html = page(signedOut);
    expect(html).not.toContain('data-testid="signin-google"');
    expect(html).not.toContain('data-testid="signin-twitter"');
    expect(html).not.toContain('data-testid="wallet-more"');
    expect(html).not.toContain(COPY.signin.walletDivider);
    expect(html).toContain('data-testid="wallet-phantom"');
    expect(html).toContain(COPY.signin.webshellSubtitle);
    // The territory and age line is on every channel.
    expect(html).toContain(COPY.pool.ageTerritoryNote);
  });
});
