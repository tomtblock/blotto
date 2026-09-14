/*
 * The custody disclosure page (C13, D-C; restyled by v3 D2): every
 * operational key, who holds it, what it can do and what it cannot —
 * generated from the founder-owned config (custody.config.ts). Unset values
 * render an explicit "not yet set", never a placeholder number.
 */
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { PageIntro } from '@/components/ui/page-intro';
import { TabBar } from '@/components/shell/tab-bar';
import { Card } from '@/components/ui/card';
import { custodyView, type CustodyValue } from './custody.config';

function Value({ v }: { v: CustodyValue }) {
  if (v.value === null) {
    return <span className="italic text-ink-muted">{COPY.custody.notYetSet}</span>;
  }
  return <span className="break-all font-mono text-[13px] text-ink">{v.value}</span>;
}

export default function CustodyPage() {
  const view = custodyView();
  const c = COPY.custody;
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <PageIntro title={c.title} back={{ href: '/fair-play', label: COPY.fairPlay.title }} lead={c.intro} />

        <Card className="mb-6 flex flex-col gap-5 p-5">
          <div>
            <h2 className="mb-1 font-display text-[18px] font-bold text-ink">{c.programIdLabel}</h2>
            <p className="mb-2 max-w-prose text-[13px] leading-5 text-ink-muted">
              {c.programIdNote}
            </p>
            <Value v={view.programId} />
          </div>
          <div>
            <h2 className="mb-1 font-display text-[18px] font-bold text-ink">
              {c.upgradeAuthorityLabel}
            </h2>
            <p className="mb-2 max-w-prose text-[13px] leading-5 text-ink-muted">
              {c.upgradeAuthorityNote}
            </p>
            <Value v={view.upgradeAuthority} />
          </div>
          <div className="flex gap-10">
            <div>
              <h3 className="mb-1 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
                {c.thresholdLabel}
              </h3>
              <Value v={view.threshold} />
            </div>
            <div>
              <h3 className="mb-1 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
                {c.timelockLabel}
              </h3>
              <Value v={view.timelock} />
            </div>
          </div>
        </Card>

        <h2 className="mb-3 font-display text-[24px] font-bold text-ink">{c.inventoryHeading}</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-raised">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">
                <th className="px-4 py-3 font-medium">{c.tableHeadings.key}</th>
                <th className="py-3 pr-4 font-medium">{c.tableHeadings.holder}</th>
                <th className="py-3 pr-4 font-medium">{c.tableHeadings.can}</th>
                <th className="py-3 pr-4 font-medium">{c.tableHeadings.cannot}</th>
              </tr>
            </thead>
            <tbody>
              {view.keys.map((k) => (
                <tr key={k.name} className="border-t border-line align-top">
                  <td className="px-4 py-3 font-medium text-ink">{k.name}</td>
                  <td className="py-3 pr-4">
                    {k.holder === null ? (
                      <span className="italic text-ink-muted">{c.notYetSet}</span>
                    ) : (
                      <span className="break-all text-[13px] text-ink-muted">{k.holder}</span>
                    )}
                  </td>
                  <td className="max-w-xs py-3 pr-4 text-[13px] leading-5 text-ink-muted">
                    {k.can}
                  </td>
                  <td className="max-w-xs py-3 pr-4 text-[13px] leading-5 text-ink-muted">
                    {k.cannot}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-[12px] text-ink-muted">
          {c.updatedPrefix} {view.updated}.
        </p>
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
