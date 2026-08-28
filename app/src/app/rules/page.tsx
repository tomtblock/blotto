/*
 * The fair-play page (D-B6, ratified 2026-08-27; presentation per UI
 * constitution 6.9): participation, entry, payout and randomness rules in
 * plain language, one section per topic. Every number comes through
 * rules.config.ts from the same shared constants the prize path uses; the
 * availability section renders from the founder-owned territories config.
 * Strings live in the copy module.
 *
 * 6.9's rhetorical engine — statement of mechanism → the on-chain fact →
 * the affordance to verify it yourself — is carried by three instruments
 * interleaved with the ratified D-B6 sections (whose reading order is
 * kept — recorded delta vs the constitution's §ordering):
 *   - the shared pentagon explainer in miniature (what this is);
 *   - the 80/20 entry split, played once on scroll-entry (where your
 *     entry goes — the business model, on the page, in the open);
 *   - the FROST lifecycle diagram (sealing), static.
 * No ambient motion anywhere on this page; every claim keeps its Verify
 * link. Zero category, licence, or fairness adjectives (constraint 2 —
 * the CI language gate fails the build otherwise).
 */
import Link from 'next/link';
import { TIER_ENTRY_LAMPORTS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { EntrySplit } from '@/components/entry-split';
import { FrostLifecycle } from '@/components/frost-lifecycle';
import { FadeInView } from '@/components/ui/fade-in-view';
import { ExplainerPanels } from '@/components/home/how-it-works-explainer';
import { rulesSections, type TierRow } from './rules.config';

/** Sections that carry their own Verify affordance (6.9 §3/§4). */
const VERIFY_LINKED = new Set(['sealing', 'randomness']);

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

            {/* 6.9 §1: the shared pentagon explainer, in miniature. */}
            {s.id === 'how-to-enter' && (
              <div className="mt-4">
                <ExplainerPanels />
              </div>
            )}

            {/* 6.9 §2: where your entry goes — the split, annotated by the
                surrounding SUBSTANCE FIXED prose. Plays once on
                scroll-entry, then rests. */}
            {s.id === 'prizes' && (
              <div className="mt-4 max-w-md">
                <EntrySplit entryLamports={TIER_ENTRY_LAMPORTS[0].toString()} />
              </div>
            )}

            {/* 6.9 §3: the FROST lifecycle. */}
            {s.id === 'sealing' && (
              <FadeInView className="mt-4">
                <FrostLifecycle />
              </FadeInView>
            )}

            {VERIFY_LINKED.has(s.id) && (
              <p className="mt-3 text-[14px]">
                <Link href="/verify" className="link-draw text-brand">
                  {COPY.rules.verifyLink}
                </Link>
              </p>
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
                {s.data.posture === 'block-list' ? (
                  // Block-list posture: the blocked territories ARE the list.
                  <ul className="list-disc pl-5">
                    {s.data.blocked.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                ) : (
                  <>
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
                  </>
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
