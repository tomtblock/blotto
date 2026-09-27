/* Profile (R15): lifetime pools, ranks, prize totals, the class collection.
 * Read-only — nothing here can affect a pool. Round four A2 (founder
 * 2026-09-17): the pink field, the title on the marquee, every block a
 * titled neon box (the wallet, then the record). */
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
        {/* V2 (founder 2026-09-27): Wallet · Record · Prize record · Battle
            notes as tabs; the wallet card is the first tab. */}
        <ProfileClient />
      </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
