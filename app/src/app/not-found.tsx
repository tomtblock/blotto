/*
 * The 404 (V2, founder 2026-09-27): until now an unstyled white page with
 * no header and no way back. Now the site's one stop card, on the pink
 * field, with the two ways out every stop offers.
 */
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';
import { SiteFooter } from '@/components/shell/site-footer';
import { STOP_ACTIONS, StopCard } from '@/components/ui/stop-card';

export default function NotFound() {
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-brand-pink">
        <main id="main" className="mx-auto w-full max-w-xl px-4 pt-10 pb-24">
          <StopCard
            kind="dead-end"
            title={COPY.stop.notFoundTitle}
            actions={[STOP_ACTIONS.backHome(), STOP_ACTIONS.seePools()]}
            data-testid="not-found"
          >
            <p>{COPY.stop.notFoundLine}</p>
          </StopCard>
        </main>
      </div>
      <SiteFooter />
      <TabBar />
    </>
  );
}
