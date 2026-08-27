import { Suspense } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { PlayClient } from './play-client';

/* The entry flow route (roadmap 3.1/3.3/3.4): age gate → seven battles →
 * review → sealed submit. No tab bar — the session is the whole screen. */
export default function PlayFlowPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <Suspense>
          <PlayClient />
        </Suspense>
      </main>
    </>
  );
}
