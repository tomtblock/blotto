'use client';

/*
 * Section tiles (V3, founder 2026-09-27: "every subheading as a tile;
 * clicking opens that section; clicking outside returns to the tiles").
 * The rules, the terms, the privacy notice and fair play each hand in their
 * sections; each becomes a cream tile, and a tile opens its section in the
 * Modal (modal.tsx) — cream card, plum text, the yellow glow.
 *
 * The open section is the URL hash (a bare token), so a link like
 * /rules#availability opens on that section, the back button closes it,
 * and a link inside the site keeps working. Nothing here reads or writes
 * storage.
 *
 * Every section's content is in the server HTML, hidden, whichever way it
 * is read: a reader (or counsel, or a crawler) without the client bundle
 * still gets the document, and "Read as one page" — kept for the two
 * documents a reader may want whole — costs no fetch.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { COPY } from '@/copy';
import { Modal } from './modal';

export interface TileSection {
  /** URL-safe token; becomes the hash and the ids. */
  id: string;
  /** The short word on the tile. */
  label: string;
  /** The section's own heading, under the label and on the modal. */
  heading: string;
  content: ReactNode;
}

function readHash(): string | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash.replace(/^#/, '');
  return /^[A-Za-z0-9._~-]+$/.test(h) ? h : null;
}
/* The hash as an external store: the server snapshot is null (so the
 * server HTML and the hydrating client agree: tiles, nothing open), and
 * the client's own snapshot takes over right after — a link to
 * /rules#scoring opens that section with no hydration mismatch. */
const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const noHash = () => null;

const TILE =
  'home-card flex min-h-[92px] flex-col justify-between gap-2 rounded-2xl border-2 border-brand-yellow bg-brand-cream p-4 text-left ' +
  'transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-berry';

export function SectionTiles({
  sections,
  label,
  /** Offer "Read as one page" (the terms, the privacy notice). */
  allowAll = false,
}: {
  sections: readonly TileSection[];
  /** The tile group's accessible name. */
  label: string;
  allowAll?: boolean;
}) {
  const rawHash = useSyncExternalStore(subscribeHash, readHash, noHash);
  const open = rawHash && sections.some((s) => s.id === rawHash) ? sections.find((s) => s.id === rawHash)! : null;
  const [all, setAll] = useState(false);

  const show = (id: string) => {
    // A hash entry per section (the back button closes it); the store
    // above listens for hashchange, which pushState does not fire.
    window.history.pushState(null, '', `#${id}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  const close = () => {
    if (readHash() === null) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  return (
    <div className="flex flex-col gap-5">
      <div role="list" aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="section-tiles">
        {sections.map((s) => (
          <div role="listitem" key={s.id}>
            <button type="button" onClick={() => show(s.id)} className={`${TILE} h-full w-full`} data-testid={`tile-${s.id}`}>
              <span className="font-display text-[18px] leading-6 font-extrabold uppercase tracking-wide text-brand-berry">{s.label}</span>
              <span className="text-[12px] leading-4 text-brand-berry/75">{s.heading}</span>
            </button>
          </div>
        ))}
      </div>

      {allowAll ? (
        <button
          type="button"
          aria-pressed={all}
          onClick={() => setAll((a) => !a)}
          className="self-end rounded-full px-3 py-1.5 text-[12px] text-brand-berry underline underline-offset-2"
          data-testid="tiles-read-all"
        >
          {all ? COPY.shell.oneSectionAtATime : COPY.shell.readAsOnePage}
        </button>
      ) : null}

      {/* Every section, in order: shown under "Read as one page", in the
          server HTML (hidden) otherwise. */}
      <div className={all ? 'flex flex-col gap-4' : undefined} hidden={!all} data-testid="tiles-all">
        {sections.map((s) => (
          <section key={s.id} id={`section-${s.id}`} className="on-cream home-card rounded-[24px] border-2 border-brand-yellow bg-brand-cream p-5 text-brand-berry sm:p-6">
            <h2 className="mb-3 font-display text-[24px] leading-7 font-extrabold text-brand-berry">{s.heading}</h2>
            {s.content}
          </section>
        ))}
      </div>

      <Modal open={open !== null && !all} onClose={close} title={open?.heading ?? ''} kicker={open?.label} data-testid="section-modal">
        {open?.content}
      </Modal>
    </div>
  );
}
