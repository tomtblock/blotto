import type { Auth } from '@/wallet/types';

/*
 * Who may see an admin page (audit 2026-09-11, D-43): the wallet signed in
 * must be on the founder-maintained reviewer list — the SAME list the review
 * service checks before it accepts a signed decision (config/reviewers.json,
 * backend/detection/src/auth.ts). One source of truth, so a reviewer added
 * to the list gets the page and the service together.
 *
 * Pure so the four outcomes are pinned without a DOM (admin-access.test.ts).
 * This decides what the page SHOWS; it is not what protects a decision. A
 * browser can render anything it likes — the service verifies the
 * signature against the list, and the treasury numbers are public reads.
 */
export type AdminAccess = 'initializing' | 'signed-out' | 'not-a-member' | 'member';

export function adminAccess(
  auth: Pick<Auth, 'status' | 'walletAddress'>,
  members: readonly string[]
): AdminAccess {
  if (auth.status === 'initializing') return 'initializing';
  if (auth.status !== 'signed-in' || !auth.walletAddress) return 'signed-out';
  return members.includes(auth.walletAddress) ? 'member' : 'not-a-member';
}
