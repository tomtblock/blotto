/*
 * Fair play — what keeps the competition fair, who may enter, and how to
 * check it. Every number derives through fair-play.config.ts; every sentence
 * lives in the copy module. Read-only; nothing here can affect a pool.
 *
 * V3 (founder 2026-09-27): a tile per section that opens its text on the
 * cream card; every section is in the server HTML either way.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { PageIntro } from '@/components/ui/page-intro';
import { SectionTiles } from '@/components/ui/section-tiles';
import { TabBar } from '@/components/shell/tab-bar';
import { FULL_FIELD, MIN_FIELD, fairPlayView } from './fair-play.config';

export const metadata: Metadata = { title: COPY.fairPlay.title };

function Box({ id, children }: { id: string; children: React.ReactNode }) {
  return <div data-testid={`fair-play-${id}`}>{children}</div>;
}

export default function FairPlayPage() {
  const view = fairPlayView();
  const c = COPY.fairPlay;
  const r = COPY.rules;
  const sections = [
    {
      id: 'skill',
      label: c.tiles.skill,
      heading: c.skillHeading,
      content: (
        <Box id="skill">
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{c.skillIntro}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="skill-table">
              <thead>
                <tr className="text-[12px] uppercase tracking-[0.1em] text-ink-muted">
                  <th className="py-2 pr-4 font-medium">{c.skillHeadings.player}</th>
                  <th className="pr-4 text-right font-medium">{c.skillHeadings.full(FULL_FIELD)}</th>
                  <th className="text-right font-medium">{c.skillHeadings.min(MIN_FIELD)}</th>
                </tr>
              </thead>
              <tbody>
                {view.skill.map((row) => (
                  <tr key={row.cls} className={'border-t border-line ' + (row.cls === 'uniform' ? 'text-prize' : 'text-ink')}>
                    <td className="py-2 pr-4 text-[15px] font-medium">{row.label}</td>
                    <td className="tnum py-2 pr-4 text-right font-mono text-[15px]">{row.fullPct}%</td>
                    <td className="tnum py-2 text-right font-mono text-[15px]">{row.minPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-prose text-[13px] leading-5 text-ink-muted">{c.skillNote}</p>
        </Box>
      ),
    },
    {
      id: 'screening',
      label: c.tiles.screening,
      heading: c.screeningHeading,
      content: (
        <Box id="screening">
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{c.screening}</p>
        </Box>
      ),
    },
    {
      id: 'age',
      label: c.tiles.age,
      heading: c.ageHeading,
      content: (
        <Box id="age">
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{r.age}</p>
        </Box>
      ),
    },
    {
      id: 'availability',
      label: c.tiles.availability,
      heading: c.availabilityHeading,
      content: (
        <Box id="availability">
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">
            {view.availability.posture === 'block-list' ? r.availabilityIntroBlockList : r.availabilityIntro}
          </p>
          <ul className="mt-2 list-disc pl-5 text-[15px] leading-6 text-ink-muted">
            {(view.availability.posture === 'block-list' ? view.availability.blocked : view.availability.allowed).map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </Box>
      ),
    },
    {
      id: 'randomness',
      label: c.tiles.randomness,
      heading: c.randomnessHeading,
      content: (
        <Box id="randomness">
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{r.randomness}</p>
        </Box>
      ),
    },
    {
      id: 'check',
      label: c.tiles.check,
      heading: c.checkHeading,
      content: (
        <Box id="check">
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{c.checkIntro}</p>
          <ul className="mt-3 flex flex-col gap-2 text-[15px]">
            <li>
              <Link href="/verify" className="text-brand underline underline-offset-2 hover:text-brand-hot">
                {c.checkVerify}
              </Link>
            </li>
            <li>
              <Link href="/custody" className="text-brand underline underline-offset-2 hover:text-brand-hot">
                {c.checkCustody}
              </Link>
            </li>
            <li>
              <Link href="/rules" className="text-brand underline underline-offset-2 hover:text-brand-hot">
                {c.checkRules}
              </Link>
            </li>
          </ul>
        </Box>
      ),
    },
  ];
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
        <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
          <PageIntro tone="marquee" title={c.title} back={{ href: '/rules', label: COPY.shell.nav.backToRules }} lead={c.intro} />
          <SectionTiles label={c.tilesLabel} sections={sections} />
        </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
