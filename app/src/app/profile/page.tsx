/* Profile (R15): lifetime pools, ranks, prize totals, the class collection.
 * Read-only — nothing here can affect a pool. Round four A2 (founder
 * 2026-09-17): the pink field, the title on the marquee, every block a
 * titled neon box (the wallet, then the record). */
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { SiteFooter } from '@/components/shell/site-footer';
import { PageIntro } from '@/components/ui/page-intro';
import { WalletCard } from '@/components/wallet/wallet-card';
import { ProfileClient } from './profile-client';

export default function ProfilePage() {
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
        <PageIntro tone="marquee" title={COPY.profile.title} lead={COPY.profile.readOnlyNote} />
        <div className="flex flex-col gap-10">
          {/* "In your wallet now" sits above "won to date" so the two are never
              read as one number. */}
          <WalletCard />
          <ProfileClient />
        </div>
      </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
