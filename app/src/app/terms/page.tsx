/*
 * /terms (2026-09-19) — the terms of service.
 *
 * The back-page shape (/rules, /fair-play, /custody): the app header, a pink
 * field wrapping a centred main column, a marquee page intro with a way
 * back. V3 (founder 2026-09-27): every section is a tile that opens its
 * text on the cream card (components/ui/section-tiles) or — because this is
 * a document a reader or counsel may want whole — all in order under "Read
 * as one page". Every section is in the server HTML whichever way it is
 * read, so a document a player is agreeing to never depends on a client
 * bundle arriving (the 2026-09-13 gate incident, where a refused bundle
 * left a page blank with a correct tab title). A link like
 * /terms#complaints opens that section.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import termsConfig from '@config/terms.json';
import { COPY } from '@/copy';
import type { TermsSection } from '@/copy/terms';
import { AppHeader } from '@/components/shell/app-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { TabBar } from '@/components/shell/tab-bar';
import { PageIntro } from '@/components/ui/page-intro';
import { SectionTiles } from '@/components/ui/section-tiles';
import { operatorIdentity, operatorText, type OperatorIdentity } from '@/operator/operator';
import { OperatorRows } from '@/components/doc/doc-parts';

const t = COPY.terms;

export const metadata: Metadata = { title: t.title };

function Section({ s, operator }: { s: TermsSection; operator: OperatorIdentity }) {
  return (
    <div data-testid={`terms-${s.id}`}>
      {s.body.map((paragraph) => (
        <p key={paragraph} className="mt-0 mb-3 max-w-prose text-[15px] leading-6 text-ink-muted last:mb-0">
          {paragraph}
        </p>
      ))}

      {s.points && (
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-6 text-ink-muted marker:text-brand">
          {s.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}

      {/* The founder-owned identity. An unset value renders the explicit
          "not yet set" — never a placeholder that reads as real, and never
          a guess. */}
      {s.operator === 'identity' && (
        <OperatorRows
          unsetNote={operator.anyUnset ? t.operatorUnsetNote : null}
          rows={[
            { label: t.identityLabels.legalName, value: operatorText(operator.legalName) },
            { label: t.identityLabels.companyNumber, value: operatorText(operator.companyNumber) },
            { label: t.identityLabels.registeredAddress, value: operatorText(operator.registeredAddress) },
            { label: t.identityLabels.noticeAddress, value: operatorText(operator.noticeAddress) },
          ]}
        />
      )}
      {s.operator === 'law' && (
        <OperatorRows
          unsetNote={null}
          rows={[
            { label: t.identityLabels.governingLaw, value: operatorText(operator.governingLaw) },
            { label: t.identityLabels.jurisdiction, value: operatorText(operator.jurisdiction) },
          ]}
        />
      )}

      {/* The complaints clause is the one place in the document with
          somewhere to go. */}
      {s.id === 'complaints' && (
        <p className="mt-4 text-[15px]">
          <Link href="/complaints" className="text-brand underline underline-offset-2 hover:text-brand-hot">
            {COPY.complaints.title}
          </Link>
        </p>
      )}
      {s.id === 'general' && (
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
          <Link href="/rules" className="text-brand underline underline-offset-2 hover:text-brand-hot">
            {COPY.rules.title}
          </Link>
          <Link href="/fair-play" className="text-brand underline underline-offset-2 hover:text-brand-hot">
            {COPY.fairPlay.title}
          </Link>
          <Link href="/privacy" className="text-brand underline underline-offset-2 hover:text-brand-hot">
            {COPY.privacy.title}
          </Link>
        </p>
      )}
    </div>
  );
}

export default function TermsPage() {
  const operator = operatorIdentity();
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
        <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
          <PageIntro tone="marquee" title={t.title} back={{ href: '/', label: COPY.shell.nav.backToHome }} lead={t.intro} />
          <p className="-mt-3 mb-6 max-w-prose text-[14px] leading-5 text-brand-berry">
            {t.versionLine(termsConfig.version, termsConfig.updated)}
          </p>
          <SectionTiles
            label={t.tilesLabel}
            allowAll
            sections={t.sections.map((s) => ({
              id: s.id,
              label: t.tiles[s.id] ?? s.heading,
              heading: s.heading,
              content: <Section s={s} operator={operator} />,
            }))}
          />
        </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
