import type { MetadataRoute } from 'next';

/*
 * Crawl policy (audit 2026-09-11, D-43). /admin/* are founder and reviewer
 * tools and /dev/* are design previews (a hard 404 in a production build
 * already); neither is a public surface, and until now nothing said so to a
 * crawler — the routes were unlisted but indexable.
 *
 * A robots file is a request, not a lock. The lock on the review page is the
 * review service's member check (config/reviewers.json) behind every signed
 * decision, and the Squads vault behind every admin instruction; the gate in
 * admin/admin-gate.tsx is the door sign in front of both.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: ['/admin/', '/dev/'] },
  };
}
