import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { AdminGate } from '../admin-gate';
import { ReviewClient } from './review-client';

/*
 * The review page (roadmap 4.4) — founder-facing: flagged entries with their
 * evidence, clear/forfeit actions, and the decision log.
 *
 * PHASE-4-REVIEW: access control is Squads-member login per the roadmap;
 * that wiring (challenge-sign against the Squads member set) lands with the
 * Phase 5 credentials. Until then this page renders read-only against the
 * read API and the action buttons target the review API seam — there is no
 * settlement key anywhere near the browser either way: actions are REQUESTS
 * to the review backend, which holds the settlement signer.
 */
/*
 * Unlisted and unindexed (audit 2026-09-11, D-43): a crawler is told not to
 * index this route, robots.ts refuses the path, and the body renders only
 * for a wallet on the reviewer list (admin-gate.tsx).
 */
export const metadata: Metadata = {
  title: 'Review — admin',
  robots: { index: false, follow: false },
};

export default function ReviewPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <AdminGate>
          <ReviewClient />
        </AdminGate>
      </main>
    </>
  );
}
