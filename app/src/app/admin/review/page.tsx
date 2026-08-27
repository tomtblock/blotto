import { AppHeader } from '@/components/shell/app-header';
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
export default function ReviewPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <ReviewClient />
      </main>
    </>
  );
}
