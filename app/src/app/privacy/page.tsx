/*
 * /privacy (2026-09-19) — the privacy notice.
 *
 * Same back-page shape as /terms and for the same reasons: pink field,
 * marquee intro with a way back, one neon panel per section with a stable
 * `id`, within-page navigation because the document is long, and wholly
 * server-rendered so it does not depend on a client bundle arriving.
 *
 * The "what we hold" section renders the inventory as a table on a wide
 * screen and as stacked rows on a phone — the same treatment the standings
 * table gets, keeping its horizontal overflow rather than shrinking the
 * type.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { TabBar } from '@/components/shell/tab-bar';
import { PageIntro } from '@/components/ui/page-intro';
import { NeonSection } from '@/components/ui/neon-section';
import { operatorIdentity, operatorText } from '@/operator/operator';
import { DocNav, OperatorRows } from '@/components/doc/doc-parts';

const p = COPY.privacy;

export const metadata: Metadata = { title: p.title };

export default function PrivacyPage() {
  const operator = operatorIdentity();
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
        <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
          <PageIntro
            tone="marquee"
            title={p.title}
            back={{ href: '/', label: COPY.shell.nav.backToHome }}
            lead={p.intro}
          />
          <p className="-mt-3 mb-6 text-[14px] leading-5 text-brand-berry">
            {p.updatedLine(operator.updated)}
          </p>

          <div className="flex flex-col gap-10">
            <DocNav
              label={p.navLabel}
              items={p.sections.map((s) => ({ id: s.id, heading: s.heading }))}
            />

            {p.sections.map((s) => (
              <NeonSection key={s.id} id={s.id} heading={s.heading}>
                {s.body.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="mt-0 mb-3 max-w-prose text-[15px] leading-6 text-ink-muted last:mb-0"
                  >
                    {paragraph}
                  </p>
                ))}

                {/* The inventory. A table from sm; stacked rows on a phone,
                    where five columns of prose would be unreadable. */}
                {s.held && (
                  <div className="mt-4 flex flex-col gap-4 sm:hidden">
                    {s.held.map((row) => (
                      <div key={row.what} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-[15px] font-semibold text-ink">{row.what}</p>
                        <p className="mt-2 text-[14px] leading-5 text-ink-muted">{row.why}</p>
                        <p className="mt-2 text-[13px] leading-5 text-ink-muted">
                          <span className="uppercase tracking-[0.1em]">{p.heldHeadings.kept}: </span>
                          {row.kept}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {s.held && (
                  <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-white/10 bg-white/5 sm:block">
                    <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-[0.1em] text-ink-muted">
                          <th className="px-3 py-2 font-medium">{p.heldHeadings.what}</th>
                          <th className="px-3 py-2 font-medium">{p.heldHeadings.why}</th>
                          <th className="px-3 py-2 font-medium">{p.heldHeadings.kept}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.held.map((row) => (
                          <tr key={row.what} className="border-t border-line align-top">
                            <td className="px-3 py-2.5 font-medium text-ink">{row.what}</td>
                            <td className="px-3 py-2.5 leading-5 text-ink-muted">{row.why}</td>
                            <td className="px-3 py-2.5 leading-5 text-ink-muted">{row.kept}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {s.points && (
                  <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-6 text-ink-muted marker:text-brand">
                    {s.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                )}

                {/* Retention is a policy rather than a mechanism, and the
                    section says so in those words. */}
                {s.id === 'retention' && (
                  <p className="mt-4 max-w-prose text-[14px] leading-5 font-medium text-prize">
                    {p.policyNote}
                  </p>
                )}

                {s.operator === 'controller' && (
                  <OperatorRows
                    unsetNote={operator.anyUnset ? p.operatorUnsetNote : null}
                    rows={[
                      { label: p.controllerLabels.legalName, value: operatorText(operator.legalName) },
                      {
                        label: p.controllerLabels.companyNumber,
                        value: operatorText(operator.companyNumber),
                      },
                      {
                        label: p.controllerLabels.registeredAddress,
                        value: operatorText(operator.registeredAddress),
                      },
                      {
                        label: p.controllerLabels.noticeAddress,
                        value: operatorText(operator.noticeAddress),
                      },
                    ]}
                  />
                )}
                {s.operator === 'authority' && (
                  <OperatorRows
                    unsetNote={null}
                    rows={[
                      {
                        label: p.controllerLabels.supervisoryAuthority,
                        value: operatorText(operator.supervisoryAuthority),
                      },
                    ]}
                  />
                )}

                {(s.id === 'contact' || s.id === 'your-rights') && (
                  <p className="mt-4 text-[15px]">
                    <Link
                      href="/complaints"
                      className="text-brand underline underline-offset-2 hover:text-brand-hot"
                    >
                      {COPY.complaints.title}
                    </Link>
                  </p>
                )}
                {s.id === 'what-is-published' && (
                  <p className="mt-4 text-[15px]">
                    <Link
                      href="/verify"
                      className="text-brand underline underline-offset-2 hover:text-brand-hot"
                    >
                      {COPY.verify.title}
                    </Link>
                  </p>
                )}
              </NeonSection>
            ))}
          </div>
        </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
