/*
 * The complaint form, as a pure function of what the caller holds — no
 * hooks, no fetch — so it renders to a string and is asserted on without a
 * browser. `complaint-client.tsx` owns the state around it.
 *
 * Modelled on `app/src/app/pools/[pool]/results/appeal-panel.tsx`, which it
 * replaces as the way a player contests a decision: a labelled textarea with
 * a maximum length, named outcome states each rendered distinctly, and a
 * submit disabled until the draft is valid.
 *
 * EVERY ENDING HAS A RENDERING. `not_configured` and `unreachable` are
 * rendered as themselves rather than as a refusal, because telling a player
 * their complaint was refused when in truth it never arrived is the C-04
 * defect at the one surface where it costs most — this is the last route
 * they have.
 *
 * `category` decides whether a signature is required, and the form says so
 * BEFORE the player writes, so nobody composes a long complaint and then
 * learns their wallet has to sign it.
 */

import {
  COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
  COMPLAINT_RESOLVE_DAYS,
} from '@blotto/detection/complaints';
import { COPY } from '@/copy';
import { NeonSection } from '@/components/ui/neon-section';
import {
  COMPLAINT_CATEGORY_KEYS,
  COMPLAINT_TEXT_MAX,
  complaintTextValid,
  signatureRequired,
  type ComplaintCategory,
  type ComplaintOutcome,
} from './complaint';

const c = COPY.complaints;

/**
 * The published response windows, read from the service's constants rather
 * than typed — the same rule every number on a player-facing surface
 * follows, and the reason `scripts/check-published-numbers.ts` exists.
 */
const WINDOWS = {
  acknowledgeWorkingDays: COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
  resolveDays: COMPLAINT_RESOLVE_DAYS,
} as const;

export interface ComplaintFormProps {
  category: ComplaintCategory;
  text: string;
  /** The pool the complaint is about, when the caller knows one. */
  pool?: string | null;
  busy: boolean;
  outcome: ComplaintOutcome | null;
  /** Set once a submission was accepted — the player's handle. */
  reference: string | null;
  /** True when a wallet that can sign is signed in. */
  canSign: boolean;
  onCategoryChange: (category: ComplaintCategory) => void;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  /** Heading; the inline use on the results page passes its own. */
  heading?: string;
  /** Rendered above the form — the results page explains why it is there. */
  lead?: string;
}

export function ComplaintForm(p: ComplaintFormProps) {
  const needsSignature = signatureRequired(p.category);
  const valid = complaintTextValid(p.text);

  // Accepted: the form is replaced by the reference and the two windows.
  // Nothing on screen invites a second submission of the same complaint.
  if (p.outcome === 'submitted' && p.reference !== null) {
    return (
      <NeonSection heading={p.heading ?? c.title} data-testid="complaint-sent">
        <p className="text-[17px] font-semibold text-ink">{c.outcome.submitted}</p>
        <p className="mt-3 max-w-prose text-[15px] leading-6 text-ink">
          {c.referenceKeep(p.reference)}
        </p>
        <p className="mt-3 max-w-prose text-[14px] leading-5 text-ink-muted">
          {c.windows(WINDOWS.acknowledgeWorkingDays, WINDOWS.resolveDays)}
        </p>
      </NeonSection>
    );
  }

  return (
    <NeonSection heading={p.heading ?? c.title} data-testid="complaint-form">
      {p.lead ? (
        <p className="mb-4 max-w-prose text-[15px] leading-6 text-ink-muted">{p.lead}</p>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[12px] uppercase tracking-[0.1em] text-ink-muted">
          {c.categoryLabel}
        </legend>
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={c.categoryLabel}>
          {COMPLAINT_CATEGORY_KEYS.map((key) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[15px] text-ink transition-colors hover:bg-white/8"
            >
              <input
                type="radio"
                name="complaint-category"
                value={key}
                checked={p.category === key}
                onChange={() => p.onCategoryChange(key)}
                data-testid={`complaint-category-${key}`}
                className="accent-brand"
              />
              {c.categories[key]}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Said BEFORE the player writes, so nobody composes a long complaint
          and then learns their wallet has to sign it. */}
      <p className="mt-4 max-w-prose text-[14px] leading-5 text-ink-muted" data-testid="complaint-signature-note">
        {needsSignature ? c.signatureNeeded : c.signatureNotNeeded}
      </p>
      <p className="mt-2 max-w-prose text-[13px] leading-5 text-ink-muted">{c.signatureNote}</p>

      <div className="mt-5 flex flex-col gap-2">
        <label className="text-[12px] uppercase tracking-[0.1em] text-ink-muted" htmlFor="complaint-text">
          {c.textLabel}
        </label>
        <textarea
          id="complaint-text"
          data-testid="complaint-text"
          className="min-h-32 rounded-lg border border-line bg-transparent p-3 text-[15px] text-ink"
          maxLength={COMPLAINT_TEXT_MAX}
          value={p.text}
          placeholder={c.textPlaceholder}
          onChange={(e) => p.onTextChange(e.target.value)}
          aria-describedby="complaint-published"
        />
        {/* The counterpart of the appeal form's published-text warning, and
            the opposite fact: a complaint is NOT published. Said for the same
            reason — before the player types. */}
        <p id="complaint-published" className="text-[13px] leading-5 text-ink-muted">
          {c.publishedNote}
        </p>
      </div>

      <button
        type="button"
        data-testid="complaint-submit"
        disabled={p.busy || !valid || (needsSignature && !p.canSign)}
        onClick={p.onSubmit}
        className="key-action mt-4 flex h-12 items-center justify-center rounded-full border-[3px] border-brand-cream bg-brand px-6 font-display text-[17px] font-bold uppercase tracking-wide text-(--color-base) transition-colors hover:bg-brand-hot disabled:opacity-50"
      >
        {p.busy ? c.submitting : c.submit}
      </button>

      {/* A failed submission keeps the draft on screen: the player's words
          are not thrown away by our failure. */}
      {p.outcome !== null && p.outcome !== 'submitted' && (
        <p role="status" data-testid="complaint-outcome" className="mt-3 max-w-prose text-[14px] leading-5 text-ink">
          {c.outcome[p.outcome]}
        </p>
      )}

      <p className="mt-4 max-w-prose text-[13px] leading-5 text-ink-muted">
        {c.windows(WINDOWS.acknowledgeWorkingDays, WINDOWS.resolveDays)}
      </p>
    </NeonSection>
  );
}
