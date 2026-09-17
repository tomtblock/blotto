/*
 * /signin — the destination of the header's sign-in affordance. This route
 * was referenced by the app header since the D2 restyle but never built
 * (every deployed "sign in" tap 404ed — production incident, 2026-08-28).
 * Static shell; all auth behaviour lives in the client component.
 * Round four A2 (founder 2026-09-17): the pink field; the box IS the page,
 * so its marquee is the h1 and the controls inside are keys.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { TabBar } from '@/components/shell/tab-bar';
import { NeonSection } from '@/components/ui/neon-section';
import { COPY } from '@/copy';
import { SignInClient } from './signin-client';

export const metadata: Metadata = { title: COPY.signin.title };

export default function SignInPage() {
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
      <main id="main" className="mx-auto w-full max-w-md px-4 pt-6 pb-24">
        <NeonSection heading={COPY.signin.title} headingAs="h1">
          {/* The client reads `?next=` (D-17), so it needs a boundary like
              every other search-param reader in the app. */}
          <Suspense>
            <SignInClient />
          </Suspense>
        </NeonSection>
      </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
