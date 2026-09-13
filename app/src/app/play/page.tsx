import { Suspense } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { indexerApi, live } from '@/data/api';
import { PlayClient } from './play-client';

/* The entry flow route (roadmap 3.1/3.3/3.4): age gate → seven battles →
 * review → sealed submit. No tab bar — the session is the whole screen.
 *
 * Founder 2026-09-09 ("Loading the pool … taking far too long"): the pool
 * is read HERE, on the server, and handed to the client. The browser's own
 * read of the indexer is now only a fallback — it was the one step on the
 * entry path that depended on a cross-origin call from whatever host the
 * player happened to open, and it had no way to fail visibly. */
export default async function PlayFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ pool?: string | string[] }>;
}) {
  const { pool } = await searchParams;
  const poolId = typeof pool === 'string' ? pool : undefined;
  // `null` here means "the server could not read the indexer" — the client
  // then makes its own timed attempt. A successful read that finds no such
  // pool is passed through as { pool: null } so the browser does not wait
  // on a second read to learn what the server already knows.
  const read = poolId ? await live(() => indexerApi().getPool(poolId)) : null;
  const initial = read && read.ok ? { pool: read.value } : null;
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <Suspense>
          <PlayClient initial={initial} />
        </Suspense>
      </main>
    </>
  );
}
