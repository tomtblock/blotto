/*
 * Fair play — what keeps the competition fair, who may enter, and how to
 * check it. Every number derives through fair-play.config.ts; every sentence
 * lives in the copy module. Read-only; nothing here can affect a pool.
 *
 * V2 (founder 2026-09-27): the sections on a tab strip, one at a time or
 * all in order; every section is in the server HTML either way.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { PageIntro } from '@/components/ui/page-intro';
import { Tabs } from '@/components/ui/tabs';
import { TabBar } from '@/components/shell/tab-bar';
import { FULL_FIELD, MIN_FIELD, fairPlayView } from './fair-play.config';

export const metadata: Metadata = { title: COPY.fairPlay.title };

function Box({ id, heading, children }: { id: string; heading: string; children: React.ReactNode }) {
  return (
    <div className="neon-box p-5 sm:p-6" data-testid={`fair-play-${id}`}>
      <h3 className="mb-2 font-display text-[22px] leading-7 font-bold text-ink">{heading}</h3>
      {children}
    </div>
  );
}

export default function FairPlayPage() {
  const view = fairPlayView();
  const c = COPY.fairPlay;
  const r = COPY.rules;
  const tabs = [
    {
      id: 'skill',
      label: c.tabs.skill,
      content: (
        <Box id="skill" heading={c.skillHeading}>
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
      label: c.tabs.screening,
      content: (
        <Box id="screening" heading={c.screeningHeading}>
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{c.screening}</p>
        </Box>
      ),
    },
    {
      id: 'age',
      label: c.tabs.age,
      content: (
        <Box id="age" heading={c.ageHeading}>
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{r.age}</p>
        </Box>
      ),
    },
    {
      id: 'availability',
      label: c.tabs.availability,
      content: (
        <Box id="availability" heading={c.availabilityHeading}>
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
      label: c.tabs.randomness,
      content: (
        <Box id="randomness" heading={c.randomnessHeading}>
          <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{r.randomness}</p>
        </Box>
      ),
    },
    {
      id: 'check',
      label: c.tabs.check,
      content: (
        <Box id="check" heading={c.checkHeading}>
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
          <Tabs label={c.tabsLabel} allowAll hash mountHidden tabs={tabs} />
        </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
