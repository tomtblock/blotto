/*
 * Play tab (roadmap 3.1/3.2): the open pool front and centre, the enter path
 * behind the age gate. Server component; live data via the indexer seam.
 */
import Link from 'next/link';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';

export default async function PlayPage() {
  const pools = await indexerApi().listPools();
  const open = pools.filter((p) => p.state === 'Open');
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-2xl">{COPY.shell.tagline}</h1>
        {open.length === 0 ? (
          <p className="opacity-70">No pool is open for entries right now.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {open.map((p) => (
              <li key={p.pool} className="rounded border p-4">
                <Link href={`/pools/${p.pool}`} className="flex items-baseline gap-4">
                  <span className="font-mono text-xl">{lamportsToSol(p.entry_lamports)} SOL</span>
                  <span className="opacity-70">{COPY.pool.entrantsOf(p.entrants)}</span>
                  <span className="ml-auto underline">{COPY.pool.enter}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <TabBar />
    </>
  );
}
