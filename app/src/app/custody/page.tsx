/*
 * The custody disclosure page (C13, D-C): every operational key, who holds
 * it, what it can do and what it cannot — generated from the founder-owned
 * config (custody.config.ts). Unset values render an explicit "not yet
 * set", never a placeholder number.
 */
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { custodyView, type CustodyValue } from './custody.config';

function Value({ v }: { v: CustodyValue }) {
  if (v.value === null) {
    return <span className="italic opacity-60">{COPY.custody.notYetSet}</span>;
  }
  return <span className="break-all font-mono">{v.value}</span>;
}

export default function CustodyPage() {
  const view = custodyView();
  const c = COPY.custody;
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="mb-2 text-2xl">{c.title}</h1>
        <p className="mb-6 max-w-prose text-sm opacity-80">{c.intro}</p>

        <section className="mb-8 flex flex-col gap-3 text-sm">
          <div>
            <h2 className="text-lg">{c.programIdLabel}</h2>
            <p className="mb-1 max-w-prose opacity-80">{c.programIdNote}</p>
            <Value v={view.programId} />
          </div>
          <div>
            <h2 className="text-lg">{c.upgradeAuthorityLabel}</h2>
            <p className="mb-1 max-w-prose opacity-80">{c.upgradeAuthorityNote}</p>
            <Value v={view.upgradeAuthority} />
          </div>
          <div className="flex gap-8">
            <div>
              <h3 className="opacity-60">{c.thresholdLabel}</h3>
              <Value v={view.threshold} />
            </div>
            <div>
              <h3 className="opacity-60">{c.timelockLabel}</h3>
              <Value v={view.timelock} />
            </div>
          </div>
        </section>

        <h2 className="mb-2 text-lg">{c.inventoryHeading}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="opacity-60">
                <th className="py-2 pr-4">{c.tableHeadings.key}</th>
                <th className="pr-4">{c.tableHeadings.holder}</th>
                <th className="pr-4">{c.tableHeadings.can}</th>
                <th>{c.tableHeadings.cannot}</th>
              </tr>
            </thead>
            <tbody>
              {view.keys.map((k) => (
                <tr key={k.name} className="border-t align-top">
                  <td className="py-2 pr-4">{k.name}</td>
                  <td className="pr-4">
                    {k.holder === null ? (
                      <span className="italic opacity-60">{c.notYetSet}</span>
                    ) : (
                      <span className="break-all">{k.holder}</span>
                    )}
                  </td>
                  <td className="max-w-xs pr-4 opacity-80">{k.can}</td>
                  <td className="max-w-xs opacity-80">{k.cannot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-xs opacity-60">
          {c.updatedPrefix} {view.updated}.
        </p>
      </main>
      <TabBar />
    </>
  );
}
