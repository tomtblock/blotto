/* Profile (R15): the wallet, the lifetime record, the previous finishes.
 * Read-only — nothing here can affect a pool. Round four A2 (founder
 * 2026-09-17): the pink field, the title on the marquee, every block a
 * titled neon box. V3 (founder 2026-09-27): one dashboard, no tabs. */
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { SiteFooter } from '@/components/shell/site-footer';
import { PageIntro } from '@/components/ui/page-intro';
import { ProfileClient } from './profile-client';

export default function ProfilePage() {
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
        <PageIntro tone="marquee" title={COPY.profile.title} lead={COPY.profile.readOnlyNote} />
        <ProfileClient />
      </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
