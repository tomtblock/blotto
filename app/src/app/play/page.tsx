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
      {/* Founder 2026-09-17 (CHANGE-2026-09-16_ui-uplift.md §E): the play
          route wears the pink field like every other page. The wrapper is
          also an inline-size CONTAINER: under the 0.9 desktop scale
          (globals.css) `100vw` is 90 % of the window, so anything that
          breaks out of the narrow column sizes against `100cqw` of this
          wrapper instead — the seal stage does. */}
      <div className="play-field flex-1 bg-brand-pink">
        <main id="main" className="mx-auto w-full max-w-xl px-4 py-8">
          <Suspense>
            <PlayClient initial={initial} />
          </Suspense>
        </main>
      </div>
    </>
  );
}
