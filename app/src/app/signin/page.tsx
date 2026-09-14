/*
 * /signin — the destination of the header's sign-in affordance. This route
 * was referenced by the app header since the D2 restyle but never built
 * (every deployed "sign in" tap 404ed — production incident, 2026-08-28).
 * Static shell; all auth behaviour lives in the client component.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { COPY } from '@/copy';
import { SignInClient } from './signin-client';

export const metadata: Metadata = { title: COPY.signin.title };

export default function SignInPage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-24">
        <h1 className="mb-2 font-display text-[34px] leading-[38px] font-extrabold text-ink">
          {COPY.signin.title}
        </h1>
        {/* The client reads `?next=` (D-17), so it needs a boundary like
            every other search-param reader in the app. */}
        <Suspense>
          <SignInClient />
        </Suspense>
      </main>
      <TabBar />
    </>
  );
}
