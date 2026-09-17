import { Suspense } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { BackLink } from '@/components/ui/back-link';
import { COPY } from '@/copy';
import { TabBar } from '@/components/shell/tab-bar';
import { VerifyClient } from './verify-client';

/* R13: the public verify page. Works with the wallet disconnected — nothing
 * on this route touches auth. */
export default function VerifyPage() {
  return (
    <>
      <AppHeader />
      {/* Founder 2026-09-16: the pink field, as on every informational page. */}
      <div className="flex-1 bg-brand-pink">
        <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
          <div className="mb-3">
            <BackLink href="/pools" tone="berry">
              {COPY.shell.nav.backToPools}
            </BackLink>
          </div>
          <Suspense>
            <VerifyClient />
          </Suspense>
        </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
