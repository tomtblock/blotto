/*
 * The shared shell for the two legal pages (privacy, terms). Same shape as
 * the fair-play page: heading, one section per topic, plain type, and NO
 * motion at all — these pages are read, not performed.
 *
 * Values only counsel can supply render as an explicit "not yet set" line
 * (the custody page's rule): the product never shows a legal fact it does
 * not have.
 */
import Link from 'next/link';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { LEGAL_COPY, LEGAL_DRAFT, NOT_SET, type LegalSection } from '@/copy/legal';

export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: readonly LegalSection[];
}) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24">
        <h1 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">{title}</h1>
        <p className="mt-3 max-w-prose text-[15px] leading-6 text-ink-muted">{intro}</p>

        {LEGAL_DRAFT ? (
          <p className="mt-4 rounded-xl border border-line bg-raised px-4 py-3 text-[13px] leading-5 text-ink-muted">
            {LEGAL_COPY.draftBanner}
          </p>
        ) : null}

        <p className="mt-3 text-[12px] text-ink-muted">
          {LEGAL_COPY.lastUpdated} {LEGAL_COPY.updated}
        </p>

        <div className="mt-8 flex flex-col gap-8">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="flex flex-col gap-2">
              <h2 className="font-display text-[24px] leading-[30px] font-bold text-ink">
                {s.heading}
              </h2>
              {s.body.map((paragraph, i) =>
                paragraph === NOT_SET ? (
                  <p
                    key={i}
                    className="w-fit rounded-lg border border-dashed border-line px-3 py-2 text-[14px] text-ink-muted"
                  >
                    {LEGAL_COPY.notYetSet}
                  </p>
                ) : (
                  <p key={i} className="max-w-prose text-[15px] leading-6 text-ink-muted">
                    {paragraph}
                  </p>
                )
              )}
              {s.points ? (
                <ul className="mt-1 flex max-w-prose list-disc flex-col gap-1.5 pl-5 text-[15px] leading-6 text-ink-muted">
                  {s.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <p className="mt-10 flex flex-wrap gap-5 text-[14px]">
          <Link href="/rules" className="link-draw text-brand">
            {COPY.rules.title}
          </Link>
          <Link href="/privacy" className="link-draw text-brand">
            {LEGAL_COPY.privacyTitle}
          </Link>
          <Link href="/terms" className="link-draw text-brand">
            {LEGAL_COPY.termsTitle}
          </Link>
        </p>
      </main>
      <TabBar />
    </>
  );
}
