'use client';

/*
 * The treasury report's client half: fetch GET /treasury from the indexer
 * read API and render the numbers. No chain access, no wallet, no action —
 * a founder DASHBOARD, not a control surface. Amounts arrive as decimal
 * lamport strings and are formatted through the same float-free formatter
 * as the rest of the app.
 */

import { useEffect, useState } from 'react';
import { lamportsToSol } from '@/data/format';

interface TierStatus {
  tier: number;
  price_lamports: string;
  pot_lamports: string;
  /*
   * D-35 (audit 2026-09-11): 'disabled' was missing from this union, so
   * `STATUS_LABEL[t.status]` was `undefined` for every tier the founder has
   * not enabled — six of seven rows rendered a blank status cell, with no
   * error anywhere. The union must mirror the report's own
   * (`backend/indexer/src/treasury-report.ts`).
   */
  status: 'open' | 'settling' | 'openable' | 'short' | 'disabled';
  live_pool_state: string | null;
  short_by_lamports: string;
}

interface TreasuryReport {
  platform_balance_lamports: string;
  reserved_pot_lamports: string;
  refundable_entry_lamports: string;
  policy: { reserve_pots: number; min_platform_lamports: string };
  withdraw_floor_lamports: string;
  withdrawable_lamports: string;
  tiers: TierStatus[];
  tier0_pools_to_next_unlock: string | null;
  /*
   * D-41 (audit 2026-09-11). Optional because a deployed indexer older than
   * this page does not send them, and a caption that asserts a provenance
   * it did not read would be the same defect in a new place.
   *
   *  - `policy_source`: 'chain' = the live Config account and the platform
   *    PDA; 'ledger' = the bounded event ledger and the launch tables.
   *  - `enablement_source`: where the tier enablement came from. The old
   *    caption claimed enablement was NOT on the event ledger and that a
   *    disabled tier therefore still showed as openable — untrue since the
   *    indexer began consuming TiersOpened (E1 PR3a), and the report now
   *    answers 'disabled' for exactly those tiers.
   */
  policy_source?: 'chain' | 'ledger';
  enablement_source?: 'chain' | 'ledger' | 'launch_default';
}

type State =
  | { kind: 'loading' }
  | { kind: 'unconfigured' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; report: TreasuryReport };

export const STATUS_LABEL: Record<TierStatus['status'], string> = {
  open: 'Tournament open',
  settling: 'Settling',
  openable: 'Ready to open',
  short: 'Short',
  // Not enabled: it contributes nothing to the withdrawal floor and is
  // never "short" (treasury-report.ts says so in as many words).
  disabled: 'Not enabled',
};

/** Anything the report says that this page has not been taught. Rendering
 * the raw value is the honest answer — a blank cell is how D-35 hid. */
export const statusLabel = (status: string): string =>
  STATUS_LABEL[status as TierStatus['status']] ?? status;

/**
 * Where the numbers on this page came from (audit 2026-09-11, D-41).
 *
 * The caption this replaces said tier enablement was "not on the event
 * ledger, so an idle tier the founder has disabled still shows here". That
 * stopped being true when the indexer began consuming TiersOpened (E1
 * PR3a): the report answers `disabled` for exactly those tiers and names
 * where it learned it. The page was therefore contradicting the table
 * directly above the sentence.
 *
 * It also states the policy source, because a reader has to be able to tell
 * a chain-anchored number from a ledger-derived one — a ledger-derived
 * withdrawal floor is a LOWER BOUND on what the program will enforce, and
 * O26 is what happens when nobody can tell.
 */
export function provenanceCaption(
  report: Pick<TreasuryReport, 'policy_source' | 'enablement_source'>
): string {
  const policy =
    report.policy_source === 'chain'
      ? 'Balances and policy are read from the live Config account and the platform PDA.'
      : report.policy_source === 'ledger'
        ? 'Balances and policy are derived from the bounded event ledger and the launch tier tables — the chain could not be read, so treat the withdrawal floor as a lower bound.'
        : 'Balances and policy come from the treasury report; this indexer does not say whether they are chain-anchored or ledger-derived.';
  const enablement =
    report.enablement_source === 'chain'
      ? 'Tier enablement is read from the live Config account.'
      : report.enablement_source === 'ledger'
        ? 'Tier enablement is replayed from the ledger’s latest TiersOpened event.'
        : report.enablement_source === 'launch_default'
          ? 'Tier enablement falls back to init_config’s launch posture: no TiersOpened event has been seen and the Config account could not be read.'
          : 'Tier enablement is as the report supplied it.';
  return `${policy} ${enablement} The program is the authority on which tiers may open.`;
}

export function TreasuryClient() {
  // NEXT_PUBLIC_* is inlined at build time, so "unconfigured" is knowable at
  // first render — no state write inside the effect for it.
  const base = process.env.NEXT_PUBLIC_INDEXER_URL;
  const [state, setState] = useState<State>(
    base ? { kind: 'loading' } : { kind: 'unconfigured' }
  );

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    fetch(`${base}/treasury`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`treasury: ${res.status}`);
        return (await res.json()) as TreasuryReport;
      })
      .then((report) => {
        if (!cancelled) setState({ kind: 'ready', report });
      })
      .catch((e) => {
        if (!cancelled) setState({ kind: 'error', message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (state.kind === 'loading') {
    return <p className="opacity-60">Loading the treasury report…</p>;
  }
  if (state.kind === 'unconfigured') {
    return (
      <p className="opacity-60">
        Indexer not configured (NEXT_PUBLIC_INDEXER_URL) — the treasury report reads from its
        /treasury endpoint.
      </p>
    );
  }
  if (state.kind === 'error') {
    return <p className="text-red-400">Could not load the treasury report: {state.message}</p>;
  }

  const r = state.report;
  const summary: Array<[string, string]> = [
    ['Prize treasury balance', `${lamportsToSol(r.platform_balance_lamports)} SOL`],
    ['Locked in live prize pools', `${lamportsToSol(r.reserved_pot_lamports)} SOL`],
    ['Refundable entry payments', `${lamportsToSol(r.refundable_entry_lamports)} SOL`],
    ['Withdrawal floor', `${lamportsToSol(r.withdraw_floor_lamports)} SOL`],
    ['Withdrawable above the floor', `${lamportsToSol(r.withdrawable_lamports)} SOL`],
    [
      'Policy',
      `${r.policy.reserve_pots} reserve prize pool(s) per idle tier · ${lamportsToSol(
        r.policy.min_platform_lamports
      )} SOL minimum`,
    ],
  ];

  return (
    <>
      <h1 className="mb-6 text-2xl">Treasury report</h1>
      <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {summary.map(([label, value]) => (
          <div key={label} className="rounded border p-4">
            <div className="text-sm opacity-60">{label}</div>
            <div className="mt-1 font-mono">{value}</div>
          </div>
        ))}
      </section>

      <section className="mb-8 rounded border p-4">
        <h2 className="mb-3">Per-tier status</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="opacity-60">
              <th className="py-1">Tier</th>
              <th className="py-1">Entry (SOL)</th>
              <th className="py-1">Prize pool (SOL)</th>
              <th className="py-1">Status</th>
              <th className="py-1 text-right">Short by (SOL)</th>
            </tr>
          </thead>
          <tbody>
            {r.tiers.map((t) => (
              <tr key={t.tier}>
                <td className="py-1">{t.tier}</td>
                <td className="py-1 font-mono">{lamportsToSol(t.price_lamports)}</td>
                <td className="py-1 font-mono">{lamportsToSol(t.pot_lamports)}</td>
                <td className="py-1">
                  {statusLabel(t.status)}
                  {t.live_pool_state ? ` (${t.live_pool_state})` : ''}
                </td>
                <td className="py-1 text-right font-mono">
                  {t.short_by_lamports === '0' ? '—' : lamportsToSol(t.short_by_lamports)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {r.tier0_pools_to_next_unlock !== null ? (
        <p className="text-sm opacity-80">
          Full tier-0 tournaments to the next unlock at current economics:{' '}
          <span className="font-mono">{r.tier0_pools_to_next_unlock}</span>
        </p>
      ) : null}
      <p className="mt-4 text-sm opacity-60">{provenanceCaption(r)}</p>
    </>
  );
}
