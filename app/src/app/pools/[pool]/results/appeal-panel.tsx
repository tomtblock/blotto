/*
 * The appeal panel, as a pure function of what was read — no hooks, no
 * fetch, so it can be rendered to a string and asserted on without a
 * browser. `appeal-client.tsx` owns the state around it.
 *
 * Every ending of the read gets a rendering (audit 2026-09-11, C-04):
 *
 *   not_configured  the heading, the note, and the honest line that this
 *                   build has no review service — the string that existed
 *                   in COPY and could never render before;
 *   unreachable     the heading, the note, what happened, and a control
 *                   that tries again — the player's window is unaffected;
 *   position        the form, the lodged notice or the decision, exactly as
 *                   before; and nothing at all when the service confirms
 *                   there is no upheld flag to appeal.
 *
 * Nothing here renders unless the viewer is the forfeited wallet, and that
 * is decided from ON-CHAIN data by the caller before this is reached — so
 * showing a failure state cannot tell a spectator anything.
 */

import { COPY } from '@/copy';
import type { AppealRead, LodgeOutcome } from './appeal';

export interface AppealPanelProps {
  read: AppealRead | 'loading';
  grounds: string;
  busy: boolean;
  outcome: LodgeOutcome | null;
  onGroundsChange: (grounds: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
}

const c = COPY.results.appeal;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section data-testid="appeal-panel" className="mb-5 rounded-xl border border-line p-5">
      <h2 className="font-display text-[18px] font-bold text-ink">{c.title}</h2>
      <p className="mt-1 max-w-prose text-[13px] leading-5 text-ink-muted">{c.note}</p>
      {children}
    </section>
  );
}

export function AppealPanel(p: AppealPanelProps) {
  if (p.read === 'loading') return null;

  if (p.read.kind === 'not_configured') {
    return (
      <Frame>
        <p role="status" className="mt-3 text-[13px] text-ink">
          {c.outcome.not_configured}
        </p>
      </Frame>
    );
  }

  if (p.read.kind === 'unreachable') {
    return (
      <Frame>
        <p role="status" className="mt-3 text-[13px] text-ink">
          {c.unreachable}
        </p>
        <button
          type="button"
          data-testid="appeal-retry"
          onClick={p.onRetry}
          className="mt-3 h-11 rounded-xl border border-line px-4 text-[14px] font-medium text-ink transition-colors hover:border-brand hover:text-brand"
        >
          {c.retry}
        </button>
      </Frame>
    );
  }

  const { position } = p.read;
  // The service answered and says there is nothing to appeal: as before,
  // nothing is shown.
  if (!position.forfeit) return null;

  return (
    <Frame>
      {position.decided ? (
        <p className="mt-3 text-[13px] text-ink">
          {position.decided.action === 'appeal_upheld' ? c.upheld : c.dismissed}
        </p>
      ) : position.lodged ? (
        <p className="mt-3 text-[13px] text-ink">{c.lodgedOn(position.lodged.decidedAt)}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-[12px] uppercase tracking-[0.1em] text-ink-muted" htmlFor="appeal-grounds">
            {c.groundsLabel}
          </label>
          <textarea
            id="appeal-grounds"
            className="min-h-24 rounded-lg border border-line bg-transparent p-3 text-[14px] text-ink"
            maxLength={2000}
            value={p.grounds}
            onChange={(e) => p.onGroundsChange(e.target.value)}
          />
          <p className="text-[12px] text-ink-muted">{c.windowNote(position.lodgeUntil ?? '')}</p>
          <button
            type="button"
            disabled={p.busy || p.grounds.trim().length === 0}
            onClick={p.onSubmit}
            className="h-11 rounded-xl border border-line px-4 text-[14px] font-medium text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {c.submit}
          </button>
          {p.outcome && p.outcome !== 'lodged' && (
            <p className="text-[13px] text-ink-muted">{c.outcome[p.outcome]}</p>
          )}
        </div>
      )}
    </Frame>
  );
}
