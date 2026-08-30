import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { AppHeader } from '@/components/shell/app-header';
import { indexerApi } from '@/data/api';
import { ArenaClient } from '@/arena/components/arena-client';

/* One pool's arena: create → sealed lobby → reveal battle. The client
 * orchestrator owns polling and phase; this shell only confirms the pool
 * exists. No tab bar — like /play, the session is the whole screen. */
export default async function ArenaPoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params;
  const summary = await indexerApi().getPool(pool);
  if (!summary) notFound();
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <Suspense>
          <ArenaClient pool={pool} />
        </Suspense>
      </main>
    </>
  );
}
