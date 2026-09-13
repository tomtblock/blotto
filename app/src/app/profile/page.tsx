/* Profile (R15): lifetime pools, ranks, prize totals, the class collection.
 * Read-only — nothing here can affect a pool. */
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { WalletCard } from '@/components/wallet/wallet-card';
import { ProfileClient } from './profile-client';

export default function ProfilePage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <h1 className="mb-1 font-display text-[34px] leading-[38px] font-extrabold text-ink">
          {COPY.profile.title}
        </h1>
        <p className="mb-6 text-[13px] leading-5 text-ink-muted">{COPY.profile.readOnlyNote}</p>
        {/* "In your wallet now" sits above "won to date" so the two are never
            read as one number. */}
        <div className="mb-6">
          <WalletCard />
        </div>
        <ProfileClient />
      </main>
      <TabBar />
    </>
  );
}
