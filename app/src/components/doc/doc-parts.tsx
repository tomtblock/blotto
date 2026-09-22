/*
 * The two pieces the terms page and the privacy notice both need
 * (2026-09-19). Neither is a new design primitive: `DocNav` is a list of
 * links and `OperatorRows` is a definition list, both drawn with the
 * classes the back pages already use. They live here because both
 * documents are long enough to need within-page navigation and both render
 * the same founder-owned identity, and one copy of each is better than two
 * that can drift.
 */

import type { ReactNode } from 'react';
import { COPY } from '@/copy';

/**
 * Within-page navigation: a link per section anchor, at the top of a long
 * document. Plain anchors, so it works with no JavaScript at all, and the
 * sections carry `scroll-mt-24` from `NeonSection` so a heading does not
 * land under the sticky header.
 */
export function DocNav({
  label,
  items,
}: {
  label: string;
  items: readonly { id: string; heading: ReactNode }[];
}) {
  return (
    <nav aria-label={label} className="rounded-[24px] border-2 border-brand-berry/30 bg-brand-cream/80 px-5 py-4">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-berry">
        {label}
      </p>
      <ol className="flex flex-col gap-1.5 sm:grid sm:grid-cols-2 sm:gap-x-6">
        {items.map((item, i) => (
          <li key={item.id} className="flex gap-2 text-[14px] leading-5">
            <span className="tnum shrink-0 font-mono text-brand-berry/60">{i + 1}.</span>
            <a
              href={`#${item.id}`}
              className="text-brand-berry underline underline-offset-2 hover:text-brand-deep-magenta"
            >
              {item.heading}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The founder-owned operator identity, as label/value rows.
 *
 * An unset value arrives here already rendered as the explicit "not yet
 * set" (`operator/operator.ts`), and is drawn in italics so a reader can
 * see at a glance which parts of the document are waiting on a company —
 * exactly as the custody page draws its unprovisioned timelock.
 */
export function OperatorRows({
  rows,
  unsetNote,
}: {
  rows: readonly { label: string; value: string }[];
  /** Shown above the rows while anything is unset. */
  unsetNote: string | null;
}) {
  return (
    <>
      {unsetNote && (
        <p className="mt-3 max-w-prose text-[14px] leading-5 font-medium text-prize">{unsetNote}</p>
      )}
      <dl className="mt-4 flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <dt className="text-[12px] uppercase tracking-[0.12em] text-ink-muted">{row.label}</dt>
            <dd className="text-[15px] leading-6 text-ink">
              {row.value === COPY.operator.notYetSet ? (
                <span className="italic text-ink-muted">{row.value}</span>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
