/*
 * /complaints (2026-09-19) — the route a player uses to contest anything.
 *
 * It exists because the copy already promised it and led nowhere: "tell us",
 * "you can ask us about your own entry" and "we will give it to you on
 * request" each pointed at nothing at all, and the published appeal right
 * could not be exercised because it named a second reviewer the
 * founder-owned registry does not hold. The named-reviewer apparatus is out
 * of the player-facing product — Blotto Cup is the reviewer of record, a
 * human still decides — and this is the route to challenge that decision.
 *
 * The back-page shape (/rules, /fair-play, /custody): the app header, a pink
 * field wrapping a centred main column, a marquee page intro with a way
 * back, and each block a neon panel. The form is a client component because
 * it signs and submits; the shell is server-rendered, so the page says what
 * it is even if the bundle never arrives (the 2026-09-13 gate lesson).
 */
import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { TabBar } from '@/components/shell/tab-bar';
import { PageIntro } from '@/components/ui/page-intro';
import { COPY } from '@/copy';
import { ComplaintClient } from '@/complaints/complaint-client';

export const metadata: Metadata = { title: COPY.complaints.title };

export default function ComplaintsPage() {
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
        <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
          <PageIntro
            tone="marquee"
            title={COPY.complaints.title}
            back={{ href: '/', label: COPY.shell.nav.backToHome }}
            lead={COPY.complaints.intro}
          />
          <div className="flex flex-col gap-10">
            <ComplaintClient withStatusLookup heading={COPY.complaints.formTitle} />
          </div>
        </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
