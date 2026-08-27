/* Pools tab: every pool, every state, newest first. */
import Link from 'next/link';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';

export default async function PoolsPage() {
  const pools = await indexerApi().listPools();
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-2xl">Pools</h1>
        <ul className="flex flex-col gap-3">
          {pools.map((p) => (
            <li key={p.pool} className="rounded border p-4">
              <Link href={`/pools/${p.pool}`} className="flex items-baseline gap-4">
                <span className="font-mono">#{p.id}</span>
                <span className="font-mono">{lamportsToSol(p.entry_lamports)} SOL</span>
                <span className="opacity-70">{COPY.pool.entrantsOf(p.entrants)}</span>
                <span className="ml-auto rounded border px-2 py-0.5 text-xs">{p.state}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <TabBar />
    </>
  );
}
