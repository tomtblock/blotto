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
          <tr className="opacity-60">
            <th className="py-2 pr-4">{h.tier}</th>
            <th className="pr-4">{h.entry}</th>
            <th>{h.pot}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tier} className="border-t">
              <td className="py-2 pr-4 font-mono">{r.tier}</td>
              <td className="pr-4 font-mono">{r.entrySol}</td>
              <td className="font-mono">{r.potSol}</td>
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
          <tr className="opacity-60">
            <th className="py-2 pr-4">{h.position}</th>
            {rows.map((r) => (
              <th key={r.tier} className="pr-4 font-mono">
                {r.entrySol} SOL
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows[0].prizesSol.map((_, position) => (
            <tr key={position} className="border-t">
              <td className="py-2 pr-4 font-mono">#{position + 1}</td>
              {rows.map((r) => (
                <td key={r.tier} className="pr-4 font-mono">
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
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-2xl">{COPY.rules.title}</h1>
        {rulesSections().map((s) => (
          <section key={s.id} id={s.id} className="mb-8">
            <h2 className="mb-2 text-lg">{s.heading}</h2>
            <p className="max-w-prose text-sm opacity-80">{s.body}</p>
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
              <p className="mt-2 text-sm">
                <Link href={s.href} className="underline">
                  {s.linkText}
                </Link>
              </p>
            )}
            {s.kind === 'availability' && (
              <div className="mt-2 text-sm">
                <ul className="list-disc pl-5">
                  {s.data.allowed.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                {s.data.blocked.length > 0 && (
                  <p className="mt-2 opacity-80">
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
