import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { VerifyClient } from './verify-client';

/* R13: the public verify page. Works with the wallet disconnected — nothing
 * on this route touches auth. */
export default function VerifyPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <VerifyClient />
      </main>
      <TabBar />
    </>
  );
}
