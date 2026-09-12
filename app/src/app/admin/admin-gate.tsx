'use client';

/*
 * The door sign in front of every /admin page (audit 2026-09-11, D-43):
 * the page body renders only for a signed-in wallet on the reviewer list;
 * anyone else sees what they need to do, and a crawler sees nothing worth
 * indexing (robots.ts refuses the path as well).
 *
 * Admin surface: raw strings by design, like the pages it wraps — the COPY
 * module owns player-facing language only.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import reviewers from '@config/reviewers.json';
import { useAuth } from '@/wallet/auth-context';
import { truncateAddress } from '@/wallet/types';
import { adminAccess } from './admin-access';

export function AdminGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const access = adminAccess(auth, reviewers.members);
  switch (access) {
    case 'member':
      return <>{children}</>;
    case 'initializing':
      return (
        <p data-testid="admin-gate" className="text-sm opacity-70">
          Checking your wallet…
        </p>
      );
    case 'signed-out':
      return (
        <div data-testid="admin-gate" className="space-y-2 text-sm">
          <p>This page is for reviewers.</p>
          <p>
            <Link href="/signin" className="underline">
              Sign in
            </Link>{' '}
            with a wallet on the reviewer list (config/reviewers.json).
          </p>
        </div>
      );
    case 'not-a-member':
      return (
        <div data-testid="admin-gate" className="space-y-2 text-sm">
          <p>
            {truncateAddress(auth.walletAddress ?? '')} is signed in but is not on the reviewer
            list (config/reviewers.json).
          </p>
          <p>Switch to a reviewer wallet, or ask the founder to add this one.</p>
        </div>
      );
  }
}
