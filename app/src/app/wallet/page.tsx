/*
 * /wallet — what a player holds, how to add to it, how to take it out, and
 * which wallet plays. Reached from the balance in the header. Static shell;
 * all behaviour lives in the card, which the profile page also renders.
 * Round four A2 (founder 2026-09-17): the pink field; the box IS the page,
 * so its marquee is the h1.
 */
import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { BackLink } from '@/components/ui/back-link';
import { TabBar } from '@/components/shell/tab-bar';
import { WalletCard } from '@/components/wallet/wallet-card';
import { COPY } from '@/copy';

export const metadata: Metadata = { title: COPY.wallet.title };

export default function WalletPage() {
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
      <main id="main" className="mx-auto w-full max-w-xl px-4 pt-6 pb-24">
        <div className="mb-4">
          <BackLink href="/profile" tone="berry">
            {COPY.shell.tabs.profile}
          </BackLink>
        </div>
        <WalletCard headingAs="h1" />
      </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
