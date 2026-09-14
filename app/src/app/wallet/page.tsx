/*
 * /wallet — what a player holds, how to add to it, how to take it out, and
 * which wallet plays. Reached from the balance in the header. Static shell;
 * all behaviour lives in the card, which the profile page also renders.
 */
import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { PageIntro } from '@/components/ui/page-intro';
import { TabBar } from '@/components/shell/tab-bar';
import { WalletCard } from '@/components/wallet/wallet-card';
import { COPY } from '@/copy';

export const metadata: Metadata = { title: COPY.wallet.title };

export default function WalletPage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-24">
        <PageIntro title={COPY.wallet.title} back={{ href: '/profile', label: COPY.shell.tabs.profile }} />
        <WalletCard />
      </main>
      <TabBar />
    </>
  );
}
