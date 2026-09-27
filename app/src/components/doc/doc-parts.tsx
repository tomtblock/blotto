/*
 * The piece the terms page and the privacy notice both need (2026-09-19):
 * `OperatorRows` is a definition list drawn with the classes the back pages
 * already use, rendering the same founder-owned identity on both documents
 * — one copy is better than two that can drift. (`DocNav`, the within-page
 * link list, left on 2026-09-27 when the documents became tabs.)
 */

import { COPY } from '@/copy';

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
