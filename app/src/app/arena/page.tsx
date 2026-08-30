import Link from 'next/link';
import { COPY } from '@/copy';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { AppHeader } from '@/components/shell/app-header';

/* The arena index: pick a pool to enter with your characters. A separate
 * surface — the plain entry screens are untouched. */
export default async function ArenaIndexPage() {
  const pools = await indexerApi().listPools();
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <h1 className="mb-1 font-[family-name:var(--font-unbounded)] text-2xl">
          {COPY.arena.title}
        </h1>
        <p className="mb-6 max-w-prose text-sm opacity-70">{COPY.arena.tagline}</p>
        <p className="mb-3 text-sm opacity-60">{COPY.arena.listIntro}</p>
        <ol className="flex flex-col gap-2">
          {pools.map((p) => (
            <li key={p.pool}>
              <Link
                className="flex items-baseline gap-4 rounded border px-4 py-3 hover:bg-[var(--color-raised)]"
                href={`/arena/${p.pool}`}
              >
                <span>Pool #{p.id}</span>
                <span className="font-mono text-sm">{lamportsToSol(p.entry_lamports)} SOL</span>
                <span className="ml-auto text-sm opacity-60">{COPY.pool.entrantsOf(p.entrants)}</span>
                <span className="rounded border px-2 py-0.5 text-xs">{p.state}</span>
              </Link>
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}
