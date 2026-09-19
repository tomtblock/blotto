/*
 * The status lookup, as a pure function of what was read — no hooks, no
 * fetch. A player who has a reference can see where their complaint is.
 *
 * Every ending has a rendering, and the three failures are distinct:
 * `not_found` (no complaint matches that reference FOR THIS WALLET — the
 * service deliberately cannot tell those two apart, so neither can this),
 * `not_configured` (no service in this build) and `unreachable` (a service
 * that did not answer). The first is about the reference; the other two are
 * about us, and a player must be able to tell which.
 */

import { COPY } from '@/copy';
import { NeonSection } from '@/components/ui/neon-section';
import { COMPLAINT_REFERENCE_PATTERN } from '@blotto/detection/complaint-message';
import type { ComplaintStatusRead } from './complaint';

const c = COPY.complaints;

export interface ComplaintStatusPanelProps {
  reference: string;
  read: ComplaintStatusRead | 'idle' | 'loading';
  onReferenceChange: (reference: string) => void;
  onCheck: () => void;
}

export function ComplaintStatusPanel(p: ComplaintStatusPanelProps) {
  const valid = COMPLAINT_REFERENCE_PATTERN.test(p.reference.trim().toUpperCase());
  return (
    <NeonSection heading={c.statusTitle} data-testid="complaint-status">
      <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{c.statusIntro}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <label
            className="text-[12px] uppercase tracking-[0.1em] text-ink-muted"
            htmlFor="complaint-ref"
          >
            {c.statusRefLabel}
          </label>
          <input
            id="complaint-ref"
            data-testid="complaint-ref"
            value={p.reference}
            onChange={(e) => p.onReferenceChange(e.target.value)}
            placeholder="BC-XXXXXXXX"
            autoComplete="off"
            spellCheck={false}
            className="h-12 rounded-lg border border-line bg-transparent px-3 font-mono text-[15px] text-ink outline-none transition-colors focus:border-brand"
          />
        </div>
        <button
          type="button"
          data-testid="complaint-check"
          disabled={!valid || p.read === 'loading'}
          onClick={p.onCheck}
          className="key-cream h-12 shrink-0 rounded-full px-6 text-[15px] font-semibold disabled:opacity-50"
        >
          {c.statusSubmit}
        </button>
      </div>

      {p.read !== 'idle' && p.read !== 'loading' && (
        <div className="mt-4" data-testid="complaint-status-result">
          {p.read.kind === 'status' ? (
            <>
              <p className="text-[17px] font-semibold text-ink">
                {c.statusStates[p.read.status.status]}
              </p>
              <p className="mt-2 text-[14px] text-ink-muted">
                {p.read.status.signed ? c.statusSignedYes : c.statusSignedNo}
              </p>
              {p.read.status.note !== null && (
                <p className="mt-3 max-w-prose text-[15px] leading-6 text-ink">
                  {p.read.status.note}
                </p>
              )}
              <p className="mt-3 max-w-prose text-[13px] leading-5 text-ink-muted">
                {c.windows(
                  p.read.status.acknowledgeWorkingDays,
                  p.read.status.resolveDays
                )}
              </p>
            </>
          ) : (
            <p role="status" className="max-w-prose text-[14px] leading-5 text-ink">
              {p.read.kind === 'not_found'
                ? c.statusNotFound
                : p.read.kind === 'not_configured'
                  ? c.outcome.not_configured
                  : c.outcome.unreachable}
            </p>
          )}
        </div>
      )}
    </NeonSection>
  );
}
