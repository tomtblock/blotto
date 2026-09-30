'use client';

/*
 * THE ENTRY RAIL (founder 2026-09-30): what stands beside the board on a
 * wide screen and under it on a phone — "How this pool…" with its Plays /
 * Pays toggle and the Rules and Terms links, then the two statements of
 * the D-B4 clickwrap as tiles, for a wallet whose acceptance of the current
 * terms is not yet on record. The one gold key sits under all of it, drawn
 * by the board (BoardFlow) so the same key seals from the board and from
 * the buzzer's review.
 *
 * WHAT MOVED HERE. The pool page's rules box (the page is no longer a stop
 * on the way in: the home card's Enter lands on the board), and the
 * full-screen "Before you enter" clickwrap that stood ahead of the board.
 * The statements are the SAME statements, signed by the SAME message
 * (entry/attestation.ts): ticking a tile records nothing; the seal press
 * has the wallet sign them first, once, and only then the sealed entry and
 * the payment. A wallet already on record sees no tiles at all.
 *
 * Founder 2026-09-09 (carried over): each statement is a designed tile
 * with its own check mark, not a browser checkbox; the real checkbox stays
 * for assistive tech and tests.
 */

import { useSyncExternalStore } from 'react';
import { DEFAULT_FILL_DEADLINE_SECS, MIN_SEATS } from '@blotto/scoring';
import { COPY } from '@/copy';
import { BOARD_CLOCK_BUDGET_MS, type BoardMode } from '@/battle/board/mode';
import { PoolRules } from '@/components/pools/pool-rules';
import { hasLocalAttestation } from '@/entry/attestation';
import './entry-rail.css';

const MIN_SEATS_N = Number(MIN_SEATS);
const FILL_HOURS = Number(DEFAULT_FILL_DEADLINE_SECS / 3600n);
const BOARD_MINUTES = BOARD_CLOCK_BUDGET_MS / 60_000;

/* The attestation flag lives in localStorage; reading it during the first
 * render made server and client HTML disagree (hydration error). The
 * store below reads it through useSyncExternalStore — false on the
 * server, the real value after hydration, notified on a fresh attest. */
const attestListeners = new Set<() => void>();
function subscribeAttested(cb: () => void): () => void {
  attestListeners.add(cb);
  return () => attestListeners.delete(cb);
}
/** Tell every mounted rail that an acceptance was just recorded. */
export function notifyAttested(): void {
  for (const cb of attestListeners) cb();
}
/** Whether this device holds the wallet's acceptance of the current terms. */
export function useAttested(wallet: string): boolean {
  return useSyncExternalStore(
    subscribeAttested,
    () => hasLocalAttestation(wallet),
    () => false
  );
}

export interface EntryRailProps {
  mode: BoardMode;
  /** On record for this wallet: the statement tiles are not drawn. */
  attested: boolean;
  ageChecked: boolean;
  termsChecked: boolean;
  onAgeChange: (next: boolean) => void;
  onTermsChange: (next: boolean) => void;
  /** While the wallet is signing them: the tiles cannot be changed. */
  disabled?: boolean;
}

export function EntryRail({
  mode,
  attested,
  ageChecked,
  termsChecked,
  onAgeChange,
  onTermsChange,
  disabled = false,
}: EntryRailProps) {
  const statements = attested
    ? []
    : ([
        { key: 'age', checked: ageChecked, set: onAgeChange, text: COPY.gate.ageAttestation },
        { key: 'terms', checked: termsChecked, set: onTermsChange, text: COPY.gate.termsAcceptance },
      ] as const);
  return (
    <div className="entry-rail" data-testid="entry-rail">
      <PoolRules mode={mode} minutes={BOARD_MINUTES} minSeats={MIN_SEATS_N} fillHours={FILL_HOURS} />
      {statements.length > 0 ? (
        <ol className="flex flex-col gap-2.5" aria-label={COPY.gate.statementsLabel} data-testid="entry-statements">
          {statements.map((st, i) => (
            <li key={st.key}>
              <StatementTile index={i + 1} checked={st.checked} onChange={st.set} text={st.text} disabled={disabled} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * One statement of the clickwrap: a large tap target whose whole face is
 * the control, drawn by us — a ring that fills with the brand colour and a
 * check mark when confirmed — so the two statements read as part of the
 * product, not as a form.
 */
function StatementTile({
  index,
  checked,
  onChange,
  text,
  disabled,
}: {
  index: number;
  checked: boolean;
  onChange: (next: boolean) => void;
  text: string;
  disabled: boolean;
}) {
  return (
    <label
      data-testid={`gate-statement-${index}`}
      data-checked={checked ? 'true' : 'false'}
      className={
        'group relative flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-[border-color,background-color,box-shadow] ' +
        (checked
          ? 'border-brand bg-brand/10 shadow-[0_0_0_1px_var(--color-brand)]'
          : 'border-line bg-raised hover:border-brand/40') +
        (disabled ? ' cursor-default opacity-70' : '')
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={
          'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition-[background-color,border-color] ' +
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-cream peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-(--color-base) ' +
          (checked
            ? 'border-brand bg-brand text-(--color-base)'
            : 'border-line bg-base text-transparent group-hover:border-brand/60')
        }
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
          <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-[14px] leading-5 text-ink">{text}</span>
    </label>
  );
}
