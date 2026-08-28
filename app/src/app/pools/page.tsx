/* Pools tab (restyled by v3 D2): every pool, every state, newest first —
 * fixture rows in the arena idiom, open pools wearing the brand hairline. */
import Link from 'next/link';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { Card } from '@/components/ui/card';

export default async function PoolsPage() {
  const pools = await indexerApi().listPools();
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <h1 className="mb-5 font-display text-[34px] leading-[38px] font-extrabold text-ink">
          Pools
        </h1>
        {pools.length === 0 ? (
          <Card className="flex flex-col gap-2 p-6">
            <p className="text-[17px] font-medium text-ink">{COPY.pool.noOpenPool}</p>
            <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
              {COPY.pool.noOpenPoolDetail}
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {pools.map((p) => (
              <li key={p.pool}>
                <Link href={`/pools/${p.pool}`}>
                  <Card
                    className={
                      'flex items-center gap-4 px-4 py-3 transition-colors hover:border-brand/40 ' +
                      (p.state === 'Open' ? 'border-brand/40' : '')
                    }
                  >
                    <span className="tnum font-mono text-[12px] text-ink-muted">#{p.id}</span>
                    <span className="tnum font-display text-[18px] font-bold text-ink">
                      {lamportsToSol(p.entry_lamports)}
                      <span className="ml-1 font-body text-[11px] font-medium text-ink-muted">
                        SOL
                      </span>
                    </span>
                    <span className="text-[13px] text-ink-muted">
                      {COPY.pool.entrantsOf(p.entrants)}
                    </span>
                    <span className="ml-auto rounded-full border border-line px-2.5 py-0.5 text-[11px] uppercase tracking-[0.1em] text-ink-muted">
                      {p.state}
                    </span>
                  </Card>
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
