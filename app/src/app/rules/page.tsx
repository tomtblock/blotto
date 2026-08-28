/*
 * The rules tab (D-B6, ratified 2026-08-27): participation, entry, payout
 * and randomness rules in plain language, one section per topic. Every
 * number comes through rules.config.ts from the same shared constants the
 * prize path uses; the availability section renders from the founder-owned
 * config/territories.json. Strings live in the copy module.
 */
import Link from 'next/link';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { rulesSections, type TierRow } from './rules.config';

function TierPriceTable({ rows }: { rows: TierRow[] }) {
  const h = COPY.rules.tableHeadings;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">
            <th className="py-2 pr-4 font-medium">{h.tier}</th>
            <th className="pr-4 font-medium">{h.entry}</th>
            <th className="font-medium">{h.pot}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tier} className="border-t border-line">
              <td className="tnum py-2 pr-4 font-mono text-ink-muted">{r.tier}</td>
              <td className="tnum py-2 pr-4 font-display text-[15px] font-semibold text-ink">
                {r.entrySol}
              </td>
              <td className="tnum font-display text-[15px] font-semibold text-prize">{r.potSol}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrizeTable({ rows }: { rows: TierRow[] }) {
  const h = COPY.rules.tableHeadings;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">
            <th className="py-2 pr-4 font-medium">{h.position}</th>
            {rows.map((r) => (
              <th key={r.tier} className="tnum pr-4 font-medium">
                {r.entrySol} SOL
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows[0].prizesSol.map((_, position) => (
            <tr key={position} className="border-t border-line">
              <td className="tnum py-2 pr-4 font-mono text-ink-muted">#{position + 1}</td>
              {rows.map((r) => (
                <td key={r.tier} className="tnum py-2 pr-4 font-mono text-ink">
                  {r.prizesSol[position]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RulesPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <h1 className="mb-6 font-display text-[34px] leading-[38px] font-extrabold text-ink">
          {COPY.rules.title}
        </h1>
        {rulesSections().map((s) => (
          <section key={s.id} id={s.id} className="mb-9">
            <h2 className="mb-2 font-display text-[24px] leading-[30px] font-bold text-ink">
              {s.heading}
            </h2>
            <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{s.body}</p>
            {s.kind === 'text' && s.appendix && (
              <p className="mt-2 max-w-prose text-[15px] leading-6 text-ink-muted">{s.appendix}</p>
            )}
            {s.kind === 'tiers' && (
              <div className="mt-3">
                <TierPriceTable rows={s.rows} />
              </div>
            )}
            {s.kind === 'prizes' && (
              <div className="mt-3">
                <PrizeTable rows={s.rows} />
              </div>
            )}
            {s.kind === 'verify' && (
              <p className="mt-3 text-[15px]">
                <Link
                  href={s.href}
                  className="text-brand underline underline-offset-2 hover:text-brand-hot"
                >
                  {s.linkText}
                </Link>
              </p>
            )}
            {s.kind === 'availability' && (
              <div className="mt-2 text-[15px] leading-6 text-ink-muted">
                <ul className="list-disc pl-5">
                  {s.data.allowed.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                {s.data.blocked.length > 0 && (
                  <p className="mt-2">
                    {COPY.rules.availabilityBlocked} {s.data.blocked.join(', ')}
                  </p>
                )}
              </div>
            )}
          </section>
        ))}
      </main>
      <TabBar />
    </>
  );
}
