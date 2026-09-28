/**
 * The complaints route's published response windows (2026-09-19), in
 * working days and days.
 *
 * These are the terms' undertaking and are deliberately LONGER than a
 * support desk would like: five working days to acknowledge and thirty days
 * to resolve are windows one person can meet while a pool is running, and a
 * window we miss is worse than a window we never published. Both are
 * registered claims (`app/src/copy/published-claims.test.ts`) and the copy
 * reads them from here rather than typing a figure.
 *
 * WHY A FILE OF THEIR OWN (2026-09-27, page speed). The terms and the
 * privacy notice quote these two figures, and the copy module is in every
 * page's JavaScript. When they lived in `complaints.ts` — beside the
 * signature checks, which import tweetnacl and the event decoder's Node
 * `crypto` hash — every page shipped that whole polyfilled stack to print
 * two integers. A module with no imports costs the page nothing.
 * `complaints.ts` re-exports both, so the service and its tests are
 * unchanged.
 */

export const COMPLAINT_ACKNOWLEDGE_WORKING_DAYS = 5;
export const COMPLAINT_RESOLVE_DAYS = 30;
