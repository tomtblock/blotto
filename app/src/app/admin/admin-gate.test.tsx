/*
 * The admin door sign, rendered (audit 2026-09-11, D-43). Same technique as
 * wallet/auth-shell.test.tsx: react-dom/server needs no DOM, next/link is a
 * plain anchor, and what is pinned is which branch renders for a given Auth.
 * The member list is the real config/reviewers.json, so the member case
 * uses its first entry rather than a made-up key.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import reviewers from '@config/reviewers.json';
import { AuthContext } from '@/wallet/auth-context';
import { INITIALIZING } from '@/wallet/auth-select';
import type { Auth } from '@/wallet/types';
import { AdminGate } from './admin-gate';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const BODY = 'THE-ADMIN-BODY';

function gate(auth: Auth): string {
  return renderToString(
    <AuthContext.Provider value={auth}>
      <AdminGate>
        <p>{BODY}</p>
      </AdminGate>
    </AuthContext.Provider>
  );
}

describe('the admin gate', () => {
  it('renders the page for a signed-in reviewer', () => {
    const html = gate({ ...INITIALIZING, status: 'signed-in', walletAddress: reviewers.members[0] });
    expect(html).toContain(BODY);
    expect(html).not.toContain('data-testid="admin-gate"');
  });

  it('signed out: no page body, a link to sign in', () => {
    const html = gate({ ...INITIALIZING, status: 'signed-out' });
    expect(html).not.toContain(BODY);
    expect(html).toContain('href="/signin"');
    expect(html).toContain('for reviewers');
  });

  it('a wallet off the list: no page body, the wallet named, how to fix it', () => {
    const html = gate({
      ...INITIALIZING,
      status: 'signed-in',
      walletAddress: '9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z',
    });
    expect(html).not.toContain(BODY);
    expect(html).toContain('9EEW…e34Z');
    expect(html).toContain('not on the reviewer');
  });

  it('while initializing: no page body and no sign-in link yet', () => {
    const html = gate(INITIALIZING);
    expect(html).not.toContain(BODY);
    expect(html).not.toContain('href="/signin"');
    expect(html).toContain('Checking');
  });
});
