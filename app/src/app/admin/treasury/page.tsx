import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { AdminGate } from '../admin-gate';
import { TreasuryClient } from './treasury-client';

/*
 * The treasury report (D-A1 revised, master prompt v2 2026-08-27) —
 * founder-facing, NUMBERS ONLY: the prize treasury's balance, the pots
 * locked in live tournaments, the policy floor, per-tier status, and the
 * shortfall to the next unlock. Everything renders from GET /treasury on
 * the indexer read API, which assembles it from the raw event ledger — the
 * same rows a player could rebuild from transaction logs.
 *
 * Read-only by construction: there is no action on this page. Deposits are
 * permissionless transactions; the one withdrawal path is a Squads
 * proposal, made wherever the Squads vault is operated — never here.
 */
/*
 * Unlisted and unindexed (audit 2026-09-11, D-43): a crawler is told not to
 * index this route, robots.ts refuses the path, and the body renders only
 * for a wallet on the reviewer list (admin-gate.tsx).
 */
export const metadata: Metadata = {
  title: 'Treasury — admin',
  robots: { index: false, follow: false },
};

export default function TreasuryPage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <AdminGate>
          <TreasuryClient />
        </AdminGate>
      </main>
    </>
  );
}
